import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Layer, Path } from "effect";
import { FetchHttpClient } from "effect/http";
import { syncConfig } from "./config";
import { ensureControlToken } from "./features/control/auth";
import { controlServerLayer } from "./features/control/server";
import { Pairing } from "./features/pairing/pairing";
import { ReplicaActivity } from "./features/replica/activity";
import { Issues } from "./features/replica/issues";
import { Supervisor } from "./features/replica/supervisor";
import { SyncedTree } from "./features/replica/synced-tree";
import { WorkQueue } from "./features/replica/work-queue";
import { Settings } from "./features/settings/settings";
import { SyncStatusService } from "./features/status/status";
import { sqliteLayer } from "./infra/sqlite";

const stateLayer = (databaseFile: string) =>
  Layer.mergeAll(
    Settings.layer,
    SyncedTree.layer,
    Issues.layer,
    WorkQueue.layer,
    ReplicaActivity.layer,
  ).pipe(Layer.provideMerge(sqliteLayer(databaseFile)));

export const DaemonLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* syncConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(config.stateDirectory, { recursive: true, mode: 0o700 });
    const databaseFile = path.join(config.stateDirectory, "state.db");
    yield* fs.chmod(config.stateDirectory, 0o700);
    yield* fs.writeFile(databaseFile, new Uint8Array(), { flag: "a", mode: 0o600 });
    yield* Effect.forEach(
      [databaseFile, `${databaseFile}-wal`, `${databaseFile}-shm`],
      (file) =>
        Effect.flatMap(fs.exists(file), (exists) => (exists ? fs.chmod(file, 0o600) : Effect.void)),
      { discard: true },
    );
    const token = yield* ensureControlToken(config.stateDirectory);

    yield* Effect.logInfo("Sync daemon starting", {
      stateDirectory: config.stateDirectory,
      control: `http://127.0.0.1:${config.controlPort}`,
    });

    return controlServerLayer({ port: config.controlPort, token }).pipe(
      Layer.provide(Layer.mergeAll(Pairing.layer, SyncStatusService.layer)),
      Layer.provideMerge(Supervisor.layer({ deviceName: config.deviceName })),
      Layer.provideMerge(stateLayer(databaseFile)),
      Layer.provide(FetchHttpClient.layer),
    );
  }),
).pipe(Layer.provide(BunServices.layer));

if (import.meta.main) {
  Layer.launch(DaemonLayer).pipe(BunRuntime.runMain);
}
