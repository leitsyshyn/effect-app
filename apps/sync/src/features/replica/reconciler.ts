import { Context, DateTime, Effect, Equal, Layer, Option } from "effect";
import { NodeName } from "@effect-app/domain/drive";
import type { DriveNode, NodeId } from "@effect-app/domain/drive";
import { conflictName } from "../../domain/conflict-name";
import { sameContent } from "../../domain/entry";
import type { Content, LocalEntry, RemoteEntry, SyncedEntry } from "../../domain/entry";
import { describeFailure, NotConverging, RemoteOutdated } from "../../domain/failures";
import type { SyncFailure } from "../../domain/failures";
import type { IssueKind } from "../../domain/issue";
import { basename, child, isWithin, parentOf } from "../../domain/path";
import type { RelativePath } from "../../domain/path";
import { plan, Step } from "../../domain/planner";
import { Disposition, recover, Recovery } from "../../domain/recovery";
import { Issues } from "./issues";
import { LocalTree } from "./local-tree";
import { RemoteDrive } from "./remote-drive";
import { RemoteTree } from "./remote-tree";
import { SyncedTree } from "./synced-tree";
import { WorkQueue } from "./work-queue";

const MAX_STEPS = 8;

interface LocalSnapshot extends LocalEntry {
  readonly size: number;
  readonly mtimeMs: number;
  readonly fileId: Option.Option<string>;
}

type Progress = "settled" | "progressed";

interface ReconcilerInterface {
  readonly sync: (
    path: RelativePath,
    attempt: { readonly lastAttempt: boolean },
  ) => Effect.Effect<Disposition>;
}

const synced = (
  path: RelativePath,
  node: Content & Pick<RemoteEntry, "nodeId" | "revision">,
  local: Option.Option<LocalSnapshot>,
): SyncedEntry => ({
  path,
  kind: node.kind,
  contentHash: node.contentHash,
  nodeId: node.nodeId,
  revision: node.revision,
  localSize: Option.match(local, { onNone: () => 0, onSome: (snapshot) => snapshot.size }),
  localMtimeMs: Option.match(local, { onNone: () => 0, onSome: (snapshot) => snapshot.mtimeMs }),
  localFileId: Option.flatMap(local, (snapshot) => snapshot.fileId),
});

const fromNode = (node: DriveNode) => ({
  kind: node.kind,
  contentHash: node.contentHash,
  nodeId: node.id,
  revision: node.revision,
});

const sameLocal = (a: Option.Option<LocalSnapshot>, b: Option.Option<LocalSnapshot>) =>
  Equal.equals(
    Option.map(a, (entry) => [entry.kind, entry.contentHash]),
    Option.map(b, (entry) => [entry.kind, entry.contentHash]),
  );

export class Reconciler extends Context.Service<Reconciler, ReconcilerInterface>()(
  "effect-app/sync/Reconciler",
) {
  static readonly make = (options: { readonly deviceName: string }) =>
    Effect.gen(function* () {
      const syncedTree = yield* SyncedTree;
      const issues = yield* Issues;
      const queue = yield* WorkQueue;
      const local = yield* LocalTree;
      const remote = yield* RemoteTree;
      const drive = yield* RemoteDrive;

      const nameOf = (path: RelativePath) => NodeName.make(basename(path));

      const localEntry = (path: RelativePath, base: Option.Option<SyncedEntry>) =>
        Effect.gen(function* () {
          const stat = yield* local.stat(path);
          if (Option.isNone(stat)) return Option.none<LocalSnapshot>();
          const { kind, size, mtimeMs, empty, fileId } = stat.value;
          if (kind === "folder") {
            return Option.some<LocalSnapshot>({
              kind,
              contentHash: Option.none(),
              empty,
              size,
              mtimeMs,
              fileId,
            });
          }
          const unchanged = Option.filter(
            base,
            (entry) =>
              entry.kind === "file" && entry.localSize === size && entry.localMtimeMs === mtimeMs,
          );
          const contentHash = Option.isSome(unchanged)
            ? unchanged.value.contentHash
            : Option.some(yield* local.hash(path));
          return Option.some<LocalSnapshot>({ kind, contentHash, empty, size, mtimeMs, fileId });
        });

      const report = (path: RelativePath, kind: IssueKind, localCopy?: RelativePath) =>
        issues.report(localCopy === undefined ? { path, kind } : { path, kind, localCopy });

      const scheduleParent = (path: RelativePath) =>
        Option.match(parentOf(path), {
          onNone: () => Effect.void,
          onSome: (parent) => queue.schedule([parent]),
        });

      const ensureRemoteFolder = (
        folder: Option.Option<RelativePath>,
      ): Effect.Effect<Option.Option<NodeId>, SyncFailure> =>
        Effect.gen(function* () {
          if (Option.isNone(folder)) return Option.none();
          const existing = yield* remote.entry(folder.value);
          if (Option.isSome(existing)) {
            return existing.value.kind === "folder"
              ? Option.some(existing.value.nodeId)
              : yield* new RemoteOutdated({ reason: `${folder.value} is a file remotely` });
          }
          const parentId = yield* ensureRemoteFolder(parentOf(folder.value));
          const node = yield* drive.createFolder(parentId, nameOf(folder.value));
          yield* remote.record(node);
          const stat = yield* localEntry(folder.value, Option.none());
          if (Option.isSome(stat) && stat.value.kind === "folder") {
            yield* syncedTree.put(synced(folder.value, fromNode(node), stat));
          }
          return Option.some(node.id);
        });

      const apply = (
        path: RelativePath,
        step: Step,
        base: Option.Option<SyncedEntry>,
        snapshot: Option.Option<LocalSnapshot>,
      ): Effect.Effect<void, SyncFailure> =>
        Step.$match(step, {
          NoOp: () => Effect.void,

          Adopt: ({ remote: node }) => syncedTree.put(synced(path, node, snapshot)),

          ForgetSynced: () => syncedTree.forget(path),

          Upload: ({ replace, issue }) =>
            Effect.gen(function* () {
              const parentId = Option.isSome(replace)
                ? replace.value.parentId
                : yield* ensureRemoteFolder(parentOf(path));
              const node = yield* drive.upload({
                parentId,
                name: nameOf(path),
                expectedRevision: Option.map(replace, (entry) => entry.revision),
                absolutePath: local.absolute(path),
              });
              yield* remote.record(node);
              yield* syncedTree.put(synced(path, fromNode(node), snapshot));
              if (Option.isSome(issue)) yield* report(path, issue.value);
            }),

          CreateRemoteFolder: () =>
            Effect.gen(function* () {
              const parentId = yield* ensureRemoteFolder(parentOf(path));
              const node = yield* drive.createFolder(parentId, nameOf(path));
              yield* remote.record(node);
              yield* syncedTree.put(synced(path, fromNode(node), snapshot));
            }),

          Download: ({ remote: node, issue }) =>
            Effect.gen(function* () {
              if (Option.isNone(node.contentHash)) {
                return yield* new RemoteOutdated({ reason: `${path} has no contents remotely` });
              }
              yield* local.writeFile(path, drive.download(node.nodeId), {
                expectedHash: node.contentHash.value,
                unchanged: Effect.map(localEntry(path, base), (now) => sameLocal(now, snapshot)),
              });
              yield* syncedTree.put(synced(path, node, yield* localEntry(path, Option.none())));
              if (Option.isSome(issue)) yield* report(path, issue.value);
            }),

          CreateLocalFolder: ({ remote: node }) =>
            Effect.gen(function* () {
              yield* local.makeFolder(path);
              yield* syncedTree.put(synced(path, node, yield* localEntry(path, Option.none())));
            }),

          DeleteRemote: ({ remote: node }) =>
            Effect.gen(function* () {
              yield* drive.deleteNode(node.nodeId, node.revision);
              yield* remote.forget(node.nodeId);
              yield* syncedTree.forget(path);
              yield* scheduleParent(path);
            }),

          DeleteLocal: () =>
            Effect.gen(function* () {
              yield* local.trash(path);
              yield* syncedTree.forget(path);
              yield* scheduleParent(path);
            }),

          KeepBoth: ({ reason }) =>
            Effect.gen(function* () {
              const copy = child(
                parentOf(path),
                conflictName(basename(path), yield* DateTime.now, options.deviceName),
              );
              yield* local.rename(path, copy);
              yield* syncedTree.forget(path);
              yield* report(path, reason, copy);
              yield* queue.schedule([copy, ...(yield* local.scan(Option.some(copy)))]);
            }),
        });

      const followRemoteMove = (from: RelativePath): Effect.Effect<boolean, SyncFailure> =>
        Effect.gen(function* () {
          const base = yield* syncedTree.get(from);
          if (Option.isNone(base)) return false;
          const to = yield* remote.pathOf(base.value.nodeId);
          if (Option.isNone(to) || to.value === from) return false;
          const parent = parentOf(from);
          if (Option.isSome(parent) && (yield* followRemoteMove(parent.value))) return true;
          const node = yield* remote.entry(to.value);
          const here = yield* localEntry(from, base);
          if (
            Option.isNone(node) ||
            !Option.exists(here, (entry) => sameContent(entry, base.value)) ||
            isWithin(to.value, from) ||
            Option.isSome(yield* syncedTree.get(to.value)) ||
            !(yield* local.move(from, to.value))
          ) {
            return false;
          }
          yield* Effect.logDebug("sync move", { from, to: to.value, side: "local" });
          yield* syncedTree.move(from, to.value, node.value.revision);
          yield* scheduleParent(from);
          return true;
        });

      const movedLocallyFrom = (to: RelativePath) =>
        Effect.gen(function* () {
          if (Option.isSome(yield* syncedTree.get(to))) return Option.none<SyncedEntry>();
          const fileId = Option.flatMap(yield* local.stat(to), (stat) => stat.fileId);
          if (Option.isNone(fileId)) return Option.none<SyncedEntry>();
          return Option.filter(
            yield* syncedTree.byLocalFileId(fileId.value),
            (entry) => entry.path !== to,
          );
        });

      const pushLocalMove = (to: RelativePath): Effect.Effect<boolean, SyncFailure> =>
        Effect.gen(function* () {
          const base = yield* movedLocallyFrom(to);
          if (Option.isNone(base)) return false;
          const parent = parentOf(to);
          if (Option.isSome(parent) && (yield* pushLocalMove(parent.value))) return true;
          const from = base.value.path;
          const node = yield* remote.entry(from);
          if (
            Option.isNone(node) ||
            node.value.nodeId !== base.value.nodeId ||
            node.value.revision !== base.value.revision ||
            !Option.exists(yield* local.stat(to), (stat) => stat.kind === base.value.kind) ||
            Option.isSome(yield* local.stat(from)) ||
            Option.isSome(yield* remote.entry(to))
          ) {
            return false;
          }
          const parentId = yield* ensureRemoteFolder(parent);
          const moved = yield* drive
            .moveNode({
              id: node.value.nodeId,
              name: basename(to) === basename(from) ? Option.none() : Option.some(nameOf(to)),
              parentId: Equal.equals(parentId, node.value.parentId)
                ? Option.none()
                : Option.some(parentId),
              expectedRevision: node.value.revision,
            })
            .pipe(
              Effect.asSome,
              Effect.catchTag("RemoteOutdated", () =>
                Effect.flatMap(remote.refresh, queue.schedule).pipe(Effect.as(Option.none())),
              ),
            );
          if (Option.isNone(moved)) return false;
          yield* Effect.logDebug("sync move", { from, to, side: "remote" });
          yield* remote.record(moved.value);
          yield* syncedTree.move(from, to, moved.value.revision);
          yield* scheduleParent(from);
          return true;
        });

      const followMove = (
        path: RelativePath,
        base: Option.Option<SyncedEntry>,
        here: Option.Option<LocalSnapshot>,
        there: Option.Option<RemoteEntry>,
      ): Effect.Effect<boolean, SyncFailure> =>
        Effect.gen(function* () {
          if (Option.isSome(base)) {
            const movedAway =
              Option.isSome(here) && !Option.exists(there, (n) => n.nodeId === base.value.nodeId);
            return movedAway && (yield* followRemoteMove(path));
          }
          if (Option.isSome(here)) return yield* pushLocalMove(path);
          if (Option.isNone(there)) return false;
          const before = yield* syncedTree.byNodeId(there.value.nodeId);
          return Option.isSome(before) && (yield* followRemoteMove(before.value.path));
        });

      const step = (path: RelativePath): Effect.Effect<Progress, SyncFailure> =>
        Effect.gen(function* () {
          yield* local.health;
          const base = yield* syncedTree.get(path);
          const snapshot = yield* localEntry(path, base);
          const there = yield* remote.entry(path);
          if (yield* followMove(path, base, snapshot, there)) return "progressed" as const;
          const next = plan({ synced: base, local: snapshot, remote: there });
          if (next._tag === "NoOp") {
            const fileId = Option.flatMap(snapshot, (entry) => entry.fileId);
            if (
              Option.isSome(base) &&
              Option.isSome(fileId) &&
              !Equal.equals(base.value.localFileId, fileId)
            ) {
              yield* syncedTree.put({ ...base.value, localFileId: fileId });
            }
            return "settled" as const;
          }
          yield* Effect.logDebug("sync step", { path, step: next._tag });
          yield* apply(path, next, base, snapshot);
          return "progressed" as const;
        }).pipe(
          Effect.catch((failure) =>
            Recovery.$match(recover(failure), {
              Replan: ({ refreshRemote }) =>
                (refreshRemote ? Effect.flatMap(remote.refresh, queue.schedule) : Effect.void).pipe(
                  Effect.as("progressed" as const),
                ),
              Park: () => Effect.fail(failure),
              Retry: () => Effect.fail(failure),
              Report: () => Effect.fail(failure),
            }),
          ),
        );

      const sync = Effect.fn("Reconciler.sync")(function* (
        path: RelativePath,
        attempt: { readonly lastAttempt: boolean },
      ) {
        const giveUp = (reason: string) =>
          issues.report({ path, kind: "Failed", reason }).pipe(Effect.as(Disposition.Settled()));

        return yield* step(path).pipe(
          Effect.repeat({ until: (progress) => progress === "settled", times: MAX_STEPS }),
          Effect.flatMap((progress) =>
            progress === "settled"
              ? Effect.succeed(Disposition.Settled())
              : Effect.fail(new NotConverging({ path })),
          ),
          Effect.catch((failure: SyncFailure) =>
            Recovery.$match(recover(failure), {
              Park: ({ condition }) =>
                Effect.succeed(Disposition.Parked({ condition, reason: describeFailure(failure) })),
              Retry: () =>
                attempt.lastAttempt
                  ? giveUp(describeFailure(failure))
                  : Effect.succeed(Disposition.Retry({ reason: describeFailure(failure) })),
              Report: ({ reason }) => giveUp(reason),
              Replan: () => Effect.succeed(Disposition.Retry({ reason: describeFailure(failure) })),
            }),
          ),
          Effect.catchTag("StoreFailed", (failure) =>
            Effect.succeed(Disposition.Retry({ reason: describeFailure(failure) })),
          ),
        );
      });

      return Reconciler.of({ sync });
    });

  static readonly layer = (options: { readonly deviceName: string }) =>
    Layer.effect(Reconciler, Reconciler.make(options));
}
