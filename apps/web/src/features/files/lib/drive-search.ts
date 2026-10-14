import { Option, Schema } from "effect";
import { ALL_TYPES, ListingFilterFromString, ListingSort } from "@effect-app/domain/listing";
import type { ListingFilter } from "@effect-app/domain/listing";

export const DEFAULT_SORT: ListingSort = "modified-desc";
export const DEFAULT_FILTER: ListingFilter = ALL_TYPES;

export interface DriveSearch {
  readonly sort?: ListingSort;
  readonly type?: string;
}

export interface ListingOptions {
  readonly sort: ListingSort;
  readonly filter: ListingFilter;
}

const decodeSort = Schema.decodeUnknownOption(ListingSort);
const decodeFilter = Schema.decodeUnknownOption(ListingFilterFromString);
const encodeFilter = Schema.encodeSync(ListingFilterFromString);

export const validateDriveSearch = (search: Record<string, unknown>): DriveSearch => {
  const sort = decodeSort(search["sort"]).pipe(Option.filter((value) => value !== DEFAULT_SORT));
  const filter = decodeFilter(search["type"]).pipe(Option.filter((types) => types.length > 0));
  return {
    ...(Option.isSome(sort) ? { sort: sort.value } : {}),
    ...(Option.isSome(filter) ? { type: encodeFilter(filter.value) } : {}),
  };
};

export const resolveListingOptions = (search: DriveSearch): ListingOptions => ({
  sort: search.sort ?? DEFAULT_SORT,
  filter: Option.getOrElse(decodeFilter(search.type ?? ""), () => DEFAULT_FILTER),
});

export const toDriveSearch = (options: ListingOptions): DriveSearch =>
  validateDriveSearch({ sort: options.sort, type: encodeFilter(options.filter) });
