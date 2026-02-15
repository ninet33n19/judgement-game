const AVATARS = ["eli.png", "gina.png", "jane.png", "joshua.png", "rose.png", "steve.png"];
let socket;
let state = null;
let myId = null;
let hasVotedToEnd = false;
let assignedAvatars = {};
let selectedHandIndex = null;

function getAvatar(playerName) {
    if (!assignedAvatars[playerName]) {
        const usedCount = Object.keys(assignedAvatars).length;
        const avatarIndex = usedCount % AVATARS.length;
        assignedAvatars[playerName] = AVATARS[avatarIndex];
    }
    return assignedAvatars[playerName];
}

// Skribbl-style URL: room code in query (?ROOMCODE)
function getRoomCodeFromUrl() {
    const search = window.location.search;
    if (!search || search.length < 2) return null;
    const code = search.slice(1).toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(code)) return code;
    return null;
}

function updateUrlWithRoom(roomId) {
    const base = window.location.pathname || "/";
    const url = roomId ? `${base}?${roomId}` : base;
    window.history.replaceState(null, "", url);
}

function clearUrlRoom() {
    updateUrlWithRoom(null);
}

function init() {
    socket = io();

    setupEventListeners();
    loadCredentials();
    applyUrlRoomToForm();
    setupSocketHandlers();
}

function loadCredentials() {
    // 1. Try to recover active session from sessionStorage
    const activeSession = sessionStorage.getItem("judgement_session");
    if (activeSession) {
        try {
            const creds = JSON.parse(activeSession);
            if (creds.name && creds.roomId && creds.sessionToken) {
                console.log("Found active session, attempting auto-rejoin...");
                // Note: socket might not be ready yet, but socket.on('connect') will handle it
                return; 
            }
        } catch (e) {
            console.error("Failed to load active session", e);
        }
    }

    // 2. Fallback to sessionStorage for pre-filling the form if they refreshed
    const saved = sessionStorage.getItem("judgement_credentials");
    if (saved) {
        try {
            const creds = JSON.parse(saved);
            document.getElementById("name-input").value = creds.name || "";
            document.getElementById("room-input").value = creds.roomId || "";
        } catch (e) {
            console.error("Failed to load credentials", e);
        }
    }
}

function applyUrlRoomToForm() {
    const roomFromUrl = getRoomCodeFromUrl();
    if (roomFromUrl) {
        const roomInput = document.getElementById("room-input");
        if (roomInput && !roomInput.value.trim()) roomInput.value = roomFromUrl;
    }
}

function saveCredentials(name, roomId, sessionToken) {
    // Save to sessionStorage for pre-filling if they refresh
    sessionStorage.setItem("judgement_credentials", JSON.stringify({ name, roomId }));
    
    // Save to sessionStorage for active reconnection/refresh
    if (sessionToken) {
        sessionStorage.setItem("judgement_session", JSON.stringify({ name, roomId, sessionToken }));
    }
}

function clearCredentials() {
    // Clear everything from sessionStorage
    sessionStorage.removeItem("judgement_session");
    sessionStorage.removeItem("judgement_credentials");
}

function setupEventListeners() {
    const nameInput = document.getElementById("name-input");
    const roomInput = document.getElementById("room-input");

    nameInput?.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            if (roomInput?.value.trim()) {
                document.getElementById("join-btn")?.click();
            } else {
                roomInput?.focus();
            }
        }
    });

    roomInput?.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            document.getElementById("join-btn")?.click();
        }
    });

    const createBtn = document.getElementById("create-btn");
    if (createBtn) createBtn.addEventListener("click", () => {
        const name = document.getElementById("name-input").value.trim();
        if (!name) {
            showToast("Please enter your name", "error");
            nameInput?.focus();
            return;
        }
        socket.emit("create_room", { name });
    });

    const joinBtn = document.getElementById("join-btn");
    if (joinBtn) joinBtn.addEventListener("click", () => {
        const name = document.getElementById("name-input").value.trim();
        const roomId = document.getElementById("room-input").value.trim().toUpperCase();
        
        if (!name) {
            showToast("Please enter your name", "error");
            nameInput?.focus();
            return;
        }
        if (!roomId) {
            showToast("Please enter room code", "error");
            roomInput?.focus();
            return;
        }
        socket.emit("join_game", { roomId, name });
    });

    const startBtn = document.getElementById("start-btn");
    if (startBtn) startBtn.addEventListener("click", () => {
        socket.emit("start_game");
    });

    const copyBtn = document.getElementById("copy-code-btn");
    if (copyBtn) copyBtn.addEventListener("click", () => {
        const code = document.getElementById("room-name").textContent;
        if (code && code !== "------") {
            const url = window.location.href;
            const toCopy = url.includes("?") ? url : `${url}?${code}`;
            navigator.clipboard.writeText(toCopy).then(() => {
                showToast("Link copied!", "success");
            }).catch(() => {
                showToast("Failed to copy", "error");
            });
        }
    });

    const restartBtn = document.getElementById("restart-btn");
    if (restartBtn) restartBtn.addEventListener("click", () => {
        clearCredentials();
        window.location.reload();
    });

    const exitButtons = [
        "exit-btn-lobby", "exit-btn-bidding",
        "exit-btn-roundover", "exit-btn-gameover"
    ];
    
    const exitBtnPlaying = document.getElementById("exit-btn-playing");
    if (exitBtnPlaying) {
        exitBtnPlaying.addEventListener("click", handleExit);
    }

    exitButtons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener("click", handleExit);
        }
    });

    const playBtn = document.getElementById("btn-play-card");
    if (playBtn) {
        playBtn.addEventListener("click", () => {
            if (selectedHandIndex !== null) {
                socket.emit("play_card", selectedHandIndex);
                selectedHandIndex = null;
            } else {
                showToast("Select a card first", "error");
            }
        });
    }

    document.addEventListener("keydown", (e) => {
        if (!state || state.phase !== "PLAYING") return;
        
        if (e.code === "Space" && selectedHandIndex !== null) {
            e.preventDefault();
            socket.emit("play_card", selectedHandIndex);
            selectedHandIndex = null;
        }
        
        if (e.key >= "1" && e.key <= "9") {
            const index = parseInt(e.key) - 1;
            const me = state.players.find(p => p.id === myId);
            if (me && index < me.hand.length) {
                selectedHandIndex = index;
                renderHandNew("hand-area");
                updatePlayButton();
            }
        }
    });
}

function handleExit() {
    if (state && state.phase !== "LOBBY" && state.phase !== "GAME_OVER") {
        if (!confirm("Are you sure you want to leave? Your progress will be lost.")) {
            return;
        }
    }

    socket.emit("player_exit");
    clearCredentials();
    clearUrlRoom();
    socket.disconnect();
    state = null;
    myId = null;
    assignedAvatars = {};
    selectedHandIndex = null;
    showScreen("join-screen");
}

function setupSocketHandlers() {
    const connectionStatus = document.getElementById("connection-status");
    
    socket.on("connect", () => {
        updateConnectionStatus("connected");
        
        // Try to reconnect using sessionStorage first (Active Session)
        const activeSession = sessionStorage.getItem("judgement_session");
        if (activeSession) {
            try {
                const creds = JSON.parse(activeSession);
                if (creds.name && creds.roomId && creds.sessionToken) {
                    console.log("Re-joining active session...");
                    socket.emit("join_game", { 
                        roomId: creds.roomId, 
                        name: creds.name, 
                        sessionToken: creds.sessionToken 
                    });
                }
            } catch (e) {
                console.error("Failed to parse active session", e);
            }
        }
    });

    socket.on("reconnecting", () => {
        updateConnectionStatus("connecting");
    });

    socket.on("reconnected", (data) => {
        updateConnectionStatus("connected");
        showToast("Reconnected!", "success");
        if (data && data.roomId) updateUrlWithRoom(data.roomId);
        if (data && data.sessionToken) {
            let name = document.getElementById("name-input").value.trim();
            if (!name) {
                const activeSession = sessionStorage.getItem("judgement_session");
                if (activeSession) {
                    try {
                        name = JSON.parse(activeSession).name;
                    } catch (e) {}
                }
            }
            saveCredentials(name, data.roomId, data.sessionToken);
        }
    });

    socket.on("disconnect", () => {
        updateConnectionStatus("disconnected");
    });

    socket.on("room_created", (data) => {
        const name = document.getElementById("name-input").value.trim();
        const roomId = data.roomId;
        saveCredentials(name, roomId, data.sessionToken);
        updateUrlWithRoom(roomId);
        showScreen("lobby-screen");
        showToast("Room created!", "success");
    });

    socket.on("joined_game", (data) => {
        const name = document.getElementById("name-input").value.trim();
        saveCredentials(name, data.roomId, data.sessionToken);
        updateUrlWithRoom(data.roomId);
        showToast("Joined game!", "success");
    });

    socket.on("state_update", (newState) => {
        state = newState;
        myId = state.me;
        hasVotedToEnd = state.endGameVotes?.includes(myId) || false;

        if (state.phase === "LOBBY") {
            renderLobby();
        } else if (state.phase === "BIDDING") {
            renderBidding();
        } else if (state.phase === "PLAYING") {
            renderPlaying();
        } else if (state.phase === "ROUND_OVER") {
            renderRoundOver();
        } else if (state.phase === "GAME_OVER") {
            renderGameOver();
        }

        updateVoteUI();
    });

    socket.on("trick_won", (data) => {
        showToast(`${data.winner} won the trick!`, "success");
    });

    socket.on("error", (msg) => {
        showToast(msg, "error");
    });
}

function updateConnectionStatus(status) {
    const el = document.getElementById("connection-status");
    if (!el) return;
    
    el.classList.remove("hidden", "connecting", "disconnected");
    
    if (status === "connected") {
        el.classList.add("hidden");
    } else if (status === "connecting") {
        el.classList.add("connecting");
        el.querySelector(".text").textContent = "Connecting...";
    } else if (status === "disconnected") {
        el.classList.add("disconnected");
        el.querySelector(".text").textContent = "Disconnected";
    }
}

function showScreen(screenId) {
    document.querySelectorAll(".screen").forEach(s => {
        s.classList.add("hidden");
        s.style.display = "none";
    });
    
    const screen = document.getElementById(screenId);
    if (screen) {
        screen.classList.remove("hidden");
        screen.style.display = "flex";
        screen.style.animation = "none";
        screen.offsetHeight;
        screen.style.animation = "fadeIn var(--transition-normal) ease-out";
    }
}

function showToast(msg, type = "info") {
    const toast = document.getElementById("toast");
    if (!toast) return;
    
    toast.textContent = msg;
    toast.className = "toast show";
    if (type === "success") toast.classList.add("success");
    if (type === "error") toast.classList.add("error");
    
    setTimeout(() => {
        toast.classList.remove("show");
        toast.classList.add("hidden");
    }, 3000);
}

function renderLobby() {
    showScreen("lobby-screen");
    document.getElementById("room-name").textContent = state.roomId || "------";

    const playerCountCurrent = document.getElementById("player-count-current");
    const playerCountMax = document.getElementById("player-count-max");
    if (playerCountCurrent) playerCountCurrent.textContent = state.players.length;
    if (playerCountMax) playerCountMax.textContent = "6";

    const grid = document.getElementById("player-grid");
    const maxPlayers = 6;
    const players = state.players;
    const isHost = players[0]?.id === myId;

    let html = "";
    
    for (let i = 0; i < maxPlayers; i++) {
        const player = players[i];
        const isFilled = !!player;
        const isPlayerHost = i === 0;
        const animationDelay = i * 50;
        
        if (isFilled) {
            html += `
                <div class="player-slot filled ${isPlayerHost ? 'host' : ''}" style="animation-delay: ${animationDelay}ms">
                    <div class="player-circle">
                        <img src="assets/avatars/${getAvatar(player.name)}" alt="${player.name}" />
                        <span class="online-indicator"></span>
                    </div>
                    <span class="player-name-lobby">${player.name}</span>
                    ${isPlayerHost ? '<span class="host-badge">Host</span>' : ''}
                </div>
            `;
        } else {
            html += `
                <div class="player-slot" style="animation-delay: ${animationDelay}ms">
                    <div class="player-circle">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.3">
                            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                    </div>
                    <span class="player-name-lobby">Waiting...</span>
                </div>
            `;
        }
    }
    
    grid.innerHTML = html;

    const startBtn = document.getElementById("start-btn");
    if (startBtn) {
        const canStart = isHost && state.players.length >= 3;
        startBtn.disabled = !canStart;
        
        if (canStart) {
            startBtn.classList.add("ready");
            startBtn.textContent = "Start Game";
        } else {
            startBtn.classList.remove("ready");
            if (state.players.length < 3) {
                startBtn.textContent = `Need ${3 - state.players.length} more player${3 - state.players.length > 1 ? 's' : ''}`;
            } else {
                startBtn.textContent = "Start Game";
            }
        }
    }
}

function renderBidding() {
    showScreen("bidding-screen");

    document.getElementById("round-num").textContent = state.roundNumber;
    document.getElementById("trump-suit").textContent = getSuitSymbol(state.trumpSuit);
    document.getElementById("cards-count").textContent = state.cardsPerPlayer;
    document.getElementById("dealer-name").textContent = state.players[state.dealerIndex]?.name || "-";

    // Update dealer info
    const dealerBadge = document.getElementById("dealer-badge");
    const dealerName = document.getElementById("dealer-name");
    if (dealerBadge && dealerName) {
        const dealer = state.players[state.dealerIndex];
        if (dealer) {
            dealerBadge.style.display = "flex";
            dealerName.textContent = dealer.name;
        } else {
            dealerBadge.style.display = "none";
        }
    }

    renderHand("bid-hand-area", true);
    renderBidButtons();
    renderPlayerRow("player-row", true);
    updateVoteUI();
}

function renderPlaying() {
    showScreen("playing-screen");

    const roundNum = document.getElementById("play-round-num");
    if (roundNum) roundNum.textContent = state.roundNumber;

    const trumpContainer = document.getElementById("play-trump-suit");
    if (trumpContainer) {
        trumpContainer.textContent = state.trumpSuit ? getSuitSymbol(state.trumpSuit) : "?";
    }

    const me = state.players.find(p => p.id === myId);

    const scoreDisplay = document.getElementById("play-score-display");
    if (scoreDisplay) scoreDisplay.textContent = me ? `${me.score}` : "0";

    renderTopPlayers("play-player-row");
    renderTableCards("play-table-cards");
    renderHandNew("hand-area");

    if (me) {
        const bidEl = document.getElementById("my-bid");
        if (bidEl) bidEl.textContent = me.bid !== null ? me.bid : '-';
        
        const tricksEl = document.getElementById("my-tricks");
        if (tricksEl) tricksEl.textContent = me.tricksWon;

        const avatarEl = document.getElementById("my-mini-avatar");
        if (avatarEl) avatarEl.innerHTML = `<img src="assets/avatars/${getAvatar(me.name)}" />`;
    }

    updatePlayButton();
    updateVoteUI();
}

function updatePlayButton() {
    const btn = document.getElementById("btn-play-card");
    if (!btn) return;
    
    btn.disabled = selectedHandIndex === null;
    
    if (selectedHandIndex !== null) {
        btn.textContent = "Play Card";
    } else {
        btn.textContent = "Select a Card";
    }
}

function renderHand(containerId, isBidding) {
    const container = document.getElementById(containerId);
    const me = state.players.find(p => p.id === myId);
    if (!me || !container) return;

    container.innerHTML = me.hand.map((card, i) => `
        <div class="card ${getSuitColor(card.suit)}" data-index="${i}" style="animation-delay: ${i * 50}ms">
            <div class="card-content">
                <span class="rank">${card.rank}</span>
                <span class="suit">${getSuitSymbol(card.suit)}</span>
            </div>
        </div>
    `).join("");
}

function renderHandNew(containerId) {
    const container = document.getElementById(containerId);
    const me = state.players.find(p => p.id === myId);
    if (!me || !container) return;

    container.innerHTML = me.hand.map((card, i) => {
        const isSelected = selectedHandIndex === i;
        return `
            <div class="card ${getSuitColor(card.suit)} ${isSelected ? 'selected' : ''}" data-index="${i}" style="animation-delay: ${i * 50}ms">
                <div class="card-content">
                    <span class="rank">${card.rank}</span>
                    <span class="suit">${getSuitSymbol(card.suit)}</span>
                </div>
            </div>
        `;
    }).join("");

    container.querySelectorAll(".card").forEach(cardEl => {
        cardEl.addEventListener("click", () => {
            const index = parseInt(cardEl.dataset.index);
            if (selectedHandIndex === index) {
                selectedHandIndex = null;
            } else {
                selectedHandIndex = index;
            }
            renderHandNew(containerId);
            updatePlayButton();
        });
    });
}

function renderBidButtons() {
    const me = state.players.find(p => p.id === myId);
    const prompt = document.getElementById("bid-prompt");
    const buttons = document.getElementById("bid-buttons");

    if (!me || !prompt || !buttons) return;

    if (me.bid !== null) {
        prompt.textContent = `Your bid: ${me.bid}`;
        buttons.innerHTML = "";
        return;
    }

    const isMyTurn = state.currentTurnIndex === state.players.findIndex(p => p.id === myId);

    if (!isMyTurn) {
        const currentPlayer = state.players[state.currentTurnIndex];
        prompt.textContent = `${currentPlayer?.name || "Player"} is bidding...`;
        buttons.innerHTML = "";
        return;
    }

    prompt.textContent = "Your bid?";

    const maxBid = state.cardsPerPlayer;
    const bids = [];
    for (let i = 0; i <= maxBid; i++) {
        if (i !== maxBid) bids.push(i);
    }
    if (!bids.includes(maxBid)) bids.push(maxBid);
    bids.sort((a, b) => a - b);

    buttons.innerHTML = bids.map(b => `
        <button class="bid-btn" data-bid="${b}">${b}</button>
    `).join("");

    buttons.querySelectorAll(".bid-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const bid = parseInt(btn.dataset.bid);
            socket.emit("place_bid", bid);
        });
    });
}

function renderTableCards(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const me = state.players.find(p => p.id === myId);
    const myHandCount = me?.hand.length || 0;
    const totalSlots = state.players.length;

    let html = "";
    
    for (let i = 0; i < totalSlots; i++) {
        const tableEntry = state.table[i];
        const player = state.players[i];
        
        if (tableEntry && tableEntry.card) {
            html += `
                <div class="played-card-slot">
                    <div class="card ${getSuitColor(tableEntry.card.suit)}" style="animation-delay: ${i * 80}ms">
                        <div class="card-content">
                            <span class="rank">${tableEntry.card.rank}</span>
                            <span class="suit">${getSuitSymbol(tableEntry.card.suit)}</span>
                        </div>
                    </div>
                </div>
            `;
        } else {
            html += `
                <div class="played-card-slot">
                    ${player ? `<span style="font-size: 0.625rem; color: var(--text-muted); text-transform: uppercase;">${player.name.charAt(0)}</span>` : ''}
                </div>
            `;
        }
    }
    
    container.innerHTML = html;
}

function renderPlayerRow(containerId, showBid) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const currentPlayerIndex = state.currentTurnIndex;

    container.innerHTML = state.players.map((p, i) => {
        const isActive = i === currentPlayerIndex;
        const animationDelay = i * 50;
        
        return `
            <div class="player-mini ${isActive ? 'active' : ''}" style="animation-delay: ${animationDelay}ms">
                <div class="mini-avatar">
                    <img src="assets/avatars/${getAvatar(p.name)}" alt="${p.name}" />
                </div>
                <span class="p-name">${p.name}</span>
                ${showBid ? `<span class="p-bid">Bid: <span>${p.bid !== null ? p.bid : '-'}</span></span>` : ''}
            </div>
        `;
    }).join("");
}

function renderTopPlayers(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const currentPlayerIndex = state.currentTurnIndex;
    const me = state.players.find(p => p.id === myId);
    const myHandCount = me?.hand.length || 0;

    const opponents = state.players.filter(p => p.id !== myId);

    container.innerHTML = opponents.map((p, idx) => {
        const realIndex = state.players.findIndex(pl => pl.id === p.id);
        const isActive = realIndex === currentPlayerIndex;
        const statsText = `<span class="score">${p.score}</span> <span class="separator">|</span> <span class="bid-won">${p.bid !== null ? p.bid : '-'}/${p.tricksWon}</span>`;
        const animationDelay = idx * 60;

        return `
            <div class="opponent-item ${isActive ? 'active-turn' : ''}" style="animation-delay: ${animationDelay}ms">
                <div class="opponent-avatar">
                    <img src="assets/avatars/${getAvatar(p.name)}" alt="${p.name}" />
                    <span class="card-count-badge">${p.hand.length}</span>
                </div>
                <div class="opponent-stats">${statsText}</div>
                ${isActive ? '<span class="turn-indicator">Your Turn</span>' : ''}
            </div>
        `;
    }).join("");
}

function renderRoundOver() {
    showScreen("round-over-screen");
    
    const roundResultNum = document.getElementById("round-result-num");
    if (roundResultNum) roundResultNum.textContent = state.roundNumber;

    const results = document.getElementById("round-results");
    const sortedPlayers = [...state.players].sort((a, b) => b.score - a.score);
    
    results.innerHTML = sortedPlayers.map((p, i) => {
        const isWinner = i === 0;
        const animationDelay = i * 80;
        
        return `
            <div class="result-row ${isWinner ? 'winner' : ''}" style="animation-delay: ${animationDelay}ms">
                <span class="rank">${i + 1}</span>
                <div class="player-info">
                    <div class="avatar-sm">
                        <img src="assets/avatars/${getAvatar(p.name)}" alt="${p.name}" />
                    </div>
                    <span class="name">${p.name}</span>
                </div>
                <span class="score-change">${p.score > 0 ? '+' : ''}${p.score}</span>
            </div>
        `;
    }).join("");
}

function renderGameOver() {
    showScreen("game-over-screen");
    const scores = document.getElementById("final-scores");
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    
    scores.innerHTML = sorted.map((p, i) => {
        const isWinner = i === 0;
        const animationDelay = i * 100;
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
        
        return `
            <div class="result-row ${isWinner ? 'winner' : ''}" style="animation-delay: ${animationDelay}ms">
                <span class="rank">${medal || i + 1}</span>
                <div class="player-info">
                    <div class="avatar-sm">
                        <img src="assets/avatars/${getAvatar(p.name)}" alt="${p.name}" />
                    </div>
                    <span class="name">${p.name}</span>
                </div>
                <span class="score-change">${p.score}</span>
            </div>
        `;
    }).join("");
}

function updateVoteUI() {
    document.querySelectorAll(".btn-vote").forEach(b => b.remove());
}

function getSuitSymbol(suit) {
    const map = { S: "♠", D: "♦", C: "♣", H: "♥" };
    return map[suit] || suit;
}

function getSuitColor(suit) {
    return (suit === "D" || suit === "H") ? "red" : "black";
}

document.addEventListener("DOMContentLoaded", init);
