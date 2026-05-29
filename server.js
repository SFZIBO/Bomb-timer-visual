/**
 * BOMB TIMER — Remote Sync Server
 * WebSocket server for real-time communication between
 * the desktop bomb display and the Android remote control.
 */

const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DEFUSE_CODE = '4829'; // Default defuse code — change as needed

// ─── HTTP Server ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.css':  'text/css',
    '.js':   'application/javascript',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ─── WebSocket Server ─────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server });

// Access log storage
const accessLog = [];

function logAccess(entry) {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, ...entry };
  accessLog.push(logEntry);

  // Persist to file
  const logLine = JSON.stringify(logEntry) + '\n';
  fs.appendFile(path.join(__dirname, 'access.log'), logLine, () => {});

  console.log(`[LOG] ${timestamp} — ${entry.event} from ${entry.ip || 'unknown'}`);
  return logEntry;
}

// Broadcast to all connected clients of a given role
function broadcast(data, exceptWs = null) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client !== exceptWs) {
      client.send(msg);
    }
  });
}

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  ws.clientIp = ip;
  ws.role = 'unknown';

  const connectEntry = logAccess({ event: 'CONNECT', ip });
  broadcast({ type: 'log', entry: connectEntry });

  // Send current log to new client
  ws.send(JSON.stringify({ type: 'init_log', entries: accessLog.slice(-50) }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      // Client identifies itself
      case 'register':
        ws.role = msg.role || 'viewer';
        const regEntry = logAccess({ event: `REGISTER_${ws.role.toUpperCase()}`, ip });
        broadcast({ type: 'log', entry: regEntry });
        break;

      // Remote sends a defuse code attempt
      case 'defuse_attempt': {
        const attempt = String(msg.code || '');
        const success = attempt === DEFUSE_CODE;
        const ev = success ? 'DEFUSE_SUCCESS' : 'DEFUSE_FAILED';
        const entry = logAccess({ event: ev, ip, attempt });

        const response = {
          type: 'defuse_result',
          success,
          attempt,
          timestamp: entry.timestamp,
        };
        // Notify all clients
        broadcast(response);
        broadcast({ type: 'log', entry });
        break;
      }

      // Remote sends a digit press (live feedback)
      case 'digit_input': {
        broadcast({ type: 'digit_update', digit: msg.digit, partial: msg.partial }, ws);
        break;
      }

      // Remote triggers bomb activation
      case 'activate': {
        const entry = logAccess({ event: 'BOMB_ACTIVATED', ip });
        broadcast({ type: 'activate', duration: msg.duration || 300, timestamp: entry.timestamp });
        broadcast({ type: 'log', entry });
        break;
      }

      // Admin resets bomb
      case 'reset': {
        const entry = logAccess({ event: 'BOMB_RESET', ip });
        broadcast({ type: 'reset', timestamp: entry.timestamp });
        broadcast({ type: 'log', entry });
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    const entry = logAccess({ event: 'DISCONNECT', ip });
    broadcast({ type: 'log', entry });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🔴 BOMB TIMER SERVER running`);
  console.log(`   Desktop : http://localhost:${PORT}/`);
  console.log(`   Remote  : http://localhost:${PORT}/remote.html`);
  console.log(`   (On local network, replace localhost with your machine IP)\n`);
});
