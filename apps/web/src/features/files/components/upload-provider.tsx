import { Option } from "effect";
import { createContext, use, useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { ReactNode } from "react";
import { describeDriveError, isNameConflict } from "@/features/files/lib/drive-errors";
import type { FolderId } from "@/features/files/lib/nodes";
import {
  findByName,
  initialUploadQueue,
  uploadQueueReducer,
} from "@/features/files/lib/upload-queue";
import type {
  ConflictResolution,
  UploadItem,
  UploadQueueState,
} from "@/features/files/lib/upload-queue";
import { fetchFolderNodes, useUploadFile } from "@/features/files/queries/drive-queries";

const MAX_CONCURRENT_UPLOADS = 3;

export interface UploadTarget {
  readonly parentId: FolderId;
  readonly folderName: string;
}

interface UploadQueue {
  readonly state: UploadQueueState;
  readonly enqueue: (files: ReadonlyArray<File>, target: UploadTarget) => void;
  readonly resolve: (id: string, resolution: ConflictResolution) => void;
  readonly resolveAll: (resolution: ConflictResolution) => void;
  readonly retry: (id: string) => void;
  readonly cancel: (id: string) => void;
  readonly clearFinished: () => void;
}

const UploadQueueContext = createContext<UploadQueue | undefined>(undefined);

export function useUploadQueue(): UploadQueue {
  const queue = use(UploadQueueContext);
  if (queue === undefined) throw new Error("useUploadQueue must be used inside UploadProvider");
  return queue;
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const { mutateAsync: upload } = useUploadFile();
  const [state, dispatch] = useReducer(uploadQueueReducer, initialUploadQueue);
  const running = useRef(new Map<string, AbortController>());

  const run = useCallback(
    (item: UploadItem) => {
      const controller = new AbortController();
      running.current.set(item.id, controller);
      dispatch({ _tag: "Start", id: item.id });
      const input = {
        parentId: item.parentId,
        name: item.name,
        file: item.file,
        expectedRevision: item.expectedRevision,
      };
      upload({ input, signal: controller.signal })
        .then(() => dispatch({ _tag: "Succeed", id: item.id }))
        .catch(async (error: unknown) => {
          if (controller.signal.aborted) return;
          if (!isNameConflict(error)) {
            dispatch({ _tag: "Fail", id: item.id, message: describeDriveError(error) });
            return;
          }
          try {
            const siblings = await fetchFolderNodes(item.parentId);
            dispatch({
              _tag: "Conflict",
              id: item.id,
              existing: findByName(siblings, item.name),
              siblingNames: siblings.map((node) => node.name),
            });
          } catch (listingError) {
            dispatch({ _tag: "Fail", id: item.id, message: describeDriveError(listingError) });
          }
        })
        .finally(() => {
          if (running.current.get(item.id) === controller) running.current.delete(item.id);
        });
    },
    [upload],
  );

  useEffect(() => {
    const active = state.items.filter((item) => item.status._tag === "Uploading").length;
    const ready = state.items.filter(
      (item) => item.status._tag === "Queued" && !running.current.has(item.id),
    );
    for (const item of ready.slice(0, Math.max(0, MAX_CONCURRENT_UPLOADS - active))) run(item);
  }, [state.items, run]);

  useEffect(() => {
    const controllers = running.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
    };
  }, []);

  const queue = useMemo<UploadQueue>(
    () => ({
      state,
      enqueue: (files, target) =>
        dispatch({
          _tag: "Add",
          items: files.map((file) => ({
            id: crypto.randomUUID(),
            file,
            parentId: target.parentId,
            folderName: target.folderName,
            name: file.name,
            expectedRevision: Option.none(),
            status: { _tag: "Queued" },
          })),
        }),
      resolve: (id, resolution) => dispatch({ _tag: "Resolve", id, resolution }),
      resolveAll: (resolution) => dispatch({ _tag: "ResolveAll", resolution }),
      retry: (id) => dispatch({ _tag: "Retry", id }),
      cancel: (id) => {
        running.current.get(id)?.abort();
        running.current.delete(id);
        dispatch({ _tag: "Cancel", id });
      },
      clearFinished: () => dispatch({ _tag: "ClearFinished" }),
    }),
    [state],
  );

  return <UploadQueueContext value={queue}>{children}</UploadQueueContext>;
}
