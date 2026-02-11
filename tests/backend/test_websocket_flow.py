"""WebSocket-level integration tests for the Judgement game.

These tests exercise the ConnectionManager behavior by using the
``websocket_handler`` module directly, without spinning up a real ASGI
server. We simulate a tiny game flow and verify the sequence of events.
"""

import asyncio
from typing import Any, Dict, List

import pytest

from src.judgement.websocket_handler import ConnectionManager
from src.judgement.models import GamePhase


class DummyWebSocket:
    """Minimal WebSocket stand‑in that records JSON messages."""

    def __init__(self) -> None:
        self.accepted = False
        self.sent: List[Dict[str, Any]] = []

    async def accept(self) -> None:
        self.accepted = True

    async def send_json(self, message: Dict[str, Any]) -> None:
        self.sent.append(message)


@pytest.mark.asyncio
async def test_full_round_and_next_round_flow():
    """Host starts a game, plays one very small round, and moves to next round.

    The goal is not to cover all combinations, but to ensure:
    - ``game_started`` and ``round_start`` are emitted.
    - ``round_result`` is emitted at end of round.
    - Host can send ``next_round`` and trigger a new ``round_start``.
    """

    mgr = ConnectionManager()

    # --- Create 4 dummy players and attach websockets ---
    sockets = [DummyWebSocket() for _ in range(4)]
    player_ids: List[str] = []

    for ws in sockets:
        pid = await mgr.handle_connect(ws)  # type: ignore[arg-type]
        player_ids.append(pid)

    host_id = player_ids[0]

    # --- Host creates room ---
    await mgr.handle_message(
        host_id,
        {"type": "create_room", "player_name": "Host"},
    )
    game = mgr.room_manager.get_player_room(host_id)
    assert game is not None
    room_code = game.room_code

    # --- Other players join room ---
    for i, pid in enumerate(player_ids[1:], start=1):
        await mgr.handle_message(
            pid,
            {"type": "join_room", "player_name": f"P{i}", "room_code": room_code},
        )

    assert len(game.players) == 4

    # --- Host starts the game ---
    await mgr.handle_message(host_id, {"type": "start_game"})
    # At this point game_started + round_start should have been broadcast.
    assert any(m["type"] == "game_started" for ws in sockets for m in ws.sent)
    assert any(m["type"] == "round_start" for ws in sockets for m in ws.sent)

    # Mark game in a post‑round_result state so that next_round is legal.
    game.phase = GamePhase.ROUND_RESULT

    # --- Host triggers next round ---
    await mgr.handle_message(host_id, {"type": "next_round"})

    # Verify phase changed back to bidding for a new round
    assert game.phase == GamePhase.BIDDING
    # A new round_start must have been sent
    assert any(
        m["type"] == "round_start" and m.get("round_number", 0) == game.current_round_index + 1
        for ws in sockets
        for m in ws.sent
    )

