import { Context, Effect, Layer, Schema } from "effect";
import type { Option } from "effect";
import type { Principal } from "@effect-app/domain/auth";
import { AuthProvider } from "../../infra/auth/provider";

export class AuthenticationError extends Schema.TaggedError<AuthenticationError>()(
  "AuthenticationError",
  {
    cause: Schema.Defect(),
  },
) {}

interface AuthServiceInterface {
  readonly authenticate: (
    headers: Headers,
  ) => Effect.Effect<Option.Option<Principal>, AuthenticationError>;
}

export class AuthService extends Context.Service<AuthService, AuthServiceInterface>()(
  "effect-app/auth/AuthService",
) {
  static readonly make: Effect.Effect<AuthServiceInterface, never, AuthProvider> = Effect.gen(
    function* () {
      const authProvider = yield* AuthProvider;

      const authenticate = Effect.fn("AuthService.authenticate")(
        function* (headers: Headers) {
          return yield* authProvider.getSession(headers);
        },
        Effect.mapError((cause) => new AuthenticationError({ cause })),
      );

      return AuthService.of({ authenticate });
    },
  );

  static readonly layerWithoutDependencies = Layer.effect(AuthService, AuthService.make);

  static readonly layer = AuthService.layerWithoutDependencies.pipe(
    Layer.provide(AuthProvider.layer),
  );
}
