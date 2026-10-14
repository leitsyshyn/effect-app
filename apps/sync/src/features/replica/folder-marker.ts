import { Effect, FileSystem, Path, Schema } from "effect";
import { FolderUnavailable, LocalIoFailed } from "../../domain/failures";
import { CONTROL_DIRECTORY } from "../../domain/path";

const Marker = Schema.fromJsonString(Schema.Struct({ linkId: Schema.String }));

const markerFile = (root: string) =>
  Effect.map(Effect.service(Path.Path), (path) => path.join(root, CONTROL_DIRECTORY, "link.json"));

export const writeMarker = (root: string, linkId: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = yield* markerFile(root);
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* fs.writeFileString(file, yield* Schema.encodeEffect(Marker)({ linkId }));
  }).pipe(
    Effect.mapError((cause) => new LocalIoFailed({ operation: "writeMarker", path: root, cause })),
    Effect.withSpan("FolderMarker.write"),
  );

export const removeMarker = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(yield* markerFile(root), { force: true });
  }).pipe(Effect.ignore);

export const checkMarker = (root: string, linkId: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const info = yield* fs.stat(root);
    if (info.type !== "Directory")
      return yield* new FolderUnavailable({ reason: `${root} is not a folder` });
    const marker = yield* fs
      .readFileString(yield* markerFile(root))
      .pipe(Effect.flatMap(Schema.decodeEffect(Marker)));
    if (marker.linkId !== linkId) {
      return yield* new FolderUnavailable({ reason: `${root} is linked to a different drive` });
    }
  }).pipe(
    Effect.catchTags({
      PlatformError: (error) =>
        Effect.fail(new FolderUnavailable({ reason: `${root} is unavailable: ${error.message}` })),
      SchemaError: () =>
        Effect.fail(new FolderUnavailable({ reason: `${root} has an unreadable link marker` })),
    }),
  );
