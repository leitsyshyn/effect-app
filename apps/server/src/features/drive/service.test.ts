import { BunCrypto } from "@effect/platform-bun";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Stream } from "effect";
import { TestClock } from "effect/testing";
import { ChangeCursor, NodeName, Revision } from "@effect-app/domain/drive";
import { BlobStore } from "../../infra/storage/blob-store";
import { makeUser } from "../../testing/fixtures";
import { memoryDriveRepositoryLayer } from "../../testing/drive-repository";
import { DriveEvents } from "./events";
import { DriveService } from "./service";

const alice = { ...makeUser("user-alice", "alice@example.com"), name: "Alice" };
const bob = { ...makeUser("user-bob", "bob@example.com"), name: "Bob" };

const TestDrive = DriveService.layerWithoutDependencies.pipe(
  Layer.provide(memoryDriveRepositoryLayer({ [alice.id]: alice.name, [bob.id]: bob.name })),
  Layer.provide(DriveEvents.layer),
  Layer.provideMerge(BlobStore.layerMemory),
  Layer.provide(BunCrypto.layer),
);

const bytes = (text: string) => Stream.make(new TextEncoder().encode(text));
const name = (value: string) => NodeName.make(value);

const upload = (
  actor: typeof alice,
  fileName: string,
  text: string,
  expectedRevision: Option.Option<Revision> = Option.none(),
) =>
  Effect.flatMap(Effect.service(DriveService), (drive) =>
    drive.uploadFile(actor, {
      parentId: Option.none(),
      name: name(fileName),
      expectedRevision,
      content: bytes(text),
    }),
  );

const readAll = (stream: Stream.Stream<Uint8Array, unknown>) =>
  Stream.runCollect(stream).pipe(
    Effect.map((chunks) => new TextDecoder().decode(Buffer.concat([...chunks]))),
  );

describe("DriveService", () => {
  it.effect("stores an upload with uploader, editor, and a type and preview from its name", () =>
    Effect.gen(function* () {
      const drive = yield* DriveService;
      const node = yield* upload(alice, "notes.txt", "hello");
      const download = yield* drive.downloadFile(alice, node.id);

      expect(node.createdBy.name).toBe("Alice");
      expect(node.updatedBy.name).toBe("Alice");
      expect(node.contentType).toEqual(Option.some("text/plain; charset=utf-8"));
      expect(node.fileType).toBe("txt");
      expect(node.preview).toBe("text");
      expect(node.size).toBe(5);
      expect(yield* readAll(download.content)).toBe("hello");
    }).pipe(Effect.provide(TestDrive)),
  );

  it.effect("never overwrites without the expected revision", () =>
    Effect.gen(function* () {
      const original = yield* upload(alice, "notes.txt", "v1");

      const unconditional = yield* upload(alice, "NOTES.TXT", "v2").pipe(Effect.flip);
      const stale = yield* upload(alice, "notes.txt", "v2", Option.some(Revision.make(7))).pipe(
        Effect.flip,
      );

      expect(unconditional._tag).toBe("NameConflict");
      expect(stale).toMatchObject({ _tag: "RevisionMismatch", expected: 7, actual: 1 });
      expect(
        (yield* upload(alice, "notes.txt", "v2", Option.some(original.revision))).revision,
      ).toBe(2);
    }).pipe(Effect.provide(TestDrive)),
  );

  it.effect("re-uploading identical content does not create a new revision", () =>
    Effect.gen(function* () {
      const original = yield* upload(alice, "notes.txt", "same");
      const again = yield* upload(alice, "notes.txt", "same", Option.some(original.revision));

      expect(again.revision).toBe(original.revision);
    }).pipe(Effect.provide(TestDrive)),
  );

  it.effect("replacing contents bumps the revision and modification time", () =>
    Effect.gen(function* () {
      const original = yield* upload(alice, "notes.txt", "v1");
      yield* TestClock.adjust("1 minute");
      const edited = yield* upload(alice, "notes.txt", "v2", Option.some(original.revision));

      expect(edited.revision).toBe(2);
      expect(edited.createdAt).toEqual(original.createdAt);
      expect(edited.updatedAt.epochMilliseconds - original.updatedAt.epochMilliseconds).toBe(
        60_000,
      );
    }).pipe(Effect.provide(TestDrive)),
  );

  it.effect("hides one user's files from another", () =>
    Effect.gen(function* () {
      const drive = yield* DriveService;
      const secret = yield* upload(alice, "secret.txt", "mine");

      const error = yield* drive.getNode(bob, secret.id).pipe(Effect.flip);
      const listing = yield* drive.listFolder(bob, {
        parentId: Option.none(),
        sort: "modified-desc",
        filter: [],
      });

      expect(error._tag).toBe("NodeNotFound");
      expect(listing.nodes).toEqual([]);
    }).pipe(Effect.provide(TestDrive)),
  );

  it.effect("a failed upload leaves no file behind", () =>
    Effect.gen(function* () {
      const drive = yield* DriveService;
      const error = yield* drive
        .uploadFile(alice, {
          parentId: Option.none(),
          name: name("broken.txt"),
          expectedRevision: Option.none(),
          content: Stream.concat(bytes("partial"), Stream.fail("connection reset" as const)),
        })
        .pipe(Effect.flip);
      const listing = yield* drive.listFolder(alice, {
        parentId: Option.none(),
        sort: "modified-desc",
        filter: [],
      });

      expect(error).toBe("connection reset");
      expect(listing.nodes).toEqual([]);
    }).pipe(Effect.provide(TestDrive)),
  );

  it.effect("deleting a folder tombstones its contents in the change feed", () =>
    Effect.gen(function* () {
      const drive = yield* DriveService;
      const folder = yield* drive.createFolder(alice, {
        parentId: Option.none(),
        name: name("Docs"),
      });
      yield* drive.uploadFile(alice, {
        parentId: Option.some(folder.id),
        name: name("a.txt"),
        expectedRevision: Option.none(),
        content: bytes("a"),
      });
      const before = yield* drive.listChanges(alice, {
        cursor: ChangeCursor.make("0"),
        limit: 100,
      });

      yield* drive.deleteNode(alice, folder.id, Option.some(folder.revision));
      const after = yield* drive.listChanges(alice, { cursor: before.cursor, limit: 100 });

      expect(after.nodes.map((node) => [node.name, Option.isSome(node.deletedAt)])).toEqual([
        ["Docs", true],
        ["a.txt", true],
      ]);
    }).pipe(Effect.provide(TestDrive)),
  );

  it.effect("refuses to move a folder into its own subfolder", () =>
    Effect.gen(function* () {
      const drive = yield* DriveService;
      const outer = yield* drive.createFolder(alice, {
        parentId: Option.none(),
        name: name("Outer"),
      });
      const inner = yield* drive.createFolder(alice, {
        parentId: Option.some(outer.id),
        name: name("Inner"),
      });

      const error = yield* drive
        .updateNode(alice, outer.id, {
          name: Option.none(),
          parentId: Option.some(Option.some(inner.id)),
          expectedRevision: outer.revision,
        })
        .pipe(Effect.flip);

      expect(error._tag).toBe("InvalidMove");
    }).pipe(Effect.provide(TestDrive)),
  );

  it.effect("pages through changes in order", () =>
    Effect.gen(function* () {
      const drive = yield* DriveService;
      yield* upload(alice, "1.txt", "1");
      yield* upload(alice, "2.txt", "2");
      yield* upload(alice, "3.txt", "3");

      const first = yield* drive.listChanges(alice, { cursor: ChangeCursor.make("0"), limit: 2 });
      const second = yield* drive.listChanges(alice, { cursor: first.cursor, limit: 2 });

      expect(first.nodes.map((node) => node.name)).toEqual(["1.txt", "2.txt"]);
      expect(first.hasMore).toBe(true);
      expect(second.nodes.map((node) => node.name)).toEqual(["3.txt"]);
      expect(second.hasMore).toBe(false);
    }).pipe(Effect.provide(TestDrive)),
  );
});
