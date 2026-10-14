import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";
import { ContentHash, NodeId, Revision } from "@effect-app/domain/drive";
import type { LocalEntry, RemoteEntry, SyncedEntry } from "./entry";
import { RelativePath } from "./path";
import { plan } from "./planner";

const hashA = ContentHash.make("a".repeat(64));
const hashB = ContentHash.make("b".repeat(64));
const hashC = ContentHash.make("c".repeat(64));
const fileId = NodeId.make("00000000-0000-4000-8000-000000000001");
const otherId = NodeId.make("00000000-0000-4000-8000-000000000002");

const at = {
  path: RelativePath.make("item"),
  localSize: 0,
  localMtimeMs: 0,
  localFileId: Option.none(),
};
const synced = (hash: ContentHash, revision = 1): Option.Option<SyncedEntry> =>
  Option.some({
    ...at,
    kind: "file",
    contentHash: Option.some(hash),
    nodeId: fileId,
    revision: Revision.make(revision),
  });
const syncedFolder: Option.Option<SyncedEntry> = Option.some({
  ...at,
  kind: "folder",
  contentHash: Option.none(),
  nodeId: fileId,
  revision: Revision.make(1),
});
const localFile = (hash: ContentHash): Option.Option<LocalEntry> =>
  Option.some({ kind: "file", contentHash: Option.some(hash), empty: true });
const localFolder = (empty: boolean): Option.Option<LocalEntry> =>
  Option.some({ kind: "folder", contentHash: Option.none(), empty });
const remoteEntry = (hash: ContentHash, revision = 1, nodeId = fileId): RemoteEntry => ({
  kind: "file",
  contentHash: Option.some(hash),
  nodeId,
  parentId: Option.none(),
  revision: Revision.make(revision),
  empty: true,
});
const remoteFile = (hash: ContentHash, revision = 1, nodeId = fileId) =>
  Option.some(remoteEntry(hash, revision, nodeId));
const remoteFolder = (empty: boolean): Option.Option<RemoteEntry> =>
  Option.some({
    kind: "folder",
    contentHash: Option.none(),
    nodeId: fileId,
    parentId: Option.none(),
    revision: Revision.make(1),
    empty,
  });
const none = Option.none();

const tagOf = (input: Parameters<typeof plan>[0]) => plan(input)._tag;

describe("plan on first sight (nothing synced yet)", () => {
  it("uploads local-only files and creates local-only folders remotely", () => {
    expect(plan({ synced: none, local: localFile(hashA), remote: none })).toMatchObject({
      _tag: "Upload",
      replace: Option.none(),
    });
    expect(tagOf({ synced: none, local: localFolder(true), remote: none })).toBe(
      "CreateRemoteFolder",
    );
  });

  it("downloads remote-only files and creates remote-only folders locally", () => {
    expect(tagOf({ synced: none, local: none, remote: remoteFile(hashA) })).toBe("Download");
    expect(tagOf({ synced: none, local: none, remote: remoteFolder(false) })).toBe(
      "CreateLocalFolder",
    );
  });

  it("adopts identical contents without transferring anything", () => {
    expect(tagOf({ synced: none, local: localFile(hashA), remote: remoteFile(hashA) })).toBe(
      "Adopt",
    );
    expect(tagOf({ synced: none, local: localFolder(false), remote: remoteFolder(true) })).toBe(
      "Adopt",
    );
  });

  it("keeps both versions when contents differ", () => {
    expect(
      plan({ synced: none, local: localFile(hashA), remote: remoteFile(hashB) }),
    ).toMatchObject({
      _tag: "KeepBoth",
      reason: "InitialDiff",
    });
    expect(
      plan({ synced: none, local: localFolder(true), remote: remoteFile(hashB) }),
    ).toMatchObject({
      _tag: "KeepBoth",
      reason: "KindClash",
    });
  });
});

describe("plan after a previous sync", () => {
  it("does nothing when neither side changed", () => {
    expect(
      tagOf({ synced: synced(hashA), local: localFile(hashA), remote: remoteFile(hashA) }),
    ).toBe("NoOp");
  });

  it("adopts a new remote revision with unchanged contents (e.g. a rename elsewhere)", () => {
    expect(
      tagOf({ synced: synced(hashA), local: localFile(hashA), remote: remoteFile(hashA, 2) }),
    ).toBe("Adopt");
  });

  it("uploads local edits against the revision it last saw", () => {
    const remote = remoteEntry(hashA, 3);
    expect(
      plan({ synced: synced(hashA, 3), local: localFile(hashB), remote: Option.some(remote) }),
    ).toEqual(
      plan({ synced: synced(hashA, 3), local: localFile(hashB), remote: Option.some(remote) }),
    );
    expect(
      plan({ synced: synced(hashA, 3), local: localFile(hashB), remote: Option.some(remote) }),
    ).toMatchObject({ _tag: "Upload", replace: Option.some(remote), issue: Option.none() });
  });

  it("downloads remote edits", () => {
    expect(
      tagOf({ synced: synced(hashA), local: localFile(hashA), remote: remoteFile(hashB, 2) }),
    ).toBe("Download");
  });

  it("keeps both when both sides edited differently", () => {
    expect(
      plan({ synced: synced(hashA), local: localFile(hashB), remote: remoteFile(hashC, 2) }),
    ).toMatchObject({ _tag: "KeepBoth", reason: "EditEdit" });
  });

  it("adopts when both sides made the same edit", () => {
    expect(
      tagOf({ synced: synced(hashA), local: localFile(hashB), remote: remoteFile(hashB, 2) }),
    ).toBe("Adopt");
  });

  it("propagates a deletion only when the other side is unchanged", () => {
    expect(tagOf({ synced: synced(hashA), local: none, remote: remoteFile(hashA) })).toBe(
      "DeleteRemote",
    );
    expect(tagOf({ synced: synced(hashA), local: localFile(hashA), remote: none })).toBe(
      "DeleteLocal",
    );
  });

  it("restores a file deleted locally but edited remotely, and reports it", () => {
    expect(
      plan({ synced: synced(hashA), local: none, remote: remoteFile(hashB, 2) }),
    ).toMatchObject({
      _tag: "Download",
      issue: Option.some("DeleteEdit"),
    });
  });

  it("re-uploads a file edited locally but deleted remotely, and reports it", () => {
    expect(plan({ synced: synced(hashA), local: localFile(hashB), remote: none })).toMatchObject({
      _tag: "Upload",
      replace: Option.none(),
      issue: Option.some("EditDelete"),
    });
  });

  it("forgets paths gone from both sides", () => {
    expect(tagOf({ synced: synced(hashA), local: none, remote: none })).toBe("ForgetSynced");
  });

  it("re-adopts a path whose remote node was replaced by a new one", () => {
    expect(
      tagOf({
        synced: synced(hashA),
        local: localFile(hashA),
        remote: remoteFile(hashA, 1, otherId),
      }),
    ).toBe("Adopt");
  });
});

describe("plan for folders", () => {
  it("waits for children before deleting a folder on either side", () => {
    expect(tagOf({ synced: syncedFolder, local: none, remote: remoteFolder(false) })).toBe("NoOp");
    expect(tagOf({ synced: syncedFolder, local: none, remote: remoteFolder(true) })).toBe(
      "DeleteRemote",
    );
    expect(tagOf({ synced: syncedFolder, local: localFolder(false), remote: none })).toBe("NoOp");
    expect(tagOf({ synced: syncedFolder, local: localFolder(true), remote: none })).toBe(
      "DeleteLocal",
    );
  });

  it("keeps both when a synced folder turned into a file on one side", () => {
    expect(
      plan({ synced: syncedFolder, local: localFile(hashA), remote: remoteFolder(true) }),
    ).toMatchObject({
      _tag: "KeepBoth",
      reason: "KindClash",
    });
  });
});
