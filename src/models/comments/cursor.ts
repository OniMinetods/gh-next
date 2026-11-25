import "server-only";
import { z } from "zod";
import { issueCommentId } from "./validation";

const timestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/)
  .refine((value) => {
    if (value.startsWith("0000")) return false;
    const milliseconds = value.slice(0, 23) + "Z";
    const date = new Date(milliseconds);
    return (
      Number.isFinite(date.getTime()) && date.toISOString() === milliseconds
    );
  });

const cursorSchema = z.tuple([issueCommentId, timestamp, issueCommentId]);
type CommentCursor = z.infer<typeof cursorSchema>;

export function encodeCommentCursor(cursor: CommentCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCommentCursor(
  cursor: string | undefined,
  issueId: number
) {
  if (!cursor || !/^[A-Za-z0-9_-]{1,128}$/.test(cursor)) return null;

  try {
    const result = cursorSchema.safeParse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    );
    if (!result.success || result.data[0] !== issueId) return null;
    return { createdAt: result.data[1], id: result.data[2] };
  } catch {
    return null;
  }
}
