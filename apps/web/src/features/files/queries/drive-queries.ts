import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { Option } from "effect";
import type { Effect } from "effect";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { DriveNode, NodeId } from "@effect-app/domain/drive";
import { apiRuntime } from "@/lib/api/client";
import type { ApiClient } from "@/lib/api/client";
import { deleteReport, moveReport, settleEach } from "@/features/files/lib/bulk-outcome";
import type { BulkReport } from "@/features/files/lib/bulk-outcome";
import {
  ContentUnavailable,
  describeDriveError,
  shouldRetry,
} from "@/features/files/lib/drive-errors";
import { DEFAULT_FILTER, DEFAULT_SORT } from "@/features/files/lib/drive-search";
import type { ListingOptions } from "@/features/files/lib/drive-search";
import type { FolderId } from "@/features/files/lib/nodes";
import { requestReveal } from "@/features/files/lib/reveal";
import { toastActions } from "@/components/toast-actions";
import type { ToastAction } from "@/components/toast-actions";
import {
  contentUrl,
  createFolder,
  deleteNode,
  listFolder,
  moveNode,
  renameNode,
  uploadFile,
} from "./drive-api";
import type { UploadInput } from "./drive-api";

const run = <A, E>(effect: Effect.Effect<A, E, ApiClient>, signal?: AbortSignal): Promise<A> =>
  apiRuntime.runPromise(effect, signal === undefined ? undefined : { signal });

export const driveKeys = {
  all: ["drive"] as const,
  folder: (parentId: FolderId, options: ListingOptions) =>
    ["drive", "folder", parentId ?? "root", options.sort, options.filter] as const,
  textContent: (node: DriveNode) => ["drive", "text", node.id, node.revision] as const,
};

export const folderQueryOptions = (parentId: FolderId, options: ListingOptions) =>
  queryOptions({
    queryKey: driveKeys.folder(parentId, options),
    queryFn: ({ signal }) => run(listFolder({ parentId, ...options }), signal),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === (parentId ?? "root") ? previous : undefined,
    retry: shouldRetry,
  });

export const fetchFolderNodes = async (parentId: FolderId): Promise<ReadonlyArray<DriveNode>> => {
  const listing = await run(listFolder({ parentId, sort: DEFAULT_SORT, filter: DEFAULT_FILTER }));
  return listing.nodes;
};

export const TEXT_PREVIEW_LIMIT = 512 * 1024;

export interface TextPreview {
  readonly text: string;
  readonly truncated: boolean;
}

const readTextPreview = async (node: DriveNode, signal: AbortSignal): Promise<TextPreview> => {
  const response = await fetch(contentUrl(node.id, "inline"), { signal });
  if (!response.ok || response.body === null) {
    throw new ContentUnavailable({ status: response.status });
  }
  const reader = response.body.getReader();
  const chunks: Array<Uint8Array> = [];
  let received = 0;
  while (received < TEXT_PREVIEW_LIMIT) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
  }
  const truncated = received >= TEXT_PREVIEW_LIMIT && received < node.size;
  if (truncated) await reader.cancel();
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(received, TEXT_PREVIEW_LIMIT)));
  return { text, truncated };
};

export const textPreviewQueryOptions = (node: DriveNode) =>
  queryOptions({
    queryKey: driveKeys.textContent(node),
    queryFn: ({ signal }) => readTextPreview(node, signal),
    retry: shouldRetry,
    staleTime: Number.POSITIVE_INFINITY,
  });

const useReveal = () => {
  const navigate = useNavigate();
  return useCallback(
    (folderId: FolderId, ids: ReadonlyArray<NodeId>) => {
      requestReveal(folderId, ids);
      const search = (previous: { readonly sort?: ListingOptions["sort"] }) =>
        previous.sort === undefined ? {} : { sort: previous.sort };
      void (folderId === null
        ? navigate({ to: "/", search })
        : navigate({ to: "/folders/$folderId", params: { folderId }, search }));
    },
    [navigate],
  );
};

const viewAction = (onClick: () => void): ToastAction => ({ label: "View", onClick });

const useDriveMutation = <V, A>(options: {
  readonly mutationFn: (variables: V) => Effect.Effect<A, unknown, ApiClient>;
  readonly successMessage: (variables: V, result: A) => string;
  readonly shows: (result: A) => DriveNode;
}) => {
  const queryClient = useQueryClient();
  const reveal = useReveal();
  return useMutation({
    mutationFn: (variables: V) => run(options.mutationFn(variables)),
    onSuccess: (result, variables) => {
      const node = options.shows(result);
      toast.success(
        options.successMessage(variables, result),
        toastActions([viewAction(() => reveal(Option.getOrNull(node.parentId), [node.id]))]),
      );
    },
    onError: (error) => {
      toast.error(describeDriveError(error));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: driveKeys.all }),
  });
};

export const useCreateFolder = () =>
  useDriveMutation({
    mutationFn: createFolder,
    successMessage: (_, folder) => `Created “${folder.name}”`,
    shows: (folder) => folder,
  });

export const useRenameNode = () =>
  useDriveMutation({
    mutationFn: renameNode,
    successMessage: (_, renamed) => `Renamed to “${renamed.name}”`,
    shows: (renamed) => renamed,
  });

const showReport = (report: BulkReport, actions: ReadonlyArray<ToastAction> = []) => {
  const description = report.details.length === 0 ? {} : { description: report.details.join("\n") };
  const lingering = actions.length === 0 ? {} : { ...toastActions(actions), duration: 8000 };
  switch (report.level) {
    case "success":
      return toast.success(report.title, lingering);
    case "partial":
      return toast.warning(report.title, { ...description, ...lingering, duration: 8000 });
    case "failure":
      return toast.error(report.title, description);
  }
};

export interface MoveNodesInput {
  readonly nodes: ReadonlyArray<DriveNode>;
  readonly parentId: FolderId;
  readonly destinationName: string;
  readonly sourceName: string;
  readonly isUndo?: boolean;
}

export const useMoveNodes = () => {
  const queryClient = useQueryClient();
  const reveal = useReveal();
  const undo = useRef<(input: MoveNodesInput) => void>(() => {});
  const mutation = useMutation({
    mutationFn: ({ nodes, parentId }: MoveNodesInput) =>
      settleEach(nodes, (node) => run(moveNode({ node, parentId }))),
    onSuccess: (outcome, input) => {
      const moved = outcome.succeeded.map(({ result }) => result);
      const from = input.nodes[0] === undefined ? null : Option.getOrNull(input.nodes[0].parentId);
      showReport(
        moveReport(outcome, input.destinationName),
        moved.length === 0
          ? []
          : [
              viewAction(() =>
                reveal(
                  input.parentId,
                  moved.map((node) => node.id),
                ),
              ),
              ...(input.isUndo === true
                ? []
                : [
                    {
                      label: "Undo",
                      onClick: () =>
                        undo.current({
                          nodes: moved,
                          parentId: from,
                          destinationName: input.sourceName,
                          sourceName: input.destinationName,
                          isUndo: true,
                        }),
                    },
                  ]),
            ],
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: driveKeys.all }),
  });
  const { mutate } = mutation;
  useEffect(() => {
    undo.current = mutate;
  }, [mutate]);
  return mutation;
};

export const useDeleteNodes = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (nodes: ReadonlyArray<DriveNode>) =>
      settleEach(nodes, (node) => run(deleteNode(node))),
    onSuccess: (outcome) => {
      showReport(deleteReport(outcome));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: driveKeys.all }),
  });
};

export const useUploadFile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      input,
      signal,
    }: {
      readonly input: UploadInput;
      readonly signal: AbortSignal;
    }) => run(uploadFile(input), signal),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: driveKeys.all }),
  });
};
