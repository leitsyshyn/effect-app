import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { Config, Schema } from "effect";

const defaultStateDirectory =
  process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "EffectDrive")
    : join(homedir(), ".local", "share", "effect-drive");

export const syncConfig = Config.all({
  stateDirectory: Config.schema(Schema.NonEmptyString, "SYNC_STATE_DIR").pipe(
    Config.withDefault(defaultStateDirectory),
  ),
  controlPort: Config.Port("SYNC_CONTROL_PORT").pipe(Config.withDefault(47821)),
  deviceName: Config.schema(Schema.NonEmptyString, "SYNC_DEVICE_NAME").pipe(
    Config.withDefault(hostname()),
  ),
});
