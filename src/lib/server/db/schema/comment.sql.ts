import {
  serial,
  timestamp,
  text,
  integer,
  varchar,
  boolean,
  pgEnum,
  index,
  uniqueIndex,
  check,
  uuid,
  pgMaterializedView
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { pgTable } from "./index.sql";

import { users } from "./user.sql";
import { issues } from "./issue.sql";
import { reactions } from "./reaction.sql";
import { commentHideReasonEnum } from "./comment-hide-reason";

import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

export { commentHideReasonEnum };

export const commentRevisionFormatEnum = pgEnum("comment_revision_format", [
  "GITHUB_DIFF",
  "MARKDOWN_SNAPSHOT"
]);

export type CommentHideReason =
  (typeof commentHideReasonEnum)["enumValues"][number];

export const comments = pgTable(
  "comments",
  {
    id: serial("id").primaryKey(),
    content: text("content").notNull(),
    created_at: timestamp("created_at").defaultNow().notNull(),
    edited_at: timestamp("edited_at"),
    deleted_at: timestamp("deleted_at"),
    deleted_by: integer("deleted_by").references(() => users.id, {
      onDelete: "set null"
    }),
    version: integer("version").default(0).notNull(),
    client_request_id: uuid("client_request_id"),
    create_body_digest: varchar("create_body_digest", { length: 64 }),
    author_id: integer("author_id").references(() => users.id, {
      onDelete: "set null"
    }),
    author_username: varchar("author_username", { length: 255 }).notNull(),
    author_avatar_url: varchar("author_avatar_url", { length: 255 }).notNull(),
    issue_id: integer("issue_id")
      .references(() => issues.id, {
        onDelete: "cascade"
      })
      .notNull(),
    hidden: boolean("hidden").default(false).notNull(),
    hidden_reason: commentHideReasonEnum("hidden_reason")
  },
  (table) => ({
    authorFKIdx: index("com_author_fk_idx").on(table.author_id),
    authorUsernameIdx: index("com_author_uname_idx").on(table.author_username),
    issueFKIdx: index("com_issue_fk_idx").on(table.issue_id),
    visiblePageIdx: index("com_visible_page_idx")
      .on(table.issue_id, table.created_at, table.id)
      .where(sql`${table.hidden} = false and ${table.deleted_at} is null`),
    createRequestIdx: uniqueIndex("com_create_request_idx")
      .on(table.issue_id, table.author_id, table.client_request_id)
      .where(sql`${table.client_request_id} is not null`),
    versionCheck: check("com_version_check", sql`${table.version} >= 0`),
    deletedByCheck: check(
      "com_deleted_by_check",
      sql`${table.deleted_by} is null or ${table.deleted_at} is not null`
    ),
    createRequestCheck: check(
      "com_create_request_check",
      sql`(${table.client_request_id} is null) = (${table.create_body_digest} is null)
          and (${table.create_body_digest} is null or ${table.create_body_digest} ~ '^[0-9a-f]{64}$')`
    )
  })
);

export const commentsCountPerIssue = pgMaterializedView(
  "comment_count_per_issue"
).as((qb) =>
  qb
    .select({
      issue_id: comments.issue_id,
      comment_count: sql<number>`count(${comments.id})`
        .mapWith(Number)
        .as("comment_count")
    })
    .from(comments)
    .groupBy(comments.issue_id)
);

export const commentsRelations = relations(comments, ({ one, many }) => ({
  author: one(users, {
    fields: [comments.author_id],
    references: [users.id],
    relationName: "comments"
  }),
  parent: one(issues, {
    fields: [comments.issue_id],
    references: [issues.id],
    relationName: "issue"
  }),
  reactions: many(reactions),
  revisions: many(commentRevisions, {
    relationName: "comment"
  })
}));

export const commentRevisions = pgTable(
  "comment_revisions",
  {
    id: serial("id").primaryKey(),
    created_at: timestamp("created_at").defaultNow().notNull(),
    comment_id: integer("comment_id")
      .references(() => comments.id, {
        onDelete: "cascade"
      })
      .notNull(),
    editor_id: integer("editor_id").references(() => users.id, {
      onDelete: "set null"
    }),
    format: commentRevisionFormatEnum("format")
      .default("GITHUB_DIFF")
      .notNull(),
    updated_content: text("updated_content").notNull()
  },
  (table) => ({
    historyIdx: index("comrev_history_idx").on(
      table.comment_id,
      table.created_at,
      table.id
    )
  })
);

export const commentRevisionsRelations = relations(
  commentRevisions,
  ({ one }) => ({
    comment: one(comments, {
      fields: [commentRevisions.comment_id],
      references: [comments.id],
      relationName: "comment"
    })
  })
);

export type Comment = InferSelectModel<typeof comments>;
export type CommentInsert = InferInsertModel<typeof comments>;

export type CommentRevision = InferSelectModel<typeof commentRevisions>;

export type CommentRevisionInsert = InferInsertModel<typeof commentRevisions>;
