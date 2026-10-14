import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { ContentHash, NodeId, NodeKind, Revision } from "@effect-app/domain/drive";
import type { SyncedEntry } from "../../domain/entry";
import { StoreFailed } from "../../domain/failures";
import { RelativePath } from "../../domain/path";

const SyncedRow = Schema.Struct({
  path: RelativePath,
  kind: NodeKind,
  contentHash: Schema.OptionFromNullOr(ContentHash),
  nodeId: NodeId,
  revision: Revision,
  localSize: Schema.Finite,
  localMtimeMs: Schema.Finite,
  localFileId: Schema.OptionFromNullOr(Schema.String),
});

const characters = (text: string) => [...text].length;

interface SyncedTreeInterface {
  readonly get: (path: RelativePath) => Effect.Effect<Option.Option<SyncedEntry>, StoreFailed>;
  readonly put: (entry: SyncedEntry) => Effect.Effect<void, StoreFailed>;
  readonly forget: (path: RelativePath) => Effect.Effect<void, StoreFailed>;
  readonly byNodeId: (nodeId: NodeId) => Effect.Effect<Option.Option<SyncedEntry>, StoreFailed>;
  readonly byLocalFileId: (
    fileId: string,
  ) => Effect.Effect<Option.Option<SyncedEntry>, StoreFailed>;
  readonly move: (
    from: RelativePath,
    to: RelativePath,
    revision: Revision,
  ) => Effect.Effect<void, StoreFailed>;
  readonly paths: Effect.Effect<ReadonlyArray<RelativePath>, StoreFailed>;
  readonly pathsWithin: (
    folder: RelativePath,
  ) => Effect.Effect<ReadonlyArray<RelativePath>, StoreFailed>;
  readonly clear: Effect.Effect<void, StoreFailed>;
}

export class SyncedTree extends Context.Service<SyncedTree, SyncedTreeInterface>()(
  "effect-app/sync/SyncedTree",
) {
  static readonly make = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const storeFailed = (operation: string) =>
      Effect.mapError((cause: unknown) => new StoreFailed({ operation, cause }));
    const PathRow = Schema.Struct({ path: RelativePath });
    const prefix = (folder: RelativePath) => `${folder}/`;

    const get = SqlSchema.findOneOption({
      Request: RelativePath,
      Result: SyncedRow,
      execute: (path) => sql`SELECT * FROM synced_entry WHERE path = ${path}`,
    });

    const findBy = (column: "node_id" | "local_file_id") =>
      SqlSchema.findAll({
        Request: Schema.String,
        Result: SyncedRow,
        execute: (value) => sql`SELECT * FROM synced_entry WHERE ${sql(column)} = ${value} LIMIT 2`,
      });
    const unique = (rows: ReadonlyArray<SyncedEntry>) =>
      rows.length === 1 ? Option.fromUndefinedOr(rows[0]) : Option.none<SyncedEntry>();
    const byNodeId = findBy("node_id");
    const byLocalFileId = findBy("local_file_id");

    const listPaths = SqlSchema.findAll({
      Request: Schema.String,
      Result: PathRow,
      execute: (under) =>
        under === ""
          ? sql`SELECT path FROM synced_entry`
          : sql`SELECT path FROM synced_entry
                WHERE substr(path, 1, ${characters(under)}) = ${under}`,
    });

    const encode = Schema.encodeEffect(SyncedRow);

    return SyncedTree.of({
      get: (path) => get(path).pipe(storeFailed("get")),
      put: (entry) =>
        encode(entry).pipe(
          Effect.flatMap((row) => sql`INSERT OR REPLACE INTO synced_entry ${sql.insert(row)}`),
          Effect.asVoid,
          storeFailed("put"),
        ),
      forget: (path) =>
        sql`DELETE FROM synced_entry
            WHERE path = ${path}
               OR substr(path, 1, ${characters(prefix(path))}) = ${prefix(path)}`.pipe(
          Effect.asVoid,
          storeFailed("forget"),
        ),
      byNodeId: (nodeId) => byNodeId(nodeId).pipe(Effect.map(unique), storeFailed("byNodeId")),
      byLocalFileId: (fileId) =>
        byLocalFileId(fileId).pipe(Effect.map(unique), storeFailed("byLocalFileId")),
      move: (from, to, revision) =>
        sql
          .withTransaction(
            Effect.all([
              sql`UPDATE synced_entry SET path = ${to} || substr(path, ${characters(from) + 1})
                  WHERE path = ${from}
                     OR substr(path, 1, ${characters(prefix(from))}) = ${prefix(from)}`,
              sql`UPDATE synced_entry SET revision = ${revision} WHERE path = ${to}`,
            ]),
          )
          .pipe(Effect.asVoid, storeFailed("move")),
      paths: listPaths("").pipe(
        Effect.map((rows) => rows.map((row) => row.path)),
        storeFailed("paths"),
      ),
      pathsWithin: (folder) =>
        listPaths(prefix(folder)).pipe(
          Effect.map((rows) => rows.map((row) => row.path)),
          storeFailed("pathsWithin"),
        ),
      clear: sql`DELETE FROM synced_entry`.pipe(Effect.asVoid, storeFailed("clear")),
    });
  });

  static readonly layer = Layer.effect(SyncedTree, SyncedTree.make);
}
