import {
  Context,
  Crypto,
  DateTime,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Redacted,
  Schema,
} from "effect";
import { HttpClient } from "effect/http";
import { SqlClient } from "effect/sql";
import type { User } from "@effect-app/domain/user";
import { describeFailure } from "../../domain/failures";
import type { StoreFailed } from "../../domain/failures";
import { makeHttpRemoteDrive } from "../../infra/drive-http";
import { removeMarker, writeMarker } from "../replica/folder-marker";
import { Issues } from "../replica/issues";
import { Supervisor } from "../replica/supervisor";
import { SyncedTree } from "../replica/synced-tree";
import { WorkQueue } from "../replica/work-queue";
import { isOwnedBy, Settings } from "../settings/settings";
import type { Link, Session } from "../settings/settings";

export class SignInFailed extends Schema.TaggedError<SignInFailed>()(
  "SignInFailed",
  { reason: Schema.String },
  { httpApiStatus: 401 },
) {}

export class ServerUnreachable extends Schema.TaggedError<ServerUnreachable>()(
  "ServerUnreachable",
  { reason: Schema.String },
  { httpApiStatus: 503 },
) {}

export class InvalidFolder extends Schema.TaggedError<InvalidFolder>()(
  "InvalidFolder",
  { path: Schema.String, reason: Schema.String },
  { httpApiStatus: 400 },
) {}

export class NotSignedIn extends Schema.TaggedError<NotSignedIn>()(
  "NotSignedIn",
  {},
  { httpApiStatus: 409 },
) {}

interface PairingInterface {
  readonly signIn: (
    serverUrl: string,
    token: Redacted.Redacted<string>,
  ) => Effect.Effect<User, SignInFailed | ServerUnreachable | StoreFailed>;
  readonly signOut: Effect.Effect<void, StoreFailed>;
  readonly link: (
    localPath: string,
  ) => Effect.Effect<Link, InvalidFolder | NotSignedIn | StoreFailed>;
  readonly unlink: Effect.Effect<void, StoreFailed>;
  readonly pause: Effect.Effect<void, StoreFailed>;
  readonly resume: Effect.Effect<void, StoreFailed>;
}

export class Pairing extends Context.Service<Pairing, PairingInterface>()(
  "effect-app/sync/Pairing",
) {
  static readonly make = Effect.gen(function* () {
    const settings = yield* Settings;
    const supervisor = yield* Supervisor;
    const syncedTree = yield* SyncedTree;
    const issues = yield* Issues;
    const queue = yield* WorkQueue;
    const sql = yield* SqlClient.SqlClient;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const platform = yield* Effect.context<
      FileSystem.FileSystem | Path.Path | HttpClient.HttpClient
    >();

    const forgetPairing = Effect.gen(function* () {
      const { link } = yield* settings.current;
      yield* sql
        .withTransaction(
          Effect.all([syncedTree.clear, issues.clear, queue.purge], { discard: true }),
        )
        .pipe(Effect.catchTag("SqlError", (cause) => Effect.die(cause)));
      yield* settings.setLink(Option.none());
      if (Option.isSome(link)) yield* removeMarker(link.value.rootPath);
    }).pipe(Effect.provide(platform));

    const signIn = Effect.fn("Pairing.signIn")(function* (
      serverUrl: string,
      token: Redacted.Redacted<string>,
    ) {
      const drive = yield* makeHttpRemoteDrive({ serverUrl, token: Redacted.value(token) }).pipe(
        Effect.provide(platform),
      );
      const user = yield* drive.me.pipe(
        Effect.mapError((failure) =>
          failure._tag === "RemoteUnavailable"
            ? new ServerUnreachable({ reason: describeFailure(failure) })
            : new SignInFailed({ reason: describeFailure(failure) }),
        ),
      );
      const session: Session = {
        serverUrl,
        token,
        user: { id: user.id, name: user.name, email: user.email },
      };
      yield* supervisor.whileStopped(
        Effect.gen(function* () {
          const { session: previous, link } = yield* settings.current;
          if (Option.isSome(link) && !isOwnedBy(link.value, user.id)) {
            const unrecordedButSameUser =
              link.value.ownerId === undefined &&
              Option.exists(previous, (signedIn) => signedIn.user.id === user.id);
            if (unrecordedButSameUser) {
              yield* settings.setLink(Option.some({ ...link.value, ownerId: user.id }));
            } else {
              yield* Effect.logInfo("Signed in as another account; unlinking the folder", {
                rootPath: link.value.rootPath,
              });
              yield* forgetPairing;
            }
          }
          yield* settings.setSession(Option.some(session));
        }),
      );
      return user;
    });

    const link = Effect.fn("Pairing.link")(function* (localPath: string) {
      const { session } = yield* settings.current;
      if (Option.isNone(session)) return yield* new NotSignedIn();
      if (!path.isAbsolute(localPath)) {
        return yield* new InvalidFolder({ path: localPath, reason: "Path must be absolute" });
      }
      const rootPath = path.resolve(localPath);
      const info = yield* fs
        .stat(rootPath)
        .pipe(
          Effect.mapError(
            () => new InvalidFolder({ path: rootPath, reason: "Folder does not exist" }),
          ),
        );
      if (info.type !== "Directory")
        return yield* new InvalidFolder({ path: rootPath, reason: "Not a folder" });

      const linked: Link = {
        id: yield* Effect.orDie(crypto.randomUUIDv4),
        rootPath,
        linkedAt: yield* DateTime.now,
        ownerId: session.value.user.id,
      };
      yield* supervisor.whileStopped(
        Effect.gen(function* () {
          yield* forgetPairing;
          yield* writeMarker(rootPath, linked.id).pipe(
            Effect.mapError(
              (failure) => new InvalidFolder({ path: rootPath, reason: describeFailure(failure) }),
            ),
            Effect.provide(platform),
          );
          yield* settings.setLink(Option.some(linked));
        }),
      );
      return linked;
    });

    const stored = yield* settings.current;
    if (
      Option.isSome(stored.session) &&
      Option.isSome(stored.link) &&
      stored.link.value.ownerId === undefined
    ) {
      yield* settings
        .setLink(Option.some({ ...stored.link.value, ownerId: stored.session.value.user.id }))
        .pipe(Effect.orDie);
    }

    return Pairing.of({
      signIn,
      signOut: settings.setSession(Option.none()),
      link,
      unlink: supervisor.whileStopped(forgetPairing),
      pause: settings.setPaused(true),
      resume: settings.setPaused(false),
    });
  });

  static readonly layer = Layer.effect(Pairing, Pairing.make);
}
