"""Room management for multiplayer game sessions."""

from __future__ import annotations

import random
import string
from typing import Optional

from .models import Game, GamePhase, Player


class RoomManager:
    """Manages game rooms: creation, joining, and cleanup."""

    def __init__(self) -> None:
        self.rooms: dict[str, Game] = {}
        # Map player_id -> room_code for quick lookup
        self.player_rooms: dict[str, str] = {}

    def _generate_code(self, length: int = 6) -> str:
        """Generate a unique room code."""
        while True:
            code = "".join(
                random.choices(string.ascii_uppercase + string.digits, k=length)
            )
            if code not in self.rooms:
                return code

    def create_room(self, player_id: str, player_name: str) -> Game:
        """Create a new room and add the host player."""
        code = self._generate_code()
        game = Game(room_code=code, host_id=player_id)
        player = Player(id=player_id, name=player_name)
        game.players.append(player)
        self.rooms[code] = game
        self.player_rooms[player_id] = code
        return game

    def join_room(
        self, room_code: str, player_id: str, player_name: str
    ) -> tuple[Optional[Game], str, Optional[str]]:
        """Join an existing room.

        Returns (game, error_message, old_player_id).
        Game is None on error. old_player_id is set if reconnecting.
        """
        room_code = room_code.upper()

        if room_code not in self.rooms:
            return None, "Room not found", None

        game = self.rooms[room_code]

        # Check if player is already in the room by ID
        if any(p.id == player_id for p in game.players):
            return game, "", None

        # If game is in progress, allow reconnection by name
        if game.phase != GamePhase.WAITING:
            existing = next((p for p in game.players if p.name == player_name), None)
            if existing:
                old_id = existing.id
                existing.id = player_id
                # Update host_id if needed
                if game.host_id == old_id:
                    game.host_id = player_id
                # Update bids dict key if needed
                if game.current_round and old_id in game.current_round.bids:
                    game.current_round.bids[player_id] = game.current_round.bids.pop(
                        old_id
                    )
                # Update current trick references if needed
                if game.current_round and game.current_round.current_trick:
                    trick = game.current_round.current_trick
                    if trick.lead_player_id == old_id:
                        trick.lead_player_id = player_id
                    trick.cards_played = [
                        (player_id if pid == old_id else pid, card)
                        for pid, card in trick.cards_played
                    ]
                # Update player_rooms mapping
                self.player_rooms.pop(old_id, None)
                self.player_rooms[player_id] = room_code
                return game, "", old_id
            return None, "Game already in progress", None

        if len(game.players) >= 6:
            return None, "Room is full (max 6 players)", None

        # Check for duplicate names
        if any(p.name == player_name for p in game.players):
            return None, f"Name '{player_name}' is already taken in this room", None

        player = Player(id=player_id, name=player_name)
        game.players.append(player)
        self.player_rooms[player_id] = room_code
        return game, "", None

    def get_room(self, room_code: str) -> Optional[Game]:
        """Get a room by its code."""
        return self.rooms.get(room_code.upper())

    def get_player_room(self, player_id: str) -> Optional[Game]:
        """Get the room a player is in."""
        code = self.player_rooms.get(player_id)
        if code:
            return self.rooms.get(code)
        return None

    def remove_player(self, player_id: str) -> Optional[Game]:
        """Remove a player from their room.

        Returns the game if it still has players, None if room was deleted.
        """
        code = self.player_rooms.pop(player_id, None)
        if code is None:
            return None

        game = self.rooms.get(code)
        if game is None:
            return None

        game.players = [p for p in game.players if p.id != player_id]

        if not game.players:
            # Room is empty, clean up
            del self.rooms[code]
            return None

        # Transfer host if needed
        if game.host_id == player_id:
            game.host_id = game.players[0].id

        return game

    def list_rooms(self) -> list[dict]:
        """List all active rooms (for debugging)."""
        return [
            {
                "room_code": game.room_code,
                "host_id": game.host_id,
                "player_count": len(game.players),
                "phase": game.phase.value,
            }
            for game in self.rooms.values()
        ]
