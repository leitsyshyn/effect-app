import { NameConflict } from "@effect-app/domain/drive";
import { describeDriveError, isStaleNodeError } from "./drive-errors";

interface Named {
  readonly name: string;
  readonly kind: "file" | "folder";
}

export interface BulkOutcome<N, A> {
  readonly succeeded: ReadonlyArray<{ readonly node: N; readonly result: A }>;
  readonly failed: ReadonlyArray<{ readonly node: N; readonly error: unknown }>;
}

export const settleEach = async <N, A>(
  nodes: ReadonlyArray<N>,
  run: (node: N) => Promise<A>,
  concurrency = 4,
): Promise<BulkOutcome<N, A>> => {
  const results: Array<
    { readonly ok: true; readonly result: A } | { readonly ok: false; readonly error: unknown }
  > = [];
  let next = 0;
  const worker = async () => {
    while (next < nodes.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { ok: true, result: await run(nodes[index]!) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, nodes.length) }, worker));
  const succeeded: Array<{ node: N; result: A }> = [];
  const failed: Array<{ node: N; error: unknown }> = [];
  results.forEach((entry, index) => {
    const node = nodes[index]!;
    if (entry.ok) succeeded.push({ node, result: entry.result });
    else failed.push({ node, error: entry.error });
  });
  return { succeeded, failed };
};

export const shouldCloseAfter = (outcome: BulkOutcome<unknown, unknown>): boolean =>
  outcome.succeeded.length > 0 || outcome.failed.some(({ error }) => isStaleNodeError(error));

export interface BulkReport {
  readonly level: "success" | "partial" | "failure";
  readonly title: string;
  readonly details: ReadonlyArray<string>;
}

const items = (count: number) => `${count} ${count === 1 ? "item" : "items"}`;

const report = <N extends Named>(
  outcome: BulkOutcome<N, unknown>,
  verbs: { readonly done: string; readonly failed: string },
  describe: (error: unknown) => string,
  destination = "",
): BulkReport => {
  const total = outcome.succeeded.length + outcome.failed.length;
  const only = total === 1 ? (outcome.succeeded[0]?.node ?? outcome.failed[0]?.node) : undefined;
  const subject = only === undefined ? items(total) : `“${only.name}”`;
  if (outcome.failed.length === 0) {
    return { level: "success", title: `${verbs.done} ${subject}${destination}`, details: [] };
  }
  const details =
    only === undefined
      ? outcome.failed.map(({ node, error }) => `“${node.name}”: ${describe(error)}`)
      : outcome.failed.map(({ error }) => describe(error));
  if (outcome.succeeded.length === 0) {
    return {
      level: "failure",
      title: `Couldn't ${verbs.failed} ${subject}${destination}`,
      details,
    };
  }
  return {
    level: "partial",
    title: `${verbs.done} ${outcome.succeeded.length} of ${items(total)}${destination}`,
    details,
  };
};

export const moveReport = <N extends Named>(
  outcome: BulkOutcome<N, unknown>,
  destinationName: string,
): BulkReport =>
  report(
    outcome,
    { done: "Moved", failed: "move" },
    (error) =>
      error instanceof NameConflict
        ? `${destinationName} already has “${error.name}”`
        : describeDriveError(error),
    ` to ${destinationName}`,
  );

export const deleteReport = <N extends Named>(outcome: BulkOutcome<N, unknown>): BulkReport =>
  report(outcome, { done: "Deleted", failed: "delete" }, describeDriveError);
