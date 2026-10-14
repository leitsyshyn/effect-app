import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { keepBothName } from "@/features/files/lib/file-names";
import { canReplace, nextConflict } from "@/features/files/lib/upload-queue";
import type { ConflictResolution } from "@/features/files/lib/upload-queue";
import { useUploadQueue } from "./upload-provider";

export function ConflictDialog() {
  const { state, resolve, resolveAll } = useUploadQueue();
  const [applyToAll, setApplyToAll] = useState(false);
  const checkboxId = useId();
  const item = nextConflict(state);
  if (item === undefined || item.status._tag !== "Conflict") return null;

  const status = item.status;
  const remaining = state.items.filter((other) => other.status._tag === "Conflict").length;
  const replaceable = canReplace(status);
  const choose = (resolution: ConflictResolution) => {
    if (applyToAll) resolveAll(resolution);
    else resolve(item.id, resolution);
    setApplyToAll(false);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && choose("skip")}>
      <DialogContent key={item.id} showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="wrap-anywhere">“{item.name}” already exists</DialogTitle>
          <DialogDescription>
            {status.existing?.kind === "folder"
              ? `A folder with this name is already in ${item.folderName}, so the file can only be kept under a new name or skipped.`
              : `${item.folderName} already has a file with this name. Replace it with the one you're uploading, or keep both as “${keepBothName(item.name, status.siblingNames)}”.`}
          </DialogDescription>
        </DialogHeader>
        {remaining > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <input
              id={checkboxId}
              type="checkbox"
              className="size-4 accent-primary"
              checked={applyToAll}
              onChange={(event) => setApplyToAll(event.target.checked)}
            />
            <label htmlFor={checkboxId}>Do this for all {remaining} conflicts in this upload</label>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => choose("skip")}>
            Skip
          </Button>
          {replaceable && (
            <Button
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
              onClick={() => choose("replace")}
            >
              Replace
            </Button>
          )}
          <Button onClick={() => choose("keep-both")}>Keep both</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
