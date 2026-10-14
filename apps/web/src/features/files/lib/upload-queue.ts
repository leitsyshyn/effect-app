import { Option } from "effect";
import type { DriveNode, Revision } from "@effect-app/domain/drive";
import { keepBothName, nameKey } from "./file-names";
import type { FolderId } from "./nodes";

export type UploadStatus =
  | { readonly _tag: "Queued" }
  | { readonly _tag: "Uploading" }
  | {
      readonly _tag: "Conflict";
      readonly existing: DriveNode | undefined;
      readonly siblingNames: ReadonlyArray<string>;
    }
  | { readonly _tag: "Done" }
  | { readonly _tag: "Failed"; readonly message: string }
  | { readonly _tag: "Skipped" }
  | { readonly _tag: "Cancelled" };

export interface UploadItem {
  readonly id: string;
  readonly file: File;
  readonly parentId: FolderId;
  readonly folderName: string;
  readonly name: string;
  readonly expectedRevision: Option.Option<Revision>;
  readonly status: UploadStatus;
}

export type ConflictResolution = "replace" | "keep-both" | "skip";

export interface UploadQueueState {
  readonly items: ReadonlyArray<UploadItem>;
  readonly policy: ConflictResolution | undefined;
}

export type UploadAction =
  | { readonly _tag: "Add"; readonly items: ReadonlyArray<UploadItem> }
  | { readonly _tag: "Start"; readonly id: string }
  | { readonly _tag: "Succeed"; readonly id: string }
  | { readonly _tag: "Fail"; readonly id: string; readonly message: string }
  | {
      readonly _tag: "Conflict";
      readonly id: string;
      readonly existing: DriveNode | undefined;
      readonly siblingNames: ReadonlyArray<string>;
    }
  | { readonly _tag: "Resolve"; readonly id: string; readonly resolution: ConflictResolution }
  | { readonly _tag: "ResolveAll"; readonly resolution: ConflictResolution }
  | { readonly _tag: "Retry"; readonly id: string }
  | { readonly _tag: "Cancel"; readonly id: string }
  | { readonly _tag: "ClearFinished" };

export const initialUploadQueue: UploadQueueState = { items: [], policy: undefined };

export const isPending = (item: UploadItem): boolean =>
  item.status._tag === "Queued" ||
  item.status._tag === "Uploading" ||
  item.status._tag === "Conflict";

export const canReplace = (status: UploadStatus): boolean =>
  status._tag === "Conflict" && status.existing?.kind === "file";

const queued: UploadStatus = { _tag: "Queued" };

const resolveItem = (
  item: UploadItem,
  resolution: ConflictResolution,
  items: ReadonlyArray<UploadItem>,
): UploadItem => {
  const status = item.status;
  if (status._tag !== "Conflict") return item;
  switch (resolution) {
    case "skip":
      return { ...item, status: { _tag: "Skipped" } };
    case "replace":
      return status.existing?.kind === "file"
        ? { ...item, expectedRevision: Option.some(status.existing.revision), status: queued }
        : item;
    case "keep-both": {
      const claimed = items
        .filter((other) => other.id !== item.id && other.parentId === item.parentId)
        .filter((other) => isPending(other) || other.status._tag === "Done")
        .map((other) => other.name);
      const name = keepBothName(item.name, [...status.siblingNames, ...claimed]);
      return { ...item, name, expectedRevision: Option.none(), status: queued };
    }
  }
};

const update = (
  state: UploadQueueState,
  id: string,
  f: (item: UploadItem) => UploadItem,
): UploadQueueState => ({
  ...state,
  items: state.items.map((item) => (item.id === id ? f(item) : item)),
});

const step = (state: UploadQueueState, action: UploadAction): UploadQueueState => {
  switch (action._tag) {
    case "Add":
      return { ...state, items: [...state.items, ...action.items] };
    case "Start":
      return update(state, action.id, (item) =>
        item.status._tag === "Queued" ? { ...item, status: { _tag: "Uploading" } } : item,
      );
    case "Succeed":
      return update(state, action.id, (item) => ({ ...item, status: { _tag: "Done" } }));
    case "Fail":
      return update(state, action.id, (item) =>
        item.status._tag === "Uploading"
          ? { ...item, status: { _tag: "Failed", message: action.message } }
          : item,
      );
    case "Conflict": {
      const withConflict = update(state, action.id, (item) =>
        item.status._tag === "Uploading"
          ? {
              ...item,
              status: {
                _tag: "Conflict",
                existing: action.existing,
                siblingNames: action.siblingNames,
              },
            }
          : item,
      );
      const policy = state.policy;
      return policy === undefined
        ? withConflict
        : update(withConflict, action.id, (item) => resolveItem(item, policy, withConflict.items));
    }
    case "Resolve":
      return update(state, action.id, (item) => resolveItem(item, action.resolution, state.items));
    case "ResolveAll": {
      let next: UploadQueueState = { ...state, policy: action.resolution };
      for (const item of state.items) {
        if (item.status._tag !== "Conflict") continue;
        next = update(next, item.id, (current) =>
          resolveItem(current, action.resolution, next.items),
        );
      }
      return next;
    }
    case "Retry":
      return update(state, action.id, (item) =>
        item.status._tag === "Failed" || item.status._tag === "Cancelled"
          ? { ...item, expectedRevision: Option.none(), status: queued }
          : item,
      );
    case "Cancel":
      return update(state, action.id, (item) =>
        isPending(item) ? { ...item, status: { _tag: "Cancelled" } } : item,
      );
    case "ClearFinished":
      return { ...state, items: state.items.filter(isPending) };
  }
};

export const uploadQueueReducer = (
  state: UploadQueueState,
  action: UploadAction,
): UploadQueueState => {
  const next = step(state, action);
  return next.policy !== undefined && !next.items.some(isPending)
    ? { ...next, policy: undefined }
    : next;
};

export const nextConflict = (state: UploadQueueState): UploadItem | undefined =>
  state.items.find((item) => item.status._tag === "Conflict");

export const findByName = (nodes: ReadonlyArray<DriveNode>, name: string): DriveNode | undefined =>
  nodes.find((node) => nameKey(node.name) === nameKey(name));
