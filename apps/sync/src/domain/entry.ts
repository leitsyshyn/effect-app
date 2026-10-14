import { Equal } from "effect";
import type { Option } from "effect";
import type { ContentHash, NodeId, NodeKind, Revision } from "@effect-app/domain/drive";
import type { RelativePath } from "./path";

export interface Content {
  readonly kind: NodeKind;
  readonly contentHash: Option.Option<ContentHash>;
}

export interface LocalEntry extends Content {
  readonly empty: boolean;
}

export interface RemoteEntry extends Content {
  readonly nodeId: NodeId;
  readonly parentId: Option.Option<NodeId>;
  readonly revision: Revision;
  readonly empty: boolean;
}

export interface SyncedEntry extends Content {
  readonly path: RelativePath;
  readonly nodeId: NodeId;
  readonly revision: Revision;
  readonly localSize: number;
  readonly localMtimeMs: number;
  readonly localFileId: Option.Option<string>;
}

export const sameContent = (a: Content, b: Content): boolean =>
  a.kind === b.kind && (a.kind === "folder" || Equal.equals(a.contentHash, b.contentHash));
