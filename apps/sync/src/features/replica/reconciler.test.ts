import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { makeHarness } from "../../testing/harness";

const isConflictCopy = (stem: string, extension: string) => (path: string) =>
  path.startsWith(`${stem} (conflict `) && path.endsWith(` Laptop)${extension}`);

const findPath = (paths: ReadonlyArray<string>, matches: (path: string) => boolean) =>
  paths.find(matches) ?? "<missing>";

describe("Reconciler", () => {
  it.live("first link merges both sides and keeps both versions of a clash", () =>
    Effect.gen(function* () {
      const drive = yield* makeHarness;
      yield* drive.remote.put("docs/remote.txt", "from web");
      yield* drive.remote.put("same.txt", "identical");
      yield* drive.remote.put("clash.txt", "remote version");
      yield* drive.local.write("local/notes.txt", "from laptop");
      yield* drive.local.write("same.txt", "identical");
      yield* drive.local.write("clash.txt", "local version");

      yield* drive.syncAll;

      const copy = findPath(yield* drive.remote.paths, isConflictCopy("clash", ".txt"));
      const expected = [
        copy,
        "clash.txt",
        "docs",
        "docs/remote.txt",
        "local",
        "local/notes.txt",
        "same.txt",
      ];
      expect(yield* drive.remote.paths).toEqual(expected);
      expect(yield* drive.local.paths).toEqual(expected);
      expect(yield* drive.local.read("clash.txt")).toEqual(Option.some("remote version"));
      expect(yield* drive.remote.read(copy)).toEqual(Option.some("local version"));
      expect((yield* drive.issues).map((issue) => [issue.kind, issue.path])).toEqual([
        ["InitialDiff", "clash.txt"],
      ]);
    }).pipe(Effect.scoped),
  );

  it.live("propagates edits both ways and re-syncing changes nothing", () =>
    Effect.gen(function* () {
      const drive = yield* makeHarness;
      yield* drive.local.write("a.txt", "v1");
      yield* drive.syncAll;

      yield* drive.local.write("a.txt", "v2 from laptop");
      yield* drive.syncAll;
      expect(yield* drive.remote.read("a.txt")).toEqual(Option.some("v2 from laptop"));

      const edited = yield* drive.remote.put("a.txt", "v3 from the web");
      yield* drive.syncAll;
      yield* drive.syncAll;

      expect(yield* drive.local.read("a.txt")).toEqual(Option.some("v3 from the web"));
      expect(edited.revision).toBe(3);
      expect(yield* drive.issues).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.live("keeps both versions when a file was edited on both sides", () =>
    Effect.gen(function* () {
      const drive = yield* makeHarness;
      yield* drive.local.write("report.txt", "base");
      yield* drive.syncAll;

      yield* drive.local.write("report.txt", "my laptop edit");
      yield* drive.remote.put("report.txt", "their web edit");
      yield* drive.syncAll;

      expect(yield* drive.local.read("report.txt")).toEqual(Option.some("their web edit"));
      const copy = findPath(yield* drive.remote.paths, isConflictCopy("report", ".txt"));
      expect(yield* drive.remote.read(copy)).toEqual(Option.some("my laptop edit"));
      expect((yield* drive.issues).map((issue) => issue.kind)).toEqual(["EditEdit"]);
    }).pipe(Effect.scoped),
  );

  it.live("never overwrites a remote change it has not seen yet", () =>
    Effect.gen(function* () {
      const drive = yield* makeHarness;
      yield* drive.local.write("plan.txt", "base");
      yield* drive.syncAll;

      yield* drive.remote.put("plan.txt", "web edit we have not pulled");
      yield* drive.local.write("plan.txt", "laptop edit");
      yield* drive.syncAll;

      expect(yield* drive.remote.read("plan.txt")).toEqual(
        Option.some("web edit we have not pulled"),
      );
      const copy = findPath(yield* drive.remote.paths, isConflictCopy("plan", ".txt"));
      expect(yield* drive.remote.read(copy)).toEqual(Option.some("laptop edit"));
    }).pipe(Effect.scoped),
  );

  it.live("propagates deletions, but an edit beats a deletion", () =>
    Effect.gen(function* () {
      const drive = yield* makeHarness;
      yield* drive.local.write("gone-locally.txt", "x");
      yield* drive.local.write("gone-remotely.txt", "y");
      yield* drive.local.write("edited-locally.txt", "z");
      yield* drive.local.write("folder/inner.txt", "w");
      yield* drive.syncAll;

      yield* drive.local.remove("gone-locally.txt");
      yield* drive.local.remove("folder");
      yield* drive.remote.remove("gone-remotely.txt");
      yield* drive.local.write("edited-locally.txt", "z, edited");
      yield* drive.remote.remove("edited-locally.txt");
      yield* drive.syncAll;

      expect(yield* drive.remote.paths).toEqual(["edited-locally.txt"]);
      expect(yield* drive.local.paths).toEqual(["edited-locally.txt"]);
      expect(yield* drive.remote.read("edited-locally.txt")).toEqual(Option.some("z, edited"));
      expect((yield* drive.issues).map((issue) => issue.kind)).toEqual(["EditDelete"]);
    }).pipe(Effect.scoped),
  );

  it.live("refuses to treat a missing folder as empty", () =>
    Effect.gen(function* () {
      const drive = yield* makeHarness;
      yield* drive.local.write("keep.txt", "precious");
      yield* drive.syncAll;

      yield* drive.local.remove(".effectsync");
      yield* drive.local.remove("keep.txt");
      yield* drive.syncAll;

      expect(yield* drive.remote.paths).toEqual(["keep.txt"]);
    }).pipe(Effect.scoped),
  );

  describe("moves", () => {
    it.live("follows a remote file rename with a local rename, without downloading", () =>
      Effect.gen(function* () {
        const drive = yield* makeHarness;
        yield* drive.local.write("docs/draft.txt", "contents");
        yield* drive.syncAll;
        const inode = yield* drive.local.inode("docs/draft.txt");

        yield* drive.remote.move("docs/draft.txt", "final.txt");
        yield* drive.syncAll;

        expect(yield* drive.local.paths).toEqual(["docs", "final.txt"]);
        expect(yield* drive.local.inode("final.txt")).toBe(inode);
        expect(yield* drive.local.read("final.txt")).toEqual(Option.some("contents"));
        expect(yield* drive.local.trashed).toEqual([]);
        expect(yield* drive.issues).toEqual([]);
      }).pipe(Effect.scoped),
    );

    it.live("follows a remote folder move with one local rename of the subtree", () =>
      Effect.gen(function* () {
        const drive = yield* makeHarness;
        yield* drive.local.write("projects/app/readme.txt", "readme");
        yield* drive.local.write("projects/app/src/main.txt", "main");
        yield* drive.syncAll;
        const folder = yield* drive.local.inode("projects/app");
        const file = yield* drive.local.inode("projects/app/src/main.txt");

        yield* drive.remote.move("projects/app", "archive/old app");
        yield* drive.syncAll;

        const expected = [
          "archive",
          "archive/old app",
          "archive/old app/readme.txt",
          "archive/old app/src",
          "archive/old app/src/main.txt",
          "projects",
        ];
        expect(yield* drive.local.paths).toEqual(expected);
        expect(yield* drive.remote.paths).toEqual(expected);
        expect(yield* drive.local.inode("archive/old app")).toBe(folder);
        expect(yield* drive.local.inode("archive/old app/src/main.txt")).toBe(file);
        expect(yield* drive.local.trashed).toEqual([]);
        expect(yield* drive.issues).toEqual([]);
      }).pipe(Effect.scoped),
    );

    it.live("renames the remote node when a file is renamed locally, without uploading", () =>
      Effect.gen(function* () {
        const drive = yield* makeHarness;
        yield* drive.local.write("docs/draft.txt", "contents");
        yield* drive.syncAll;
        const before = yield* drive.remote.node("docs/draft.txt");

        yield* drive.local.rename("docs/draft.txt", "docs/final.txt");
        yield* drive.syncAll;

        expect(yield* drive.remote.paths).toEqual(["docs", "docs/final.txt"]);
        const after = yield* drive.remote.node("docs/final.txt");
        expect(after.id).toBe(before.id);
        expect(after.revision).toBe(before.revision + 1);
        expect(yield* drive.remote.read("docs/final.txt")).toEqual(Option.some("contents"));
        expect(yield* drive.issues).toEqual([]);
      }).pipe(Effect.scoped),
    );

    it.live("moves a locally renamed folder with one request; its children keep their nodes", () =>
      Effect.gen(function* () {
        const drive = yield* makeHarness;
        yield* drive.local.write("photos/2024/beach.txt", "beach");
        yield* drive.local.write("photos/2024/hills.txt", "hills");
        yield* drive.local.write("inbox/note.txt", "note");
        yield* drive.syncAll;
        const folder = yield* drive.remote.node("photos");
        const child = yield* drive.remote.node("photos/2024/beach.txt");

        yield* drive.local.rename("photos", "inbox/pictures");
        yield* drive.syncAll;

        const expected = [
          "inbox",
          "inbox/note.txt",
          "inbox/pictures",
          "inbox/pictures/2024",
          "inbox/pictures/2024/beach.txt",
          "inbox/pictures/2024/hills.txt",
        ];
        expect(yield* drive.remote.paths).toEqual(expected);
        expect(yield* drive.local.paths).toEqual(expected);
        const moved = yield* drive.remote.node("inbox/pictures");
        expect([moved.id, moved.revision]).toEqual([folder.id, folder.revision + 1]);
        const movedChild = yield* drive.remote.node("inbox/pictures/2024/beach.txt");
        expect([movedChild.id, movedChild.revision]).toEqual([child.id, child.revision]);
        expect(yield* drive.issues).toEqual([]);
      }).pipe(Effect.scoped),
    );

    it.live("follows case-only renames both ways", () =>
      Effect.gen(function* () {
        const drive = yield* makeHarness;
        yield* drive.local.write("readme.txt", "one");
        yield* drive.local.write("notes.txt", "two");
        yield* drive.syncAll;
        const inode = yield* drive.local.inode("readme.txt");
        const node = yield* drive.remote.node("notes.txt");

        yield* drive.remote.move("readme.txt", "README.txt");
        yield* drive.local.rename("notes.txt", "Notes.txt");
        yield* drive.syncAll;

        expect(yield* drive.local.paths).toEqual(["Notes.txt", "README.txt"]);
        expect(yield* drive.remote.paths).toEqual(["Notes.txt", "README.txt"]);
        expect(yield* drive.local.inode("README.txt")).toBe(inode);
        expect((yield* drive.remote.node("Notes.txt")).id).toBe(node.id);
        expect(yield* drive.local.trashed).toEqual([]);
      }).pipe(Effect.scoped),
    );

    it.live("falls back to keeping both versions when renamed locally but edited remotely", () =>
      Effect.gen(function* () {
        const drive = yield* makeHarness;
        yield* drive.local.write("plan.txt", "base");
        yield* drive.syncAll;

        yield* drive.local.rename("plan.txt", "plan v2.txt");
        yield* drive.remote.put("plan.txt", "web edit");
        yield* drive.syncAll;

        expect(yield* drive.remote.paths).toEqual(["plan v2.txt", "plan.txt"]);
        expect(yield* drive.local.paths).toEqual(["plan v2.txt", "plan.txt"]);
        expect(yield* drive.remote.read("plan.txt")).toEqual(Option.some("web edit"));
        expect(yield* drive.local.read("plan.txt")).toEqual(Option.some("web edit"));
        expect(yield* drive.remote.read("plan v2.txt")).toEqual(Option.some("base"));
      }).pipe(Effect.scoped),
    );

    it.live("falls back to keeping both versions when renamed remotely but edited locally", () =>
      Effect.gen(function* () {
        const drive = yield* makeHarness;
        yield* drive.local.write("plan.txt", "base");
        yield* drive.syncAll;

        yield* drive.remote.move("plan.txt", "plan v2.txt");
        yield* drive.local.write("plan.txt", "laptop edit");
        yield* drive.syncAll;

        expect(yield* drive.remote.paths).toEqual(["plan v2.txt", "plan.txt"]);
        expect(yield* drive.local.paths).toEqual(["plan v2.txt", "plan.txt"]);
        expect(yield* drive.remote.read("plan.txt")).toEqual(Option.some("laptop edit"));
        expect(yield* drive.local.read("plan v2.txt")).toEqual(Option.some("base"));
      }).pipe(Effect.scoped),
    );
  });
});
