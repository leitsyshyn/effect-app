import {
  Array,
  DateTime,
  Deferred,
  Effect,
  Latch,
  Layer,
  Match,
  Option,
  Predicate,
  Redacted,
  Schedule,
  Stream,
} from "effect";
import { describeFailure, SessionRejected } from "../../domain/failures";
import type { RemoteFailure } from "../../domain/failures";
import type { RelativePath } from "../../domain/path";
import { Disposition, recover, Recovery } from "../../domain/recovery";
import type { Condition } from "../../domain/recovery";
import { httpRemoteDriveLayer } from "../../infra/drive-http";
import type { Link, Session } from "../settings/settings";
import { ReplicaActivity } from "./activity";
import { LocalTree } from "./local-tree";
import { Reconciler } from "./reconciler";
import { RemoteTree } from "./remote-tree";
import { SyncedTree } from "./synced-tree";
import { WorkQueue } from "./work-queue";

const POLL_INTERVAL = "60 seconds";
const FOLDER_CHECK_INTERVAL = "10 seconds";
const OFFLINE_PROBE_INTERVAL = "2 seconds";
const SAFETY_SCAN_INTERVAL = "10 minutes";

const reconnect = Schedule.min([Schedule.exponential("250 millis"), Schedule.spaced("2 seconds")]);

export const replicaLayer = (options: {
  readonly session: Session;
  readonly link: Link;
  readonly deviceName: string;
}) =>
  Reconciler.layer({ deviceName: options.deviceName }).pipe(
    Layer.provideMerge(RemoteTree.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        LocalTree.layer({ root: options.link.rootPath, linkId: options.link.id }),
        httpRemoteDriveLayer({
          serverUrl: options.session.serverUrl,
          token: Redacted.value(options.session.token),
        }),
      ),
    ),
  );

export interface ReplicaSignals {
  readonly syncNow: Stream.Stream<void>;
}

export const runReplica = (signals: ReplicaSignals) =>
  Effect.gen(function* () {
    const local = yield* LocalTree;
    const remote = yield* RemoteTree;
    const reconciler = yield* Reconciler;
    const queue = yield* WorkQueue;
    const syncedTree = yield* SyncedTree;
    const activity = yield* ReplicaActivity;

    const online = yield* Latch.make(true);
    const folderReady = yield* Latch.make(false);
    const signedOut = yield* Deferred.make<void>();

    const park = (condition: Condition, reason: string) =>
      Match.value(condition).pipe(
        Match.when("offline", () =>
          online.close.pipe(Effect.andThen(activity.update((a) => ({ ...a, offline: true })))),
        ),
        Match.when("folder-unavailable", () =>
          folderReady.close.pipe(
            Effect.andThen(activity.update((a) => ({ ...a, blocked: Option.some(reason) }))),
          ),
        ),
        Match.when("signed-out", () => Deferred.succeed(signedOut, undefined)),
        Match.exhaustive,
      );
    const goOnline = online.open.pipe(
      Effect.andThen(activity.update((a) => ({ ...a, offline: false }))),
    );

    const observe = <A, E extends RemoteFailure>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.tap(() => goOnline),
        Effect.tapError((failure) =>
          Recovery.$match(recover(failure), {
            Park: ({ condition }) => park(condition, describeFailure(failure)),
            Replan: () => Effect.void,
            Retry: () => Effect.void,
            Report: () => Effect.void,
          }),
        ),
      );

    const checkFolder = local.health.pipe(
      Effect.matchEffect({
        onFailure: (failure) => park("folder-unavailable", failure.reason),
        onSuccess: () =>
          folderReady.open.pipe(
            Effect.andThen(activity.update((a) => ({ ...a, blocked: Option.none() }))),
          ),
      }),
    );

    const scheduleAll = Effect.gen(function* () {
      const paths = [
        ...(yield* local.scan(Option.none())),
        ...(yield* syncedTree.paths),
        ...(yield* remote.livePaths),
      ];
      yield* queue.schedule(Array.dedupe(paths));
    }).pipe(Effect.catch((failure) => Effect.logWarning("Full scan failed", failure)));

    const scheduleLocal = (batch: ReadonlyArray<RelativePath>) =>
      Effect.forEach(batch, syncedTree.pathsWithin).pipe(
        Effect.flatMap((inside) => queue.schedule(Array.dedupe([...batch, ...inside.flat()]))),
      );

    const refreshQuietly = observe(remote.refresh).pipe(
      Effect.catch((failure) => Effect.logDebug("Pull failed", failure).pipe(Effect.as([]))),
    );

    yield* activity.update((a) => ({
      ...a,
      starting: true,
      offline: false,
      blocked: Option.none(),
    }));
    yield* Effect.addFinalizer(() => activity.reset);

    yield* checkFolder.pipe(
      Effect.repeat(Schedule.spaced(FOLDER_CHECK_INTERVAL)),
      Effect.forkScoped,
    );
    yield* folderReady.await;
    yield* local.sweepTemporary.pipe(
      Effect.catch((failure) => Effect.logWarning("Removing partial downloads failed", failure)),
    );

    yield* local.changes.pipe(
      Stream.runForEach(scheduleLocal),
      Effect.catch((failure) => Effect.logWarning("Folder watcher stopped; restarting", failure)),
      Effect.andThen(checkFolder),
      Effect.andThen(scheduleAll),
      Effect.repeat(Schedule.spaced("5 seconds")),
      Effect.forkScoped,
    );
    yield* scheduleAll;

    yield* observe(remote.hydrate).pipe(
      Effect.flatMap(queue.schedule),
      Effect.tapError((failure) =>
        Effect.logWarning("Loading the remote tree failed; retrying", failure),
      ),
      Effect.retry({
        while: (failure) => !Predicate.isTagged(failure, "SessionRejected"),
        schedule: reconnect,
      }),
      Effect.catchTags({
        RemoteUnavailable: Effect.die,
        RemoteRejected: Effect.die,
        RemoteOutdated: Effect.die,
        StoreFailed: Effect.die,
      }),
    );
    yield* activity.update((a) => ({ ...a, starting: false }));

    const worker = Effect.gen(function* () {
      yield* folderReady.await;
      yield* online.await;
      yield* queue.next((path, attempt) =>
        reconciler.sync(path, attempt).pipe(
          Effect.tap(
            Disposition.$match({
              Settled: () =>
                Effect.flatMap(DateTime.now, (now) =>
                  activity.update((a) => ({ ...a, lastSyncedAt: Option.some(now) })),
                ),
              Parked: ({ condition, reason }) => park(condition, reason),
              Retry: () => Effect.void,
            }),
          ),
        ),
      );
    }).pipe(
      Effect.catch((failure) => Effect.logWarning("Work queue failed", failure)),
      Effect.forever,
    );
    yield* Effect.forkScoped(worker);

    const announced = remote.changes.pipe(
      Stream.tap(() => goOnline),
      Stream.tapError((failure) =>
        Recovery.$match(recover(failure), {
          Park: ({ condition }) => park(condition, describeFailure(failure)),
          Replan: () => Effect.void,
          Retry: () => Effect.void,
          Report: () => Effect.void,
        }),
      ),
      Stream.retry(reconnect),
    );
    const polled = Stream.tick(POLL_INTERVAL).pipe(Stream.mapEffect(() => refreshQuietly));
    const requested = signals.syncNow.pipe(
      Stream.mapEffect(() => refreshQuietly.pipe(Effect.tap(() => scheduleAll))),
    );
    yield* Stream.mergeAll([announced, polled, requested], { concurrency: "unbounded" }).pipe(
      Stream.runForEach(queue.schedule),
      Effect.catch((failure) => Effect.logWarning("Scheduling remote changes failed", failure)),
      Effect.forkScoped,
    );

    yield* Effect.gen(function* () {
      if (!online.isOpen())
        yield* refreshQuietly.pipe(Effect.flatMap(queue.schedule), Effect.ignore);
    }).pipe(Effect.repeat(Schedule.spaced(OFFLINE_PROBE_INTERVAL)), Effect.forkScoped);

    yield* scheduleAll.pipe(Effect.delay(SAFETY_SCAN_INTERVAL), Effect.forever, Effect.forkScoped);

    yield* Deferred.await(signedOut);
    return yield* new SessionRejected();
  }).pipe(Effect.scoped);
