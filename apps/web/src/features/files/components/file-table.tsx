import {
  columnVisibilityFeature,
  createColumnHelper,
  metaHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  FolderInputIcon,
  ImageIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import type { DriveNode, NodeId } from "@effect-app/domain/drive";
import { parseSort } from "@effect-app/domain/listing";
import type { ListingSort, SortColumn } from "@effect-app/domain/listing";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { COLUMN_LABELS } from "@/features/files/lib/columns";
import { formatBytes, formatDateTime } from "@/features/files/lib/format";
import { gestureOf } from "@/features/files/lib/selection";
import type { SelectGesture } from "@/features/files/lib/selection";
import { InlineNameInput } from "./inline-name-input";
import type { NodeAction } from "./row-actions";
import { RowActions, RowContextMenu } from "./row-actions";
import type { NodeDrag } from "./use-node-drag";

export interface SelectionActions {
  readonly canDownload: boolean;
  readonly onDownload: () => void;
  readonly onMove: () => void;
  readonly onDelete: () => void;
}

export interface FileTableMeta {
  readonly sort: ListingSort;
  readonly onSort: (column: SortColumn) => void;
  readonly selection: SelectionActions;
  readonly onAction: (action: NodeAction, node: DriveNode) => void;
  readonly selected: ReadonlySet<NodeId>;
  readonly onSelect: (node: DriveNode, gesture: SelectGesture) => void;
  readonly onSelectAll: () => void;
  readonly onClearSelection: () => void;
  readonly targetsFor: (node: DriveNode) => ReadonlyArray<DriveNode>;
  readonly drag: NodeDrag;
  readonly busy: ReadonlySet<NodeId>;
  readonly editing: NameEdit | undefined;
  readonly editPending: boolean;
  readonly onRename: (node: DriveNode, name: string) => void;
  readonly onCreateFolder: (name: string) => void;
  readonly onCancelEdit: () => void;
}

export type NameEdit =
  | { readonly _tag: "Rename"; readonly id: NodeId }
  | { readonly _tag: "NewFolder" };

const features = tableFeatures({
  columnVisibilityFeature,
  tableMeta: metaHelper<FileTableMeta>(),
});
const column = createColumnHelper<typeof features, DriveNode>();

function NodeIcon({ node }: { node: DriveNode }) {
  const className = "size-4 shrink-0 text-muted-foreground";
  if (node.kind === "folder")
    return <FolderIcon aria-hidden className="size-4 shrink-0 fill-primary/20 text-primary" />;
  switch (node.preview) {
    case "text":
    case "pdf":
      return <FileTextIcon aria-hidden className={className} />;
    case "image":
      return <ImageIcon aria-hidden className={className} />;
    case "none":
      return <FileIcon aria-hidden className={className} />;
  }
}

function NameCell({ node, meta }: { node: DriveNode; meta: FileTableMeta | undefined }) {
  if (meta?.editing?._tag === "Rename" && meta.editing.id === node.id) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <NodeIcon node={node} />
        <InlineNameInput
          label={`New name for ${node.name}`}
          initialName={node.name}
          selectStem={node.kind === "file"}
          pending={meta.editPending}
          onSubmit={(name) => meta.onRename(node, name)}
          onCancel={meta.onCancelEdit}
        />
      </div>
    );
  }
  return <NameLink node={node} meta={meta} />;
}

function NameLink({ node, meta }: { node: DriveNode; meta: FileTableMeta | undefined }) {
  const selectOnModifier = (event: MouseEvent) => {
    const gesture = gestureOf(event);
    if (gesture === "replace") return false;
    event.preventDefault();
    meta?.onSelect(node, gesture);
    return true;
  };
  const content = (
    <>
      <NodeIcon node={node} />
      <span className="truncate">{node.name}</span>
    </>
  );
  const className =
    "flex max-w-full min-w-0 items-center gap-2 rounded-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50";
  return node.kind === "folder" ? (
    <Link
      to="/folders/$folderId"
      params={{ folderId: node.id }}
      search={true}
      data-row-primary
      draggable={false}
      title={node.name}
      className={className}
      onClick={(event) => void selectOnModifier(event)}
    >
      {content}
    </Link>
  ) : (
    <button
      type="button"
      data-row-primary
      title={node.name}
      className={`${className} text-left`}
      onClick={(event) => {
        if (!selectOnModifier(event)) meta?.onAction("open", node);
      }}
    >
      {content}
    </button>
  );
}

function DateCell({ value }: { value: DriveNode["updatedAt"] }) {
  return (
    <time
      dateTime={value.toString()}
      title={formatDateTime(value, { style: "full" })}
      className="text-muted-foreground tabular-nums"
    >
      {formatDateTime(value)}
    </time>
  );
}

const SORT_COLUMN_OF: Record<string, SortColumn> = {
  name: "name",
  createdAt: "created",
  updatedAt: "modified",
  createdBy: "uploaded-by",
  updatedBy: "edited-by",
  size: "size",
};

function SortHeader({
  column,
  label,
  meta,
}: {
  column: SortColumn;
  label: string;
  meta: FileTableMeta | undefined;
}) {
  const sort = meta === undefined ? undefined : parseSort(meta.sort);
  const active = sort?.column === column;
  const Arrow = active && sort.direction === "asc" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <button
      type="button"
      className="group/sort -mx-1 inline-flex items-center gap-1 rounded-sm px-1 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[active=true]:text-foreground"
      data-active={active}
      onClick={() => meta?.onSort(column)}
    >
      {label}
      <Arrow
        aria-hidden
        className={cn("size-3.5", active ? "opacity-100" : "opacity-0 group-hover/sort:opacity-50")}
      />
    </button>
  );
}

function SelectionBar({
  count,
  actions,
  onClear,
}: {
  count: number;
  actions: SelectionActions;
  onClear: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Selected items"
      className="flex w-full items-center gap-1 text-foreground"
    >
      <span className="mr-2 font-medium tabular-nums" aria-live="polite">
        {count} selected
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={!actions.canDownload}
        onClick={actions.onDownload}
      >
        <DownloadIcon aria-hidden />
        <span className="max-sm:sr-only">Download</span>
      </Button>
      <Button variant="ghost" size="sm" onClick={actions.onMove}>
        <FolderInputIcon aria-hidden />
        <span className="max-sm:sr-only">Move to…</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
        onClick={actions.onDelete}
      >
        <Trash2Icon aria-hidden />
        <span className="max-sm:sr-only">Delete…</span>
      </Button>
      <Button variant="ghost" size="sm" className="sm:ml-auto" onClick={onClear}>
        <XIcon aria-hidden />
        <span className="max-sm:sr-only">Clear selection</span>
      </Button>
    </div>
  );
}

const columns = column.columns([
  column.display({
    id: "select",
    enableHiding: false,
    header: (info) => {
      const meta = info.table.options.meta;
      const rows = info.table.getRowModel().rows.length;
      const selected = meta?.selected.size ?? 0;
      return (
        <Checkbox
          aria-label="Select all"
          checked={rows > 0 && selected === rows ? true : selected > 0 ? "indeterminate" : false}
          onCheckedChange={() =>
            selected === rows ? meta?.onClearSelection() : meta?.onSelectAll()
          }
        />
      );
    },
    cell: (info) => {
      const meta = info.table.options.meta;
      const node = info.row.original;
      return (
        <Checkbox
          aria-label={`Select ${node.name}`}
          checked={meta?.selected.has(node.id) ?? false}
          onClick={(event) => {
            event.preventDefault();
            meta?.onSelect(node, event.shiftKey ? "range" : "toggle");
          }}
        />
      );
    },
  }),
  column.accessor("name", {
    header: (info) => <SortHeader column="name" label="Name" meta={info.table.options.meta} />,
    enableHiding: false,
    cell: (info) => <NameCell node={info.row.original} meta={info.table.options.meta} />,
  }),
  column.accessor("createdAt", {
    header: (info) => (
      <SortHeader column="created" label={COLUMN_LABELS.createdAt} meta={info.table.options.meta} />
    ),
    cell: (info) => <DateCell value={info.getValue()} />,
  }),
  column.accessor("updatedAt", {
    header: (info) => (
      <SortHeader
        column="modified"
        label={COLUMN_LABELS.updatedAt}
        meta={info.table.options.meta}
      />
    ),
    cell: (info) => <DateCell value={info.getValue()} />,
  }),
  column.accessor((node) => node.createdBy.name, {
    id: "createdBy",
    header: (info) => (
      <SortHeader
        column="uploaded-by"
        label={COLUMN_LABELS.createdBy}
        meta={info.table.options.meta}
      />
    ),
    cell: (info) => <span className="text-muted-foreground">{info.getValue()}</span>,
  }),
  column.accessor((node) => node.updatedBy.name, {
    id: "updatedBy",
    header: (info) => (
      <SortHeader
        column="edited-by"
        label={COLUMN_LABELS.updatedBy}
        meta={info.table.options.meta}
      />
    ),
    cell: (info) => <span className="text-muted-foreground">{info.getValue()}</span>,
  }),
  column.accessor("size", {
    header: (info) => (
      <SortHeader column="size" label={COLUMN_LABELS.size} meta={info.table.options.meta} />
    ),
    cell: (info) =>
      info.row.original.kind === "folder" ? (
        <span aria-label="Not applicable" className="text-muted-foreground">
          —
        </span>
      ) : (
        <span className="text-muted-foreground tabular-nums">{formatBytes(info.getValue())}</span>
      ),
  }),
  column.display({
    id: "actions",
    enableHiding: false,
    header: () => <span className="sr-only">Actions</span>,
    cell: (info) => {
      const meta = info.table.options.meta;
      return (
        <RowActions
          node={info.row.original}
          count={meta?.targetsFor(info.row.original).length ?? 1}
          onAction={(action, node) => meta?.onAction(action, node)}
        />
      );
    },
  }),
]);

const COLUMN_CLASSES: Record<string, string> = {
  select: "w-10 pl-3 pr-0",
  name: "w-full max-w-0 min-w-36",
  size: "text-right",
  actions: "w-12 pr-3",
};

const SKELETON_COLUMNS = [
  "select",
  "name",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "size",
  "actions",
] as const;

export function FileTableSkeleton({
  columnVisibility,
}: {
  columnVisibility: Record<string, boolean>;
}) {
  const visible = SKELETON_COLUMNS.filter((id) => columnVisibility[id] ?? true);
  const headerOf = (id: (typeof SKELETON_COLUMNS)[number]) =>
    id === "select" || id === "actions" ? "" : id === "name" ? "Name" : COLUMN_LABELS[id];
  return (
    <Table aria-busy="true" aria-label="Loading files">
      <TableHeader className="sticky top-0 z-10 bg-background shadow-[inset_0_-1px_0_var(--border)] [&_th]:text-muted-foreground [&_tr]:border-b-0 [&_tr]:bg-muted/40 [&_tr]:hover:bg-muted/40">
        <TableRow className="hover:bg-transparent">
          {visible.map((id) => (
            <TableHead key={id} className={COLUMN_CLASSES[id]}>
              {headerOf(id)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody className="[&_tr:last-child]:border-b">
        {Array.from({ length: 8 }, (_, row) => (
          <TableRow key={row} className="h-12 hover:bg-transparent">
            {visible.map((id) => (
              <TableCell key={id} className={COLUMN_CLASSES[id]}>
                {id === "select" ? (
                  <Skeleton className="size-4" />
                ) : id === "actions" ? null : id === "name" ? (
                  <div className="flex items-center gap-2">
                    <Skeleton className="size-4" />
                    <Skeleton className="h-4" style={{ width: `${40 + ((row * 37) % 45)}%` }} />
                  </div>
                ) : (
                  <Skeleton className="h-4 w-24" />
                )}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const handleRowKeys = (
  event: KeyboardEvent<HTMLTableSectionElement>,
  nodes: ReadonlyArray<DriveNode>,
  meta: FileTableMeta,
) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.hasAttribute("data-row-primary")) return;
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-row-primary]"));
  const index = rows.indexOf(target);
  const node = nodes[index];
  if (node === undefined) return;
  const focusRow = (next: number) => {
    event.preventDefault();
    const clamped = Math.max(0, Math.min(rows.length - 1, next));
    rows[clamped]?.focus();
    const reached = nodes[clamped];
    if (!event.shiftKey || reached === undefined) return;
    if (meta.selected.size === 0) meta.onSelect(node, "replace");
    meta.onSelect(reached, "range");
  };
  switch (event.key) {
    case "ArrowDown":
      return focusRow(index + 1);
    case "ArrowUp":
      return focusRow(index - 1);
    case "Home":
      return focusRow(0);
    case "End":
      return focusRow(rows.length - 1);
    case " ":
      event.preventDefault();
      return meta.onSelect(node, "toggle");
    case "a":
    case "A":
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      return meta.onSelectAll();
    case "Escape":
      if (meta.selected.size === 0) return;
      event.preventDefault();
      return meta.onClearSelection();
    case "F2":
      event.preventDefault();
      return meta.onAction("rename", node);
    case "Delete":
      event.preventDefault();
      return meta.onAction("delete", node);
    case "Backspace":
      if (!event.metaKey) return;
      event.preventDefault();
      return meta.onAction("delete", node);
  }
};

const isRowClick = (event: MouseEvent<HTMLElement>) => {
  const target = event.target;
  return (
    target instanceof Element &&
    event.currentTarget.contains(target) &&
    target.closest("a, button, input, [role=checkbox]") === null
  );
};

export function FileTable({
  nodes,
  columnVisibility,
  meta,
  caption,
}: {
  nodes: ReadonlyArray<DriveNode>;
  columnVisibility: Record<string, boolean>;
  meta: FileTableMeta;
  caption: string;
}) {
  const table = useTable({
    features,
    columns,
    data: nodes,
    getRowId: (node) => node.id,
    state: { columnVisibility },
    meta,
  });
  const sort = parseSort(meta.sort);
  const selecting = meta.selected.size > 0;

  return (
    <Table>
      <caption className="sr-only">{caption}</caption>
      <TableHeader className="sticky top-0 z-10 bg-background shadow-[inset_0_-1px_0_var(--border)] [&_th]:text-muted-foreground [&_tr]:border-b-0 [&_tr]:bg-muted/40 [&_tr]:hover:bg-muted/40">
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="hover:bg-transparent">
            {group.headers.map((header) => {
              const isSelect = header.column.id === "select";
              return (
                <TableHead
                  key={header.id}
                  className={cn(
                    COLUMN_CLASSES[header.column.id],
                    selecting && !isSelect && "[&>*]:invisible",
                  )}
                  aria-sort={
                    SORT_COLUMN_OF[header.column.id] === sort.column
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  {isSelect && selecting && (
                    <div className="absolute top-0 right-0 left-10 flex h-10 items-center pr-3 pl-2">
                      <SelectionBar
                        count={meta.selected.size}
                        actions={meta.selection}
                        onClear={meta.onClearSelection}
                      />
                    </div>
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody
        className="[&_tr:last-child]:border-b"
        onKeyDown={(event) => handleRowKeys(event, nodes, meta)}
        onKeyUp={(event) => {
          if (event.key === " " && event.target instanceof HTMLElement) {
            if (event.target.hasAttribute("data-row-primary")) event.preventDefault();
          }
        }}
      >
        {table.getRowModel().rows.map((row) => {
          const node = row.original;
          const isEditing = meta.editing?._tag === "Rename" && meta.editing.id === node.id;
          const dropTarget =
            node.kind === "folder" ? meta.drag.targetProps({ id: node.id, name: node.name }) : {};
          return (
            <RowContextMenu
              key={row.id}
              node={node}
              count={meta.targetsFor(node).length}
              onAction={meta.onAction}
            >
              <TableRow
                data-node-id={node.id}
                data-state={meta.selected.has(node.id) ? "selected" : undefined}
                className={cn(
                  "group/row h-12 select-none data-[state=selected]:bg-primary/10 dark:data-[state=selected]:bg-primary/20 data-[drop-target=true]:bg-primary/15 data-[drop-target=true]:outline-2 data-[drop-target=true]:-outline-offset-2 data-[drop-target=true]:outline-primary",
                  meta.busy.has(node.id) && "opacity-50",
                )}
                draggable={!isEditing}
                onDragStart={(event) => meta.drag.start(event, meta.targetsFor(node))}
                onDragEnd={meta.drag.end}
                onClick={(event) => {
                  if (isRowClick(event)) meta.onSelect(node, gestureOf(event));
                }}
                onDoubleClick={(event) => {
                  if (isRowClick(event)) meta.onAction("open", node);
                }}
                onContextMenu={(event) => {
                  event.stopPropagation();
                  if (!meta.selected.has(node.id)) meta.onSelect(node, "replace");
                }}
                {...dropTarget}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className={COLUMN_CLASSES[cell.column.id]}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            </RowContextMenu>
          );
        })}
        {meta.editing?._tag === "NewFolder" && (
          <TableRow className="h-12 bg-primary/5 hover:bg-primary/5">
            {(table.getHeaderGroups()[0]?.headers ?? []).map((header) => (
              <TableCell key={header.id} className={COLUMN_CLASSES[header.column.id]}>
                {header.column.id === "name" && (
                  <div className="flex min-w-0 items-center gap-2">
                    <FolderIcon
                      aria-hidden
                      className="size-4 shrink-0 fill-primary/20 text-primary"
                    />
                    <InlineNameInput
                      label="New folder name"
                      initialName="Untitled folder"
                      cancelOnBlur
                      pending={meta.editPending}
                      onSubmit={meta.onCreateFolder}
                      onCancel={meta.onCancelEdit}
                    />
                  </div>
                )}
              </TableCell>
            ))}
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
