import { Server as Engine } from "@socket.io/bun-engine";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { Server } from "socket.io";
import { SocketManager } from "./socket/manager";
import { RedisGameStore } from "./state/store.redis";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error("REDIS_URL is required. Copy .env.example to .env and set your Redis Cloud URL.");
  process.exit(1);
}

const store = new RedisGameStore(redisUrl);
await store.init();

const io = new Server();
const engine = new Engine({
  pingInterval: 10000,
  pingTimeout: 5000,
});

io.bind(engine);

const app = new Hono();
app.use("/*", serveStatic({ root: "./public" }));

new SocketManager(io, store);

const { websocket } = engine.handler();

const port = parseInt(process.env.PORT || "3000", 10);

console.log(`Server is running on port ${port}`);

export default {
  port: port,
  fetch(request: Request, server: any) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/socket.io/")) {
      return engine.handleRequest(request, server);
    }
    return app.fetch(request);
  },
  websocket,
};
