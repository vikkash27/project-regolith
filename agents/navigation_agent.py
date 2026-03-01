"""
Project Regolith — Navigation Agent (Claude-Powered Rover Swarm)
Each rover is an autonomous Claude agent with tool_use capabilities.
Implements the Contract Net Protocol for decentralized task negotiation.
"""

from __future__ import annotations
import json
import asyncio
import logging
from typing import TYPE_CHECKING

import anthropic

if TYPE_CHECKING:
    from agents.mcp_bridge import MCPBridge

logger = logging.getLogger("regolith.agents")

# ---- Rover Personas (support up to 5 rovers) ----
ROVER_PERSONAS = {
    "alpha": {
        "name": "Rover-Alpha",
        "role": "Scout / Pathfinder",
        "capabilities": ["long_range_sensors", "terrain_mapping", "high_speed"],
        "personality": "Bold and exploratory. Pushes furthest from the group to map unknown terrain. Takes calculated risks.",
    },
    "beta": {
        "name": "Rover-Beta",
        "role": "Heavy-Lift / Rescue",
        "capabilities": ["towing", "heavy_lift", "reinforced_chassis"],
        "personality": "Reliable and methodical. Best suited for rescue operations due to reinforced chassis and towing capability.",
    },
    "gamma": {
        "name": "Rover-Gamma",
        "role": "Medic / Sensor Specialist",
        "capabilities": ["advanced_sensors", "repair_kit", "comms_relay"],
        "personality": "Cautious and analytical. Maintains optimal sensor coverage and can relay communications. Prefers safe positions.",
    },
    "delta": {
        "name": "Rover-Delta",
        "role": "Relay / Communications",
        "capabilities": ["comms_relay", "long_range_sensors", "signal_boost"],
        "personality": "Strategic and positioning-oriented. Maintains optimal relay distance between rovers. Prioritises team connectivity.",
    },
    "epsilon": {
        "name": "Rover-Epsilon",
        "role": "Excavator / Miner",
        "capabilities": ["drill", "sample_collection", "heavy_lift"],
        "personality": "Determined and task-focused. Specialises in regolith sampling and ice detection. Will dig in and hold position.",
    },
}


def build_system_prompt(rover_id: str, crater_name: str = "the crater", crater_diameter: float = 500.0, scenario: str = "exploration") -> str:
    """Build a compact system prompt for a rover agent. Minimizes token usage."""
    persona = ROVER_PERSONAS.get(rover_id, ROVER_PERSONAS["alpha"])

    scenario_context = {
        "exploration": "MISSION: Survey crater, discover all ice deposits, map terrain. Maximize coverage.",
        "rescue": "MISSION: EMERGENCY RESCUE — a teammate is stranded in the shadow zone with critical battery. Locate and escort them to safety. Top priority!",
        "mining": "MISSION: Ice mining operations. Locate richest deposits, mine ice, transport to crater rim base. Efficiency matters.",
        "relay": "MISSION: Deploy communication relay chain across crater. Maintain optimal spacing for full coverage. Stay connected.",
        "race": "MISSION: SHADOW RACE — shadow advancing fast! All rovers must evacuate to +X safety zone IMMEDIATELY. Speed is survival.",
    }
    mission_line = scenario_context.get(scenario, scenario_context["exploration"])

    return f"""You are {persona['name']}, a lunar rover in {crater_name} (south pole). Role: {persona['role']}. Capabilities: {', '.join(persona['capabilities'])}.

{mission_line}

ENV: ~{crater_diameter:.0f}m crater. Shadow advances from -X (5x battery drain in shadow). Safe zone = +X direction.

CNP: In danger → broadcast_cfp. See CFP → bid if battery>40% & close enough. Utility = 0.4*battery - 0.3*dist + 0.3*capability*100. Issued CFP → award best bidder.

PRIORITIES: 1.Survive(battery<30%→move +X) 2.Help teammates 3.Explore 4.Conserve

Tools only. No explanations. Decide fast."""


class RoverAgent:
    """A single Claude-powered rover agent."""

    def __init__(self, rover_id: str, bridge: MCPBridge, model: str = "claude-haiku-4-5-20251001",
                 crater_name: str = "the crater", crater_diameter: float = 500.0, scenario: str = "exploration"):
        self.rover_id = rover_id
        self.bridge = bridge
        self.model = model
        self.client = anthropic.Anthropic()
        self.system_prompt = build_system_prompt(rover_id, crater_name, crater_diameter, scenario)
        self.conversation_history: list[dict] = []
        self.max_history = 4  # compact context to minimize token costs
        self._running = False

    async def think_and_act(self) -> list[dict]:
        """
        One agentic cycle: observe → decide → act.
        Returns list of events generated during this cycle.
        """
        events = []
        rover_state = self.bridge.physics.get_rover_state(self.rover_id)

        if not rover_state or rover_state.get("is_disabled"):
            return events

        # Build the current situation prompt
        shadow = self.bridge.physics.shadow.to_dict()
        active_cfps = [cfp.to_dict() for cfp in self.bridge.active_cfps.values()]

        situation = self._build_situation_prompt(rover_state, shadow, active_cfps)

        # Trim history if too long
        if len(self.conversation_history) > self.max_history * 2:
            self.conversation_history = self.conversation_history[-self.max_history:]

        # Add the situation as a user message
        self.conversation_history.append({
            "role": "user",
            "content": situation
        })

        try:
            # Agentic loop: keep calling until no more tool_use
            for _ in range(2):  # max 2 tool calls per cycle (cost control)
                response = self.client.messages.create(
                    model=self.model,
                    max_tokens=512,
                    system=self.system_prompt,
                    tools=self.bridge.get_tool_definitions(),
                    messages=self.conversation_history,
                )

                # Process response
                assistant_content = response.content
                self.conversation_history.append({
                    "role": "assistant",
                    "content": [block.model_dump() for block in assistant_content]
                })

                # Check if there are tool calls
                tool_calls = [b for b in assistant_content if b.type == "tool_use"]

                if not tool_calls:
                    break  # Agent is done acting

                # Execute each tool call
                tool_results = []
                for tc in tool_calls:
                    result = self.bridge.execute_tool(
                        self.rover_id, tc.name, tc.input
                    )
                    # Ensure all values are JSON-safe (convert numpy types)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tc.id,
                        "content": json.dumps(result, default=str),
                    })
                    logger.info(f"[{self.rover_id}] {tc.name}({tc.input}) → {result}")

                self.conversation_history.append({
                    "role": "user",
                    "content": tool_results,
                })

                # Drain events generated by tool execution
                events.extend(self.bridge.drain_events())

                if response.stop_reason == "end_turn":
                    break

        except anthropic.RateLimitError as e:
            logger.warning(f"[{self.rover_id}] Rate limited, will retry next tick")
            events.append({
                "type": "log",
                "log_type": "system",
                "message": f"<b>{self.rover_id.upper()}</b> rate limited — retrying next cycle",
            })
        except anthropic.APIError as e:
            logger.error(f"[{self.rover_id}] Anthropic API error: {e}")
            events.append({
                "type": "log",
                "log_type": "danger",
                "message": f"<b>{self.rover_id.upper()}</b> API error: {type(e).__name__}",
            })
        except Exception as e:
            logger.error(f"[{self.rover_id}] Agent error: {e}", exc_info=True)
            events.append({
                "type": "log",
                "log_type": "danger",
                "message": f"<b>{self.rover_id.upper()}</b> error: {str(e)[:120]}",
            })

        return events

    def _build_situation_prompt(self, rover_state: dict, shadow: dict, active_cfps: list) -> str:
        """Build a concise situation awareness prompt."""
        parts = [
            f"=== TICK UPDATE for {self.rover_id.upper()} ===",
            f"Your position: ({rover_state['x']}, {rover_state['z']})",
            f"Battery: {rover_state['battery']}% | Sensors: {rover_state['sensor_health']}%",
            f"In shadow: {rover_state['in_shadow']} | Task: {rover_state['task']}",
            f"Shadow boundary X: {shadow['boundary_x']} (advancing at {shadow['speed']} m/s)",
        ]

        if rover_state['in_shadow']:
            parts.append("⚠ WARNING: YOU ARE IN THE SHADOW ZONE. BATTERY DRAINING 5x FASTER. MOVE TO +X IMMEDIATELY OR CALL FOR RESCUE.")

        if rover_state['battery'] < 30:
            parts.append(f"⚠ LOW BATTERY: {rover_state['battery']}%. Consider requesting rescue or moving to safety.")

        if active_cfps:
            parts.append(f"\nActive CFPs ({len(active_cfps)}):")
            for cfp in active_cfps:
                parts.append(f"  - [{cfp['id']}] {cfp['task_type']} by {cfp['issuer_id']}: {cfp['description']} (urgency: {cfp['urgency']})")

        parts.append("\nDecide your next action. Use tools to act. Be decisive and fast.")

        return "\n".join(parts)


class SwarmCoordinator:
    """
    Manages the full swarm of rover agents.
    Orchestrates the agentic tick cycle.
    """

    def __init__(self, bridge: MCPBridge, model: str = "claude-haiku-4-5-20251001",
                 crater_name: str = "the crater", crater_diameter: float = 500.0, scenario: str = "exploration"):
        self.bridge = bridge
        self.agents: dict[str, RoverAgent] = {}
        self._running = False
        self._scenario = scenario

        for rover_id in bridge.physics.rovers:
            self.agents[rover_id] = RoverAgent(
                rover_id, bridge, model,
                crater_name=crater_name,
                crater_diameter=crater_diameter,
                scenario=scenario,
            )

    async def tick_all_agents(self) -> list[dict]:
        """
        Run one agentic cycle for all rovers.
        Agents act sequentially to avoid race conditions on shared state.
        Returns all events generated.
        """
        all_events = []

        for rover_id, agent in self.agents.items():
            rover_state = self.bridge.physics.get_rover_state(rover_id)
            if rover_state and not rover_state.get("is_disabled"):
                events = await agent.think_and_act()
                all_events.extend(events)

        return all_events

    async def tick_single_agent(self, rover_id: str) -> list[dict]:
        """Run one agentic cycle for a specific rover."""
        agent = self.agents.get(rover_id)
        if not agent:
            return []
        return await agent.think_and_act()
