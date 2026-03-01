#!/bin/bash
# Project Regolith — Launch Script
# Usage: ./run.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Activate virtual environment
if [ -d ".venv" ]; then
    source .venv/bin/activate
fi

# Check for .env
if [ ! -f ".env" ]; then
    echo "⚠  No .env file found. Copy .env.example to .env and add your API keys."
    echo "   cp .env.example .env"
    echo ""
    echo "   Running with mock Nemotron scores (Anthropic key still required for agents)."
    echo ""
fi

echo "🌙 PROJECT REGOLITH — Autonomous Lunar Swarm Coordination"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Starting server on http://localhost:8000"
echo "Open this URL in your browser to view the dashboard."
echo ""
echo "Press Ctrl+C to stop."
echo ""

python -m uvicorn api.telemetry_ws:app \
    --host 0.0.0.0 \
    --port 8000 \
    --log-level info
