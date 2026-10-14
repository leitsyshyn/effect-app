import type { ListingFilter } from "@effect-app/domain/listing";

export const typeLabel = (type: string) => `.${type}`;

export const describeTypes = (filter: ListingFilter, conjunction: "and" | "or" = "and") => {
  const labels = filter.map(typeLabel);
  return labels.length <= 1
    ? (labels[0] ?? "")
    : `${labels.slice(0, -1).join(", ")} ${conjunction} ${labels.at(-1)}`;
};

const foldName = (name: string) => name.normalize("NFC").toLocaleLowerCase();

export const matchesName =
  (query: string) =>
  (node: { readonly name: string }): boolean => {
    const needle = foldName(query.trim());
    return needle === "" || foldName(node.name).includes(needle);
  };

const items = (count: number) => `${count} ${count === 1 ? "item" : "items"}`;

export const listingSummary = (input: {
  readonly shown: number;
  readonly total: number;
  readonly selected: number;
  readonly filter: ListingFilter;
  readonly query: string;
}): string => {
  if (input.selected > 0) return `${input.selected} of ${input.shown} selected`;
  const query = input.query.trim();
  const base =
    query === "" ? items(input.total) : `${input.shown} of ${items(input.total)} match “${query}”`;
  return input.filter.length === 0 ? base : `${base} · ${input.filter.map(typeLabel).join(", ")}`;
};
