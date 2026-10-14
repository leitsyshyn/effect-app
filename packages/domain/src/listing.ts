import { Array, DateTime, Order, Schema, SchemaTransformation } from "effect";

export const SORT_COLUMNS = [
  "name",
  "created",
  "modified",
  "uploaded-by",
  "edited-by",
  "size",
] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];
export type SortDirection = "asc" | "desc";

export const ListingSort = Schema.Literals(
  SORT_COLUMNS.flatMap((column) => [`${column}-asc`, `${column}-desc`] as const),
);
export type ListingSort = `${SortColumn}-${SortDirection}`;

export const makeSort = (column: SortColumn, direction: SortDirection): ListingSort =>
  `${column}-${direction}`;

export const parseSort = (
  sort: ListingSort,
): { readonly column: SortColumn; readonly direction: SortDirection } => {
  const dash = sort.lastIndexOf("-");
  return {
    column: sort.slice(0, dash) as SortColumn,
    direction: sort.slice(dash + 1) as SortDirection,
  };
};

export const FileType = Schema.String.check(
  Schema.isPattern(/^[^\s,.]{1,32}$/u),
  Schema.isLowercased(),
);
export type FileType = typeof FileType.Type;

export const ListingFilter = Schema.Array(FileType);
export type ListingFilter = typeof ListingFilter.Type;

export const ALL_TYPES: ListingFilter = [];

export const normalizeFileTypes = (types: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.dedupe(
    types
      .map((type) => type.trim().replace(/^\./u, "").toLowerCase())
      .filter((type) => type !== ""),
  ).toSorted();

export const ListingFilterFromString = Schema.String.pipe(
  Schema.decodeTo(
    ListingFilter,
    SchemaTransformation.transform({
      decode: (value: string) => normalizeFileTypes(value.split(",")),
      encode: (types: ReadonlyArray<string>) => types.join(","),
    }),
  ),
);

export interface ListingItem {
  readonly name: string;
  readonly kind: "file" | "folder";
  readonly size: number;
  readonly createdAt: DateTime.Utc;
  readonly updatedAt: DateTime.Utc;
  readonly createdBy: { readonly name: string };
  readonly updatedBy: { readonly name: string };
}

export const fileTypeOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
};

export const matchesFilter =
  (filter: ListingFilter) =>
  (item: ListingItem): boolean =>
    filter.length === 0 || (item.kind === "file" && filter.includes(fileTypeOf(item.name)));

const byText = (text: (item: ListingItem) => string): Order.Order<ListingItem> =>
  Order.mapInput(Order.String, (item: ListingItem) => text(item).toLowerCase());

const byName = byText((item) => item.name);

const COLUMN_ORDERS: Record<SortColumn, Order.Order<ListingItem>> = {
  name: byName,
  created: Order.mapInput(DateTime.Order, (item: ListingItem) => item.createdAt),
  modified: Order.mapInput(DateTime.Order, (item: ListingItem) => item.updatedAt),
  "uploaded-by": byText((item) => item.createdBy.name),
  "edited-by": byText((item) => item.updatedBy.name),
  size: Order.mapInput(Order.Number, (item: ListingItem) => item.size),
};

export const sortOrder = (sort: ListingSort): Order.Order<ListingItem> => {
  const { column, direction } = parseSort(sort);
  const order = COLUMN_ORDERS[column];
  return Order.combine(direction === "asc" ? order : Order.flip(order), byName);
};

export const TypeCount = Schema.Struct({
  type: FileType,
  count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({ identifier: "TypeCount" });
export interface TypeCount extends Schema.Schema.Type<typeof TypeCount> {}

export const typeCounts = (
  items: ReadonlyArray<Pick<ListingItem, "name" | "kind">>,
  chosen: ListingFilter,
): ReadonlyArray<TypeCount> => {
  const counts = new Map<string, number>(chosen.map((type) => [type, 0]));
  for (const item of items) {
    const type = item.kind === "file" ? fileTypeOf(item.name) : "";
    if (type !== "") counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return Array.fromIterable(counts)
    .map(([type, count]) => ({ type, count }))
    .toSorted((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
};

export const applyListing = <A extends ListingItem>(
  items: ReadonlyArray<A>,
  options: { readonly sort: ListingSort; readonly filter: ListingFilter },
): ReadonlyArray<A> =>
  Array.sort(Array.filter(items, matchesFilter(options.filter)), sortOrder(options.sort));
