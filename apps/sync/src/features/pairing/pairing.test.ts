import { BunServices } from "@effect/platform-bun";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path, Redacted } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { Api } from "@effect-app/api/api";
import { Email, UserId } from "@effect-app/domain/user";
import { makeInProcessServer, testAccount } from "@effect-app/server/testing";
import type { TestAccount } from "@effect-app/server/testing";
import { sqliteLayer } from "../../infra/sqlite";
import { eventually } from "../../testing/harness";
import { ReplicaActivity } from "../replica/activity";
import { Issues } from "../replica/issues";
import { Supervisor } from "../replica/supervisor";
import { SyncedTree } from "../replica/synced-tree";
import { WorkQueue } from "../replica/work-queue";
import { Settings } from "../settings/settings";
import { Pairing } from "./pairing";

const SERVER_URL = "http://drive.test";
const DOWN_URL = "http://down.test";

const otherAccount: TestAccount = {
  token: "other-token",
  principal: {
    ...testAccount.principal,
    user: {
      ...testAccount.principal.user,
      id: UserId.make("user-other"),
      email: Email.make("other@example.com"),
    },
  },
};

const makeDaemon = Effect.gen(function* () {
  const server = yield* makeInProcessServer([testAccount, otherAccount]);
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "effect-drive-pairing-" });
  const fetch = Object.assign(
    (input: string | URL | Request, init?: RequestInit) =>
      new URL(input instanceof Request ? input.url : String(input)).origin === DOWN_URL
        ? Promise.reject(new TypeError("fetch failed: connection refused"))
        : server.fetch(input, init),
    { preconnect: server.fetch.preconnect },
  ) satisfies typeof globalThis.fetch;
  const http = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
  );
  const context = yield* Layer.build(
    Pairing.layer.pipe(
      Layer.provideMerge(Supervisor.layer({ deviceName: "Laptop" })),
      Layer.provideMerge(
        Layer.mergeAll(
          Settings.layer,
          SyncedTree.layer,
          Issues.layer,
          WorkQueue.layerWith({ pollInterval: "5 millis" }),
          ReplicaActivity.layer,
        ).pipe(Layer.provideMerge(sqliteLayer(":memory:"))),
      ),
      Layer.provideMerge(http),
      Layer.provideMerge(BunServices.layer),
    ),
  );
  const services = yield* Effect.all({
    pairing: Effect.service(Pairing),
    settings: Effect.service(Settings),
    syncedTree: Effect.service(SyncedTree),
  }).pipe(Effect.provide(context));

  const remotePaths = (account: TestAccount) =>
    Effect.gen(function* () {
      const client = yield* HttpApiClient.make(Api, {
        baseUrl: SERVER_URL,
        transformClient: HttpClient.mapRequest(HttpClientRequest.bearerToken(account.token)),
      });
      const listing = yield* client.drive.listFolder({ query: {} });
      return listing.nodes.map((node) => node.name).sort();
    }).pipe(Effect.provide(http));

  return {
    ...services,
    root,
    signInAs: (account: TestAccount, serverUrl: string = SERVER_URL) =>
      services.pairing.signIn(serverUrl, Redacted.make(account.token)),
    write: (name: string, text: string) => fs.writeFileString(path.join(root, name), text),
    localExists: (name: string) => fs.exists(path.join(root, name)),
    remotePaths,
  };
}).pipe(Effect.provide(BunServices.layer));

describe("Pairing", () => {
  it.live(
    "unlinks instead of syncing the folder into another account's drive",
    () =>
      Effect.gen(function* () {
        const daemon = yield* makeDaemon;
        yield* daemon.write("mine.txt", "belongs to the first account");
        yield* daemon.signInAs(testAccount);
        yield* daemon.pairing.link(daemon.root);
        expect(
          yield* eventually(
            daemon.remotePaths(testAccount).pipe(Effect.filterOrFail((paths) => paths.length > 0)),
          ),
        ).toEqual(["mine.txt"]);

        yield* daemon.signInAs(otherAccount);
        yield* Effect.sleep("1 second");

        const settings = yield* daemon.settings.current;
        expect(Option.map(settings.session, (session) => session.user.email)).toEqual(
          Option.some("other@example.com"),
        );
        expect(Option.isNone(settings.link)).toBe(true);
        expect(yield* daemon.syncedTree.paths).toEqual([]);
        expect(yield* daemon.localExists("mine.txt")).toBe(true);
        expect(yield* daemon.remotePaths(otherAccount)).toEqual([]);
        expect(yield* daemon.remotePaths(testAccount)).toEqual(["mine.txt"]);
      }).pipe(Effect.scoped),
    15_000,
  );

  it.live(
    "keeps the session and the link when the server can't be reached to check a token",
    () =>
      Effect.gen(function* () {
        const daemon = yield* makeDaemon;
        yield* daemon.signInAs(testAccount);
        const linked = yield* daemon.pairing.link(daemon.root);

        const failure = yield* Effect.flip(daemon.signInAs(otherAccount, DOWN_URL));
        expect(failure._tag).toBe("ServerUnreachable");

        const settings = yield* daemon.settings.current;
        expect(Option.map(settings.session, (session) => session.user.email)).toEqual(
          Option.some(testAccount.principal.user.email),
        );
        expect(Option.map(settings.link, (link) => link.id)).toEqual(Option.some(linked.id));
      }).pipe(Effect.scoped),
    15_000,
  );

  it.live(
    "keeps the link when the same account signs in again",
    () =>
      Effect.gen(function* () {
        const daemon = yield* makeDaemon;
        yield* daemon.signInAs(testAccount);
        const linked = yield* daemon.pairing.link(daemon.root);
        expect(linked.ownerId).toBe(testAccount.principal.user.id);

        yield* daemon.pairing.signOut;
        yield* daemon.signInAs(testAccount);

        const settings = yield* daemon.settings.current;
        expect(Option.map(settings.link, (link) => link.id)).toEqual(Option.some(linked.id));
      }).pipe(Effect.scoped),
    15_000,
  );
});
