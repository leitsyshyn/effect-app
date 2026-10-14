import {
  Clock,
  Context,
  Crypto,
  DateTime,
  Effect,
  Layer,
  Option,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { StoreFailed } from "../../domain/failures";
import { IssueKind } from "../../domain/issue";
import { RelativePath } from "../../domain/path";

export const Issue = Schema.Struct({
  id: Schema.String,
  path: RelativePath,
  kind: IssueKind,
  reason: Schema.OptionFromNullOr(Schema.String),
  localCopy: Schema.OptionFromNullOr(RelativePath),
  createdAt: Schema.DateTimeUtcFromMillis,
});
export interface Issue extends Schema.Schema.Type<typeof Issue> {}

interface IssuesInterface {
  readonly report: (issue: {
    readonly path: RelativePath;
    readonly kind: IssueKind;
    readonly reason?: string;
    readonly localCopy?: RelativePath;
  }) => Effect.Effect<void, StoreFailed>;
  readonly list: Effect.Effect<ReadonlyArray<Issue>, StoreFailed>;
  readonly dismiss: (id: string) => Effect.Effect<boolean, StoreFailed>;
  readonly clear: Effect.Effect<void, StoreFailed>;
  readonly count: Stream.Stream<number>;
}

export class Issues extends Context.Service<Issues, IssuesInterface>()("effect-app/sync/Issues") {
  static readonly make = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const crypto = yield* Crypto.Crypto;
    const storeFailed = (operation: string) =>
      Effect.mapError((cause: unknown) => new StoreFailed({ operation, cause }));

    const countRows = sql<{ total: number }>`SELECT count(*) AS total FROM issue`.pipe(
      Effect.map((rows) => rows[0]?.total ?? 0),
    );
    const count = yield* SubscriptionRef.make(yield* countRows.pipe(Effect.orDie));
    const recount = countRows.pipe(Effect.flatMap((total) => SubscriptionRef.set(count, total)));

    const list = SqlSchema.findAll({
      Request: Schema.Void,
      Result: Issue,
      execute: () => sql`SELECT * FROM issue ORDER BY created_at DESC`,
    });
    const encode = Schema.encodeEffect(Issue);

    return Issues.of({
      report: (issue) =>
        Effect.gen(function* () {
          const row = yield* encode({
            id: yield* crypto.randomUUIDv4,
            path: issue.path,
            kind: issue.kind,
            reason: Option.fromUndefinedOr(issue.reason),
            localCopy: Option.fromUndefinedOr(issue.localCopy),
            createdAt: DateTime.makeUnsafe(yield* Clock.currentTimeMillis),
          });
          yield* sql.withTransaction(
            Effect.gen(function* () {
              if (issue.localCopy === undefined) {
                yield* sql`DELETE FROM issue
                           WHERE path = ${issue.path} AND kind = ${issue.kind}
                             AND local_copy IS NULL`;
              }
              yield* sql`INSERT INTO issue ${sql.insert(row)}`;
            }),
          );
          yield* recount;
        }).pipe(storeFailed("report")),
      list: list(undefined).pipe(storeFailed("list")),
      dismiss: (id) =>
        sql`DELETE FROM issue WHERE id = ${id} RETURNING id`.pipe(
          Effect.tap(() => recount),
          Effect.map((rows) => rows.length > 0),
          storeFailed("dismiss"),
        ),
      clear: sql`DELETE FROM issue`.pipe(Effect.andThen(recount), storeFailed("clear")),
      count: SubscriptionRef.changes(count),
    });
  });

  static readonly layer = Layer.effect(Issues, Issues.make);
}
