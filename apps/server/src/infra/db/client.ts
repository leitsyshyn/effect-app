import { PgClient } from "@effect/sql-pg";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { databaseConfig } from "./config";
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql/postgres";

export class EffectPgDrizzleClient extends Context.Service<
  EffectPgDrizzleClient,
  Effect.Success<ReturnType<typeof PgDrizzle.makeWithDefaults>>
>()("effect-app/db/EffectPgDrizzleClient") {
  static readonly make = PgDrizzle.makeWithDefaults();

  static readonly layerWithoutDependencies = Layer.effect(
    EffectPgDrizzleClient,
    EffectPgDrizzleClient.make,
  );

  static readonly layer = EffectPgDrizzleClient.layerWithoutDependencies.pipe(
    Layer.provide(PgClient.layerConfig(databaseConfig)),
  );
}

export class BunSqlError extends Schema.TaggedError<BunSqlError>()("BunSqlError", {
  cause: Schema.Defect(),
}) {}

export class PersistenceError extends Schema.TaggedError<PersistenceError>()("PersistenceError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export class BunSqlDrizzleClient extends Context.Service<
  BunSqlDrizzleClient,
  ReturnType<typeof drizzle>
>()("effect-app/db/BunSqlDrizzleClient") {
  static readonly make = Effect.gen(function* () {
    const config = yield* databaseConfig;

    const sql = yield* Effect.acquireRelease(
      Effect.try({
        try: () => new SQL(Redacted.value(config.url)),
        catch: (cause) => new BunSqlError({ cause }),
      }),
      (sql) => Effect.promise(() => sql.close()),
    );

    return drizzle({ client: sql });
  });
  static readonly layer = Layer.effect(BunSqlDrizzleClient, BunSqlDrizzleClient.make);
}
