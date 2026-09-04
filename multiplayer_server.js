const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const HTML = path.join(__dirname, 'candy_obby_EASY_AND_HARD.html');
const SPRITES = ['gumdrop', 'marshmallow', 'lollipop', 'jelly', 'peppermint', 'chocolate'];
const rooms = new Map();
const sockets = new Map();

function roomCode() {
  let code;
  do code = crypto.randomBytes(3).toString('hex').slice(0, 6).toUpperCase();
  while (rooms.has(code));
  return code;
}

function playerId() {
  return crypto.randomBytes(5).toString('hex');
}

function cleanName(value) {
  return String(value || 'Player')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20) || 'Player';
}

function difficulty(value) {
  return value === 'easy' ? 'easy' : 'hard';
}

function chooseSprite(room, requested, ignorePlayerId = null) {
  const used = new Set(
    [...room.players.values()]
      .filter(player => player.id !== ignorePlayerId)
      .map(player => player.sprite)
  );
  if (SPRITES.includes(requested) && !used.has(requested)) return requested;
  return SPRITES.find(sprite => !used.has(sprite)) || null;
}

function roomPlayers(room) {
  return [...room.players.values()].map(player => ({
    id: player.id,
    host: player.id === room.hostId,
    ready: true,
    name: player.name,
    sprite: player.sprite,
  }));
}

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function broadcast(room, message) {
  const data = JSON.stringify(message);
  for (const player of room.players.values()) {
    if (player.ws.readyState === WebSocket.OPEN) player.ws.send(data);
  }
}

function broadcastPlayers(room) {
  broadcast(room, {
    type: 'players',
    players: roomPlayers(room),
    started: room.started,
    difficulty: room.difficulty,
  });
}

function leave(ws) {
  const player = sockets.get(ws);
  if (!player) return;

  const room = rooms.get(player.room);
  sockets.delete(ws);
  if (!room) return;

  room.players.delete(player.id);
  broadcast(room, { type: 'playerLeave', id: player.id });

  if (room.hostId === player.id) {
    const next = room.players.values().next().value;
    room.hostId = next ? next.id : null;
  }

  if (room.players.size) broadcastPlayers(room);
  else rooms.delete(player.room);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/' || url.pathname === '/candy_obby_EASY_AND_HARD.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    fs.createReadStream(HTML)
      .on('error', () => {
        if (!res.headersSent) res.writeHead(500);
        res.end('Game file missing');
      })
      .pipe(res);
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const current = sockets.get(ws);

    if (msg.type === 'create' || msg.type === 'join') {
      if (current) return;

      let code = String(msg.room || '').toUpperCase();
      if (msg.type === 'create') code = roomCode();

      let room = rooms.get(code);
      if (msg.type === 'join' && !room) {
        send(ws, { type: 'error', message: 'That room does not exist.' });
        return;
      }

      if (!room) {
        room = {
          code,
          hostId: null,
          players: new Map(),
          started: false,
          difficulty: difficulty(msg.difficulty),
          level: 1,
          completions: new Set(),
        };
        rooms.set(code, room);
      }

      if (room.players.size >= SPRITES.length) {
        send(ws, { type: 'error', message: `Room is full (${SPRITES.length} players maximum).` });
        return;
      }

      const sprite = chooseSprite(room, String(msg.sprite || 'gumdrop'));
      if (!sprite) {
        send(ws, { type: 'error', message: 'No candy sprites are available in that room.' });
        return;
      }

      const id = playerId();
      const player = {
        id,
        ws,
        room: code,
        name: cleanName(msg.name),
        sprite,
        x: 0,
        y: 0,
        facing: 1,
        lastPushAt: 0,
      };

      room.players.set(id, player);
      if (!room.hostId) room.hostId = id;
      sockets.set(ws, player);

      send(ws, {
        type: 'welcome',
        id,
        room: code,
        host: id === room.hostId,
        started: room.started,
        level: room.level,
        difficulty: room.difficulty,
        supportsModes: true,
        supportsUniqueSprites: true,
        supportsLevelChange: true,
        players: roomPlayers(room),
      });
      broadcastPlayers(room);
      return;
    }

    if (!current) return;
    const room = rooms.get(current.room);
    if (!room) return;

    if (msg.type === 'setName') {
      current.name = cleanName(msg.name);
      broadcastPlayers(room);
      return;
    }

    if (msg.type === 'setSprite') {
      const requested = String(msg.sprite || '');
      const sprite = chooseSprite(room, requested, current.id);
      if (!SPRITES.includes(requested) || sprite !== requested) {
        send(ws, { type: 'error', message: 'That candy sprite is already taken.' });
        broadcastPlayers(room);
        return;
      }
      current.sprite = sprite;
      broadcastPlayers(room);
      return;
    }

    if (msg.type === 'start') {
      if (current.id !== room.hostId) {
        send(ws, { type: 'error', message: 'Only the host can start the game.' });
        return;
      }

      room.started = true;
      room.level = Math.max(1, Math.min(100, Number(msg.level) || 1));
      room.difficulty = difficulty(msg.difficulty);
      room.completions.clear();
      broadcast(room, {
        type: 'start',
        level: room.level,
        difficulty: room.difficulty,
      });
      return;
    }

    if (msg.type === 'changeLevel') {
      if (current.id !== room.hostId || !room.started) {
        send(ws, { type: 'error', message: 'Only the host can change levels during a game.' });
        return;
      }

      room.level = Math.max(1, Math.min(100, Number(msg.level) || 1));
      room.completions.clear();
      broadcast(room, {
        type: 'nextLevel',
        level: room.level,
        difficulty: room.difficulty,
      });
      return;
    }

    if (msg.type === 'push') {
      if (!room.started) return;
      const now = Date.now();
      if (now - current.lastPushAt < 600) return;

      const target = room.players.get(String(msg.targetId || ''));
      if (!target || target.id === current.id) return;

      const dx = target.x - current.x;
      const dy = target.y - current.y;
      if (Math.hypot(dx, dy) > 120) return;

      current.lastPushAt = now;
      const direction = Math.sign(dx) || current.facing || 1;
      send(target.ws, { type: 'pushed', vx: direction * 7, vy: -5 });
      return;
    }

    if (msg.type === 'playerUpdate') {
      current.x = Number(msg.x) || 0;
      current.y = Number(msg.y) || 0;
      current.facing = Number(msg.facing) || 1;
      const safe = {
        type: 'playerUpdate',
        id: current.id,
        x: Number(msg.x) || 0,
        y: Number(msg.y) || 0,
        vx: Number(msg.vx) || 0,
        vy: Number(msg.vy) || 0,
        facing: Number(msg.facing) || 1,
        sprite: current.sprite,
        name: current.name,
      };
      for (const player of room.players.values()) {
        if (player.id !== current.id && player.ws.readyState === WebSocket.OPEN) {
          player.ws.send(JSON.stringify(safe));
        }
      }
      return;
    }

    if (msg.type === 'complete') {
      const level = Number(msg.level);
      if (!room.started || level !== room.level) return;

      room.completions.add(current.id);
      if (room.completions.size >= room.players.size) {
        if (room.level >= 100) {
          broadcast(room, { type: 'victory' });
          room.started = false;
        } else {
          room.level++;
          room.completions.clear();
          broadcast(room, {
            type: 'nextLevel',
            level: room.level,
            difficulty: room.difficulty,
          });
        }
      } else {
        broadcast(room, {
          type: 'waiting',
          completed: room.completions.size,
          total: room.players.size,
        });
      }
    }
  });

  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

server.listen(PORT, () => {
  console.log(`Candy Obby multiplayer server listening on http://localhost:${PORT}`);
});
