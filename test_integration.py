"""Quick integration test for all subsystems."""
from sim.terrain_kernel import CraterTerrain
from sim.physics_loop import PhysicsEngine
from agents.mcp_bridge import MCPBridge
from agents.bidding_logic import calculate_utility
from api.nemotron_audit import NemotronAuditor

print("All imports OK")

# Quick integration test
engine = PhysicsEngine()
bridge = MCPBridge(engine)
engine.start_mission()

# Simulate a few ticks
for _ in range(90):
    engine.tick()

print(f"After 3s: shadow_x={engine.shadow.boundary_x:.1f}")
for rid, r in engine.rovers.items():
    print(f"  {rid}: pos=({r.x:.1f},{r.z:.1f}) bat={r.battery:.1f}% shadow={r.in_shadow}")

# Test MCP tools
result = bridge.execute_tool("alpha", "get_rover_status", {"rover_id": "alpha"})
print(f"Tool test: {result['id']} at ({result['x']}, {result['z']})")

# Test CFP broadcast
cfp = bridge.execute_tool("alpha", "broadcast_cfp", {
    "task_type": "rescue",
    "description": "Trapped in shadow zone, need escort",
    "urgency": 0.9
})
print(f"CFP broadcast: {cfp['cfp_id']}")

# Test bid
bid = bridge.execute_tool("beta", "submit_bid", {
    "cfp_id": cfp["cfp_id"],
    "utility_score": 85.5,
    "estimated_time": 45,
    "rationale": "Close proximity, high battery, rescue chassis"
})
print(f"Bid submitted: {bid['status']}")

# Test award
award = bridge.execute_tool("alpha", "award_contract", {"cfp_id": cfp["cfp_id"]})
print(f"Contract awarded to: {award['winner_id']}")

# Drain events
events = bridge.drain_events()
print(f"Events generated: {len(events)}")
for e in events:
    print(f"  [{e['log_type']}] {e['message'][:80]}")

print("\nIntegration test PASSED")
