import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { BunServices } from "@effect/platform-bun";
import { RelativePath } from "../../domain/path";
import { sqliteLayer } from "../../infra/sqlite";
import { Issues } from "./issues";

const layer = Issues.layer.pipe(
  Layer.provideMerge(sqliteLayer(":memory:")),
  Layer.provide(BunServices.layer),
);

describe("Issues", () => {
  it.effect("keeps one report per failing path, but every conflict copy", () =>
    Effect.gen(function* () {
      const issues = yield* Issues;
      const path = RelativePath.make("big.bin");
      yield* issues.report({ path, kind: "Failed", reason: "first" });
      yield* issues.report({ path, kind: "Failed", reason: "again" });
      const conflicted = RelativePath.make("notes.txt");
      yield* issues.report({
        path: conflicted,
        kind: "EditEdit",
        localCopy: RelativePath.make("notes (conflict 1).txt"),
      });
      yield* issues.report({
        path: conflicted,
        kind: "EditEdit",
        localCopy: RelativePath.make("notes (conflict 2).txt"),
      });

      const listed = yield* issues.list;
      const failed = listed.filter((issue) => issue.kind === "Failed");
      expect(failed).toHaveLength(1);
      expect(failed[0]?.reason).toEqual(expect.objectContaining({ value: "again" }));
      expect(listed.filter((issue) => issue.kind === "EditEdit")).toHaveLength(2);
    }).pipe(Effect.provide(layer)),
  );
});
