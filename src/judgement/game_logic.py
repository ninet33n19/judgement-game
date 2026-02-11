"""Core game logic for the Judgement card game.

Pure functions and methods for dealing, bidding validation,
trick resolution, and scoring. No I/O or network concerns.
"""

from __future__ import annotations

from .models import (
    Card,
    Deck,
    Game,
    GamePhase,
    Player,
    RoundState,
    Suit,
    Trick,
    TRUMP_ORDER,
)


def start_new_round(game: Game) -> None:
    """Initialize a new round: reset players, deal cards, set trump."""
    num_cards = game.round_sequence[game.current_round_index]
    trump_suit = TRUMP_ORDER[game.current_round_index % 4]

    # Reset each player for the new round
    for player in game.players:
        player.reset_for_round()

    # Create and shuffle deck, deal cards
    deck = Deck()
    deck.shuffle()
    for player in game.players:
        player.hand = deck.deal(num_cards)
        # Sort hand by suit then rank for nicer display
        player.hand.sort(key=lambda c: (list(Suit).index(c.suit), c.rank))

    # Determine bidding order: starts from player left of dealer
    first_bidder_index = (game.dealer_index + 1) % len(game.players)

    game.current_round = RoundState(
        round_index=game.current_round_index,
        num_cards=num_cards,
        trump_suit=trump_suit,
        dealer_index=game.dealer_index,
        current_bidder_index=0,  # tracks position in bidding order
    )
    game.current_turn_index = first_bidder_index
    game.phase = GamePhase.BIDDING


def get_bidding_order(game: Game) -> list[int]:
    """Return player indices in bidding order (left of dealer first, dealer last)."""
    n = len(game.players)
    return [(game.dealer_index + 1 + i) % n for i in range(n)]


def get_forbidden_bid(game: Game) -> int | None:
    """For the dealer (last bidder), calculate the forbidden bid value.

    The dealer cannot bid a value that makes total bids == num_cards.
    Returns None if the current bidder is not the dealer.
    """
    if game.current_round is None:
        return None

    bidding_order = get_bidding_order(game)
    dealer_position = len(game.players) - 1  # dealer bids last

    if game.current_round.current_bidder_index != dealer_position:
        return None

    total_bids_so_far = sum(game.current_round.bids.values())
    forbidden = game.current_round.num_cards - total_bids_so_far

    # Only forbidden if it's a valid bid range (0 to num_cards)
    if 0 <= forbidden <= game.current_round.num_cards:
        return forbidden
    return None


def validate_bid(game: Game, player_id: str, bid: int) -> str | None:
    """Validate a bid. Returns error message or None if valid."""
    if game.phase != GamePhase.BIDDING:
        return "Not in bidding phase"

    if game.current_round is None:
        return "No active round"

    # Check it's this player's turn to bid
    bidding_order = get_bidding_order(game)
    expected_player_index = bidding_order[game.current_round.current_bidder_index]
    if game.players[expected_player_index].id != player_id:
        return "Not your turn to bid"

    # Check bid range
    if bid < 0 or bid > game.current_round.num_cards:
        return f"Bid must be between 0 and {game.current_round.num_cards}"

    # Check dealer restriction
    forbidden = get_forbidden_bid(game)
    if forbidden is not None and bid == forbidden:
        return f"Dealer cannot bid {forbidden} (total bids cannot equal {game.current_round.num_cards})"

    return None


def place_bid(game: Game, player_id: str, bid: int) -> None:
    """Place a bid for the current player."""
    assert game.current_round is not None
    game.current_round.bids[player_id] = bid

    player = game.get_player_by_id(player_id)
    if player:
        player.bid = bid

    game.current_round.current_bidder_index += 1

    # If all players have bid, move to playing phase
    if game.current_round.current_bidder_index >= len(game.players):
        start_first_trick(game)


def start_first_trick(game: Game) -> None:
    """Start the first trick of the round. Lead is left of dealer."""
    assert game.current_round is not None
    lead_index = (game.dealer_index + 1) % len(game.players)
    game.current_turn_index = lead_index
    game.phase = GamePhase.PLAYING

    lead_player = game.players[lead_index]
    game.current_round.current_trick = Trick(lead_player_id=lead_player.id)
    game.current_round.trick_number = 0


def get_valid_cards(game: Game, player_id: str) -> list[Card]:
    """Get the list of valid cards a player can play."""
    if game.current_round is None or game.current_round.current_trick is None:
        return []

    player = game.get_player_by_id(player_id)
    if player is None:
        return []

    trick = game.current_round.current_trick

    # Lead player can play any card
    if not trick.cards_played:
        return list(player.hand)

    # Must follow suit if possible
    led_suit = trick.cards_played[0][1].suit
    suited_cards = [c for c in player.hand if c.suit == led_suit]

    if suited_cards:
        return suited_cards

    # No cards of led suit - can play anything
    return list(player.hand)


def validate_play(game: Game, player_id: str, card: Card) -> str | None:
    """Validate a card play. Returns error message or None if valid."""
    if game.phase != GamePhase.PLAYING:
        return "Not in playing phase"

    if game.current_round is None or game.current_round.current_trick is None:
        return "No active trick"

    # Check it's this player's turn
    current_player = game.players[game.current_turn_index]
    if current_player.id != player_id:
        return "Not your turn"

    player = game.get_player_by_id(player_id)
    if player is None:
        return "Player not found"

    # Check player has this card
    if card not in player.hand:
        return "You don't have that card"

    # Check card is valid (follows suit rules)
    valid_cards = get_valid_cards(game, player_id)
    if card not in valid_cards:
        return "You must follow suit"

    return None


def play_card(game: Game, player_id: str, card: Card) -> dict | None:
    """Play a card in the current trick.

    Returns a result dict if the trick is complete, None otherwise.
    """
    assert game.current_round is not None
    assert game.current_round.current_trick is not None

    player = game.get_player_by_id(player_id)
    assert player is not None

    # Remove card from hand and add to trick
    player.hand.remove(card)
    game.current_round.current_trick.cards_played.append((player_id, card))

    # Move to next player
    game.current_turn_index = (game.current_turn_index + 1) % len(game.players)

    # Check if trick is complete
    if len(game.current_round.current_trick.cards_played) == len(game.players):
        return resolve_trick(game)

    return None


def resolve_trick(game: Game) -> dict:
    """Determine the winner of the current trick.

    Returns a dict with trick result info.
    """
    assert game.current_round is not None
    trick = game.current_round.current_trick
    assert trick is not None

    trump_suit = game.current_round.trump_suit
    led_suit = trick.cards_played[0][1].suit

    # Find winner
    best_player_id = trick.cards_played[0][0]
    best_card = trick.cards_played[0][1]

    for pid, card in trick.cards_played[1:]:
        if _beats(card, best_card, led_suit, trump_suit):
            best_player_id = pid
            best_card = card

    trick.winner_id = best_player_id

    # Update tricks won
    winner = game.get_player_by_id(best_player_id)
    assert winner is not None
    winner.tricks_won += 1

    # Store completed trick
    game.current_round.tricks_completed.append(trick)

    result = {
        "winner_id": best_player_id,
        "winner_name": winner.name,
        "winning_card": best_card.to_dict(),
        "trick": trick.to_dict(),
    }

    # Check if round is over
    game.current_round.trick_number += 1
    if game.current_round.trick_number >= game.current_round.num_cards:
        # Round is over, score it
        return {**result, "round_over": True}

    # Start next trick - winner leads
    winner_index = game.get_player_index(best_player_id)
    game.current_turn_index = winner_index
    game.current_round.current_trick = Trick(lead_player_id=best_player_id)

    return {**result, "round_over": False}


def _beats(
    challenger: Card, current_best: Card, led_suit: Suit, trump_suit: Suit
) -> bool:
    """Determine if challenger card beats the current best card."""
    challenger_is_trump = challenger.suit == trump_suit
    best_is_trump = current_best.suit == trump_suit

    # Trump beats non-trump
    if challenger_is_trump and not best_is_trump:
        return True
    if not challenger_is_trump and best_is_trump:
        return False

    # Both trump - higher rank wins
    if challenger_is_trump and best_is_trump:
        return challenger.rank > current_best.rank

    # Neither is trump - must be of led suit to win
    challenger_follows = challenger.suit == led_suit
    best_follows = current_best.suit == led_suit

    if challenger_follows and best_follows:
        return challenger.rank > current_best.rank
    if challenger_follows and not best_follows:
        return True
    # Challenger doesn't follow suit and isn't trump - can't beat
    return False


def score_round(game: Game) -> list[dict]:
    """Score the current round and return per-player results.

    Scoring rules:
    - Bid met exactly: bid * 10 points
    - Bid == 1 and met: 11 points
    - Bid == 0 and met (0 tricks taken): 10 points
    - Bid not met: 0 points
    """
    results = []

    for player in game.players:
        bid = player.bid if player.bid is not None else 0
        won = player.tricks_won
        met_bid = won == bid

        if met_bid:
            if bid == 0:
                points = 10
            elif bid == 1:
                points = 11
            else:
                points = bid * 10
        else:
            points = 0

        player.total_score += points

        results.append(
            {
                "player_id": player.id,
                "player_name": player.name,
                "bid": bid,
                "tricks_won": won,
                "met_bid": met_bid,
                "points_earned": points,
                "total_score": player.total_score,
            }
        )

    game.scores_history.append(
        {
            "round_index": game.current_round_index,
            "num_cards": game.current_round.num_cards if game.current_round else 0,
            "results": results,
        }
    )

    return results


def advance_to_next_round(game: Game) -> bool:
    """Advance to the next round. Returns False if game is over."""
    game.current_round_index += 1
    game.dealer_index = (game.dealer_index + 1) % len(game.players)

    if game.current_round_index >= len(game.round_sequence):
        game.phase = GamePhase.GAME_OVER
        return False

    return True


def get_game_results(game: Game) -> dict:
    """Get final game results with rankings."""
    sorted_players = sorted(game.players, key=lambda p: p.total_score, reverse=True)
    rankings = []
    for rank, player in enumerate(sorted_players, 1):
        rankings.append(
            {
                "rank": rank,
                "player_id": player.id,
                "player_name": player.name,
                "total_score": player.total_score,
            }
        )

    return {
        "rankings": rankings,
        "winner": rankings[0] if rankings else None,
        "scores_history": game.scores_history,
    }
