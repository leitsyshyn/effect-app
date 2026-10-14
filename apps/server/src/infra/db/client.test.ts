import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Context, Effect, Layer } from "effect";
import { BunSqlDrizzleClient } from "./client";

describe("BunSqlDrizzleClient", () => {
  it.effect("closes the native SQL client when its layer scope ends", () =>
    Effect.gen(function* () {
      const db = yield* Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(BunSqlDrizzleClient.layer);
          return Context.get(context, BunSqlDrizzleClient);
        }),
      );

      const error = yield* Effect.tryPromise(() => db.$client`SELECT 1`).pipe(Effect.flip);

      expect(error.cause).toMatchObject({ code: "ERR_POSTGRES_CONNECTION_CLOSED" });
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            DATABASE_URL: "postgresql://postgres:postgres@localhost:1/effect_app",
          }),
        ),
      ),
    ),
  );
});
