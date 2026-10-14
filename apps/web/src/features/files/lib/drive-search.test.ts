import { describe, expect, it } from "vitest";
import { resolveListingOptions, toDriveSearch, validateDriveSearch } from "./drive-search";

describe("validateDriveSearch", () => {
  it("keeps valid non-default values, with types normalized", () => {
    expect(validateDriveSearch({ sort: "modified-asc", type: "KT,.jpg" })).toEqual({
      sort: "modified-asc",
      type: "jpg,kt",
    });
  });

  it("keeps a sort by any column", () => {
    expect(validateDriveSearch({ sort: "uploaded-by-desc" })).toEqual({ sort: "uploaded-by-desc" });
  });

  it("drops default values so links stay short", () => {
    expect(validateDriveSearch({ sort: "modified-desc", type: "" })).toEqual({});
  });

  it("drops unknown or malformed values instead of failing", () => {
    expect(validateDriveSearch({ sort: "colour-asc", type: 42, extra: "x" })).toEqual({});
    expect(validateDriveSearch({ sort: ["modified-asc"], type: "tar.gz" })).toEqual({});
  });

  it("keeps a valid value next to an invalid one", () => {
    expect(validateDriveSearch({ sort: "modified-asc", type: 7 })).toEqual({
      sort: "modified-asc",
    });
  });
});

describe("resolveListingOptions", () => {
  it("fills in the defaults", () => {
    expect(resolveListingOptions({})).toEqual({ sort: "modified-desc", filter: [] });
    expect(resolveListingOptions({ type: "jpg,kt" })).toEqual({
      sort: "modified-desc",
      filter: ["jpg", "kt"],
    });
  });

  it("round-trips through toDriveSearch", () => {
    const options = { sort: "modified-asc", filter: ["jpg", "kt"] } as const;
    expect(resolveListingOptions(toDriveSearch(options))).toEqual(options);
    expect(toDriveSearch({ sort: "modified-desc", filter: [] })).toEqual({});
  });
});
