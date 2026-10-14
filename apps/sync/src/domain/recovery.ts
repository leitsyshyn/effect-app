import { Data, Match } from "effect";
import type { SyncFailure } from "./failures";

export type Condition = "offline" | "signed-out" | "folder-unavailable";

export type Recovery = Data.TaggedEnum<{
  Replan: { readonly refreshRemote: boolean };
  Park: { readonly condition: Condition };
  Retry: {};
  Report: { readonly reason: string };
}>;
export const Recovery = Data.taggedEnum<Recovery>();

export const recover = (failure: SyncFailure): Recovery =>
  Match.valueTags(failure, {
    RemoteOutdated: () => Recovery.Replan({ refreshRemote: true }),
    LocalChanged: () => Recovery.Replan({ refreshRemote: false }),
    RemoteUnavailable: ({ serverAnswered }) =>
      serverAnswered === true ? Recovery.Retry() : Recovery.Park({ condition: "offline" }),
    SessionRejected: () => Recovery.Park({ condition: "signed-out" }),
    FolderUnavailable: () => Recovery.Park({ condition: "folder-unavailable" }),
    RemoteRejected: ({ reason }) => Recovery.Report({ reason }),
    LocalIoFailed: () => Recovery.Retry(),
    StoreFailed: () => Recovery.Retry(),
    NotConverging: () => Recovery.Retry(),
  });

export type Disposition = Data.TaggedEnum<{
  Settled: {};
  Parked: { readonly condition: Condition; readonly reason: string };
  Retry: { readonly reason: string };
}>;
export const Disposition = Data.taggedEnum<Disposition>();
