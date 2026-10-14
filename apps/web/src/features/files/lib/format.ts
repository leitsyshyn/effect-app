import { DateTime } from "effect";

const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

export const formatBytes = (bytes: number, locale?: string): string => {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: UNITS[unit],
    unitDisplay: unit === 0 ? "long" : "short",
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
};

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

const dateTimeFormat = (locale: string | undefined, style: "short" | "full") => {
  const key = `${locale ?? ""}|${style}`;
  const cached = dateTimeFormats.get(key);
  if (cached !== undefined) return cached;
  const format = new Intl.DateTimeFormat(
    locale,
    style === "short"
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "full", timeStyle: "long" },
  );
  dateTimeFormats.set(key, format);
  return format;
};

export const formatDateTime = (
  dateTime: DateTime.DateTime,
  options: { readonly style?: "short" | "full"; readonly locale?: string } = {},
): string =>
  dateTimeFormat(options.locale, options.style ?? "short").format(DateTime.toDate(dateTime));
