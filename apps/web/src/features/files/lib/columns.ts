import { Option, Schema } from "effect";

export const METADATA_COLUMNS = ["createdAt", "createdBy", "updatedBy", "size"] as const;
export type MetadataColumnId = (typeof METADATA_COLUMNS)[number];

export const COLUMN_LABELS: Record<MetadataColumnId | "updatedAt", string> = {
  createdAt: "Uploaded at",
  updatedAt: "Last edited at",
  createdBy: "Uploaded by",
  updatedBy: "Last edited by",
  size: "Size",
};

const NARROW_HIDDEN: ReadonlySet<MetadataColumnId> = new Set([
  "createdAt",
  "createdBy",
  "updatedBy",
  "size",
]);

const BESIDE_PANEL_HIDDEN: ReadonlySet<MetadataColumnId> = new Set([
  "createdAt",
  "createdBy",
  "updatedBy",
]);

export const ColumnChoices = Schema.Struct({
  createdAt: Schema.optionalKey(Schema.Boolean),
  createdBy: Schema.optionalKey(Schema.Boolean),
  updatedBy: Schema.optionalKey(Schema.Boolean),
  size: Schema.optionalKey(Schema.Boolean),
});
export interface ColumnChoices extends Schema.Schema.Type<typeof ColumnChoices> {}

const decodeChoices = Schema.decodeUnknownOption(Schema.fromJsonString(ColumnChoices));

export const parseColumnChoices = (stored: string | null): ColumnChoices =>
  stored === null ? {} : Option.getOrElse(decodeChoices(stored), () => ({}));

export const withColumnChoice = (
  choices: ColumnChoices,
  column: MetadataColumnId,
  visible: boolean,
): ColumnChoices => ({ ...choices, [column]: visible });

export const resolveColumnVisibility = (
  choices: ColumnChoices,
  isNarrow: boolean,
  besidePanel = false,
): Record<string, boolean> => {
  const hidden = isNarrow ? NARROW_HIDDEN : besidePanel ? BESIDE_PANEL_HIDDEN : undefined;
  const visibility: Record<string, boolean> = { name: true, updatedAt: true };
  for (const column of METADATA_COLUMNS) {
    visibility[column] = choices[column] ?? !(hidden?.has(column) ?? false);
  }
  return visibility;
};
