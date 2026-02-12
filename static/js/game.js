// ── Game Table Logic ──

(function () {
  "use strict";

  // ── Suit symbols & colors ──
  const SUIT_SYMBOLS = {
    spades: "♠",
    diamonds: "♦",
    clubs: "♣",
    hearts: "♥",
  };
  const RANK_SYMBOLS = {
    2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8",
    9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A",
  };

  // ── DOM Elements ──
  const $roundInfo = document.getElementById("round-info");
  const $trumpSuit = document.getElementById("trump-suit");
  const $opponents = document.getElementById("opponents");
  const $trickCards = document.getElementById("trick-cards");
  const $trickMessage = document.getElementById("trick-message");
  const $myHand = document.getElementById("my-hand");
  const $myName = document.getElementById("my-name");
  const $myInitials = document.getElementById("my-initials");
  const $myScore = document.getElementById("my-score");
  const $myBidDisplay = document.getElementById("my-bid-display");
  const $myTricksDisplay = document.getElementById("my-tricks-display");

  // Modals
  const $bidModal = document.getElementById("bid-modal");
  const $bidInfo = document.getElementById("bid-info");
  const $bidOptions = document.getElementById("bid-options");
  const $roundResultModal = document.getElementById("round-result-modal");
  const $roundResultTableBody = document.querySelector("#round-result-table tbody");
  const $btnNextRound = document.getElementById("btn-next-round");
  const $gameOverModal = document.getElementById("game-over-modal");
  const $winnerAnnouncement = document.getElementById("winner-announcement");
  const $finalResultTableBody = document.querySelector("#final-result-table tbody");
  const $btnScoreboard = document.getElementById("btn-scoreboard");
  const $scoreboardModal = document.getElementById("scoreboard-modal");
  const $scoreboardTableBody = document.querySelector("#scoreboard-table tbody");
  const $btnCloseScoreboard = document.getElementById("btn-close-scoreboard");
  const $statusOverlay = document.getElementById("status-overlay");
  const $statusText = document.getElementById("status-text");
  const $trumpBadge = document.getElementById("trump-badge");
  const $trumpBadgeSymbol = document.getElementById("trump-badge-symbol");

  // ── Game State ──
  let ws = null;
  const urlParams = new URLSearchParams(window.location.search);
  let myPlayerId = localStorage.getItem("player_id");
  let myPlayerName = urlParams.get("name") || localStorage.getItem("player_name") || "You";
  let roomCode = urlParams.get("room") || localStorage.getItem("room_code");
  let isHost = localStorage.getItem("is_host") === "true";
  let reconnectDelay = 500;

  // Reinforce storage; put session in URL so hard refresh preserves it
  if (roomCode && !localStorage.getItem("room_code")) localStorage.setItem("room_code", roomCode);
  if (myPlayerName !== "You" && !localStorage.getItem("player_name")) localStorage.setItem("player_name", myPlayerName);
  if (roomCode && myPlayerName !== "You" && typeof history.replaceState === "function") {
    const params = new URLSearchParams({ room: roomCode, name: myPlayerName });
    history.replaceState(null, "", "/game?" + params.toString());
  }

  let myHand = [];
  let validCards = [];
  let players = [];
  let trumpSuit = null;
  let roundNum = 0;
  let totalRounds = 0;
  let numCards = 0;
  let myBid = "-";
  let myTricksWon = 0;
  let currentPhase = null;
  let currentTurnId = null;
  let trickCardsPlayed = [];

  // ── Status Toast Functions (CRITICAL - were missing before!) ──

  function showStatus(text) {
    if ($statusOverlay && $statusText) {
      $statusText.textContent = text;
      $statusOverlay.style.display = "block";
    }
  }

  function hideStatus() {
    if ($statusOverlay) {
      $statusOverlay.style.display = "none";
    }
  }

  // ── Player Name Lookup (CRITICAL - was missing before!) ──

  function getPlayerName(playerId) {
    if (playerId === myPlayerId) return myPlayerName;
    const p = players.find(pl => pl.id === playerId);
    return p ? p.name : "Unknown";
  }

  // ── WebSocket ──

  function connectWS() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("Game WS connected");
      reconnectDelay = 500; // reset backoff on success
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    };

    ws.onerror = (err) => {
      console.error("WS error:", err);
    };

    ws.onclose = () => {
      console.log("WS closed, reconnecting in", reconnectDelay, "ms");
      showStatus("Reconnecting...");
      setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 5000);
        connectWS();
      }, reconnectDelay);
    };
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // ── Message Router ──

  function handleMessage(msg) {
    console.log("MSG:", msg.type, msg);
    switch (msg.type) {
      case "connected":
        myPlayerId = msg.player_id;
        localStorage.setItem("player_id", myPlayerId);
        // Re-join room on reconnect
        send({
          type: "join_room",
          player_name: myPlayerName,
          room_code: roomCode,
        });
        break;

      case "room_joined":
        if (msg.room_code) {
          roomCode = msg.room_code;
          localStorage.setItem("room_code", roomCode);
          if (typeof history.replaceState === "function") {
            const p = new URLSearchParams(window.location.search);
            p.set("room", roomCode);
            p.set("name", myPlayerName);
            history.replaceState(null, "", "/game?" + p.toString());
          }
        }
        if (msg.game && msg.game.phase && msg.game.phase !== "waiting") {
          localStorage.setItem("game_phase", "in_progress");
        }
        if (msg.game && msg.game.host_id) {
          isHost = msg.game.host_id === myPlayerId;
          localStorage.setItem("is_host", isHost ? "true" : "false");
        }
        onRoomJoined(msg);
        break;

      case "player_joined":
        if (msg.players) {
          players = msg.players;
          renderOpponents();
        }
        if (msg.host_id) {
          isHost = msg.host_id === myPlayerId;
          localStorage.setItem("is_host", isHost ? "true" : "false");
        }
        break;

      case "player_left":
        if (msg.players) {
          players = msg.players;
          renderOpponents();
        }
        if (msg.new_host_id) {
          isHost = msg.new_host_id === myPlayerId;
          localStorage.setItem("is_host", isHost ? "true" : "false");
        } else if (msg.host_id) {
          isHost = msg.host_id === myPlayerId;
          localStorage.setItem("is_host", isHost ? "true" : "false");
        }
        break;

      case "player_disconnected":
        // Player temporarily offline — update list but keep them
        if (msg.players) {
          players = msg.players;
          renderOpponents();
        }
        break;

      case "round_start":
        onRoundStart(msg);
        break;

      case "bid_turn":
        onBidTurn(msg);
        break;

      case "bid_placed":
        onBidPlaced(msg);
        break;

      case "play_turn":
        onPlayTurn(msg);
        break;

      case "play_request":
        onPlayRequest(msg);
        break;

      case "card_played":
        onCardPlayed(msg);
        break;

      case "trick_result":
        onTrickResult(msg);
        break;

      case "round_result":
        onRoundResult(msg);
        break;

      case "game_over":
        onGameOver(msg);
        break;

      case "error":
        showStatus(msg.message);
        setTimeout(hideStatus, 3000);
        if (msg.message && /room not found/i.test(msg.message)) {
          localStorage.removeItem("room_code");
          localStorage.removeItem("player_name");
          localStorage.removeItem("game_phase");
          setTimeout(() => { window.location.href = "/"; }, 1500);
        }
        break;
    }
  }

  // ── Handlers ──

  function onRoomJoined(msg) {
    if (msg.game) {
      const g = msg.game;
      isHost = g.host_id === myPlayerId;
      localStorage.setItem("is_host", isHost ? "true" : "false");

      // Update persistent round info
      if (g.current_round) {
        roundNum = (g.current_round_index || 0) + 1; // 0-indexed on server
        totalRounds = g.round_sequence ? g.round_sequence.length : 19;
        trumpSuit = g.current_round.trump;

        $roundInfo.textContent = `${roundNum}/${totalRounds}`;
        $trumpBadge.style.display = "flex";
        $trumpBadgeSymbol.textContent = SUIT_SYMBOLS[trumpSuit] || trumpSuit;
        $trumpBadgeSymbol.className = `trump-symbol trump-${trumpSuit}`;

        // Also update bottom strip for redundancy
        $trumpSuit.textContent = SUIT_SYMBOLS[trumpSuit] || trumpSuit;
        $trumpSuit.className = `value trump-${trumpSuit}`;

        // Restore bids/tricks if available
        const myData = (msg.players || []).find(p => p.id === myPlayerId);
        if (myData) {
          $myScore.textContent = `Score: ${myData.total_score || 0}`;
          // If bid is known, show it
          if (g.current_round.bids && g.current_round.bids[myPlayerId] !== undefined) {
            myBid = g.current_round.bids[myPlayerId];
            $myBidDisplay.textContent = myBid;
          }
        }
      }
    }

    if (msg.players) {
      players = msg.players;
    }

    $myName.textContent = myPlayerName;
    $myInitials.textContent = getInitials(myPlayerName);
    renderOpponents();

    // If we have a hand (reconnected mid-game), render it
    if (msg.game && msg.game.phase !== 'waiting' && msg.players) {
      // Find my hand in the players list if not sent separately
      const me = msg.players.find(p => p.id === myPlayerId);
      if (me && me.hand) {
        myHand = me.hand;
        renderHand();
      }
    }

    if (msg.game && msg.game.phase === 'waiting') {
      showStatus("Waiting for host to start game...");
    } else {
      hideStatus();
    }
  }

  function onRoundStart(msg) {
    currentPhase = "bidding";
    myHand = msg.hand || [];
    trumpSuit = msg.trump_suit;
    roundNum = msg.round_number;
    totalRounds = msg.total_rounds;
    numCards = msg.num_cards;
    myBid = "-";
    myTricksWon = 0;
    validCards = [];
    trickCardsPlayed = [];

    closeAllModals();

    // Update UI
    $roundInfo.textContent = `${roundNum}/${totalRounds}`;

    // Update floating trump badge
    $trumpBadge.style.display = "flex";
    $trumpBadgeSymbol.textContent = SUIT_SYMBOLS[trumpSuit] || trumpSuit;
    $trumpBadgeSymbol.className = `trump-symbol trump-${trumpSuit}`;

    // Update bottom info strip (redundancy)
    $trumpSuit.textContent = SUIT_SYMBOLS[trumpSuit] || trumpSuit;
    $trumpSuit.className = `value trump-${trumpSuit}`;
    $trumpSuit.textContent = SUIT_SYMBOLS[trumpSuit] || trumpSuit;
    $trumpSuit.className = `value trump-${trumpSuit}`;

    $myBidDisplay.textContent = "-";
    $myTricksDisplay.textContent = "0";

    // Update players and score from server data
    if (msg.players) {
      players = msg.players;
    }
    const myData = players.find(p => p.id === myPlayerId);
    if (myData) $myScore.textContent = `Score: ${myData.total_score || 0}`;

    renderOpponents();
    renderHand();
    clearTrickArea();
    hideStatus();
  }

  function onBidTurn(msg) {
    currentPhase = "bidding";
    currentTurnId = msg.current_bidder_id;
    const numCardsForBid = msg.num_cards;
    const forbiddenBid = msg.forbidden_bid;
    const bidsPlaced = msg.bids_so_far || {};

    updateOpponentBids(bidsPlaced);

    if (currentTurnId === myPlayerId) {
      showBidModal(numCardsForBid, forbiddenBid);
    } else {
      closeBidModal();
      const bidder = getPlayerName(currentTurnId);
      showStatus(`${bidder} is bidding...`);
    }

    highlightCurrentTurn(currentTurnId);
  }

  function onBidPlaced(msg) {
    const { player_id, bid } = msg;

    if (player_id === myPlayerId) {
      myBid = bid;
      $myBidDisplay.textContent = bid;
      closeBidModal();
    }

    updateSingleOpponentBid(player_id, bid);
    hideStatus();
  }

  function onPlayTurn(msg) {
    currentPhase = "playing";
    currentTurnId = msg.current_player_id;
    highlightCurrentTurn(currentTurnId);

    if (currentTurnId !== myPlayerId) {
      const playerName = getPlayerName(currentTurnId);
      showStatus(`${playerName}'s turn...`);
    } else {
      hideStatus();
    }
  }

  function onPlayRequest(msg) {
    validCards = msg.valid_cards || [];
    myHand = msg.hand || myHand;
    renderHand();
    showStatus("Your turn – play a card");
  }

  function onCardPlayed(msg) {
    const { player_id, player_name, card } = msg;

    trickCardsPlayed.push({ player_id, player_name, card });
    renderTrickCards();

    if (player_id === myPlayerId) {
      myHand = myHand.filter(
        (c) => !(c.suit === card.suit && c.rank === card.rank)
      );
      validCards = [];
      renderHand();
    }
    hideStatus();
  }

  function onTrickResult(msg) {
    const { winner_id, winner_name } = msg;
    $trickMessage.textContent = `${winner_name} wins the trick!`;
    $trickMessage.classList.add("trick-win");

    if (winner_id === myPlayerId) {
      myTricksWon++;
      $myTricksDisplay.textContent = myTricksWon;
    }
    updateOpponentTricks(winner_id);

    // Update game state from server
    if (msg.game && msg.game.players) {
      // Server sends updated player data, sync it
    }

    setTimeout(() => {
      trickCardsPlayed = [];
      renderTrickCards();
      $trickMessage.textContent = "";
      $trickMessage.classList.remove("trick-win");
    }, 1800);
  }

  function onRoundResult(msg) {
    currentPhase = "round_result";
    const results = msg.results || [];
    hideStatus();
    clearHighlights();

    // Update internal scores
    results.forEach(r => {
      const p = players.find(pl => pl.id === r.player_id);
      if (p) p.total_score = r.total_score;
    });
    const me = players.find(p => p.id === myPlayerId);
    if (me) $myScore.textContent = `Score: ${me.total_score}`;

    $roundResultTableBody.innerHTML = "";
    results.forEach((r) => {
      const tr = document.createElement("tr");
      const isMe = r.player_id === myPlayerId;
      if (isMe) tr.classList.add("is-me");

      const bidMet = r.tricks_won === r.bid;
      tr.innerHTML = `
        <td>${r.player_name}${isMe ? " (You)" : ""}</td>
        <td>${r.bid}</td>
        <td>${r.tricks_won}</td>
        <td class="${bidMet ? "points-positive" : "points-zero"}">${bidMet ? "+" : ""}${r.points_earned}</td>
        <td>${r.total_score}</td>
      `;
      $roundResultTableBody.appendChild(tr);
    });

    // Sync host from server
    if (msg.game && msg.game.host_id) {
      isHost = msg.game.host_id === myPlayerId;
      localStorage.setItem("is_host", isHost ? "true" : "false");
    }

    if (isHost) {
      $btnNextRound.style.display = "block";
      hideStatus();
    } else {
      $btnNextRound.style.display = "none";
      showStatus("Waiting for host to start next round...");
    }

    $roundResultModal.style.display = "flex";
  }

  function onGameOver(msg) {
    currentPhase = "game_over";
    localStorage.setItem("game_phase", "ended");
    const results = msg.results || {};
    const rankings = results.rankings || [];
    const winner = results.winner;
    hideStatus();
    closeAllModals();

    if (winner) {
      const isMe = winner.player_id === myPlayerId;
      $winnerAnnouncement.innerHTML = isMe
        ? `🏆 You Won! 🏆`
        : `🏆 ${winner.player_name} Won! 🏆`;
    }

    $finalResultTableBody.innerHTML = "";
    rankings.forEach((r) => {
      const tr = document.createElement("tr");
      const isMe = r.player_id === myPlayerId;
      if (isMe) tr.classList.add("is-me");

      let medal = "";
      if (r.rank === 1) medal = "🥇 ";
      else if (r.rank === 2) medal = "🥈 ";
      else if (r.rank === 3) medal = "🥉 ";

      tr.innerHTML = `
        <td>${medal}${r.rank}</td>
        <td>${r.player_name}${isMe ? " (You)" : ""}</td>
        <td>${r.total_score}</td>
      `;
      $finalResultTableBody.appendChild(tr);
    });

    $gameOverModal.style.display = "flex";
  }

  // ── Rendering ──

  function renderHand() {
    $myHand.innerHTML = "";
    const suitOrder = ["spades", "hearts", "diamonds", "clubs"];
    const sorted = [...myHand].sort((a, b) => {
      const si = suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
      if (si !== 0) return si;
      return a.rank - b.rank;
    });

    const totalCards = sorted.length;
    sorted.forEach((card, index) => {
      const el = createCardElement(card);

      const isPlayable = validCards.some(
        (vc) => vc.suit === card.suit && vc.rank === card.rank
      );

      if (currentPhase === "playing" && currentTurnId === myPlayerId) {
        if (isPlayable) {
          el.classList.add("playable");
          el.addEventListener("click", () => {
            el.classList.add("card-playing");
            playCard(card);
          });
        } else {
          el.classList.add("disabled");
        }
      }

      // Add slight rotation for fan effect
      if (totalCards > 1) {
        const mid = (totalCards - 1) / 2;
        const angle = (index - mid) * 3;
        const lift = -Math.abs(index - mid) * 2;
        el.style.setProperty("--fan-angle", `${angle}deg`);
        el.style.setProperty("--fan-lift", `${lift}px`);
      }

      $myHand.appendChild(el);
    });
  }

  function createCardElement(card) {
    const el = document.createElement("div");
    const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
    el.className = `card ${isRed ? 'red' : 'black'}`;
    el.dataset.suit = card.suit;
    el.dataset.rank = card.rank;
    const rankSym = RANK_SYMBOLS[card.rank] || card.rank;
    const suitSym = SUIT_SYMBOLS[card.suit] || card.suit;

    el.innerHTML = `
      <div class="card-corner card-top">
        <span class="card-rank">${rankSym}</span>
        <span class="card-suit-small">${suitSym}</span>
      </div>
      <div class="card-center">
        <span>${suitSym}</span>
      </div>
      <div class="card-corner card-bottom">
        <span class="card-rank">${rankSym}</span>
        <span class="card-suit-small">${suitSym}</span>
      </div>
    `;
    return el;
  }

  function renderOpponents() {
    $opponents.innerHTML = "";
    const otherPlayers = players.filter((p) => p.id !== myPlayerId);

    otherPlayers.forEach((p) => {
      const container = document.createElement("div");
      container.className = "opponent-avatar-container";
      container.id = `opponent-${p.id}`;

      const initials = getInitials(p.name);

      // Avatar circle
      const avatar = document.createElement("div");
      avatar.className = "avatar-circle";
      avatar.innerHTML = `<span>${initials}</span>`;

      // Bid/Tricks info badge
      const badge = document.createElement("div");
      badge.className = "bid-badge";
      badge.id = `obadge-${p.id}`;
      badge.style.display = "none";

      // Info under avatar
      const info = document.createElement("div");
      info.className = "opponent-info";
      info.innerHTML = `
        <span class="name">${p.name}</span>
        <span class="stats" id="ostats-${p.id}"></span>
      `;

      // Card count indicator
      const cardCount = document.createElement("div");
      cardCount.className = "card-count";
      cardCount.id = `ocards-${p.id}`;
      if (p.hand_count > 0) {
        cardCount.textContent = `${p.hand_count} 🃏`;
        cardCount.style.display = "block";
      } else {
        cardCount.style.display = "none";
      }

      container.appendChild(avatar);
      container.appendChild(badge);
      container.appendChild(info);
      $opponents.appendChild(container);
    });
  }

  function getInitials(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  function updateOpponentBids(bidsMap) {
    Object.entries(bidsMap).forEach(([pid, bid]) => {
      if (pid === myPlayerId) {
        myBid = bid;
        $myBidDisplay.textContent = bid;
      } else {
        updateSingleOpponentBid(pid, bid);
      }
    });
  }

  function updateSingleOpponentBid(playerId, bid) {
    const badge = document.getElementById(`obadge-${playerId}`);
    const stats = document.getElementById(`ostats-${playerId}`);

    if (badge) {
      badge.textContent = bid;
      badge.style.display = "flex";
    }
    if (stats) {
      stats.textContent = `0/${bid}`;
      stats.dataset.bid = bid;
      stats.dataset.tricks = 0;
    }
  }

  function updateOpponentTricks(winnerId) {
    if (winnerId === myPlayerId) return;
    const stats = document.getElementById(`ostats-${winnerId}`);
    if (stats) {
      let currentTricks = parseInt(stats.dataset.tricks || "0");
      let bid = stats.dataset.bid || "-";
      currentTricks++;
      stats.dataset.tricks = currentTricks;
      stats.textContent = `${currentTricks}/${bid}`;
    }
  }

  function renderTrickCards() {
    $trickCards.innerHTML = "";
    trickCardsPlayed.forEach(({ player_id, player_name, card }, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "trick-card-wrapper";
      wrapper.style.animationDelay = `${index * 0.1}s`;

      const label = document.createElement("div");
      label.className = "trick-card-label";
      const isMe = player_id === myPlayerId;
      label.textContent = isMe ? "You" : player_name;

      const cardEl = createCardElement(card);
      cardEl.classList.add("trick-table-card");

      wrapper.appendChild(label);
      wrapper.appendChild(cardEl);
      $trickCards.appendChild(wrapper);
    });
  }

  function clearTrickArea() {
    $trickCards.innerHTML = "";
    $trickMessage.textContent = "";
    $trickMessage.classList.remove("trick-win");
    trickCardsPlayed = [];
  }

  function highlightCurrentTurn(playerId) {
    clearHighlights();

    if (playerId === myPlayerId) {
      const playerIdentity = document.querySelector(".player-identity");
      if (playerIdentity) playerIdentity.classList.add("active-turn");
      const myAvatar = document.querySelector(".my-avatar");
      if (myAvatar) myAvatar.classList.add("active-turn-glow");
    } else {
      const container = document.getElementById(`opponent-${playerId}`);
      if (container) container.classList.add("active-turn");
    }
  }

  function clearHighlights() {
    document.querySelectorAll(".active-turn").forEach((el) => {
      el.classList.remove("active-turn");
    });
    document.querySelectorAll(".active-turn-glow").forEach((el) => {
      el.classList.remove("active-turn-glow");
    });
    document.querySelectorAll(".active-turn-me").forEach((el) => {
      el.classList.remove("active-turn-me");
    });
  }

  function getSuitColor(suit) {
    return (suit === 'hearts' || suit === 'diamonds') ? '#ef4444' : '#ffffff';
  }

  // ── Bidding ──

  function showBidModal(numCardsForBid, forbiddenBid) {
    $bidOptions.innerHTML = "";
    $bidInfo.textContent = `You have ${numCardsForBid} card${numCardsForBid !== 1 ? "s" : ""}. How many tricks will you win?`;

    for (let i = 0; i <= numCardsForBid; i++) {
      const btn = document.createElement("button");
      btn.className = "bid-btn";
      btn.textContent = i;

      if (forbiddenBid !== null && forbiddenBid !== undefined && i === forbiddenBid) {
        btn.classList.add("forbidden");
        btn.disabled = true;
        btn.title = `Cannot bid ${i} (total would equal ${numCardsForBid})`;
      } else {
        btn.addEventListener("click", () => {
          placeBid(i);
        });
      }
      $bidOptions.appendChild(btn);
    }
    $bidModal.style.display = "flex";
    hideStatus();
  }

  function closeBidModal() {
    $bidModal.style.display = "none";
  }

  function placeBid(bid) {
    send({ type: "place_bid", bid: bid });
    closeBidModal();
  }

  function playCard(card) {
    send({ type: "play_card", suit: card.suit, rank: card.rank });
    validCards = [];
    renderHand();
  }

  function closeAllModals() {
    $bidModal.style.display = "none";
    $roundResultModal.style.display = "none";
    $gameOverModal.style.display = "none";
    $scoreboardModal.style.display = "none";
  }

  // ── Scoreboard ──

  function showScoreboard() {
    $scoreboardTableBody.innerHTML = "";
    const sorted = [...players].sort(
      (a, b) => (b.total_score || 0) - (a.total_score || 0)
    );
    sorted.forEach((p, index) => {
      const tr = document.createElement("tr");
      const isMe = p.id === myPlayerId;
      if (isMe) tr.classList.add("is-me");
      tr.innerHTML = `
        <td>${p.name}${isMe ? " (You)" : ""}</td>
        <td>${p.total_score || 0}</td>
      `;
      $scoreboardTableBody.appendChild(tr);
    });
    $scoreboardModal.style.display = "flex";
  }

  // ── Event Listeners ──

  $btnNextRound.addEventListener("click", () => {
    send({ type: "next_round" });
    $roundResultModal.style.display = "none";
    showStatus("Starting next round...");
    setTimeout(hideStatus, 2000);
  });

  $btnScoreboard.addEventListener("click", showScoreboard);

  $btnCloseScoreboard.addEventListener("click", () => {
    $scoreboardModal.style.display = "none";
  });

  [$bidModal, $roundResultModal, $scoreboardModal].forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal && modal !== $bidModal) {
        modal.style.display = "none";
      }
    });
  });

  // ── Init ──
  if (!roomCode) {
    window.location.href = "/";
  } else {
    connectWS();
  }
})();
