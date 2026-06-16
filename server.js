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
  return requestUrl.searchParams.get('role') === 'special' ? 'special' : 'viewer';
}

function sendJson(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function buildRelayPayload(fromClient, originalMessage) {
  return {
    fromClientId: fromClient.clientId,
    fromDeviceType: fromClient.deviceType,
    fromRole: fromClient.role,
    originalType: originalMessage.type,
    payload: originalMessage.payload,
    receivedAt: Date.now(),
  };
}

function shouldRelayMessage(fromClient, toClient) {
  if (fromClient.clientId === toClient.clientId) {
    return false;
  }
  return fromClient.role === 'special' || toClient.role === 'special';
}

function relayMessageByRole(fromClient, originalMessage) {
  let relayCount = 0;
  const relayPayload = buildRelayPayload(fromClient, originalMessage);
  const relayMessage = {
    type: 'relay',
    payload: relayPayload,
  };

  for (const client of clients.values()) {
    if (shouldRelayMessage(fromClient, client)) {
      sendJson(client.ws, relayMessage);
      relayCount += 1;
    }
  }

  return relayCount;
}

function notifyClientDisconnected(disconnectedClient) {
  const message = {
    type: 'client_disconnected',
    payload: {
      clientId: disconnectedClient.clientId,
      deviceType: disconnectedClient.deviceType,
      role: disconnectedClient.role,
      disconnectedAt: Date.now(),
    },
  };

  let notifyCount = 0;
  for (const client of clients.values()) {
    sendJson(client.ws, message);
    notifyCount += 1;
  }

  return notifyCount;
}

wss.on('connection', (ws, req) => {
  const deviceType = detectDeviceType(req.headers['user-agent']);
  const role = detectClientRole(req, deviceType);
  const clientId = `${deviceType}-${nextClientIds[deviceType]++}`;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const clientInfo = { clientId, ws, deviceType, role, clientIp };
  clients.set(clientId, clientInfo);
  console.log(`[WS] Client connected: ${clientId} (${deviceType}, role=${role}, ${clientIp})`);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log(`[WS] ${clientId} received type="${message.type}":`, JSON.stringify(message.payload));
      const relayCount = relayMessageByRole(clientInfo, message);
      console.log(`[WS] Relayed ${message.type} from ${clientId} to ${relayCount} client(s)`);
    } catch {
      console.log(`[WS] ${clientId} received (raw):`, data.toString());
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    const notifyCount = notifyClientDisconnected(clientInfo);
    console.log(`[WS] Client disconnected: ${clientId} (${deviceType}, role=${role}, ${clientIp})`);
    console.log(`[WS] Notified ${notifyCount} client(s) about disconnect: ${clientId}`);
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
