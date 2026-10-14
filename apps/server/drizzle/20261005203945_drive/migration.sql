CREATE SEQUENCE "public"."drive_change_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "drive_node" (
	"id" uuid PRIMARY KEY,
	"owner_id" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"content_hash" text,
	"content_type" text,
	"blob_key" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"change_seq" bigint DEFAULT nextval('drive_change_seq') NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "drive_node_live_sibling_name_idx" ON "drive_node" ("owner_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name")) WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "drive_node_owner_change_seq_idx" ON "drive_node" ("owner_id","change_seq");--> statement-breakpoint
CREATE INDEX "drive_node_parent_idx" ON "drive_node" ("parent_id");--> statement-breakpoint
ALTER TABLE "drive_node" ADD CONSTRAINT "drive_node_owner_id_auth_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "drive_node" ADD CONSTRAINT "drive_node_parent_id_drive_node_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "drive_node"("id");--> statement-breakpoint
ALTER TABLE "drive_node" ADD CONSTRAINT "drive_node_created_by_auth_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "auth_user"("id");--> statement-breakpoint
ALTER TABLE "drive_node" ADD CONSTRAINT "drive_node_updated_by_auth_user_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth_user"("id");