import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Stream } from "effect";
import { eventually, makeHarness } from "../../testing/harness";
import { ReplicaActivity } from "./activity";
import { runReplica } from "./replica";

const present = <A, E, R>(read: Effect.Effect<Option.Option<A>, E, R>) =>
  read.pipe(Effect.flatMap(Effect.fromOption));

describe("Replica", () => {
  it.live(
    "keeps the folder in sync in both directions while running",
    () =>
      Effect.gen(function* () {
        const drive = yield* makeHarness;
        yield* drive.local.write("existing.txt", "before start");
        yield* runReplica({ syncNow: Stream.never }).pipe(
          Effect.provide(drive.context),
          Effect.forkScoped,
        );

        expect(yield* eventually(present(drive.remote.read("existing.txt")))).toBe("before start");
        yield* drive.local.write("notes/from-laptop.txt", "hello from the laptop");
        expect(yield* eventually(present(drive.remote.read("notes/from-laptop.txt")))).toBe(
          "hello from the laptop",
        );

        yield* drive.remote.put("from-web.txt", "hello from the web");
        expect(yield* eventually(present(drive.local.read("from-web.txt")))).toBe(
          "hello from the web",
        );
      }).pipe(Effect.scoped),
    15_000,
  );

  it.live(
    "stays online while the drive is idle: heartbeats keep the change feed alive",
    () =>
      Effect.gen(function* () {
        const drive = yield* makeHarness;
        yield* runReplica({ syncNow: Stream.never }).pipe(
          Effect.provide(drive.context),
          Effect.forkScoped,
        );
        const activity = yield* Effect.service(ReplicaActivity).pipe(Effect.provide(drive.context));
        yield* activity.changes.pipe(
          Stream.filter((current) => !current.starting),
          Stream.runHead,
        );

        const wentOffline = yield* activity.changes.pipe(
          Stream.filter((current) => current.offline),
          Stream.runHead,
          Effect.timeoutOption("9 seconds"),
        );
        expect(Option.flatten(wentOffline)).toEqual(Option.none());
      }).pipe(Effect.scoped),
    20_000,
  );

  it.live(
    "moves the remote folder when a folder is renamed while running",
    () =>
      Effect.gen(function* () {
        const drive = yield* makeHarness;
        yield* drive.local.write("photos/2024/beach.txt", "beach");
        yield* runReplica({ syncNow: Stream.never }).pipe(
          Effect.provide(drive.context),
          Effect.forkScoped,
        );
        yield* eventually(present(drive.remote.read("photos/2024/beach.txt")));
        const folder = yield* drive.remote.node("photos");
        const file = yield* drive.remote.node("photos/2024/beach.txt");

        yield* drive.local.rename("photos", "pictures");
        const moved = yield* eventually(drive.remote.node("pictures/2024/beach.txt"));
        expect(moved.id).toBe(file.id);
        expect((yield* drive.remote.node("pictures")).id).toBe(folder.id);
        expect(yield* drive.remote.paths).toEqual([
          "pictures",
          "pictures/2024",
          "pictures/2024/beach.txt",
        ]);
      }).pipe(Effect.scoped),
    15_000,
  );

  it.live(
    "removes partial downloads an interrupted run left behind",
    () =>
      Effect.gen(function* () {
        const drive = yield* makeHarness;
        yield* drive.local.write(".effectsync/tmp/0123.partial", "half a download");
        yield* runReplica({ syncNow: Stream.never }).pipe(
          Effect.provide(drive.context),
          Effect.forkScoped,
        );

        yield* eventually(
          drive.local
            .read(".effectsync/tmp/0123.partial")
            .pipe(Effect.filterOrFail(Option.isNone, () => "still there")),
        );
      }).pipe(Effect.scoped),
    15_000,
  );

  it.live(
    "blocks instead of deleting when the linked folder disappears",
    () =>
      Effect.gen(function* () {
        const drive = yield* makeHarness;
        yield* drive.local.write("keep.txt", "precious");
        yield* runReplica({ syncNow: Stream.never }).pipe(
          Effect.provide(drive.context),
          Effect.forkScoped,
        );
        yield* eventually(present(drive.remote.read("keep.txt")));

        yield* drive.local.remove(".effectsync");
        yield* drive.local.remove("keep.txt");

        const activity = yield* Effect.service(ReplicaActivity).pipe(Effect.provide(drive.context));
        const blocked = yield* activity.changes.pipe(
          Stream.filter((current) => Option.isSome(current.blocked)),
          Stream.runHead,
          Effect.timeout("12 seconds"),
        );
        expect(Option.isSome(blocked)).toBe(true);
        expect(yield* drive.remote.paths).toEqual(["keep.txt"]);
      }).pipe(Effect.scoped),
    20_000,
  );
});
