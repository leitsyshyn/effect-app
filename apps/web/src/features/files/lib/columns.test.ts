import { describe, expect, it } from "vitest";
import { parseColumnChoices, resolveColumnVisibility, withColumnChoice } from "./columns";

describe("resolveColumnVisibility", () => {
  it("shows every column by default on wide screens", () => {
    expect(resolveColumnVisibility({}, false)).toEqual({
      name: true,
      createdAt: true,
      updatedAt: true,
      createdBy: true,
      updatedBy: true,
      size: true,
    });
  });

  it("hides low-priority columns by default on narrow screens", () => {
    expect(resolveColumnVisibility({}, true)).toEqual({
      name: true,
      createdAt: false,
      updatedAt: true,
      createdBy: false,
      updatedBy: false,
      size: false,
    });
  });

  it("lets explicit choices override the screen-size default either way", () => {
    const choices = withColumnChoice(withColumnChoice({}, "createdBy", true), "size", false);
    const narrow = resolveColumnVisibility(choices, true);
    expect(narrow["createdBy"]).toBe(true);
    expect(narrow["updatedBy"]).toBe(false);
    expect(resolveColumnVisibility(choices, false)["size"]).toBe(false);
  });
});

describe("resolveColumnVisibility beside the preview panel", () => {
  it("hides the people and Uploaded at columns but keeps Size", () => {
    expect(resolveColumnVisibility({}, false, true)).toMatchObject({
      createdAt: false,
      createdBy: false,
      updatedBy: false,
      size: true,
    });
  });

  it("still shows a column the user chose to show", () => {
    expect(resolveColumnVisibility({ createdBy: true }, false, true)["createdBy"]).toBe(true);
  });
});

describe("parseColumnChoices", () => {
  it("reads stored choices", () => {
    expect(parseColumnChoices('{"createdAt":false,"size":true}')).toEqual({
      createdAt: false,
      size: true,
    });
  });

  it("always shows Name and Last edited at", () => {
    const stored = parseColumnChoices('{"updatedAt":false}');
    expect(resolveColumnVisibility(stored, true)).toMatchObject({ name: true, updatedAt: true });
  });

  it("ignores missing, malformed or unknown data", () => {
    expect(parseColumnChoices(null)).toEqual({});
    expect(parseColumnChoices("not json")).toEqual({});
    expect(parseColumnChoices('{"createdAt":"no"}')).toEqual({});
    expect(parseColumnChoices('{"name":false,"size":false}')).toEqual({ size: false });
  });
});
