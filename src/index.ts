import { Server as Engine } from "@socket.io/bun-engine";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { Server } from "socket.io";
import { SocketManager } from "./socket/manager";

const io = new Server();
const engine = new Engine({
  pingInterval: 10000,
  pingTimeout: 5000,
});

io.bind(engine);

const app = new Hono();
app.use("/*", serveStatic({ root: "./public" }));

new SocketManager(io);

const { websocket } = engine.handler();

const port = parseInt(process.env.PORT || "3000", 10);

console.log(`Server is running on port ${port}`);

export default {
  port: port,
  fetch(request: Request, server: any) {
    const url = new URL(request.url);
    if (url.pathname === "/socket.io/") {
      return engine.handleRequest(request, server);
    } else {
      return app.fetch(request);
    }
  },
  websocket,
};
