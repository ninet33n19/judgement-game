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

  let ws = null;
  let myPlayerId = null;
  let isHost = false;
  let currentRoomCode = null;
  let currentHostId = null;

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
      showError("Connection error. Please refresh the page.");
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
        sessionStorage.setItem("player_id", myPlayerId);
        break;

      case "room_created":
        currentRoomCode = msg.room_code;
        currentHostId = msg.game ? msg.game.host_id : myPlayerId;
        isHost = true;
        sessionStorage.setItem("room_code", currentRoomCode);
        sessionStorage.setItem("is_host", "true");
        sessionStorage.setItem("player_name", $playerName.value.trim());
        showWaitingRoom(msg.room_code, msg.players || []);
        break;

      case "room_joined":
        currentRoomCode = msg.room_code;
        currentHostId = msg.game ? msg.game.host_id : null;
        isHost = currentHostId === myPlayerId;
        sessionStorage.setItem("room_code", currentRoomCode);
        sessionStorage.setItem("is_host", isHost ? "true" : "false");
        sessionStorage.setItem("player_name", $playerName.value.trim());
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
          sessionStorage.setItem("is_host", "true");
          $btnStart.style.display = "block";
        }
        break;

      case "game_started":
        // Navigate to game page — the WS will be re-established there
        window.location.href = "/game";
        break;

      case "error":
        showError(msg.message);
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
    if (isHost && players.length >= 4) {
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
})();
