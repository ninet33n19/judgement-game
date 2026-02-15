import type { Server, Socket } from "socket.io";
import { GameLogic } from "../game/logic";
import { store } from "../state/store";
import type { Player } from "../types";

export class SocketManager {
  private io: Server;

  constructor(io: Server) {
    this.io = io;
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
    socket.on("create_room", ({ name }) => {
      try {
        const roomId = this.generateRoomCode();
        const game = store.createRoom(roomId);
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

        socket.emit("room_created", { roomId, sessionToken });
        this.broadcastState(roomId);
      } catch (error) {
        socket.emit("error", "Failed to create room");
        console.error(`Error in create_room: ${error}`);
      }
    });

    socket.on("join_game", ({ roomId, name, sessionToken }) => {
      try {
        const game = store.getGame(roomId);

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
            
            // Clear their votes if they had any
            game.endGameVotes = game.endGameVotes.filter(id => id !== playerByToken.id);
            
            socket.emit("reconnected", { roomId, sessionToken });
            this.broadcastState(roomId);
            return;
          }
        }

        // 2. Fallback: Try to reconnect by name if disconnected
        const existingPlayer = game.players.find(
          (p) => p.name.toLowerCase() === name?.toLowerCase() && !p.connected
        );

        if (existingPlayer) {
          // Reconnect existing player
          existingPlayer.id = socket.id;
          existingPlayer.connected = true;
          socket.join(roomId);
          
          // Clear their votes if they had any
          game.endGameVotes = game.endGameVotes.filter(id => id !== existingPlayer.id);
          
          socket.emit("reconnected", { roomId, sessionToken: existingPlayer.sessionToken });
          this.broadcastState(roomId);
          return;
        }

        // 3. Normal Join logic
        if (!name) {
          socket.emit("error", "Name is required");
          return;
        }

        // Check if player with same name is already connected
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
        socket.emit("joined_game", { roomId, sessionToken: newSessionToken });

        this.broadcastState(roomId);
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
    socket.on("start_game", () => {
      const game = store.findRoomByPlayerId(socket.id);
      if (!game) return;

      // Only the "host" (first player) should start, but for simplicity any player can now
      if (game.players.length < 3) {
        socket.emit("error", "Need at least 3 players to start");
        return;
      }

      GameLogic.startRound(game);
      this.broadcastState(game.roomId);
    });
  }

  // --- 3. PLACE BID ---
  private handleBid(socket: Socket) {
    socket.on("place_bid", (bidAmount: number) => {
      const game = store.findRoomByPlayerId(socket.id);
      if (!game || game.phase !== "BIDDING") return;

      const playerIndex = game.players.findIndex((p) => p.id === socket.id);

      // Is it this player's turn?
      if (playerIndex !== game.currentTurnIndex) {
        socket.emit("error", "Not your turn to bid");
        return;
      }

      // Validate Bid
      const validation = GameLogic.validateBid(game, playerIndex, bidAmount);
      if (!validation.valid) {
        socket.emit("error", validation.message);
        return;
      }

      // Apply Bid
      game.players[playerIndex].bid = bidAmount;

      // Check if all players have bid
      const remainingBidders = game.players.filter(
        (p) => p.bid === null,
      ).length;

      if (remainingBidders === 0) {
        // Everyone bid -> Switch to Playing Phase
        game.phase = "PLAYING";
        // Leader is player left of dealer
        game.currentTurnIndex = (game.dealerIndex + 1) % game.players.length;
      } else {
        // Next bidder
        game.currentTurnIndex =
          (game.currentTurnIndex + 1) % game.players.length;
      }

      this.broadcastState(game.roomId);
    });
  }

  // --- 4. PLAY CARD ---
  private handlePlay(socket: Socket) {
    socket.on("play_card", (cardIndex: number) => {
      const game = store.findRoomByPlayerId(socket.id);
      if (!game || game.phase !== "PLAYING") return;

      const playerIndex = game.players.findIndex((p) => p.id === socket.id);
      if (playerIndex !== game.currentTurnIndex) return;

      // Validate Move
      const validation = GameLogic.validateMove(game, playerIndex, cardIndex);
      if (!validation.valid) {
        socket.emit("error", validation.message);
        return;
      }

      // Execute Move
      const player = game.players[playerIndex];
      const card = player.hand.splice(cardIndex, 1)[0]; // Remove card

      // Set Lead Suit if first card
      if (game.table.length === 0) {
        game.leadSuit = card.suit;
      }

      game.table.push({ playerId: player.id, card });

      // Check if trick is complete
      if (game.table.length === game.players.length) {
        // Resolve Trick (Find winner)
        const winnerIndex = GameLogic.resolveTrick(game);
        const winnerName = game.players[winnerIndex].name;

        this.io.to(game.roomId).emit("trick_won", { winner: winnerName });

        // Check if Round is Over (Hand empty)
        if (game.players[0].hand.length === 0) {
          GameLogic.calculateScores(game);
          game.phase = "ROUND_OVER";
          this.broadcastState(game.roomId);

          // Auto-start next round after 5 seconds
          setTimeout(() => {
            // Check if game still exists (players might have left)
            if (store.getGame(game.roomId)) {
              GameLogic.startRound(game);
              this.broadcastState(game.roomId);
            }
          }, 5000);
        } else {
          // Trick over, next trick starts with winner
          // Wait 2 seconds so people can see who won the trick
          setTimeout(() => {
            this.broadcastState(game.roomId);
          }, 1500);
          // Send immediate update so they see the card played,
          // then the 2s delay happens before the table clears.
          this.broadcastState(game.roomId);
        }
      } else {
        // Next player's turn
        game.currentTurnIndex =
          (game.currentTurnIndex + 1) % game.players.length;
        this.broadcastState(game.roomId);
      }
    });
  }

  // --- 5. DISCONNECT ---
  private handleDisconnect(socket: Socket) {
    socket.on("disconnect", () => {
      const game = store.findRoomByPlayerId(socket.id);
      if (game) {
        const player = game.players.find((p) => p.id === socket.id);
        if (player) player.connected = false;

        if (game.phase === "LOBBY") {
          game.players = game.players.filter((p) => p.id !== socket.id);
        }

        this.broadcastState(game.roomId);
      }
    });
  }

  // --- 6. EXIT GAME ---
  private handleExit(socket: Socket) {
    socket.on("player_exit", () => {
      const game = store.findRoomByPlayerId(socket.id);
      if (!game) return;

      if (game.phase === "LOBBY") {
        game.players = game.players.filter((p) => p.id !== socket.id);
        if (game.players.length === 0) {
          store.deleteRoom(game.roomId);
        }
      } else {
        const player = game.players.find((p) => p.id === socket.id);
        if (player) {
          player.connected = false;
          game.endGameVotes = game.endGameVotes.filter(id => id !== socket.id);
        }
      }

      socket.leave(game.roomId);
      this.broadcastState(game.roomId);
    });
  }

  // --- 7. VOTE TO END GAME ---
  private handleVoteEndGame(socket: Socket) {
    socket.on("vote_end_game", () => {
      const game = store.findRoomByPlayerId(socket.id);
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

        this.broadcastState(game.roomId);
      }
    });
  }

  // --- HELPER: BROADCAST STATE ---
  private broadcastState(roomId: string) {
    const game = store.getGame(roomId);
    if (!game) return;

    store.saveGame(roomId);

    game.players.forEach((player) => {
      if (!player.connected) return;

      const publicPlayers = game.players.map((p) => ({
        ...p,
        hand:
          p.id === player.id
            ? p.hand
            : p.hand.map(() => ({ suit: "?", rank: "?", value: 0 })),
      }));

      // create a sanitized view of state
      const publicState = {
        ...game,
        players: publicPlayers,
        me: player.id, // tell the client which player they are
      };

      this.io.to(player.id).emit("state_update", publicState);
    });
  }
}
