import { cn } from "cn";
import { UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { toast } from "sonner";
import type { UploadTarget } from "./upload-provider";
import { useUploadQueue } from "./upload-provider";

const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

const droppedFiles = (dataTransfer: DataTransfer) => {
  const files: Array<File> = [];
  let folders = 0;
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== "file") continue;
    if (item.webkitGetAsEntry()?.isDirectory === true) {
      folders += 1;
      continue;
    }
    const file = item.getAsFile();
    if (file !== null) files.push(file);
  }
  return { files, folders };
};

export function UploadDropZone({
  target,
  className,
  children,
}: {
  target: UploadTarget;
  className?: string;
  children: ReactNode;
}) {
  const { enqueue } = useUploadQueue();
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  return (
    <div
      className={cn("relative min-h-64", className)}
      onDragEnter={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setActive(true);
      }}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!carriesFiles(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setActive(false);
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        setActive(false);
        const { files, folders } = droppedFiles(event.dataTransfer);
        if (folders > 0) {
          toast.warning(
            folders === 1
              ? "Folders can't be uploaded from the browser"
              : `Skipped ${folders} folders: folders can't be uploaded from the browser`,
          );
        }
        if (files.length > 0) enqueue(files, target);
      }}
    >
      {children}
      {active && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary bg-primary/5 text-sm font-medium backdrop-blur-[1px]"
        >
          <UploadIcon className="size-6" />
          Drop files to upload to {target.folderName}
        </div>
      )}
    </div>
  );
}
