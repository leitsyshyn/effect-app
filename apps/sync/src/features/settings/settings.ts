import { Context, Effect, Layer, Option, Schema, Stream, SubscriptionRef } from "effect";
import { KeyValueStore } from "effect/persistence";
import { UserId } from "@effect-app/domain/user";
import { StoreFailed } from "../../domain/failures";

export const Session = Schema.Struct({
  serverUrl: Schema.String,
  token: Schema.RedactedFromValue(Schema.NonEmptyString),
  user: Schema.Struct({ id: UserId, name: Schema.String, email: Schema.String }),
});
export interface Session extends Schema.Schema.Type<typeof Session> {}

export const Link = Schema.Struct({
  id: Schema.String,
  rootPath: Schema.String,
  linkedAt: Schema.DateTimeUtc,
  ownerId: Schema.optionalKey(UserId),
});
export interface Link extends Schema.Schema.Type<typeof Link> {}

export const isOwnedBy = (link: Link, userId: UserId): boolean => link.ownerId === userId;

export interface SettingsSnapshot {
  readonly session: Option.Option<Session>;
  readonly link: Option.Option<Link>;
  readonly paused: boolean;
}

interface SettingsInterface {
  readonly current: Effect.Effect<SettingsSnapshot>;
  readonly changes: Stream.Stream<SettingsSnapshot>;
  readonly setSession: (session: Option.Option<Session>) => Effect.Effect<void, StoreFailed>;
  readonly setLink: (link: Option.Option<Link>) => Effect.Effect<void, StoreFailed>;
  readonly setPaused: (paused: boolean) => Effect.Effect<void, StoreFailed>;
}

export class Settings extends Context.Service<Settings, SettingsInterface>()(
  "effect-app/sync/Settings",
) {
  static readonly make = Effect.gen(function* () {
    const kv = yield* KeyValueStore.KeyValueStore;
    const sessions = KeyValueStore.toSchemaStore(kv, Session);
    const links = KeyValueStore.toSchemaStore(kv, Link);
    const flags = KeyValueStore.toSchemaStore(kv, Schema.Boolean);

    const storeFailed = (operation: string) =>
      Effect.mapError((cause: unknown) => new StoreFailed({ operation, cause }));

    const initial: SettingsSnapshot = yield* Effect.all({
      session: sessions.get("session"),
      link: links.get("link"),
      paused: Effect.map(
        flags.get("paused"),
        Option.getOrElse(() => false),
      ),
    }).pipe(storeFailed("load"), Effect.orDie);
    const snapshot = yield* SubscriptionRef.make(initial);

    const write = <S extends Schema.Constraint>(
      operation: string,
      store: KeyValueStore.SchemaStore<S>,
      key: string,
      value: Option.Option<S["Type"]>,
    ) =>
      Option.match(value, {
        onNone: () => store.remove(key),
        onSome: (present) => store.set(key, present),
      }).pipe(storeFailed(operation));

    return Settings.of({
      current: SubscriptionRef.get(snapshot),
      changes: SubscriptionRef.changes(snapshot),
      setSession: (session) =>
        write("setSession", sessions, "session", session).pipe(
          Effect.andThen(SubscriptionRef.update(snapshot, (s) => ({ ...s, session }))),
        ),
      setLink: (link) =>
        write("setLink", links, "link", link).pipe(
          Effect.andThen(SubscriptionRef.update(snapshot, (s) => ({ ...s, link }))),
        ),
      setPaused: (paused) =>
        write("setPaused", flags, "paused", Option.some(paused)).pipe(
          Effect.andThen(SubscriptionRef.update(snapshot, (s) => ({ ...s, paused }))),
        ),
    });
  });

  static readonly layerWithoutDependencies = Layer.effect(Settings, Settings.make);

  static readonly layer = Settings.layerWithoutDependencies.pipe(
    Layer.provide(KeyValueStore.layerSql({ table: "settings" })),
  );
}
