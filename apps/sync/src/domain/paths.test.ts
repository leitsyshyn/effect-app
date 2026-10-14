import { describe, expect, it } from "@effect/vitest";
import { DateTime, Option } from "effect";
import { conflictName } from "./conflict-name";
import { child, fromSegments, isIgnored, parentOf, RelativePath } from "./path";

describe("fromSegments", () => {
  it("normalizes Unicode form and drops empty segments", () => {
    const nfd = "Cafe\u0301";

    expect(fromSegments(["docs", `${nfd}.txt`])).toEqual(Option.some("docs/Café.txt"));
    expect(fromSegments(["docs", "", "notes.txt"])).toEqual(Option.some("docs/notes.txt"));
  });

  it("rejects the root and paths that leave it", () => {
    expect(fromSegments([])).toEqual(Option.none());
    expect(fromSegments(["..", "outside.txt"])).toEqual(Option.none());
  });
});

describe("path helpers", () => {
  it("walks parents and children", () => {
    const path = RelativePath.make("a/b/c.txt");

    expect(parentOf(path)).toEqual(Option.some("a/b"));
    expect(parentOf(RelativePath.make("top.txt"))).toEqual(Option.none());
    expect(child(Option.some(RelativePath.make("a")), "b.txt")).toBe("a/b.txt");
  });

  it("ignores OS litter and the daemon's own folder", () => {
    expect(isIgnored(RelativePath.make("photos/.DS_Store"))).toBe(true);
    expect(isIgnored(RelativePath.make(".effectsync/tmp/x"))).toBe(true);
    expect(isIgnored(RelativePath.make("docs/._report.txt"))).toBe(true);
    expect(isIgnored(RelativePath.make("docs/report.txt"))).toBe(false);
  });
});

describe("conflictName", () => {
  const at = DateTime.makeUnsafe("2026-10-05T22:10:03.000Z");

  it("keeps the extension so the copy opens in the same app", () => {
    expect(conflictName("report.txt", at, "MacBook")).toBe(
      "report (conflict 2026-10-05 22-10-03 MacBook).txt",
    );
  });

  it("handles names without an extension and unsafe device names", () => {
    expect(conflictName("Makefile", at, "a/b")).toBe("Makefile (conflict 2026-10-05 22-10-03 a-b)");
    expect(conflictName(".env", at, "")).toBe(".env (conflict 2026-10-05 22-10-03)");
  });
});
