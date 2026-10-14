import { Context, Effect, Equal, Layer, Option, Stream, SubscriptionRef } from "effect";
import { deriveStatus, idleActivity } from "../../domain/status";
import type { SyncStatus } from "../../domain/status";
import { ReplicaActivity } from "../replica/activity";
import { Issues } from "../replica/issues";
import { WorkQueue } from "../replica/work-queue";
import { Settings } from "../settings/settings";
import type { SettingsSnapshot } from "../settings/settings";

interface SyncStatusServiceInterface {
  readonly current: Effect.Effect<SyncStatus>;
  readonly changes: Stream.Stream<SyncStatus>;
}

const toStatus = (
  settings: SettingsSnapshot,
  rest: Omit<Parameters<typeof deriveStatus>[0], "user" | "serverUrl" | "linkedFolder" | "paused">,
) =>
  deriveStatus({
    user: Option.map(settings.session, (session) => ({
      name: session.user.name,
      email: session.user.email,
    })),
    serverUrl: Option.map(settings.session, (session) => session.serverUrl),
    linkedFolder: Option.map(settings.link, (link) => link.rootPath),
    paused: settings.paused,
    ...rest,
  });

export class SyncStatusService extends Context.Service<
  SyncStatusService,
  SyncStatusServiceInterface
>()("effect-app/sync/SyncStatus") {
  static readonly make = Effect.gen(function* () {
    const settings = yield* Settings;
    const activity = yield* ReplicaActivity;
    const queue = yield* WorkQueue;
    const issues = yield* Issues;

    const status = yield* SubscriptionRef.make(
      toStatus(yield* settings.current, { activity: idleActivity, pendingCount: 0, issueCount: 0 }),
    );

    yield* Stream.zipLatestAll(
      settings.changes,
      activity.changes,
      queue.pendingCount,
      issues.count,
    ).pipe(
      Stream.map(([snapshot, current, pendingCount, issueCount]) =>
        toStatus(snapshot, { activity: current, pendingCount, issueCount }),
      ),
      Stream.runForEach((next) => SubscriptionRef.set(status, next)),
      Effect.forkScoped,
    );

    return SyncStatusService.of({
      current: SubscriptionRef.get(status),
      changes: SubscriptionRef.changes(status).pipe(
        Stream.changesWith((a: SyncStatus, b: SyncStatus) => Equal.equals(a, b)),
      ),
    });
  });

  static readonly layer = Layer.effect(SyncStatusService, SyncStatusService.make);
}
