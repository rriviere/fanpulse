# FanPulse applications

- `web/` is the React/Vite experience: playback, frame capture, live insights,
  polls, voting, and WebSocket UI state.
- `api/` is the FastAPI application: playback sessions, analysis scheduling,
  policy enforcement, WebSocket delivery, and vote persistence.

The browser never receives Azure credentials. It submits compressed frame
windows to the API, which calls the integrations in `../../ai/` server-side.
