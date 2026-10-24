from contextlib import asynccontextmanager
import logging
import os
from pathlib import Path
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from ai.agents.loader import get_agent_configuration
from ai.agents.provider import FoundryAgentPipeline
from ai.vision.provider import FoundryVisionProvider
from .analysis.manager import AnalysisManager
from .analysis.models import AnalysisWindow, PlaybackState, SubmissionResult, SyntheticObservationSubmission
from .models import VoteRequest
from .store import CosmosStore, VoteStore

analysis_manager: AnalysisManager | None = None
logger = logging.getLogger("uvicorn.error")


def deployed_revision() -> str:
    """Return the immutable source revision included in the deployment package."""
    revision_file = Path(__file__).resolve().parents[3] / ".deployment-revision"
    try:
        return revision_file.read_text(encoding="utf-8").strip() or "development"
    except OSError:
        return "development"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global analysis_manager
    endpoint = os.environ.get("FOUNDRY_PROJECT_ENDPOINT")
    model = os.environ.get("FOUNDRY_VISION_MODEL_DEPLOYMENT")
    agent = get_agent_configuration("match-analyst").resolved_name()
    engagement_agent = get_agent_configuration("fan-engagement").resolved_name()
    if endpoint and model:
        logger.info(
            "fanpulse startup foundry_ready=true model=%s match_agent=%s engagement_agent=%s",
            model,
            agent,
            engagement_agent,
        )
        analysis_manager = AnalysisManager(
            FoundryVisionProvider(project_endpoint=endpoint, model_deployment=model),
            FoundryAgentPipeline(
                project_endpoint=endpoint,
                match_analyst_name=agent,
                fan_engagement_name=engagement_agent,
                model_deployment=model,
            ),
            broadcast,
            store,
        )
    else:
        logger.warning(
            "fanpulse startup foundry_ready=false missing=%s",
            ",".join(
                name
                for name, value in (
                    ("FOUNDRY_PROJECT_ENDPOINT", endpoint),
                    ("FOUNDRY_VISION_MODEL_DEPLOYMENT", model),
                )
                if not value
            ),
        )
    yield
    if analysis_manager:
        await analysis_manager.close()
    close_store = getattr(store, "close", None)
    if close_store:
        close_store()


app = FastAPI(title="FanPulse API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
if cosmos_endpoint := os.environ.get("COSMOS_ENDPOINT"):
    store = CosmosStore(
        cosmos_endpoint,
        os.environ.get("COSMOS_DATABASE_NAME", "fanpulse"),
        os.environ.get("COSMOS_CONTAINER_NAME", "activity"),
    )
else:
    store = VoteStore(
        Path(os.environ.get("FANPULSE_DB_PATH", Path(__file__).resolve().parents[1] / "data" / "fanpulse.db"))
    )
connections: set[WebSocket] = set()


async def broadcast(message: dict):
    stale = []
    delivered = 0
    for socket in connections:
        try:
            await socket.send_json(message)
            delivered += 1
        except Exception:
            stale.append(socket)
    for socket in stale:
        connections.discard(socket)
    logger.info(
        "fanpulse websocket_delivery type=%s session=%s generation=%s recipients=%d stale=%d",
        message.get("type"),
        message.get("session_id", "-"),
        message.get("generation", "-"),
        delivered,
        len(stale),
    )


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "revision": deployed_revision(),
        "ai_provider": "foundry" if analysis_manager else "unconfigured",
        "vision_analysis_ready": analysis_manager is not None,
        "activity_store": "cosmos" if isinstance(store, CosmosStore) else "sqlite",
    }


@app.post("/api/analysis/sessions/{session_id}/state")
async def analysis_state(session_id: str, payload: PlaybackState):
    if analysis_manager is None:
        raise HTTPException(status_code=503, detail="Foundry analysis is not configured")
    await analysis_manager.update_state(session_id, payload)
    return {"status": "updated"}


@app.post("/api/analysis/sessions/{session_id}/windows", response_model=SubmissionResult, status_code=202)
async def analysis_window(session_id: str, payload: AnalysisWindow):
    if analysis_manager is None:
        raise HTTPException(status_code=503, detail="Foundry analysis is not configured")
    try:
        return await analysis_manager.submit(session_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/analysis/sessions/{session_id}/synthetic", response_model=SubmissionResult, status_code=202)
async def synthetic_observation(session_id: str, payload: SyntheticObservationSubmission):
    if analysis_manager is None:
        raise HTTPException(status_code=503, detail="Foundry analysis is not configured")
    return await analysis_manager.submit_synthetic(session_id, payload)


@app.get("/api/polls/{poll_id}/results")
def poll_results(poll_id: str):
    return store.results(poll_id)


@app.post("/api/votes", status_code=201)
async def vote(payload: VoteRequest):
    try:
        result = store.cast(payload.poll_id, payload.option_id, payload.viewer_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await broadcast({"type": "vote_results", **result})
    logger.info(
        "fanpulse vote poll=%s option=%s",
        payload.poll_id,
        payload.option_id,
    )
    return result


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connections.add(websocket)
    logger.info("fanpulse websocket_connected clients=%d", len(connections))
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        connections.discard(websocket)
        logger.info("fanpulse websocket_disconnected clients=%d", len(connections))


frontend_dist = Path(__file__).resolve().parents[3] / "apps" / "web" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")

