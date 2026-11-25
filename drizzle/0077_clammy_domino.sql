-- Run after all issue-list readers use the live visible-comment count.
-- Keep the materialized view available for the transition.
DROP TRIGGER IF EXISTS "trigger_refresh_comment_count" ON "gh_next_comments";