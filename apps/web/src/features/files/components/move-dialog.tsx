import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, FolderIcon, HomeIcon } from "lucide-react";
import { Option } from "effect";
import { useState } from "react";
import type { DriveNode } from "@effect-app/domain/drive";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { describeDriveError } from "@/features/files/lib/drive-errors";
import { DEFAULT_FILTER, DEFAULT_SORT } from "@/features/files/lib/drive-search";
import type { FolderId } from "@/features/files/lib/nodes";
import { folderQueryOptions } from "@/features/files/queries/drive-queries";

const LISTING = { sort: DEFAULT_SORT, filter: DEFAULT_FILTER } as const;

export function MoveDialog({
  nodes,
  startIn,
  pending,
  onMove,
  onClose,
}: {
  nodes: ReadonlyArray<DriveNode>;
  startIn: FolderId;
  pending: boolean;
  onMove: (destination: { readonly id: FolderId; readonly name: string }) => void;
  onClose: () => void;
}) {
  const [location, setLocation] = useState<FolderId>(startIn);
  const listing = useQuery(folderQueryOptions(location, LISTING));
  const first = nodes[0];
  const currentParent = first === undefined ? null : Option.getOrNull(first.parentId);
  const moving = new Set(nodes.map((node) => node.id));
  const folders = (listing.data?.nodes ?? []).filter(
    (child) => child.kind === "folder" && !moving.has(child.id),
  );
  const path = listing.data?.path ?? [];
  const locationName = location === null ? "My Drive" : (path.at(-1)?.name ?? "this folder");
  const canMove = listing.isSuccess && location !== currentParent;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">
            {nodes.length === 1 ? `Move “${first?.name}”` : `Move ${nodes.length} items`}
          </DialogTitle>
          <DialogDescription>Open the folder you want to move to, then confirm.</DialogDescription>
        </DialogHeader>
        <nav aria-label="Destination folder path">
          <ol className="flex flex-wrap items-center gap-1 text-sm">
            <li>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => setLocation(null)}
              >
                <HomeIcon aria-hidden />
                My Drive
              </Button>
            </li>
            {path.map((folder) => (
              <li key={folder.id} className="flex min-w-0 items-center gap-1">
                <ChevronRightIcon aria-hidden className="size-3.5 text-muted-foreground" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 max-w-48 px-2"
                  title={folder.name}
                  aria-current={folder.id === location ? "location" : undefined}
                  onClick={() => setLocation(folder.id)}
                >
                  <span className="truncate">{folder.name}</span>
                </Button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="h-64 overflow-y-auto rounded-md border">
          {listing.isPending ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : listing.isError ? (
            <p role="alert" className="p-4 text-sm text-destructive">
              {describeDriveError(listing.error)}
            </p>
          ) : folders.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No folders inside {locationName}.</p>
          ) : (
            <ul aria-label={`Folders in ${locationName}`} className="p-1">
              {folders.map((folder) => (
                <li key={folder.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    onClick={() => setLocation(folder.id)}
                  >
                    <FolderIcon
                      aria-hidden
                      className="size-4 shrink-0 fill-primary/20 text-primary"
                    />
                    <span className="truncate">{folder.name}</span>
                    <ChevronRightIcon
                      aria-hidden
                      className="ml-auto size-4 text-muted-foreground"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="min-w-0 shrink"
            disabled={!canMove || pending}
            onClick={() => onMove({ id: location, name: locationName })}
          >
            <span className="truncate">Move to {locationName}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
