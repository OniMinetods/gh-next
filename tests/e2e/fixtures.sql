INSERT INTO gh_next_users (github_id, username, avatar_url, name)
VALUES ('900000001', 'Fredkiss3', '/favicon.png', 'Fixture Maintainer')
ON CONFLICT (github_id) DO UPDATE SET
  username = EXCLUDED.username,
  avatar_url = EXCLUDED.avatar_url,
  name = EXCLUDED.name;

INSERT INTO gh_next_repositories (name, creator_id, description, is_public)
SELECT 'gh-next', id, 'Baseline fixture repository', true
FROM gh_next_users
WHERE github_id = '900000001'
ON CONFLICT (name) DO UPDATE SET
  creator_id = EXCLUDED.creator_id,
  description = EXCLUDED.description,
  is_public = EXCLUDED.is_public;

WITH fixture_issues (number, title, body, status) AS (
  VALUES
    (42, 'Baseline open issue', $md$## Baseline issue details

This description includes **rendered emphasis** and a [repository link](/Fredkiss3/gh-next).

- [x] Markdown checklist item
$md$, 'OPEN'::issue_status),
    (43, 'Baseline closed issue', 'A completed issue for the status filter.', 'CLOSED'::issue_status)
)
INSERT INTO gh_next_issues (
  number, title, body, status, author_id, author_username, author_avatar_url, repository_id
)
SELECT fixture.number, fixture.title, fixture.body, fixture.status,
  owner.id, owner.username, owner.avatar_url, repository.id
FROM fixture_issues AS fixture
JOIN gh_next_repositories AS repository ON repository.name = 'gh-next'
JOIN gh_next_users AS owner ON owner.id = repository.creator_id
ON CONFLICT (repository_id, number) DO UPDATE SET
  title = EXCLUDED.title,
  body = EXCLUDED.body,
  status = EXCLUDED.status,
  author_id = EXCLUDED.author_id,
  author_username = EXCLUDED.author_username,
  author_avatar_url = EXCLUDED.author_avatar_url;
