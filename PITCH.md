# Project Regolith — Pitch Narrative

## One-Liner
**Autonomous lunar swarm coordination: AI agents that negotiate, navigate, and survive together on the Moon's south pole.**

---

## What Problem Does This Solve?

NASA's Artemis program will send rovers to the lunar south pole by 2028. These craters contain confirmed water ice deposits — the most valuable resource for sustained human presence on the Moon. But there's a critical challenge:

**Communication delay with Earth is 2.6 seconds round-trip. Rovers in permanently shadowed craters have NO direct line of sight to mission control. They must coordinate autonomously.**

Current rover missions (Curiosity, Perseverance) operate one robot at a time with human-in-the-loop control. This doesn't scale. Future missions will deploy **swarms** of 3-5 rovers simultaneously, and they need to:

1. **Negotiate task allocation** without a central commander
2. **Avoid a lethal advancing shadow** that drains battery 5x faster
3. **Discover and map ice deposits** in the most dangerous terrain imaginable
4. **Maintain communication relay chains** in terrain that blocks radio signals
5. **Make life-or-death decisions in real-time** — a rover caught in shadow with no battery is dead

---

## What We Built

A **real-time 3D simulation** of autonomous multi-rover coordination at the lunar south pole, powered by:

### 1. Claude Sonnet AI Agents (Anthropic)
Each rover is an independent Claude agent with `tool_use` capabilities. They observe their environment, reason about threats, and take actions — no hardcoded behavior. Each has a unique persona (Scout, Heavy-Lift, Sensor, Relay, Excavator) that influences their decision-making.

### 2. Contract Net Protocol (Smith, 1980)
Rovers negotiate using a decentralized auction protocol from multi-agent systems research:
- A rover in danger broadcasts a **Call for Proposals** (CFP)
- Other rovers evaluate whether they can help, calculate a **utility score**
- The best bidder wins the **contract** and executes the rescue/task
- No central controller — fully emergent coordination

### 3. NVIDIA Nemotron-3-Nano Mission Auditor
Every negotiation decision is scored in real-time by NVIDIA's Nemotron model across 5 dimensions:
- **Helpfulness** — Was the decision optimal for mission success?
- **Correctness** — Was the logic sound?
- **Coherence** — Did the coordination flow make sense?
- **Complexity** — How sophisticated was the multi-agent reasoning?
- **Verbosity** — Was communication appropriately concise?

This creates a **closed feedback loop**: AI agents decide → Nemotron scores → low scores trigger re-planning.

### 4. Frontier Navigation Techniques
- **Voronoi Coverage Control** (Cortés et al., 2004) — Each rover covers its optimal partition of the crater
- **Artificial Potential Fields** (Khatib, 1986) — Collision-free navigation via attractive/repulsive forces
- **Flocking Consensus** (Olfati-Saber, 2006) — Rovers maintain communication range while spreading out
- **Market-Based Task Allocation** (Dias et al., 2006) — Tasks go to the rover best positioned to complete them

### 5. Real Physics Simulation
- Semi-implicit Euler integration at 30Hz with lunar gravity (1.625 m/s²)
- Terrain: real south pole crater dimensions from NASA LRO data
- Shadow model: advancing terminator with thermal/battery degradation
- 8 real craters (Shackleton, Cabeus, Faustini...) with scientific citations

### 6. NASA Moon Visualization
- Full 8K NASA Lunar Reconnaissance Orbiter topographic model
- Google Earth-style zoom transition from orbit to crater surface
- GLSL shaders for terrain, shadows, and dust particles

---

## Why This Matters (For Judges)

| Dimension | What We Demonstrate |
|-----------|-------------------|
| **AI Innovation** | LLM agents with tool_use making real-time decisions in a physics simulation |
| **Multi-Agent Systems** | Decentralized negotiation (CNP) — no central controller, fully emergent |
| **NVIDIA Integration** | Nemotron-3-Nano as a live decision auditor — scoring quality in real-time |
| **Scientific Grounding** | 13 research citations, real crater data, real physics constants |
| **Visual Impact** | 3D NASA Moon, Voronoi boundaries, communication mesh, ice discovery |
| **Real-World Relevance** | Directly applicable to NASA Artemis, ESA, and ISRO rover missions |

---

## Tech Stack
- **Frontend**: Three.js 0.162, GLSL shaders, HTML5 overlay system
- **Backend**: FastAPI + WebSockets (telemetry at 10Hz, negotiation events)
- **AI Agents**: Anthropic Claude Sonnet (tool_use agentic loop)
- **Auditor**: NVIDIA Nemotron-3-Nano via build.nvidia.com API
- **Physics**: NumPy-based semi-implicit Euler, 30Hz tick rate
- **Data**: NASA LRO 8K topographic GLB, real crater database

---

## Key Demo Moments

1. **Select Shackleton Crater** (Artemis III candidate) → zoom from orbit into the crater
2. Watch rovers **spread out using Voronoi partitioning** — each covers its optimal zone
3. Shadow advances → a rover gets caught → it **broadcasts a CFP for rescue**
4. Other rovers **bid on the rescue** → highest utility wins the contract
5. **Nemotron gauges update in real-time** scoring the decision quality
6. Rovers **discover ice deposits** near the shadow boundary → visible on terrain
7. **Communication mesh** shows relay links between rovers — breaks when too far apart

---

## What's Novel

1. **LLM agents in a physics loop** — not just chatbots, but autonomous actors in a simulation
2. **CNP + LLM** — classic multi-agent protocol enhanced with natural language reasoning
3. **Nemotron as live auditor** — real-time quality scoring creates accountability for AI decisions
4. **Voronoi + potential fields + flocking** — three frontier robotics algorithms working together
5. **NASA-accurate** — real craters, real physics, real research citations
