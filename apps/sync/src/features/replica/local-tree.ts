import {
  Array,
  Context,
  Crypto,
  DateTime,
  Effect,
  Equal,
  FileSystem,
  Layer,
  Option,
  Path,
  Stream,
} from "effect";
import type { PlatformError } from "effect/PlatformError";
import type { ContentHash, NodeKind } from "@effect-app/domain/drive";
import { LocalChanged, LocalIoFailed, RemoteOutdated } from "../../domain/failures";
import type { FolderUnavailable } from "../../domain/failures";
import {
  basename,
  CONTROL_DIRECTORY,
  fromSegments,
  isIgnored,
  isIgnoredName,
  segments,
} from "../../domain/path";
import type { RelativePath } from "../../domain/path";
import { sha256 } from "../../infra/sha256";
import { checkMarker } from "./folder-marker";

export interface LocalStat {
  readonly kind: NodeKind;
  readonly size: number;
  readonly mtimeMs: number;
  readonly empty: boolean;
  readonly fileId: Option.Option<string>;
}

const fileIdOf = (info: FileSystem.File.Info) =>
  Option.map(info.ino, (ino) => `${info.dev}:${ino}`);

const QUIET_PERIOD = "100 millis";
const MAX_BATCH = 1024;

interface LocalTreeInterface {
  readonly root: string;
  readonly absolute: (path: RelativePath) => string;
  readonly health: Effect.Effect<void, FolderUnavailable>;
  readonly stat: (path: RelativePath) => Effect.Effect<Option.Option<LocalStat>, LocalIoFailed>;
  readonly hash: (path: RelativePath) => Effect.Effect<ContentHash, LocalIoFailed>;
  readonly scan: (
    folder: Option.Option<RelativePath>,
  ) => Effect.Effect<ReadonlyArray<RelativePath>, LocalIoFailed>;
  readonly changes: Stream.Stream<ReadonlyArray<RelativePath>, LocalIoFailed>;
  readonly writeFile: <E, X>(
    path: RelativePath,
    content: Stream.Stream<Uint8Array, E>,
    options: { readonly expectedHash: ContentHash; readonly unchanged: Effect.Effect<boolean, X> },
  ) => Effect.Effect<void, E | X | LocalIoFailed | LocalChanged | RemoteOutdated>;
  readonly makeFolder: (path: RelativePath) => Effect.Effect<void, LocalIoFailed>;
  readonly trash: (path: RelativePath) => Effect.Effect<void, LocalIoFailed>;
  readonly rename: (from: RelativePath, to: RelativePath) => Effect.Effect<void, LocalIoFailed>;
  readonly move: (from: RelativePath, to: RelativePath) => Effect.Effect<boolean, LocalIoFailed>;
  readonly sweepTemporary: Effect.Effect<void, LocalIoFailed>;
}

export class LocalTree extends Context.Service<LocalTree, LocalTreeInterface>()(
  "effect-app/sync/LocalTree",
) {
  static readonly make = (options: { readonly root: string; readonly linkId: string }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const crypto = yield* Crypto.Crypto;
      const { root } = options;
      const context = yield* Effect.context<FileSystem.FileSystem | Path.Path>();

      const control = path.join(root, CONTROL_DIRECTORY);
      const absolute = (relative: RelativePath) => path.join(root, ...segments(relative));
      const ioFailed = (operation: string, target: string) =>
        Effect.mapError(
          (cause: PlatformError) => new LocalIoFailed({ operation, path: target, cause }),
        );
      const statOrNone = (file: string) =>
        fs.stat(file).pipe(
          Effect.asSome,
          Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone),
        );
      const visibleChildren = (directory: string) =>
        Effect.map(
          fs.readDirectory(directory),
          Array.filter((name) => !isIgnoredName(name)),
        );
      const toRelative = (file: string) =>
        fromSegments(
          path.relative(root, path.isAbsolute(file) ? file : path.join(root, file)).split(path.sep),
        );
      const uuid = Effect.orDie(crypto.randomUUIDv4);

      const existsWithExactName = (relative: RelativePath) =>
        Effect.map(fs.readDirectory(path.dirname(absolute(relative))), (names) =>
          names.some((name) => name.normalize("NFC") === basename(relative)),
        );

      const stat = (relative: RelativePath) =>
        Effect.gen(function* () {
          const info = yield* statOrNone(absolute(relative));
          if (
            Option.isNone(info) ||
            (info.value.type !== "File" && info.value.type !== "Directory") ||
            !(yield* existsWithExactName(relative))
          ) {
            return Option.none<LocalStat>();
          }
          const mtimeMs = Option.match(info.value.mtime, {
            onNone: () => 0,
            onSome: (date) => date.getTime(),
          });
          const fileId = fileIdOf(info.value);
          return Option.some<LocalStat>(
            info.value.type === "Directory"
              ? {
                  kind: "folder",
                  size: 0,
                  mtimeMs,
                  empty: (yield* visibleChildren(absolute(relative))).length === 0,
                  fileId,
                }
              : { kind: "file", size: Number(info.value.size), mtimeMs, empty: true, fileId },
          );
        }).pipe(ioFailed("stat", absolute(relative)));

      const hash = (relative: RelativePath) =>
        Stream.run(fs.stream(absolute(relative)), sha256).pipe(
          ioFailed("hash", absolute(relative)),
        );

      const visit = (
        directory: string,
      ): Effect.Effect<ReadonlyArray<RelativePath>, PlatformError> =>
        Effect.gen(function* () {
          const entries = yield* Effect.forEach(yield* visibleChildren(directory), (name) =>
            Effect.gen(function* () {
              const full = path.join(directory, name);
              const relative = toRelative(full);
              const info = yield* statOrNone(full);
              if (Option.isNone(relative) || Option.isNone(info)) return [];
              if (info.value.type === "Directory") return [relative.value, ...(yield* visit(full))];
              return info.value.type === "File" ? [relative.value] : [];
            }),
          );
          return entries.flat();
        });

      const scan = (folder: Option.Option<RelativePath>) =>
        Effect.gen(function* () {
          const start = Option.match(folder, { onNone: () => root, onSome: absolute });
          const info = yield* statOrNone(start);
          return Option.isSome(info) && info.value.type === "Directory" ? yield* visit(start) : [];
        }).pipe(ioFailed("scan", root));

      const changes = fs.watch(root, { recursive: true }).pipe(
        Stream.map((event) => toRelative(event.path)),
        Stream.filter(Option.isSome),
        Stream.map((relative) => relative.value),
        Stream.filter((relative) => !isIgnored(relative)),
        Stream.groupedWithin(MAX_BATCH, QUIET_PERIOD),
        Stream.mapEffect((batch) =>
          Effect.map(
            Effect.forEach(Array.dedupe(batch), (relative) =>
              Effect.zip(
                fs.exists(absolute(relative)),
                Effect.map(scan(Option.some(relative)), (inside) => [relative, ...inside]),
              ),
            ),
            (expanded) =>
              Array.dedupe([
                ...expanded.filter(([exists]) => exists).flatMap(([, paths]) => paths),
                ...expanded.filter(([exists]) => !exists).flatMap(([, paths]) => paths),
              ]),
          ),
        ),
        Stream.mapError((cause) =>
          cause._tag === "LocalIoFailed"
            ? cause
            : new LocalIoFailed({ operation: "watch", path: root, cause }),
        ),
      );

      const writeFile = <E, X>(
        relative: RelativePath,
        content: Stream.Stream<Uint8Array, E>,
        writeOptions: {
          readonly expectedHash: ContentHash;
          readonly unchanged: Effect.Effect<boolean, X>;
        },
      ) =>
        Effect.gen(function* () {
          const target = absolute(relative);
          const temporary = path.join(control, "tmp", `${yield* uuid}.partial`);
          const written = Effect.gen(function* () {
            yield* fs
              .makeDirectory(path.dirname(temporary), { recursive: true })
              .pipe(ioFailed("writeFile", temporary));
            yield* Stream.run(content, fs.sink(temporary)).pipe(
              Effect.catchTag("PlatformError", (cause) =>
                Effect.fail(new LocalIoFailed({ operation: "writeFile", path: temporary, cause })),
              ),
            );
            const actual = yield* Stream.run(fs.stream(temporary), sha256).pipe(
              ioFailed("writeFile", temporary),
            );
            if (actual !== writeOptions.expectedHash) {
              return yield* new RemoteOutdated({
                reason: `${relative} changed remotely while downloading`,
              });
            }
            if (!(yield* writeOptions.unchanged))
              return yield* new LocalChanged({ path: relative });
            yield* fs
              .makeDirectory(path.dirname(target), { recursive: true })
              .pipe(ioFailed("writeFile", target));
            yield* fs.rename(temporary, target).pipe(ioFailed("writeFile", target));
          });
          yield* written.pipe(
            Effect.onError(() => fs.remove(temporary, { force: true }).pipe(Effect.ignore)),
          );
        });

      const move = (from: RelativePath, to: RelativePath) =>
        Effect.gen(function* () {
          const source = yield* statOrNone(absolute(from));
          const target = yield* statOrNone(absolute(to));
          if (
            Option.isSome(target) &&
            !Option.exists(source, (info) => {
              const id = fileIdOf(info);
              return Option.isSome(id) && Equal.equals(id, fileIdOf(target.value));
            })
          ) {
            return false;
          }
          yield* fs.makeDirectory(path.dirname(absolute(to)), { recursive: true });
          yield* fs.rename(absolute(from), absolute(to));
          return true;
        }).pipe(ioFailed("move", absolute(from)));

      const trash = (relative: RelativePath) =>
        Effect.gen(function* () {
          const stamp = DateTime.formatIso(yield* DateTime.now).replaceAll(/[:.]/g, "-");
          const bin = path.join(control, "trash", `${stamp}-${(yield* uuid).slice(0, 8)}`);
          yield* fs.makeDirectory(bin, { recursive: true });
          yield* fs.rename(absolute(relative), path.join(bin, path.basename(absolute(relative))));
        }).pipe(ioFailed("trash", absolute(relative)));

      return LocalTree.of({
        root,
        absolute,
        health: checkMarker(root, options.linkId).pipe(Effect.provide(context)),
        stat,
        hash,
        scan,
        changes,
        writeFile,
        makeFolder: (relative) =>
          fs
            .makeDirectory(absolute(relative), { recursive: true })
            .pipe(ioFailed("makeFolder", absolute(relative))),
        trash,
        rename: (from, to) =>
          fs.rename(absolute(from), absolute(to)).pipe(ioFailed("rename", absolute(from))),
        move,
        sweepTemporary: fs
          .remove(path.join(control, "tmp"), { recursive: true, force: true })
          .pipe(ioFailed("sweepTemporary", path.join(control, "tmp"))),
      });
    });

  static readonly layer = (options: { readonly root: string; readonly linkId: string }) =>
    Layer.effect(LocalTree, LocalTree.make(options));
}
