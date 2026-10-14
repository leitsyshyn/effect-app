import { Effect } from "effect";
import { HttpEffect, HttpRouter } from "effect/http";
import { AUTH_BASE_PATH } from "../../infra/auth/config";
import { AuthProvider } from "../../infra/auth/provider";

export const AuthRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const authProvider = yield* AuthProvider;
    yield* router.add("*", `${AUTH_BASE_PATH}/*`, HttpEffect.fromWebHandler(authProvider.handler));
  }),
);
