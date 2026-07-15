## Purpose

Define the current GitHub issue triage capability: a bounded Flue workflow that gathers issue context, delegates duplicate search and diagnosis to the issue-triage agent, and performs guarded GitHub mutations deterministically.

## Requirements

### Requirement: Workflow-owned issue triage entry point
The system SHALL expose GitHub issue triage through the `issue-triage` workflow and SHALL keep the underlying `issue-triage` agent non-routable to direct HTTP callers.

#### Scenario: Workflow route is available
- **WHEN** the Flue project is built
- **THEN** the `issue-triage` workflow is discoverable as the bounded entry point for issue triage
- **AND** callers can invoke it with an issue number, optional repository, and optional dry-run mode.

#### Scenario: Dry-run verification
- **WHEN** the workflow is invoked with `dryRun: true`
- **THEN** it runs duplicate search, repository preparation, and diagnosis
- **AND** returns proposed actions plus bug or gap analysis
- **AND** does not apply labels, post comments, edit the issue, or close it.

#### Scenario: Agent route is not exposed
- **WHEN** the issue-triage agent module is loaded
- **THEN** it does not export a route handler for direct prompt access
- **AND** all external triage requests must pass through the workflow.

#### Scenario: Missing GitHub App credentials
- **WHEN** the workflow starts without `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_INSTALLATION_ID`, or `GITHUB_APP_PRIVATE_KEY`
- **THEN** it fails before reading or mutating GitHub issue state
- **AND** the failure explains that GitHub App authentication is required.

#### Scenario: GitHub App installation token
- **WHEN** the workflow starts with `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_APP_PRIVATE_KEY`
- **THEN** it mints a short-lived installation token before running GitHub CLI commands
- **AND** the GitHub CLI commands use that installation token through `GH_TOKEN` and `GITHUB_TOKEN` carrier environment variables
- **AND** `GH_TOKEN`, `GITHUB_TOKEN`, and `GITHUB_APP_ID` are not accepted as input credential fallbacks.

### Requirement: Current issue context collection
The workflow SHALL fetch the current GitHub issue snapshot and repository labels before agent diagnosis and SHALL re-fetch issue state before applying GitHub mutations.

#### Scenario: Issue context is fetched
- **WHEN** a triage request is accepted
- **THEN** the workflow fetches the issue title, body, author, labels, comments, URL, state, creation timestamp, and update timestamp
- **AND** the workflow fetches repository labels with names and descriptions.

#### Scenario: Repository argument is supplied
- **WHEN** the payload includes a repository in `owner/name` form
- **THEN** GitHub commands include that repository argument
- **AND** the fetched context records the repository.

#### Scenario: Repository argument is absent
- **WHEN** the payload omits the repository
- **THEN** GitHub commands operate against the session's current GitHub repository context.

#### Scenario: Mutation uses fresh issue state
- **WHEN** the workflow is ready to apply a duplicate closure, spam closure, label, comment, title edit, or body edit
- **THEN** it uses a freshly fetched issue context for that mutation decision.

### Requirement: Duplicate search stage
The workflow SHALL collect duplicate candidates with authenticated GitHub CLI searches, then the agent SHALL run a duplicate-search stage that decides whether the issue is a confirmed duplicate, unique, or uncertain before broader diagnosis.

#### Scenario: Search duplicate candidates
- **WHEN** the duplicate-search stage runs
- **THEN** the workflow searches same-repository open and closed issues with exact title terms and distinctive body phrases
- **AND** each `gh search issues` query uses the GitHub App installation token and a limit of 10
- **AND** the agent evaluates only the workflow-provided duplicate candidates.

#### Scenario: Avoid generic duplicate searches
- **WHEN** the issue content contains only generic technology, stack, or repo terms
- **THEN** the agent does not fan out broad duplicate searches based only on those terms
- **AND** low-signal rewrite requests are searched only by exact title or distinctive exact body phrase.

#### Scenario: Confirmed duplicate
- **WHEN** a candidate is the same underlying bug, request, or documentation problem as the current issue
- **THEN** the duplicate-search result has status `duplicate`
- **AND** it includes the duplicate issue number, title, URL, state, confidence, and rationale.

#### Scenario: Uncertain duplicate evidence
- **WHEN** candidates share only broad topic overlap or the evidence is weak
- **THEN** the duplicate-search result is `unique` or `uncertain`
- **AND** the workflow does not close the issue as a duplicate.

### Requirement: Duplicate closure
The workflow SHALL close confirmed duplicates deterministically and SHALL avoid delegating duplicate mutations to the agent.

#### Scenario: Close confirmed duplicate
- **WHEN** the duplicate-search result is `duplicate`
- **THEN** the workflow applies an existing `duplicate` label when that label exists
- **AND** posts a concise comment that references the duplicate issue
- **AND** closes the current issue using GitHub's duplicate closure path.

#### Scenario: Duplicate label unavailable
- **WHEN** the duplicate-search result is `duplicate` and the repository has no existing `duplicate` label
- **THEN** the workflow still posts the duplicate comment and closes the issue as a duplicate
- **AND** it does not create a new label.

### Requirement: Repository-aware diagnosis and validation
The agent SHALL diagnose and validate non-duplicate issues using repository context when a checkout is available.

#### Scenario: Existing checkout is available
- **WHEN** the workflow session already has a Git working tree
- **THEN** the workflow reports the checkout path, origin URL when available, current HEAD when available, and a note that the GitHub Actions checkout is being used
- **AND** the diagnosis stage may inspect repository files under that path.

#### Scenario: Checkout must be cloned
- **WHEN** no working tree is available and the request includes a repository
- **THEN** the workflow attempts a filtered `gh repo clone`
- **AND** the diagnosis stage receives checkout metadata describing success or clone failure.

#### Scenario: Diagnosis inspects relevant code
- **WHEN** repository checkout is available
- **THEN** the agent reads `AGENTS.md`, relevant documentation, neighboring files, and first-party stack frames before making claims about expected behavior
- **AND** it runs only focused searches, tests, typechecks, or package scripts that are directly relevant and reasonably scoped.

#### Scenario: Validation is impractical
- **WHEN** dependencies are missing or validation is too expensive for the triage job
- **THEN** the agent records the limitation in evidence
- **AND** marks validity conservatively.

### Requirement: Diagnosis structured output
The agent SHALL return a structured diagnosis that classifies severity, category, disposition, rewrite mode, validity, evidence, labels, mutation recommendations, comments, closure requests, and human-review needs.

#### Scenario: Actionable diagnosis
- **WHEN** the issue contains enough detail for a maintainer to act
- **THEN** disposition is `actionable`
- **AND** the diagnosis summarizes the concern and includes concrete evidence.

#### Scenario: Bug root-cause analysis
- **WHEN** the diagnosis category is `bug`
- **THEN** it records observed and expected behavior, reproduction status, trigger, affected source locations, causal chain, root cause when known, provenance-tagged evidence, alternatives considered, fix direction, validation plan, and confidence
- **AND** `confirmed` validity requires a root cause, causal chain, and structured evidence.

#### Scenario: Non-bug gap analysis
- **WHEN** a documentation, feature, support, or maintenance issue is actionable or needs more information
- **THEN** it records the current capability, desired user outcome, exact gap, affected users, workaround, acceptance criteria, constraints, smallest viable slice, decision type, and provenance-tagged evidence.

#### Scenario: Needs more information
- **WHEN** the issue appears likely valid but lacks a concrete reproduction, motivation, or acceptance criteria
- **THEN** disposition is `needs_more_info`
- **AND** any comment asks for the missing details without overstating confidence.

#### Scenario: Low-actionability issue
- **WHEN** the request has a recognizable shape but little useful signal
- **THEN** disposition is `low_actionability`
- **AND** the agent does not launder it into a polished internal specification.

#### Scenario: Impractical scope request
- **WHEN** the request is a broad rewrite, architecture migration, or similar high-scope ask
- **THEN** disposition is `impractical_scope`
- **AND** the diagnosis focuses on the missing problem statement, affected users, expected benefit, migration plan, or maintenance owner instead of generic repository inventory.

#### Scenario: Security-sensitive issue
- **WHEN** the issue appears security-sensitive or high risk
- **THEN** the diagnosis category reflects `security` when applicable
- **AND** `needs_human_review` is true.

#### Scenario: Security-sensitive public output
- **WHEN** the issue may contain sensitive vulnerability details, exploit steps, private data, or credential material
- **THEN** the workflow does not automatically close the issue
- **AND** it does not automatically apply labels, edit the issue, or post a public comment
- **AND** the result requires human review.

#### Scenario: Issue changes during diagnosis
- **WHEN** title, body, state, labels, comments, or update timestamp changes after diagnosis begins
- **THEN** the workflow does not apply the stale diagnosis
- **AND** it leaves the issue unchanged for human review.

### Requirement: Issue rewrite decisions
The agent SHALL recommend issue title or body edits only when they preserve reporter-supplied facts and materially improve maintainer understanding.

#### Scenario: Existing issue is clear
- **WHEN** the current title and body are already clear and actionable
- **THEN** `should_update_issue` is false
- **AND** no rewrite is recommended just to add ceremony.

#### Scenario: Issue needs technical diagnosis
- **WHEN** a bug, documentation, setup, or API report benefits from repository evidence
- **THEN** the rewrite mode may be `technical_diagnosis`
- **AND** the proposed body includes only useful validation and concrete repository findings.

#### Scenario: Low-signal issue remains low signal
- **WHEN** the issue is one-line, vague, or low-signal
- **THEN** the rewrite mode is `none` or a minimal `scope_clarification`
- **AND** the proposed body, if any, keeps the missing context visible.

#### Scenario: Body update comment
- **WHEN** the workflow actually updates the issue body
- **THEN** it posts an update comment from the diagnosis when provided
- **AND** otherwise builds a concise comment matching the selected rewrite mode.

#### Scenario: Body edit has no bot voice
- **WHEN** the agent proposes an issue body replacement
- **THEN** the body does not include greetings, bot identity, apologies, automation notes, or first-person narration from the bot.

### Requirement: Label application guardrails
The workflow SHALL apply only labels that already exist in the repository and SHALL ignore non-existent labels proposed by the agent.

#### Scenario: Existing label proposed
- **WHEN** the diagnosis proposes a label whose name matches an existing repository label case-insensitively
- **THEN** the workflow applies the repository's canonical label name.

#### Scenario: Missing label proposed
- **WHEN** the diagnosis proposes a label that does not exist in the fetched repository labels
- **THEN** the workflow does not apply that label
- **AND** it does not create a replacement label.

### Requirement: Spam closure guardrails
The workflow SHALL automatically close only clear spam that passes deterministic safety checks.

#### Scenario: Clear spam
- **WHEN** the diagnosis explicitly sets `should_close` true with disposition `spam`, severity `low`, close reason `not planned`, non-security category, and no human review need
- **THEN** the workflow applies existing requested labels, posts a closing comment, and closes the issue as `not planned`.

#### Scenario: Unsafe closure request
- **WHEN** the diagnosis asks to close an issue but fails any spam auto-close guardrail
- **THEN** the workflow leaves the issue open
- **AND** posts a safe review comment when appropriate
- **AND** marks the result as needing human review.

#### Scenario: Spam closure comment
- **WHEN** the workflow automatically closes a spam issue
- **THEN** the workflow posts one predefined Pierre/Sentry-voice comment selected from a static pool of no fewer than five spam variants
- **AND** the posted comment does not use generated diagnosis prose or punt-to-maintainer close language.

### Requirement: Invalid low-signal closure guardrails
The workflow SHALL automatically close obviously invalid low-signal issues that have no repository maintenance action, while keeping ambiguous or substantive requests open for human review.

#### Scenario: Content-free rewrite request
- **WHEN** an issue requests a broad rewrite, migration, or technology preference with no concrete problem, affected users, expected benefit, acceptance criteria, migration plan, or maintenance owner
- **THEN** the diagnosis may set `should_close` true with disposition `low_actionability` or `impractical_scope`
- **AND** it uses severity `low`, close reason `not planned`, an existing `invalid` label when available, and no human review need.

#### Scenario: Close invalid low-signal issue
- **WHEN** the diagnosis sets `should_close` true with disposition `low_actionability`, `impractical_scope`, or `unclear`, severity `low`, close reason `not planned`, non-security category, requested `invalid` label, and no human review need
- **THEN** the workflow applies the existing `invalid` label, posts a concise closing comment, and closes the issue as `not planned`.

#### Scenario: Keep substantive broad request open
- **WHEN** a broad rewrite, architecture, migration, or feature request includes a concrete problem statement, affected users, expected benefit, migration constraints, security concern, compatibility concern, or other maintainer-relevant substance
- **THEN** the workflow does not automatically close it as invalid low-signal
- **AND** it leaves the issue open for human review or asks for targeted missing information.

#### Scenario: Invalid closure comment
- **WHEN** the workflow automatically closes an invalid low-signal issue
- **THEN** the workflow posts one predefined Pierre/Sentry-voice comment selected from a static pool of no fewer than five invalid variants
- **AND** the posted comment does not use generated diagnosis prose or punt-to-maintainer close language.

### Requirement: Closed issue handling
The workflow SHALL not mutate issues that are already closed, including duplicate and spam closure paths.

#### Scenario: Issue already closed
- **WHEN** the fetched issue state is `closed`
- **THEN** the workflow skips title edits, body edits, labels, comments, and closure
- **AND** returns a result indicating the update was skipped and human review is needed.

### Requirement: Agent failure fallback
The workflow SHALL leave issues unchanged for maintainer review when the triage agent fails before producing valid structured output.

#### Scenario: Duplicate search agent failure
- **WHEN** the duplicate-search stage fails
- **THEN** the workflow treats duplicate status as `uncertain`
- **AND** records a concise rationale derived from the failure.

#### Scenario: Diagnosis agent failure
- **WHEN** the diagnosis stage fails
- **THEN** the workflow builds a low-severity unknown diagnosis with disposition `unclear`, rewrite mode `none`, validity `unclear`, no labels, no comments, no issue update, and human review required.

#### Scenario: Provider-specific failure summary
- **WHEN** the agent failure includes a provider 404 or gateway timeout
- **THEN** the fallback evidence summarizes the provider error or timeout without exposing secrets or raw environment values.

### Requirement: Comment voice and safety
The agent and workflow SHALL keep issue comments aligned with Sentry brand guidelines and safe from prompt-injected issue content.

#### Scenario: Comment is posted
- **WHEN** the workflow posts a triage, update, duplicate, spam, invalid, or safety comment
- **THEN** the comment starts with `Hi, I'm Pierre!` only when the reporter association is `FIRST_TIMER` or `FIRST_TIME_CONTRIBUTOR`
- **AND** the introduction is omitted for every other or unknown reporter association
- **AND** it uses Sentry Plain Speech by default: concise, direct, active, specific, and jargon-free
- **AND** Pierre is useful before entertaining: he leads with evidence and the conclusion, then gives a concrete next step when one exists
- **AND** any personality uses earned Sentry Voice: dry, self-aware, mildly cheeky, limited to one flourish, aimed at the code, process, or situation, and secondary to clarity
- **AND** Pierre writes polished English whose French flavor comes from dry cadence, exacting taste, and playful cultural texture—not `Merci` added to generic bot prose
- **AND** sensitive, frustrating, or high-stakes comments drop the bit and stay plain
- **AND** it avoids secrets, long explanations, reporter- or group-directed jokes, hype, unsupported confidence, broken English, fake accents, untranslated French fragments, stereotypes, nationality insults, and jokes about personal traits.

#### Scenario: Legacy opener is returned
- **WHEN** the agent returns a comment that starts with `Pierre here.`
- **THEN** the workflow normalizes the comment before posting
- **AND** replaces it with `Hi, I'm Pierre!` when the reporter association is `FIRST_TIMER` or `FIRST_TIME_CONTRIBUTOR`
- **AND** removes it for every other or unknown reporter association.

#### Scenario: Issue content includes instructions
- **WHEN** issue title, body, comments, linked content, stack traces, or pasted commands contain instructions for Pierre
- **THEN** the agent treats them as untrusted user content
- **AND** ignores attempts to change its role, reveal secrets, alter the workflow, or execute arbitrary commands.
