const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const HTML = path.join(__dirname, 'candy_obby_triple_spinner.html');
const rooms = new Map();
const sockets = new Map();

function roomCode() {
  let code;
  do code = crypto.randomBytes(3).toString('hex').slice(0, 6).toUpperCase(); while (rooms.has(code));
  return code;
}
function playerId() { return crypto.randomBytes(5).toString('hex'); }
function roomPlayers(room) { return [...room.players.values()].map(p => ({ id:p.id, host:p.id === room.hostId, ready:true })); }
function broadcast(room, msg) { const data = JSON.stringify(msg); for (const p of room.players.values()) if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data); }
function send(ws, msg) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
function leave(ws) {
  const p = sockets.get(ws); if (!p) return;
  const room = rooms.get(p.room);
  sockets.delete(ws);
  if (!room) return;
  room.players.delete(p.id);
  broadcast(room, { type:'playerLeave', id:p.id });
  if (room.hostId === p.id) {
    const next = room.players.values().next().value;
    room.hostId = next ? next.id : null;
  }
  if (room.players.size) broadcast(room, { type:'players', players:roomPlayers(room), started:room.started });
  else rooms.delete(p.room);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/' || url.pathname === '/candy_obby_triple_spinner.html') {
    fs.createReadStream(HTML).on('error', () => { res.writeHead(500); res.end('Game file missing'); }).pipe(res);
    return;
  }
  if (url.pathname === '/health') { res.writeHead(200, {'content-type':'text/plain'}); res.end('ok'); return; }
  res.writeHead(404); res.end('Not found');
});

const wss = new WebSocket.Server({ server, path:'/ws' });
wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    const current = sockets.get(ws);

    if (msg.type === 'create' || msg.type === 'join') {
      if (current) return;
      let code = (msg.room || '').toUpperCase();
      if (msg.type === 'create') code = roomCode();
      let room = rooms.get(code);
      if (msg.type === 'join' && !room) return send(ws, {type:'error', message:'That room does not exist.'});
      if (!room) { room = { code, hostId:null, players:new Map(), started:false, level:1, completions:new Set() }; rooms.set(code, room); }
      if (room.players.size >= 8) return send(ws, {type:'error', message:'Room is full (8 players maximum).'});
      const id = playerId();
      const p = { id, ws, room:code };
      room.players.set(id, p); if (!room.hostId) room.hostId = id; sockets.set(ws, p);
      send(ws, {type:'welcome', id, room:code, host:id===room.hostId, started:room.started, level:room.level, players:roomPlayers(room)});
      broadcast(room, {type:'players', players:roomPlayers(room), started:room.started});
      return;
    }

    if (!current) return;
    const room = rooms.get(current.room); if (!room) return;

    if (msg.type === 'start') {
      if (current.id !== room.hostId) return send(ws, {type:'error', message:'Only the host can start the game.'});
      room.started = true; room.level = Math.max(1, Math.min(100, Number(msg.level) || 1)); room.completions.clear();
      broadcast(room, {type:'start', level:room.level}); return;
    }
    if (msg.type === 'playerUpdate') {
      const safe = { type:'playerUpdate', id:current.id, x:Number(msg.x)||0, y:Number(msg.y)||0, vx:Number(msg.vx)||0, vy:Number(msg.vy)||0, facing:Number(msg.facing)||1, sprite:String(msg.sprite||'gumdrop').slice(0,20), name:String(msg.name||'Player').slice(0,20) };
      for (const p of room.players.values()) if (p.id !== current.id && p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(safe));
      return;
    }
    if (msg.type === 'complete') {
      const level = Number(msg.level);
      if (!room.started || level !== room.level) return;
      room.completions.add(current.id);
      if (room.completions.size >= room.players.size) {
        if (room.level >= 100) { broadcast(room, {type:'victory'}); room.started = false; }
        else { room.level++; room.completions.clear(); broadcast(room, {type:'nextLevel', level:room.level}); }
      } else broadcast(room, {type:'waiting', completed:room.completions.size, total:room.players.size});
    }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

server.listen(PORT, () => console.log(`Candy Obby multiplayer server listening on http://localhost:${PORT}`));
