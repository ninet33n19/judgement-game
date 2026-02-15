import { type Card, type GameState, RANKS, SUITS } from "../types";

export const GameLogic = {
  /**
   * Generates a shuffled 52-card deck.
   */
  createDeck(): Card[] {
    const deck: Card[] = [];
    SUITS.forEach((suit) => {
      RANKS.forEach((rank) => {
        // Ranks: 2=2 ... 9=9, 10=10, J=11, Q=12, K=13, A=14
        let val = Number.parseInt(rank, 10);
        if (rank === "J") val = 11;
        if (rank === "Q") val = 12;
        if (rank === "K") val = 13;
        if (rank === "A") val = 14;

        deck.push({ suit, rank, value: val });
      });
    });

    // Fisher-Yates Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  },

  /**
   * Start a new Round with safety checks for 3-6 players.
   */
  startRound(game: GameState): void {
    game.roundNumber++;

    // --- NEW: Dynamic Card Calculation ---
    // 1. We want to reach roundNumber (e.g. Round 5 = 5 cards)
    // 2. BUT we cannot exceed 10 cards (User Rule)
    // 3. AND we cannot exceed 52 / players (Physics Rule)

    const maxCardsPhysics = Math.floor(52 / game.players.length);
    const maxCardsUser = 10;
    const targetCards = game.roundNumber;

    game.cardsPerPlayer = Math.min(targetCards, maxCardsUser, maxCardsPhysics);

    // If we have passed the max possible rounds, End Game
    if (targetCards > Math.min(maxCardsUser, maxCardsPhysics)) {
      game.phase = "GAME_OVER";
      return;
    }

    // Rotate Trump: S -> D -> C -> H
    game.trumpSuit = SUITS[(game.roundNumber - 1) % 4];

    // Reset Round State
    game.players.forEach((p) => {
      p.bid = null;
      p.tricksWon = 0;
      p.hand = [];
    });

    // Deal Cards
    const deck = GameLogic.createDeck();
    game.players.forEach((p) => {
      p.hand = deck.splice(0, game.cardsPerPlayer);
      // Sort hand: Suit first, then Value
      p.hand.sort((a, b) => {
        if (a.suit === b.suit) return a.value - b.value;
        return a.suit.localeCompare(b.suit);
      });
    });

    // Rotate Dealer
    if (game.dealerIndex === -1) {
      game.dealerIndex = 0; // First round random dealer
    } else {
      game.dealerIndex = (game.dealerIndex + 1) % game.players.length;
    }

    // First turn is strictly left of dealer
    game.currentTurnIndex = (game.dealerIndex + 1) % game.players.length;

    game.phase = "BIDDING";
  },

  /**
   * Validates a BID.
   * Enforces the "Hook Rule": Last bidder cannot make bids equal total cards.
   */
  validateBid(
    game: GameState,
    _playerIndex: number,
    bidAmount: number,
  ): { valid: boolean; message?: string } {
    // 1. Basic Check
    if (bidAmount < 0 || bidAmount > game.cardsPerPlayer) {
      return {
        valid: false,
        message: `Bid must be between 0 and ${game.cardsPerPlayer}`,
      };
    }

    const playersWithBids = game.players.filter((p) => p.bid !== null).length;
    const isLastBidder = playersWithBids === game.players.length - 1;

    if (isLastBidder) {
      const currentTotal = game.players.reduce(
        (sum, p) => sum + (p.bid || 0),
        0,
      );
      if (currentTotal + bidAmount === game.cardsPerPlayer) {
        return {
          valid: false,
          message: `Hook Rule: Total bids cannot equal ${game.cardsPerPlayer} (Cards in hand). You cannot bid ${bidAmount}.`,
        };
      }
    }

    return { valid: true };
  },

  /**
   * Validates a CARD PLAY.
   */
  validateMove(
    game: GameState,
    playerIndex: number,
    cardIndex: number,
  ): { valid: boolean; message?: string } {
    const player = game.players[playerIndex];
    const card = player?.hand?.[cardIndex];

    if (!card) return { valid: false, message: "Card not found" };

    if (game.leadSuit) {
      const hasLeadSuit = player.hand.some((c) => c.suit === game.leadSuit);
      if (hasLeadSuit && card.suit !== game.leadSuit) {
        return {
          valid: false,
          message: `You must follow suit: ${game.leadSuit}`,
        };
      }
    }

    return { valid: true };
  },

  /**
   * Determines trick winner and cleans up table.
   */
  resolveTrick(game: GameState): number {
    if (game.table.length === 0) throw new Error("Table empty");

    const winningPlay = game.table.reduce((best, curr) => {
      if (!best) return curr;

      const isTrump = curr.card.suit === game.trumpSuit;
      const bestIsTrump = best.card.suit === game.trumpSuit;

      // Trump Logic
      if (isTrump && !bestIsTrump) return curr;
      if (!isTrump && bestIsTrump) return best;

      // Suit Logic (Must match suit of best card so far to beat it, unless trump involved)
      // Note: 'best' starts as the Lead Card.
      // A card only beats the current best if it matches the best card's suit AND is higher.
      if (curr.card.suit === best.card.suit) {
        return curr.card.value > best.card.value ? curr : best;
      }

      return best;
    }, game.table[0]); // Start with the first card played (Lead)

    const winnerIndex = game.players.findIndex(
      (p) => p.id === winningPlay.playerId,
    );

    // Update stats
    game.players[winnerIndex].tricksWon++;
    game.currentTurnIndex = winnerIndex; // Winner leads next
    game.leadSuit = null;
    game.table = []; // Clear table

    return winnerIndex;
  },

  /**
   * Scoring Rules:
   * Bid 0, Win 0 -> 10 pts
   * Bid 1, Win 1 -> 11 pts
   * Bid N, Win N -> N * 10 pts
   * Else -> 0 pts
   */
  calculateScores(game: GameState) {
    game.players.forEach((p) => {
      const bid = p.bid ?? 0;
      const won = p.tricksWon;

      if (bid === won) {
        if (bid === 0) p.score += 10;
        else if (bid === 1) p.score += 11;
        else p.score += bid * 10;
      } else {
        p.score += 0;
      }
    });
  },
};
