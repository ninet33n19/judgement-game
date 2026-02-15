export type Suit = "S" | "D" | "C" | "H";
export type Rank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A";

export const SUITS: Suit[] = ["S", "D", "C", "H"];
export const RANKS: Rank[] = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
];

export interface Card {
  suit: Suit;
  rank: Rank;
  value: number;
}

export interface Player {
  id: string; // Socket ID
  sessionToken: string;
  name: string;
  hand: Card[];
  bid: number | null;
  tricksWon: number;
  score: number;
  connected: boolean;
}

export interface GameState {
  roomId: string;
  phase: "LOBBY" | "BIDDING" | "PLAYING" | "ROUND_OVER" | "GAME_OVER";
  players: Player[];
  roundNumber: number;
  cardsPerPlayer: number;
  trumpSuit: Suit;
  currentTurnIndex: number;
  dealerIndex: number;
  table: { playerId: string; card: Card }[];
  leadSuit: Suit | null;
  endGameVotes: string[];
  lastUpdatedAt: number;
}
