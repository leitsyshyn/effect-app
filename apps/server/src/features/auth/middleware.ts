import { Effect, Layer, Option } from "effect";
import { HttpServerRequest } from "effect/http";
import { HttpApiError } from "effect/http-api";
import { AuthMiddleware, CurrentPrincipal } from "@effect-app/api/auth/middleware";
import { AuthService } from "./service";

export const AuthMiddlewareLayer = Layer.effect(
  AuthMiddleware,
  Effect.gen(function* () {
    const authService = yield* AuthService;
    return AuthMiddleware.of(
      Effect.fn("AuthMiddleware")(function* (httpEffect) {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const principal = yield* authService.authenticate(new Headers(request.headers)).pipe(
          Effect.tapError((error) => Effect.logError("Authentication failed", error)),
          Effect.mapError(() => new HttpApiError.InternalServerError()),
        );
        return yield* Option.match(principal, {
          onNone: () => Effect.fail(new HttpApiError.Unauthorized()),
          onSome: (principal) => Effect.provideService(httpEffect, CurrentPrincipal, principal),
        });
      }),
    );
  }),
);
