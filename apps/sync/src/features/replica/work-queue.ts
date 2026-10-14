import { Clock, Context, Effect, Layer, Schema, Stream, SubscriptionRef } from "effect";
import type { Duration } from "effect";
import { PersistedQueue } from "effect/persistence";
import { SqlClient, SqlSchema } from "effect/sql";
import { StoreFailed } from "../../domain/failures";
import { RelativePath } from "../../domain/path";
import { Disposition } from "../../domain/recovery";

const QUEUE_NAME = "sync";
const QUEUE_TABLE = "sync_queue";
const MAX_ATTEMPTS = 8;

const Job = Schema.Struct({ path: RelativePath });

export const PendingPath = Schema.Struct({
  path: RelativePath,
  since: Schema.DateTimeUtcFromMillis,
  lastError: Schema.OptionFromNullOr(Schema.String),
});
export interface PendingPath extends Schema.Schema.Type<typeof PendingPath> {}

class RetryLater extends Schema.TaggedError<RetryLater>()("RetryLater", {}) {}

interface WorkQueueInterface {
  readonly schedule: (paths: Iterable<RelativePath>) => Effect.Effect<void, StoreFailed>;
  readonly next: <R>(
    handler: (
      path: RelativePath,
      attempt: { readonly lastAttempt: boolean },
    ) => Effect.Effect<Disposition, never, R>,
  ) => Effect.Effect<void, StoreFailed, R>;
  readonly pending: Effect.Effect<ReadonlyArray<PendingPath>, StoreFailed>;
  readonly pendingCount: Stream.Stream<number>;
  readonly purge: Effect.Effect<void, StoreFailed>;
}

export class WorkQueue extends Context.Service<WorkQueue, WorkQueueInterface>()(
  "effect-app/sync/WorkQueue",
) {
  static readonly make = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const queue = yield* PersistedQueue.make({
      name: QUEUE_NAME,
      schema: Job,
      maxAttempts: MAX_ATTEMPTS,
    });
    const storeFailed = (operation: string) =>
      Effect.mapError((cause: unknown) => new StoreFailed({ operation, cause }));

    const countRows = sql<{ total: number }>`SELECT count(*) AS total FROM pending`.pipe(
      Effect.map((rows) => rows[0]?.total ?? 0),
    );
    const pendingCount = yield* SubscriptionRef.make(yield* countRows.pipe(Effect.orDie));
    const recount = countRows.pipe(
      Effect.flatMap((total) => SubscriptionRef.set(pendingCount, total)),
    );

    const markPending = (path: RelativePath, lastError: string | null) =>
      Effect.flatMap(Clock.currentTimeMillis, (since) =>
        lastError === null
          ? sql`INSERT INTO pending ${sql.insert({ path, since })} ON CONFLICT (path) DO NOTHING`
          : sql`INSERT INTO pending ${sql.insert({ path, since, lastError })}
                ON CONFLICT (path) DO UPDATE SET last_error = excluded.last_error`,
      );
    const settle = (path: RelativePath) => sql`DELETE FROM pending WHERE path = ${path}`;

    const schedule = (paths: Iterable<RelativePath>) =>
      Effect.forEach(
        paths,
        (path) => markPending(path, null).pipe(Effect.andThen(queue.offer({ path }))),
        { discard: true },
      ).pipe(Effect.andThen(recount), storeFailed("schedule"));

    const next = <R>(
      handler: (
        path: RelativePath,
        attempt: { readonly lastAttempt: boolean },
      ) => Effect.Effect<Disposition, never, R>,
    ) =>
      queue
        .take(({ path }, { attempts }) =>
          handler(path, { lastAttempt: attempts >= MAX_ATTEMPTS }).pipe(
            Effect.flatMap(
              Disposition.$match({
                Settled: () => settle(path),
                Parked: ({ reason }) =>
                  markPending(path, reason).pipe(Effect.andThen(queue.offer({ path }))),
                Retry: ({ reason }) =>
                  markPending(path, reason).pipe(Effect.andThen(Effect.fail(new RetryLater()))),
              }),
            ),
            Effect.andThen(recount),
          ),
        )
        .pipe(
          Effect.catchTag("RetryLater", () => Effect.void),
          storeFailed("next"),
        );

    const pending = SqlSchema.findAll({
      Request: Schema.Void,
      Result: PendingPath,
      execute: () => sql`SELECT * FROM pending ORDER BY since`,
    });

    return WorkQueue.of({
      schedule,
      next,
      pending: pending(undefined).pipe(storeFailed("pending")),
      pendingCount: SubscriptionRef.changes(pendingCount),
      purge: sql
        .withTransaction(
          Effect.all([
            sql`DELETE FROM ${sql(QUEUE_TABLE)} WHERE queue_name = ${QUEUE_NAME}`,
            sql`DELETE FROM pending`,
          ]),
        )
        .pipe(Effect.andThen(recount), storeFailed("purge")),
    });
  });

  static readonly layerWithoutDependencies = Layer.effect(WorkQueue, WorkQueue.make);

  static readonly layerWith = (options: { readonly pollInterval: Duration.Input }) =>
    WorkQueue.layerWithoutDependencies.pipe(
      Layer.provide(PersistedQueue.layer),
      Layer.provide(
        PersistedQueue.layerStoreSql({
          tableName: QUEUE_TABLE,
          pollInterval: options.pollInterval,
        }),
      ),
    );

  static readonly layer = WorkQueue.layerWith({ pollInterval: "25 millis" });
}
