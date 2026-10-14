import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { AuthProvider, AuthProviderError } from "../../infra/auth/provider";
import { makePrincipal } from "../../testing/fixtures";
import { AuthService } from "./service";

const unusedAuthProvider = AuthProvider.of({
  handler: async () => new Response(null, { status: 404 }),
  getSession: () => Effect.succeedNone,
});

const provideAuthService = (authProvider: AuthProvider["Service"]) =>
  Effect.provide(
    AuthService.layerWithoutDependencies.pipe(
      Layer.provide(Layer.succeed(AuthProvider, authProvider)),
    ),
  );

describe("AuthService", () => {
  describe("authenticate", () => {
    it.effect("authenticates the provider's session as the principal", () =>
      Effect.gen(function* () {
        const authService = yield* AuthService;
        const principal = yield* authService.authenticate(new Headers());

        expect(Option.getOrThrow(principal)).toEqual(makePrincipal("user-1", "john@example.com"));
      }).pipe(
        provideAuthService(
          AuthProvider.of({
            ...unusedAuthProvider,
            getSession: () => Effect.succeedSome(makePrincipal("user-1", "john@example.com")),
          }),
        ),
      ),
    );

    it.effect("treats a request without a provider session as anonymous", () =>
      Effect.gen(function* () {
        const authService = yield* AuthService;

        expect(Option.isNone(yield* authService.authenticate(new Headers()))).toBe(true);
      }).pipe(provideAuthService(unusedAuthProvider)),
    );

    it.effect("fails authentication when the provider fails", () =>
      Effect.gen(function* () {
        const authService = yield* AuthService;
        const error = yield* authService.authenticate(new Headers()).pipe(Effect.flip);

        expect(error._tag).toBe("AuthenticationError");
      }).pipe(
        provideAuthService(
          AuthProvider.of({
            ...unusedAuthProvider,
            getSession: () =>
              Effect.fail(new AuthProviderError({ cause: new Error("Provider unavailable") })),
          }),
        ),
      ),
    );
  });
});
