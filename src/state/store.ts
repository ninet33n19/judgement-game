import { Database } from "bun:sqlite";
import type { GameState, Player } from "../types";

export class GameStore {
  // Map RoomID -> GameState
  private games: Map<string, GameState> = new Map();
  private db: Database;

  constructor() {
    this.db = new Database("judgement.db");
    this.initDb();
    this.loadFromDb();
  }

  private initDb() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS games (
        roomId TEXT PRIMARY KEY,
        state TEXT,
        lastUpdatedAt INTEGER
      )
    `);
  }

  private loadFromDb() {
    const rows = this.db.query("SELECT state FROM games").all() as { state: string }[];
    for (const row of rows) {
      try {
        const game: GameState = JSON.parse(row.state);
        this.games.set(game.roomId, game);
      } catch (e) {
        console.error("Failed to load game from DB", e);
      }
    }
    console.log(`Loaded ${this.games.size} games from database`);
  }

  private saveToDb(game: GameState) {
    game.lastUpdatedAt = Date.now();
    this.db.run(
      "INSERT OR REPLACE INTO games (roomId, state, lastUpdatedAt) VALUES (?, ?, ?)",
      [game.roomId, JSON.stringify(game), game.lastUpdatedAt]
    );
  }

  createRoom(roomId: string): GameState {
    if (this.games.has(roomId)) {
      throw new Error("Room already exists");
    }

    const newGame: GameState = {
      roomId,
      phase: "LOBBY",
      players: [],
      roundNumber: 0,
      cardsPerPlayer: 0,
      trumpSuit: "S",
      currentTurnIndex: 0,
      dealerIndex: 0,
      table: [],
      leadSuit: null,
      endGameVotes: [],
      lastUpdatedAt: Date.now(),
    };

    this.games.set(roomId, newGame);
    this.saveToDb(newGame);
    return newGame;
  }

  saveGame(roomId: string): void {
    const game = this.games.get(roomId);
    if (game) {
      this.saveToDb(game);
    }
  }

  getGame(roomId: string): GameState | undefined {
    return this.games.get(roomId);
  }

  removeGame(roomId: string): void {
    this.games.delete(roomId);
    this.db.run("DELETE FROM games WHERE roomId = ?", [roomId]);
  }

  deleteRoom(roomId: string): void {
    this.removeGame(roomId);
  }

  // Helper to find which room a socket belongs to
  findRoomByPlayerId(socketId: string): GameState | undefined {
    for (const game of this.games.values()) {
      const playerExists = game.players.some((p: Player) => p.id === socketId);
      if (playerExists) {
        return game;
      }
    }

    return undefined;
  }

  // Find game by session token
  findRoomBySessionToken(token: string): GameState | undefined {
    for (const game of this.games.values()) {
      const playerExists = game.players.some((p: Player) => p.sessionToken === token);
      if (playerExists) {
        return game;
      }
    }
    return undefined;
  }

  // Force persist all games (useful for periodic sync or shutdown)
  persistAll() {
    for (const game of this.games.values()) {
      this.saveToDb(game);
    }
  }
}

// Export a singleton instance
export const store = new GameStore();
