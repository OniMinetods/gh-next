INSERT INTO gh_next_users (github_id, username, avatar_url, name)
VALUES
  ('900000002', 'FixtureAuthor', '/favicon.png', 'Fixture Author'),
  ('900000003', 'FixtureReader', '/favicon.png', 'Fixture Reader')
ON CONFLICT (github_id) DO NOTHING;

INSERT INTO gh_next_repositories (name, creator_id, is_public, is_archived)
SELECT fixture.name, owner.id, fixture.is_public, fixture.is_archived
FROM gh_next_users AS owner
CROSS JOIN (VALUES
  ('private-discussion-fixture', false, false),
  ('archived-discussion-fixture', true, true),
  ('other-discussion-fixture', true, false)
) AS fixture(name, is_public, is_archived)
WHERE owner.github_id = '900000001'
ON CONFLICT (name) DO NOTHING;

DELETE FROM gh_next_issues AS issue
USING gh_next_repositories AS repository
WHERE issue.repository_id = repository.id
  AND (
    (repository.name = 'gh-next' AND issue.number BETWEEN 50 AND 56)
    OR repository.name IN (
      'private-discussion-fixture', 'archived-discussion-fixture', 'other-discussion-fixture'
    )
  );

INSERT INTO gh_next_issues (
  number, title, body, is_locked, author_id, author_username, author_avatar_url, repository_id
)
SELECT fixture.number, fixture.title, fixture.body, fixture.locked,
  owner.id, owner.username, owner.avatar_url, repository.id
FROM (VALUES
  ('gh-next', 50, 'Comment lifecycle fixture', 'Comment lifecycle', false),
  ('gh-next', 51, 'Moderation fixture', 'Comment moderation', false),
  ('gh-next', 52, 'Comment pages fixture', 'Comment pagination', false),
  ('gh-next', 53, 'Concurrent editing fixture', 'Concurrent editing', false),
  ('gh-next', 54, 'Locked discussion fixture', 'Locked issue', true),
  ('gh-next', 55, 'Comment retry fixture', 'Retry a failed submission', false),
  ('gh-next', 56, '<b>Literal issue title</b>', 'Safe Markdown rendering', false),
  ('private-discussion-fixture', 50, 'Private fixture title', 'Private issue content', false),
  ('archived-discussion-fixture', 50, 'Archived discussion fixture', 'Archived repo', false),
  ('other-discussion-fixture', 50, 'Other repository issue', 'Another issue numbered 50', false)
) AS fixture(repo, number, title, body, locked)
JOIN gh_next_repositories AS repository ON repository.name = fixture.repo
JOIN gh_next_users AS owner ON owner.id = repository.creator_id;

-- Same timestamp all the way through the page boundary, with no linked profile.
WITH inserted AS (
  INSERT INTO gh_next_comments (content, author_username, author_avatar_url, issue_id, created_at)
  SELECT 'Imported comment ' || item, 'ImportedAuthor', '/favicon.png', issue.id, TIMESTAMP '2023-01-01 10:01:02.123456'
  FROM gh_next_issues AS issue
  JOIN gh_next_repositories AS repository ON issue.repository_id = repository.id
  CROSS JOIN generate_series(1, 26) AS item
  WHERE repository.name = 'gh-next' AND issue.number = 52
  ORDER BY item
  RETURNING id, content
)
INSERT INTO gh_next_comment_revisions (comment_id, created_at, updated_content)
SELECT id, TIMESTAMP '2023-01-02 11:00:00', E'- Old imported text\n+ Imported comment 26\n+ <b>Literal diff</b>'
FROM inserted
WHERE content = 'Imported comment 26';
