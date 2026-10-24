# Architecture

## Vision integration

The live application sends ordered browser-captured frames to the server-side
Foundry vision path. Validated observations feed the two-agent pipeline and are
returned to the React UI over WebSockets without blocking video playback.

```text
Licensed local MP4
        │
        ▼
OpenCV: 5 ordered frames at 1-second intervals
        │ resize to 768px + JPEG compression
        ▼
Foundry project / gpt-5-mini Global Standard
        │ Responses API + structured output
        ▼
Pydantic-validated football observations
```

The local service uses `DefaultAzureCredential`; no API key is stored in the
repository. The Foundry account, project, role assignments, and model deployment
remain managed by `azd provision` and Bicep. The Azure resources are located in
Australia East. Because the deployment SKU is `GlobalStandard`, inference data
may be processed in any geography where the model is deployed; this was accepted
for the proof of concept.

Foundry observability is provisioned as a workspace-based Application Insights
resource connected directly to the Foundry project. Agent traces use OpenTelemetry
semantics and are ingested with the project managed identity. Key-based telemetry
ingestion is disabled. The backing Log Analytics workspace retains data for 30
days and has a 1 GB/day safety cap to limit accidental ingestion spikes.

The deployed resources are `appi-fanpulse-dev` and `log-fanpulse-dev`, connected
to the project as `fanpulse-appinsights`. The project identity and both agent
runtime identities have Monitoring Metrics Publisher; the development
identity has Log Analytics Reader. Foundry agent dependencies are visible in
Application Insights. Direct Responses API calls still require explicit
OpenTelemetry instrumentation because the project connection does not trace
arbitrary local Python calls automatically.

## Declarative Foundry source

Foundry configuration is separated from deployment code. Logical model profiles
live in `ai/models/deployments/*.yaml`; agent names, prompts, model references,
reasoning settings, descriptions, and metadata live in
`ai/agents/definitions/*.yaml`; structured outputs live in
`ai/agents/schemas/*.schema.json`. Generic loaders validate references and JSON
Schemas before the generic provisioner compares configuration hashes and creates
immutable Foundry agent versions. Python files contain runtime orchestration and
typed application contracts, not embedded agent definitions.

## Progressive analysis and two-agent Foundry pipeline

```text
HTML5 video playback
  ├─ pause / resume / seek state ───────────────┐
  └─ 1 JPEG frame per video second              │
                    │                            │
                    ▼                            ▼
             rolling 5-frame window ──► playback generation
                    │
                    ▼
        FastAPI latest-window queue (global single-flight)
                    │
                    ▼
        gpt-5-mini vision structured observation
                    │ stale generation? discard
                    ▼
        Foundry `fanpulse-match-analyst` prompt agent
                    │ grounded significance assessment
                    ▼
        Foundry `fanpulse-fan-engagement` prompt agent
                    │ fan copy + optional poll
                    ▼
        evidence + significance + cooldown + dedup policy
                    │
                    ▼
             WebSocket insight / optional poll
```

Browser-side frame capture was selected because the browser is authoritative for
the actual playback position. Each pause, seek, or reset advances
a generation and clears the rolling buffer. The server never maintains an
unbounded queue: one request can run globally and each playback session retains
at most its newest pending window. Results more than 15 video seconds behind the
reported player position are dropped.

The vision provider and both Foundry agents run independently of video playback.
A Foundry or validation failure is reported over WebSockets and is never replaced
with a fabricated observation or poll.

The successful original chained test on 2026-10-17 used the 30–34 second throw-in window.
Vision took 6.284 seconds and the agent took 5.077 seconds (11.361 seconds total).
The agent assigned significance 30/100 and correctly suppressed both the insight
and poll as routine action. Since this exceeds the original ten-second target,
latest-window replacement and stale-result rejection remain essential.

## Runtime flow

The browser sends rolling frame windows to FastAPI, which invokes Foundry vision,
Match Analyst, and Fan Engagement with server-side credentials. FastAPI enforces
staleness and poll policy, persists votes in SQLite, and broadcasts accepted
results over WebSockets. The checked-in source of truth is `ai/agents/`; Azure
contains immutable deployed versions created from those definitions.

### Synthetic match input

Synthetic Match Mode adds a deterministic, fictional 135-second SVG replay. Its
single timeline drives all 22 player positions, the ball, clock, and nine
validated `FootballObservation` events. The selected event types and ordering
mirror a persisted vision-analysis run from the licensed demo, while player
positions and identities remain fictional rather than traced from footage. Events
are spaced fifteen seconds apart so the existing single-flight Foundry agent
pipeline can normally complete before the next submission. Those observations enter FastAPI after
the vision boundary, bypassing image inference while retaining playback
generation checks, duplicate suppression, the Match Analyst, Fan Engagement,
poll policy, persistence, and WebSocket delivery. Video Mode and its rolling
five-frame vision path are unchanged.

## Agent contracts

Each handoff should be a versioned structured object rather than prose-only chat.

### Event Analyst output

```json
{"schema_version":"1.0","event_id":"e07","classification":"substitution","state_patch":{},"facts":[],"uncertainties":[]}
```

### Significance Analyst output

```json
{"schema_version":"1.0","event_id":"e07","score":94,"signals":[],"reason":"...","confidence":0.91,"poll_candidate":true}
```

The backend validates bounds and recalculates numerical signals from match state. An LLM may explain a number but may not create it.

### Fan Engagement output

```json
{"schema_version":"1.0","event_id":"e07","decision":"open_poll","question":"...","options":[],"cooldown_seconds":14,"duplicate_key":"substitution-intent-home"}
```

### Insight Agent output

```json
{"schema_version":"1.0","event_id":"e07","mode":"casual","headline":"...","explanation":"...","uncertainty_note":null}
```

## Guardrails and recovery

- Validate all structured outputs with Pydantic and reject unknown event references.
- Calculate score, clock, possession windows, shot counts, and vote totals deterministically.
- Bound provider calls with timeouts, report failures, and never resubmit invalid output unchanged.
- Surface provider failures explicitly; do not fabricate observations or polls.
- Apply threshold, cooldown, semantic duplicate key, and max-polls-per-half checks server-side.
- Log correlation ID, match/event IDs, agent, model/deployment, latency, input/output schema versions, decision, and fallback status. Do not log secrets.
- Treat insufficient evidence as a first-class outcome and expose uncertainty in the UI.

## Remaining implementation slices

1. Measure longer sessions and tune sampling/model latency while preserving the
   single-flight and latest-window cost controls.
2. Add application hosting only after separate deployment and cost approval.
3. Add production authentication and durable match/session persistence before
   exposing the service publicly.

