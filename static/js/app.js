// ── Landing Page & Waiting Room Logic ──

(function () {
  "use strict";

  // DOM elements
  const $playerName = document.getElementById("player-name");
  const $btnCreate = document.getElementById("btn-create");
  const $btnJoin = document.getElementById("btn-join");
  const $roomCode = document.getElementById("room-code");
  const $errorMsg = document.getElementById("error-msg");

  // Waiting room elements
  const $waitingRoom = document.getElementById("waiting-room");
  const $displayRoomCode = document.getElementById("display-room-code");
  const $btnCopyCode = document.getElementById("btn-copy-code");
  const $playerList = document.getElementById("player-list");
  const $btnStart = document.getElementById("btn-start");

  // Form section (to hide after joining)
  const $formSection = document.querySelector(".form-section");
  const $buttonGroup = document.querySelector(".button-group");

  // ── Persistent State (localStorage) ──
  const savedRoom = localStorage.getItem("room_code");
  const savedName = localStorage.getItem("player_name");
  const gamePhase = localStorage.getItem("game_phase");

  // On load: redirect to game if in progress
  if (savedRoom && savedName && gamePhase === "in_progress") {
    window.location.replace(
      `/game?room=${encodeURIComponent(savedRoom)}&name=${encodeURIComponent(savedName)}`
    );
    return;
  }

  let ws = null;
  let myPlayerId = null;
  let isHost = false;
  let currentRoomCode = null;
  let currentHostId = null;
  let reconnecting = false; // true when auto-reconnecting on page load

  // ── Helpers ──

  function showError(msg) {
    $errorMsg.textContent = msg;
    $errorMsg.style.display = "block";
    setTimeout(() => {
      $errorMsg.style.display = "none";
    }, 4000);
  }

  function hideError() {
    $errorMsg.style.display = "none";
  }

  function getName() {
    const name = $playerName.value.trim();
    if (!name) {
      showError("Please enter your name.");
      return null;
    }
    if (name.length > 20) {
      showError("Name must be 20 characters or less.");
      return null;
    }
    return name;
  }

  // ── WebSocket ──

  function connectWS(onOpen) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("WebSocket connected");
      if (onOpen) onOpen();
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      if (!reconnecting) {
        showError("Connection error. Please refresh the page.");
      }
    };

    ws.onclose = () => {
      console.log("WebSocket closed");
    };
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // ── Message Handler ──

  function handleMessage(msg) {
    switch (msg.type) {
      case "connected":
        myPlayerId = msg.player_id;
        localStorage.setItem("player_id", myPlayerId);
        break;

      case "room_created":
        currentRoomCode = msg.room_code;
        currentHostId = msg.game ? msg.game.host_id : myPlayerId;
        isHost = true;
        localStorage.setItem("room_code", currentRoomCode);
        localStorage.setItem("is_host", "true");
        localStorage.setItem("player_name", $playerName.value.trim());
        localStorage.setItem("game_phase", "waiting");
        showWaitingRoom(msg.room_code, msg.players || []);
        break;

      case "room_joined":
        currentRoomCode = msg.room_code;
        currentHostId = msg.game ? msg.game.host_id : null;
        isHost = currentHostId === myPlayerId;
        localStorage.setItem("room_code", currentRoomCode);
        localStorage.setItem("is_host", isHost ? "true" : "false");
        // Use input value or saved name (for reconnects)
        const joinName = $playerName.value.trim() || savedName || "";
        if (joinName) localStorage.setItem("player_name", joinName);
        localStorage.setItem("game_phase", "waiting");
        reconnecting = false;
        showWaitingRoom(msg.room_code, msg.players || []);
        break;

      case "player_joined":
        if (msg.host_id) currentHostId = msg.host_id;
        updatePlayerList(msg.players || []);
        break;

      case "player_left":
        if (msg.new_host_id) currentHostId = msg.new_host_id;
        updatePlayerList(msg.players || []);
        if (msg.new_host_id === myPlayerId) {
          isHost = true;
          localStorage.setItem("is_host", "true");
          $btnStart.style.display = "block";
        }
        break;

      case "player_disconnected":
        // Player temporarily disconnected – update list but don't remove them
        updatePlayerList(msg.players || []);
        break;

      case "game_started":
        localStorage.setItem("game_phase", "in_progress");
        const name =
          $playerName.value.trim() || localStorage.getItem("player_name");
        const room = currentRoomCode || localStorage.getItem("room_code");
        const gameUrl =
          room && name
            ? `/game?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`
            : "/game";
        window.location.href = gameUrl;
        break;

      case "error":
        if (reconnecting) {
          // Reconnect failed (room gone, etc) – clear saved state and show form
          reconnecting = false;
          localStorage.removeItem("room_code");
          localStorage.removeItem("game_phase");
          console.log("Auto-reconnect failed:", msg.message);
        } else {
          showError(msg.message);
        }
        break;

      default:
        console.log("Unhandled message:", msg);
    }
  }

  // ── Waiting Room ──

  function showWaitingRoom(roomCode, players) {
    hideError();
    $formSection.style.display = "none";
    $buttonGroup.style.display = "none";
    $waitingRoom.style.display = "block";
    $displayRoomCode.textContent = roomCode;
    updatePlayerList(players);
  }

  function updatePlayerList(players) {
    $playerList.innerHTML = "";
    players.forEach((p) => {
      const li = document.createElement("li");
      li.textContent = p.name;
      if (p.id === myPlayerId) {
        li.textContent += " (You)";
        li.classList.add("is-you");
      }
      if (p.id === currentHostId) {
        li.textContent += " \u2605";
        li.classList.add("is-host");
      }
      $playerList.appendChild(li);
    });

    // Show/hide start button
    if (isHost && players.length >= 3) {
      $btnStart.style.display = "block";
    } else {
      $btnStart.style.display = "none";
    }
  }

  // ── Event Listeners ──

  $btnCreate.addEventListener("click", () => {
    const name = getName();
    if (!name) return;
    hideError();
    connectWS(() => {
      send({ type: "create_room", player_name: name });
    });
  });

  $btnJoin.addEventListener("click", () => {
    const name = getName();
    if (!name) return;
    const code = $roomCode.value.trim().toUpperCase();
    if (!code || code.length !== 6) {
      showError("Please enter a valid 6-character room code.");
      return;
    }
    hideError();
    connectWS(() => {
      send({ type: "join_room", player_name: name, room_code: code });
    });
  });

  $btnCopyCode.addEventListener("click", () => {
    if (currentRoomCode) {
      navigator.clipboard.writeText(currentRoomCode).then(() => {
        $btnCopyCode.textContent = "Copied!";
        setTimeout(() => {
          $btnCopyCode.textContent = "Copy";
        }, 2000);
      });
    }
  });

  $btnStart.addEventListener("click", () => {
    send({ type: "start_game" });
  });

  // Allow Enter key to submit
  $playerName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $btnCreate.click();
  });

  $roomCode.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $btnJoin.click();
  });

  // ── Auto-reconnect on page load ──
  // If we had a saved waiting-room session, reconnect automatically
  if (savedRoom && savedName && gamePhase === "waiting") {
    reconnecting = true;
    // Pre-fill the name field so it's visible
    $playerName.value = savedName;
    connectWS(() => {
      send({
        type: "join_room",
        player_name: savedName,
        room_code: savedRoom,
      });
    });
  }
})();
