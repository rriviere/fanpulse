# FanPulse

![FanPulse synthetic football simulation with synchronized Foundry intelligence and live fan voting](docs/images/fanpulse-synthetic-match-voting.png)

**Your Voice in the Game.** FanPulse turns a synthetic football match into grounded, timely and personalised intelligence for the people watching it.

Built for the **Microsoft × Premier League Inside the Game Hackathon**, FanPulse combines a continuously animated fictional match, two real Microsoft Foundry agents, evidence-aware publishing policy and live audience voting in one synchronized viewing experience.

> **Live application:** [app-fanpulse-dev-qdifh3qv.azurewebsites.net](https://app-fanpulse-dev-qdifh3qv.azurewebsites.net/)
>
> **Hackathon path:** Select **Synthetic** (the default). It uses fictional match data and real Foundry agents. The separate Video mode is an optional technical demonstration and is explicitly excluded from the hackathon submission and judging.

## What FanPulse does

Football is better when fans can do more than watch. Every attack, recovery and tactical change creates an opinion: *Was that move dangerous? Should the team press higher? What should happen next?* FanPulse turns those moments into a shared, interactive conversation alongside the match.

- **Understand the moment.** The Foundry Match Analyst Agent identifies meaningful play and explains why it matters while the action is still relevant.
- **See the match your way.** Casual mode makes the story immediately accessible; Tactical mode gives detail-hungry viewers deeper football context.
- **Have your say.** The Foundry Fan Engagement Agent turns significant moments into timely, balanced questions that invite viewers into the experience.
- **Compare your view with the crowd.** Fans vote live and see the shared response update, revealing whether others read the game the same way.
- **Stay connected to the action.** Every insight and vote remains synchronized with the exact play that inspired it, instead of becoming a disconnected second-screen discussion.
- **Build a richer fan community.** The same platform can bring together casual supporters, tactical thinkers and passionate fans around a common moment without forcing everyone into the same experience.

The hackathon experience brings that vision to life through a continuous 240-second fictional match with all 22 players and the ball in motion. Real Foundry agents interpret its synchronized observations at runtime; the insights and polls are not pre-written answers.

## Component architecture

```mermaid
%%{init: {"flowchart": {"nodeSpacing": 14, "rankSpacing": 18, "diagramPadding": 2}, "themeVariables": {"fontSize": "12px"}}}%%
flowchart TB
    subgraph Client["Client"]
        WEB["React Web Application"]
    end

    subgraph Application["Application Services · Azure App Service"]
        API["FastAPI Backend"]
    end

    subgraph Azure["Azure Managed Services"]
        direction LR
        ANALYST["Match Analyst Agent<br/>Microsoft Foundry"]
        ENGAGEMENT["Fan Engagement Agent<br/>Microsoft Foundry"]
        COSMOS[("Azure Cosmos DB")]
    end

    WEB <-->|"HTTP API + WebSocket"| API
    API <-->|"grounded assessment"| ANALYST
    API <-->|"insights + polls"| ENGAGEMENT
    API <-->|"activity + votes"| COSMOS

    classDef client fill:#f1efff,stroke:#7565d6,color:#171329,stroke-width:1px;
    classDef service fill:#e7ddff,stroke:#7b61c9,color:#171329,stroke-width:1px;
    classDef agent fill:#ddd0ff,stroke:#6f52bd,color:#171329,stroke-width:1px;
    classDef database fill:#d9e9ff,stroke:#5279b8,color:#171329,stroke-width:1px;
    class WEB client;
    class API service;
    class ANALYST,ENGAGEMENT agent;
    class COSMOS database;
    style Client fill:#fffde8,stroke:#d8cf80,color:#171329
    style Application fill:#fffde8,stroke:#d8cf80,color:#171329
    style Azure fill:#fffde8,stroke:#d8cf80,color:#171329
```

### Two ways in. One real AI pipeline.

FanPulse can understand a match in two different ways:

1. **Video mode (demonstration only—not part of hackathon judging):** While a video plays, the browser captures a small image once per second. Five images are grouped together and sent securely to the FanPulse backend. Microsoft Foundry examines them and describes what is happening on the pitch.
2. **Synthetic mode:** No video or images are used. FanPulse reads fictional player movements, ball movements and match events from the synthetic dataset. These are converted into the same structured match description that the video analysis would produce.

Once FanPulse sends the match moment to Foundry, both modes work the same way. The same Match Analyst Agent decides whether the moment matters. If it does, the same Fan Engagement Agent explains it and may create a live poll.

## How it works

The diagram below follows one Synthetic match moment from start to finish. The Match Analyst Agent reviews the event evidence, scores its significance from 0 to 100, and explains why it matters. It must use only the supplied match information and cannot invent new facts.

Routine moments stop there. Significant moments move to the Fan Engagement Agent, which creates a viewer-friendly explanation and may suggest a live poll. Polls require a significance score of at least 60 and must pass the backend's confidence, cooldown and duplicate checks before appearing.

This diagram focuses on Synthetic mode, the experience used for hackathon judging.

### The two Foundry agents

FanPulse uses two persisted Microsoft Foundry agents, each with one clear job:

| Agent | Receives | Responsibility | Structured output |
| --- | --- | --- | --- |
| **Match Analyst** | One validated football observation | Decide whether the moment is significant, explain why, and state any uncertainty without inventing match facts | `MatchAssessment` |
| **Fan Engagement** | Observation, assessment and viewer mode | Turn significant moments into audience-friendly insights and, when appropriate, a balanced poll | `FanEngagementDecision` |

Both agents are powered by the keyless `gpt-5-mini` deployment in Microsoft Foundry. Their prompts are version-controlled in [`ai/agents/`](ai/agents/), and JSON Schema keeps their responses predictable for the application.

```mermaid
sequenceDiagram
    autonumber
    participant Match as Synthetic match
    participant UI as React experience
    participant API as FastAPI orchestrator
    participant Analyst as Foundry Match Analyst Agent
    participant Engagement as Foundry Fan Engagement Agent
    participant Model as Foundry gpt-5-mini
    participant DB as Cosmos DB

    Match->>UI: Advance continuous player and ball tracks
    UI->>API: Submit event ID, timestamp, observation and viewer mode
    API-->>UI: Broadcast the event evidence
    API->>Analyst: Request grounded significance assessment
    Analyst->>Model: Run grounded assessment prompt
    Model-->>Analyst: Return schema-constrained assessment
    Analyst-->>API: Return significant flag, score, rationale and uncertainty
    alt Match Analyst marks the moment significant
        API->>Engagement: Send observation, assessment and viewer mode
        Engagement->>Model: Run fan engagement prompt
        Model-->>Engagement: Return schema-constrained decision
        Engagement-->>API: Return publish decision, adapted insight and optional poll
        API->>API: Require source significance and non-low confidence
        opt Poll proposed and significance score is at least 60
            API->>API: Enforce 14-second cooldown and duplicate-key policy
        end
    else Match Analyst marks the moment routine
        API->>API: Suppress insight and skip Fan Engagement
    end
    API->>DB: Persist the published or suppressed analysis result
    API-->>UI: Broadcast the event-bound decision and evidence
    opt An eligible poll was published
        UI->>API: Submit one vote for this viewer
        API->>DB: Persist the unique vote
        API-->>UI: Broadcast updated poll totals
    end
```

### What appears to the viewer?

- A routine or low-confidence moment is recorded but not shown as an insight.
- A significant moment can become Live Intelligence after the Fan Engagement Agent explains it.
- A poll appears only when the score is at least 60 and the backend confirms it is timely and not a duplicate.
- If Foundry is unavailable, FanPulse reports the problem instead of displaying a made-up answer.

### Personalisation and live voting

Viewers can choose **Casual** for a clear, simple explanation or **Tactical** for deeper football context. Both views are based on the same match evidence.

When a poll appears, each viewer can vote once and watch the shared totals update live. This lets fans compare their reading of the game with the wider audience without leaving the match.

## Synthetic data

FanPulse was originally built to turn video frames into structured match observations. For this hackathon, Synthetic mode replaces only that first step with fictional match data. The same real Foundry agents still interpret every moment at runtime.

The judged simulation is stored separately from the application code in [`reference-match.v1.json`](apps/web/public/simulations/reference-match.v1.json). It contains:

- 22 fictional players and one continuously moving ball;
- a four-minute match timeline with passes, carries, recoveries and pressure;
- twelve observations synchronized to the visible action; and
- no real footage, real tracking data or pre-written agent answers.

FanPulse keeps every insight and poll synchronized with the play that triggered it. A shared match clock, event IDs and controlled agent requests prevent stale results, mismatched commentary and unnecessary Foundry load.

The full dataset, animation and timing design is documented in [`docs/SYNTHETIC_MATCH.md`](docs/SYNTHETIC_MATCH.md).

## Quality, evaluation and delivery

- Automated Python, TypeScript and browser tests cover agent policy, voting, playback, seeking, animation continuity and delayed responses.
- The complete synthetic match is checked at 60 frames per second for unrealistic player or ball jumps.
- A version-controlled six-case Foundry evaluation measures grounded observations and correct poll decisions.
- A capped smoke test verifies the first two synthetic moments against the real deployed Foundry agents.
- GitHub Actions validates every change. Application deployment and Foundry-agent publication remain separate, so only changed components are released.
- Bicep, Microsoft Entra ID and GitHub OIDC provide repeatable Azure infrastructure without stored deployment secrets.

Detailed test, evaluation and deployment instructions are available in [`ai/evaluations/README.md`](ai/evaluations/README.md) and [`docs/GITHUB_DEPLOYMENT.md`](docs/GITHUB_DEPLOYMENT.md).

## Honest boundaries

- The judged experience contains one authored fictional match, not a general-purpose match generator.
- Synthetic observations are authored with the animation; the Foundry assessments, insights and polls are generated live.
- Casual and Tactical modes change the explanation, not the underlying match evidence.
- A production-scale release would add user authentication and a shared WebSocket backplane.

## Hackathon compliance

- Synthetic mode uses only fictional teams, players, movement and observations.
- Video mode is visibly marked as a demonstration excluded from judging.
- No match footage is committed to the repository.
- AI-generated insights are labelled in the interface.

See [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md) and the [official rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md) for the full submission checklist.

## Technology stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Experience | React, TypeScript, Vite, Motion, SVG | Playback controls, continuous pitch animation, insights, timeline and voting |
| API | Python, FastAPI, Pydantic | Validation, playback sessions, orchestration, policy and WebSockets |
| AI | Microsoft Foundry, Foundry prompt agents, `gpt-5-mini` | Vision observation, significance assessment and fan engagement |
| Data | Azure Cosmos DB for NoSQL | Analysis activity and one-vote-per-viewer poll persistence |
| Azure | App Service, managed identity, Application Insights | Keyless hosting and monitoring |
| Delivery | Bicep and GitHub Actions with OIDC | Repeatable infrastructure, testing and deployment |

## Further documentation

- [`docs/SYNTHETIC_MATCH.md`](docs/SYNTHETIC_MATCH.md) — match schema, interpolation and synchronization behavior
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — vision path, runtime policy and agent contracts
- [`ai/agents/README.md`](ai/agents/README.md) — declarative agent definitions and publication
- [`ai/evaluations/README.md`](ai/evaluations/README.md) — evaluation dataset and runner
- [`docs/GITHUB_DEPLOYMENT.md`](docs/GITHUB_DEPLOYMENT.md) — CI/CD, OIDC, delivery and rollback
