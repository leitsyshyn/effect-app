import { Sink } from "effect";
import { ContentHash } from "@effect-app/domain/drive";

export const sha256: Sink.Sink<ContentHash, Uint8Array> = Sink.reduce(
  () => new Bun.CryptoHasher("sha256"),
  (hasher, chunk: Uint8Array) => hasher.update(chunk),
).pipe(Sink.map((hasher) => ContentHash.make(hasher.digest("hex"))));
