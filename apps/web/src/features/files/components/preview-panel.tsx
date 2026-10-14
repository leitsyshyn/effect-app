import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileIcon,
  Loader2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Option } from "effect";
import type { DriveNode } from "@effect-app/domain/drive";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { ContentUnavailable, describeDriveError } from "@/features/files/lib/drive-errors";
import { formatBytes, formatDateTime } from "@/features/files/lib/format";
import { typeLabel } from "@/features/files/lib/listing-view";
import { contentUrl } from "@/features/files/queries/drive-api";
import { useMediaQuery } from "@/lib/use-media-query";
import {
  TEXT_PREVIEW_LIMIT,
  textPreviewQueryOptions,
} from "@/features/files/queries/drive-queries";

const PDF_PREVIEW_LIMIT = 50 * 1024 * 1024;

function Placeholder({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return (
    <div
      role={alert ? "alert" : undefined}
      className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

const Loading = () => (
  <Placeholder>
    <Loader2Icon aria-hidden className="size-5 animate-spin" />
    <span className="sr-only">Loading preview</span>
  </Placeholder>
);

function TextPreview({ node }: { node: DriveNode }) {
  const preview = useQuery(textPreviewQueryOptions(node));
  if (preview.isPending) return <Loading />;
  if (preview.isError) {
    return <Placeholder alert>{describeDriveError(preview.error)}</Placeholder>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <pre
        tabIndex={0}
        aria-label={`Contents of ${node.name}`}
        className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs/relaxed break-words whitespace-pre-wrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        {preview.data.text === "" ? (
          <span className="text-muted-foreground">Empty file</span>
        ) : (
          preview.data.text
        )}
      </pre>
      {preview.data.truncated && (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          Showing the first {formatBytes(TEXT_PREVIEW_LIMIT)}
        </p>
      )}
    </div>
  );
}

function ImagePreview({ node }: { node: DriveNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Placeholder alert>This image can't be displayed</Placeholder>;
  const src = new URL(contentUrl(node.id, "inline"), window.location.origin);
  src.searchParams.set("revision", String(node.revision));
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <img
        src={src.toString()}
        alt={node.name}
        className="max-h-full max-w-full rounded-sm object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function PdfPreview({ node }: { node: DriveNode }) {
  const pdf = useQuery({
    queryKey: ["drive", "pdf", node.id, node.revision],
    queryFn: async ({ signal }) => {
      const response = await fetch(contentUrl(node.id, "attachment"), { signal });
      if (!response.ok) throw new ContentUnavailable({ status: response.status });
      return new Blob([await response.arrayBuffer()], { type: "application/pdf" });
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
  });
  const url = useMemo(
    () => (pdf.data === undefined ? undefined : URL.createObjectURL(pdf.data)),
    [pdf.data],
  );
  useEffect(
    () => () => {
      if (url !== undefined) URL.revokeObjectURL(url);
    },
    [url],
  );
  if (pdf.isError) return <Placeholder alert>{describeDriveError(pdf.error)}</Placeholder>;
  if (url === undefined) return <Loading />;
  return <iframe src={url} title={node.name} className="min-h-0 flex-1 border-0" />;
}

function Preview({ node }: { node: DriveNode }) {
  if (node.preview === "text") return <TextPreview node={node} />;
  if (node.preview === "image") return <ImagePreview node={node} />;
  if (node.preview === "pdf" && node.size <= PDF_PREVIEW_LIMIT) return <PdfPreview node={node} />;
  return (
    <Placeholder>
      <FileIcon aria-hidden className="size-8" />
      No preview
    </Placeholder>
  );
}

const exactBytes = new Intl.NumberFormat();

function Details({ node, location }: { node: DriveNode; location: string }) {
  const date = (value: DriveNode["updatedAt"]) => (
    <time dateTime={value.toString()} title={formatDateTime(value, { style: "full" })}>
      {formatDateTime(value)}
    </time>
  );
  const rows: ReadonlyArray<readonly [string, ReactNode]> = [
    ["Location", location],
    ["Type", node.fileType === "" ? "No extension" : typeLabel(node.fileType)],
    ["Format", Option.getOrElse(node.contentType, () => "Unknown")],
    [
      "Size",
      node.size < 1024
        ? formatBytes(node.size)
        : `${formatBytes(node.size)} (${exactBytes.format(node.size)} bytes)`,
    ],
    ["Uploaded at", date(node.createdAt)],
    ["Uploaded by", node.createdBy.name],
    ["Last edited at", date(node.updatedAt)],
    ["Last edited by", node.updatedBy.name],
    ["Version", node.revision],
  ];
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1.5 border-t px-4 py-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="truncate tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const ownsArrowKeys = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "PRE"].includes(target.tagName));

export const useDockedPreview = () => useMediaQuery("(min-width: 1024px)");

interface PreviewProps {
  readonly node: DriveNode;
  readonly location: string;
  readonly files: ReadonlyArray<DriveNode>;
  readonly onNavigate: (node: DriveNode) => void;
  readonly onClose: () => void;
}

function PreviewBody({
  node,
  location,
  files,
  onNavigate,
  title,
  closeButton,
}: PreviewProps & { title: ReactNode; closeButton: ReactNode }) {
  const index = files.findIndex((file) => file.id === node.id);
  const previous = index > 0 ? files[index - 1] : undefined;
  const next = index >= 0 ? files[index + 1] : undefined;
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b py-2 pr-2 pl-4">
        {title}
        {closeButton}
      </div>
      <div key={node.id} className="flex min-h-0 flex-1 flex-col bg-muted/30">
        <Preview node={node} />
      </div>
      <Details node={node} location={location} />
      <div className="flex shrink-0 items-center justify-between border-t px-4 py-2">
        {files.length > 1 && index >= 0 ? (
          <div className="flex items-center gap-1">
            <IconButton
              label="Previous file"
              shortcut="←"
              disabled={previous === undefined}
              onClick={() => previous !== undefined && onNavigate(previous)}
            >
              <ChevronLeftIcon aria-hidden />
            </IconButton>
            <span className="min-w-14 text-center text-sm text-muted-foreground tabular-nums">
              {index + 1} of {files.length}
            </span>
            <IconButton
              label="Next file"
              shortcut="→"
              disabled={next === undefined}
              onClick={() => next !== undefined && onNavigate(next)}
            >
              <ChevronRightIcon aria-hidden />
            </IconButton>
          </div>
        ) : (
          <span />
        )}
        <Button asChild variant="outline">
          <a href={contentUrl(node.id, "attachment")} download={node.name}>
            <DownloadIcon aria-hidden />
            Download
          </a>
        </Button>
      </div>
    </>
  );
}

export function PreviewPanel(props: PreviewProps) {
  const { node, files, onNavigate, onClose } = props;
  const docked = useDockedPreview();
  const index = files.findIndex((file) => file.id === node.id);
  const previous = index > 0 ? files[index - 1] : undefined;
  const next = index >= 0 ? files[index + 1] : undefined;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (ownsArrowKeys(event.target) || event.defaultPrevented) return;
      if (event.key === "Escape" && docked) return onClose();
      const target =
        event.key === "ArrowLeft" ? previous : event.key === "ArrowRight" ? next : undefined;
      if (target === undefined) return;
      event.preventDefault();
      onNavigate(target);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [previous, next, onNavigate, onClose, docked]);

  const closeButton = (
    <IconButton label="Close" shortcut="Esc" onClick={docked ? onClose : undefined}>
      <XIcon aria-hidden />
    </IconButton>
  );
  const titleClass = "min-w-0 flex-1 truncate font-semibold";

  if (docked) {
    return (
      <aside
        aria-label={`Preview of ${node.name}`}
        className="flex w-[26rem] shrink-0 flex-col overflow-hidden rounded-lg border bg-background xl:w-[30rem] 2xl:w-[36rem]"
        onContextMenu={(event) => event.stopPropagation()}
      >
        <PreviewBody
          {...props}
          title={
            <h2 className={titleClass} title={node.name}>
              {node.name}
            </h2>
          }
          closeButton={closeButton}
        />
      </aside>
    );
  }
  return (
    <Sheet open modal={false} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="top-[calc(3.5rem+1px)] h-auto w-full gap-0 p-0 sm:max-w-xl"
        showCloseButton={false}
        onInteractOutside={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest("button[data-row-primary]") !== null
          ) {
            event.preventDefault();
          }
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
        }}
      >
        <PreviewBody
          {...props}
          title={
            <>
              <SheetTitle className={titleClass} title={node.name}>
                {node.name}
              </SheetTitle>
              <SheetDescription className="sr-only">Preview and details</SheetDescription>
            </>
          }
          closeButton={<SheetClose asChild>{closeButton}</SheetClose>}
        />
      </SheetContent>
    </Sheet>
  );
}
