"""Unit tests for core Judgement game logic.

These tests focus on pure functions in ``src/judgement/game_logic.py``
and the dataclasses in ``src/judgement/models.py``.
"""

from src.judgement.game_logic import (
    start_new_round,
    get_forbidden_bid,
    validate_bid,
    get_valid_cards,
    validate_play,
    play_card,
    score_round,
    advance_to_next_round,
)
from src.judgement.models import (
    Card,
    Deck,
    Game,
    GamePhase,
    Player,
    Rank,
    RoundState,
    Suit,
    Trick,
    TRUMP_ORDER,
)


def _make_game(num_players: int = 4) -> Game:
    """Helper to create a minimal Game with ``num_players``."""
    players = [Player(id=f"p{i}", name=f"Player {i}") for i in range(num_players)]
    game = Game(room_code="ROOM1", host_id="p0", players=players)
    game.build_round_sequence()
    return game


def test_start_new_round_deals_cards_and_sets_trump():
    game = _make_game(4)
    # Start at first round
    game.current_round_index = 0

    start_new_round(game)

    assert game.current_round is not None
    round_state = game.current_round

    # All players should have the same number of cards
    hand_sizes = {len(p.hand) for p in game.players}
    assert hand_sizes == {round_state.num_cards}

    # Trump should follow TRUMP_ORDER rotation
    expected_trump = TRUMP_ORDER[game.current_round_index % 4]
    assert round_state.trump_suit == expected_trump

    # Phase should switch to bidding
    assert game.phase == GamePhase.BIDDING


def test_get_forbidden_bid_for_dealer():
    """Dealer can't make total bids equal number of cards."""
    game = _make_game(4)
    game.current_round_index = 3  # 4 cards per player
    start_new_round(game)
    assert game.current_round is not None
    round_state = game.current_round

    # Simulate all but dealer have already bid
    bidding_order = [((game.dealer_index + 1 + i) % len(game.players)) for i in range(len(game.players))]
    # Dealer is last in the order
    dealer_pos = len(game.players) - 1
    round_state.current_bidder_index = dealer_pos
    # Everyone else bids 1
    for idx in bidding_order[:-1]:
        pid = game.players[idx].id
        round_state.bids[pid] = 1

    forbidden = get_forbidden_bid(game)
    assert forbidden is not None
    total_bids_so_far = sum(round_state.bids.values())
    assert forbidden == round_state.num_cards - total_bids_so_far


def test_validate_bid_rejects_out_of_turn_or_range():
    game = _make_game(4)
    game.current_round_index = 0
    start_new_round(game)
    assert game.current_round is not None
    round_state = game.current_round

    # First bidder is left of dealer
    bidding_order = [((game.dealer_index + 1 + i) % len(game.players)) for i in range(len(game.players))]
    first_bidder_index = bidding_order[0]
    first_bidder_id = game.players[first_bidder_index].id
    other_id = game.players[bidding_order[1]].id

    # Wrong player
    err = validate_bid(game, other_id, 1)
    assert err is not None and "Not your turn" in err

    # Out of range
    err = validate_bid(game, first_bidder_id, round_state.num_cards + 1)
    assert err is not None and "between 0 and" in err


def test_get_valid_cards_and_validate_play_follow_suit():
    """When a suit is led, players must follow it if they can."""
    game = _make_game(4)
    # Manually construct a simple round state
    trump_suit = Suit.HEARTS
    game.current_round = RoundState(
        round_index=0,
        num_cards=1,
        trump_suit=trump_suit,
        dealer_index=0,
    )
    round_state = game.current_round
    lead_player = game.players[0]
    follower = game.players[1]

    # Lead has a spade
    lead_card = Card(Suit.SPADES, Rank.ACE)
    lead_player.hand = [lead_card]

    # Follower has one spade and one heart
    follow_spade = Card(Suit.SPADES, Rank.TWO)
    off_suit = Card(Suit.CLUBS, Rank.TWO)
    follower.hand = [follow_spade, off_suit]

    trick = Trick(lead_player_id=lead_player.id)
    round_state.current_trick = trick
    trick.cards_played.append((lead_player.id, lead_card))

    # It is follower's turn
    game.current_turn_index = 1
    game.phase = GamePhase.PLAYING  # Must be in playing phase for validate_play

    valid_cards = get_valid_cards(game, follower.id)
    assert follow_spade in valid_cards
    assert off_suit not in valid_cards

    # Trying to play off-suit should be rejected
    err = validate_play(game, follower.id, off_suit)
    assert err is not None and "follow suit" in err


def test_play_card_and_score_round_flow():
    """Play through a tiny round and ensure scoring & next-round advance."""
    game = _make_game(4)
    game.current_round_index = 0
    start_new_round(game)
    assert game.current_round is not None

    # Give each player 1 known card for determinism
    cards = [
        Card(Suit.SPADES, Rank.ACE),
        Card(Suit.SPADES, Rank.KING),
        Card(Suit.SPADES, Rank.QUEEN),
        Card(Suit.SPADES, Rank.JACK),
    ]
    for player, card in zip(game.players, cards, strict=False):
        player.hand = [card]

    # Everyone bids 1; round has 1 card so this is over-bidding,
    # but sufficient to exercise scoring logic.
    assert game.current_round is not None
    for player in game.players:
        game.current_round.bids[player.id] = 1
        player.bid = 1

    # Construct a trick: everyone plays in order
    game.current_round.current_trick = Trick(lead_player_id=game.players[0].id)
    game.current_turn_index = 0

    # Play cards in player order
    result = None
    for player, card in zip(game.players, cards, strict=False):
        result = play_card(game, player.id, card)

    # After last card result should be a trick result
    assert result is not None
    assert "winner_id" in result

    # Score round and advance
    round_results = score_round(game)
    assert len(round_results) == len(game.players)

    # All players scored either 0 or positive points
    assert all(r["points_earned"] >= 0 for r in round_results)

    # Advance to the next round
    has_next = advance_to_next_round(game)
    assert has_next
    assert game.current_round_index == 1

