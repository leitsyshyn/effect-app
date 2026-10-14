import { Effect, Option, Schema } from "effect";
import { MAX_UPLOAD_BYTES } from "@effect-app/api/drive/api";
import { NodeName, nodeNameProblem } from "@effect-app/domain/drive";
import type { DriveNode, NodeId, Revision } from "@effect-app/domain/drive";
import type { ListingFilter, ListingSort } from "@effect-app/domain/listing";
import { ApiClient, apiUrls } from "@/lib/api/client";
import { FileTooLarge, InvalidName } from "@/features/files/lib/drive-errors";
import type { FolderId } from "@/features/files/lib/nodes";

const decodeNodeName = Schema.decodeUnknownEffect(NodeName);

const validName = (name: string) =>
  decodeNodeName(name).pipe(
    Effect.mapError(
      () => new InvalidName({ reason: nodeNameProblem(name.normalize("NFC")) ?? "Invalid name." }),
    ),
  );

const parentQuery = (parentId: FolderId) => (parentId === null ? {} : { parentId });

export const listFolder = Effect.fn("Drive.listFolder")(function* (input: {
  readonly parentId: FolderId;
  readonly sort: ListingSort;
  readonly filter: ListingFilter;
}) {
  const client = yield* ApiClient;
  return yield* client.drive.listFolder({
    query: { ...parentQuery(input.parentId), sort: input.sort, filter: input.filter },
  });
});

export const createFolder = Effect.fn("Drive.createFolder")(function* (input: {
  readonly parentId: FolderId;
  readonly name: string;
}) {
  const client = yield* ApiClient;
  const name = yield* validName(input.name);
  return yield* client.drive.createFolder({ payload: { ...parentQuery(input.parentId), name } });
});

export const renameNode = Effect.fn("Drive.renameNode")(function* (input: {
  readonly node: DriveNode;
  readonly name: string;
}) {
  const client = yield* ApiClient;
  const name = yield* validName(input.name);
  return yield* client.drive.updateNode({
    params: { id: input.node.id },
    payload: { name, expectedRevision: input.node.revision },
  });
});

export const moveNode = Effect.fn("Drive.moveNode")(function* (input: {
  readonly node: DriveNode;
  readonly parentId: FolderId;
}) {
  const client = yield* ApiClient;
  return yield* client.drive.updateNode({
    params: { id: input.node.id },
    payload: { move: parentQuery(input.parentId), expectedRevision: input.node.revision },
  });
});

export const deleteNode = Effect.fn("Drive.deleteNode")(function* (node: DriveNode) {
  const client = yield* ApiClient;
  yield* client.drive.deleteNode({
    params: { id: node.id },
    query: { expectedRevision: node.revision },
  });
});

export interface UploadInput {
  readonly parentId: FolderId;
  readonly name: string;
  readonly file: File;
  readonly expectedRevision: Option.Option<Revision>;
}

export const uploadFile = Effect.fn("Drive.uploadFile")(function* (input: UploadInput) {
  const client = yield* ApiClient;
  const name = yield* validName(input.name);
  if (input.file.size > MAX_UPLOAD_BYTES) {
    return yield* new FileTooLarge({ name, limit: MAX_UPLOAD_BYTES });
  }
  const form = new FormData();
  form.append("file", input.file, name);
  return yield* client.drive.uploadFile({
    query: {
      ...parentQuery(input.parentId),
      name,
      ...Option.match(input.expectedRevision, {
        onNone: () => ({}),
        onSome: (expectedRevision) => ({ expectedRevision }),
      }),
    },
    payload: form,
  });
});

export const contentUrl = (id: NodeId, disposition: "inline" | "attachment"): string =>
  apiUrls.drive.downloadFile({ params: { id }, query: { disposition } });

export const changeStreamUrl = (): string => apiUrls.drive.streamChanges();
