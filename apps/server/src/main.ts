import { BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";
import { ServerLayer } from "./server";

if (import.meta.main) {
  Layer.launch(ServerLayer).pipe(BunRuntime.runMain);
}
