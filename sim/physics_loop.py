"""
Project Regolith — Physics Simulation Loop
Semi-implicit Euler integration with lunar gravity.
Shadow model: advancing lethal shadow zone.
CPU-based (NumPy). Designed for 3 rovers at 30Hz.
"""

import time
import math
import numpy as np
from dataclasses import dataclass, field
from typing import Optional
from sim.terrain_kernel import CraterTerrain, CraterConfig


# ---- Constants ----
LUNAR_GRAVITY = 1.625  # m/s^2
SHADOW_BATTERY_DRAIN_MULTIPLIER = 5.0
NORMAL_DRAIN_RATE = 0.05  # % per second
SENSOR_SHADOW_DAMAGE_RATE = 0.3  # % per second in shadow
MAX_SPEED = 2.0  # m/s
FRICTION = 0.85  # velocity damping per tick


@dataclass
class RoverState:
    """Complete state of a single rover."""
    id: str
    x: float
    z: float
    vx: float = 0.0
    vz: float = 0.0
    battery: float = 100.0
    sensor_health: float = 100.0
    in_shadow: bool = False
    task: str = "IDLE"
    is_disabled: bool = False

    # Commands from agents
    target_x: Optional[float] = None
    target_z: Optional[float] = None
    force_x: float = 0.0
    force_z: float = 0.0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "x": round(float(self.x), 2),
            "z": round(float(self.z), 2),
            "vx": round(float(self.vx), 3),
            "vz": round(float(self.vz), 3),
            "battery": round(float(self.battery), 1),
            "sensor_health": round(float(self.sensor_health), 1),
            "in_shadow": bool(self.in_shadow),
            "task": self.task,
            "is_disabled": bool(self.is_disabled),
        }


@dataclass
class ShadowState:
    """The advancing lethal shadow."""
    boundary_x: float = -250.0  # starts at left edge of crater
    speed: float = 0.5  # meters per second (adjustable for drama)
    active: bool = False

    def to_dict(self) -> dict:
        return {
            "boundary_x": round(self.boundary_x, 2),
            "speed": self.speed,
            "active": self.active,
        }


class PhysicsEngine:
    """
    Manages the physical simulation of rovers in the crater.
    Semi-implicit Euler integration at lunar gravity.
    """

    def __init__(self, terrain: CraterTerrain = None, crater_config: CraterConfig = None, num_rovers: int = 3):
        if terrain:
            self.terrain = terrain
        elif crater_config:
            self.terrain = CraterTerrain(crater_config)
        else:
            self.terrain = CraterTerrain(CraterConfig())
        self.rovers: dict[str, RoverState] = {}
        self.shadow = ShadowState(boundary_x=-self.terrain.radius)
        self.tick_count = 0
        self.sim_time = 0.0
        self.dt = 1.0 / 30.0  # 30Hz tick rate
        self.mission_active = False

        # Initialize N rovers (1-5)
        self._init_rovers(max(1, min(5, num_rovers)))

    def _init_rovers(self, num_rovers: int = 3):
        """Place N rovers in spread-out starting positions within the crater."""
        ROVER_IDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon']
        R = self.terrain.radius * 0.3
        angle_step = 2 * math.pi / max(num_rovers, 1)
        for i in range(num_rovers):
            rid = ROVER_IDS[i]
            angle = angle_step * i + 0.4
            x = math.cos(angle) * R * (0.5 + i * 0.15)
            z = math.sin(angle) * R * (0.5 + i * 0.15)
            self.rovers[rid] = RoverState(id=rid, x=float(x), z=float(z))

    def start_mission(self):
        """Begin the simulation."""
        self.mission_active = True
        self.shadow.active = True
        self.sim_time = 0.0
        self.tick_count = 0

    def tick(self) -> dict:
        """
        Advance the simulation by one time step.
        Returns the complete state snapshot.
        """
        if not self.mission_active:
            return self._get_state()

        dt = self.dt
        self.sim_time += dt
        self.tick_count += 1

        # 1. Advance shadow
        if self.shadow.active:
            self.shadow.boundary_x += self.shadow.speed * dt

        # 2. Update each rover
        for rover in self.rovers.values():
            if rover.is_disabled:
                continue

            self._update_rover_physics(rover, dt)
            self._update_rover_shadow(rover)
            self._drain_resources(rover, dt)
            self._check_disable(rover)

        return self._get_state()

    def _update_rover_physics(self, rover: RoverState, dt: float):
        """Semi-implicit Euler integration for a single rover."""
        mass = 150.0  # kg, lunar rover mass

        # Applied force from agent commands
        fx = rover.force_x
        fz = rover.force_z

        # If rover has a target, compute steering force
        if rover.target_x is not None and rover.target_z is not None:
            dx = rover.target_x - rover.x
            dz = rover.target_z - rover.z
            dist = math.sqrt(dx * dx + dz * dz)

            if dist > 2.0:  # still moving toward target
                # Normalize and scale by engine force
                engine_force = 200.0  # Newtons
                fx += (dx / dist) * engine_force
                fz += (dz / dist) * engine_force
            else:
                # Arrived
                rover.target_x = None
                rover.target_z = None

        # Slope force: gravity component along surface
        slope_angle = self.terrain.get_slope_angle(rover.x, rover.z)
        nx, ny, nz = self.terrain.get_surface_normal(rover.x, rover.z)

        # Gravity force projected onto slope tangent
        g_force = mass * LUNAR_GRAVITY
        fx += -nx * g_force * math.sin(slope_angle)
        fz += -nz * g_force * math.sin(slope_angle)

        # Acceleration
        ax = fx / mass
        az = fz / mass

        # Velocity update (semi-implicit Euler)
        rover.vx = (rover.vx + ax * dt) * FRICTION
        rover.vz = (rover.vz + az * dt) * FRICTION

        # Speed clamping
        speed = math.sqrt(rover.vx**2 + rover.vz**2)
        if speed > MAX_SPEED:
            scale = MAX_SPEED / speed
            rover.vx *= scale
            rover.vz *= scale

        # Position update
        new_x = rover.x + rover.vx * dt
        new_z = rover.z + rover.vz * dt

        # Boundary clamping (keep within crater)
        if self.terrain.is_within_bounds(new_x, new_z):
            rover.x = new_x
            rover.z = new_z
        else:
            # Bounce off crater boundary
            rover.vx *= -0.3
            rover.vz *= -0.3

        # Reset applied forces (one-shot)
        rover.force_x = 0.0
        rover.force_z = 0.0

    def _update_rover_shadow(self, rover: RoverState):
        """Check if rover is in the shadow zone."""
        rover.in_shadow = rover.x < self.shadow.boundary_x

    def _drain_resources(self, rover: RoverState, dt: float):
        """Drain battery and sensors based on conditions."""
        drain = NORMAL_DRAIN_RATE * dt

        if rover.in_shadow:
            drain *= SHADOW_BATTERY_DRAIN_MULTIPLIER
            rover.sensor_health = max(0, rover.sensor_health - SENSOR_SHADOW_DAMAGE_RATE * dt)

        # Movement cost: proportional to speed
        speed = math.sqrt(rover.vx**2 + rover.vz**2)
        drain += speed * 0.02 * dt

        rover.battery = max(0, rover.battery - drain)

    def _check_disable(self, rover: RoverState):
        """Disable rover if battery is depleted."""
        if rover.battery <= 0:
            rover.is_disabled = True
            rover.task = "DISABLED"
            rover.vx = 0
            rover.vz = 0
            rover.target_x = None
            rover.target_z = None

    def _get_state(self) -> dict:
        """Return full simulation state snapshot."""
        return {
            "rovers": {rid: r.to_dict() for rid, r in self.rovers.items()},
            "shadow_boundary_x": round(self.shadow.boundary_x, 2),
            "sim_time": round(self.sim_time, 2),
            "tick": self.tick_count,
            "mission_active": self.mission_active,
        }

    # ---- Agent Interface ----

    def set_rover_target(self, rover_id: str, target_x: float, target_z: float) -> bool:
        """Set a navigation target for a rover. Returns False if rover is disabled."""
        rover = self.rovers.get(rover_id)
        if not rover or rover.is_disabled:
            return False
        rover.target_x = target_x
        rover.target_z = target_z
        return True

    def get_rover_state(self, rover_id: str) -> dict | None:
        """Get state of a specific rover."""
        rover = self.rovers.get(rover_id)
        return rover.to_dict() if rover else None

    def get_distance(self, rover_a: str, rover_b: str) -> float:
        """Get distance between two rovers."""
        a = self.rovers.get(rover_a)
        b = self.rovers.get(rover_b)
        if not a or not b:
            return float('inf')
        return math.sqrt((a.x - b.x)**2 + (a.z - b.z)**2)

    def get_terrain_info(self, x: float, z: float) -> dict:
        """Get terrain info at a point."""
        return {
            "height": round(float(self.terrain.get_height(x, z)), 2),
            "slope_deg": round(float(math.degrees(self.terrain.get_slope_angle(x, z))), 1),
            "in_shadow": bool(x < self.shadow.boundary_x),
            "within_bounds": bool(self.terrain.is_within_bounds(x, z)),
        }


if __name__ == "__main__":
    print("Initializing physics engine...")
    engine = PhysicsEngine()
    engine.start_mission()

    # Run 300 ticks (10 seconds)
    for i in range(300):
        state = engine.tick()
        if i % 30 == 0:  # print every second
            print(f"\n--- t={state['sim_time']:.1f}s | shadow_x={state['shadow_boundary_x']:.1f} ---")
            for rid, rs in state['rovers'].items():
                print(f"  {rid}: pos=({rs['x']:.1f},{rs['z']:.1f}) bat={rs['battery']:.1f}% shadow={rs['in_shadow']}")

    print("\nPhysics test complete.")
