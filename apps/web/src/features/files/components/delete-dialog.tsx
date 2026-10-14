import type { DriveNode } from "@effect-app/domain/drive";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function DeleteDialog({
  nodes,
  pending,
  onConfirm,
  onClose,
}: {
  nodes: ReadonlyArray<DriveNode>;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const hasFolder = nodes.some((node) => node.kind === "folder");
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="max-w-full wrap-anywhere">
            {nodes.length === 1 ? `Delete “${nodes[0]?.name}”?` : `Delete ${nodes.length} items?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {hasFolder && "Folders are deleted with everything in them. "}
            It's removed from your drive and from every synced folder. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
