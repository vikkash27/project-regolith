"""
Project Regolith — MCP Bridge
Exposes the simulation as structured tools that Claude agents can invoke.
Acts as the interface between the cognitive (LLM) and physical (sim) layers.
"""

from __future__ import annotations
import math
import time
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sim.physics_loop import PhysicsEngine


# ---- CNP Message Types ----
@dataclass
class CFPMessage:
    """Call for Proposals — broadcast by a Manager rover."""
    id: str
    task_type: str            # "rescue", "explore", "mine"
    issuer_id: str            # rover that needs help
    description: str
    required_capabilities: list[str] = field(default_factory=list)
    location_x: float = 0.0
    location_z: float = 0.0
    urgency: float = 1.0     # 0-1, how urgent
    timestamp: float = 0.0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "task_type": self.task_type,
            "issuer_id": self.issuer_id,
            "description": self.description,
            "required_capabilities": self.required_capabilities,
            "location_x": self.location_x,
            "location_z": self.location_z,
            "urgency": self.urgency,
            "timestamp": self.timestamp,
        }


@dataclass
class BidMessage:
    """Bid in response to a CFP."""
    cfp_id: str
    bidder_id: str
    utility_score: float
    estimated_time: float     # seconds to complete
    rationale: str = ""

    def to_dict(self) -> dict:
        return {
            "cfp_id": self.cfp_id,
            "bidder_id": self.bidder_id,
            "utility_score": round(self.utility_score, 3),
            "estimated_time": round(self.estimated_time, 1),
            "rationale": self.rationale,
        }


@dataclass
class AwardMessage:
    """Contract award to the winning bidder."""
    cfp_id: str
    winner_id: str
    task_type: str
    target_x: float
    target_z: float

    def to_dict(self) -> dict:
        return {
            "cfp_id": self.cfp_id,
            "winner_id": self.winner_id,
            "task_type": self.task_type,
            "target_x": round(self.target_x, 2),
            "target_z": round(self.target_z, 2),
        }


class MCPBridge:
    """
    Model Context Protocol bridge.
    Connects Claude agents to the physics simulation via structured tools.
    Manages the Contract Net Protocol state machine.
    """

    def __init__(self, physics: PhysicsEngine):
        self.physics = physics
        self.active_cfps: dict[str, CFPMessage] = {}
        self.bids: dict[str, list[BidMessage]] = {}   # cfp_id -> list of bids
        self.contracts: dict[str, AwardMessage] = {}   # cfp_id -> award
        self.event_log: list[dict] = []                # all events for frontend

    # ---- Tool Definitions (for Claude tool_use) ----

    def get_tool_definitions(self) -> list[dict]:
        """Return tool schemas for Anthropic tool_use API."""
        return [
            {
                "name": "get_rover_status",
                "description": "Get the current status of a specific rover including position, battery, sensor health, shadow status, and current task.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "rover_id": {
                            "type": "string",
                            "enum": ["alpha", "beta", "gamma", "delta", "epsilon"],
                            "description": "The ID of the rover to query"
                        }
                    },
                    "required": ["rover_id"]
                }
            },
            {
                "name": "get_all_rovers",
                "description": "Get the status of all rovers in the swarm.",
                "input_schema": {
                    "type": "object",
                    "properties": {},
                }
            },
            {
                "name": "get_terrain_at",
                "description": "Get terrain information at specific coordinates including height, slope angle, shadow coverage, and boundary status.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "x": {"type": "number", "description": "X coordinate in meters"},
                        "z": {"type": "number", "description": "Z coordinate in meters"}
                    },
                    "required": ["x", "z"]
                }
            },
            {
                "name": "get_shadow_status",
                "description": "Get current shadow boundary position and speed. Shadow advances from negative X toward positive X. Rovers in shadow lose battery 5x faster.",
                "input_schema": {
                    "type": "object",
                    "properties": {},
                }
            },
            {
                "name": "broadcast_cfp",
                "description": "Broadcast a Call for Proposals (CFP) to the swarm. Use when you need help from other rovers (rescue, escort, exploration). Other rovers will evaluate and bid on this task.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "task_type": {
                            "type": "string",
                            "enum": ["rescue", "escort", "explore", "repair"],
                            "description": "Type of task"
                        },
                        "description": {
                            "type": "string",
                            "description": "Human-readable description of what's needed"
                        },
                        "urgency": {
                            "type": "number",
                            "description": "Urgency from 0.0 (low) to 1.0 (critical)"
                        }
                    },
                    "required": ["task_type", "description", "urgency"]
                }
            },
            {
                "name": "submit_bid",
                "description": "Submit a bid on an active Call for Proposals. Include your calculated utility score and rationale.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "cfp_id": {
                            "type": "string",
                            "description": "ID of the CFP to bid on"
                        },
                        "utility_score": {
                            "type": "number",
                            "description": "Your calculated utility score (higher is better). Based on: (w1 * battery) - (w2 * distance) + (w3 * capability_match)"
                        },
                        "estimated_time": {
                            "type": "number",
                            "description": "Estimated seconds to complete the task"
                        },
                        "rationale": {
                            "type": "string",
                            "description": "Brief explanation of why you're submitting this bid"
                        }
                    },
                    "required": ["cfp_id", "utility_score", "estimated_time", "rationale"]
                }
            },
            {
                "name": "award_contract",
                "description": "Award a contract to the highest-scoring bidder on a CFP. Only the CFP issuer should call this.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "cfp_id": {
                            "type": "string",
                            "description": "ID of the CFP to award"
                        }
                    },
                    "required": ["cfp_id"]
                }
            },
            {
                "name": "move_to",
                "description": "Command your rover to navigate to target coordinates. The physics engine handles pathfinding.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "target_x": {
                            "type": "number",
                            "description": "Target X coordinate in meters"
                        },
                        "target_z": {
                            "type": "number",
                            "description": "Target Z coordinate in meters"
                        }
                    },
                    "required": ["target_x", "target_z"]
                }
            },
            {
                "name": "get_active_cfps",
                "description": "Get a list of all active Call for Proposals that haven't been awarded yet.",
                "input_schema": {
                    "type": "object",
                    "properties": {},
                }
            },
            {
                "name": "get_distance_to",
                "description": "Calculate distance from your rover to another rover or a set of coordinates.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "target_rover_id": {
                            "type": "string",
                            "description": "Target rover ID (optional, use either this or coordinates)"
                        },
                        "target_x": {
                            "type": "number",
                            "description": "Target X coordinate (optional)"
                        },
                        "target_z": {
                            "type": "number",
                            "description": "Target Z coordinate (optional)"
                        }
                    },
                }
            },
        ]

    # ---- Tool Execution ----

    def execute_tool(self, rover_id: str, tool_name: str, tool_input: dict) -> dict:
        """Execute a tool call from a Claude agent. Returns the result."""

        if tool_name == "get_rover_status":
            return self._get_rover_status(tool_input.get("rover_id", rover_id))

        elif tool_name == "get_all_rovers":
            return self._get_all_rovers()

        elif tool_name == "get_terrain_at":
            return self.physics.get_terrain_info(float(tool_input["x"]), float(tool_input["z"]))

        elif tool_name == "get_shadow_status":
            return self.physics.shadow.to_dict()

        elif tool_name == "broadcast_cfp":
            return self._broadcast_cfp(rover_id, tool_input)

        elif tool_name == "submit_bid":
            return self._submit_bid(rover_id, tool_input)

        elif tool_name == "award_contract":
            return self._award_contract(rover_id, tool_input["cfp_id"])

        elif tool_name == "move_to":
            return self._move_to(rover_id, tool_input["target_x"], tool_input["target_z"])

        elif tool_name == "get_active_cfps":
            return self._get_active_cfps()

        elif tool_name == "get_distance_to":
            return self._get_distance_to(rover_id, tool_input)

        else:
            return {"error": f"Unknown tool: {tool_name}"}

    # ---- Internal tool implementations ----

    def _get_rover_status(self, rover_id: str) -> dict:
        state = self.physics.get_rover_state(rover_id)
        if not state:
            return {"error": f"Rover '{rover_id}' not found"}
        # Add terrain info at rover position
        terrain = self.physics.get_terrain_info(state["x"], state["z"])
        state["terrain"] = terrain
        return state

    def _get_all_rovers(self) -> dict:
        return {
            rid: self.physics.get_rover_state(rid)
            for rid in self.physics.rovers
        }

    def _broadcast_cfp(self, issuer_id: str, params: dict) -> dict:
        rover = self.physics.rovers.get(issuer_id)
        if not rover:
            return {"error": "Rover not found"}

        cfp_id = f"cfp-{uuid.uuid4().hex[:8]}"
        cfp = CFPMessage(
            id=cfp_id,
            task_type=params["task_type"],
            issuer_id=issuer_id,
            description=params["description"],
            location_x=rover.x,
            location_z=rover.z,
            urgency=float(params.get("urgency", 0.5)),
            timestamp=self.physics.sim_time,
        )

        self.active_cfps[cfp_id] = cfp
        self.bids[cfp_id] = []

        event = {
            "type": "log",
            "log_type": "cfp",
            "message": f"<b>{issuer_id.upper()}</b> → CFP: {params['description']} [urgency: {cfp.urgency:.1f}]",
            "data": cfp.to_dict(),
        }
        self.event_log.append(event)

        return {"cfp_id": cfp_id, "status": "broadcast", **cfp.to_dict()}

    def _submit_bid(self, bidder_id: str, params: dict) -> dict:
        cfp_id = params["cfp_id"]
        if cfp_id not in self.active_cfps:
            return {"error": f"CFP '{cfp_id}' not found or already awarded"}

        cfp = self.active_cfps[cfp_id]
        if bidder_id == cfp.issuer_id:
            return {"error": "Cannot bid on your own CFP"}

        bid = BidMessage(
            cfp_id=cfp_id,
            bidder_id=bidder_id,
            utility_score=float(params["utility_score"]),
            estimated_time=float(params.get("estimated_time", 60)),
            rationale=params.get("rationale", ""),
        )
        self.bids[cfp_id].append(bid)

        event = {
            "type": "log",
            "log_type": "bid",
            "message": f"<b>{bidder_id.upper()}</b> → BID on {cfp.task_type}: score={bid.utility_score:.2f} | {bid.rationale}",
            "data": bid.to_dict(),
        }
        self.event_log.append(event)

        return {"status": "bid_submitted", **bid.to_dict()}

    def _award_contract(self, issuer_id: str, cfp_id: str) -> dict:
        if cfp_id not in self.active_cfps:
            return {"error": f"CFP '{cfp_id}' not found"}

        cfp = self.active_cfps[cfp_id]
        bids = self.bids.get(cfp_id, [])

        if not bids:
            return {"error": "No bids received yet"}

        # Award to highest utility score
        winner_bid = max(bids, key=lambda b: b.utility_score)

        award = AwardMessage(
            cfp_id=cfp_id,
            winner_id=winner_bid.bidder_id,
            task_type=cfp.task_type,
            target_x=cfp.location_x,
            target_z=cfp.location_z,
        )

        self.contracts[cfp_id] = award
        del self.active_cfps[cfp_id]  # no longer active

        # Set the winning rover's task and target
        winner_rover = self.physics.rovers.get(winner_bid.bidder_id)
        if winner_rover:
            winner_rover.task = f"{cfp.task_type.upper()}: {cfp.issuer_id}"
            self.physics.set_rover_target(winner_bid.bidder_id, cfp.location_x, cfp.location_z)

        event = {
            "type": "log",
            "log_type": "award",
            "message": f"CONTRACT AWARDED → <b>{winner_bid.bidder_id.upper()}</b> wins {cfp.task_type} (score: {winner_bid.utility_score:.2f})",
            "data": award.to_dict(),
        }
        self.event_log.append(event)

        return {"status": "awarded", **award.to_dict()}

    def _move_to(self, rover_id: str, target_x: float, target_z: float) -> dict:
        target_x, target_z = float(target_x), float(target_z)
        success = self.physics.set_rover_target(rover_id, target_x, target_z)
        if success:
            rover = self.physics.rovers[rover_id]
            rover.task = f"MOVING ({target_x:.0f}, {target_z:.0f})"
            return {"status": "navigating", "target_x": target_x, "target_z": target_z}
        return {"error": "Rover is disabled or not found"}

    def _get_active_cfps(self) -> dict:
        return {
            "active_cfps": [cfp.to_dict() for cfp in self.active_cfps.values()]
        }

    def _get_distance_to(self, rover_id: str, params: dict) -> dict:
        rover = self.physics.rovers.get(rover_id)
        if not rover:
            return {"error": "Rover not found"}

        if "target_rover_id" in params and params["target_rover_id"]:
            target = self.physics.rovers.get(params["target_rover_id"])
            if not target:
                return {"error": f"Target rover '{params['target_rover_id']}' not found"}
            dist = math.sqrt((rover.x - target.x)**2 + (rover.z - target.z)**2)
            return {"distance_m": round(dist, 2), "from": rover_id, "to": params["target_rover_id"]}
        elif "target_x" in params and "target_z" in params:
            tx, tz = float(params["target_x"]), float(params["target_z"])
            dist = math.sqrt((rover.x - tx)**2 + (rover.z - tz)**2)
            return {"distance_m": round(dist, 2), "from": rover_id, "to_coords": (tx, tz)}
        else:
            return {"error": "Provide either target_rover_id or target_x/target_z"}

    # ---- Event Drain ----

    def drain_events(self) -> list[dict]:
        """Drain and return all pending events (for WebSocket broadcast)."""
        events = self.event_log.copy()
        self.event_log.clear()
        return events
