import {
  Array,
  Context,
  Deferred,
  Effect,
  HashMap,
  Layer,
  Option,
  Ref,
  Semaphore,
  Stream,
} from "effect";
import type { ChangePage } from "@effect-app/api/drive/api";
import { initialCursor } from "@effect-app/domain/drive";
import type { ChangeCursor, DriveNode, NodeId } from "@effect-app/domain/drive";
import type { RemoteEntry } from "../../domain/entry";
import { RemoteUnavailable } from "../../domain/failures";
import type { RemoteFailure } from "../../domain/failures";
import { child, isIgnored } from "../../domain/path";
import type { RelativePath } from "../../domain/path";
import { RemoteDrive } from "./remote-drive";

const CHANGE_FEED_SILENCE_LIMIT = "7 seconds";

interface Mirror {
  readonly nodes: HashMap.HashMap<NodeId, DriveNode>;
  readonly byPath: HashMap.HashMap<RelativePath, DriveNode>;
  readonly pathById: HashMap.HashMap<NodeId, RelativePath>;
  readonly liveChildren: HashMap.HashMap<NodeId, number>;
  readonly cursor: ChangeCursor;
}

const emptyMirror: Mirror = {
  nodes: HashMap.empty(),
  byPath: HashMap.empty(),
  pathById: HashMap.empty(),
  liveChildren: HashMap.empty(),
  cursor: initialCursor,
};

const isLive = (node: DriveNode) => Option.isNone(node.deletedAt);

const indexPaths = (nodes: HashMap.HashMap<NodeId, DriveNode>) => {
  const memo = new Map<NodeId, Option.Option<RelativePath>>();
  const pathOf = (node: DriveNode, depth: number): Option.Option<RelativePath> => {
    const known = memo.get(node.id);
    if (known !== undefined) return known;
    const result =
      !isLive(node) || depth > 256
        ? Option.none<RelativePath>()
        : Option.match(node.parentId, {
            onNone: () => Option.some(child(Option.none(), node.name)),
            onSome: (parentId) =>
              Option.flatMap(
                Option.filter(HashMap.get(nodes, parentId), (parent) => parent.kind === "folder"),
                (parent) =>
                  Option.map(pathOf(parent, depth + 1), (at) => child(Option.some(at), node.name)),
              ),
          });
    memo.set(node.id, result);
    return result;
  };

  let byPath = HashMap.empty<RelativePath, DriveNode>();
  let pathById = HashMap.empty<NodeId, RelativePath>();
  let liveChildren = HashMap.empty<NodeId, number>();
  for (const node of HashMap.values(nodes)) {
    const path = pathOf(node, 0);
    if (Option.isNone(path) || isIgnored(path.value)) continue;
    byPath = HashMap.set(byPath, path.value, node);
    pathById = HashMap.set(pathById, node.id, path.value);
    if (Option.isSome(node.parentId)) {
      liveChildren = HashMap.modifyAt(liveChildren, node.parentId.value, (count) =>
        Option.some(Option.getOrElse(count, () => 0) + 1),
      );
    }
  }
  return { byPath, pathById, liveChildren };
};

const changedPaths = (before: Mirror, after: Mirror): ReadonlyArray<RelativePath> => [
  ...Array.filter([...HashMap.keys(before.byPath)], (path) => {
    const previous = HashMap.get(before.byPath, path);
    const next = HashMap.get(after.byPath, path);
    return (
      Option.isNone(next) ||
      Option.isNone(previous) ||
      next.value.id !== previous.value.id ||
      next.value.revision !== previous.value.revision
    );
  }),
  ...Array.filter([...HashMap.keys(after.byPath)], (path) => !HashMap.has(before.byPath, path)),
];

const withNodes = (
  mirror: Mirror,
  nodes: HashMap.HashMap<NodeId, DriveNode>,
  cursor: ChangeCursor,
) => {
  const next: Mirror = { nodes, cursor, ...indexPaths(nodes) };
  return [changedPaths(mirror, next), next] as const;
};

const applyNodes = (mirror: Mirror, changes: ReadonlyArray<DriveNode>, cursor: ChangeCursor) =>
  withNodes(
    mirror,
    changes.reduce(
      (nodes, node) =>
        Option.match(HashMap.get(nodes, node.id), {
          onNone: () => HashMap.set(nodes, node.id, node),
          onSome: (known) =>
            known.revision <= node.revision ? HashMap.set(nodes, node.id, node) : nodes,
        }),
      mirror.nodes,
    ),
    cursor,
  );

interface RemoteTreeInterface {
  readonly hydrate: Effect.Effect<ReadonlyArray<RelativePath>, RemoteFailure>;
  readonly refresh: Effect.Effect<ReadonlyArray<RelativePath>, RemoteFailure>;
  readonly changes: Stream.Stream<ReadonlyArray<RelativePath>, RemoteFailure>;
  readonly entry: (path: RelativePath) => Effect.Effect<Option.Option<RemoteEntry>>;
  readonly livePaths: Effect.Effect<ReadonlyArray<RelativePath>>;
  readonly pathOf: (id: NodeId) => Effect.Effect<Option.Option<RelativePath>>;
  readonly record: (node: DriveNode) => Effect.Effect<void>;
  readonly forget: (id: NodeId) => Effect.Effect<void>;
}

export class RemoteTree extends Context.Service<RemoteTree, RemoteTreeInterface>()(
  "effect-app/sync/RemoteTree",
) {
  static readonly make = Effect.gen(function* () {
    const drive = yield* RemoteDrive;
    const mirror = yield* Ref.make(emptyMirror);
    const hydrated = yield* Deferred.make<void>();
    const pulling = yield* Semaphore.make(1);

    const refresh = pulling.withPermits(1)(
      Effect.gen(function* () {
        const start = yield* Effect.map(Ref.get(mirror), (m) => m.cursor);
        const pages = Stream.paginate<ChangeCursor, typeof ChangePage.Type, RemoteFailure>(
          start,
          (cursor) =>
            Effect.map(drive.listChanges(cursor), (page) => [
              [page],
              page.hasMore ? Option.some(page.cursor) : Option.none(),
            ]),
        );
        const changed = yield* pages.pipe(
          Stream.mapEffect((page) =>
            Ref.modify(mirror, (m) => applyNodes(m, page.nodes, page.cursor)),
          ),
          Stream.runCollect,
        );
        return Array.dedupe(changed.flat()).filter((path) => !isIgnored(path));
      }),
    );

    const isNewer = (cursor: ChangeCursor) =>
      Effect.map(Ref.get(mirror), (m) => BigInt(cursor) > BigInt(m.cursor));

    return RemoteTree.of({
      hydrate: refresh.pipe(Effect.tap(() => Deferred.succeed(hydrated, undefined))),
      refresh,
      changes: drive.notifications.pipe(
        Stream.timeout(CHANGE_FEED_SILENCE_LIMIT),
        Stream.concat(Stream.fail(new RemoteUnavailable({ cause: "change stream closed" }))),
        Stream.filterEffect(isNewer),
        Stream.mapEffect(() => refresh),
      ),
      entry: (path) =>
        Deferred.await(hydrated).pipe(
          Effect.andThen(Ref.get(mirror)),
          Effect.map((m) =>
            Option.map(HashMap.get(m.byPath, path), (node): RemoteEntry => ({
              kind: node.kind,
              contentHash: node.contentHash,
              nodeId: node.id,
              parentId: node.parentId,
              revision: node.revision,
              empty: Option.getOrElse(HashMap.get(m.liveChildren, node.id), () => 0) === 0,
            })),
          ),
        ),
      livePaths: Effect.map(Ref.get(mirror), (m) => [...HashMap.keys(m.byPath)]),
      pathOf: (id) =>
        Deferred.await(hydrated).pipe(
          Effect.andThen(Ref.get(mirror)),
          Effect.map((m) => HashMap.get(m.pathById, id)),
        ),
      record: (node) => Ref.update(mirror, (m) => applyNodes(m, [node], m.cursor)[1]),
      forget: (id) =>
        Ref.update(mirror, (m) => withNodes(m, HashMap.remove(m.nodes, id), m.cursor)[1]),
    });
  });

  static readonly layer = Layer.effect(RemoteTree, RemoteTree.make);
}
