"""FastAPI application: HTTP routes, WebSocket endpoint, static file serving."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .websocket_handler import ConnectionManager

# Resolve static directory
STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"

app = FastAPI(title="Judgement Card Game")
manager = ConnectionManager()


# --- Static file serving ---


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/game")
async def game_page():
    return FileResponse(STATIC_DIR / "game.html")


# Mount static files AFTER specific routes
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# --- WebSocket endpoint ---


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    player_id = await manager.handle_connect(websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await manager.send_to_player(
                    player_id,
                    {
                        "type": "error",
                        "message": "Invalid JSON",
                    },
                )
                continue
            await manager.handle_message(player_id, data)
    except WebSocketDisconnect:
        await manager.handle_disconnect(player_id)
    except Exception:
        await manager.handle_disconnect(player_id)
