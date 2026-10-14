import { useSyncExternalStore } from "react";
import type { NodeId } from "@effect-app/domain/drive";
import type { FolderId } from "./nodes";

export interface RevealRequest {
  readonly folderKey: string;
  readonly ids: ReadonlySet<NodeId>;
}

let pending: RevealRequest | undefined;
const listeners = new Set<() => void>();

const keyOf = (folderId: FolderId) => folderId ?? "root";

export const requestReveal = (folderId: FolderId, ids: Iterable<NodeId>) => {
  pending = { folderKey: keyOf(folderId), ids: new Set(ids) };
  for (const listener of listeners) listener();
};

export const clearReveal = (request: RevealRequest) => {
  if (pending === request) pending = undefined;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useRevealRequest = (folderId: FolderId): RevealRequest | undefined =>
  useSyncExternalStore(subscribe, () =>
    pending?.folderKey === keyOf(folderId) ? pending : undefined,
  );
