const express = require('express');
const { WebSocket, WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const nextClientIds = {
  pc: 1,
  mobile: 1,
};
const clients = new Map();

function detectDeviceType(userAgent = '') {
  return /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(userAgent) ? 'mobile' : 'pc';
}

function sendJson(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function relayMobileMessageToPcClients(fromClientId, originalMessage) {
  let relayCount = 0;
  const relayMessage = {
    type: 'relay',
    payload: {
      fromClientId,
      fromDeviceType: 'mobile',
      originalType: originalMessage.type,
      payload: originalMessage.payload,
      receivedAt: Date.now(),
    },
  };

  for (const client of clients.values()) {
    if (client.deviceType === 'pc') {
      sendJson(client.ws, relayMessage);
      relayCount += 1;
    }
  }

  return relayCount;
}

wss.on('connection', (ws, req) => {
  const deviceType = detectDeviceType(req.headers['user-agent']);
  const clientId = `${deviceType}-${nextClientIds[deviceType]++}`;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  clients.set(clientId, { ws, deviceType, clientIp });
  console.log(`[WS] Client connected: ${clientId} (${deviceType}, ${clientIp})`);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log(`[WS] ${clientId} received type="${message.type}":`, JSON.stringify(message.payload));
      if (deviceType === 'mobile') {
        const relayCount = relayMobileMessageToPcClients(clientId, message);
        console.log(`[WS] Relayed ${message.type} from ${clientId} to ${relayCount} PC client(s)`);
      }
    } catch {
      console.log(`[WS] ${clientId} received (raw):`, data.toString());
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    console.log(`[WS] Client disconnected: ${clientId} (${deviceType}, ${clientIp})`);
  });

  ws.on('error', (err) => {
    console.error(`[WS] ${clientId} error:`, err.message);
  });

  sendJson(ws, {
    type: 'connected',
    payload: {
      clientId,
      deviceType,
      message: 'WebSocket connection established',
    },
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
