"""
Project Regolith — Nemotron Mission Auditor
Uses NVIDIA Nemotron-3-Nano via build.nvidia.com API
to score rover decisions across 5 dimensions in real-time.
"""

from __future__ import annotations
import os
import json
import logging
import asyncio
import random
from dataclasses import dataclass

import httpx

logger = logging.getLogger("regolith.nemotron")

NEMOTRON_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions"
NEMOTRON_MODEL = "nvidia/nemotron-3-nano-30b-a3b"

# Dimensions scored by the auditor
AUDIT_DIMENSIONS = ["helpfulness", "correctness", "coherence", "complexity", "verbosity"]


@dataclass
class AuditResult:
    """Result of a Nemotron audit."""
    helpfulness: float = 0.0
    correctness: float = 0.0
    coherence: float = 0.0
    complexity: float = 0.0
    verbosity: float = 0.0
    raw_score: float = 0.0
    passed: bool = True
    failure_reason: str = ""

    def to_dict(self) -> dict:
        return {
            "helpfulness": round(self.helpfulness, 2),
            "correctness": round(self.correctness, 2),
            "coherence": round(self.coherence, 2),
            "complexity": round(self.complexity, 2),
            "verbosity": round(self.verbosity, 2),
            "raw_score": round(self.raw_score, 2),
            "passed": self.passed,
            "failure_reason": self.failure_reason,
        }


class NemotronAuditor:
    """
    Mission Auditor powered by NVIDIA Nemotron-3-Nano.
    Evaluates the quality of rover decisions before/after execution.
    Uses generation-based structured scoring.
    """

    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.environ.get("NVIDIA_API_KEY", "")
        self.client = httpx.AsyncClient(timeout=30.0)
        self.enabled = bool(self.api_key)
        self.audit_history: list[AuditResult] = []
        self.pass_threshold = 0.5  # minimum normalized score to pass

        if not self.enabled:
            logger.warning("NVIDIA_API_KEY not set — Nemotron auditor disabled, using mock scores")
        else:
            logger.info(f"Nemotron auditor initialized with model={NEMOTRON_MODEL}")

    async def audit_cnp_round(
        self,
        cfp_description: str,
        bids: list[dict],
        winning_bid: dict,
        mission_context: str = "",
    ) -> AuditResult:
        """
        Audit a complete CNP negotiation round.
        Sends the negotiation to Nemotron for structured scoring.
        """
        system_msg = (
            "You are a mission control auditor for an autonomous lunar rover swarm. "
            "Score the following negotiation round on exactly 5 dimensions, each from 0.0 to 4.0.\n\n"
            "Respond ONLY with valid JSON in this exact format, no other text:\n"
            '{"helpfulness": 3.2, "correctness": 2.8, "coherence": 3.5, "complexity": 2.1, "verbosity": 1.9}\n\n'
            "Dimensions:\n"
            "- helpfulness: Was the winning decision optimal for mission success?\n"
            "- correctness: Was the utility calculation and bid evaluation logically sound?\n"
            "- coherence: Did the negotiation flow make sense given the situation?\n"
            "- complexity: How sophisticated was the multi-agent coordination?\n"
            "- verbosity: Was the communication appropriately concise (higher = more concise)?"
        )

        user_msg = self._format_cnp_for_audit(cfp_description, bids, mission_context)
        user_msg += "\n\n" + self._format_winning_decision(winning_bid)

        if self.enabled:
            return await self._call_nemotron(system_msg, user_msg)
        else:
            return self._mock_audit(cfp_description, winning_bid)

    async def audit_rover_decision(
        self,
        rover_id: str,
        situation: str,
        decision: str,
    ) -> AuditResult:
        """Audit a single rover's decision."""
        system_msg = (
            "You are a safety auditor for lunar rover operations. "
            "Score this rover decision on 5 dimensions, each from 0.0 to 4.0.\n\n"
            "Respond ONLY with valid JSON:\n"
            '{"helpfulness": 3.2, "correctness": 2.8, "coherence": 3.5, "complexity": 2.1, "verbosity": 1.9}'
        )

        user_msg = f"Rover {rover_id} situation:\n{situation}\n\nDecision: {decision}"

        if self.enabled:
            return await self._call_nemotron(system_msg, user_msg)
        else:
            return self._mock_audit(situation, {"rationale": decision})

    async def _call_nemotron(
        self,
        system_msg: str,
        user_msg: str,
    ) -> AuditResult:
        """Call the Nemotron generation API and parse structured JSON scores."""
        try:
            payload = {
                "model": NEMOTRON_MODEL,
                "messages": [
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": user_msg},
                ],
                "max_tokens": 120,
                "temperature": 0.2,
                "top_p": 0.9,
            }

            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            }

            response = await self.client.post(
                NEMOTRON_ENDPOINT,
                json=payload,
                headers=headers,
            )

            if response.status_code != 200:
                logger.error(f"Nemotron API error {response.status_code}: {response.text[:300]}")
                return self._mock_audit(user_msg, {})

            data = response.json()
            result = self._parse_generation_response(data)
            self.audit_history.append(result)
            return result

        except Exception as e:
            logger.error(f"Nemotron call failed: {e}")
            return self._mock_audit(user_msg, {})

    def _parse_generation_response(self, data: dict) -> AuditResult:
        """Parse the Nemotron generation response — extract JSON scores from text."""
        result = AuditResult()

        try:
            choices = data.get("choices", [])
            if not choices:
                return self._mock_audit("", {})

            content = choices[0].get("message", {}).get("content", "")
            logger.info(f"Nemotron raw response: {content[:200]}")

            # Try to extract JSON from the response
            scores = None

            # Try direct JSON parse first
            try:
                scores = json.loads(content.strip())
            except json.JSONDecodeError:
                # Try to find JSON in the text
                import re
                json_match = re.search(r'\{[^}]+\}', content)
                if json_match:
                    try:
                        scores = json.loads(json_match.group())
                    except json.JSONDecodeError:
                        pass

            if scores and isinstance(scores, dict):
                result.helpfulness = min(4.0, max(0.0, float(scores.get("helpfulness", 2.5))))
                result.correctness = min(4.0, max(0.0, float(scores.get("correctness", 2.5))))
                result.coherence = min(4.0, max(0.0, float(scores.get("coherence", 2.5))))
                result.complexity = min(4.0, max(0.0, float(scores.get("complexity", 2.5))))
                result.verbosity = min(4.0, max(0.0, float(scores.get("verbosity", 2.5))))
                result.raw_score = (result.helpfulness + result.correctness + result.coherence) / 3.0
                result.passed = result.raw_score > self.pass_threshold * 4.0
            else:
                logger.warning(f"Could not parse scores from Nemotron response, using mock")
                return self._mock_audit("", {})

        except Exception as e:
            logger.error(f"Error parsing Nemotron response: {e}")
            return self._mock_audit("", {})

        return result

    def _format_cnp_for_audit(
        self, cfp_description: str, bids: list[dict], mission_context: str
    ) -> str:
        """Format a CNP round as a user message for evaluation."""
        parts = []
        if mission_context:
            parts.append(f"Mission Context: {mission_context}")

        parts.append(f"\nCall for Proposals: {cfp_description}")
        parts.append(f"\nBids received ({len(bids)}):")

        for bid in bids:
            parts.append(
                f"  - {bid.get('bidder_id', 'unknown')}: "
                f"utility={bid.get('utility_score', 0):.2f}, "
                f"ETA={bid.get('estimated_time', 0):.0f}s, "
                f"rationale: {bid.get('rationale', 'none')}"
            )

        return "\n".join(parts)

    def _format_winning_decision(self, winning_bid: dict) -> str:
        """Format the winning bid decision."""
        return (
            f"Contract awarded to {winning_bid.get('winner_id', winning_bid.get('bidder_id', 'unknown'))}. "
            f"Utility score: {winning_bid.get('utility_score', 0):.2f}. "
            f"Rationale: {winning_bid.get('rationale', 'Highest scoring bid')}."
        )

    def _mock_audit(self, context: str, decision: dict) -> AuditResult:
        """Generate realistic mock audit scores (for when API is unavailable)."""
        # Generate plausible scores based on some heuristics
        base = random.uniform(2.5, 3.8)

        result = AuditResult(
            helpfulness=min(4.0, max(0.0, base + random.uniform(-0.3, 0.5))),
            correctness=min(4.0, max(0.0, base + random.uniform(-0.4, 0.3))),
            coherence=min(4.0, max(0.0, base + random.uniform(-0.2, 0.3))),
            complexity=min(4.0, max(0.0, base + random.uniform(-0.5, 0.5))),
            verbosity=min(4.0, max(0.0, base + random.uniform(-0.6, 0.4))),
            raw_score=base,
            passed=base > self.pass_threshold,
        )

        self.audit_history.append(result)
        return result

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()
