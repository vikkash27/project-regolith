"""
Project Regolith — FastAPI Backend
Telemetry WebSocket server + mission orchestration.
Bridges physics engine, Claude agents, and Nemotron auditor.
"""

from __future__ import annotations
import os
import json
import asyncio
import logging
import time
from pathlib import Path
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from sim.physics_loop import PhysicsEngine
from agents.mcp_bridge import MCPBridge
from agents.navigation_agent import SwarmCoordinator
from api.nemotron_audit import NemotronAuditor

load_dotenv()

# ---- Logging ----
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s"
)
logger = logging.getLogger("regolith.server")

# ---- Global State ----
physics: PhysicsEngine | None = None
bridge: MCPBridge | None = None
swarm: SwarmCoordinator | None = None
auditor: NemotronAuditor | None = None

# WebSocket client sets
telemetry_clients: set[WebSocket] = set()
negotiation_clients: set[WebSocket] = set()

# Mission control
mission_running = False
physics_task: asyncio.Task | None = None
agent_task: asyncio.Task | None = None


# ---- Lifecycle ----
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize all subsystems on startup."""
    global physics, bridge, swarm, auditor

    logger.info("Initializing Project Regolith subsystems...")

    # Physics engine
    physics = PhysicsEngine()
    logger.info("Physics engine initialized")

    # MCP Bridge
    bridge = MCPBridge(physics)
    logger.info("MCP Bridge initialized")

    # Agent swarm
    model = os.environ.get("CLAUDE_MODEL", "claude-haiku-4-5-20251001")
    swarm = SwarmCoordinator(bridge, model=model)
    logger.info(f"Swarm coordinator initialized with model={model}")

    # Nemotron auditor
    auditor = NemotronAuditor()
    logger.info(f"Nemotron auditor initialized (enabled={auditor.enabled})")

    yield

    # Cleanup
    logger.info("Shutting down...")
    if auditor:
        await auditor.close()


# ---- App ----
app = FastAPI(
    title="Project Regolith",
    description="Autonomous Lunar Swarm Coordination",
    lifespan=lifespan,
)

# Serve frontend static files
frontend_dir = Path(__file__).parent.parent / "frontend"
app.mount("/assets", StaticFiles(directory=frontend_dir / "assets"), name="assets")
app.mount("/js", StaticFiles(directory=frontend_dir / "js"), name="js")


@app.get("/")
async def serve_frontend():
    """Serve the main Three.js dashboard."""
    return FileResponse(frontend_dir / "index.html")


@app.get("/style.css")
async def serve_css():
    return FileResponse(frontend_dir / "style.css")


# ---- Mission Control ----

@app.post("/api/start-mission")
async def start_mission(request: Request):
    """Start the simulation and agent loops. Accepts optional JSON config."""
    global mission_running, physics_task, agent_task, physics, bridge, swarm

    # Parse body — may be empty for backwards compat
    config = None
    try:
        config = await request.json()
    except Exception:
        pass

    if mission_running:
        # Reset first if already running
        mission_running = False
        if physics_task: physics_task.cancel()
        if agent_task: agent_task.cancel()
        await asyncio.sleep(0.3)

    # Apply config if provided
    shadow_speed = 3.0
    crater_name = "selected crater"
    num_rovers = 3
    crater_diameter = 500.0
    if config:
        shadow_speed = float(config.get("shadowSpeed", 3.0))
        crater_id = config.get("craterId", "shackleton")
        crater_name = crater_id.replace("_", " ").title()
        initial_battery = config.get("initialBattery", 100)
        num_rovers = int(config.get("numRovers", 3))
        crater_diameter = float(config.get("diameter_m", 500.0))

        # Reconfigure terrain if crater params provided
        from sim.terrain_kernel import CraterConfig
        crater_cfg = CraterConfig(
            diameter_m=crater_diameter,
            depth_m=config.get("depth_m", 80.0),
        )
        physics = PhysicsEngine(crater_config=crater_cfg, num_rovers=num_rovers)
        bridge = MCPBridge(physics)
        model = os.environ.get("CLAUDE_MODEL", "claude-haiku-4-5-20251001")
        scenario = config.get("scenario", "exploration")
        swarm = SwarmCoordinator(bridge, model=model, crater_name=crater_name, crater_diameter=crater_diameter, scenario=scenario)

        # Set initial battery for all rovers
        for rover in physics.rovers.values():
            rover.battery = float(initial_battery)

        logger.info(f"Mission config applied: crater={crater_id}, shadow_speed={shadow_speed}, battery={initial_battery}")

    mission_running = True
    physics.start_mission()
    physics.shadow.speed = shadow_speed

    logger.info("MISSION STARTED")

    physics_task = asyncio.create_task(_physics_loop())
    agent_task = asyncio.create_task(_agent_loop())

    await broadcast_negotiation({
        "type": "status",
        "status": "MISSION ACTIVE",
        "class": "status-active"
    })
    await broadcast_negotiation({
        "type": "log",
        "log_type": "system",
        "message": f"Mission clock started. Deploying to {crater_name}. Shadow advancing at {shadow_speed} m/s.",
    })

    return {"status": "started", "shadow_speed": shadow_speed}


@app.post("/api/reset-mission")
async def reset_mission():
    """Reset everything for another demo run."""
    global mission_running, physics_task, agent_task, physics, bridge, swarm

    mission_running = False

    if physics_task:
        physics_task.cancel()
    if agent_task:
        agent_task.cancel()

    await asyncio.sleep(0.5)

    # Reinitialize
    physics = PhysicsEngine()
    bridge = MCPBridge(physics)
    model = os.environ.get("CLAUDE_MODEL", "claude-haiku-4-5-20251001")
    swarm = SwarmCoordinator(bridge, model=model)

    await broadcast_negotiation({
        "type": "status",
        "status": "AWAITING LAUNCH",
        "class": "status-idle"
    })

    return {"status": "reset"}


@app.get("/api/state")
async def get_state():
    """Get current simulation state (for debugging)."""
    if physics:
        return physics._get_state()
    return {"error": "Not initialized"}


# ---- Physics Loop ----

async def _physics_loop():
    """Run physics at ~30Hz, broadcast telemetry at ~10Hz."""
    global mission_running

    tick_interval = 1.0 / 30.0   # 30Hz physics
    broadcast_every = 3           # broadcast every 3rd tick (~10Hz)
    tick_count = 0

    logger.info("Physics loop started")

    try:
        while mission_running:
            start = time.monotonic()

            # Physics tick
            state = physics.tick()
            tick_count += 1

            # Broadcast telemetry at 10Hz
            if tick_count % broadcast_every == 0:
                await broadcast_telemetry(state)

            # Check for shadow-triggered events
            await _check_shadow_events(state)

            # Sleep to maintain tick rate
            elapsed = time.monotonic() - start
            sleep_time = max(0, tick_interval - elapsed)
            await asyncio.sleep(sleep_time)

    except asyncio.CancelledError:
        logger.info("Physics loop cancelled")
    except Exception as e:
        logger.error(f"Physics loop error: {e}")


async def _check_shadow_events(state: dict):
    """Check for shadow-related events and broadcast alerts."""
    for rover_id, rs in state["rovers"].items():
        rover = physics.rovers[rover_id]

        # Alert when rover first enters shadow
        if rs["in_shadow"] and rover.task == "IDLE":
            rover.task = "IN SHADOW - DANGER"
            await broadcast_negotiation({
                "type": "log",
                "log_type": "danger",
                "message": f"⚠ <b>{rover_id.upper()}</b> has entered the SHADOW ZONE! Battery drain 5x.",
            })
            await broadcast_negotiation({
                "type": "status",
                "status": "SHADOW CONTACT",
                "class": "status-danger"
            })


# ---- Agent Loop ----

async def _agent_loop():
    """Run agent decision cycles periodically."""
    global mission_running

    agent_interval = 25.0  # seconds between agent cycles (cost-optimized)
    cycle = 0

    # Wait a few seconds for physics to establish state
    await asyncio.sleep(2.0)

    logger.info("Agent loop started")

    try:
        while mission_running:
            cycle += 1
            logger.info(f"=== Agent Cycle {cycle} ===")

            try:
                # Run all agents
                events = await swarm.tick_all_agents()

                # Broadcast any events
                for event in events:
                    await broadcast_negotiation(event)

                # Check if any CNP rounds completed — run Nemotron audit
                await _audit_completed_contracts()

                # Periodic swarm-level audit every cycle (ensures gauges always update)
                await _periodic_swarm_audit(cycle)

            except Exception as e:
                logger.error(f"Agent cycle {cycle} error: {e}", exc_info=True)
                await broadcast_negotiation({
                    "type": "log",
                    "log_type": "danger",
                    "message": f"Agent cycle error: {type(e).__name__}. Retrying...",
                })

            await asyncio.sleep(agent_interval)

    except asyncio.CancelledError:
        logger.info("Agent loop cancelled")
    except Exception as e:
        logger.error(f"Agent loop error: {e}", exc_info=True)


async def _periodic_swarm_audit(cycle: int):
    """Run Nemotron audit on the overall swarm state every cycle — keeps gauges updated."""
    if not auditor or not physics:
        return
    try:
        state = physics._get_state()
        rovers = state.get("rovers", {})
        shadow = physics.shadow.to_dict()

        # Build a summary of current swarm decisions for auditing
        decisions = []
        for rid, rs in rovers.items():
            decisions.append(
                f"{rid}: pos=({rs['x']:.0f},{rs['z']:.0f}) bat={rs['battery']:.0f}% "
                f"shadow={rs['in_shadow']} task={rs['task']}"
            )

        situation = (
            f"Cycle {cycle}. Scenario: {getattr(swarm, '_scenario', 'exploration')}. "
            f"Shadow at X={shadow['boundary_x']:.0f}m, speed={shadow['speed']} m/s.\n"
            + "\n".join(decisions)
        )

        result = await auditor.audit_rover_decision(
            "swarm", situation, f"Swarm cycle {cycle} — {len(rovers)} rovers active"
        )

        await broadcast_negotiation({
            "type": "audit",
            "scores": result.to_dict(),
        })

        log_msg = (
            f"NEMOTRON SWARM AUDIT — Help: {result.helpfulness:.1f} | "
            f"Correct: {result.correctness:.1f} | "
            f"Coherent: {result.coherence:.1f} | "
            f"Complex: {result.complexity:.1f} | "
            f"{'✅ PASS' if result.passed else '❌ FAIL'}"
        )
        await broadcast_negotiation({
            "type": "log",
            "log_type": "audit",
            "message": log_msg,
        })
        logger.info(f"Periodic swarm audit cycle {cycle}: {result.to_dict()}")
    except Exception as e:
        logger.warning(f"Periodic audit error: {e}")


async def _audit_completed_contracts():
    """Run Nemotron audit on any newly completed contracts."""
    # Check if there are new contracts to audit
    for cfp_id, award in list(bridge.contracts.items()):
        # Only audit each contract once
        if hasattr(award, '_audited'):
            continue

        bids = bridge.bids.get(cfp_id, [])
        if not bids:
            continue

        # Find the winning bid
        winning_bid = next(
            (b for b in bids if b.bidder_id == award.winner_id),
            None
        )
        if not winning_bid:
            continue

        # Run Nemotron audit
        shadow_state = physics.shadow.to_dict()
        mission_context = (
            f"Shadow boundary at X={shadow_state['boundary_x']:.0f}m, "
            f"advancing at {shadow_state['speed']} m/s. "
            f"Task location: ({award.target_x:.0f}, {award.target_z:.0f})"
        )

        result = await auditor.audit_cnp_round(
            cfp_description=f"{award.task_type} mission for rover at ({award.target_x:.0f}, {award.target_z:.0f})",
            bids=[b.to_dict() for b in bids],
            winning_bid=winning_bid.to_dict(),
            mission_context=mission_context,
        )

        # Broadcast audit result
        await broadcast_negotiation({
            "type": "audit",
            "scores": result.to_dict(),
        })
        await broadcast_negotiation({
            "type": "log",
            "log_type": "audit",
            "message": (
                f"NEMOTRON AUDIT — Help: {result.helpfulness:.1f} | "
                f"Correct: {result.correctness:.1f} | "
                f"Coherent: {result.coherence:.1f} | "
                f"{'✅ PASS' if result.passed else '❌ FAIL — REPLANNING'}"
            ),
        })

        if not result.passed:
            await broadcast_negotiation({
                "type": "status",
                "status": "AUDIT FAIL — REPLANNING",
                "class": "status-danger"
            })

        # Mark as audited
        award._audited = True

        logger.info(f"Nemotron audit for {cfp_id}: passed={result.passed}, scores={result.to_dict()}")


# ---- WebSocket Endpoints ----

@app.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket):
    """Stream rover positions + shadow state at ~10Hz."""
    await ws.accept()
    telemetry_clients.add(ws)
    logger.info(f"Telemetry client connected ({len(telemetry_clients)} total)")

    try:
        while True:
            try:
                # Use a short timeout to keep the connection responsive
                await asyncio.wait_for(ws.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                # Send a ping to keep alive
                await ws.send_text('{"ping": true}')
    except (WebSocketDisconnect, Exception):
        telemetry_clients.discard(ws)
        logger.info(f"Telemetry client disconnected ({len(telemetry_clients)} total)")


@app.websocket("/ws/negotiation")
async def ws_negotiation(ws: WebSocket):
    """Stream CNP events + Nemotron audit scores."""
    await ws.accept()
    negotiation_clients.add(ws)
    logger.info(f"Negotiation client connected ({len(negotiation_clients)} total)")

    try:
        while True:
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                await ws.send_text('{"ping": true}')
    except (WebSocketDisconnect, Exception):
        negotiation_clients.discard(ws)
        logger.info(f"Negotiation client disconnected ({len(negotiation_clients)} total)")


async def broadcast_telemetry(state: dict):
    """Broadcast state to all telemetry WebSocket clients."""
    if not telemetry_clients:
        return
    data = json.dumps(state)
    disconnected = set()
    for ws in telemetry_clients:
        try:
            await ws.send_text(data)
        except Exception:
            disconnected.add(ws)
    telemetry_clients.difference_update(disconnected)


async def broadcast_negotiation(event: dict):
    """Broadcast event to all negotiation WebSocket clients."""
    if not negotiation_clients:
        return
    data = json.dumps(event)
    disconnected = set()
    for ws in negotiation_clients:
        try:
            await ws.send_text(data)
        except Exception:
            disconnected.add(ws)
    negotiation_clients.difference_update(disconnected)


# ---- Run ----
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "api.telemetry_ws:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
