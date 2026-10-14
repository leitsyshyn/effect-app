import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { makeInProcessServer, testAccount } from "../../testing/in-process-server";

const origin = "http://drive.test";
const authorization = { authorization: `Bearer ${testAccount.token}` };

interface ListedNode {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly revision: number;
  readonly contentType: string | null;
  readonly fileType: string;
  readonly preview: string;
}

interface Listing {
  readonly nodes: ReadonlyArray<ListedNode>;
  readonly types: ReadonlyArray<{ readonly type: string; readonly count: number }>;
}

const makeClient = Effect.gen(function* () {
  const server = yield* makeInProcessServer();
  const request = (path: string, init: RequestInit = {}) =>
    Effect.promise(async () => {
      const response = await server.fetch(`${origin}${path}`, {
        ...init,
        headers: { ...authorization, ...init.headers },
      });
      return { status: response.status, body: (await response.json()) as unknown };
    });

  const upload = (name: string, text: string) => {
    const form = new FormData();
    form.append("file", new Blob([text], { type: "application/octet-stream" }), name);
    return request(`/api/drive/files?name=${encodeURIComponent(name)}`, {
      method: "POST",
      body: form,
    }).pipe(Effect.map(({ body }) => body as ListedNode));
  };

  const list = (query = "") =>
    request(`/api/drive/nodes${query}`).pipe(Effect.map(({ body }) => body as Listing));

  return { request, upload, list };
});

describe("drive HTTP API", () => {
  it.live("sorts and filters on the server and counts every type for the filter's choices", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      for (const [name, text] of [
        ["main.kt", "fun main() {}"],
        ["photo.JPG", "jpeg"],
        ["notes.txt", "hello"],
      ] as const) {
        yield* client.upload(name, text);
        yield* Effect.sleep("5 millis");
      }

      const listing = yield* client.list("?sort=modified-asc&filter=jpg,kt");

      expect(listing.nodes.map((node) => node.name)).toEqual(["main.kt", "photo.JPG"]);
      expect(listing.types).toEqual([
        { type: "jpg", count: 1 },
        { type: "kt", count: 1 },
        { type: "txt", count: 1 },
      ]);
      const newestFirst = yield* client.list("?sort=modified-desc");
      expect(newestFirst.nodes.map((node) => node.name)).toEqual([
        "notes.txt",
        "photo.JPG",
        "main.kt",
      ]);
    }),
  );

  it.live("decides content type, file type and preview from the name, not the client", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const photo = yield* client.upload("photo.JPG", "jpeg");

      expect(photo.contentType).toBe("image/jpeg");
      expect(photo.fileType).toBe("jpg");
      expect(photo.preview).toBe("image");
    }),
  );

  it.live("moves into a folder, back to the root, or not at all", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const created = yield* client.request("/api/drive/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Docs" }),
      });
      const folder = created.body as ListedNode;
      const file = yield* client.upload("notes.txt", "hello");
      const patch = (body: object) =>
        client
          .request(`/api/drive/nodes/${file.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
          .pipe(Effect.map(({ body }) => body as ListedNode));

      const moved = yield* patch({ move: { parentId: folder.id }, expectedRevision: 1 });
      expect(moved.parentId).toBe(folder.id);

      const renamed = yield* patch({ name: "todo.txt", expectedRevision: moved.revision });
      expect([renamed.name, renamed.parentId]).toEqual(["todo.txt", folder.id]);

      const atRoot = yield* patch({ move: {}, expectedRevision: renamed.revision });
      expect(atRoot.parentId).toBe(null);
    }),
  );
});
