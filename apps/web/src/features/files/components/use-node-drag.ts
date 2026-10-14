import { Option } from "effect";
import { useCallback, useRef, useState } from "react";
import type { DragEvent } from "react";
import type { DriveNode } from "@effect-app/domain/drive";
import type { FolderId } from "@/features/files/lib/nodes";
import { contentUrl } from "@/features/files/queries/drive-api";

export const NODE_DRAG_TYPE = "application/x-effect-drive-nodes";

export interface DropFolder {
  readonly id: FolderId;
  readonly name: string;
}

export interface DropTargetProps {
  readonly "data-drop-target"?: true;
  readonly onDragEnter: (event: DragEvent<HTMLElement>) => void;
  readonly onDragOver: (event: DragEvent<HTMLElement>) => void;
  readonly onDragLeave: (event: DragEvent<HTMLElement>) => void;
  readonly onDrop: (event: DragEvent<HTMLElement>) => void;
}

export interface NodeDrag {
  readonly start: (event: DragEvent<HTMLElement>, nodes: ReadonlyArray<DriveNode>) => void;
  readonly end: () => void;
  readonly active: boolean;
  readonly targetProps: (folder: DropFolder) => DropTargetProps;
}

const keyOf = (id: FolderId) => id ?? "root";

const offerDownload = (dataTransfer: DataTransfer, node: DriveNode) => {
  const url = new URL(contentUrl(node.id, "attachment"), window.location.origin).toString();
  const type = Option.getOrElse(node.contentType, () => "application/octet-stream").split(";")[0];
  dataTransfer.setData("DownloadURL", `${type}:${node.name}:${url}`);
  dataTransfer.setData("text/uri-list", url);
};

const showCount = (dataTransfer: DataTransfer, count: number) => {
  const badge = document.createElement("div");
  badge.textContent = `${count} items`;
  Object.assign(badge.style, {
    position: "fixed",
    top: "-1000px",
    padding: "4px 10px",
    borderRadius: "6px",
    background: "var(--primary)",
    color: "var(--primary-foreground)",
    font: "500 13px system-ui, sans-serif",
  });
  document.body.append(badge);
  dataTransfer.setDragImage(badge, -12, -12);
  requestAnimationFrame(() => badge.remove());
};

export const useNodeDrag = ({
  currentFolderId,
  onMove,
}: {
  currentFolderId: FolderId;
  onMove: (nodes: ReadonlyArray<DriveNode>, folder: DropFolder) => void;
}): NodeDrag => {
  const dragged = useRef<ReadonlyArray<DriveNode>>([]);
  const [over, setOver] = useState<string | undefined>(undefined);
  const [active, setActive] = useState(false);

  const end = useCallback(() => {
    dragged.current = [];
    setOver(undefined);
    setActive(false);
  }, []);

  const start = (event: DragEvent<HTMLElement>, nodes: ReadonlyArray<DriveNode>) => {
    dragged.current = nodes;
    const { dataTransfer } = event;
    dataTransfer.setData(NODE_DRAG_TYPE, JSON.stringify(nodes.map((node) => node.id)));
    const [only] = nodes;
    if (nodes.length === 1 && only?.kind === "file") {
      offerDownload(dataTransfer, only);
      dataTransfer.effectAllowed = "copyMove";
    } else {
      dataTransfer.effectAllowed = "move";
    }
    if (nodes.length > 1) showCount(dataTransfer, nodes.length);
    requestAnimationFrame(() => setActive(dragged.current.length > 0));
  };

  const accepts = (event: DragEvent<HTMLElement>, folder: DropFolder) =>
    event.dataTransfer.types.includes(NODE_DRAG_TYPE) &&
    dragged.current.length > 0 &&
    keyOf(folder.id) !== keyOf(currentFolderId) &&
    !dragged.current.some((node) => node.id === folder.id);

  const targetProps = (folder: DropFolder): DropTargetProps => {
    const key = keyOf(folder.id);
    return {
      ...(over === key ? { "data-drop-target": true } : {}),
      onDragEnter: (event) => {
        if (!accepts(event, folder)) return;
        event.preventDefault();
        setOver(key);
      },
      onDragOver: (event) => {
        if (!accepts(event, folder)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(key);
      },
      onDragLeave: (event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setOver((current) => (current === key ? undefined : current));
      },
      onDrop: (event) => {
        if (!accepts(event, folder)) return;
        event.preventDefault();
        event.stopPropagation();
        const nodes = dragged.current;
        end();
        onMove(nodes, folder);
      },
    };
  };

  return { start, end, active, targetProps };
};
