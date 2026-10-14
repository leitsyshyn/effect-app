import { timingSafeEqual } from "node:crypto";
import { Crypto, Effect, FileSystem, Layer, Path, Redacted } from "effect";
import { Hex } from "effect/encoding";
import { HttpApiError } from "effect/http-api";
import { ControlAuth } from "./api";

const TOKEN_FILE = "control-token";

export const ensureControlToken = (stateDirectory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const file = path.join(stateDirectory, TOKEN_FILE);
    if (yield* fs.exists(file)) return (yield* fs.readFileString(file)).trim();
    const token = Hex.encode(yield* crypto.randomBytes(32));
    yield* fs.writeFileString(file, token, { mode: 0o600 });
    return token;
  });

const sameToken = (presented: string, expected: string) => {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const controlAuthLayer = (token: string) =>
  Layer.succeed(
    ControlAuth,
    ControlAuth.of({
      bearer: (httpEffect, { credential }) =>
        sameToken(Redacted.value(credential), token)
          ? httpEffect
          : Effect.fail(new HttpApiError.Unauthorized()),
    }),
  );
