"""Data models for the Judgement card game."""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from enum import IntEnum, Enum
from typing import Optional


class Suit(str, Enum):
    SPADES = "spades"
    DIAMONDS = "diamonds"
    CLUBS = "clubs"
    HEARTS = "hearts"


class Rank(IntEnum):
    TWO = 2
    THREE = 3
    FOUR = 4
    FIVE = 5
    SIX = 6
    SEVEN = 7
    EIGHT = 8
    NINE = 9
    TEN = 10
    JACK = 11
    QUEEN = 12
    KING = 13
    ACE = 14


RANK_SYMBOLS = {
    Rank.TWO: "2",
    Rank.THREE: "3",
    Rank.FOUR: "4",
    Rank.FIVE: "5",
    Rank.SIX: "6",
    Rank.SEVEN: "7",
    Rank.EIGHT: "8",
    Rank.NINE: "9",
    Rank.TEN: "10",
    Rank.JACK: "J",
    Rank.QUEEN: "Q",
    Rank.KING: "K",
    Rank.ACE: "A",
}

SUIT_SYMBOLS = {
    Suit.SPADES: "\u2660",
    Suit.DIAMONDS: "\u2666",
    Suit.CLUBS: "\u2663",
    Suit.HEARTS: "\u2665",
}

# Trump rotation order
TRUMP_ORDER = [Suit.SPADES, Suit.DIAMONDS, Suit.CLUBS, Suit.HEARTS]


class GamePhase(str, Enum):
    WAITING = "waiting"
    DEALING = "dealing"
    BIDDING = "bidding"
    PLAYING = "playing"
    ROUND_RESULT = "round_result"
    GAME_OVER = "game_over"


@dataclass
class Card:
    suit: Suit
    rank: Rank

    def to_dict(self) -> dict:
        return {
            "suit": self.suit.value,
            "rank": self.rank.value,
            "display": f"{RANK_SYMBOLS[self.rank]}{SUIT_SYMBOLS[self.suit]}",
            "rank_symbol": RANK_SYMBOLS[self.rank],
            "suit_symbol": SUIT_SYMBOLS[self.suit],
        }

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Card):
            return NotImplemented
        return self.suit == other.suit and self.rank == other.rank

    def __hash__(self) -> int:
        return hash((self.suit, self.rank))


class Deck:
    """Standard 52-card deck with shuffle and deal operations."""

    def __init__(self) -> None:
        self.cards: list[Card] = []
        self.reset()

    def reset(self) -> None:
        self.cards = [Card(suit=suit, rank=rank) for suit in Suit for rank in Rank]

    def shuffle(self) -> None:
        random.shuffle(self.cards)

    def deal(self, num_cards: int) -> list[Card]:
        dealt = self.cards[:num_cards]
        self.cards = self.cards[num_cards:]
        return dealt


@dataclass
class Player:
    id: str
    name: str
    hand: list[Card] = field(default_factory=list)
    bid: Optional[int] = None
    tricks_won: int = 0
    total_score: int = 0

    def reset_for_round(self) -> None:
        self.hand = []
        self.bid = None
        self.tricks_won = 0

    def to_dict(self, hide_hand: bool = False) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "hand": [] if hide_hand else [c.to_dict() for c in self.hand],
            "hand_count": len(self.hand),
            "bid": self.bid,
            "tricks_won": self.tricks_won,
            "total_score": self.total_score,
        }


@dataclass
class Trick:
    lead_player_id: str
    cards_played: list[tuple[str, Card]] = field(default_factory=list)
    winner_id: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "lead_player_id": self.lead_player_id,
            "cards_played": [
                {"player_id": pid, "card": card.to_dict()}
                for pid, card in self.cards_played
            ],
            "winner_id": self.winner_id,
        }


@dataclass
class RoundState:
    round_index: int  # 0-based index into the round sequence
    num_cards: int  # cards dealt this round
    trump_suit: Suit
    dealer_index: int  # index into the player order
    current_bidder_index: int = 0
    bids: dict[str, int] = field(default_factory=dict)
    current_trick: Optional[Trick] = None
    tricks_completed: list[Trick] = field(default_factory=list)
    trick_number: int = 0  # 0-based

    def to_dict(self) -> dict:
        return {
            "round_index": self.round_index,
            "num_cards": self.num_cards,
            "trump_suit": self.trump_suit.value,
            "trump_symbol": SUIT_SYMBOLS[self.trump_suit],
            "dealer_index": self.dealer_index,
            "bids": self.bids,
            "trick_number": self.trick_number,
            "current_trick": self.current_trick.to_dict()
            if self.current_trick
            else None,
        }


@dataclass
class Game:
    room_code: str
    host_id: str
    players: list[Player] = field(default_factory=list)
    phase: GamePhase = GamePhase.WAITING
    round_sequence: list[int] = field(default_factory=list)
    current_round_index: int = 0
    current_round: Optional[RoundState] = None
    dealer_index: int = 0  # rotates each round
    current_turn_index: int = 0  # index into player order for current action
    scores_history: list[dict] = field(default_factory=list)

    def build_round_sequence(self) -> None:
        """Build pyramid round sequence: 1→max→1, capped by deck size."""
        max_cards = 52 // len(self.players)
        peak = min(10, max_cards)
        ascending = list(range(1, peak + 1))
        descending = list(range(peak - 1, 0, -1))
        self.round_sequence = ascending + descending

    def get_player_by_id(self, player_id: str) -> Optional[Player]:
        for p in self.players:
            if p.id == player_id:
                return p
        return None

    def get_player_index(self, player_id: str) -> int:
        for i, p in enumerate(self.players):
            if p.id == player_id:
                return i
        return -1

    def to_dict(self) -> dict:
        return {
            "room_code": self.room_code,
            "host_id": self.host_id,
            "phase": self.phase.value,
            "players": [p.to_dict(hide_hand=True) for p in self.players],
            "current_round_index": self.current_round_index,
            "total_rounds": len(self.round_sequence),
            "current_round": self.current_round.to_dict()
            if self.current_round
            else None,
            "dealer_index": self.dealer_index,
            "current_turn_index": self.current_turn_index,
        }
