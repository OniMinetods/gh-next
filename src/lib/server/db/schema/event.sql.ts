import {
  serial,
  varchar,
  integer,
  timestamp,
  pgEnum,
  index,
  check
} from "drizzle-orm/pg-core";

import { relations, sql } from "drizzle-orm";
import { users } from "./user.sql";
import { labels } from "./label.sql";
import { issues } from "./issue.sql";

import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { pgTable } from "./index.sql";
import { comments } from "./comment.sql";
import { commentHideReasonEnum } from "./comment-hide-reason";

export const eventTypeEnum = pgEnum("event_type", [
  "CHANGE_TITLE",
  "TOGGLE_STATUS",
  "ISSUE_MENTION",
  "ASSIGN_USER",
  "ADD_LABEL",
  "REMOVE_LABEL",
  "ADD_COMMENT",
  "DELETE_COMMENT",
  "RESTORE_COMMENT",
  "HIDE_COMMENT",
  "UNHIDE_COMMENT"
]);

export type EventType = (typeof eventTypeEnum)["enumValues"][number];

// this is repeated but not included in the database migration because it is not exported,
// the original enum is defined in `issue.ts` file
const issueStatusEnum = pgEnum("issue_status", [
  "OPEN",
  "CLOSED",
  "NOT_PLANNED"
]);

export const issueEvents = pgTable(
  "issue_events",
  {
    id: serial("id").primaryKey(),
    created_at: timestamp("created_at").defaultNow().notNull(),
    initiator_id: integer("initiator_id").references(() => users.id, {
      onDelete: "set null"
    }),
    initiator_username: varchar("initiator_username", {
      length: 255
    }).notNull(),
    initiator_avatar_url: varchar("initiator_avatar_url", {
      length: 255
    }).notNull(),

    issue_id: integer("issue_id")
      .references(() => issues.id, {
        onDelete: "cascade"
      })
      .notNull(),
    type: eventTypeEnum("type").notNull(),

    // type = CHANGE_TITLE
    old_title: varchar("old_title", { length: 255 }),
    new_title: varchar("new_title", { length: 255 }),

    // type = TOGGLE_STATUS
    status: issueStatusEnum("status"),

    // type = ISSUE_MENTION
    mentionned_issue_id: integer("mentionned_issue_id").references(
      () => issues.id,
      {
        onDelete: "cascade"
      }
    ),

    // type = ASSIGN_USER
    assignee_username: varchar("assignee_username", { length: 255 }),
    assignee_avatar_url: varchar("assignee_avatar_url", {
      length: 255
    }),

    // type = ADD_LABEL | REMOVE_LABEL
    label_id: integer("label_id").references(() => labels.id, {
      onDelete: "cascade"
    }),

    // Comment creation and visibility changes.
    comment_id: integer("comment_id").references(() => comments.id, {
      onDelete: "cascade"
    }),
    comment_hidden_reason: commentHideReasonEnum("comment_hidden_reason")
  },
  (table) => ({
    initiatorUsernameIdx: index("ev_initiator_uname_idx").on(
      table.initiator_username
    ),
    assigneeUsernameIdx: index("ev_assignee_uname_idx").on(
      table.assignee_username
    ),
    commentHistoryIdx: index("ev_comment_history_idx")
      .on(table.comment_id, table.created_at, table.id)
      .where(sql`${table.comment_id} is not null`),
    // PostgreSQL 12 only accepts new enum values after the migration commits.
    commentTargetCheck: check(
      "ev_comment_target_check",
      sql`${table.type}::text not in ('DELETE_COMMENT', 'RESTORE_COMMENT', 'HIDE_COMMENT', 'UNHIDE_COMMENT')
          or ${table.comment_id} is not null`
    ),
    commentReasonCheck: check(
      "ev_comment_reason_check",
      sql`(${table.type}::text <> 'HIDE_COMMENT' or ${table.comment_hidden_reason} is not null)
          and (${table.comment_hidden_reason} is null or ${table.type}::text in ('HIDE_COMMENT', 'UNHIDE_COMMENT'))`
    )
  })
);

export const issueEventsRelations = relations(issueEvents, ({ one }) => ({
  initiator: one(users, {
    fields: [issueEvents.initiator_id],
    references: [users.id],
    relationName: "initiator"
  }),

  label: one(labels, {
    fields: [issueEvents.label_id],
    references: [labels.id],
    relationName: "label"
  }),

  comment: one(comments, {
    fields: [issueEvents.comment_id],
    references: [comments.id],
    relationName: "comment"
  }),

  issue: one(issues, {
    fields: [issueEvents.issue_id],
    references: [issues.id],
    relationName: "parent"
  }),

  mentionned_issue: one(issues, {
    fields: [issueEvents.mentionned_issue_id],
    references: [issues.id],
    relationName: "mentionned_issue"
  })
}));

export type IssueEvent = InferSelectModel<typeof issueEvents>;
export type IssueEventInsert = InferInsertModel<typeof issueEvents>;
