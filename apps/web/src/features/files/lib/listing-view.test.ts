import { describe, expect, it } from "vitest";
import { describeTypes, listingSummary, matchesName } from "./listing-view";

describe("matchesName", () => {
  it("matches a case-insensitive substring and ignores surrounding spaces", () => {
    const match = matchesName("  REP ");
    expect(match({ name: "Quarterly report.txt" })).toBe(true);
    expect(match({ name: "notes.kt" })).toBe(false);
  });

  it("matches everything when the query is empty", () => {
    expect(matchesName("   ")({ name: "anything" })).toBe(true);
  });

  it("treats composed and decomposed accents as the same", () => {
    expect(matchesName("café")({ name: "Café menu.jpg" })).toBe(true);
  });
});

describe("listingSummary", () => {
  const base = {
    shown: 12,
    total: 12,
    selected: 0,
    filter: [] as ReadonlyArray<string>,
    query: "",
  };

  it("counts items", () => {
    expect(listingSummary(base)).toBe("12 items");
    expect(listingSummary({ ...base, shown: 1, total: 1 })).toBe("1 item");
  });

  it("mentions the type filter", () => {
    expect(listingSummary({ ...base, shown: 4, total: 4, filter: ["jpg", "kt"] })).toBe(
      "4 items · .jpg, .kt",
    );
  });

  it("mentions the name filter", () => {
    expect(listingSummary({ ...base, shown: 2, query: " re " })).toBe("2 of 12 items match “re”");
    expect(listingSummary({ ...base, shown: 0, total: 4, query: "x", filter: ["jpg"] })).toBe(
      "0 of 4 items match “x” · .jpg",
    );
  });

  it("shows the selection instead when there is one", () => {
    expect(listingSummary({ ...base, selected: 3 })).toBe("3 of 12 selected");
  });
});

describe("describeTypes", () => {
  it("joins types in a sentence", () => {
    expect(describeTypes(["jpg"])).toBe(".jpg");
    expect(describeTypes(["jpg", "kt"], "or")).toBe(".jpg or .kt");
    expect(describeTypes(["jpg", "kt", "txt"])).toBe(".jpg, .kt and .txt");
  });
});
