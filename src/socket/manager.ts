import type { Server, Socket } from "socket.io";
import { GameLogic } from "../game/logic";
import type { RedisGameStore } from "../state/store.redis";
import type { Player } from "../types";

export class SocketManager {
  private io: Server;
  private store: RedisGameStore;

  constructor(io: Server, store: RedisGameStore) {
    this.io = io;
    this.store = store;
    this.store.setOnStateUpdated((roomId) => this.broadcastState(roomId));
    this.setup();
  }

  private setup() {
    this.io.on("connection", (socket: Socket) => {
      console.log(`Client connected: ${socket.id}`);

      this.handleJoin(socket);
      this.handleStart(socket);
      this.handleBid(socket);
      this.handlePlay(socket);
      this.handleDisconnect(socket);
      this.handleExit(socket);
      this.handleVoteEndGame(socket);
    });
  }

  // --- 1. JOIN GAME ---
  private handleJoin(socket: Socket) {
    socket.on("create_room", async ({ name }) => {
      try {
        const roomId = this.generateRoomCode();
        const game = await this.store.createRoom(roomId);
        console.log(`Created new game with roomId: ${roomId}`);

        const sessionToken = crypto.randomUUID();
        const newPlayer: Player = {
          id: socket.id,
          sessionToken,
          name: name.substring(0, 12),
          hand: [],
          bid: null,
          tricksWon: 0,
          score: 0,
          connected: true,
        };

        game.players.push(newPlayer);
        socket.join(roomId);
        await this.store.setSocketRoom(socket.id, roomId);
        await this.store.setSessionRoom(sessionToken, roomId);
        await this.store.saveGame(roomId, game);

        socket.emit("room_created", { roomId, sessionToken });
        await this.broadcastState(roomId);
      } catch (error) {
        socket.emit("error", "Failed to create room");
        console.error(`Error in create_room: ${error}`);
      }
    });

    socket.on("join_game", async ({ roomId, name, sessionToken }) => {
      try {
        const game = await this.store.getGame(roomId);

        if (!game) {
          socket.emit("error", "Room not found");
          return;
        }

        // 1. Try to reconnect by sessionToken
        if (sessionToken) {
          const playerByToken = game.players.find(p => p.sessionToken === sessionToken);
          if (playerByToken) {
            playerByToken.id = socket.id;
            playerByToken.connected = true;
            socket.join(roomId);
            await this.store.setSocketRoom(socket.id, roomId);
            game.endGameVotes = game.endGameVotes.filter(id => id !== playerByToken.id);

            await this.store.saveGame(roomId, game);
            socket.emit("reconnected", { roomId, sessionToken });
            await this.broadcastState(roomId);
            return;
          }
        }

        // 2. Fallback: Try to reconnect by name if disconnected
        const existingPlayer = game.players.find(
          (p) => p.name.toLowerCase() === name?.toLowerCase() && !p.connected
        );

        if (existingPlayer) {
          existingPlayer.id = socket.id;
          existingPlayer.connected = true;
          socket.join(roomId);
          await this.store.setSocketRoom(socket.id, roomId);
          game.endGameVotes = game.endGameVotes.filter(id => id !== existingPlayer.id);

          await this.store.saveGame(roomId, game);
          socket.emit("reconnected", { roomId, sessionToken: existingPlayer.sessionToken });
          await this.broadcastState(roomId);
          return;
        }

        // 3. Normal Join logic
        if (!name) {
          socket.emit("error", "Name is required");
          return;
        }

        const alreadyConnected = game.players.find(
          (p) => p.name.toLowerCase() === name.toLowerCase() && p.connected
        );

        if (alreadyConnected) {
          socket.emit("error", "Player with this name is already in the game");
          return;
        }

        if (game.phase !== "LOBBY") {
          socket.emit("error", "Game already started");
          return;
        }

        if (game.players.length >= 6) {
          socket.emit("error", "Room is full");
          return;
        }

        const newSessionToken = crypto.randomUUID();
        const newPlayer: Player = {
          id: socket.id,
          sessionToken: newSessionToken,
          name: name.substring(0, 12),
          hand: [],
          bid: null,
          tricksWon: 0,
          score: 0,
          connected: true,
        };

        game.players.push(newPlayer);
        socket.join(roomId);
        await this.store.setSocketRoom(socket.id, roomId);
        await this.store.setSessionRoom(newSessionToken, roomId);
        await this.store.saveGame(roomId, game);

        socket.emit("joined_game", { roomId, sessionToken: newSessionToken });
        await this.broadcastState(roomId);
      } catch (error) {
        socket.emit("error", "Failed to join game");
        console.error(`Error in join_game: ${error}`);
      }
    });
  }

  private generateRoomCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // --- 2. START GAME ---
  private handleStart(socket: Socket) {
    socket.on("start_game", async () => {
      const game = await this.store.findRoomByPlayerId(socket.id);
      if (!game) return;

      if (game.players.length < 3) {
        socket.emit("error", "Need at least 3 players to start");
        return;
      }

      GameLogic.startRound(game);
      await this.store.saveGame(game.roomId, game);
      await this.broadcastState(game.roomId);
    });
  }

  // --- 3. PLACE BID ---
  private handleBid(socket: Socket) {
    socket.on("place_bid", async (bidAmount: number) => {
      const game = await this.store.findRoomByPlayerId(socket.id);
      if (!game || game.phase !== "BIDDING") return;

      const playerIndex = game.players.findIndex((p) => p.id === socket.id);

      if (playerIndex !== game.currentTurnIndex) {
        socket.emit("error", "Not your turn to bid");
        return;
      }

      const validation = GameLogic.validateBid(game, playerIndex, bidAmount);
      if (!validation.valid) {
        socket.emit("error", validation.message);
        return;
      }

      game.players[playerIndex].bid = bidAmount;

      const remainingBidders = game.players.filter(
        (p) => p.bid === null,
      ).length;

      if (remainingBidders === 0) {
        game.phase = "PLAYING";
        game.currentTurnIndex = (game.dealerIndex + 1) % game.players.length;
      } else {
        game.currentTurnIndex =
          (game.currentTurnIndex + 1) % game.players.length;
      }

      await this.store.saveGame(game.roomId, game);
      await this.broadcastState(game.roomId);
    });
  }

  // --- 4. PLAY CARD ---
  private handlePlay(socket: Socket) {
    socket.on("play_card", async (cardIndex: number) => {
      const game = await this.store.findRoomByPlayerId(socket.id);
      if (!game || game.phase !== "PLAYING") return;

      const playerIndex = game.players.findIndex((p) => p.id === socket.id);
      if (playerIndex !== game.currentTurnIndex) return;

      const validation = GameLogic.validateMove(game, playerIndex, cardIndex);
      if (!validation.valid) {
        socket.emit("error", validation.message);
        return;
      }

      const player = game.players[playerIndex];
      const card = player.hand.splice(cardIndex, 1)[0];

      if (game.table.length === 0) {
        game.leadSuit = card.suit;
      }

      game.table.push({ playerId: player.id, card });

      if (game.table.length === game.players.length) {
        const winnerIndex = GameLogic.resolveTrick(game);
        const winnerName = game.players[winnerIndex].name;

        this.io.to(game.roomId).emit("trick_won", { winner: winnerName });

        if (game.players[0].hand.length === 0) {
          GameLogic.calculateScores(game);
          game.phase = "ROUND_OVER";
          await this.store.saveGame(game.roomId, game);
          await this.broadcastState(game.roomId);

          setTimeout(async () => {
            const g = await this.store.getGame(game.roomId);
            if (g) {
              GameLogic.startRound(g);
              await this.store.saveGame(game.roomId, g);
              await this.broadcastState(game.roomId);
            }
          }, 5000);
        } else {
          await this.store.saveGame(game.roomId, game);
          await this.broadcastState(game.roomId);
          setTimeout(() => this.broadcastState(game.roomId), 1500);
        }
      } else {
        game.currentTurnIndex =
          (game.currentTurnIndex + 1) % game.players.length;
        await this.store.saveGame(game.roomId, game);
        await this.broadcastState(game.roomId);
      }
    });
  }

  // --- 5. DISCONNECT ---
  private handleDisconnect(socket: Socket) {
    socket.on("disconnect", async () => {
      const game = await this.store.findRoomByPlayerId(socket.id);
      if (game) {
        const player = game.players.find((p) => p.id === socket.id);
        if (player) player.connected = false;

        if (game.phase === "LOBBY") {
          game.players = game.players.filter((p) => p.id !== socket.id);
        }

        await this.store.deleteSocketRoom(socket.id);
        await this.store.saveGame(game.roomId, game);
        await this.broadcastState(game.roomId);
      }
    });
  }

  // --- 6. EXIT GAME ---
  private handleExit(socket: Socket) {
    socket.on("player_exit", async () => {
      const game = await this.store.findRoomByPlayerId(socket.id);
      if (!game) return;

      await this.store.deleteSocketRoom(socket.id);

      if (game.phase === "LOBBY") {
        game.players = game.players.filter((p) => p.id !== socket.id);
        if (game.players.length === 0) {
          await this.store.deleteRoom(game.roomId);
          socket.leave(game.roomId);
          return;
        }
        await this.store.saveGame(game.roomId, game);
      } else {
        const player = game.players.find((p) => p.id === socket.id);
        if (player) {
          player.connected = false;
          game.endGameVotes = game.endGameVotes.filter(id => id !== socket.id);
        }
        await this.store.saveGame(game.roomId, game);
      }

      socket.leave(game.roomId);
      await this.broadcastState(game.roomId);
    });
  }

  // --- 7. VOTE TO END GAME ---
  private handleVoteEndGame(socket: Socket) {
    socket.on("vote_end_game", async () => {
      const game = await this.store.findRoomByPlayerId(socket.id);
      if (!game) return;

      if (game.phase === "LOBBY" || game.phase === "GAME_OVER") return;

      if (!game.endGameVotes.includes(socket.id)) {
        game.endGameVotes.push(socket.id);

        const connectedPlayers = game.players.filter(p => p.connected);
        const majority = Math.ceil(connectedPlayers.length / 2);

        if (game.endGameVotes.length >= majority) {
          game.phase = "GAME_OVER";
          game.endGameVotes = [];
        }

        await this.store.saveGame(game.roomId, game);
        await this.broadcastState(game.roomId);
      }
    });
  }

  // --- HELPER: BROADCAST STATE ---
  async broadcastState(roomId: string): Promise<void> {
    const game = await this.store.getGame(roomId);
    if (!game) return;

    for (const player of game.players) {
      if (!player.connected) continue;

      const publicPlayers = game.players.map((p) => ({
        ...p,
        hand:
          p.id === player.id
            ? p.hand
            : (p.hand.map(() => ({ suit: "?", rank: "?", value: 0 })) as typeof p.hand),
      }));

      const publicState = {
        ...game,
        players: publicPlayers,
        me: player.id,
      };

      this.io.to(player.id).emit("state_update", publicState);
    }
  }
}
