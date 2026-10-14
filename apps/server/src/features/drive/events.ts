import { Context, Effect, Layer, PubSub, Stream } from "effect";
import { ChangeCursor } from "@effect-app/domain/drive";
import type { UserId } from "@effect-app/domain/user";

interface DriveChanged {
  readonly ownerId: UserId;
  readonly cursor: ChangeCursor;
}

interface DriveEventsInterface {
  readonly publish: (event: DriveChanged) => Effect.Effect<void>;
  readonly changes: (ownerId: UserId) => Stream.Stream<ChangeCursor>;
}

export class DriveEvents extends Context.Service<DriveEvents, DriveEventsInterface>()(
  "effect-app/drive/DriveEvents",
) {
  static readonly make = Effect.gen(function* () {
    const pubsub = yield* Effect.acquireRelease(
      PubSub.sliding<DriveChanged>(1024),
      PubSub.shutdown,
    );

    const publish = (event: DriveChanged) => PubSub.publish(pubsub, event).pipe(Effect.asVoid);

    const changes = (ownerId: UserId) =>
      Stream.fromPubSub(pubsub).pipe(
        Stream.filter((event) => event.ownerId === ownerId),
        Stream.map((event) => event.cursor),
      );

    return DriveEvents.of({ publish, changes });
  });

  static readonly layer = Layer.effect(DriveEvents, DriveEvents.make);
}
