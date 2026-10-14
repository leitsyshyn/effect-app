import { Context } from "effect";
import { HttpApiError, HttpApiMiddleware } from "effect/http-api";
import type { Principal } from "@effect-app/domain/auth";

export class CurrentPrincipal extends Context.Service<CurrentPrincipal, Principal>()(
  "effect-app/auth/CurrentPrincipal",
) {}

export class AuthMiddleware extends HttpApiMiddleware.Service<
  AuthMiddleware,
  {
    provides: CurrentPrincipal;
  }
>()("effect-app/auth/AuthMiddleware", {
  error: [HttpApiError.UnauthorizedNoContent, HttpApiError.InternalServerErrorNoContent],
}) {}
