import { Option } from "effect";
import { describe, expect, it } from "vitest";
import { NameConflict, NodeId, Revision, RevisionMismatch } from "@effect-app/domain/drive";
import { deleteReport, moveReport, settleEach, shouldCloseAfter } from "./bulk-outcome";

type Item = { readonly name: string; readonly kind: "file" | "folder" };
const file = (name: string): Item => ({ name, kind: "file" });
const folder = (name: string): Item => ({ name, kind: "folder" });
const id = NodeId.make("4b6f8c1e-2d3a-4f5b-9c7d-1e2f3a4b5c6d");
const conflict = new NameConflict({ parentId: Option.none(), name: "a.txt" });
const stale = new RevisionMismatch({ id, expected: Revision.make(1), actual: Revision.make(2) });

describe("settleEach", () => {
  it("runs every item, keeps order and collects failures without stopping", async () => {
    const outcome = await settleEach(
      [1, 2, 3, 4, 5],
      async (n) => {
        if (n % 2 === 0) throw new Error(`no ${n}`);
        return n * 10;
      },
      2,
    );
    expect(outcome.succeeded).toEqual([
      { node: 1, result: 10 },
      { node: 3, result: 30 },
      { node: 5, result: 50 },
    ]);
    expect(outcome.failed.map(({ node }) => node)).toEqual([2, 4]);
  });

  it("handles an empty list", async () => {
    expect(await settleEach([], async () => 1)).toEqual({ succeeded: [], failed: [] });
  });
});

describe("moveReport", () => {
  it("names a single item", () => {
    const outcome = { succeeded: [{ node: file("a.txt"), result: null }], failed: [] };
    expect(moveReport(outcome, "Photos")).toEqual({
      level: "success",
      title: "Moved “a.txt” to Photos",
      details: [],
    });
  });

  it("counts several items", () => {
    const outcome = {
      succeeded: [
        { node: file("a.txt"), result: null },
        { node: folder("b"), result: null },
      ],
      failed: [],
    };
    expect(moveReport(outcome, "My Drive").title).toBe("Moved 2 items to My Drive");
  });

  it("explains a name conflict at the destination", () => {
    const outcome = { succeeded: [], failed: [{ node: file("a.txt"), error: conflict }] };
    expect(moveReport(outcome, "Photos")).toEqual({
      level: "failure",
      title: "Couldn't move “a.txt” to Photos",
      details: ["Photos already has “a.txt”"],
    });
  });

  it("reports a partial move with a line per failure", () => {
    const outcome = {
      succeeded: [{ node: file("b.txt"), result: null }],
      failed: [{ node: file("a.txt"), error: conflict }],
    };
    expect(moveReport(outcome, "Photos")).toEqual({
      level: "partial",
      title: "Moved 1 of 2 items to Photos",
      details: ["“a.txt”: Photos already has “a.txt”"],
    });
  });
});

describe("deleteReport", () => {
  it("says a folder went with its contents", () => {
    const outcome = { succeeded: [{ node: folder("Old"), result: null }], failed: [] };
    expect(deleteReport(outcome).title).toBe("Deleted “Old”");
  });

  it("counts several items", () => {
    const outcome = {
      succeeded: [
        { node: file("a"), result: null },
        { node: file("b"), result: null },
        { node: file("c"), result: null },
      ],
      failed: [],
    };
    expect(deleteReport(outcome).title).toBe("Deleted 3 items");
  });

  it("reports a single failure with the reason", () => {
    const outcome = { succeeded: [], failed: [{ node: file("a.txt"), error: stale }] };
    const result = deleteReport(outcome);
    expect(result.level).toBe("failure");
    expect(result.title).toBe("Couldn't delete “a.txt”");
    expect(result.details).toHaveLength(1);
  });
});

describe("shouldCloseAfter", () => {
  it("closes when anything succeeded or the items were stale, not on other failures", () => {
    expect(shouldCloseAfter({ succeeded: [{ node: 1, result: 1 }], failed: [] })).toBe(true);
    expect(shouldCloseAfter({ succeeded: [], failed: [{ node: 1, error: stale }] })).toBe(true);
    expect(shouldCloseAfter({ succeeded: [], failed: [{ node: 1, error: conflict }] })).toBe(false);
  });
});
