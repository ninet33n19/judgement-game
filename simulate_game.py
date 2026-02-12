import asyncio
import json
import websockets
import sys

async def run_simulation():
    uri = "ws://127.0.0.1:8000/ws"

    # 1. Host creates room
    async with websockets.connect(uri) as ws_host:
        # Receive connected
        await ws_host.recv()
        
        # Create Room
        await ws_host.send(json.dumps({"type": "create_room", "player_name": "HostBot"}))
        resp = json.loads(await ws_host.recv())
        room_code = resp['room_code']
        print(f"ROOM_CODE:{room_code}")
        
        # 2. Player 2 joins
        async with websockets.connect(uri) as ws_p2:
            await ws_p2.recv() # connected
            await ws_p2.send(json.dumps({"type": "join_room", "player_name": "Bot2", "room_code": room_code}))
            await ws_p2.recv() # room_joined
            await ws_p2.recv() # player_joined (self) or from host?
            
            # 3. Player 3 joins
            async with websockets.connect(uri) as ws_p3:
                await ws_p3.recv() # connected
                await ws_p3.send(json.dumps({"type": "join_room", "player_name": "Bot3", "room_code": room_code}))
                await ws_p3.recv() # room_joined

                # 4. Host starts game
                # Wait for player_joined messages on host
                # We can just send start_game, server handles it
                await asyncio.sleep(1) 
                await ws_host.send(json.dumps({"type": "start_game"}))
                
                # Keep connections open for a bit so game remains active
                print("GAME_STARTED")
                await asyncio.sleep(60)

if __name__ == "__main__":
    try:
        asyncio.run(run_simulation())
    except KeyboardInterrupt:
        pass
