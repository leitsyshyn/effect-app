import { Effect, Layer, Match, Option, Stream } from "effect";
import type { Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import type { HttpClientError } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import type { HttpApiError } from "effect/http-api";
import type { Sse } from "effect/encoding";
import { Api } from "@effect-app/api/api";
import type {
  InvalidMove,
  InvalidUpload,
  NameConflict,
  NodeNotFound,
  NotAFile,
  ParentNotFolder,
  RevisionMismatch,
} from "@effect-app/domain/drive";
import {
  RemoteOutdated,
  RemoteRejected,
  RemoteUnavailable,
  SessionRejected,
} from "../domain/failures";
import type { RemoteFailure } from "../domain/failures";
import { RemoteDrive } from "../features/replica/remote-drive";
import type { MoveRequest, UploadRequest } from "../features/replica/remote-drive";

type ClientError =
  | NodeNotFound
  | NameConflict
  | RevisionMismatch
  | ParentNotFolder
  | NotAFile
  | InvalidMove
  | InvalidUpload
  | HttpApiError.Unauthorized
  | HttpApiError.InternalServerError
  | HttpClientError.HttpClientError
  | Schema.SchemaError
  | Sse.Retry
  | Sse.SseError;

const outdated = (error: { readonly _tag: string; readonly message: string }) =>
  new RemoteOutdated({ reason: `${error._tag}: ${error.message}` });

const fromTransport = (error: HttpClientError.HttpClientError): RemoteFailure =>
  Match.valueTags(error.reason, {
    TransportError: () => new RemoteUnavailable({ cause: error }),
    StatusCodeError: ({ response }) =>
      response.status === 401
        ? new SessionRejected()
        : response.status >= 500 || response.status === 429
          ? new RemoteUnavailable({ cause: error, serverAnswered: true })
          : new RemoteRejected({ reason: error.message }),
    DecodeError: () => new RemoteRejected({ reason: error.message }),
    EmptyBodyError: () => new RemoteRejected({ reason: error.message }),
    EncodeError: () => new RemoteRejected({ reason: error.message }),
    InvalidUrlError: () => new RemoteRejected({ reason: error.message }),
  });

const toFailure = (error: ClientError): RemoteFailure =>
  Match.valueTags(error, {
    NodeNotFound: outdated,
    NameConflict: outdated,
    RevisionMismatch: outdated,
    ParentNotFolder: outdated,
    NotAFile: outdated,
    InvalidMove: outdated,
    InvalidUpload: (e) => new RemoteRejected({ reason: e.reason }),
    Unauthorized: () => new SessionRejected(),
    InternalServerError: (e) => new RemoteUnavailable({ cause: e, serverAnswered: true }),
    HttpClientError: fromTransport,
    SchemaError: (e) => new RemoteRejected({ reason: e.message }),
    Retry: (e) => new RemoteUnavailable({ cause: e }),
    SseError: (e) => new RemoteUnavailable({ cause: e }),
  });

export const makeHttpRemoteDrive = (options: {
  readonly serverUrl: string;
  readonly token: string;
}) =>
  Effect.gen(function* () {
    const client = yield* HttpApiClient.make(Api, {
      baseUrl: options.serverUrl,
      transformClient: HttpClient.mapRequest(HttpClientRequest.bearerToken(options.token)),
    });

    const upload = Effect.fn("RemoteDrive.upload")(function* (request: UploadRequest) {
      const form = new FormData();
      form.append("file", Bun.file(request.absolutePath), request.name);
      return yield* client.drive
        .uploadFile({
          query: {
            name: request.name,
            ...Option.match(request.parentId, {
              onNone: () => ({}),
              onSome: (parentId) => ({ parentId }),
            }),
            ...Option.match(request.expectedRevision, {
              onNone: () => ({}),
              onSome: (expectedRevision) => ({ expectedRevision }),
            }),
          },
          payload: form,
        })
        .pipe(Effect.mapError(toFailure));
    });

    const moveNode = Effect.fn("RemoteDrive.moveNode")(function* (request: MoveRequest) {
      return yield* client.drive
        .updateNode({
          params: { id: request.id },
          payload: {
            ...Option.match(request.name, { onNone: () => ({}), onSome: (name) => ({ name }) }),
            ...Option.match(request.parentId, {
              onNone: () => ({}),
              onSome: (parentId) => ({
                move: Option.match(parentId, {
                  onNone: () => ({}),
                  onSome: (id) => ({ parentId: id }),
                }),
              }),
            }),
            expectedRevision: request.expectedRevision,
          },
        })
        .pipe(Effect.mapError(toFailure));
    });

    return RemoteDrive.of({
      me: client.user.me().pipe(Effect.mapError(toFailure)),
      listChanges: (cursor) =>
        client.drive.listChanges({ query: { cursor } }).pipe(Effect.mapError(toFailure)),
      notifications: Stream.unwrap(client.drive.streamChanges()).pipe(
        Stream.mapError(toFailure),
        Stream.map((event) => event.cursor),
      ),
      upload,
      download: (id) =>
        Stream.unwrap(
          client.drive.downloadFile({ params: { id }, query: { disposition: "attachment" } }),
        ).pipe(Stream.mapError(toFailure)),
      createFolder: (parentId, name) =>
        client.drive
          .createFolder({
            payload: Option.match(parentId, {
              onNone: () => ({ name }),
              onSome: (id) => ({ parentId: id, name }),
            }),
          })
          .pipe(Effect.mapError(toFailure)),
      moveNode,
      deleteNode: (id, expectedRevision) =>
        client.drive
          .deleteNode({ params: { id }, query: { expectedRevision } })
          .pipe(Effect.mapError(toFailure)),
    });
  });

export const httpRemoteDriveLayer = (options: {
  readonly serverUrl: string;
  readonly token: string;
}) => Layer.effect(RemoteDrive, makeHttpRemoteDrive(options));
