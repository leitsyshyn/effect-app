import { Context } from "effect";
import type { Effect, Option, Stream } from "effect";
import type { ChangePage } from "@effect-app/api/drive/api";
import type { ChangeCursor, DriveNode, NodeId, NodeName, Revision } from "@effect-app/domain/drive";
import type { User } from "@effect-app/domain/user";
import type { RemoteFailure } from "../../domain/failures";

export interface UploadRequest {
  readonly parentId: Option.Option<NodeId>;
  readonly name: NodeName;
  readonly expectedRevision: Option.Option<Revision>;
  readonly absolutePath: string;
}

export interface MoveRequest {
  readonly id: NodeId;
  readonly name: Option.Option<NodeName>;
  readonly parentId: Option.Option<Option.Option<NodeId>>;
  readonly expectedRevision: Revision;
}

interface RemoteDriveInterface {
  readonly me: Effect.Effect<User, RemoteFailure>;
  readonly listChanges: (
    cursor: ChangeCursor,
  ) => Effect.Effect<typeof ChangePage.Type, RemoteFailure>;
  readonly notifications: Stream.Stream<ChangeCursor, RemoteFailure>;
  readonly upload: (request: UploadRequest) => Effect.Effect<DriveNode, RemoteFailure>;
  readonly download: (id: NodeId) => Stream.Stream<Uint8Array, RemoteFailure>;
  readonly createFolder: (
    parentId: Option.Option<NodeId>,
    name: NodeName,
  ) => Effect.Effect<DriveNode, RemoteFailure>;
  readonly moveNode: (request: MoveRequest) => Effect.Effect<DriveNode, RemoteFailure>;
  readonly deleteNode: (
    id: NodeId,
    expectedRevision: Revision,
  ) => Effect.Effect<void, RemoteFailure>;
}

export class RemoteDrive extends Context.Service<RemoteDrive, RemoteDriveInterface>()(
  "effect-app/sync/RemoteDrive",
) {}
