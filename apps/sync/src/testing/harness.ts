import { BunServices } from "@effect/platform-bun";
import {
  Array,
  DateTime,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Redacted,
  Ref,
  Schedule,
  Stream,
} from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { Api } from "@effect-app/api/api";
import { initialCursor } from "@effect-app/domain/drive";
import { NodeName } from "@effect-app/domain/drive";
import type { DriveNode, NodeId } from "@effect-app/domain/drive";
import { makeInProcessServer, testAccount } from "@effect-app/server/testing";
import { RelativePath } from "../domain/path";
import { ReplicaActivity } from "../features/replica/activity";
import { writeMarker } from "../features/replica/folder-marker";
import { Issues } from "../features/replica/issues";
import { LocalTree } from "../features/replica/local-tree";
import { Reconciler } from "../features/replica/reconciler";
import { RemoteTree } from "../features/replica/remote-tree";
import { replicaLayer } from "../features/replica/replica";
import { SyncedTree } from "../features/replica/synced-tree";
import { WorkQueue } from "../features/replica/work-queue";
import type { Link, Session } from "../features/settings/settings";
import { sqliteLayer } from "../infra/sqlite";

const SERVER_URL = "http://drive.test";
const LINK_ID = "test-link";

export const eventually = <A, E, R>(check: Effect.Effect<A, E, R>) =>
  check.pipe(
    Effect.retry(Schedule.spaced("50 millis").pipe(Schedule.upTo({ duration: "5 seconds" }))),
  );

export const makeHarness = Effect.gen(function* () {
  const server = yield* makeInProcessServer();
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "effect-drive-sync-" });
  yield* writeMarker(root, LINK_ID);

  const session: Session = {
    serverUrl: SERVER_URL,
    token: Redacted.make(testAccount.token),
    user: {
      id: testAccount.principal.user.id,
      name: testAccount.principal.user.name,
      email: testAccount.principal.user.email,
    },
  };
  const link: Link = { id: LINK_ID, rootPath: root, linkedAt: yield* DateTime.now };

  const http = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, server.fetch)),
  );
  const state = Layer.mergeAll(
    SyncedTree.layer,
    Issues.layer,
    WorkQueue.layerWith({ pollInterval: "5 millis" }),
    ReplicaActivity.layer,
  ).pipe(Layer.provideMerge(sqliteLayer(":memory:")));
  const context = yield* Layer.build(
    replicaLayer({ session, link, deviceName: "Laptop" }).pipe(
      Layer.provideMerge(state),
      Layer.provideMerge(http),
      Layer.provideMerge(BunServices.layer),
    ),
  );

  const services = yield* Effect.all({
    reconciler: Effect.service(Reconciler),
    queue: Effect.service(WorkQueue),
    remote: Effect.service(RemoteTree),
    local: Effect.service(LocalTree),
    syncedTree: Effect.service(SyncedTree),
    issues: Effect.service(Issues),
  }).pipe(Effect.provide(context));

  const syncAll = Effect.gen(function* () {
    const { queue, remote, local, syncedTree, reconciler } = services;
    yield* queue.schedule(yield* remote.hydrate);
    yield* queue.schedule(
      Array.dedupe([...(yield* local.scan(Option.none())), ...(yield* syncedTree.paths)]),
    );
    const parked = yield* Ref.make(false);
    while (!(yield* Ref.get(parked))) {
      const ran = yield* queue
        .next((item, attempt) =>
          reconciler
            .sync(item, attempt)
            .pipe(Effect.tap((disposition) => Ref.set(parked, disposition._tag === "Parked"))),
        )
        .pipe(Effect.timeoutOption("150 millis"));
      if (Option.isNone(ran)) return;
    }
  });

  const web = yield* HttpApiClient.make(Api, {
    baseUrl: SERVER_URL,
    transformClient: HttpClient.mapRequest(HttpClientRequest.bearerToken(testAccount.token)),
  }).pipe(Effect.provide(http));

  const remoteNodes = Effect.map(
    web.drive.listChanges({ query: { cursor: initialCursor, limit: 1000 } }),
    (page) => {
      const live = new Map(
        page.nodes.filter((node) => Option.isNone(node.deletedAt)).map((node) => [node.id, node]),
      );
      const pathOf = (node: DriveNode): string =>
        Option.match(node.parentId, {
          onNone: () => node.name,
          onSome: (parentId) => {
            const parent = live.get(parentId);
            return parent === undefined ? node.name : `${pathOf(parent)}/${node.name}`;
          },
        });
      return new Map([...live.values()].map((node) => [pathOf(node), node]));
    },
  );

  const remoteFolder = (segments: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      let parentId = Option.none<NodeId>();
      for (const [index, name] of segments.entries()) {
        const existing = (yield* remoteNodes).get(segments.slice(0, index + 1).join("/"));
        parentId = Option.some(
          existing?.id ??
            (yield* web.drive.createFolder({
              payload: Option.match(parentId, {
                onNone: () => ({ name: NodeName.make(name) }),
                onSome: (id) => ({ parentId: id, name: NodeName.make(name) }),
              }),
            })).id,
        );
      }
      return parentId;
    });

  const remoteSide = {
    put: (relative: string, text: string) =>
      Effect.gen(function* () {
        const segments = relative.split("/");
        const name = segments.pop() ?? relative;
        const parentId = yield* remoteFolder(segments);
        const existing = (yield* remoteNodes).get(relative);
        const form = new FormData();
        form.append("file", new Blob([text]), name);
        return yield* web.drive.uploadFile({
          query: {
            name: NodeName.make(name),
            ...Option.match(parentId, { onNone: () => ({}), onSome: (id) => ({ parentId: id }) }),
            ...(existing === undefined ? {} : { expectedRevision: existing.revision }),
          },
          payload: form,
        });
      }),
    remove: (relative: string) =>
      Effect.gen(function* () {
        const node = (yield* remoteNodes).get(relative);
        if (node !== undefined) yield* web.drive.deleteNode({ params: { id: node.id }, query: {} });
      }),
    move: (from: string, to: string) =>
      Effect.gen(function* () {
        const node = yield* Effect.fromNullishOr((yield* remoteNodes).get(from));
        const segments = to.split("/");
        const name = segments.pop() ?? to;
        const parentId = yield* remoteFolder(segments);
        return yield* web.drive.updateNode({
          params: { id: node.id },
          payload: {
            name: NodeName.make(name),
            move: Option.match(parentId, {
              onNone: () => ({}),
              onSome: (id) => ({ parentId: id }),
            }),
            expectedRevision: node.revision,
          },
        });
      }),
    node: (relative: string) =>
      Effect.flatMap(remoteNodes, (nodes) => Effect.fromNullishOr(nodes.get(relative))),
    read: (relative: string) =>
      Effect.gen(function* () {
        const node = (yield* remoteNodes).get(relative);
        if (node === undefined || node.kind === "folder") return Option.none<string>();
        const bytes = yield* Stream.runCollect(
          Stream.unwrap(web.drive.downloadFile({ params: { id: node.id }, query: {} })),
        );
        return Option.some(new TextDecoder().decode(Buffer.concat([...bytes])));
      }),
    paths: Effect.map(remoteNodes, (nodes) => [...nodes.keys()].sort()),
  };

  const localSide = {
    write: (relative: string, text: string) =>
      Effect.gen(function* () {
        const file = path.join(root, relative);
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, text);
      }),
    read: (relative: string) => fs.readFileString(path.join(root, relative)).pipe(Effect.option),
    remove: (relative: string) => fs.remove(path.join(root, relative), { recursive: true }),
    rename: (from: string, to: string) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(path.dirname(path.join(root, to)), { recursive: true });
        yield* fs.rename(path.join(root, from), path.join(root, to));
      }),
    inode: (relative: string) =>
      Effect.map(fs.stat(path.join(root, relative)), (info) => Option.getOrThrow(info.ino)),
    trashed: fs
      .readDirectory(path.join(root, ".effectsync", "trash"))
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => [])),
    paths: Effect.map(services.local.scan(Option.none()), (paths) => [...paths].sort()),
  };

  return {
    root,
    context,
    syncAll,
    remote: remoteSide,
    local: localSide,
    issues: services.issues.list,
    relative: RelativePath.make,
  };
}).pipe(Effect.provide(BunServices.layer));
