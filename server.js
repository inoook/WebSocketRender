const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[WS] Client connected: ${clientIp}`);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log(`[WS] Received type="${message.type}":`, JSON.stringify(message.payload));
    } catch {
      console.log('[WS] Received (raw):', data.toString());
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Client disconnected: ${clientIp}`);
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
  });

  ws.send(JSON.stringify({ type: 'connected', payload: { message: 'WebSocket connection established' } }));
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
