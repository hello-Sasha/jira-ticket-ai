# Jira Automation rule - exact settings

Jira Cloud: **Project settings → Automation → Create rule**.

## Rule 1 - "Send ticket to AI agent"

### Trigger
**Issue transitioned** → To status: `Ready for AI`

(Alternative if you prefer labels: **Issue updated**, with a condition
`Label` `contains` `ai-agent`. The status version is harder to fire twice by
accident.)

### Condition (recommended)
**Issue fields condition** → Field: `Description`, Condition: `is not empty`.

### Action 1 — Send web request

| Field | Value |
|---|---|
| Web request URL | `https://api.github.com/repos/YOUR_ORG/YOUR_REPO/dispatches` |
| HTTP method | `POST` |
| Web request body | `Custom data` |
| Delay execution | unchecked |

Headers:

| Key | Value |
|---|---|
| `Authorization` | `Bearer ghp_YOUR_FINE_GRAINED_PAT` |
| `Accept` | `application/vnd.github+json` |
| `Content-Type` | `application/json` |
| `X-GitHub-Api-Version` | `2022-11-28` |

Custom data (body):

```json
{
  "event_type": "jira-task",
  "client_payload": {
    "key": "{{issue.key}}",
    "summary": {{issue.summary.asJsonString}},
    "description": {{issue.description.plainText.asJsonString}}
  }
}
```

`asJsonString` adds its own quotes and escapes newlines and quotes in the text —
that is why `summary` and `description` are not wrapped in `"` here while `key` is.
Getting this wrong is the single most common cause of a 400 from GitHub.

A successful dispatch returns **HTTP 204 with an empty body**. Do not tick
"Delay execution of subsequent rule actions until we've received a response" unless
you want the rule to log that response.

### Action 2 — Transition issue
→ `In Progress (AI)`

This stops the same ticket from being dispatched twice.

---

## Rule 2 (optional) - "Re-run on request"

### Trigger
**Issue commented**, with a condition: comment body `contains` `/ai retry`

### Action
Same web request as above. Useful after you answer the agent's questions on an
`unclear` ticket.

---

## GitHub token for Jira

Create a **fine-grained personal access token** (GitHub → Settings → Developer
settings → Personal access tokens → Fine-grained).

- Repository access: only the repo you are wiring up.
- Repository permissions: **Contents: Read and write** (this is what grants
  `repository_dispatch`), **Metadata: Read-only**.
- Expiry: 90 days. Put a calendar reminder to rotate it — a silently expired token
  looks exactly like "the agent stopped working".

---

## Testing the dispatch without Jira

```bash
curl -X POST \
  -H "Authorization: Bearer $GH_PAT" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/YOUR_ORG/YOUR_REPO/dispatches \
  -d '{
    "event_type": "jira-task",
    "client_payload": {
      "key": "TEST-1",
      "summary": "Add a health check endpoint",
      "description": "Add GET /health returning {status: ok} and a unit test.\n\nAcceptance criteria:\n- 200 with {\"status\":\"ok\"}\n- covered by a unit test"
    }
  }'
```

Expect `HTTP 204` and a run appearing in the repo's Actions tab within a few seconds.
