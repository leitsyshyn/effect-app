import { describe, expect, it } from "@effect/vitest";
import {
  FolderUnavailable,
  LocalChanged,
  LocalIoFailed,
  NotConverging,
  RemoteOutdated,
  RemoteRejected,
  RemoteUnavailable,
  SessionRejected,
  StoreFailed,
} from "./failures";
import { recover } from "./recovery";

describe("recover", () => {
  it("re-plans when our view of a side was stale", () => {
    expect(recover(new RemoteOutdated({ reason: "NameConflict" }))).toMatchObject({
      _tag: "Replan",
      refreshRemote: true,
    });
    expect(recover(new LocalChanged({ path: "a.txt" }))).toMatchObject({
      _tag: "Replan",
      refreshRemote: false,
    });
  });

  it("parks work behind conditions outside the path, without spending attempts", () => {
    expect(recover(new RemoteUnavailable({ cause: "ECONNREFUSED" }))).toMatchObject({
      _tag: "Park",
      condition: "offline",
    });
    expect(recover(new SessionRejected())).toMatchObject({ _tag: "Park", condition: "signed-out" });
    expect(recover(new FolderUnavailable({ reason: "unmounted" }))).toMatchObject({
      _tag: "Park",
      condition: "folder-unavailable",
    });
  });

  it("reports refusals and retries the unexpected", () => {
    expect(recover(new RemoteRejected({ reason: "too large" }))).toMatchObject({
      _tag: "Report",
      reason: "too large",
    });
    expect(recover(new LocalIoFailed({ operation: "hash", path: "a", cause: "EIO" }))._tag).toBe(
      "Retry",
    );
    expect(recover(new StoreFailed({ operation: "put", cause: "SQLITE_BUSY" }))._tag).toBe("Retry");
    expect(recover(new NotConverging({ path: "a" }))._tag).toBe("Retry");
  });

  it("retries a server error instead of waiting for the server to come back", () => {
    expect(recover(new RemoteUnavailable({ cause: "HTTP 503", serverAnswered: true }))._tag).toBe(
      "Retry",
    );
  });
});
