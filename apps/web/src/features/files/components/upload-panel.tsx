import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  CircleSlashIcon,
  ClockIcon,
  Loader2Icon,
  RotateCcwIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/features/files/lib/format";
import { isPending } from "@/features/files/lib/upload-queue";
import type { UploadItem } from "@/features/files/lib/upload-queue";
import { useUploadQueue } from "./upload-provider";

function StatusIcon({ item }: { item: UploadItem }) {
  const className = "size-4 shrink-0";
  switch (item.status._tag) {
    case "Queued":
      return <ClockIcon aria-hidden className={`${className} text-muted-foreground`} />;
    case "Uploading":
      return <Loader2Icon aria-hidden className={`${className} animate-spin text-primary`} />;
    case "Conflict":
      return <CircleAlertIcon aria-hidden className={`${className} text-amber-600`} />;
    case "Done":
      return <CheckCircle2Icon aria-hidden className={`${className} text-emerald-600`} />;
    case "Failed":
      return <CircleAlertIcon aria-hidden className={`${className} text-destructive`} />;
    case "Skipped":
    case "Cancelled":
      return <CircleSlashIcon aria-hidden className={`${className} text-muted-foreground`} />;
  }
}

const statusText = (item: UploadItem): string => {
  switch (item.status._tag) {
    case "Queued":
      return "Waiting…";
    case "Uploading":
      return `Uploading ${formatBytes(item.file.size)}…`;
    case "Conflict":
      return "Name already taken. Choose what to do.";
    case "Done":
      return item.name === item.file.name ? "Uploaded" : `Uploaded as “${item.name}”`;
    case "Failed":
      return item.status.message;
    case "Skipped":
      return "Skipped";
    case "Cancelled":
      return "Cancelled";
  }
};

const useReservedSpace = () => {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const panel = ref.current;
    if (panel === null) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() =>
      root.style.setProperty("--upload-panel-height", `${panel.offsetHeight + 16}px`),
    );
    observer.observe(panel);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--upload-panel-height");
    };
  }, []);
  return ref;
};

export function UploadPanel() {
  const { state } = useUploadQueue();
  if (state.items.length === 0) return null;
  return <UploadList />;
}

function UploadList() {
  const { state, cancel, retry, clearFinished } = useUploadQueue();
  const [collapsed, setCollapsed] = useState(false);
  const ref = useReservedSpace();
  const items = state.items;

  const pending = items.filter(isPending).length;
  const active = items.filter(
    (item) => item.status._tag === "Queued" || item.status._tag === "Uploading",
  ).length;
  const failed = items.filter((item) => item.status._tag === "Failed").length;
  const done = items.filter((item) => item.status._tag === "Done").length;
  const summary =
    active > 0
      ? `Uploading ${active} ${active === 1 ? "file" : "files"}`
      : pending > 0
        ? `${pending} ${pending === 1 ? "upload needs" : "uploads need"} your decision`
        : failed > 0
          ? `${failed} ${failed === 1 ? "upload" : "uploads"} failed`
          : done > 0
            ? `${done} ${done === 1 ? "upload" : "uploads"} complete`
            : "No files uploaded";

  return (
    <section
      ref={ref}
      aria-labelledby="upload-panel-title"
      className="fixed right-4 bottom-4 left-4 z-40 rounded-lg border bg-popover text-popover-foreground shadow-lg sm:left-auto sm:w-96"
    >
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <h2 id="upload-panel-title" className="text-sm font-medium" aria-live="polite">
          {summary}
        </h2>
        <div className="ml-auto flex items-center">
          {pending === 0 && (
            <Button variant="ghost" size="sm" onClick={clearFinished}>
              Clear
            </Button>
          )}
          <IconButton
            size="icon-sm"
            aria-expanded={!collapsed}
            aria-controls="upload-panel-list"
            label={collapsed ? "Show uploads" : "Hide uploads"}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <ChevronUpIcon aria-hidden /> : <ChevronDownIcon aria-hidden />}
          </IconButton>
        </div>
      </header>
      <ul id="upload-panel-list" hidden={collapsed} className="max-h-72 overflow-y-auto py-1">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 px-4 py-2">
            <span className="mt-0.5">
              <StatusIcon item={item} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={item.name}>
                {item.name}
              </p>
              <p
                className={`text-xs ${item.status._tag === "Failed" ? "text-destructive" : "text-muted-foreground"}`}
              >
                {statusText(item)}
                <span className="sr-only">, in {item.folderName}</span>
              </p>
            </div>
            {(item.status._tag === "Queued" || item.status._tag === "Uploading") && (
              <IconButton
                size="icon-sm"
                label="Cancel upload"
                aria-label={`Cancel upload of ${item.name}`}
                onClick={() => cancel(item.id)}
              >
                <XIcon aria-hidden />
              </IconButton>
            )}
            {item.status._tag === "Failed" && (
              <IconButton
                size="icon-sm"
                label="Retry upload"
                aria-label={`Retry upload of ${item.name}`}
                onClick={() => retry(item.id)}
              >
                <RotateCwIcon aria-hidden />
              </IconButton>
            )}
            {item.status._tag === "Cancelled" && (
              <IconButton
                size="icon-sm"
                label="Restart upload"
                aria-label={`Restart upload of ${item.name}`}
                onClick={() => retry(item.id)}
              >
                <RotateCcwIcon aria-hidden />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
