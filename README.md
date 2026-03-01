# 🌙 Project Regolith

### Autonomous Lunar Swarm Coordination

> *What if lunar rovers could negotiate their own survival?*

Project Regolith demonstrates decentralized autonomous swarm coordination in a simulated lunar crater environment. Three AI-powered rovers navigate Shackleton Crater at the Lunar South Pole, negotiating survival through the **Contract Net Protocol** as a lethal shadow sweeps across the terrain.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Three.js Dashboard                        │
│  ┌──────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │  3D Lunar │  │  Negotiation     │  │  Nemotron Audit   │  │
│  │  Crater   │  │  Log (CNP)       │  │  Gauges (5-dim)   │  │
│  └────┬─────┘  └────────┬─────────┘  └────────┬──────────┘  │
│       │ WebSocket        │ WebSocket           │             │
├───────┼──────────────────┼─────────────────────┼─────────────┤
│       ▼                  ▼                     ▼             │
│  ┌─────────────── FastAPI Backend ──────────────────────┐    │
│  │  /ws/telemetry (10Hz)    /ws/negotiation (events)    │    │
│  │                                                       │    │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │    │
│  │  │ Physics     │  │ Claude Agent  │  │ Nemotron   │  │    │
│  │  │ Engine      │◀─│ Swarm (CNP)  │──│ Auditor    │  │    │
│  │  │ (30Hz)      │  │              │  │ (Reward)   │  │    │
│  │  └─────────────┘  └──────────────┘  └────────────┘  │    │
│  └───────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Component | Technology |
|---|---|
| **Physics Engine** | NumPy (CPU) — Semi-implicit Euler, lunar gravity (1.625 m/s²) |
| **Cognitive Layer** | Anthropic Claude (tool_use) — 3 autonomous rover agents |
| **Negotiation** | Contract Net Protocol (CFP → BID → AWARD) |
| **Mission Auditor** | NVIDIA Nemotron-70B Reward Model (build.nvidia.com API) |
| **Visualization** | Three.js with NASA lunar terrain data |
| **Backend** | FastAPI + WebSocket (async telemetry streaming) |

## Quick Start

```bash
# 1. Clone and enter project
cd project_regolith

# 2. Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Set up API keys
cp .env.example .env
# Edit .env with your Anthropic API key (required) and NVIDIA API key (optional)

# 5. Launch
./run.sh
# or: python -m uvicorn api.telemetry_ws:app --host 0.0.0.0 --port 8000

# 6. Open http://localhost:8000 in your browser
# 7. Click "LAUNCH MISSION" and watch the swarm negotiate survival
```

## The Demo Scenario

1. **Deploy** — 3 rovers (Alpha, Beta, Gamma) are placed in Shackleton Crater
2. **Explore** — Rovers autonomously spread out to map terrain
3. **Shadow Contact** — The lethal shadow begins sweeping across the crater floor
4. **Alpha in Danger** — Rover-Alpha (the scout, deepest in the crater) enters the shadow zone
5. **CFP Broadcast** — Alpha broadcasts a Call for Proposals: *"RESCUE: escort to safe zone"*
6. **Bidding** — Beta and Gamma calculate utility scores and submit bids
7. **Contract Award** — Highest-scoring rover wins the rescue contract
8. **Nemotron Audit** — NVIDIA's reward model scores the decision in real-time across 5 dimensions
9. **Rescue** — The winning contractor navigates to Alpha and escorts it to safety

## Contract Net Protocol

The swarm uses economic negotiation instead of centralized command:

```
U = (w₁ × battery) - (w₂ × distance) + (w₃ × capability_match × 100)
```

| Phase | Description |
|---|---|
| **CFP** | Manager broadcasts task requirements to swarm |
| **BID** | Contractors calculate utility and submit offers |
| **AWARD** | Manager selects highest-scoring bid |
| **EXECUTE** | Contractor performs the task, streaming progress |

## Project Structure

```
project-regolith/
├── sim/
│   ├── terrain_kernel.py    # Procedural crater heightmap generator
│   └── physics_loop.py      # Semi-implicit Euler physics at 30Hz
├── agents/
│   ├── mcp_bridge.py        # MCP tool interface (sim ↔ agents)
│   ├── navigation_agent.py  # Claude-powered rover swarm + CNP
│   └── bidding_logic.py     # Utility function for bid calculation
├── api/
│   ├── telemetry_ws.py      # FastAPI backend + WebSocket streaming
│   └── nemotron_audit.py    # NVIDIA Nemotron-70B reward scoring
├── frontend/
│   ├── index.html           # Dashboard layout + HUD
│   ├── style.css            # Orbitron/JetBrains Mono themed UI
│   └── js/main.js           # Three.js 3D scene + WebSocket client
├── config.yaml              # Simulation parameters
├── requirements.txt         # Python dependencies
├── run.sh                   # One-command launch script
└── README.md
```

## Why Decentralized?

Earth-to-Moon communication has **1.3 second** one-way latency. A centralized command server is a single point of failure. The Contract Net Protocol enables rovers to:

- **Self-organize** without a central controller
- **Negotiate** task allocation based on local knowledge
- **Adapt** when team members are disabled
- **Elect new leaders** when the current manager fails

## Beyond the Moon

The same architecture applies to:
- 🌊 **Deep Sea** — Submarine swarms in high-pressure trenches
- 🔥 **Disaster Response** — Drone swarms coordinating fire suppression
- ⛏️ **Mining** — Autonomous drilling rigs in hazardous environments

---

*Built for the UCL AI Festival Hackathon 2026*
*Powered by Anthropic Claude + NVIDIA Nemotron*
