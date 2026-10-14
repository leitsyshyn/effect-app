import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { formatBytes, formatDateTime } from "./format";

describe("formatBytes", () => {
  it("uses binary multiples with locale unit names", () => {
    expect(formatBytes(0, "en-US")).toBe("0 bytes");
    expect(formatBytes(1, "en-US")).toBe("1 byte");
    expect(formatBytes(1536, "en-US")).toBe("1.5 kB");
    expect(formatBytes(512 * 1024 * 1024, "en-US")).toBe("512 MB");
  });

  it("formats numbers for the locale", () => {
    expect(formatBytes(1536, "de-DE")).toBe("1,5 kB");
  });
});

describe("formatDateTime", () => {
  it("formats in the given locale", () => {
    const value = DateTime.makeUnsafe("2026-03-04T05:06:07.000Z");
    const us = formatDateTime(value, { locale: "en-US" });
    const uk = formatDateTime(value, { locale: "en-GB" });
    expect(us).toMatch(/Mar 4, 2026/);
    expect(uk).toMatch(/4 Mar 2026/);
  });
});
