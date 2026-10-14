import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { openAPI } from "better-auth/plugins";
import { bearer } from "better-auth/plugins/bearer";
import type { Config } from "effect";
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Session } from "@effect-app/domain/auth";
import type { Principal } from "@effect-app/domain/auth";
import { User } from "@effect-app/domain/user";
import { BunSqlDrizzleClient } from "../db/client";
import { account, session, user, verification } from "../db/schema";
import { AUTH_BASE_PATH, authConfig } from "./config";

export const PrincipalFromBetterAuth = Schema.Struct({
  session: Session.pipe(
    Schema.fieldsAssign({
      token: Schema.RedactedFromValue(Schema.NonEmptyString),
      expiresAt: Schema.DateTimeUtcFromDate,
      ipAddress: Schema.OptionFromNullishOr(Schema.String),
      userAgent: Schema.OptionFromNullishOr(Schema.String),
      createdAt: Schema.DateTimeUtcFromDate,
      updatedAt: Schema.DateTimeUtcFromDate,
    }),
  ),
  user: User.pipe(
    Schema.fieldsAssign({
      image: Schema.OptionFromNullishOr(Schema.String),
      createdAt: Schema.DateTimeUtcFromDate,
      updatedAt: Schema.DateTimeUtcFromDate,
    }),
  ),
});

export class AuthProviderError extends Schema.TaggedError<AuthProviderError>()(
  "AuthProviderError",
  {
    cause: Schema.Defect(),
  },
) {}

export class AuthProviderInitializationError extends Schema.TaggedError<AuthProviderInitializationError>()(
  "AuthProviderInitializationError",
  {
    cause: Schema.Defect(),
  },
) {}

interface AuthProviderInterface {
  readonly handler: (request: Request) => Promise<Response>;
  readonly getSession: (
    headers: Headers,
  ) => Effect.Effect<Option.Option<Principal>, AuthProviderError>;
}

export class AuthProvider extends Context.Service<AuthProvider, AuthProviderInterface>()(
  "effect-app/infra/AuthProvider",
) {
  static readonly make: Effect.Effect<
    AuthProviderInterface,
    Config.ConfigError | AuthProviderInitializationError,
    BunSqlDrizzleClient
  > = Effect.gen(function* () {
    const config = yield* authConfig;
    const db = yield* BunSqlDrizzleClient;
    const auth = yield* Effect.tryPromise({
      try: async () => {
        const auth = betterAuth({
          basePath: AUTH_BASE_PATH,
          baseURL: config.baseURL.href,
          secret: Redacted.value(config.secret),
          trustedOrigins: [...config.trustedOrigins],
          database: drizzleAdapter(db, {
            provider: "pg",
            schema: { user, session, account, verification },
          }),
          emailAndPassword: { enabled: true },
          plugins: [bearer(), openAPI({ disableDefaultReference: true })],
        });
        await auth.$context;
        return auth;
      },
      catch: (cause) => new AuthProviderInitializationError({ cause }),
    }).pipe(Effect.withSpan("AuthProvider.initialize"));

    const getSession = Effect.fn("AuthProvider.getSession")(
      function* (headers: Headers) {
        const session = yield* Effect.tryPromise(() => auth.api.getSession({ headers }));
        return yield* Schema.decodeUnknownEffect(Schema.OptionFromNullOr(PrincipalFromBetterAuth))(
          session,
        );
      },
      Effect.mapError((cause) => new AuthProviderError({ cause })),
    );

    return AuthProvider.of({
      handler: auth.handler,
      getSession,
    });
  });

  static readonly layerWithoutDependencies = Layer.effect(AuthProvider, AuthProvider.make);

  static readonly layer = AuthProvider.layerWithoutDependencies.pipe(
    Layer.provide(BunSqlDrizzleClient.layer),
  );
}
