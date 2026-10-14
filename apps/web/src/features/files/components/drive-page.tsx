import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  FolderOpenIcon,
  FolderXIcon,
  ListFilterIcon,
  RotateCwIcon,
  SearchXIcon,
  UploadIcon,
} from "lucide-react";
import { cn } from "cn";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NodeNotFound } from "@effect-app/domain/drive";
import { ALL_TYPES, makeSort, parseSort } from "@effect-app/domain/listing";
import type { SortColumn, SortDirection } from "@effect-app/domain/listing";
import { APP_NAME } from "@/components/brand";
import { EmptyState } from "@/components/empty-state";
import type { DriveNode, NodeId } from "@effect-app/domain/drive";
import { Button } from "@/components/ui/button";
import { shouldCloseAfter } from "@/features/files/lib/bulk-outcome";
import { describeDriveError, isStaleNodeError } from "@/features/files/lib/drive-errors";
import type { ListingOptions } from "@/features/files/lib/drive-search";
import { describeTypes, listingSummary, matchesName } from "@/features/files/lib/listing-view";
import { clearReveal, requestReveal, useRevealRequest } from "@/features/files/lib/reveal";
import type { FolderId } from "@/features/files/lib/nodes";
import { emptySelection, prune, select, selectAll } from "@/features/files/lib/selection";
import type { SelectGesture, Selection } from "@/features/files/lib/selection";
import { contentUrl } from "@/features/files/queries/drive-api";
import {
  folderQueryOptions,
  useCreateFolder,
  useDeleteNodes,
  useMoveNodes,
  useRenameNode,
} from "@/features/files/queries/drive-queries";
import { DeleteDialog } from "./delete-dialog";
import { DriveBreadcrumb } from "./drive-breadcrumb";
import { DriveToolbar } from "./drive-toolbar";
import { FolderTrailButtons } from "./folder-trail";
import { FileTable, FileTableSkeleton } from "./file-table";
import type { FileTableMeta, NameEdit } from "./file-table";
import { MoveDialog } from "./move-dialog";
import { PreviewPanel, useDockedPreview } from "./preview-panel";
import type { NodeAction } from "./row-actions";
import { FolderContextMenu } from "./row-actions";
import { UploadDropZone } from "./upload-drop-zone";
import { useUploadQueue } from "./upload-provider";
import { useColumnVisibility } from "./use-column-visibility";
import { useFilePicker } from "./use-file-picker";
import { useNodeDrag } from "./use-node-drag";
import type { DropFolder } from "./use-node-drag";

type OpenDialog =
  | { readonly _tag: "None" }
  | { readonly _tag: "Move"; readonly nodes: ReadonlyArray<DriveNode> }
  | { readonly _tag: "Delete"; readonly nodes: ReadonlyArray<DriveNode> };

const NO_DIALOG: OpenDialog = { _tag: "None" };

const FIRST_DIRECTION: Record<SortColumn, SortDirection> = {
  name: "asc",
  "uploaded-by": "asc",
  "edited-by": "asc",
  created: "desc",
  modified: "desc",
  size: "desc",
};
const NO_NODES: ReadonlyArray<DriveNode> = [];

const downloadFiles = (nodes: ReadonlyArray<DriveNode>) => {
  for (const node of nodes) {
    const link = document.createElement("a");
    link.href = contentUrl(node.id, "attachment");
    link.download = node.name;
    link.click();
  }
};

export function DrivePage({
  folderId,
  options,
  onOptionsChange,
}: {
  folderId: FolderId;
  options: ListingOptions;
  onOptionsChange: (options: ListingOptions) => void;
}) {
  const navigate = useNavigate();
  const listing = useQuery(folderQueryOptions(folderId, options));
  const [previewId, setPreviewId] = useState<NodeId | undefined>(undefined);
  const docked = useDockedPreview();
  const columns = useColumnVisibility({ besidePanel: docked && previewId !== undefined });
  const { enqueue } = useUploadQueue();
  const [dialog, setDialog] = useState<OpenDialog>(NO_DIALOG);
  const returnFocus = useRef<{ element: Element | null; nodeId: string | undefined }>({
    element: null,
    nodeId: undefined,
  });
  const openDialog = (next: OpenDialog) => {
    returnFocus.current = {
      element: document.activeElement,
      nodeId: "nodes" in next ? next.nodes[0]?.id : undefined,
    };
    setDialog(next);
  };
  const closeDialog = () => {
    setDialog(NO_DIALOG);
    const { element, nodeId } = returnFocus.current;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active !== null && active !== document.body) return;
      const target =
        element instanceof HTMLElement && element !== document.body && element.isConnected
          ? element
          : document.querySelector<HTMLElement>(`[data-node-id="${nodeId}"] [data-row-primary]`);
      target?.focus();
    });
  };

  const createFolder = useCreateFolder();
  const renameNode = useRenameNode();
  const moveNodes = useMoveNodes();
  const deleteNodes = useDeleteNodes();

  const [editing, setEditing] = useState<NameEdit | undefined>(undefined);
  const finishEdit = (focusId?: NodeId) => {
    setEditing(undefined);
    requestAnimationFrame(() => {
      if (focusId === undefined || document.activeElement !== document.body) return;
      document
        .querySelector<HTMLElement>(`[data-node-id="${focusId}"] [data-row-primary]`)
        ?.focus();
    });
  };
  const startNewFolder = () => setEditing({ _tag: "NewFolder" });

  const [query, setQuery] = useState("");
  const listed = useMemo(() => listing.data?.nodes ?? NO_NODES, [listing.data]);
  const nodes = useMemo(() => listed.filter(matchesName(query)), [listed, query]);
  const order = useMemo(() => nodes.map((node) => node.id), [nodes]);
  const path = listing.data?.path ?? NO_NODES;
  const folderName = folderId === null ? "My Drive" : (path.at(-1)?.name ?? "this folder");
  const uploadTarget = useMemo(() => ({ parentId: folderId, folderName }), [folderId, folderName]);

  const [selectionState, setSelection] = useState<Selection<NodeId>>(emptySelection);
  const selection = prune(selectionState, order);
  useEffect(() => setSelection((current) => prune(current, order)), [order]);
  const selectedNodes = useMemo(
    () => nodes.filter((node) => selection.ids.has(node.id)),
    [nodes, selection.ids],
  );
  const clearSelection = useCallback(() => setSelection(emptySelection()), []);
  const targetsFor = (node: DriveNode): ReadonlyArray<DriveNode> =>
    selection.ids.has(node.id) ? selectedNodes : [node];

  const move = (moving: ReadonlyArray<DriveNode>, destination: DropFolder, onDone?: () => void) =>
    moveNodes.mutate(
      {
        nodes: moving,
        parentId: destination.id,
        destinationName: destination.name,
        sourceName: folderName,
      },
      { onSuccess: (outcome) => shouldCloseAfter(outcome) && onDone?.() },
    );
  const drag = useNodeDrag({ currentFolderId: folderId, onMove: (moving, to) => move(moving, to) });

  const previewable = useMemo(() => nodes.filter((node) => node.kind === "file"), [nodes]);
  const previewNode = listed.find((node) => node.id === previewId);
  const closePreview = () => {
    setPreviewId(undefined);
    requestAnimationFrame(() => {
      if (document.activeElement !== document.body || previewId === undefined) return;
      document
        .querySelector<HTMLElement>(`[data-node-id="${previewId}"] [data-row-primary]`)
        ?.focus();
    });
  };

  const busy = useMemo(
    () =>
      new Set(
        [
          ...(moveNodes.isPending ? (moveNodes.variables?.nodes ?? []) : []),
          ...(deleteNodes.isPending ? (deleteNodes.variables ?? []) : []),
        ].map((node) => node.id),
      ),
    [moveNodes.isPending, moveNodes.variables, deleteNodes.isPending, deleteNodes.variables],
  );

  const reveal = useRevealRequest(folderId);
  useEffect(() => {
    if (reveal === undefined) return;
    const ids = order.filter((id) => reveal.ids.has(id));
    if (ids.length === 0) return;
    clearReveal(reveal);
    setQuery("");
    setSelection({ ids: new Set(ids), anchor: ids[0] });
    requestAnimationFrame(() => {
      const row = document.querySelector(`[data-node-id="${ids[0]}"]`);
      row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      row?.querySelector<HTMLElement>("[data-row-primary]")?.focus({ preventScroll: true });
    });
  }, [reveal, order]);

  useEffect(() => {
    document.title = `${folderName} · ${APP_NAME}`;
  }, [folderName]);

  const tableMeta: FileTableMeta = {
    selected: selection.ids,
    onSelect: (node: DriveNode, gesture: SelectGesture) =>
      setSelection((current) => select(prune(current, order), node.id, order, gesture)),
    onSelectAll: () => setSelection((current) => selectAll(order, current.anchor)),
    onClearSelection: clearSelection,
    targetsFor,
    drag,
    busy,
    sort: options.sort,
    onSort: (column: SortColumn) => {
      const current = parseSort(options.sort);
      const direction: SortDirection =
        current.column === column
          ? current.direction === "asc"
            ? "desc"
            : "asc"
          : FIRST_DIRECTION[column];
      onOptionsChange({ ...options, sort: makeSort(column, direction) });
    },
    editing,
    editPending: renameNode.isPending || createFolder.isPending,
    onRename: (node, name) => {
      if (name === node.name) return finishEdit(node.id);
      renameNode.mutate(
        { node, name },
        {
          onSuccess: () => finishEdit(node.id),
          onError: (error) => isStaleNodeError(error) && finishEdit(),
        },
      );
    },
    onCreateFolder: (name) =>
      createFolder.mutate(
        { parentId: folderId, name },
        {
          onSuccess: (folder) => {
            finishEdit();
            requestReveal(folderId, [folder.id]);
          },
        },
      ),
    onCancelEdit: () => finishEdit(editing?._tag === "Rename" ? editing.id : undefined),
    selection: {
      canDownload: selectedNodes.every((node) => node.kind === "file"),
      onDownload: () => downloadFiles(selectedNodes),
      onMove: () => openDialog({ _tag: "Move", nodes: selectedNodes }),
      onDelete: () => openDialog({ _tag: "Delete", nodes: selectedNodes }),
    },
    onAction: (action: NodeAction, node: DriveNode) => {
      switch (action) {
        case "open":
          if (node.kind === "folder") {
            void navigate({
              to: "/folders/$folderId",
              params: { folderId: node.id },
              search: true,
            });
          } else {
            setPreviewId(node.id);
          }
          return;
        case "rename":
          return setEditing({ _tag: "Rename", id: node.id });
        case "move":
          return openDialog({ _tag: "Move", nodes: targetsFor(node) });
        case "delete":
          return openDialog({ _tag: "Delete", nodes: targetsFor(node) });
      }
    },
  };

  const filePicker = useFilePicker((files) => enqueue(files, uploadTarget));

  const content = (() => {
    if (listing.isPending) return <FileTableSkeleton columnVisibility={columns.visibility} />;
    if (listing.isError) {
      const missing = listing.error instanceof NodeNotFound;
      return (
        <EmptyState
          alert
          icon={FolderXIcon}
          title={missing ? "This folder doesn't exist anymore" : "Couldn't load this folder"}
          description={
            missing
              ? "It may have been moved or deleted, here or from another device."
              : describeDriveError(listing.error)
          }
          action={
            missing ? (
              <Button asChild variant="outline">
                <Link to="/" search={true}>
                  Go to My Drive
                </Link>
              </Button>
            ) : (
              <Button variant="outline" onClick={() => void listing.refetch()}>
                <RotateCwIcon aria-hidden />
                Try again
              </Button>
            )
          }
        />
      );
    }
    const creating = editing?._tag === "NewFolder";
    if (listed.length === 0 && !creating) {
      return options.filter.length > 0 ? (
        <EmptyState
          icon={ListFilterIcon}
          title={`No ${describeTypes(options.filter, "or")} files here`}
          description="Show all types to see everything in this folder."
          action={
            <Button
              variant="outline"
              onClick={() => onOptionsChange({ ...options, filter: ALL_TYPES })}
            >
              Show all types
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={FolderOpenIcon}
          title="This folder is empty"
          description="Drop files here or use Upload files."
          action={
            <Button variant="outline" onClick={filePicker.open}>
              <UploadIcon aria-hidden />
              Upload files
            </Button>
          }
        />
      );
    }
    if (nodes.length === 0 && !creating) {
      return (
        <EmptyState
          icon={SearchXIcon}
          title={`No matches for “${query.trim()}”`}
          description="Try a different name or clear the filter."
          action={
            <Button variant="outline" onClick={() => setQuery("")}>
              Clear filter
            </Button>
          }
        />
      );
    }
    return (
      <FileTable
        nodes={nodes}
        columnVisibility={columns.visibility}
        meta={tableMeta}
        caption={`Contents of ${folderName}`}
      />
    );
  })();

  return (
    <section
      aria-labelledby="drive-heading"
      className="flex h-[calc(100svh-6.25rem-1px-var(--upload-panel-height,0px))] min-h-96 flex-col gap-4"
    >
      <h1 id="drive-heading" className="sr-only">
        {folderName}
      </h1>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-36 flex-1 basis-0 items-center gap-3">
          <FolderTrailButtons path={listing.data?.path} />
          <DriveBreadcrumb
            path={path}
            isRoot={folderId === null}
            loading={listing.isPending}
            dropTarget={drag.targetProps}
            dragActive={drag.active}
          />
        </div>
        <DriveToolbar
          types={listing.data?.types}
          query={query}
          onQueryChange={setQuery}
          options={options}
          onOptionsChange={onOptionsChange}
          columnVisibility={columns.visibility}
          onColumnVisibleChange={columns.setVisible}
          onResetColumns={columns.reset}
          onNewFolder={startNewFolder}
          onUpload={filePicker.open}
        />
      </div>
      {filePicker.input}
      <UploadDropZone target={uploadTarget} className="flex min-h-0 flex-1 flex-col">
        <FolderContextMenu
          canSelectAll={nodes.length > 0}
          onNewFolder={startNewFolder}
          onUpload={filePicker.open}
          onSelectAll={() => setSelection((current) => selectAll(order, current.anchor))}
        >
          <div
            className="flex min-h-0 flex-1 flex-col"
            onClick={(event) => {
              if (
                event.target instanceof Element &&
                !event.target.closest("tr, a, button, input, aside")
              ) {
                clearSelection();
              }
            }}
          >
            <div className="flex min-h-0 flex-1 gap-4">
              <div
                aria-busy={listing.isFetching}
                className={cn(
                  "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border transition-opacity [&>[data-slot=table-container]]:min-h-0 [&>[data-slot=table-container]]:flex-1 [&>[data-slot=table-container]]:scroll-pt-10 [&>[data-slot=table-container]]:overflow-auto",
                  listing.isPlaceholderData && "opacity-60",
                )}
              >
                {content}
              </div>
              {previewNode !== undefined && (
                <PreviewPanel
                  node={previewNode}
                  location={folderName}
                  files={previewable}
                  onNavigate={(node) => setPreviewId(node.id)}
                  onClose={closePreview}
                />
              )}
            </div>
            {listing.isSuccess && listed.length > 0 && (
              <p className="px-1 pt-3 text-sm text-muted-foreground tabular-nums">
                {listingSummary({
                  shown: nodes.length,
                  total: listed.length,
                  selected: selectedNodes.length,
                  filter: options.filter,
                  query,
                })}
              </p>
            )}
          </div>
        </FolderContextMenu>
      </UploadDropZone>

      {dialog._tag === "Move" && (
        <MoveDialog
          nodes={dialog.nodes}
          startIn={folderId}
          pending={moveNodes.isPending}
          onMove={(destination) => move(dialog.nodes, destination, closeDialog)}
          onClose={closeDialog}
        />
      )}
      {dialog._tag === "Delete" && (
        <DeleteDialog
          nodes={dialog.nodes}
          pending={deleteNodes.isPending}
          onConfirm={() =>
            deleteNodes.mutate(dialog.nodes, {
              onSuccess: (outcome) => shouldCloseAfter(outcome) && closeDialog(),
            })
          }
          onClose={closeDialog}
        />
      )}
    </section>
  );
}
