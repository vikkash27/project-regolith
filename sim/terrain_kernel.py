"""
Project Regolith — Crater Terrain Generator
Procedural Shackleton-style crater heightmap.
Runs on CPU with NumPy. No GPU required.
"""

import numpy as np
from dataclasses import dataclass


@dataclass
class CraterConfig:
    diameter_m: float = 500.0
    depth_m: float = 80.0
    grid_resolution: int = 256
    rim_height_m: float = 12.0
    noise_octaves: int = 4
    seed: int = 42


class CraterTerrain:
    """Procedural lunar crater terrain with heightmap and query functions."""

    def __init__(self, config: CraterConfig = None):
        self.config = config or CraterConfig()
        self.radius = self.config.diameter_m / 2.0
        self.heightmap: np.ndarray | None = None
        self._generate()

    def _generate(self):
        """Generate the crater heightmap as a 2D numpy array."""
        res = self.config.grid_resolution
        rng = np.random.default_rng(self.config.seed)

        # Coordinate grids: world space from -radius to +radius
        x = np.linspace(-self.radius, self.radius, res)
        z = np.linspace(-self.radius, self.radius, res)
        X, Z = np.meshgrid(x, z)
        R = np.sqrt(X**2 + Z**2)

        # Main bowl: Gaussian depression
        sigma = self.radius * 0.45
        H = -self.config.depth_m * np.exp(-(R**2) / (2 * sigma**2))

        # Rim uplift: ring-shaped Gaussian
        rim_sigma = self.radius * 0.15
        rim_center = self.radius * 0.85
        H += self.config.rim_height_m * np.exp(
            -((R - rim_center) ** 2) / (2 * rim_sigma**2)
        )

        # Multi-octave sinusoidal noise for surface roughness
        for octave in range(self.config.noise_octaves):
            freq = 0.05 * (2 ** octave)
            amp = 2.0 / (2 ** octave)
            phase_x = rng.uniform(0, 2 * np.pi)
            phase_z = rng.uniform(0, 2 * np.pi)
            H += amp * np.sin(X * freq + phase_x) * np.cos(Z * freq + phase_z)

        # Scattered boulders: localized Gaussian bumps
        n_boulders = 8
        for _ in range(n_boulders):
            bx = rng.uniform(-self.radius * 0.7, self.radius * 0.7)
            bz = rng.uniform(-self.radius * 0.7, self.radius * 0.7)
            br = rng.uniform(5, 15)
            bh = rng.uniform(2, 7)
            DR = np.sqrt((X - bx) ** 2 + (Z - bz) ** 2)
            H += bh * np.exp(-(DR**2) / (2 * br**2))

        self.heightmap = H
        self._x = x
        self._z = z

    def get_height(self, x: float, z: float) -> float:
        """Bilinear interpolation of height at world coordinates (x, z)."""
        res = self.config.grid_resolution
        # Map world coords to grid indices
        ix = (x + self.radius) / (2 * self.radius) * (res - 1)
        iz = (z + self.radius) / (2 * self.radius) * (res - 1)

        ix = np.clip(ix, 0, res - 2)
        iz = np.clip(iz, 0, res - 2)

        x0, z0 = int(ix), int(iz)
        x1, z1 = x0 + 1, z0 + 1
        fx, fz = ix - x0, iz - z0

        h00 = self.heightmap[z0, x0]
        h10 = self.heightmap[z0, x1]
        h01 = self.heightmap[z1, x0]
        h11 = self.heightmap[z1, x1]

        h = (h00 * (1 - fx) * (1 - fz) +
             h10 * fx * (1 - fz) +
             h01 * (1 - fx) * fz +
             h11 * fx * fz)

        return float(h)

    def get_surface_normal(self, x: float, z: float, eps: float = 1.0) -> tuple:
        """Approximate surface normal at (x, z) via central differences."""
        hx0 = self.get_height(x - eps, z)
        hx1 = self.get_height(x + eps, z)
        hz0 = self.get_height(x, z - eps)
        hz1 = self.get_height(x, z + eps)

        # Normal = cross product of tangent vectors
        nx = (hx0 - hx1) / (2 * eps)
        nz = (hz0 - hz1) / (2 * eps)
        ny = 1.0

        length = np.sqrt(nx**2 + ny**2 + nz**2)
        return (nx / length, ny / length, nz / length)

    def get_slope_angle(self, x: float, z: float) -> float:
        """Return slope angle in radians at (x, z)."""
        _, ny, _ = self.get_surface_normal(x, z)
        return float(np.arccos(np.clip(ny, -1, 1)))

    def is_within_bounds(self, x: float, z: float) -> bool:
        """Check if (x, z) is within crater bounds."""
        return (x**2 + z**2) <= self.radius**2


if __name__ == "__main__":
    terrain = CraterTerrain()
    print(f"Heightmap shape: {terrain.heightmap.shape}")
    print(f"Height at center: {terrain.get_height(0, 0):.2f}m")
    print(f"Height at rim: {terrain.get_height(terrain.radius * 0.85, 0):.2f}m")
    print(f"Slope at center: {np.degrees(terrain.get_slope_angle(0, 0)):.1f}°")
    print(f"Slope at bowl edge: {np.degrees(terrain.get_slope_angle(80, 0)):.1f}°")
