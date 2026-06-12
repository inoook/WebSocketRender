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

function detectClientRole(req, deviceType) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  return deviceType === 'pc' && requestUrl.searchParams.get('role') === 'special' ? 'special' : 'viewer';
}

function sendJson(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function buildMobileRelayPayload(fromClientId, originalMessage) {
  return {
    fromClientId,
    fromDeviceType: 'mobile',
    originalType: originalMessage.type,
    payload: originalMessage.payload,
    receivedAt: Date.now(),
  };
}

function relayMobileMessageToPcClients(fromClientId, originalMessage) {
  let relayCount = 0;
  let specialCount = 0;
  const relayPayload = buildMobileRelayPayload(fromClientId, originalMessage);
  const relayMessage = {
    type: 'relay',
    payload: relayPayload,
  };
  const specialMessage = {
    type: 'special_action',
    payload: {
      ...relayPayload,
      action: 'highlight',
    },
  };

  for (const client of clients.values()) {
    if (client.deviceType === 'pc') {
      sendJson(client.ws, relayMessage);
      relayCount += 1;
      if (client.role === 'special') {
        sendJson(client.ws, specialMessage);
        specialCount += 1;
      }
    }
  }

  return { relayCount, specialCount };
}

wss.on('connection', (ws, req) => {
  const deviceType = detectDeviceType(req.headers['user-agent']);
  const role = detectClientRole(req, deviceType);
  const clientId = `${deviceType}-${nextClientIds[deviceType]++}`;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  clients.set(clientId, { ws, deviceType, role, clientIp });
  console.log(`[WS] Client connected: ${clientId} (${deviceType}, role=${role}, ${clientIp})`);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log(`[WS] ${clientId} received type="${message.type}":`, JSON.stringify(message.payload));
      if (deviceType === 'mobile') {
        const { relayCount, specialCount } = relayMobileMessageToPcClients(clientId, message);
        console.log(`[WS] Relayed ${message.type} from ${clientId} to ${relayCount} PC client(s), special=${specialCount}`);
      }
    } catch {
      console.log(`[WS] ${clientId} received (raw):`, data.toString());
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    console.log(`[WS] Client disconnected: ${clientId} (${deviceType}, role=${role}, ${clientIp})`);
  });

  ws.on('error', (err) => {
    console.error(`[WS] ${clientId} error:`, err.message);
  });

  sendJson(ws, {
    type: 'connected',
    payload: {
      clientId,
      deviceType,
      role,
      message: 'WebSocket connection established',
    },
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
