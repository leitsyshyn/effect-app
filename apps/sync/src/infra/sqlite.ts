import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun";
import { Effect, Layer, String } from "effect";
import { SqlClient } from "effect/sql";

const migrations = SqliteMigrator.fromRecord({
  "0001_initial": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE synced_entry (
      path TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      content_hash TEXT,
      node_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      local_size INTEGER NOT NULL,
      local_mtime_ms INTEGER NOT NULL
    )`;
    yield* sql`CREATE TABLE issue (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      reason TEXT,
      local_copy TEXT,
      created_at INTEGER NOT NULL
    )`;
    yield* sql`CREATE TABLE pending (
      path TEXT PRIMARY KEY,
      since INTEGER NOT NULL,
      last_error TEXT
    )`;
  }),
  "0002_identities": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`ALTER TABLE synced_entry ADD COLUMN local_file_id TEXT`;
    yield* sql`CREATE INDEX synced_entry_node_id ON synced_entry (node_id)`;
    yield* sql`CREATE INDEX synced_entry_local_file_id ON synced_entry (local_file_id)`;
  }),
});

export const sqliteLayer = (filename: string) =>
  SqliteMigrator.layer({ loader: migrations, table: "migrations" }).pipe(
    Layer.provideMerge(
      SqliteClient.layer({
        filename,
        transformQueryNames: String.camelToSnake,
        transformResultNames: String.snakeToCamel,
      }),
    ),
  );
