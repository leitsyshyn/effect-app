import { DateTime, Option } from "effect";
import { describe, expect, it } from "vitest";
import { NodeId, NodeName, Revision } from "@effect-app/domain/drive";
import type { DriveNode } from "@effect-app/domain/drive";
import { UserId } from "@effect-app/domain/user";
import { initialUploadQueue, nextConflict, uploadQueueReducer } from "./upload-queue";
import type { UploadAction, UploadItem, UploadQueueState } from "./upload-queue";

const user = { id: UserId.make("user-1"), name: "Ada" };
const now = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");

const node = (name: string, kind: "file" | "folder", revision = 1): DriveNode => ({
  id: NodeId.make(crypto.randomUUID()),
  parentId: Option.none(),
  name: NodeName.make(name),
  kind,
  size: 1,
  contentHash: Option.none(),
  contentType: Option.none(),
  fileType: "",
  preview: "none",
  revision: Revision.make(revision),
  createdAt: now,
  createdBy: user,
  updatedAt: now,
  updatedBy: user,
  deletedAt: Option.none(),
});

const item = (id: string, name: string): UploadItem => ({
  id,
  file: new File(["x"], name),
  parentId: null,
  folderName: "My Drive",
  name,
  expectedRevision: Option.none(),
  status: { _tag: "Queued" },
});

const run = (state: UploadQueueState, ...actions: ReadonlyArray<UploadAction>) =>
  actions.reduce(uploadQueueReducer, state);

const byId = (state: UploadQueueState, id: string) => state.items.find((entry) => entry.id === id);

const conflicted = (existing: DriveNode | undefined, ...items: ReadonlyArray<UploadItem>) =>
  run(
    initialUploadQueue,
    { _tag: "Add", items },
    ...items.flatMap((entry): ReadonlyArray<UploadAction> => [
      { _tag: "Start", id: entry.id },
      {
        _tag: "Conflict",
        id: entry.id,
        existing,
        siblingNames: existing === undefined ? [] : [existing.name],
      },
    ]),
  );

describe("uploadQueueReducer", () => {
  it("replaces the existing file by uploading against its revision", () => {
    const existing = node("notes.txt", "file", 7);
    const state = run(conflicted(existing, item("a", "notes.txt")), {
      _tag: "Resolve",
      id: "a",
      resolution: "replace",
    });
    expect(byId(state, "a")).toMatchObject({
      name: "notes.txt",
      expectedRevision: Option.some(Revision.make(7)),
      status: { _tag: "Queued" },
    });
  });

  it("keeps both by queuing the upload under a free name", () => {
    const state = run(conflicted(node("notes.txt", "file"), item("a", "notes.txt")), {
      _tag: "Resolve",
      id: "a",
      resolution: "keep-both",
    });
    expect(byId(state, "a")).toMatchObject({
      name: "notes (1).txt",
      expectedRevision: Option.none(),
      status: { _tag: "Queued" },
    });
  });

  it("skips without uploading", () => {
    const state = run(conflicted(node("notes.txt", "file"), item("a", "notes.txt")), {
      _tag: "Resolve",
      id: "a",
      resolution: "skip",
    });
    expect(byId(state, "a")?.status).toEqual({ _tag: "Skipped" });
  });

  it("refuses to replace a folder", () => {
    const before = conflicted(node("notes.txt", "folder"), item("a", "notes.txt"));
    const after = run(before, { _tag: "Resolve", id: "a", resolution: "replace" });
    expect(byId(after, "a")?.status._tag).toBe("Conflict");
  });

  it("gives every 'keep both' in one batch its own name", () => {
    const existing = node("photo.jpg", "file");
    const first = item("a", "photo.jpg");
    const second = { ...item("b", "photo.jpg"), parentId: null };
    const state = run(conflicted(existing, first, second), {
      _tag: "ResolveAll",
      resolution: "keep-both",
    });
    expect(state.items.map((entry) => entry.name)).toEqual(["photo (1).jpg", "photo (2).jpg"]);
  });

  it("applies a 'for all' choice to conflicts found later in the same batch", () => {
    const existing = node("a.txt", "file");
    const started = run(
      initialUploadQueue,
      { _tag: "Add", items: [item("a", "a.txt"), item("b", "a.txt")] },
      { _tag: "Start", id: "a" },
      { _tag: "Start", id: "b" },
      { _tag: "Conflict", id: "a", existing, siblingNames: ["a.txt"] },
      { _tag: "ResolveAll", resolution: "skip" },
      { _tag: "Conflict", id: "b", existing, siblingNames: ["a.txt"] },
    );
    expect(byId(started, "b")?.status).toEqual({ _tag: "Skipped" });
    expect(started.policy).toBeUndefined();
    expect(nextConflict(started)).toBeUndefined();
  });

  it("forgets a 'for all' choice once the batch is finished", () => {
    const state = run(conflicted(node("a.txt", "file"), item("a", "a.txt")), {
      _tag: "ResolveAll",
      resolution: "skip",
    });
    expect(state.policy).toBeUndefined();
  });

  it("retries a failed upload from scratch, as create-only", () => {
    const state = run(
      initialUploadQueue,
      {
        _tag: "Add",
        items: [{ ...item("a", "a.txt"), expectedRevision: Option.some(Revision.make(2)) }],
      },
      { _tag: "Start", id: "a" },
      { _tag: "Fail", id: "a", message: "Network" },
      { _tag: "Retry", id: "a" },
    );
    expect(byId(state, "a")).toMatchObject({
      expectedRevision: Option.none(),
      status: { _tag: "Queued" },
    });
  });

  it("ignores a late failure for an upload that was cancelled", () => {
    const state = run(
      initialUploadQueue,
      { _tag: "Add", items: [item("a", "a.txt")] },
      { _tag: "Start", id: "a" },
      { _tag: "Cancel", id: "a" },
      { _tag: "Fail", id: "a", message: "Aborted" },
    );
    expect(byId(state, "a")?.status).toEqual({ _tag: "Cancelled" });
  });

  it("clears only finished uploads", () => {
    const state = run(
      initialUploadQueue,
      { _tag: "Add", items: [item("a", "a.txt"), item("b", "b.txt")] },
      { _tag: "Start", id: "a" },
      { _tag: "Succeed", id: "a" },
      { _tag: "ClearFinished" },
    );
    expect(state.items.map((entry) => entry.id)).toEqual(["b"]);
  });
});
