import { BunCrypto } from "@effect/platform-bun";
import { Context, Crypto, Effect, Layer, Option, Ref, Schedule, Stream } from "effect";
import {
  ChangeCursor,
  InvalidMove,
  NameConflict,
  NodeId,
  NodeNotFound,
  NotAFile,
  ParentNotFolder,
  RevisionMismatch,
} from "@effect-app/domain/drive";
import type { DriveNode, NodeName, Revision } from "@effect-app/domain/drive";
import { applyListing, typeCounts } from "@effect-app/domain/listing";
import type { ListingFilter, ListingSort, TypeCount } from "@effect-app/domain/listing";
import type { User } from "@effect-app/domain/user";
import type { PersistenceError } from "../../infra/db/client";
import { BlobStore } from "../../infra/storage/blob-store";
import type { BlobStoreError } from "../../infra/storage/blob-store";
import { contentTypeOf } from "./content-types";
import { DriveEvents } from "./events";
import { DriveRepository } from "./repository";
import type { NodeRecord } from "./repository";

export interface FolderListing {
  readonly path: ReadonlyArray<DriveNode>;
  readonly nodes: ReadonlyArray<DriveNode>;
  readonly types: ReadonlyArray<TypeCount>;
}

export interface ChangePage {
  readonly nodes: ReadonlyArray<DriveNode>;
  readonly cursor: ChangeCursor;
  readonly hasMore: boolean;
}

export interface UploadInput<E> {
  readonly parentId: Option.Option<NodeId>;
  readonly name: NodeName;
  readonly expectedRevision: Option.Option<Revision>;
  readonly content: Stream.Stream<Uint8Array, E>;
}

export interface UpdateInput {
  readonly name: Option.Option<NodeName>;
  readonly parentId: Option.Option<Option.Option<NodeId>>;
  readonly expectedRevision: Revision;
}

export interface Download {
  readonly node: DriveNode;
  readonly content: Stream.Stream<Uint8Array, BlobStoreError>;
}

type Failure = PersistenceError;

interface DriveServiceInterface {
  readonly listFolder: (
    actor: User,
    options: {
      readonly parentId: Option.Option<NodeId>;
      readonly sort: ListingSort;
      readonly filter: ListingFilter;
    },
  ) => Effect.Effect<FolderListing, NodeNotFound | ParentNotFolder | Failure>;
  readonly getNode: (actor: User, id: NodeId) => Effect.Effect<DriveNode, NodeNotFound | Failure>;
  readonly createFolder: (
    actor: User,
    input: { readonly parentId: Option.Option<NodeId>; readonly name: NodeName },
  ) => Effect.Effect<DriveNode, NodeNotFound | ParentNotFolder | NameConflict | Failure>;
  readonly uploadFile: <E>(
    actor: User,
    input: UploadInput<E>,
  ) => Effect.Effect<
    DriveNode,
    | NodeNotFound
    | ParentNotFolder
    | NameConflict
    | NotAFile
    | RevisionMismatch
    | BlobStoreError
    | Failure
    | E
  >;
  readonly downloadFile: (
    actor: User,
    id: NodeId,
  ) => Effect.Effect<Download, NodeNotFound | NotAFile | Failure>;
  readonly updateNode: (
    actor: User,
    id: NodeId,
    input: UpdateInput,
  ) => Effect.Effect<
    DriveNode,
    NodeNotFound | ParentNotFolder | NameConflict | InvalidMove | RevisionMismatch | Failure
  >;
  readonly deleteNode: (
    actor: User,
    id: NodeId,
    expectedRevision: Option.Option<Revision>,
  ) => Effect.Effect<void, NodeNotFound | RevisionMismatch | Failure>;
  readonly listChanges: (
    actor: User,
    options: { readonly cursor: ChangeCursor; readonly limit: number },
  ) => Effect.Effect<ChangePage, Failure>;
  readonly changeNotifications: (actor: User) => Stream.Stream<ChangeCursor, Failure>;
}

const checkRevision = (record: NodeRecord, expected: Revision) =>
  record.node.revision === expected
    ? Effect.void
    : Effect.fail(
        new RevisionMismatch({ id: record.node.id, expected, actual: record.node.revision }),
      );

export class DriveService extends Context.Service<DriveService, DriveServiceInterface>()(
  "effect-app/drive/DriveService",
) {
  static readonly make = Effect.gen(function* () {
    const repository = yield* DriveRepository;
    const blobs = yield* BlobStore;
    const events = yield* DriveEvents;
    const crypto = yield* Crypto.Crypto;

    const getLive = (actor: User, id: NodeId) =>
      repository.findLive(actor.id, id).pipe(
        Effect.flatMap(Effect.fromOption),
        Effect.catchTag("NoSuchElementError", () => Effect.fail(new NodeNotFound({ id }))),
      );

    const newUuid = Effect.orDie(crypto.randomUUIDv4);
    const newNodeId = Effect.map(newUuid, NodeId.make);

    const requireFolder = (actor: User, parentId: Option.Option<NodeId>) =>
      Option.match(parentId, {
        onNone: () => Effect.void,
        onSome: (id) =>
          getLive(actor, id).pipe(
            Effect.flatMap((parent) =>
              parent.node.kind === "folder"
                ? Effect.void
                : Effect.fail(new ParentNotFolder({ id })),
            ),
          ),
      });

    const requireFreeName = (actor: User, parentId: Option.Option<NodeId>, name: NodeName) =>
      repository
        .findLiveChild(actor.id, parentId, name)
        .pipe(
          Effect.flatMap((existing) =>
            Option.isSome(existing)
              ? Effect.fail(new NameConflict({ parentId, name }))
              : Effect.void,
          ),
        );

    const publish = (actor: User, change: { readonly changeSeq: number }) =>
      events.publish({ ownerId: actor.id, cursor: ChangeCursor.make(String(change.changeSeq)) });

    const deleteBlobQuietly = (key: string) =>
      blobs.delete(key).pipe(
        Effect.tapError((error) => Effect.logWarning("Failed to delete blob", error)),
        Effect.ignore,
      );

    const listFolder = Effect.fn("DriveService.listFolder")(function* (
      actor: User,
      options: { parentId: Option.Option<NodeId>; sort: ListingSort; filter: ListingFilter },
    ) {
      yield* requireFolder(actor, options.parentId);
      const path = yield* Option.match(options.parentId, {
        onNone: () => Effect.succeed([]),
        onSome: (id) => repository.pathTo(actor.id, id),
      });
      const children = (yield* repository.listLiveChildren(actor.id, options.parentId)).map(
        (record) => record.node,
      );
      return {
        path: path.map((record) => record.node),
        nodes: applyListing(children, options),
        types: typeCounts(children, options.filter),
      };
    });

    const getNode = Effect.fn("DriveService.getNode")(function* (actor: User, id: NodeId) {
      return (yield* getLive(actor, id)).node;
    });

    const createFolder = Effect.fn("DriveService.createFolder")(function* (
      actor: User,
      input: { parentId: Option.Option<NodeId>; name: NodeName },
    ) {
      const record = yield* repository.transact(
        actor.id,
        Effect.gen(function* () {
          yield* requireFolder(actor, input.parentId);
          yield* requireFreeName(actor, input.parentId, input.name);
          return yield* repository.insert({
            id: yield* newNodeId,
            ownerId: actor.id,
            parentId: input.parentId,
            name: input.name,
            kind: "folder",
            size: 0,
            contentHash: Option.none(),
            contentType: Option.none(),
            blobKey: Option.none(),
            actor: actor.id,
          });
        }),
      );
      yield* publish(actor, record);
      return record.node;
    });

    const validateUpload = <E>(actor: User, input: UploadInput<E>) =>
      Effect.gen(function* () {
        yield* requireFolder(actor, input.parentId);
        const existing = yield* repository.findLiveChild(actor.id, input.parentId, input.name);
        return yield* Option.match(input.expectedRevision, {
          onNone: () =>
            Option.match(existing, {
              onNone: () => Effect.succeed(Option.none<NodeRecord>()),
              onSome: () =>
                Effect.fail(new NameConflict({ parentId: input.parentId, name: input.name })),
            }),
          onSome: (expected) =>
            Option.match(existing, {
              onNone: () =>
                Effect.fail(new NameConflict({ parentId: input.parentId, name: input.name })),
              onSome: (record) =>
                record.node.kind === "file"
                  ? checkRevision(record, expected).pipe(Effect.as(Option.some(record)))
                  : Effect.fail(new NotAFile({ id: record.node.id })),
            }),
        });
      });

    const uploadFile = Effect.fn("DriveService.uploadFile")(function* <E>(
      actor: User,
      input: UploadInput<E>,
    ) {
      yield* validateUpload(actor, input);

      const blobKey = `users/${actor.id}/${yield* newUuid}`;
      const contentType = contentTypeOf(input.name);
      const stored = yield* blobs.put(blobKey, input.content, { contentType });

      const result = yield* repository
        .transact(
          actor.id,
          Effect.gen(function* () {
            const replaced = yield* validateUpload(actor, input);
            if (Option.isSome(replaced)) {
              const current = replaced.value;
              if (Option.contains(current.node.contentHash, stored.contentHash)) {
                return { record: current, unusedBlob: Option.some(blobKey), changed: false };
              }
              const record = yield* repository.update(actor.id, current.node.id, {
                content: { ...stored, contentType, blobKey },
                actor: actor.id,
              });
              return { record, unusedBlob: current.blobKey, changed: true };
            }
            const record = yield* repository.insert({
              id: yield* newNodeId,
              ownerId: actor.id,
              parentId: input.parentId,
              name: input.name,
              kind: "file",
              size: stored.size,
              contentHash: Option.some(stored.contentHash),
              contentType: Option.some(contentType),
              blobKey: Option.some(blobKey),
              actor: actor.id,
            });
            return { record, unusedBlob: Option.none<string>(), changed: true };
          }),
        )
        .pipe(Effect.onError(() => deleteBlobQuietly(blobKey)));

      if (Option.isSome(result.unusedBlob)) yield* deleteBlobQuietly(result.unusedBlob.value);
      if (result.changed) yield* publish(actor, result.record);
      return result.record.node;
    });

    const downloadFile = Effect.fn("DriveService.downloadFile")(function* (
      actor: User,
      id: NodeId,
    ) {
      const record = yield* getLive(actor, id);
      if (record.node.kind !== "file" || Option.isNone(record.blobKey)) {
        return yield* new NotAFile({ id });
      }
      return { node: record.node, content: blobs.get(record.blobKey.value) };
    });

    const updateNode = Effect.fn("DriveService.updateNode")(function* (
      actor: User,
      id: NodeId,
      input: UpdateInput,
    ) {
      const record = yield* repository.transact(
        actor.id,
        Effect.gen(function* () {
          const current = yield* getLive(actor, id);
          yield* checkRevision(current, input.expectedRevision);

          const parentId = Option.getOrElse(input.parentId, () => current.node.parentId);
          const name = Option.getOrElse(input.name, () => current.node.name);
          const moved = Option.getOrNull(parentId) !== Option.getOrNull(current.node.parentId);

          if (moved) {
            yield* requireFolder(actor, parentId);
            if (Option.isSome(parentId)) {
              const ancestry = yield* repository.pathTo(actor.id, parentId.value);
              if (ancestry.some((ancestor) => ancestor.node.id === id)) {
                return yield* new InvalidMove({ id, reason: "A folder cannot move into itself" });
              }
            }
          }

          const clash = yield* repository.findLiveChild(actor.id, parentId, name);
          if (Option.isSome(clash) && clash.value.node.id !== id) {
            return yield* new NameConflict({ parentId, name });
          }

          return yield* repository.update(actor.id, id, {
            name,
            parentId,
            actor: actor.id,
          });
        }),
      );
      yield* publish(actor, record);
      return record.node;
    });

    const deleteNode = Effect.fn("DriveService.deleteNode")(function* (
      actor: User,
      id: NodeId,
      expectedRevision: Option.Option<Revision>,
    ) {
      const deleted = yield* repository.transact(
        actor.id,
        Effect.gen(function* () {
          const current = yield* getLive(actor, id);
          if (Option.isSome(expectedRevision)) {
            yield* checkRevision(current, expectedRevision.value);
          }
          return yield* repository.deleteSubtree(actor.id, id, actor.id);
        }),
      );
      yield* Effect.forEach(deleted.blobKeys, deleteBlobQuietly, { concurrency: 4, discard: true });
      yield* publish(actor, { changeSeq: deleted.lastSeq });
    });

    const listChanges = Effect.fn("DriveService.listChanges")(function* (
      actor: User,
      options: { cursor: ChangeCursor; limit: number },
    ) {
      const page = yield* repository.listChanges(
        actor.id,
        Number(options.cursor),
        options.limit + 1,
      );
      const records = page.records.slice(0, options.limit);
      const last = records.at(-1);
      return {
        nodes: records.map((record) => record.node),
        cursor: last === undefined ? options.cursor : ChangeCursor.make(String(last.changeSeq)),
        hasMore: page.records.length > options.limit,
      };
    });

    const changeNotifications = (actor: User) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const head = ChangeCursor.make(String(yield* repository.headSeq(actor.id)));
          const latest = yield* Ref.make(head);
          const live = events
            .changes(actor.id)
            .pipe(Stream.tap((cursor) => Ref.set(latest, cursor)));
          const heartbeat = Stream.fromSchedule(Schedule.spaced("3 seconds")).pipe(
            Stream.mapEffect(() =>
              repository.headSeq(actor.id).pipe(
                Effect.map((seq) => ChangeCursor.make(String(seq))),
                Effect.tap((cursor) => Ref.set(latest, cursor)),
                Effect.catch(() => Ref.get(latest)),
              ),
            ),
          );
          return Stream.concat(Stream.make(head), Stream.merge(live, heartbeat));
        }),
      );

    return DriveService.of({
      listFolder,
      getNode,
      createFolder,
      uploadFile,
      downloadFile,
      updateNode,
      deleteNode,
      listChanges,
      changeNotifications,
    });
  });

  static readonly layerWithoutDependencies = Layer.effect(DriveService, DriveService.make);

  static readonly layer = DriveService.layerWithoutDependencies.pipe(
    Layer.provide(DriveRepository.layer),
    Layer.provide(DriveEvents.layer),
    Layer.provide(BlobStore.layer),
    Layer.provide(BunCrypto.layer),
  );
}
