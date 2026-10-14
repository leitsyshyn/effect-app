import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Array, Context, Effect, Layer, Option, Order, Schema } from "effect";
import { ContentHash, DriveNode, NodeId, NodeKind } from "@effect-app/domain/drive";
import type { NodeName } from "@effect-app/domain/drive";
import type { UserId } from "@effect-app/domain/user";
import { EffectPgDrizzleClient, PersistenceError } from "../../infra/db/client";
import { describeContent } from "./content-types";
import { driveNode, user } from "../../infra/db/schema";

export interface NodeRecord {
  readonly node: DriveNode;
  readonly blobKey: Option.Option<string>;
  readonly changeSeq: number;
}

export interface NewNode {
  readonly id: NodeId;
  readonly ownerId: UserId;
  readonly parentId: Option.Option<NodeId>;
  readonly name: NodeName;
  readonly kind: NodeKind;
  readonly size: number;
  readonly contentHash: Option.Option<ContentHash>;
  readonly contentType: Option.Option<string>;
  readonly blobKey: Option.Option<string>;
  readonly actor: UserId;
}

export interface NodePatch {
  readonly name?: NodeName;
  readonly parentId?: Option.Option<NodeId>;
  readonly content?: {
    readonly size: number;
    readonly contentHash: ContentHash;
    readonly contentType: string;
    readonly blobKey: string;
  };
  readonly actor: UserId;
}

export interface DeletedSubtree {
  readonly blobKeys: ReadonlyArray<string>;
  readonly lastSeq: number;
}

export interface ChangeRecords {
  readonly records: ReadonlyArray<NodeRecord>;
  readonly lastSeq: number;
}

const NodeFromRow = Schema.Struct({
  node: DriveNode.pipe(
    Schema.fieldsAssign({
      parentId: Schema.OptionFromNullOr(NodeId),
      contentHash: Schema.OptionFromNullOr(ContentHash),
      contentType: Schema.OptionFromNullOr(Schema.String),
      createdAt: Schema.DateTimeUtcFromDate,
      updatedAt: Schema.DateTimeUtcFromDate,
      deletedAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromDate),
    }),
  ),
  blobKey: Schema.OptionFromNullOr(Schema.String),
  changeSeq: Schema.Finite,
});

const decodeRecords = Schema.decodeUnknownEffect(Schema.Array(NodeFromRow));

interface FlatRow {
  readonly name: string;
  readonly kind: string;
  readonly contentType: string | null;
  readonly createdById: string;
  readonly createdByName: string;
  readonly updatedById: string;
  readonly updatedByName: string;
  readonly blobKey: string | null;
  readonly changeSeq: number;
}

const decodeRows = (rows: ReadonlyArray<FlatRow>) =>
  decodeRecords(
    rows.map(
      ({
        createdById,
        createdByName,
        updatedById,
        updatedByName,
        blobKey,
        changeSeq,
        ...node
      }) => ({
        node: {
          ...node,
          ...describeContent({
            name: node.name,
            kind: node.kind === "folder" ? "folder" : "file",
            contentType: Option.fromNullOr(node.contentType),
          }),
          createdBy: { id: createdById, name: createdByName },
          updatedBy: { id: updatedById, name: updatedByName },
        },
        blobKey,
        changeSeq,
      }),
    ),
  );

const AncestryRows = Schema.Array(Schema.Struct({ id: NodeId, depth: Schema.Finite }));
const DeletedRows = Schema.Array(
  Schema.Struct({
    blob_key: Schema.NullOr(Schema.String),
    change_seq: Schema.FiniteFromString,
  }),
);

const creator = alias(user, "creator");
const editor = alias(user, "editor");

interface DriveRepositoryInterface {
  readonly transact: <A, E, R>(
    ownerId: UserId,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | PersistenceError, R>;
  readonly findLive: (
    ownerId: UserId,
    id: NodeId,
  ) => Effect.Effect<Option.Option<NodeRecord>, PersistenceError>;
  readonly findLiveChild: (
    ownerId: UserId,
    parentId: Option.Option<NodeId>,
    name: NodeName,
  ) => Effect.Effect<Option.Option<NodeRecord>, PersistenceError>;
  readonly listLiveChildren: (
    ownerId: UserId,
    parentId: Option.Option<NodeId>,
  ) => Effect.Effect<ReadonlyArray<NodeRecord>, PersistenceError>;
  readonly pathTo: (
    ownerId: UserId,
    id: NodeId,
  ) => Effect.Effect<ReadonlyArray<NodeRecord>, PersistenceError>;
  readonly insert: (node: NewNode) => Effect.Effect<NodeRecord, PersistenceError>;
  readonly update: (
    ownerId: UserId,
    id: NodeId,
    patch: NodePatch,
  ) => Effect.Effect<NodeRecord, PersistenceError>;
  readonly deleteSubtree: (
    ownerId: UserId,
    id: NodeId,
    actor: UserId,
  ) => Effect.Effect<DeletedSubtree, PersistenceError>;
  readonly listChanges: (
    ownerId: UserId,
    afterSeq: number,
    limit: number,
  ) => Effect.Effect<ChangeRecords, PersistenceError>;
  readonly headSeq: (ownerId: UserId) => Effect.Effect<number, PersistenceError>;
}

export class DriveRepository extends Context.Service<DriveRepository, DriveRepositoryInterface>()(
  "effect-app/drive/DriveRepository",
) {
  static readonly make: Effect.Effect<DriveRepositoryInterface, never, EffectPgDrizzleClient> =
    Effect.gen(function* () {
      const db = yield* EffectPgDrizzleClient;

      const persistenceError = (operation: string) =>
        Effect.mapError((cause: unknown) => new PersistenceError({ operation, cause }));

      const selectRecords = () =>
        db
          .select({
            id: driveNode.id,
            parentId: driveNode.parentId,
            name: driveNode.name,
            kind: driveNode.kind,
            size: driveNode.size,
            contentHash: driveNode.contentHash,
            contentType: driveNode.contentType,
            revision: driveNode.revision,
            createdAt: driveNode.createdAt,
            createdById: creator.id,
            createdByName: creator.name,
            updatedAt: driveNode.updatedAt,
            updatedById: editor.id,
            updatedByName: editor.name,
            deletedAt: driveNode.deletedAt,
            blobKey: driveNode.blobKey,
            changeSeq: driveNode.changeSeq,
          })
          .from(driveNode)
          .innerJoin(creator, eq(creator.id, driveNode.createdBy))
          .innerJoin(editor, eq(editor.id, driveNode.updatedBy));

      const parentIs = (parentId: Option.Option<NodeId>) =>
        Option.match(parentId, {
          onNone: () => isNull(driveNode.parentId),
          onSome: (id) => eq(driveNode.parentId, id),
        });

      const getById = (ownerId: UserId, id: NodeId) =>
        Effect.flatMap(
          selectRecords().where(and(eq(driveNode.ownerId, ownerId), eq(driveNode.id, id))),
          decodeRows,
        ).pipe(
          Effect.map(Array.head),
          Effect.flatMap(Effect.fromOption),
          Effect.catchTag("NoSuchElementError", Effect.die),
        );

      const transact = <A, E, R>(ownerId: UserId, effect: Effect.Effect<A, E, R>) =>
        db
          .transaction(() =>
            db
              .execute(sql`select pg_advisory_xact_lock(hashtext(${ownerId}))`)
              .pipe(persistenceError("lockOwner"), Effect.andThen(effect)),
          )
          .pipe(
            Effect.catchTag("SqlError", (cause) =>
              Effect.fail(new PersistenceError({ operation: "transaction", cause })),
            ),
          );

      const findLive = Effect.fn("DriveRepository.findLive")(function* (
        ownerId: UserId,
        id: NodeId,
      ) {
        const rows = yield* selectRecords().where(
          and(eq(driveNode.ownerId, ownerId), eq(driveNode.id, id), isNull(driveNode.deletedAt)),
        );
        return Array.head(yield* decodeRows(rows));
      }, persistenceError("findLive"));

      const findLiveChild = Effect.fn("DriveRepository.findLiveChild")(function* (
        ownerId: UserId,
        parentId: Option.Option<NodeId>,
        name: NodeName,
      ) {
        const rows = yield* selectRecords().where(
          and(
            eq(driveNode.ownerId, ownerId),
            parentIs(parentId),
            sql`lower(${driveNode.name}) = lower(${name})`,
            isNull(driveNode.deletedAt),
          ),
        );
        return Array.head(yield* decodeRows(rows));
      }, persistenceError("findLiveChild"));

      const listLiveChildren = Effect.fn("DriveRepository.listLiveChildren")(function* (
        ownerId: UserId,
        parentId: Option.Option<NodeId>,
      ) {
        const rows = yield* selectRecords()
          .where(
            and(eq(driveNode.ownerId, ownerId), parentIs(parentId), isNull(driveNode.deletedAt)),
          )
          .orderBy(asc(driveNode.name));
        return yield* decodeRows(rows);
      }, persistenceError("listLiveChildren"));

      const pathTo = Effect.fn("DriveRepository.pathTo")(function* (ownerId: UserId, id: NodeId) {
        const rawAncestry = yield* db.execute(
          sql`
            with recursive ancestry(id, parent_id, depth) as (
              select id, parent_id, 0 from drive_node
              where id = ${id} and owner_id = ${ownerId} and deleted_at is null
              union all
              select n.id, n.parent_id, a.depth + 1 from drive_node n
              join ancestry a on n.id = a.parent_id
              where n.deleted_at is null
            )
            select id, depth from ancestry`,
          "objects",
        );
        const ancestry = yield* Schema.decodeUnknownEffect(AncestryRows)(rawAncestry);
        const ids = ancestry.map((row) => row.id);
        if (ids.length === 0) return [];
        const depthById = new Map(ancestry.map((row) => [row.id, row.depth]));
        const records = yield* decodeRows(
          yield* selectRecords().where(
            and(eq(driveNode.ownerId, ownerId), inArray(driveNode.id, ids)),
          ),
        );
        return Array.sort(
          records,
          Order.flip(
            Order.mapInput(
              Order.Number,
              (record: NodeRecord) => depthById.get(record.node.id) ?? 0,
            ),
          ),
        );
      }, persistenceError("pathTo"));

      const insert = Effect.fn("DriveRepository.insert")(function* (node: NewNode) {
        yield* db.insert(driveNode).values({
          id: node.id,
          ownerId: node.ownerId,
          parentId: Option.getOrNull(node.parentId),
          name: node.name,
          kind: node.kind,
          size: node.size,
          contentHash: Option.getOrNull(node.contentHash),
          contentType: Option.getOrNull(node.contentType),
          blobKey: Option.getOrNull(node.blobKey),
          createdBy: node.actor,
          updatedBy: node.actor,
        });
        return yield* getById(node.ownerId, node.id);
      }, persistenceError("insert"));

      const update = Effect.fn("DriveRepository.update")(function* (
        ownerId: UserId,
        id: NodeId,
        patch: NodePatch,
      ) {
        yield* db
          .update(driveNode)
          .set({
            ...(patch.name === undefined ? {} : { name: patch.name }),
            ...(patch.parentId === undefined ? {} : { parentId: Option.getOrNull(patch.parentId) }),
            ...(patch.content === undefined
              ? {}
              : {
                  size: patch.content.size,
                  contentHash: patch.content.contentHash,
                  contentType: patch.content.contentType,
                  blobKey: patch.content.blobKey,
                }),
            revision: sql`${driveNode.revision} + 1`,
            changeSeq: sql`nextval('drive_change_seq')`,
            updatedAt: sql`now()`,
            updatedBy: patch.actor,
          })
          .where(and(eq(driveNode.ownerId, ownerId), eq(driveNode.id, id)));
        return yield* getById(ownerId, id);
      }, persistenceError("update"));

      const deleteSubtree = Effect.fn("DriveRepository.deleteSubtree")(function* (
        ownerId: UserId,
        id: NodeId,
        actor: UserId,
      ) {
        const rawRows = yield* db.execute(
          sql`
            with recursive subtree(id) as (
              select id from drive_node
              where id = ${id} and owner_id = ${ownerId} and deleted_at is null
              union all
              select n.id from drive_node n
              join subtree s on n.parent_id = s.id
              where n.deleted_at is null
            )
            update drive_node
            set deleted_at = now(),
                updated_at = now(),
                updated_by = ${actor},
                revision = revision + 1,
                change_seq = nextval('drive_change_seq')
            where id in (select id from subtree)
            returning blob_key, change_seq::text as change_seq`,
          "objects",
        );
        const rows = yield* Schema.decodeUnknownEffect(DeletedRows)(rawRows);
        return {
          blobKeys: rows.flatMap((row) => (row.blob_key === null ? [] : [row.blob_key])),
          lastSeq: Math.max(0, ...rows.map((row) => row.change_seq)),
        };
      }, persistenceError("deleteSubtree"));

      const listChanges = Effect.fn("DriveRepository.listChanges")(function* (
        ownerId: UserId,
        afterSeq: number,
        limit: number,
      ) {
        const rows = yield* selectRecords()
          .where(and(eq(driveNode.ownerId, ownerId), gt(driveNode.changeSeq, afterSeq)))
          .orderBy(asc(driveNode.changeSeq))
          .limit(limit);
        const records = yield* decodeRows(rows);
        return {
          records,
          lastSeq: Option.match(Array.last(records), {
            onNone: () => afterSeq,
            onSome: (record) => record.changeSeq,
          }),
        };
      }, persistenceError("listChanges"));

      const headSeq = Effect.fn("DriveRepository.headSeq")(function* (ownerId: UserId) {
        const rows = yield* db
          .select({ seq: sql<number>`coalesce(max(${driveNode.changeSeq}), 0)`.mapWith(Number) })
          .from(driveNode)
          .where(eq(driveNode.ownerId, ownerId));
        return rows[0]?.seq ?? 0;
      }, persistenceError("headSeq"));

      return DriveRepository.of({
        headSeq,
        transact,
        findLive,
        findLiveChild,
        listLiveChildren,
        pathTo,
        insert,
        update,
        deleteSubtree,
        listChanges,
      });
    });

  static readonly layerWithoutDependencies = Layer.effect(DriveRepository, DriveRepository.make);

  static readonly layer = DriveRepository.layerWithoutDependencies.pipe(
    Layer.provide(EffectPgDrizzleClient.layer),
  );
}
