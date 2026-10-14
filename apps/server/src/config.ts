import { Config } from "effect";
import type { Duration } from "effect";
import { MAX_UPLOAD_BYTES } from "@effect-app/api/drive/api";

const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export const serverConfig = Config.all({
  port: Config.Port("PORT").pipe(Config.withDefault(3000)),
  maxRequestBodySize: Config.succeed(MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES),
  gracefulShutdownTimeout: Config.succeed<Duration.Input>("2 seconds"),
});
