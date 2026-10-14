import { Array, DateTime, Effect, Layer, Option, Ref } from "effect";
import type { DriveNode, NodeId } from "@effect-app/domain/drive";
import { Revision } from "@effect-app/domain/drive";
import type { UserId } from "@effect-app/domain/user";
import { describeContent } from "../features/drive/content-types";
import { DriveRepository } from "../features/drive/repository";
import type { NodeRecord } from "../features/drive/repository";

interface StoredNode {
  readonly ownerId: UserId;
  readonly record: NodeRecord;
}

export const makeMemoryDriveRepository = (userNames: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const nodes = yield* Ref.make(new Map<NodeId, StoredNode>());
    const seq = yield* Ref.make(0);

    const userRef = (id: UserId) => ({ id, name: userNames[id] ?? id });
    const nextSeq = Ref.updateAndGet(seq, (n) => n + 1);
    const all = Effect.map(Ref.get(nodes), (map) => [...map.values()]);
    const isLive = (stored: StoredNode) => Option.isNone(stored.record.node.deletedAt);
    const sameParent = (a: Option.Option<NodeId>, b: Option.Option<NodeId>) =>
      Option.getOrNull(a) === Option.getOrNull(b);
    const save = (stored: StoredNode) =>
      Ref.update(nodes, (map) => new Map(map).set(stored.record.node.id, stored));
    const liveOf = (ownerId: UserId) =>
      Effect.map(all, (stored) => stored.filter((s) => s.ownerId === ownerId && isLive(s)));

    const findLive = (ownerId: UserId, id: NodeId) =>
      Effect.map(liveOf(ownerId), (live) =>
        Option.map(
          Array.findFirst(live, (s) => s.record.node.id === id),
          (s) => s.record,
        ),
      );

    const pathTo = (ownerId: UserId, id: NodeId) =>
      Effect.gen(function* () {
        const path: Array<NodeRecord> = [];
        let current = yield* findLive(ownerId, id);
        while (Option.isSome(current)) {
          path.unshift(current.value);
          const parent = current.value.node.parentId;
          current = Option.isSome(parent) ? yield* findLive(ownerId, parent.value) : Option.none();
        }
        return path;
      });

    const touch = (record: NodeRecord, actor: UserId, changes: Partial<DriveNode>) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const node = { ...record.node, ...changes };
        return {
          ...record,
          node: {
            ...node,
            ...describeContent(node),
            revision: Revision.make(record.node.revision + 1),
            updatedAt: now,
            updatedBy: userRef(actor),
          },
          changeSeq: yield* nextSeq,
        };
      });

    return DriveRepository.of({
      transact: (_ownerId, effect) => effect,
      findLive,
      findLiveChild: (ownerId, parentId, name) =>
        Effect.map(liveOf(ownerId), (live) =>
          Option.map(
            Array.findFirst(
              live,
              (s) =>
                sameParent(s.record.node.parentId, parentId) &&
                s.record.node.name.toLowerCase() === name.toLowerCase(),
            ),
            (s) => s.record,
          ),
        ),
      listLiveChildren: (ownerId, parentId) =>
        Effect.map(liveOf(ownerId), (live) =>
          live.filter((s) => sameParent(s.record.node.parentId, parentId)).map((s) => s.record),
        ),
      pathTo,
      insert: (input) =>
        Effect.gen(function* () {
          const now = yield* DateTime.now;
          const record: NodeRecord = {
            node: {
              id: input.id,
              parentId: input.parentId,
              name: input.name,
              kind: input.kind,
              size: input.size,
              contentHash: input.contentHash,
              contentType: input.contentType,
              ...describeContent(input),
              revision: Revision.make(1),
              createdAt: now,
              createdBy: userRef(input.actor),
              updatedAt: now,
              updatedBy: userRef(input.actor),
              deletedAt: Option.none(),
            },
            blobKey: input.blobKey,
            changeSeq: yield* nextSeq,
          };
          yield* save({ ownerId: input.ownerId, record });
          return record;
        }),
      update: (ownerId, id, patch) =>
        Effect.gen(function* () {
          const current = Option.getOrThrow(yield* findLive(ownerId, id));
          const record = yield* touch(current, patch.actor, {
            ...(patch.name === undefined ? {} : { name: patch.name }),
            ...(patch.parentId === undefined ? {} : { parentId: patch.parentId }),
            ...(patch.content === undefined
              ? {}
              : {
                  size: patch.content.size,
                  contentHash: Option.some(patch.content.contentHash),
                  contentType: Option.some(patch.content.contentType),
                }),
          });
          const withBlob =
            patch.content === undefined
              ? record
              : { ...record, blobKey: Option.some(patch.content.blobKey) };
          yield* save({ ownerId, record: withBlob });
          return withBlob;
        }),
      deleteSubtree: (ownerId, id, actor) =>
        Effect.gen(function* () {
          const live = yield* liveOf(ownerId);
          const doomed = new Set<NodeId>([id]);
          let grew = true;
          while (grew) {
            grew = false;
            for (const s of live) {
              const parent = Option.getOrNull(s.record.node.parentId);
              if (parent !== null && doomed.has(parent) && !doomed.has(s.record.node.id)) {
                doomed.add(s.record.node.id);
                grew = true;
              }
            }
          }
          const now = yield* DateTime.now;
          const blobKeys: Array<string> = [];
          let lastSeq = 0;
          for (const s of live.filter((s) => doomed.has(s.record.node.id))) {
            const record = yield* touch(s.record, actor, { deletedAt: Option.some(now) });
            yield* save({ ownerId, record });
            if (Option.isSome(s.record.blobKey)) blobKeys.push(s.record.blobKey.value);
            lastSeq = Math.max(lastSeq, record.changeSeq);
          }
          return { blobKeys, lastSeq };
        }),
      listChanges: (ownerId, afterSeq, limit) =>
        Effect.map(all, (stored) => {
          const records = stored
            .filter((s) => s.ownerId === ownerId && s.record.changeSeq > afterSeq)
            .map((s) => s.record)
            .sort((a, b) => a.changeSeq - b.changeSeq)
            .slice(0, limit);
          return { records, lastSeq: records.at(-1)?.changeSeq ?? afterSeq };
        }),
      headSeq: (ownerId) =>
        Effect.map(all, (stored) =>
          Math.max(
            0,
            ...stored.filter((s) => s.ownerId === ownerId).map((s) => s.record.changeSeq),
          ),
        ),
    });
  });

export const memoryDriveRepositoryLayer = (userNames: Readonly<Record<string, string>>) =>
  Layer.effect(DriveRepository, makeMemoryDriveRepository(userNames));
