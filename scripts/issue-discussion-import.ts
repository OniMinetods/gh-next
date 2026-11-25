import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { comments } from "~/lib/server/db/schema/comment.sql";
import { issueEvents } from "~/lib/server/db/schema/event.sql";
import { issues } from "~/lib/server/db/schema/issue.sql";

type ImportTransaction = Parameters<
  Parameters<PostgresJsDatabase["transaction"]>[0]
>[0];

export async function importEmptyIssueDiscussion(
  db: PostgresJsDatabase,
  issueId: number,
  importDiscussion: (tx: ImportTransaction) => Promise<void>
) {
  return db.transaction(async (tx) => {
    // This lock serializes the importer with comment writers on the same issue.
    const [issue] = await tx
      .select({ id: issues.id })
      .from(issues)
      .where(eq(issues.id, issueId))
      .for("update");
    if (!issue)
      throw new Error("Cannot import discussion for a missing issue.");

    const [comment] = await tx
      .select({ id: comments.id })
      .from(comments)
      .where(eq(comments.issue_id, issueId))
      .limit(1);
    if (comment) return false;

    const [event] = await tx
      .select({ id: issueEvents.id })
      .from(issueEvents)
      .where(eq(issueEvents.issue_id, issueId))
      .limit(1);
    if (event) return false;

    await importDiscussion(tx);
    return true;
  });
}
