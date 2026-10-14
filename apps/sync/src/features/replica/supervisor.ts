import {
  Context,
  Crypto,
  Effect,
  Equal,
  FiberHandle,
  FileSystem,
  Layer,
  Option,
  Path,
  PubSub,
  Redacted,
  Semaphore,
  Stream,
} from "effect";
import { HttpClient } from "effect/http";
import { isOwnedBy, Settings } from "../settings/settings";
import type { SettingsSnapshot } from "../settings/settings";
import { ReplicaActivity } from "./activity";
import { Issues } from "./issues";
import { replicaLayer, runReplica } from "./replica";
import { SyncedTree } from "./synced-tree";
import { WorkQueue } from "./work-queue";

interface SupervisorInterface {
  readonly syncNow: Effect.Effect<void>;
  readonly whileStopped: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

const pairingKey = (settings: SettingsSnapshot) => [
  Option.map(settings.session, (session) => [
    session.serverUrl,
    Redacted.value(session.token),
    session.user.id,
  ]),
  Option.map(settings.link, (link) => [link.id, link.ownerId]),
  settings.paused,
];

export class Supervisor extends Context.Service<Supervisor, SupervisorInterface>()(
  "effect-app/sync/Supervisor",
) {
  static readonly make = (options: { readonly deviceName: string }) =>
    Effect.gen(function* () {
      const settings = yield* Settings;
      const activity = yield* ReplicaActivity;
      const replicaContext = yield* Effect.context<
        | SyncedTree
        | Issues
        | WorkQueue
        | ReplicaActivity
        | FileSystem.FileSystem
        | Path.Path
        | Crypto.Crypto
        | HttpClient.HttpClient
      >();
      const replica = yield* FiberHandle.make<void, never>();
      const lifecycle = yield* Semaphore.make(1);
      const syncRequests = yield* PubSub.unbounded<void>();

      const start = Effect.gen(function* () {
        const { session, link, paused } = yield* settings.current;
        if (Option.isNone(session) || Option.isNone(link) || paused) return;
        if (!isOwnedBy(link.value, session.value.user.id)) {
          return yield* Effect.logWarning(
            "The linked folder belongs to another account; not syncing",
          );
        }
        yield* runReplica({ syncNow: Stream.fromPubSub(syncRequests) }).pipe(
          Effect.provide(
            replicaLayer({
              session: session.value,
              link: link.value,
              deviceName: options.deviceName,
            }),
          ),
          Effect.catchTag("SessionRejected", () =>
            Effect.logWarning("The server rejected the session; signing out").pipe(
              Effect.andThen(settings.setSession(Option.none())),
            ),
          ),
          Effect.catchCause((cause) => Effect.logError("Replica stopped", cause)),
          Effect.ensuring(activity.reset),
          Effect.provide(replicaContext),
          FiberHandle.run(replica),
        );
      });

      const restart = lifecycle.withPermits(1)(
        FiberHandle.clear(replica).pipe(Effect.andThen(start)),
      );

      yield* settings.changes.pipe(
        Stream.map(pairingKey),
        Stream.changesWith(Equal.equals),
        Stream.runForEach(() => restart),
        Effect.forkScoped,
      );

      return Supervisor.of({
        syncNow: PubSub.publish(syncRequests, undefined).pipe(Effect.asVoid),
        whileStopped: (effect) =>
          lifecycle
            .withPermits(1)(FiberHandle.clear(replica).pipe(Effect.andThen(effect)))
            .pipe(Effect.ensuring(restart)),
      });
    });

  static readonly layer = (options: { readonly deviceName: string }) =>
    Layer.effect(Supervisor, Supervisor.make(options));
}
