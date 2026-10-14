import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
  OpenApi,
} from "effect/http-api";
import { UserId } from "@effect-app/domain/user";
import { IssueKind } from "../../domain/issue";
import { SyncStatus } from "../../domain/status";
import { InvalidFolder, NotSignedIn, ServerUnreachable, SignInFailed } from "../pairing/pairing";

export class ControlAuth extends HttpApiMiddleware.Service<ControlAuth>()(
  "effect-app/sync/ControlAuth",
  {
    security: { bearer: HttpApiSecurity.bearer },
    error: HttpApiError.Unauthorized,
  },
) {}

export class IssueNotFound extends Schema.TaggedError<IssueNotFound>()(
  "IssueNotFound",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

export const SessionInfo = Schema.Struct({
  serverUrl: Schema.NullOr(Schema.String),
  user: Schema.NullOr(Schema.Struct({ id: UserId, name: Schema.String, email: Schema.String })),
}).annotate({ identifier: "SessionInfo" });

export const LinkInfo = Schema.Struct({
  id: Schema.String,
  rootPath: Schema.String,
  linkedAt: Schema.DateTimeUtcFromString,
}).annotate({ identifier: "LinkInfo" });

export const PendingItem = Schema.Struct({
  path: Schema.String,
  since: Schema.DateTimeUtcFromString,
  lastError: Schema.NullOr(Schema.String),
}).annotate({ identifier: "PendingItem" });

export const IssueItem = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  kind: IssueKind,
  detail: Schema.String,
  localCopy: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
}).annotate({ identifier: "IssueItem" });

const StatusGroup = HttpApiGroup.make("status")
  .add(HttpApiEndpoint.get("get", "/status", { success: SyncStatus }))
  .add(
    HttpApiEndpoint.get("stream", "/status/stream", {
      success: HttpApiSchema.StreamSse({ data: SyncStatus }),
    }),
  )
  .middleware(ControlAuth);

const SessionGroup = HttpApiGroup.make("session")
  .add(HttpApiEndpoint.get("get", "/session", { success: SessionInfo }))
  .add(
    HttpApiEndpoint.put("signIn", "/session", {
      payload: Schema.Struct({
        serverUrl: Schema.String.check(Schema.isPattern(/^https?:\/\//)),
        token: Schema.NonEmptyString,
      }),
      success: SessionInfo,
      error: [SignInFailed, ServerUnreachable],
    }),
  )
  .add(HttpApiEndpoint.delete("signOut", "/session"))
  .middleware(ControlAuth);

const LinkGroup = HttpApiGroup.make("link")
  .add(HttpApiEndpoint.get("get", "/link", { success: Schema.NullOr(LinkInfo) }))
  .add(
    HttpApiEndpoint.put("link", "/link", {
      payload: Schema.Struct({ localPath: Schema.NonEmptyString }),
      success: LinkInfo,
      error: [InvalidFolder, NotSignedIn],
    }),
  )
  .add(HttpApiEndpoint.delete("unlink", "/link"))
  .middleware(ControlAuth);

const SyncGroup = HttpApiGroup.make("sync")
  .add(HttpApiEndpoint.post("now", "/sync/now"))
  .add(HttpApiEndpoint.post("pause", "/sync/pause"))
  .add(HttpApiEndpoint.post("resume", "/sync/resume"))
  .add(HttpApiEndpoint.get("pending", "/pending", { success: Schema.Array(PendingItem) }))
  .add(HttpApiEndpoint.get("issues", "/issues", { success: Schema.Array(IssueItem) }))
  .add(
    HttpApiEndpoint.delete("dismissIssue", "/issues/:id", {
      params: { id: Schema.String },
      error: IssueNotFound,
    }),
  )
  .middleware(ControlAuth);

export const ControlApi = HttpApi.make("effect-drive-sync")
  .add(StatusGroup)
  .add(SessionGroup)
  .add(LinkGroup)
  .add(SyncGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Effect Drive Sync Daemon",
      version: "1.0.0",
      description:
        "Local control API of the folder synchronization daemon, used by the desktop app.",
    }),
  );
