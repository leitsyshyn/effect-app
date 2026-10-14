import { describe, expect, it } from "@effect/vitest";
import { DateTime } from "effect";
import { Schema } from "effect";
import {
  applyListing,
  fileTypeOf,
  ListingFilterFromString,
  matchesFilter,
  parseSort,
  typeCounts,
} from "./listing";
import type { ListingItem } from "./listing";

const item = (
  name: string,
  updatedAt: string,
  kind: "file" | "folder" = "file",
  extra: Partial<ListingItem> = {},
): ListingItem => ({
  name,
  kind,
  size: 0,
  createdAt: DateTime.makeUnsafe(updatedAt),
  updatedAt: DateTime.makeUnsafe(updatedAt),
  createdBy: { name: "Ann" },
  updatedBy: { name: "Ann" },
  ...extra,
});

const notes = item("notes.txt", "2026-01-02T00:00:00.000Z");
const photo = item("photo.jpg", "2026-01-03T00:00:00.000Z");
const main = item("Main.kt", "2026-01-01T00:00:00.000Z");
const folder = item("archive", "2026-01-04T00:00:00.000Z", "folder");

describe("applyListing", () => {
  it("sorts by modification time, newest first", () => {
    const names = applyListing([main, notes, photo], { sort: "modified-desc", filter: [] }).map(
      (entry) => entry.name,
    );

    expect(names).toEqual(["photo.jpg", "notes.txt", "Main.kt"]);
  });

  it("sorts by modification time, oldest first", () => {
    const names = applyListing([photo, notes, main], { sort: "modified-asc", filter: [] }).map(
      (entry) => entry.name,
    );

    expect(names).toEqual(["Main.kt", "notes.txt", "photo.jpg"]);
  });

  it("breaks modification-time ties by name", () => {
    const a = item("b.txt", "2026-01-01T00:00:00.000Z");
    const b = item("A.txt", "2026-01-01T00:00:00.000Z");

    expect(applyListing([a, b], { sort: "modified-asc", filter: [] })).toEqual([b, a]);
  });

  it("sorts folders among files rather than first", () => {
    const names = applyListing([main, folder, notes], { sort: "modified-asc", filter: [] }).map(
      (entry) => entry.name,
    );

    expect(names).toEqual(["Main.kt", "notes.txt", "archive"]);
  });

  it("sorts by any column, either way", () => {
    const small = item("b.txt", "2026-01-01T00:00:00.000Z", "file", {
      size: 1,
      createdBy: { name: "zoe" },
    });
    const large = item("a.txt", "2026-01-01T00:00:00.000Z", "file", {
      size: 9,
      createdBy: { name: "Adam" },
    });
    const names = (sort: Parameters<typeof applyListing>[1]["sort"]) =>
      applyListing([small, large], { sort, filter: [] }).map((entry) => entry.name);

    expect(names("name-asc")).toEqual(["a.txt", "b.txt"]);
    expect(names("name-desc")).toEqual(["b.txt", "a.txt"]);
    expect(names("size-asc")).toEqual(["b.txt", "a.txt"]);
    expect(names("size-desc")).toEqual(["a.txt", "b.txt"]);
    expect(names("uploaded-by-asc")).toEqual(["a.txt", "b.txt"]);
  });

  it("limits the listing to .kt and .jpg files, leaving folders out", () => {
    const names = applyListing([notes, photo, main, folder], {
      sort: "modified-desc",
      filter: ["kt", "jpg"],
    }).map((entry) => entry.name);

    expect(names).toEqual(["photo.jpg", "Main.kt"]);
  });
});

describe("matchesFilter", () => {
  it("compares extensions without regard to case", () => {
    const keep = matchesFilter(["kt", "jpg"]);

    expect(keep(item("SCREEN.JPG", "2026-01-01T00:00:00.000Z"))).toBe(true);
    expect(keep(item("App.Kt", "2026-01-01T00:00:00.000Z"))).toBe(true);
    expect(keep(item("photo.jpeg", "2026-01-01T00:00:00.000Z"))).toBe(false);
    expect(keep(item(".jpg", "2026-01-01T00:00:00.000Z"))).toBe(false);
  });

  it("keeps everything without a filter", () => {
    expect(matchesFilter([])(notes)).toBe(true);
    expect(matchesFilter([])(folder)).toBe(true);
  });

  it("leaves folders out of a type filter, whatever their name", () => {
    expect(matchesFilter(["jpg"])(folder)).toBe(false);
    expect(matchesFilter(["jpg"])({ ...folder, name: "photos.jpg" })).toBe(false);
  });
});

describe("fileTypeOf", () => {
  it("is the lowercase extension without the dot", () => {
    expect(fileTypeOf("Photo.JPG")).toBe("jpg");
    expect(fileTypeOf("archive.tar.gz")).toBe("gz");
  });

  it("is empty for names without an extension", () => {
    expect(fileTypeOf("README")).toBe("");
    expect(fileTypeOf(".env")).toBe("");
  });
});

describe("typeCounts", () => {
  it("counts files by type, sorted, leaving out folders and files without a type", () => {
    const items = [
      { name: "a.JPG", kind: "file" },
      { name: "b.jpg", kind: "file" },
      { name: "Main.kt", kind: "file" },
      { name: "README", kind: "file" },
      { name: "photos.jpg", kind: "folder" },
    ] as const;
    expect(typeCounts(items, [])).toEqual([
      { type: "jpg", count: 2 },
      { type: "kt", count: 1 },
    ]);
  });

  it("keeps chosen types that no file here has, so they can be unchosen", () => {
    expect(typeCounts([], ["kt"])).toEqual([{ type: "kt", count: 0 }]);
  });
});

describe("ListingFilterFromString", () => {
  const decode = Schema.decodeUnknownSync(ListingFilterFromString);
  const encode = Schema.encodeSync(ListingFilterFromString);

  it("reads comma-separated types, normalized, deduplicated and sorted", () => {
    expect(decode("kt,.JPG, jpg ,,")).toEqual(["jpg", "kt"]);
  });

  it("reads an empty string as no filter", () => {
    expect(decode("")).toEqual([]);
  });

  it("rejects types that can't be extensions", () => {
    expect(() => decode("tar.gz")).toThrow();
  });

  it("writes types back comma-separated", () => {
    expect(encode(["jpg", "kt"])).toBe("jpg,kt");
  });
});

describe("parseSort", () => {
  it("splits columns that contain dashes", () => {
    expect(parseSort("uploaded-by-desc")).toEqual({ column: "uploaded-by", direction: "desc" });
  });
});
