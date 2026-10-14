import { Effect, Option, Redacted } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { describeIssue } from "../../domain/issue";
import { Pairing } from "../pairing/pairing";
import { Issues } from "../replica/issues";
import { Supervisor } from "../replica/supervisor";
import { WorkQueue } from "../replica/work-queue";
import { Settings } from "../settings/settings";
import { SyncStatusService } from "../status/status";
import { ControlApi, IssueNotFound } from "./api";

export const StatusHandlers = HttpApiBuilder.group(ControlApi, "status", (handlers) =>
  Effect.gen(function* () {
    const status = yield* SyncStatusService;
    return handlers
      .handle("get", () => status.current)
      .handle("stream", () => Effect.succeed(status.changes));
  }),
);

export const SessionHandlers = HttpApiBuilder.group(ControlApi, "session", (handlers) =>
  Effect.gen(function* () {
    const pairing = yield* Pairing;
    const settings = yield* Settings;
    return handlers
      .handle("get", () =>
        Effect.map(settings.current, ({ session }) => ({
          serverUrl: Option.getOrNull(Option.map(session, (s) => s.serverUrl)),
          user: Option.getOrNull(Option.map(session, (s) => s.user)),
        })),
      )
      .handle("signIn", ({ payload }) => {
        const serverUrl = payload.serverUrl.replace(/\/+$/, "");
        return pairing.signIn(serverUrl, Redacted.make(payload.token)).pipe(
          Effect.map((user) => ({
            serverUrl,
            user: { id: user.id, name: user.name, email: user.email },
          })),
          Effect.catchTag("StoreFailed", Effect.die),
        );
      })
      .handle("signOut", () => pairing.signOut.pipe(Effect.catchTag("StoreFailed", Effect.die)));
  }),
);

export const LinkHandlers = HttpApiBuilder.group(ControlApi, "link", (handlers) =>
  Effect.gen(function* () {
    const pairing = yield* Pairing;
    const settings = yield* Settings;
    return handlers
      .handle("get", () => Effect.map(settings.current, ({ link }) => Option.getOrNull(link)))
      .handle("link", ({ payload }) =>
        pairing.link(payload.localPath).pipe(Effect.catchTag("StoreFailed", Effect.die)),
      )
      .handle("unlink", () => pairing.unlink.pipe(Effect.catchTag("StoreFailed", Effect.die)));
  }),
);

export const SyncHandlers = HttpApiBuilder.group(ControlApi, "sync", (handlers) =>
  Effect.gen(function* () {
    const pairing = yield* Pairing;
    const supervisor = yield* Supervisor;
    const queue = yield* WorkQueue;
    const issues = yield* Issues;
    return handlers
      .handle("now", () => supervisor.syncNow)
      .handle("pause", () => pairing.pause.pipe(Effect.catchTag("StoreFailed", Effect.die)))
      .handle("resume", () => pairing.resume.pipe(Effect.catchTag("StoreFailed", Effect.die)))
      .handle("pending", () =>
        queue.pending.pipe(
          Effect.map((items) =>
            items.map((item) => ({
              path: item.path,
              since: item.since,
              lastError: Option.getOrNull(item.lastError),
            })),
          ),
          Effect.catchTag("StoreFailed", Effect.die),
        ),
      )
      .handle("issues", () =>
        issues.list.pipe(
          Effect.map((items) =>
            items.map((item) => ({
              id: item.id,
              path: item.path,
              kind: item.kind,
              detail: describeIssue(item.kind, Option.getOrUndefined(item.reason)),
              localCopy: Option.getOrNull(item.localCopy),
              createdAt: item.createdAt,
            })),
          ),
          Effect.catchTag("StoreFailed", Effect.die),
        ),
      )
      .handle("dismissIssue", ({ params }) =>
        issues.dismiss(params.id).pipe(
          Effect.flatMap((removed) =>
            removed ? Effect.void : Effect.fail(new IssueNotFound({ id: params.id })),
          ),
          Effect.catchTag("StoreFailed", Effect.die),
        ),
      );
  }),
);
