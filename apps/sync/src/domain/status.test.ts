import { describe, expect, it } from "@effect/vitest";
import { DateTime, Option } from "effect";
import { deriveStatus, idleActivity } from "./status";
import type { StatusInput } from "./status";

const ready: StatusInput = {
  user: Option.some({ name: "Tester", email: "t@example.com" }),
  serverUrl: Option.some("http://localhost:3000"),
  linkedFolder: Option.some("/Users/t/Drive"),
  paused: false,
  activity: idleActivity,
  pendingCount: 0,
  issueCount: 0,
};

const stateOf = (input: Partial<StatusInput>) => deriveStatus({ ...ready, ...input }).state;

describe("deriveStatus", () => {
  it("is up to date when nothing is pending", () => {
    const at = DateTime.makeUnsafe("2026-10-05T10:00:00.000Z");
    const status = deriveStatus({
      ...ready,
      activity: { ...idleActivity, lastSyncedAt: Option.some(at) },
    });

    expect(status).toMatchObject({
      state: "up-to-date",
      linkedFolder: "/Users/t/Drive",
      lastSyncedAt: at,
    });
  });

  it("ranks conditions: signed out, unlinked, paused, blocked, offline, syncing, attention", () => {
    expect(stateOf({ user: Option.none(), pendingCount: 3 })).toBe("signed-out");
    expect(stateOf({ linkedFolder: Option.none() })).toBe("unlinked");
    expect(stateOf({ paused: true, pendingCount: 3 })).toBe("paused");
    expect(
      stateOf({ activity: { ...idleActivity, blocked: Option.some("gone"), offline: true } }),
    ).toBe("blocked");
    expect(stateOf({ activity: { ...idleActivity, offline: true }, pendingCount: 2 })).toBe(
      "offline",
    );
    expect(stateOf({ pendingCount: 2, issueCount: 1 })).toBe("syncing");
    expect(stateOf({ issueCount: 1 })).toBe("attention");
  });
});
