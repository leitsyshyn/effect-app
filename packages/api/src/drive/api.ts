import { Schema } from "effect";
import { Multipart } from "effect/http";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import {
  ChangeCursor,
  ContentHash,
  DriveNode,
  InvalidMove,
  InvalidUpload,
  NameConflict,
  NodeId,
  NodeName,
  NodeNotFound,
  NotAFile,
  ParentNotFolder,
  Revision,
  RevisionMismatch,
} from "@effect-app/domain/drive";
import { ListingFilterFromString, ListingSort, TypeCount } from "@effect-app/domain/listing";
import { AuthMiddleware } from "../auth/middleware";

export const DriveNodeResponse = DriveNode.pipe(
  Schema.fieldsAssign({
    parentId: Schema.OptionFromNullOr(NodeId),
    contentHash: Schema.OptionFromNullOr(ContentHash),
    contentType: Schema.OptionFromNullOr(Schema.String),
    createdAt: Schema.DateTimeUtcFromString,
    updatedAt: Schema.DateTimeUtcFromString,
    deletedAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
  }),
).annotate({ identifier: "DriveNode" });

export const FolderListing = Schema.Struct({
  path: Schema.Array(DriveNodeResponse),
  nodes: Schema.Array(DriveNodeResponse),
  types: Schema.Array(TypeCount),
}).annotate({ identifier: "FolderListing" });

export const MoveTarget = Schema.Struct({
  parentId: Schema.optionalKey(NodeId),
}).annotate({ identifier: "MoveTarget" });

export const ChangePage = Schema.Struct({
  nodes: Schema.Array(DriveNodeResponse),
  cursor: ChangeCursor,
  hasMore: Schema.Boolean,
}).annotate({ identifier: "ChangePage" });

export const ChangeNotification = Schema.Struct({
  cursor: ChangeCursor,
}).annotate({ identifier: "ChangeNotification" });

export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

export const UploadPayload = Schema.Struct({
  file: Multipart.SingleFileSchema,
}).pipe(HttpApiSchema.asMultipartStream({ maxFileSize: MAX_UPLOAD_BYTES }));

export const DriveApi = HttpApiGroup.make("drive")
  .add(
    HttpApiEndpoint.get("listFolder", "/api/drive/nodes", {
      query: {
        parentId: Schema.optionalKey(NodeId),
        sort: Schema.optionalKey(ListingSort),
        filter: Schema.optionalKey(ListingFilterFromString),
      },
      success: FolderListing,
      error: [NodeNotFound, ParentNotFolder],
    }),
  )
  .add(
    HttpApiEndpoint.get("getNode", "/api/drive/nodes/:id", {
      params: { id: NodeId },
      success: DriveNodeResponse,
      error: NodeNotFound,
    }),
  )
  .add(
    HttpApiEndpoint.post("createFolder", "/api/drive/folders", {
      payload: Schema.Struct({ parentId: Schema.optionalKey(NodeId), name: NodeName }),
      success: DriveNodeResponse.pipe(HttpApiSchema.status(201)),
      error: [NodeNotFound, ParentNotFolder, NameConflict],
    }),
  )
  .add(
    HttpApiEndpoint.post("uploadFile", "/api/drive/files", {
      query: {
        parentId: Schema.optionalKey(NodeId),
        name: NodeName,
        expectedRevision: Schema.optionalKey(Revision),
      },
      payload: UploadPayload,
      success: DriveNodeResponse,
      error: [
        NodeNotFound,
        ParentNotFolder,
        NameConflict,
        NotAFile,
        RevisionMismatch,
        InvalidUpload,
      ],
    }),
  )
  .add(
    HttpApiEndpoint.get("downloadFile", "/api/drive/files/:id/content", {
      params: { id: NodeId },
      query: { disposition: Schema.optionalKey(Schema.Literals(["inline", "attachment"])) },
      success: HttpApiSchema.StreamUint8Array(),
      error: [NodeNotFound, NotAFile],
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateNode", "/api/drive/nodes/:id", {
      params: { id: NodeId },
      payload: Schema.Struct({
        name: Schema.optionalKey(NodeName),
        move: Schema.optionalKey(MoveTarget),
        expectedRevision: Revision,
      }),
      success: DriveNodeResponse,
      error: [NodeNotFound, ParentNotFolder, NameConflict, InvalidMove, RevisionMismatch],
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteNode", "/api/drive/nodes/:id", {
      params: { id: NodeId },
      query: { expectedRevision: Schema.optionalKey(Revision) },
      error: [NodeNotFound, RevisionMismatch],
    }),
  )
  .add(
    HttpApiEndpoint.get("listChanges", "/api/drive/changes", {
      query: {
        cursor: Schema.optionalKey(ChangeCursor),
        limit: Schema.optionalKey(
          Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
        ),
      },
      success: ChangePage,
    }),
  )
  .add(
    HttpApiEndpoint.get("streamChanges", "/api/drive/changes/stream", {
      success: HttpApiSchema.StreamSse({ data: ChangeNotification }),
    }),
  )
  .middleware(AuthMiddleware);

export const HealthApi = HttpApiGroup.make("health").add(
  HttpApiEndpoint.get("health", "/api/health", {
    success: Schema.Struct({ status: Schema.Literal("ok") }),
  }),
);
