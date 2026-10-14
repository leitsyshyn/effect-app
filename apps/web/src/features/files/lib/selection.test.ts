import { describe, expect, it } from "vitest";
import { emptySelection, gestureOf, prune, select, selectAll } from "./selection";

const order = ["a", "b", "c", "d", "e"];
const ids = (selection: { ids: ReadonlySet<string> }) => Array.from(selection.ids).sort();

describe("select", () => {
  it("a plain click selects only that row", () => {
    const start = select(emptySelection<string>(), "b", order, "replace");
    const next = select(start, "d", order, "replace");
    expect(ids(next)).toEqual(["d"]);
    expect(next.anchor).toBe("d");
  });

  it("toggle adds and removes single rows and moves the anchor", () => {
    let selection = select(emptySelection<string>(), "a", order, "toggle");
    selection = select(selection, "c", order, "toggle");
    expect(ids(selection)).toEqual(["a", "c"]);
    selection = select(selection, "a", order, "toggle");
    expect(ids(selection)).toEqual(["c"]);
    expect(selection.anchor).toBe("a");
  });

  it("range selects from the anchor in either direction and keeps the anchor", () => {
    const start = select(emptySelection<string>(), "c", order, "replace");
    const down = select(start, "e", order, "range");
    expect(ids(down)).toEqual(["c", "d", "e"]);
    const up = select(down, "a", order, "range");
    expect(ids(up)).toEqual(["a", "b", "c"]);
    expect(up.anchor).toBe("c");
  });

  it("range without an anchor selects just the row", () => {
    const selection = select(emptySelection<string>(), "b", order, "range");
    expect(ids(selection)).toEqual(["b"]);
    expect(selection.anchor).toBe("b");
  });
});

describe("gestureOf", () => {
  it("maps modifier keys", () => {
    expect(gestureOf({ shiftKey: true, metaKey: true, ctrlKey: false })).toBe("range");
    expect(gestureOf({ shiftKey: false, metaKey: true, ctrlKey: false })).toBe("toggle");
    expect(gestureOf({ shiftKey: false, metaKey: false, ctrlKey: true })).toBe("toggle");
    expect(gestureOf({ shiftKey: false, metaKey: false, ctrlKey: false })).toBe("replace");
  });
});

describe("selectAll and prune", () => {
  it("selects every row", () => {
    expect(ids(selectAll(order))).toEqual(order);
  });

  it("drops rows that are no longer shown, including the anchor", () => {
    const selection = { ids: new Set(["a", "c", "x"]), anchor: "x" };
    const pruned = prune(selection, order);
    expect(ids(pruned)).toEqual(["a", "c"]);
    expect(pruned.anchor).toBeUndefined();
  });

  it("returns the same object when nothing changed", () => {
    const selection = { ids: new Set(["a", "b"]), anchor: "a" };
    expect(prune(selection, order)).toBe(selection);
  });
});
