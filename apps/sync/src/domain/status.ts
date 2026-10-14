import { Option, Schema } from "effect";
import type { DateTime } from "effect";

export const SyncState = Schema.Literals([
  "signed-out",
  "unlinked",
  "paused",
  "blocked",
  "offline",
  "syncing",
  "attention",
  "up-to-date",
]);
export type SyncState = typeof SyncState.Type;

export const SyncStatus = Schema.Struct({
  state: SyncState,
  detail: Schema.NullOr(Schema.String),
  user: Schema.NullOr(Schema.Struct({ name: Schema.String, email: Schema.String })),
  serverUrl: Schema.NullOr(Schema.String),
  linkedFolder: Schema.NullOr(Schema.String),
  pendingCount: Schema.Int,
  issueCount: Schema.Int,
  lastSyncedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
}).annotate({ identifier: "SyncStatus" });
export interface SyncStatus extends Schema.Schema.Type<typeof SyncStatus> {}

export interface Activity {
  readonly starting: boolean;
  readonly offline: boolean;
  readonly blocked: Option.Option<string>;
  readonly lastSyncedAt: Option.Option<DateTime.Utc>;
}

export const idleActivity: Activity = {
  starting: false,
  offline: false,
  blocked: Option.none(),
  lastSyncedAt: Option.none(),
};

export interface StatusInput {
  readonly user: Option.Option<{ readonly name: string; readonly email: string }>;
  readonly serverUrl: Option.Option<string>;
  readonly linkedFolder: Option.Option<string>;
  readonly paused: boolean;
  readonly activity: Activity;
  readonly pendingCount: number;
  readonly issueCount: number;
}

const stateOf = (input: StatusInput): readonly [SyncState, string | null] => {
  if (Option.isNone(input.user)) return ["signed-out", null];
  if (Option.isNone(input.linkedFolder)) return ["unlinked", null];
  if (input.paused) return ["paused", null];
  if (Option.isSome(input.activity.blocked)) return ["blocked", input.activity.blocked.value];
  if (input.activity.offline)
    return ["offline", "Changes will sync when the server is reachable again"];
  if (input.activity.starting) return ["syncing", "Comparing local and remote files"];
  if (input.pendingCount > 0) return ["syncing", null];
  if (input.issueCount > 0) return ["attention", `${input.issueCount} item(s) need attention`];
  return ["up-to-date", null];
};

export const deriveStatus = (input: StatusInput): SyncStatus => {
  const [state, detail] = stateOf(input);
  return {
    state,
    detail,
    user: Option.getOrNull(input.user),
    serverUrl: Option.getOrNull(input.serverUrl),
    linkedFolder: Option.getOrNull(input.linkedFolder),
    pendingCount: input.pendingCount,
    issueCount: input.issueCount,
    lastSyncedAt: Option.getOrNull(input.activity.lastSyncedAt),
  };
};
