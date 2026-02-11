"""WebSocket handler for real-time game communication."""

from __future__ import annotations

import json
import uuid
import asyncio
from typing import Optional

from fastapi import WebSocket

from .models import Card, Game, GamePhase, Rank, Suit
from .game_logic import (
    advance_to_next_round,
    get_bidding_order,
    get_forbidden_bid,
    get_game_results,
    get_valid_cards,
    place_bid,
    play_card,
    score_round,
    start_new_round,
    validate_bid,
    validate_play,
)
from .room_manager import RoomManager


class ConnectionManager:
    """Manages WebSocket connections and message routing."""

    def __init__(self) -> None:
        self.room_manager = RoomManager()
        # player_id -> WebSocket
        self.connections: dict[str, WebSocket] = {}

    async def send_to_player(self, player_id: str, message: dict) -> None:
        """Send a message to a specific player."""
        ws = self.connections.get(player_id)
        if ws:
            try:
                await ws.send_json(message)
            except Exception:
                pass

    async def broadcast_to_room(
        self, game: Game, message: dict, exclude: str | None = None
    ) -> None:
        """Send a message to all players in a room."""
        for player in game.players:
            if player.id != exclude:
                await self.send_to_player(player.id, message)

    async def handle_connect(self, websocket: WebSocket) -> str:
        """Accept a new WebSocket connection and assign a player ID."""
        await websocket.accept()
        player_id = str(uuid.uuid4())
        self.connections[player_id] = websocket
        await self.send_to_player(
            player_id,
            {
                "type": "connected",
                "player_id": player_id,
            },
        )
        return player_id

    async def handle_disconnect(self, player_id: str) -> None:
        """Handle player disconnection."""
        self.connections.pop(player_id, None)
        game = self.room_manager.get_player_room(player_id)

        if game and game.phase == GamePhase.WAITING:
            # Only remove player if game hasn't started yet
            game = self.room_manager.remove_player(player_id)
            if game:
                await self.broadcast_to_room(
                    game,
                    {
                        "type": "player_left",
                        "player_id": player_id,
                        "players": [p.to_dict(hide_hand=True) for p in game.players],
                        "host_id": game.host_id,
                        "new_host_id": game.host_id,
                    },
                )
        # If game is in progress, keep the player in the game
        # They can reconnect via join_room with the same name

    async def handle_message(self, player_id: str, data: dict) -> None:
        """Route incoming messages to appropriate handlers."""
        msg_type = data.get("type", "")

        handlers = {
            "create_room": self._handle_create_room,
            "join_room": self._handle_join_room,
            "start_game": self._handle_start_game,
            "place_bid": self._handle_place_bid,
            "play_card": self._handle_play_card,
            "next_round": self._handle_next_round,
        }

        handler = handlers.get(msg_type)
        if handler:
            await handler(player_id, data)
        else:
            await self.send_to_player(
                player_id,
                {
                    "type": "error",
                    "message": f"Unknown message type: {msg_type}",
                },
            )

    # ---- Room Management ----

    async def _handle_create_room(self, player_id: str, data: dict) -> None:
        player_name = data.get("player_name", "").strip()
        if not player_name:
            await self.send_to_player(
                player_id,
                {
                    "type": "error",
                    "message": "Player name is required",
                },
            )
            return

        game = self.room_manager.create_room(player_id, player_name)
        await self.send_to_player(
            player_id,
            {
                "type": "room_created",
                "room_code": game.room_code,
                "game": game.to_dict(),
                "players": [p.to_dict(hide_hand=True) for p in game.players],
            },
        )

    async def _handle_join_room(self, player_id: str, data: dict) -> None:
        player_name = data.get("player_name", "").strip()
        room_code = data.get("room_code", "").strip()

        if not player_name or not room_code:
            await self.send_to_player(
                player_id,
                {
                    "type": "error",
                    "message": "Player name and room code are required",
                },
            )
            return

        game, error, old_player_id = self.room_manager.join_room(
            room_code, player_id, player_name
        )
        if game is None:
            await self.send_to_player(
                player_id,
                {
                    "type": "error",
                    "message": error,
                },
            )
            return

        # If reconnecting, remove old connection mapping
        if old_player_id:
            self.connections.pop(old_player_id, None)

        # Send initial room joined message
        await self.send_to_player(
            player_id,
            {
                "type": "room_joined",
                "room_code": game.room_code,
                "game": game.to_dict(),
                "players": [p.to_dict(hide_hand=True) for p in game.players],
                "reconnected": old_player_id is not None,
            },
        )

        # Notify others
        await self.broadcast_to_room(
            game,
            {
                "type": "player_joined",
                "players": [p.to_dict(hide_hand=True) for p in game.players],
                "host_id": game.host_id,
            },
            exclude=player_id,
        )

        # If game is in progress, send current state immediately
        if game.phase != GamePhase.WAITING:
            player = game.get_player_by_id(player_id)
            # Reconnecting during round result: send round_result so host sees Next Round, etc.
            if game.phase == GamePhase.ROUND_RESULT and game.scores_history:
                last_round = game.scores_history[-1]
                await self.send_to_player(
                    player_id,
                    {
                        "type": "round_result",
                        "results": last_round["results"],
                        "scores_history": game.scores_history,
                        "game": game.to_dict(),
                    },
                )
                return
            if game.current_round and player:
                hand = [c.to_dict() for c in player.hand]

                # Send round start (contains hand and round metadata)
                await self.send_to_player(
                    player_id,
                    {
                        "type": "round_start",
                        "game": game.to_dict(),
                        "players": [p.to_dict(hide_hand=True) for p in game.players],
                        "hand": hand,
                        "round_number": game.current_round_index + 1,
                        "total_rounds": len(game.round_sequence),
                        "num_cards": game.current_round.num_cards,
                        "trump_suit": game.current_round.trump_suit.value,
                        "trump_symbol": game.current_round.to_dict()["trump_symbol"],
                    },
                )

                # If it's bidding phase, send bid request/status
                if game.phase == GamePhase.BIDDING:
                    await self._send_bid_request(game)
                # If it's playing phase, send play request/status
                elif game.phase == GamePhase.PLAYING:
                    # Also send current trick if any
                    current_trick = game.current_round.current_trick
                    if current_trick:
                        # We need to replay the trick cards for this player
                        for pid, card in current_trick.cards_played:
                            p_name = game.get_player_by_id(pid).name
                            await self.send_to_player(
                                player_id,
                                {
                                    "type": "card_played",
                                    "player_id": pid,
                                    "player_name": p_name,
                                    "card": card.to_dict(),
                                    "trick": current_trick.to_dict(),
                                    "game": game.to_dict(),
                                },
                            )
                    await self._send_play_request(game)

    # ---- Game Flow ----

    async def _handle_start_game(self, player_id: str, data: dict) -> None:
        game = self.room_manager.get_player_room(player_id)
        if not game:
            await self.send_to_player(
                player_id, {"type": "error", "message": "Not in a room"}
            )
            return

        if game.host_id != player_id:
            await self.send_to_player(
                player_id,
                {"type": "error", "message": "Only the host can start the game"},
            )
            return

        if len(game.players) < 4:
            await self.send_to_player(
                player_id,
                {"type": "error", "message": "Need at least 4 players to start"},
            )
            return

        # Build round sequence
        game.build_round_sequence()

        # Start the first round immediately
        start_new_round(game)

        # Notify all players that game started (so they redirect)
        await self.broadcast_to_room(
            game,
            {
                "type": "game_started",
                "room_code": game.room_code,
            },
        )

        # Send round start to everyone
        # (Players will receive this if they are already connected or when they rejoin)
        await self._send_round_start(game)

    async def _send_round_start(self, game: Game) -> None:
        """Send round start info to all players."""
        assert game.current_round is not None

        for player in game.players:
            await self.send_to_player(
                player.id,
                {
                    "type": "round_start",
                    "game": game.to_dict(),
                    "players": [p.to_dict(hide_hand=True) for p in game.players],
                    "hand": [c.to_dict() for c in player.hand],
                    "round_number": game.current_round_index + 1,
                    "total_rounds": len(game.round_sequence),
                    "num_cards": game.current_round.num_cards,
                    "trump_suit": game.current_round.trump_suit.value,
                    "trump_symbol": game.current_round.to_dict()["trump_symbol"],
                },
            )

        # Send bid request to first bidder
        await self._send_bid_request(game)

    async def _send_bid_request(self, game: Game) -> None:
        """Notify the current bidder that it's their turn."""
        assert game.current_round is not None

        bidding_order = get_bidding_order(game)
        current_bidder_pos = game.current_round.current_bidder_index

        if current_bidder_pos >= len(game.players):
            return  # All bids placed

        current_bidder_index = bidding_order[current_bidder_pos]
        current_bidder = game.players[current_bidder_index]
        forbidden = get_forbidden_bid(game)

        # Tell everyone whose turn it is
        await self.broadcast_to_room(
            game,
            {
                "type": "bid_turn",
                "current_bidder_id": current_bidder.id,
                "current_bidder_name": current_bidder.name,
                "bids_so_far": game.current_round.bids,
                "forbidden_bid": forbidden,
                "num_cards": game.current_round.num_cards,
            },
        )

    async def _handle_place_bid(self, player_id: str, data: dict) -> None:
        game = self.room_manager.get_player_room(player_id)
        if not game:
            await self.send_to_player(
                player_id, {"type": "error", "message": "Not in a room"}
            )
            return

        bid = data.get("bid")
        if bid is None:
            await self.send_to_player(
                player_id, {"type": "error", "message": "Bid value required"}
            )
            return

        bid = int(bid)
        error = validate_bid(game, player_id, bid)
        if error:
            await self.send_to_player(player_id, {"type": "error", "message": error})
            return

        place_bid(game, player_id, bid)

        player = game.get_player_by_id(player_id)
        player_name = player.name if player else "Unknown"

        # Notify everyone of the bid
        await self.broadcast_to_room(
            game,
            {
                "type": "bid_placed",
                "player_id": player_id,
                "player_name": player_name,
                "bid": bid,
                "bids": game.current_round.bids if game.current_round else {},
            },
        )

        # If still bidding, request next bid
        if game.phase == GamePhase.BIDDING:
            await self._send_bid_request(game)
        elif game.phase == GamePhase.PLAYING:
            # All bids placed, start playing
            await self._send_play_request(game)

    async def _send_play_request(self, game: Game) -> None:
        """Notify the current player to play a card."""
        current_player = game.players[game.current_turn_index]
        valid_cards = get_valid_cards(game, current_player.id)

        # Tell everyone whose turn it is
        await self.broadcast_to_room(
            game,
            {
                "type": "play_turn",
                "current_player_id": current_player.id,
                "current_player_name": current_player.name,
                "trick": game.current_round.current_trick.to_dict()
                if game.current_round and game.current_round.current_trick
                else None,
                "game": game.to_dict(),
            },
        )

        # Send valid cards only to the active player
        await self.send_to_player(
            current_player.id,
            {
                "type": "play_request",
                "valid_cards": [c.to_dict() for c in valid_cards],
                "hand": [c.to_dict() for c in current_player.hand],
            },
        )

    async def _handle_play_card(self, player_id: str, data: dict) -> None:
        game = self.room_manager.get_player_room(player_id)
        if not game:
            await self.send_to_player(
                player_id, {"type": "error", "message": "Not in a room"}
            )
            return

        suit_str = data.get("suit", "")
        rank_val = data.get("rank")

        try:
            suit = Suit(suit_str)
            rank = Rank(int(rank_val))  # type: ignore[arg-type]
        except (ValueError, TypeError):
            await self.send_to_player(
                player_id, {"type": "error", "message": "Invalid card"}
            )
            return

        card = Card(suit=suit, rank=rank)
        error = validate_play(game, player_id, card)
        if error:
            await self.send_to_player(player_id, {"type": "error", "message": error})
            return

        player = game.get_player_by_id(player_id)
        player_name = player.name if player else "Unknown"

        # Save reference to current trick BEFORE play_card mutates state
        # (resolve_trick creates a new current_trick if round isn't over)
        current_trick = game.current_round.current_trick if game.current_round else None

        result = play_card(game, player_id, card)

        # Notify everyone of the played card (use saved trick reference)
        await self.broadcast_to_room(
            game,
            {
                "type": "card_played",
                "player_id": player_id,
                "player_name": player_name,
                "card": card.to_dict(),
                "trick": current_trick.to_dict() if current_trick else None,
                "game": game.to_dict(),
            },
        )

        if result:
            # Trick is complete
            await asyncio.sleep(1.0)  # Brief pause so players can see all cards

            await self.broadcast_to_room(
                game,
                {
                    "type": "trick_result",
                    "winner_id": result["winner_id"],
                    "winner_name": result["winner_name"],
                    "winning_card": result["winning_card"],
                    "trick": result["trick"],
                    "game": game.to_dict(),
                },
            )

            if result.get("round_over"):
                # Score the round
                await asyncio.sleep(1.0)
                round_results = score_round(game)

                # Check if this is the last round (don't advance yet)
                is_last_round = game.current_round_index + 1 >= len(game.round_sequence)

                if is_last_round:
                    # Game over - send round result then game over
                    game.phase = GamePhase.GAME_OVER
                    await self.broadcast_to_room(
                        game,
                        {
                            "type": "round_result",
                            "results": round_results,
                            "scores_history": game.scores_history,
                            "game": game.to_dict(),
                        },
                    )
                    await asyncio.sleep(1.5)
                    final_results = get_game_results(game)
                    await self.broadcast_to_room(
                        game,
                        {
                            "type": "game_over",
                            "results": final_results,
                            "game": game.to_dict(),
                        },
                    )
                else:
                    # More rounds to play - show result, host will trigger next round
                    game.phase = GamePhase.ROUND_RESULT
                    await self.broadcast_to_room(
                        game,
                        {
                            "type": "round_result",
                            "results": round_results,
                            "scores_history": game.scores_history,
                            "game": game.to_dict(),
                        },
                    )
            else:
                # Next trick
                await asyncio.sleep(0.5)
                await self._send_play_request(game)
        else:
            # Trick still in progress, next player
            await self._send_play_request(game)

    async def _handle_next_round(self, player_id: str, data: dict) -> None:
        """Host triggers the next round after reviewing results."""
        game = self.room_manager.get_player_room(player_id)
        if not game:
            await self.send_to_player(
                player_id, {"type": "error", "message": "Not in a room"}
            )
            return

        if game.phase == GamePhase.GAME_OVER:
            await self.send_to_player(
                player_id, {"type": "error", "message": "Game is already over"}
            )
            return

        if game.phase != GamePhase.ROUND_RESULT:
            await self.send_to_player(
                player_id, {"type": "error", "message": "Not ready for next round"}
            )
            return

        if game.host_id != player_id:
            await self.send_to_player(
                player_id,
                {"type": "error", "message": "Only the host can start the next round"},
            )
            return

        # Advance to next round (increments index and dealer)
        has_next = advance_to_next_round(game)

        if not has_next:
            # Safety check - should not happen if logic is correct
            await self.send_to_player(
                player_id, {"type": "error", "message": "No more rounds available"}
            )
            return

        start_new_round(game)
        await self._send_round_start(game)
