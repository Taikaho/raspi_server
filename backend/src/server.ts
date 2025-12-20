import Fastify from "fastify";
import jwt from "@fastify/jwt";
import cors from "@fastify/cors";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";

// ---- Types ----
type Telemetry = {
  ts: string; // ISO time string
  deviceId: string;
  metrics: Record<string, number>;
};

type WsClientState = {
  subscribedDeviceId: string | null;
};

declare module "fastify" {
  interface FastifyInstance {
    auth: (req: any, reply: any) => Promise<void>;
  }
}

// ---- In-memory store (MVP) ----
const latestByDevice = new Map<string, Telemetry>();

async function main() {
  // Create a custom HTTP server through Fastify's serverFactory.
  // This is the supported way to share the same port with WebSocket.
  const app = Fastify({
    logger: true,
    serverFactory: (handler) => {
      return http.createServer((req, res) => handler(req, res));
    },
  });

  // Plugins
  await app.register(cors, { origin: true });
  await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  });

  // Auth guard (JWT)
  app.decorate("auth", async (req: any, reply: any) => {
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  // ---- WebSocket: subscribers per deviceId ----
  const subscribers = new Map<string, Set<WebSocket>>();
  const wsState = new WeakMap<WebSocket, WsClientState>();

  function subscribe(ws: WebSocket, deviceId: string) {
    const state = wsState.get(ws) ?? { subscribedDeviceId: null };

    // Unsubscribe previous
    if (state.subscribedDeviceId) {
      subscribers.get(state.subscribedDeviceId)?.delete(ws);
    }

    // Subscribe new
    state.subscribedDeviceId = deviceId;
    wsState.set(ws, state);

    if (!subscribers.has(deviceId)) subscribers.set(deviceId, new Set());
    subscribers.get(deviceId)!.add(ws);
  }

  function broadcastTelemetry(t: Telemetry) {
    const set = subscribers.get(t.deviceId);
    if (!set) return;

    const payload = JSON.stringify({ type: "telemetry", data: t });

    for (const client of set) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  // ---- Routes ----
  app.get("/health", async () => ({ ok: true }));

  // Login (MVP: hardcoded user)
  app.post("/api/auth/login", async (req, reply) => {
    const body = req.body as { username?: string; password?: string };

    if (body.username === "toni" && body.password === "salasana") {
      const token = app.jwt.sign(
        { sub: "user:toni", role: "admin" },
        { expiresIn: "15m" }
      );
      return reply.send({ token });
    }
    return reply.code(401).send({ error: "invalid_credentials" });
  });

  // Device ingest (protected by X-Device-Token)
  app.post("/api/ingest/telemetry", async (req, reply) => {
    const deviceToken = req.headers["x-device-token"];
    if (deviceToken !== (process.env.DEVICE_TOKEN ?? "dev-device-token")) {
      return reply.code(401).send({ error: "invalid_device_token" });
    }

    const t = req.body as Telemetry;

    if (!t?.deviceId || !t?.ts || typeof t.metrics !== "object" || t.metrics === null) {
      return reply.code(400).send({ error: "bad_payload" });
    }

    latestByDevice.set(t.deviceId, t);

    // Push realtime update to WebSocket subscribers
    broadcastTelemetry(t);

    return reply.send({ ok: true });
  });

  // Latest telemetry (JWT protected)
  app.get(
    "/api/telemetry/:deviceId/latest",
    { preHandler: app.auth },
    async (req, reply) => {
      const { deviceId } = req.params as { deviceId: string };
      const t = latestByDevice.get(deviceId);
      if (!t) return reply.code(404).send({ error: "not_found" });
      return reply.send(t);
    }
  );

  // Important: ensure routes/plugins are ready before we attach WS.
  await app.ready();

  // Attach WebSocket to the SAME underlying server that Fastify uses.
  const wss = new WebSocketServer({ server: app.server, path: "/ws" });

  wss.on("connection", (ws) => {
    wsState.set(ws, { subscribedDeviceId: null });

    ws.send(JSON.stringify({ type: "hello", message: "send subscribe {type, deviceId}" }));

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg?.type === "subscribe" && typeof msg.deviceId === "string") {
          subscribe(ws, msg.deviceId);
          ws.send(JSON.stringify({ type: "subscribed", deviceId: msg.deviceId }));

          // Optional: send latest immediately if we have it
          const latest = latestByDevice.get(msg.deviceId);
          if (latest) ws.send(JSON.stringify({ type: "telemetry", data: latest }));

          return;
        }

        ws.send(JSON.stringify({ type: "error", error: "unknown_message_type" }));
      } catch {
        ws.send(JSON.stringify({ type: "error", error: "bad_json" }));
      }
    });

    ws.on("close", () => {
      const state = wsState.get(ws);
      if (state?.subscribedDeviceId) {
        subscribers.get(state.subscribedDeviceId)?.delete(ws);
      }
      wsState.delete(ws);
    });
  });

  // Start (Fastify handles listening; WS piggybacks on the same server)
  const port = Number(process.env.PORT ?? 3001);
  await app.listen({ port, host: "0.0.0.0" });

  app.log.info(`WS listening on ws://0.0.0.0:${port}/ws`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
