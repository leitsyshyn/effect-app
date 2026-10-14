import { Effect, Option, Stream } from "effect";
import { HttpServerResponse, Multipart } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "@effect-app/api/api";
import { CurrentPrincipal } from "@effect-app/api/auth/middleware";
import { initialCursor, InvalidUpload } from "@effect-app/domain/drive";
import type { DriveNode } from "@effect-app/domain/drive";
import { ALL_TYPES } from "@effect-app/domain/listing";
import { DriveService } from "./service";

const DEFAULT_CHANGE_LIMIT = 500;

const inlineContentType = (node: DriveNode): Option.Option<string> => {
  if (node.preview === "image") return node.contentType;
  if (node.preview === "text") return Option.some("text/plain; charset=utf-8");
  return Option.none();
};

const contentDisposition = (kind: "inline" | "attachment", name: string) =>
  `${kind}; filename*=UTF-8''${encodeURIComponent(name)}`;

const currentUser = Effect.map(Effect.service(CurrentPrincipal), (principal) => principal.user);

export const DriveHandlers = HttpApiBuilder.group(Api, "drive", (handlers) =>
  Effect.gen(function* () {
    const drive = yield* DriveService;

    return handlers
      .handle("listFolder", ({ query }) =>
        Effect.flatMap(currentUser, (user) =>
          drive.listFolder(user, {
            parentId: Option.fromUndefinedOr(query.parentId),
            sort: query.sort ?? "modified-desc",
            filter: query.filter ?? ALL_TYPES,
          }),
        ).pipe(Effect.catchTag("PersistenceError", Effect.die)),
      )
      .handle("getNode", ({ params }) =>
        Effect.flatMap(currentUser, (user) => drive.getNode(user, params.id)).pipe(
          Effect.catchTag("PersistenceError", Effect.die),
        ),
      )
      .handle("createFolder", ({ payload }) =>
        Effect.flatMap(currentUser, (user) =>
          drive.createFolder(user, {
            parentId: Option.fromUndefinedOr(payload.parentId),
            name: payload.name,
          }),
        ).pipe(Effect.catchTag("PersistenceError", Effect.die)),
      )
      .handle("uploadFile", ({ query, payload }) =>
        Effect.gen(function* () {
          const user = yield* currentUser;
          const uploaded = yield* payload.pipe(
            Stream.filter(
              (part): part is Multipart.File => Multipart.isFile(part) && part.key === "file",
            ),
            Stream.take(1),
            Stream.mapEffect((file) =>
              drive.uploadFile(user, {
                parentId: Option.fromUndefinedOr(query.parentId),
                name: query.name,
                expectedRevision: Option.fromUndefinedOr(query.expectedRevision),
                content: file.content,
              }),
            ),
            Stream.runHead,
          );
          return yield* Effect.fromOption(uploaded).pipe(
            Effect.mapError(() => new InvalidUpload({ reason: "Missing multipart field 'file'" })),
          );
        }).pipe(
          Effect.catchTag("MultipartError", (error) =>
            Effect.fail(new InvalidUpload({ reason: error.message })),
          ),
          Effect.catchTag(["PersistenceError", "BlobStoreError"], Effect.die),
        ),
      )
      .handle("downloadFile", ({ params, query }) =>
        Effect.gen(function* () {
          const user = yield* currentUser;
          const { node, content } = yield* drive.downloadFile(user, params.id);
          const inline =
            query.disposition !== "attachment" ? inlineContentType(node) : Option.none();
          return HttpServerResponse.stream(content.pipe(Stream.orDie), {
            contentType: Option.getOrElse(inline, () => "application/octet-stream"),
            contentLength: node.size,
            headers: {
              "content-disposition": contentDisposition(
                Option.isSome(inline) ? "inline" : "attachment",
                node.name,
              ),
              "x-content-type-options": "nosniff",
              "content-security-policy": "sandbox; default-src 'none'; img-src 'self'",
              "cache-control": "private, no-cache",
            },
          });
        }).pipe(Effect.catchTag("PersistenceError", Effect.die)),
      )
      .handle("updateNode", ({ params, payload }) =>
        Effect.flatMap(currentUser, (user) =>
          drive.updateNode(user, params.id, {
            name: Option.fromUndefinedOr(payload.name),
            parentId: Option.map(Option.fromUndefinedOr(payload.move), (move) =>
              Option.fromUndefinedOr(move.parentId),
            ),
            expectedRevision: payload.expectedRevision,
          }),
        ).pipe(Effect.catchTag("PersistenceError", Effect.die)),
      )
      .handle("deleteNode", ({ params, query }) =>
        Effect.flatMap(currentUser, (user) =>
          drive.deleteNode(user, params.id, Option.fromUndefinedOr(query.expectedRevision)),
        ).pipe(Effect.catchTag("PersistenceError", Effect.die)),
      )
      .handle("listChanges", ({ query }) =>
        Effect.flatMap(currentUser, (user) =>
          drive.listChanges(user, {
            cursor: query.cursor ?? initialCursor,
            limit: query.limit ?? DEFAULT_CHANGE_LIMIT,
          }),
        ).pipe(Effect.catchTag("PersistenceError", Effect.die)),
      )
      .handle("streamChanges", () =>
        Effect.map(currentUser, (user) =>
          drive.changeNotifications(user).pipe(
            Stream.map((cursor) => ({ cursor })),
            Stream.orDie,
          ),
        ),
      );
  }),
);

export const HealthHandlers = HttpApiBuilder.group(Api, "health", (handlers) =>
  handlers.handle("health", () => Effect.succeed({ status: "ok" as const })),
);
