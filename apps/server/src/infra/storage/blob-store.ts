import { S3Client } from "bun";
import {
  Context,
  Effect,
  Exit,
  HashMap,
  Layer,
  Option,
  Redacted,
  Ref,
  Schema,
  Sink,
  Stream,
} from "effect";
import { ContentHash } from "@effect-app/domain/drive";
import { storageConfig } from "./config";

export class BlobStoreError extends Schema.TaggedError<BlobStoreError>()("BlobStoreError", {
  operation: Schema.String,
  key: Schema.String,
  cause: Schema.Defect(),
}) {}

export interface StoredBlob {
  readonly size: number;
  readonly contentHash: ContentHash;
}

interface BlobStoreInterface {
  readonly put: <E>(
    key: string,
    content: Stream.Stream<Uint8Array, E>,
    options: { readonly contentType: string },
  ) => Effect.Effect<StoredBlob, BlobStoreError | E>;
  readonly get: (key: string) => Stream.Stream<Uint8Array, BlobStoreError>;
  readonly delete: (key: string) => Effect.Effect<void, BlobStoreError>;
}

const PART_SIZE = 8 * 1024 * 1024;

const measure: Sink.Sink<StoredBlob, Uint8Array> = Sink.reduce(
  () => ({ hasher: new Bun.CryptoHasher("sha256"), size: 0 }),
  (state, chunk: Uint8Array) => ({
    hasher: state.hasher.update(chunk),
    size: state.size + chunk.byteLength,
  }),
).pipe(
  Sink.map((state) => ({
    size: state.size,
    contentHash: ContentHash.make(state.hasher.digest("hex")),
  })),
);

export class BlobStore extends Context.Service<BlobStore, BlobStoreInterface>()(
  "effect-app/storage/BlobStore",
) {
  static readonly makeS3 = Effect.gen(function* () {
    const config = yield* storageConfig;
    const client = new S3Client({
      endpoint: config.endpoint.href,
      bucket: config.bucket,
      region: config.region,
      accessKeyId: Redacted.value(config.accessKeyId),
      secretAccessKey: Redacted.value(config.secretAccessKey),
    });

    const attempt =
      (operation: string, key: string) =>
      <A>(run: () => Promise<A> | A) =>
        Effect.tryPromise({
          try: async () => run(),
          catch: (cause) => new BlobStoreError({ operation, key, cause }),
        });

    const remove = Effect.fn("BlobStore.delete")(function* (key: string) {
      yield* attempt("delete", key)(() => client.delete(key));
    });

    const put = Effect.fn("BlobStore.put")(function* <E>(
      key: string,
      content: Stream.Stream<Uint8Array, E>,
      options: { readonly contentType: string },
    ) {
      const write = attempt("put", key);
      const writer = yield* Effect.acquireRelease(
        Effect.sync(() =>
          client
            .file(key, { type: options.contentType })
            .writer({ partSize: PART_SIZE, queueSize: 4 }),
        ),
        (_, exit) => (Exit.isFailure(exit) ? remove(key).pipe(Effect.ignore) : Effect.void),
      );
      const stored = yield* content.pipe(
        Stream.tap((chunk) => write(() => writer.write(chunk))),
        Stream.run(measure),
      );
      yield* write(() => writer.end());
      return stored;
    }, Effect.scoped);

    const get = (key: string) =>
      Stream.fromReadableStream({
        evaluate: () => client.file(key).stream(),
        onError: (cause) => new BlobStoreError({ operation: "get", key, cause }),
      });

    return BlobStore.of({ put, get, delete: remove });
  });

  static readonly layer = Layer.effect(BlobStore, BlobStore.makeS3);

  static readonly layerMemory = Layer.effect(
    BlobStore,
    Effect.gen(function* () {
      const blobs = yield* Ref.make(HashMap.empty<string, Uint8Array>());

      const put = <E>(key: string, content: Stream.Stream<Uint8Array, E>) =>
        Effect.gen(function* () {
          const chunks = yield* Stream.runCollect(content);
          const bytes: Uint8Array = Buffer.concat([...chunks]);
          const stored = yield* Stream.run(Stream.make(bytes), measure);
          yield* Ref.update(blobs, (map) => HashMap.set(map, key, bytes));
          return stored;
        });

      const get = (key: string) =>
        Stream.unwrap(
          Effect.map(Ref.get(blobs), (map) =>
            Option.match(HashMap.get(map, key), {
              onNone: () =>
                Stream.fail(new BlobStoreError({ operation: "get", key, cause: "missing" })),
              onSome: (bytes) => Stream.make(bytes),
            }),
          ),
        );

      const remove = (key: string) => Ref.update(blobs, (map) => HashMap.remove(map, key));

      return BlobStore.of({ put, get, delete: remove });
    }),
  );
}
