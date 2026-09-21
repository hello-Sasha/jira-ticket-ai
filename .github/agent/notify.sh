#!/usr/bin/env bash
# Usage: notify.sh "message"
# Posts a comment on the Jira ticket ($KEY) and a message to Slack.
# Never fails the workflow - notification problems should not lose the work.
set -uo pipefail

MSG="$1"

# ---- Jira comment (Cloud REST v3 - body must be Atlassian Document Format) ----
if [ -n "${JIRA_BASE_URL:-}" ] && [ -n "${JIRA_API_TOKEN:-}" ] && [ -n "${KEY:-}" ]; then
  BODY=$(jq -n --arg t "$MSG" '{
    body: {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: $t }] }]
    }
  }')

  curl -sS -o /dev/null -w "Jira comment: HTTP %{http_code}\n" \
    -X POST \
    -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data "$BODY" \
    "$JIRA_BASE_URL/rest/api/3/issue/$KEY/comment" || echo "Jira comment failed."
fi

# ---- Slack ----
if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
  curl -sS -o /dev/null -w "Slack: HTTP %{http_code}\n" \
    -X POST \
    -H "Content-Type: application/json" \
    --data "$(jq -n --arg t "🤖 $MSG" '{text: $t}')" \
    "$SLACK_WEBHOOK_URL" || echo "Slack notify failed."
fi

exit 0
