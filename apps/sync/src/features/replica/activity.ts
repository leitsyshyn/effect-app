import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { idleActivity } from "../../domain/status";
import type { Activity } from "../../domain/status";

interface ReplicaActivityInterface {
  readonly changes: Stream.Stream<Activity>;
  readonly update: (f: (activity: Activity) => Activity) => Effect.Effect<void>;
  readonly reset: Effect.Effect<void>;
}

export class ReplicaActivity extends Context.Service<ReplicaActivity, ReplicaActivityInterface>()(
  "effect-app/sync/ReplicaActivity",
) {
  static readonly make = Effect.map(SubscriptionRef.make(idleActivity), (activity) =>
    ReplicaActivity.of({
      changes: SubscriptionRef.changes(activity),
      update: (f) => SubscriptionRef.update(activity, f),
      reset: SubscriptionRef.set(activity, idleActivity),
    }),
  );

  static readonly layer = Layer.effect(ReplicaActivity, ReplicaActivity.make);
}
