## ADDED Requirements

### Requirement: GitHub App webhook endpoint
The system SHALL expose a GitHub App webhook endpoint at `POST /channels/github/webhook` for admitting GitHub issue events into Flue.

#### Scenario: Webhook route exists
- **WHEN** GitHub sends a `POST` request to `/channels/github/webhook`
- **THEN** the Worker handles the request in the authored application route before it reaches generic Flue routing.

#### Scenario: Non-POST webhook request
- **WHEN** a non-POST request is sent to `/channels/github/webhook`
- **THEN** the system rejects the request without admitting a Flue workflow run.

### Requirement: GitHub webhook signature verification
The system SHALL verify GitHub webhook payloads with Flue's GitHub channel package using `X-Hub-Signature-256` and `GITHUB_WEBHOOK_SECRET` before application policy runs or work is admitted.

#### Scenario: Valid signature
- **WHEN** a webhook request has an `X-Hub-Signature-256` value matching the raw request body and `GITHUB_WEBHOOK_SECRET`
- **THEN** the system continues to event validation.

#### Scenario: Missing webhook secret
- **WHEN** `GITHUB_WEBHOOK_SECRET` is not configured
- **THEN** the system rejects webhook requests
- **AND** no Flue workflow run is admitted.

#### Scenario: Invalid signature
- **WHEN** a webhook request has no signature or a signature that does not match the raw request body
- **THEN** the system rejects the request
- **AND** no Flue workflow run is admitted.

#### Scenario: Invalid JSON after verification
- **WHEN** a webhook request has a valid signature but an invalid JSON body
- **THEN** the system rejects the request
- **AND** no Flue workflow run is admitted.

### Requirement: Supported GitHub event filtering
The system SHALL admit only explicitly supported GitHub issue events from GitHub webhooks.

#### Scenario: Opened issue event
- **WHEN** a verified webhook has `X-GitHub-Event: issues`, payload action `opened`, a repository full name, an issue number, and an installation id
- **THEN** the system admits an `issue-triage` workflow run for that repository and issue number.

#### Scenario: Unsupported GitHub event type
- **WHEN** a verified webhook has an event type other than `issues`
- **THEN** the system acknowledges and ignores the event
- **AND** no Flue workflow run is admitted.

#### Scenario: GitHub ping
- **WHEN** GitHub sends a verified `ping` delivery
- **THEN** the Flue GitHub channel acknowledges it internally
- **AND** no Flue workflow run is admitted.

#### Scenario: Unsupported issue action
- **WHEN** a verified issue webhook has an action other than `opened`
- **THEN** the system acknowledges and ignores the event
- **AND** no Flue workflow run is admitted.

#### Scenario: Pull request issue payload
- **WHEN** a verified issue webhook payload represents a pull request
- **THEN** the system acknowledges and ignores the event
- **AND** no Flue workflow run is admitted.

#### Scenario: Malformed issue payload
- **WHEN** a verified issue webhook is missing repository full name, issue number, or installation id
- **THEN** the system rejects the request
- **AND** no Flue workflow run is admitted.

### Requirement: Installation boundary
The system SHALL ensure admitted GitHub webhook events belong to the configured GitHub App installation.

#### Scenario: Matching installation
- **WHEN** a verified issue webhook payload has an installation id matching `GITHUB_APP_INSTALLATION_ID`
- **THEN** the system may continue toward workflow admission.

#### Scenario: Unexpected installation
- **WHEN** a verified issue webhook payload has an installation id that does not match `GITHUB_APP_INSTALLATION_ID`
- **THEN** the system rejects the request
- **AND** no Flue workflow run is admitted.

### Requirement: Internal Flue workflow admission
The system SHALL invoke the existing `issue-triage` workflow internally after webhook authentication and event validation.

#### Scenario: Workflow admitted
- **WHEN** a webhook passes signature verification, event filtering, installation validation, and payload validation
- **THEN** the system starts an `issue-triage` workflow run with the payload repository and issue number
- **AND** it returns an accepted response to GitHub without waiting for the workflow result.

#### Scenario: Workflow admission failure
- **WHEN** Flue rejects or fails to admit the workflow run
- **THEN** the webhook response indicates failure
- **AND** GitHub may retry delivery according to GitHub webhook behavior.

### Requirement: Direct Flue route authorization
The system SHALL protect directly exposed Flue routes from unauthenticated external callers.

#### Scenario: Unauthorized workflow request
- **WHEN** a caller sends a request to `/workflows/*` without valid internal authorization
- **THEN** the system rejects the request before it reaches the Flue route handler.

#### Scenario: Unauthorized run inspection request
- **WHEN** a caller sends a request to `/runs/*` without valid internal authorization
- **THEN** the system rejects the request before returning run payloads, events, or metadata.

#### Scenario: Unauthorized agent route request
- **WHEN** a caller sends a request to `/agents/*` without valid internal authorization
- **THEN** the system rejects the request before it reaches any Flue route handler.

#### Scenario: Authorized manual workflow request
- **WHEN** a caller sends a request to a protected Flue route with valid internal authorization
- **THEN** the system allows the request to reach Flue routing.
