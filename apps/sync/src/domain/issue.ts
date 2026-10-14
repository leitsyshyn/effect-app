import { Schema } from "effect";

export const IssueKind = Schema.Literals([
  "EditEdit",
  "InitialDiff",
  "KindClash",
  "DeleteEdit",
  "EditDelete",
  "Failed",
]);
export type IssueKind = typeof IssueKind.Type;

const DETAILS: Record<IssueKind, string> = {
  EditEdit:
    "Changed on this computer and remotely. The remote version is in place; yours was kept as a copy.",
  InitialDiff:
    "Different files existed here and remotely when the folder was linked. The remote version is in place; yours was kept as a copy.",
  KindClash:
    "A file and a folder with the same name existed on the two sides. The remote item is in place; yours was kept as a copy.",
  DeleteEdit: "Deleted on this computer but changed remotely. The remote version was restored.",
  EditDelete: "Changed on this computer but deleted remotely. Your version was uploaded again.",
  Failed: "Synchronization failed.",
};

export const describeIssue = (kind: IssueKind, reason?: string): string =>
  reason === undefined ? DETAILS[kind] : `${DETAILS[kind]} ${reason}`;
