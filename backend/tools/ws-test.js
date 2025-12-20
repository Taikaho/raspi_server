const WebSocket = require("ws");

const ws = new WebSocket("ws://localhost:3001/ws");

ws.on("open", () => {
  console.log("WS connected");
  ws.send(JSON.stringify({ type: "subscribe", deviceId: "raspi-1" }));
});

ws.on("message", (data) => {
  console.log("WS message:", data.toString());
});

ws.on("close", () => {
  console.log("WS closed");
});

ws.on("error", (err) => {
  console.error("WS error:", err);
});
