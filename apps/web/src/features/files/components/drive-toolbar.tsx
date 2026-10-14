import { cn } from "cn";
import {
  CheckIcon,
  Columns3Icon,
  FolderPlusIcon,
  PlusCircleIcon,
  SearchIcon,
  UploadIcon,
} from "lucide-react";
import { useState } from "react";
import { ALL_TYPES, normalizeFileTypes } from "@effect-app/domain/listing";
import type { TypeCount } from "@effect-app/domain/listing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { COLUMN_LABELS, METADATA_COLUMNS } from "@/features/files/lib/columns";
import type { MetadataColumnId } from "@/features/files/lib/columns";
import type { ListingOptions } from "@/features/files/lib/drive-search";
import { typeLabel } from "@/features/files/lib/listing-view";

const KT_AND_JPG: ReadonlyArray<string> = ["jpg", "kt"];

function NameFilter({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
}) {
  return (
    <div className="relative">
      <SearchIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label="Filter by name"
        placeholder="Filter by name"
        className="w-44 pl-8 2xl:w-56"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && query !== "") {
            event.preventDefault();
            onQueryChange("");
          }
        }}
      />
    </div>
  );
}

function TypeFilter({
  types,
  options,
  onOptionsChange,
}: {
  types: ReadonlyArray<TypeCount> | undefined;
  options: ListingOptions;
  onOptionsChange: (options: ListingOptions) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.filter;
  const setTypes = (next: ReadonlyArray<string>) =>
    onOptionsChange({ ...options, filter: normalizeFileTypes(next) });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="border-dashed">
          <PlusCircleIcon aria-hidden />
          File type
          {chosen.length > 0 && (
            <>
              <Separator
                orientation="vertical"
                className="mx-0.5 data-[orientation=vertical]:h-4"
              />
              {chosen.map((type) => (
                <Badge key={type} variant="secondary" className="rounded-sm px-1 font-normal">
                  {typeLabel(type)}
                </Badge>
              ))}
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          <CommandInput placeholder="File type" />
          <CommandList>
            <CommandEmpty>
              {types === undefined
                ? "Loading…"
                : types.length === 0
                  ? "No files here"
                  : "No types found"}
            </CommandEmpty>
            <CommandGroup>
              {[
                { label: "All files", value: ALL_TYPES },
                { label: "Only .kt and .jpg", value: KT_AND_JPG },
              ].map((preset) => {
                const isChosen = chosen.join(",") === preset.value.join(",");
                return (
                  <CommandItem
                    key={preset.label}
                    value={preset.label}
                    onSelect={() => setTypes(preset.value)}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-4 items-center justify-center rounded-full border border-input",
                        isChosen && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {isChosen && <CheckIcon className="size-3 text-current" />}
                    </span>
                    {preset.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              {(types ?? []).map(({ type, count }) => {
                const isChosen = chosen.includes(type);
                return (
                  <CommandItem
                    key={type}
                    value={type}
                    onSelect={() =>
                      setTypes(isChosen ? chosen.filter((t) => t !== type) : [...chosen, type])
                    }
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-4 items-center justify-center rounded-[4px] border border-input",
                        isChosen && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {isChosen && <CheckIcon className="size-3.5 text-current" />}
                    </span>
                    {typeLabel(type)}
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                      {count}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ColumnsMenu({
  columnVisibility,
  onColumnVisibleChange,
  onResetColumns,
}: {
  columnVisibility: Record<string, boolean>;
  onColumnVisibleChange: (column: MetadataColumnId, visible: boolean) => void;
  onResetColumns: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Columns3Icon aria-hidden />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked disabled>
          Name
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked disabled>
          {COLUMN_LABELS.updatedAt}
        </DropdownMenuCheckboxItem>
        {METADATA_COLUMNS.map((column) => (
          <DropdownMenuCheckboxItem
            key={column}
            checked={columnVisibility[column] ?? true}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => onColumnVisibleChange(column, checked)}
          >
            {COLUMN_LABELS[column]}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onResetColumns}>Reset to defaults</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DriveToolbar({
  types,
  query,
  onQueryChange,
  options,
  onOptionsChange,
  columnVisibility,
  onColumnVisibleChange,
  onResetColumns,
  onNewFolder,
  onUpload,
}: {
  types: ReadonlyArray<TypeCount> | undefined;
  query: string;
  onQueryChange: (query: string) => void;
  options: ListingOptions;
  onOptionsChange: (options: ListingOptions) => void;
  columnVisibility: Record<string, boolean>;
  onColumnVisibleChange: (column: MetadataColumnId, visible: boolean) => void;
  onResetColumns: () => void;
  onNewFolder: () => void;
  onUpload: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NameFilter query={query} onQueryChange={onQueryChange} />
      <TypeFilter types={types} options={options} onOptionsChange={onOptionsChange} />
      <ColumnsMenu
        columnVisibility={columnVisibility}
        onColumnVisibleChange={onColumnVisibleChange}
        onResetColumns={onResetColumns}
      />
      <Separator
        orientation="vertical"
        className="mx-1 hidden data-[orientation=vertical]:h-6 sm:block"
      />
      <Button variant="outline" onClick={onNewFolder}>
        <FolderPlusIcon aria-hidden />
        New folder
      </Button>
      <Button onClick={onUpload}>
        <UploadIcon aria-hidden />
        Upload files
      </Button>
    </div>
  );
}
