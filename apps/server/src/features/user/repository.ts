import { asc, eq } from "drizzle-orm";
import { Array, Context, Effect, Layer, Schema } from "effect";
import type { Option } from "effect";
import { User } from "@effect-app/domain/user";
import type { UserId } from "@effect-app/domain/user";
import { EffectPgDrizzleClient, PersistenceError } from "../../infra/db/client";
import { user as userTable } from "../../infra/db/schema";

const UserFromRow = User.pipe(
  Schema.fieldsAssign({
    image: Schema.OptionFromNullOr(Schema.String),
    createdAt: Schema.DateTimeUtcFromDate,
    updatedAt: Schema.DateTimeUtcFromDate,
  }),
);

export interface ListUsersOptions {
  readonly limit: number;
  readonly offset: number;
}

interface UserRepositoryInterface {
  readonly findById: (id: UserId) => Effect.Effect<Option.Option<User>, PersistenceError>;
  readonly list: (
    options: ListUsersOptions,
  ) => Effect.Effect<ReadonlyArray<User>, PersistenceError>;
}

export class UserRepository extends Context.Service<UserRepository, UserRepositoryInterface>()(
  "effect-app/user/UserRepository",
) {
  static readonly make: Effect.Effect<UserRepositoryInterface, never, EffectPgDrizzleClient> =
    Effect.gen(function* () {
      const db = yield* EffectPgDrizzleClient;

      const findById = Effect.fn("UserRepository.findById")(
        function* (id: UserId) {
          const rows = yield* db.select().from(userTable).where(eq(userTable.id, id)).limit(1);
          return Array.head(yield* Schema.decodeEffect(Schema.Array(UserFromRow))(rows));
        },
        Effect.mapError((cause) => new PersistenceError({ operation: "findById", cause })),
      );

      const list = Effect.fn("UserRepository.list")(
        function* ({ limit, offset }: ListUsersOptions) {
          const rows = yield* db
            .select()
            .from(userTable)
            .orderBy(asc(userTable.createdAt), asc(userTable.id))
            .limit(limit)
            .offset(offset);
          return yield* Schema.decodeEffect(Schema.Array(UserFromRow))(rows);
        },
        Effect.mapError((cause) => new PersistenceError({ operation: "list", cause })),
      );

      return UserRepository.of({ findById, list });
    });

  static readonly layerWithoutDependencies = Layer.effect(UserRepository, UserRepository.make);

  static readonly layer = UserRepository.layerWithoutDependencies.pipe(
    Layer.provide(EffectPgDrizzleClient.layer),
  );
}
