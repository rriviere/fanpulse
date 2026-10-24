# Synthetic match data and playback

The match is stored in [`reference-match.v1.json`](../apps/web/public/simulations/reference-match.v1.json),
served as `/simulations/reference-match.v1.json`. Match content is loaded and
validated at runtime, separately from the animation engine. There are no video
frames, real tracking coordinates, agent-written insights, or pre-written polls
in this file. The scenario and observation descriptions are fictional.

## Editing the data

All times are absolute seconds on a single 240-second match timeline. Coordinates
are metres from the centre of a 105 × 68 metre pitch: x is -52.5 to 52.5, y is
-34 to 34. Black attacks toward positive x; Green attacks toward negative x.

- `players`: 11 players per team, each with a stable ID, shirt number, role and
  timestamped `keyframes`. Every track starts at time 0 and ends at the match
  duration. Use ordered, unique timestamps and plausible running speeds.
- `ball`: one ordered track covering the whole match, including the transitions
  between plays. Each node describes motion **from that node to the next**.
  `carry` follows the named player's interpolated position with the configured
  `pitch.ballControlOffset`; both endpoints must meet that player's foot position.
  `pass` travels between its two ball coordinates at constant speed. `hold` keeps
  the ball at the named player's feet at an unchanged position.
- `events`: stable IDs and labels, plus `startTime` (the on-screen play begins),
  `time` (the described action has happened and can be submitted to agents), and
  `holdTime` (a safe point before the following play). An observation's
  `video_timestamp_seconds` must equal `time`; this is the existing agent contract,
  even though the source here is synthetic.
- `playback`: at least 10 real seconds between requests, at least six real seconds
  to read an enriched result, and an 18-second waiting timeout. Playback speed
  does not multiply the request rate.

To change a sequence, edit its ball path and the corresponding player runs
together. Update the observation to describe only what those coordinates show.
Do not join unrelated positions at a phase boundary. Phase changes only change
the event label and visible intelligence; they never select a new position track.

## Motion and synchronization

`syntheticMatch.ts` provides deterministic, random-access position lookup.
Shape-preserving cubic interpolation gives players continuous velocity without
overshooting the authored positions. Carries follow those player tracks; kicked
balls use linear flight, so passes do not slowly ease between players.

`SyntheticPlayback` advances one clock. At an event's observation time the browser
posts the matching structured observation to the existing API. Vision is bypassed;
the real Match Analyst and Fan Engagement agents still assess the observation
and generate any insight and poll. Animation frames never invoke an LLM.

The clock can pause at the event's safe hold point while analysis finishes and
while the result is being read. This is shown explicitly on screen. Resuming the
clock continues from that exact position. Slow or unavailable agents release
the animation after the waiting timeout. The outstanding request remains reserved
until completion, so a timeout does not create another concurrent agent call.

Every direct result, enriched result, and vote belongs to one event ID and playback
generation. Results for an earlier play are discarded; the old card and poll are
removed at the next phase boundary. Polls close when their play changes. Historical
insights remain in the separate match timeline. Pausing preserves a pending result;
seeking or restarting invalidates it. The API acknowledges all synthetic work,
including work discarded after a seek, and serializes agent pipelines across sessions.

## Verification

From `apps/web`:

```sh
npm test
npm run lint
npm run build
npm run test:browser
```

Browser tests use Chrome locally and Playwright Chromium in CI. Install Chrome
for local runs, or set `CI=1` after `npx playwright install chromium` to use the
managed browser. Browser test fixtures intercept the transport only inside the
test runner and make no Foundry requests. They cannot become application fallback
responses. Both application pipelines run these tests before deployment.

With the actual API and Vite running locally, the optional
`node scripts/synthetic-foundry-smoke.mjs` command (from `apps/web`) checks the
first two events against real Foundry. It caps submissions at two observations,
does not run in CI, and uses the existing two-agent pipeline and retry policy.
Screenshots are written under `.cache/synthetic-preview/`.

Tests check the whole match at 60 fps, every position/velocity boundary, realistic
speed and ball control, event evidence, the final phase, delayed responses,
request rate at 1×/2×/4×, voting, pause, seek, restart generations, and browser
background gaps. Update the event-specific semantic expectations when intentionally
changing the authored scenario.

For a developer-only diagnostic overlay, open `/?debugSynthetic=1` and select
Synthetic match. It shows the clock, visible event, request generation, latest
result and vote IDs. Normal viewers do not see these implementation details.
