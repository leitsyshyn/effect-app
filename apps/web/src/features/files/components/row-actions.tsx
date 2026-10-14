import {
  DownloadIcon,
  EyeIcon,
  FolderInputIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  ListChecksIcon,
  UploadIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { Fragment, useRef } from "react";
import type { ComponentType, ReactNode } from "react";
import type { DriveNode } from "@effect-app/domain/drive";
import { IconButton } from "@/components/icon-button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { contentUrl } from "@/features/files/queries/drive-api";

export type NodeAction = "open" | "rename" | "move" | "delete";

interface MenuParts {
  readonly Item: ComponentType<{
    onSelect?: () => void;
    variant?: "default" | "destructive";
    asChild?: boolean;
    children: ReactNode;
  }>;
  readonly Separator: ComponentType;
  readonly Shortcut: ComponentType<{ children: ReactNode }>;
}

const DROPDOWN: MenuParts = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Shortcut: DropdownMenuShortcut,
};

const CONTEXT: MenuParts = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Shortcut: ContextMenuShortcut,
};

function NodeMenuItems({
  node,
  count,
  parts: { Item, Separator, Shortcut },
  choose,
}: {
  node: DriveNode;
  count: number;
  parts: MenuParts;
  choose: (action: NodeAction) => () => void;
}) {
  const subject = count > 1 ? ` ${count} items` : "";
  return (
    <Fragment>
      <Item onSelect={choose("open")}>
        {node.kind === "folder" ? <FolderOpenIcon aria-hidden /> : <EyeIcon aria-hidden />}
        {node.kind === "folder" ? "Open" : "Preview"}
      </Item>
      {node.kind === "file" && count === 1 && (
        <Item asChild>
          <a href={contentUrl(node.id, "attachment")} download={node.name}>
            <DownloadIcon aria-hidden />
            Download
          </a>
        </Item>
      )}
      <Separator />
      {count === 1 && (
        <Item onSelect={choose("rename")}>
          <PencilIcon aria-hidden />
          Rename
          <Shortcut>F2</Shortcut>
        </Item>
      )}
      <Item onSelect={choose("move")}>
        <FolderInputIcon aria-hidden />
        Move{subject} to…
      </Item>
      <Separator />
      <Item variant="destructive" onSelect={choose("delete")}>
        <Trash2Icon aria-hidden />
        Delete{subject}…<Shortcut>Del</Shortcut>
      </Item>
    </Fragment>
  );
}

const useChosenAction = (
  node: DriveNode,
  onAction: (action: NodeAction, node: DriveNode) => void,
) => {
  const chosen = useRef<NodeAction | null>(null);
  return {
    choose: (action: NodeAction) => () => {
      chosen.current = action;
    },
    onCloseAutoFocus: () => {
      const action = chosen.current;
      chosen.current = null;
      if (action !== null) onAction(action, node);
    },
  };
};

export function RowActions({
  node,
  count = 1,
  onAction,
}: {
  node: DriveNode;
  count?: number;
  onAction: (action: NodeAction, node: DriveNode) => void;
}) {
  const { choose, onCloseAutoFocus } = useChosenAction(node, onAction);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label="More actions"
          aria-label={`Actions for ${node.name}`}
          size="icon-sm"
          className="opacity-0 group-hover/row:opacity-100 group-data-[state=selected]/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
        >
          <MoreHorizontalIcon aria-hidden />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onCloseAutoFocus={onCloseAutoFocus}>
        <NodeMenuItems node={node} count={count} parts={DROPDOWN} choose={choose} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RowContextMenu({
  node,
  count,
  onAction,
  children,
}: {
  node: DriveNode;
  count: number;
  onAction: (action: NodeAction, node: DriveNode) => void;
  children: ReactNode;
}) {
  const { choose, onCloseAutoFocus } = useChosenAction(node, onAction);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52" onCloseAutoFocus={onCloseAutoFocus}>
        <NodeMenuItems node={node} count={count} parts={CONTEXT} choose={choose} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function FolderContextMenu({
  canSelectAll,
  onNewFolder,
  onUpload,
  onSelectAll,
  children,
}: {
  canSelectAll: boolean;
  onNewFolder: () => void;
  onUpload: () => void;
  onSelectAll: () => void;
  children: ReactNode;
}) {
  const chosen = useRef<(() => void) | null>(null);
  const choose = (run: () => void) => () => {
    chosen.current = run;
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        className="w-52"
        onCloseAutoFocus={() => {
          const run = chosen.current;
          chosen.current = null;
          run?.();
        }}
      >
        <ContextMenuItem onSelect={choose(onNewFolder)}>
          <FolderPlusIcon aria-hidden />
          New folder
        </ContextMenuItem>
        <ContextMenuItem onSelect={choose(onUpload)}>
          <UploadIcon aria-hidden />
          Upload files…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!canSelectAll} onSelect={onSelectAll}>
          <ListChecksIcon aria-hidden />
          Select all
          <ContextMenuShortcut>⌘A</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
