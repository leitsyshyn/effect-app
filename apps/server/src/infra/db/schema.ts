import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  bigint,
  boolean,
  index,
  integer,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const user = pgTable("auth_user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable(
  "auth_session",
  {
    id: text().primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text().notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("auth_session_user_id_idx").on(table.userId)],
);

export const account = pgTable(
  "auth_account",
  {
    id: text().primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text(),
    password: text(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("auth_account_user_id_idx").on(table.userId)],
);

export const verification = pgTable(
  "auth_verification",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("auth_verification_identifier_idx").on(table.identifier)],
);

export const driveChangeSeq = pgSequence("drive_change_seq");

export const driveNode = pgTable(
  "drive_node",
  {
    id: uuid().primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => driveNode.id),
    name: text().notNull(),
    kind: text({ enum: ["file", "folder"] }).notNull(),
    size: bigint({ mode: "number" }).notNull().default(0),
    contentHash: text("content_hash"),
    contentType: text("content_type"),
    blobKey: text("blob_key"),
    revision: integer().notNull().default(1),
    changeSeq: bigint("change_seq", { mode: "number" })
      .notNull()
      .default(sql`nextval('drive_change_seq')`),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    uniqueIndex("drive_node_live_sibling_name_idx")
      .on(
        table.ownerId,
        sql`coalesce(${table.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`lower(${table.name})`,
      )
      .where(sql`${table.deletedAt} is null`),
    index("drive_node_owner_change_seq_idx").on(table.ownerId, table.changeSeq),
    index("drive_node_parent_idx").on(table.parentId),
  ],
);
