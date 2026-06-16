## MODIFIED Requirements

### Requirement: Workflow-owned issue triage entry point
The system SHALL perform GitHub issue triage through the `issue-triage` workflow, SHALL keep the underlying `issue-triage` agent non-routable to direct HTTP callers, and SHALL require production external issue events to enter through verified GitHub webhook ingress.

#### Scenario: Workflow route is available for authorized callers
- **WHEN** the Flue project is built
- **THEN** the `issue-triage` workflow is discoverable as the bounded entry point for issue triage
- **AND** authorized internal or operator callers can invoke it with an issue number and optional repository.

#### Scenario: Public workflow route is not anonymously invocable
- **WHEN** an unauthenticated external caller invokes the `issue-triage` workflow HTTP route directly
- **THEN** the system rejects the request before starting the workflow
- **AND** no GitHub issue state is read or mutated.

#### Scenario: Verified webhook starts workflow
- **WHEN** the GitHub webhook ingress admits a supported issue event
- **THEN** the ingress starts the `issue-triage` workflow with the issue number and repository from the verified webhook payload.

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
