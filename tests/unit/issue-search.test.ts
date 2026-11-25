import { describe, expect, it } from "vitest";
import { DEFAULT_ISSUE_SEARCH_QUERY } from "~/lib/shared/constants";
import {
  formatSearchFiltersToString,
  parseIssueFilterTokens
} from "~/lib/shared/utils.shared";

describe("issue search filters", () => {
  it("parses the issue list's default query as an open issue filter", () => {
    expect(parseIssueFilterTokens(DEFAULT_ISSUE_SEARCH_QUERY).is).toBe("open");
  });

  it("leaves omitted filters unspecified for its callers", () => {
    expect(parseIssueFilterTokens("")).toEqual({});
  });

  it("parses quoted labels, multiple assignees and free text", () => {
    expect(
      parseIssueFilterTokens(
        'is:closed reason:completed label:"area: app" assignee:alice,bob login regression'
      )
    ).toMatchObject({
      is: "closed",
      reason: "completed",
      label: ["area: app"],
      assignee: ["alice", "bob"],
      query: "login regression"
    });
  });

  it("falls back to the default for an unsupported sort order", () => {
    expect(parseIssueFilterTokens("sort:unknown").sort).toBe("created-desc");
  });

  it("keeps filters and free text when serialized and parsed again", () => {
    const filters = parseIssueFilterTokens(
      'in:title in:body no:label no:label -label:"needs review" mentions:@me sort:updated-desc flaky build'
    );

    expect(filters.in).toEqual(new Set(["title", "body"]));
    expect(filters.no).toEqual(["label"]);
    expect(
      parseIssueFilterTokens(formatSearchFiltersToString(filters))
    ).toEqual(filters);
  });
});
