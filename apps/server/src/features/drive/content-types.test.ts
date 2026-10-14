import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";
import { contentTypeOf, describeContent, previewOf } from "./content-types";

describe("contentTypeOf", () => {
  it("decides the type from the extension, ignoring case", () => {
    expect(contentTypeOf("Photo.JPG")).toBe("image/jpeg");
    expect(contentTypeOf("notes.txt")).toBe("text/plain; charset=utf-8");
    expect(contentTypeOf("Main.kt")).toBe("text/x-kotlin; charset=utf-8");
  });

  it("stores unknown and untyped files as generic binary", () => {
    expect(contentTypeOf("data.bin")).toBe("application/octet-stream");
    expect(contentTypeOf("README")).toBe("application/octet-stream");
  });
});

describe("previewOf", () => {
  it("previews raster images as images and text-like types as text", () => {
    expect(previewOf(Option.some("image/jpeg"))).toBe("image");
    expect(previewOf(Option.some("text/plain; charset=utf-8"))).toBe("text");
    expect(previewOf(Option.some("application/json"))).toBe("text");
  });

  it("shows SVG as text, since it can carry scripts", () => {
    expect(previewOf(Option.some("image/svg+xml"))).toBe("text");
  });

  it("has no preview for unknown or missing types", () => {
    expect(previewOf(Option.some("application/octet-stream"))).toBe("none");
    expect(previewOf(Option.none())).toBe("none");
  });
});

describe("describeContent", () => {
  it("gives folders no type and no preview, whatever their name", () => {
    expect(
      describeContent({ name: "photos.jpg", kind: "folder", contentType: Option.none() }),
    ).toEqual({ fileType: "", preview: "none" });
  });
});
