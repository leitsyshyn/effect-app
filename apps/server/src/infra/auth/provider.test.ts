import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, DateTime, Effect, Layer, Option, Redacted, Schema } from "effect";
import { AuthProvider, PrincipalFromBetterAuth } from "./provider";

const betterAuthSession = {
  session: {
    id: "session-1",
    userId: "user-1",
    token: "session-token",
    expiresAt: new Date("2026-02-01T00:00:00.000Z"),
    ipAddress: "127.0.0.1",
    userAgent: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  user: {
    id: "user-1",
    name: "John",
    email: "john@example.com",
    emailVerified: false,
    image: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  },
};

describe("PrincipalFromBetterAuth", () => {
  it.effect("translates a Better Auth session into a domain principal", () =>
    Effect.gen(function* () {
      const { session, user } =
        yield* Schema.decodeEffect(PrincipalFromBetterAuth)(betterAuthSession);
      const { token, ...sessionWithoutToken } = session;

      expect(Redacted.value(token)).toBe("session-token");
      expect(sessionWithoutToken).toEqual({
        id: "session-1",
        userId: "user-1",
        expiresAt: DateTime.makeUnsafe("2026-02-01T00:00:00.000Z"),
        ipAddress: Option.some("127.0.0.1"),
        userAgent: Option.none(),
        createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
        updatedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
      });
      expect(user).toEqual({
        id: "user-1",
        name: "John",
        email: "john@example.com",
        emailVerified: false,
        image: Option.none(),
        createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
        updatedAt: DateTime.makeUnsafe("2026-01-02T00:00:00.000Z"),
      });
    }),
  );

  it.effect("rejects a Better Auth user that is invalid in the domain", () =>
    Effect.gen(function* () {
      const error = yield* Schema.decodeEffect(PrincipalFromBetterAuth)({
        ...betterAuthSession,
        user: { ...betterAuthSession.user, email: "not-an-email" },
      }).pipe(Effect.flip);

      expect(error._tag).toBe("SchemaError");
    }),
  );
});

describe("AuthProvider.layer", () => {
  it.effect.each([
    { setting: "DATABASE_URL", value: "" },
    { setting: "BETTER_AUTH_URL", value: "not-a-url" },
    { setting: "BETTER_AUTH_URL", value: "ftp://localhost" },
    { setting: "BETTER_AUTH_SECRET", value: "" },
    { setting: "BETTER_AUTH_SECRET", value: "   " },
    { setting: "BETTER_AUTH_SECRET", value: undefined },
  ])("rejects invalid $setting at startup ($value)", ({ setting, value }) =>
    Effect.gen(function* () {
      const error = yield* Layer.build(AuthProvider.layer).pipe(Effect.flip);

      expect(error._tag).toBe("ConfigError");
      expect(String(error)).toContain(setting);
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/effect_app",
            BETTER_AUTH_URL: "http://localhost:3000",
            BETTER_AUTH_SECRET: "test-only-secret-for-configuration",
            [setting]: value,
          }),
        ),
      ),
    ),
  );
});
