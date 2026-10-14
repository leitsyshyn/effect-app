import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "@effect-app/api/api";
import { CurrentPrincipal } from "@effect-app/api/auth/middleware";

export const UserHandlers = HttpApiBuilder.group(Api, "user", (handlers) =>
  handlers.handle("me", () =>
    Effect.map(Effect.service(CurrentPrincipal), (principal) => principal.user),
  ),
);
