import { Effect } from "effect";
import { ApiClient } from "@/lib/api/client";

export const getCurrentUser = Effect.gen(function* () {
  const client = yield* ApiClient;
  return yield* client.user.me().pipe(Effect.catchTag("Unauthorized", () => Effect.succeed(null)));
});
