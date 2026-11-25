DO $$ BEGIN
 CREATE TYPE "comment_revision_format" AS ENUM('GITHUB_DIFF', 'MARKDOWN_SNAPSHOT');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TYPE "event_type" ADD VALUE 'DELETE_COMMENT';--> statement-breakpoint
ALTER TYPE "event_type" ADD VALUE 'RESTORE_COMMENT';--> statement-breakpoint
ALTER TYPE "event_type" ADD VALUE 'HIDE_COMMENT';--> statement-breakpoint
ALTER TYPE "event_type" ADD VALUE 'UNHIDE_COMMENT';--> statement-breakpoint
ALTER TABLE "gh_next_comment_revisions" ADD COLUMN "editor_id" integer;--> statement-breakpoint
ALTER TABLE "gh_next_comment_revisions" ADD COLUMN "format" "comment_revision_format" DEFAULT 'GITHUB_DIFF' NOT NULL;--> statement-breakpoint
ALTER TABLE "gh_next_comments" ADD COLUMN "edited_at" timestamp;--> statement-breakpoint
ALTER TABLE "gh_next_comments" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "gh_next_comments" ADD COLUMN "deleted_by" integer;--> statement-breakpoint
ALTER TABLE "gh_next_comments" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gh_next_comments" ADD COLUMN "client_request_id" uuid;--> statement-breakpoint
ALTER TABLE "gh_next_comments" ADD COLUMN "create_body_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "gh_next_issue_events" ADD COLUMN "comment_hidden_reason" "comment_hide_reason";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comrev_history_idx" ON "gh_next_comment_revisions" ("comment_id","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "com_visible_page_idx" ON "gh_next_comments" ("issue_id","created_at","id")
  WHERE "hidden" = false AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "com_create_request_idx" ON "gh_next_comments" ("issue_id","author_id","client_request_id")
  WHERE "client_request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ev_comment_history_idx" ON "gh_next_issue_events" ("comment_id","created_at","id")
  WHERE "comment_id" IS NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gh_next_comment_revisions" ADD CONSTRAINT "gh_next_comment_revisions_editor_id_gh_next_users_id_fk" FOREIGN KEY ("editor_id") REFERENCES "gh_next_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gh_next_comments" ADD CONSTRAINT "gh_next_comments_deleted_by_gh_next_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "gh_next_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Drizzle Kit 0.19 does not emit the check constraints defined in the schema.
ALTER TABLE "gh_next_comments" ADD CONSTRAINT "com_version_check" CHECK ("version" >= 0);
--> statement-breakpoint
ALTER TABLE "gh_next_comments" ADD CONSTRAINT "com_deleted_by_check"
  CHECK ("deleted_by" IS NULL OR "deleted_at" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "gh_next_comments" ADD CONSTRAINT "com_create_request_check"
  CHECK (("client_request_id" IS NULL) = ("create_body_digest" IS NULL)
    AND ("create_body_digest" IS NULL OR "create_body_digest" ~ '^[0-9a-f]{64}$'));
--> statement-breakpoint
-- Compare enum labels as text so PostgreSQL 12 can validate existing rows
-- before the newly added enum values become usable at commit.
ALTER TABLE "gh_next_issue_events" ADD CONSTRAINT "ev_comment_target_check"
  CHECK ("type"::text NOT IN ('DELETE_COMMENT', 'RESTORE_COMMENT', 'HIDE_COMMENT', 'UNHIDE_COMMENT')
    OR "comment_id" IS NOT NULL);
--> statement-breakpoint
-- A legacy hidden comment may not have a reason to record when unhidden.
ALTER TABLE "gh_next_issue_events" ADD CONSTRAINT "ev_comment_reason_check"
  CHECK (("type"::text <> 'HIDE_COMMENT' OR "comment_hidden_reason" IS NOT NULL)
    AND ("comment_hidden_reason" IS NULL OR "type"::text IN ('HIDE_COMMENT', 'UNHIDE_COMMENT')));
