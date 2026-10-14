import { describe, expect, it } from "vitest";
import { extensionOf, keepBothName, nameKey } from "./file-names";

describe("keepBothName", () => {
  it("appends a counter before the extension", () => {
    expect(keepBothName("report.txt", ["report.txt"])).toBe("report (1).txt");
  });

  it("skips counters that are already taken", () => {
    expect(keepBothName("report.txt", ["report.txt", "report (1).txt", "report (2).txt"])).toBe(
      "report (3).txt",
    );
  });

  it("compares names the way the server does: ignoring case and Unicode normalization", () => {
    expect(keepBothName("Photo.JPG", ["photo.jpg", "PHOTO (1).jpg"])).toBe("Photo (2).JPG");
    const decomposed = "café (1).txt";
    expect(keepBothName("café.txt", ["café.txt", decomposed])).toBe("café (2).txt");
  });

  it("continues counting from an existing copy number", () => {
    expect(keepBothName("report (4).txt", ["report (4).txt"])).toBe("report (5).txt");
  });

  it("handles names without an extension and dotfiles", () => {
    expect(keepBothName("Makefile", ["Makefile"])).toBe("Makefile (1)");
    expect(keepBothName(".env", [".env"])).toBe(".env (1)");
  });

  it("only treats the last extension as the extension", () => {
    expect(keepBothName("archive.tar.gz", [])).toBe("archive.tar (1).gz");
  });

  it("stays within the 255 character name limit", () => {
    const long = `${"a".repeat(251)}.txt`;
    const result = keepBothName(long, [long]);
    expect(result.length).toBeLessThanOrEqual(255);
    expect(result.endsWith(" (1).txt")).toBe(true);
  });
});

describe("extensionOf and nameKey", () => {
  it("lower-cases the last extension", () => {
    expect(extensionOf("A.B.KT")).toBe(".kt");
    expect(extensionOf("README")).toBe("");
  });

  it("normalizes to NFC and lower case", () => {
    expect(nameKey("Café.TXT")).toBe(nameKey("café.txt"));
  });
});
