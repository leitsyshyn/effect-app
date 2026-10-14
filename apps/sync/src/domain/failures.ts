import { Match, Schema } from "effect";

export class RemoteUnavailable extends Schema.TaggedError<RemoteUnavailable>()(
  "RemoteUnavailable",
  {
    cause: Schema.Defect(),
    serverAnswered: Schema.optionalKey(Schema.Boolean),
  },
) {}

export class SessionRejected extends Schema.TaggedError<SessionRejected>()("SessionRejected", {}) {}

export class RemoteRejected extends Schema.TaggedError<RemoteRejected>()("RemoteRejected", {
  reason: Schema.String,
}) {}

export class RemoteOutdated extends Schema.TaggedError<RemoteOutdated>()("RemoteOutdated", {
  reason: Schema.String,
}) {}

export class FolderUnavailable extends Schema.TaggedError<FolderUnavailable>()(
  "FolderUnavailable",
  {
    reason: Schema.String,
  },
) {}

export class LocalChanged extends Schema.TaggedError<LocalChanged>()("LocalChanged", {
  path: Schema.String,
}) {}

export class LocalIoFailed extends Schema.TaggedError<LocalIoFailed>()("LocalIoFailed", {
  operation: Schema.String,
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

export class StoreFailed extends Schema.TaggedError<StoreFailed>()("StoreFailed", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export class NotConverging extends Schema.TaggedError<NotConverging>()("NotConverging", {
  path: Schema.String,
}) {}

export type RemoteFailure = RemoteUnavailable | SessionRejected | RemoteRejected | RemoteOutdated;

export type SyncFailure =
  | RemoteFailure
  | FolderUnavailable
  | LocalChanged
  | LocalIoFailed
  | StoreFailed
  | NotConverging;

export const describeFailure = (failure: SyncFailure): string =>
  Match.valueTags(failure, {
    RemoteUnavailable: ({ serverAnswered }) =>
      serverAnswered === true
        ? "The server failed to handle the request"
        : "The server cannot be reached",
    SessionRejected: () => "The server no longer accepts this session",
    RemoteRejected: ({ reason }) => reason,
    RemoteOutdated: ({ reason }) => reason,
    FolderUnavailable: ({ reason }) => reason,
    LocalChanged: ({ path }) => `${path} changed while it was being synced`,
    LocalIoFailed: ({ operation, path }) => `Could not ${operation} ${path}`,
    StoreFailed: ({ operation }) => `Could not update local sync state (${operation})`,
    NotConverging: ({ path }) => `${path} kept changing on both sides`,
  });
