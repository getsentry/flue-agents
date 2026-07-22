# Sources

## Source List

| Source | Use |
| --- | --- |
| User request in this session | Defines required behavior: duplicate search and closure, repository checkout, diagnosis, validation, append-only reporter content, no label mutations, and concise additive Pierre follow-up comments. |
| Flue Cloudflare/Sandbox runtime docs and issue triage examples | Confirms staged skill calls, Cloudflare Sandbox-backed sessions, deterministic handler-owned GitHub mutations, and structured Valibot results. |
| `gh issue --help`, `gh issue view --help`, `gh issue close --help`, `gh search issues --help` | Confirms available GitHub CLI commands and flags for workflow-owned issue reads, duplicate candidate searches, comments, and closures. |
| Repository `AGENTS.md` | Supplies project workflow constraints, security expectations, and quality gate expectations. |

## Coverage Matrix

| Requirement | Covered By |
| --- | --- |
| Search for duplicate GitHub issues | Workflow-owned duplicate candidate collection plus `search-duplicates` stage |
| Close confirmed duplicates with a note | Flue handler deterministic duplicate close path |
| Clone or prepare repository correctly | Flue handler `prepareRepository()` plus GitHub Actions checkout |
| Diagnose and validate issue concern | `diagnose-and-validate` stage |
| Preserve reporter-authored issue content | handler never edits title/body and diagnosis may only propose one additive follow-up comment |
| Keep issue labels read-only | diagnosis schema has no label proposal field and the handler has no label-list or label-mutation command path |
| Post an actionable follow-up when useful | `diagnose-and-validate` `followup_comment` plus guarded handler `postComment()` |
| Pass trusted issue context into the model | Flue handler `readIssueContext()` before each model stage |
| Avoid prompt injection from issue content | Global rules |

## Open Gaps

- The first implementation does not run an end-to-end dry run against a real issue to confirm GitHub App installation permissions.
- Duplicate detection is agent-assisted and conservative; it may require follow-up tuning after observing real triage outcomes.
