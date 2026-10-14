import { Schema, SchemaTransformation } from "effect";
import { UserId } from "./user";

export const NodeId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("NodeId"));
export type NodeId = typeof NodeId.Type;

export const NodeKind = Schema.Literals(["file", "folder"]);
export type NodeKind = typeof NodeKind.Type;

export const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("Revision"),
);
export type Revision = typeof Revision.Type;

export const ContentHash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)).pipe(
  Schema.brand("ContentHash"),
);
export type ContentHash = typeof ContentHash.Type;

export const ChangeCursor = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]*)$/)).pipe(
  Schema.brand("ChangeCursor"),
);
export type ChangeCursor = typeof ChangeCursor.Type;

export const initialCursor = ChangeCursor.make("0");

const MAX_NAME_LENGTH = 255;

export const nodeNameProblem = (name: string): string | undefined => {
  if (name.length === 0) return "Name must not be empty";
  if (name.length > MAX_NAME_LENGTH) return `Name must be at most ${MAX_NAME_LENGTH} characters`;
  if (name === "." || name === "..") return "Name must not be '.' or '..'";
  if (/[/\\\0]/.test(name)) return "Name must not contain '/', '\\' or NUL";
  if (name.trim() !== name) return "Name must not start or end with whitespace";
  return undefined;
};

const ValidNodeName = Schema.String.check(
  Schema.makeFilter((name: string) => nodeNameProblem(name) ?? true),
).pipe(Schema.brand("NodeName"));

export const NodeName = Schema.String.pipe(
  Schema.decodeTo(
    ValidNodeName,
    SchemaTransformation.transform({
      decode: (name: string) => name.normalize("NFC"),
      encode: (name: string) => name,
    }),
  ),
);
export type NodeName = typeof NodeName.Type;

export const UserRef = Schema.Struct({
  id: UserId,
  name: Schema.String,
});
export interface UserRef extends Schema.Schema.Type<typeof UserRef> {}

export const PreviewKind = Schema.Literals(["text", "image", "pdf", "none"]);
export type PreviewKind = typeof PreviewKind.Type;

export const DriveNode = Schema.Struct({
  id: NodeId,
  parentId: Schema.Option(NodeId),
  name: NodeName,
  kind: NodeKind,
  size: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  contentHash: Schema.Option(ContentHash),
  contentType: Schema.Option(Schema.String),
  fileType: Schema.String,
  preview: PreviewKind,
  revision: Revision,
  createdAt: Schema.DateTimeUtc,
  createdBy: UserRef,
  updatedAt: Schema.DateTimeUtc,
  updatedBy: UserRef,
  deletedAt: Schema.Option(Schema.DateTimeUtc),
});
export interface DriveNode extends Schema.Schema.Type<typeof DriveNode> {}

export class NodeNotFound extends Schema.TaggedError<NodeNotFound>()(
  "NodeNotFound",
  { id: NodeId },
  { httpApiStatus: 404 },
) {}

export class ParentNotFolder extends Schema.TaggedError<ParentNotFolder>()(
  "ParentNotFolder",
  { id: NodeId },
  { httpApiStatus: 409 },
) {}

export class NameConflict extends Schema.TaggedError<NameConflict>()(
  "NameConflict",
  { parentId: Schema.Option(NodeId), name: Schema.String },
  { httpApiStatus: 409 },
) {}

export class InvalidMove extends Schema.TaggedError<InvalidMove>()(
  "InvalidMove",
  { id: NodeId, reason: Schema.String },
  { httpApiStatus: 409 },
) {}

export class NotAFile extends Schema.TaggedError<NotAFile>()(
  "NotAFile",
  { id: NodeId },
  { httpApiStatus: 409 },
) {}

export class InvalidUpload extends Schema.TaggedError<InvalidUpload>()(
  "InvalidUpload",
  { reason: Schema.String },
  { httpApiStatus: 400 },
) {}

export class RevisionMismatch extends Schema.TaggedError<RevisionMismatch>()(
  "RevisionMismatch",
  { id: NodeId, expected: Revision, actual: Revision },
  { httpApiStatus: 412 },
) {}
