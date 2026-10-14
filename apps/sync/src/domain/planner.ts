import { Data, Option } from "effect";
import { sameContent } from "./entry";
import type { LocalEntry, RemoteEntry, SyncedEntry } from "./entry";
import type { IssueKind } from "./issue";

export type Step = Data.TaggedEnum<{
  NoOp: {};
  Adopt: { readonly remote: RemoteEntry };
  Upload: {
    readonly replace: Option.Option<RemoteEntry>;
    readonly issue: Option.Option<IssueKind>;
  };
  CreateRemoteFolder: {};
  Download: { readonly remote: RemoteEntry; readonly issue: Option.Option<IssueKind> };
  CreateLocalFolder: { readonly remote: RemoteEntry };
  DeleteRemote: { readonly remote: RemoteEntry };
  DeleteLocal: {};
  ForgetSynced: {};
  KeepBoth: { readonly reason: "EditEdit" | "InitialDiff" | "KindClash" };
}>;
export const Step = Data.taggedEnum<Step>();

const firstSight = (local: Option.Option<LocalEntry>, remote: Option.Option<RemoteEntry>): Step => {
  if (Option.isNone(local) && Option.isNone(remote)) return Step.NoOp();
  if (Option.isSome(local) && Option.isNone(remote)) {
    return local.value.kind === "folder"
      ? Step.CreateRemoteFolder()
      : Step.Upload({ replace: Option.none(), issue: Option.none() });
  }
  if (Option.isNone(local) && Option.isSome(remote)) {
    return remote.value.kind === "folder"
      ? Step.CreateLocalFolder({ remote: remote.value })
      : Step.Download({ remote: remote.value, issue: Option.none() });
  }
  const l = Option.getOrThrow(local);
  const r = Option.getOrThrow(remote);
  if (sameContent(l, r)) return Step.Adopt({ remote: r });
  return Step.KeepBoth({ reason: l.kind === r.kind ? "InitialDiff" : "KindClash" });
};

export const plan = (input: {
  readonly synced: Option.Option<SyncedEntry>;
  readonly local: Option.Option<LocalEntry>;
  readonly remote: Option.Option<RemoteEntry>;
}): Step => {
  const { local, remote } = input;
  if (Option.isNone(input.synced)) return firstSight(local, remote);
  const synced = input.synced.value;

  if (Option.isNone(local) && Option.isNone(remote)) return Step.ForgetSynced();

  if (Option.isSome(local) && Option.isSome(remote)) {
    const l = local.value;
    const r = remote.value;
    const localChanged = !sameContent(l, synced);
    const remoteChanged = !sameContent(r, synced);
    if (l.kind !== r.kind) return Step.KeepBoth({ reason: "KindClash" });
    if (!localChanged && !remoteChanged) {
      return r.revision !== synced.revision || r.nodeId !== synced.nodeId
        ? Step.Adopt({ remote: r })
        : Step.NoOp();
    }
    if (sameContent(l, r)) return Step.Adopt({ remote: r });
    if (localChanged && remoteChanged) return Step.KeepBoth({ reason: "EditEdit" });
    return localChanged
      ? Step.Upload({ replace: Option.some(r), issue: Option.none() })
      : Step.Download({ remote: r, issue: Option.none() });
  }

  if (Option.isSome(remote)) {
    const r = remote.value;
    if (sameContent(r, synced)) {
      return r.kind === "folder" && !r.empty ? Step.NoOp() : Step.DeleteRemote({ remote: r });
    }
    return r.kind === "folder"
      ? Step.CreateLocalFolder({ remote: r })
      : Step.Download({ remote: r, issue: Option.some("DeleteEdit") });
  }

  const l = Option.getOrThrow(local);
  if (sameContent(l, synced)) {
    return l.kind === "folder" && !l.empty ? Step.NoOp() : Step.DeleteLocal();
  }
  return l.kind === "folder"
    ? Step.CreateRemoteFolder()
    : Step.Upload({ replace: Option.none(), issue: Option.some("EditDelete") });
};
