import Redis from "ioredis";
import { Database } from "bun:sqlite";
import type { GameState, Player } from "../types";

const GAME_PREFIX = "game:";
const SOCKET_PREFIX = "socket:";
const SESSION_PREFIX = "session:";
const ROOM_CHAN_PREFIX = "room:";

export class RedisGameStore {
  private redis: Redis;
  private sub: Redis;
  private db: Database;
  private _onStateUpdated?: (roomId: string) => void;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.sub = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.db = new Database("judgement.db");
  }

  setOnStateUpdated(handler: (roomId: string) => void): void {
    this._onStateUpdated = handler;
  }

  async init(): Promise<void> {
    this.initDb();
    await this.setupSubscriber();
    await this.loadFromDb();
  }

  private initDb(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS games (
        roomId TEXT PRIMARY KEY,
        state TEXT,
        lastUpdatedAt INTEGER
      )
    `);
  }

  private async loadFromDb(): Promise<void> {
    const rows = this.db.query("SELECT state FROM games").all() as { state: string }[];
    for (const row of rows) {
      try {
        const game: GameState = JSON.parse(row.state);
        await this.redis.set(GAME_PREFIX + game.roomId, row.state);
      } catch (e) {
        console.error("Failed to load game from DB", e);
      }
    }
    console.log(`Loaded ${rows.length} games from database into Redis`);
  }

  private async saveToDb(game: GameState): Promise<void> {
    game.lastUpdatedAt = Date.now();
    this.db.run(
      "INSERT OR REPLACE INTO games (roomId, state, lastUpdatedAt) VALUES (?, ?, ?)",
      [game.roomId, JSON.stringify(game), game.lastUpdatedAt]
    );
  }

  private async publishStateUpdated(roomId: string): Promise<void> {
    await this.redis.publish(ROOM_CHAN_PREFIX + roomId, "state_updated");
  }

  private async setupSubscriber(): Promise<void> {
    await this.sub.psubscribe(ROOM_CHAN_PREFIX + "*");
    this.sub.on("pmessage", (_pattern: string, channel: string) => {
      const roomId = channel.slice(ROOM_CHAN_PREFIX.length);
      this._onStateUpdated?.(roomId);
    });
  }

  async getGame(roomId: string): Promise<GameState | undefined> {
    const raw = await this.redis.get(GAME_PREFIX + roomId);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as GameState;
    } catch {
      return undefined;
    }
  }

  async createRoom(roomId: string): Promise<GameState> {
    const existing = await this.redis.get(GAME_PREFIX + roomId);
    if (existing) throw new Error("Room already exists");

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

    await this.redis.set(GAME_PREFIX + roomId, JSON.stringify(newGame));
    await this.saveToDb(newGame);
    return newGame;
  }

  async saveGame(roomId: string, game: GameState): Promise<void> {
    game.lastUpdatedAt = Date.now();
    await this.redis.set(GAME_PREFIX + roomId, JSON.stringify(game));
    await this.saveToDb(game);
    await this.publishStateUpdated(roomId);
  }

  async setSocketRoom(socketId: string, roomId: string): Promise<void> {
    await this.redis.set(SOCKET_PREFIX + socketId, roomId);
  }

  async setSessionRoom(sessionToken: string, roomId: string): Promise<void> {
    await this.redis.set(SESSION_PREFIX + sessionToken, roomId);
  }

  async deleteSocketRoom(socketId: string): Promise<void> {
    await this.redis.del(SOCKET_PREFIX + socketId);
  }

  async deleteSessionRoom(sessionToken: string): Promise<void> {
    await this.redis.del(SESSION_PREFIX + sessionToken);
  }

  async removeGame(roomId: string): Promise<void> {
    const game = await this.getGame(roomId);
    if (game) {
      for (const p of game.players) {
        await this.deleteSessionRoom(p.sessionToken);
      }
    }
    await this.redis.del(GAME_PREFIX + roomId);
    this.db.run("DELETE FROM games WHERE roomId = ?", [roomId]);
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.removeGame(roomId);
  }

  async findRoomByPlayerId(socketId: string): Promise<GameState | undefined> {
    const roomId = await this.redis.get(SOCKET_PREFIX + socketId);
    if (!roomId) return undefined;
    return this.getGame(roomId);
  }

  async findRoomBySessionToken(token: string): Promise<GameState | undefined> {
    const roomId = await this.redis.get(SESSION_PREFIX + token);
    if (!roomId) return undefined;
    return this.getGame(roomId);
  }

  async close(): Promise<void> {
    this.redis.disconnect();
    this.sub.disconnect();
  }
}
