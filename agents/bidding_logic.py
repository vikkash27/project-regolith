"""
Project Regolith — Bidding Logic
Utility function for Contract Net Protocol bid calculation.
U = (w1 × battery) - (w2 × distance) + (w3 × capability_match × 100)
"""

import math


# Weights for the utility function
W_BATTERY = 0.4
W_DISTANCE = 0.3
W_CAPABILITY = 0.3

# Capability matching for task types
TASK_CAPABILITIES = {
    "rescue": ["towing", "heavy_lift", "reinforced_chassis"],
    "escort": ["towing", "reinforced_chassis"],
    "explore": ["long_range_sensors", "terrain_mapping", "high_speed"],
    "repair": ["repair_kit", "advanced_sensors"],
}


def calculate_utility(
    battery: float,
    distance: float,
    rover_capabilities: list[str],
    task_type: str,
    max_distance: float = 500.0,
) -> float:
    """
    Calculate the utility score for a bid.

    Args:
        battery: Current battery percentage (0-100)
        distance: Distance to the task location in meters
        rover_capabilities: List of rover's capabilities
        task_type: Type of task being bid on
        max_distance: Maximum possible distance for normalization

    Returns:
        Utility score (higher is better)
    """
    # Normalize battery to 0-100 range
    battery_score = battery  # already 0-100

    # Normalize distance (invert: closer is better)
    distance_score = max(0, (max_distance - distance) / max_distance) * 100

    # Capability match
    required = TASK_CAPABILITIES.get(task_type, [])
    if required:
        matches = sum(1 for cap in rover_capabilities if cap in required)
        capability_score = (matches / len(required)) * 100
    else:
        capability_score = 50  # neutral if no specific requirements

    # Weighted utility
    utility = (
        W_BATTERY * battery_score +
        W_DISTANCE * distance_score +
        W_CAPABILITY * capability_score
    )

    return round(utility, 3)


def should_bid(battery: float, distance: float, is_in_shadow: bool) -> bool:
    """
    Quick check if a rover should even consider bidding.
    Don't bid if you're in worse shape than the requester.
    """
    if battery < 15:  # critically low, save yourself
        return False
    if is_in_shadow:  # you're also in danger
        return False
    if distance > 400:  # too far to help in time
        return False
    return True


if __name__ == "__main__":
    # Test utility calculations
    print("=== Bidding Logic Tests ===")

    # Beta (rescue specialist) bidding on a rescue task
    u1 = calculate_utility(
        battery=85,
        distance=50,
        rover_capabilities=["towing", "heavy_lift", "reinforced_chassis"],
        task_type="rescue"
    )
    print(f"Beta rescue bid (close, high battery, perfect match): {u1}")

    # Gamma (sensor specialist) bidding on same rescue
    u2 = calculate_utility(
        battery=90,
        distance=120,
        rover_capabilities=["advanced_sensors", "repair_kit", "comms_relay"],
        task_type="rescue"
    )
    print(f"Gamma rescue bid (far, high battery, poor match): {u2}")

    # Should bid checks
    print(f"\nShould bid (85% bat, 50m, not in shadow): {should_bid(85, 50, False)}")
    print(f"Should bid (10% bat, 50m, not in shadow): {should_bid(10, 50, False)}")
    print(f"Should bid (85% bat, 50m, IN shadow): {should_bid(85, 50, True)}")
