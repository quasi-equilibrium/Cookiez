/**
 * Multiplayer lobby WebSocket server (2–6 players per room).
 * Run: npm run lobby-server
 */
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'crypto';

const PORT = Number(process.env.LOBBY_PORT || 8765);
const MAX_PLAYERS = 6;
const MIN_START = 2;
const NAME_MAX = 10;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function playerId() {
  return randomBytes(8).toString('hex');
}

/** @type {Map<string, { code: string, hostId: string, phase: 'lobby' | 'naming', members: Map<string, { ws: import('ws'), name: string | null }> }>} */
const rooms = new Map();

/** ws -> { roomCode, playerId } */
const socketMeta = new WeakMap();

function normalizeCode(c) {
  return String(c || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

function sanitizeName(n) {
  const s = String(n || '')
    .trim()
    .slice(0, NAME_MAX);
  return s;
}

function roomSnapshot(room) {
  const list = [];
  for (const [id, m] of room.members) {
    list.push({
      id,
      isHost: id === room.hostId,
      name: m.name
    });
  }
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    players: list,
    count: list.length
  };
}

function broadcast(room, msg) {
  const raw = JSON.stringify(msg);
  for (const { ws } of room.members.values()) {
    if (ws.readyState === 1) ws.send(raw);
  }
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function pickNewHost(room, excludeId) {
  for (const id of room.members.keys()) {
    if (id !== excludeId) return id;
  }
  return null;
}

function leaveRoom(ws) {
  const meta = socketMeta.get(ws);
  if (!meta) return;
  socketMeta.delete(ws);
  const { roomCode, playerId: pid } = meta;
  const room = rooms.get(roomCode);
  if (!room) return;

  room.members.delete(pid);
  if (room.members.size === 0) {
    rooms.delete(roomCode);
    return;
  }

  if (room.hostId === pid) {
    const next = pickNewHost(room, pid);
    if (next) room.hostId = next;
  }

  broadcast(room, { type: 'room_state', ...roomSnapshot(room) });
}

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Lobby server OK. Connect via WebSocket.\n');
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  const pid = playerId();
  socketMeta.set(ws, { roomCode: null, playerId: pid });

  send(ws, { type: 'hello', playerId: pid });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      send(ws, { type: 'error', message: 'Geçersiz mesaj.' });
      return;
    }

    const meta = socketMeta.get(ws);
    if (!meta) return;

    if (msg.type === 'create') {
      if (meta.roomCode) {
        send(ws, { type: 'error', message: 'Zaten bir odadasın.' });
        return;
      }
      const code = randomCode();
      const room = {
        code,
        hostId: pid,
        phase: 'lobby',
        members: new Map([[pid, { ws, name: null }]])
      };
      rooms.set(code, room);
      meta.roomCode = code;
      send(ws, { type: 'created', code, playerId: pid, ...roomSnapshot(room) });
      return;
    }

    if (msg.type === 'join') {
      if (meta.roomCode) {
        send(ws, { type: 'error', message: 'Zaten bir odadasın.' });
        return;
      }
      const code = normalizeCode(msg.code);
      if (code.length !== 6) {
        send(ws, { type: 'join_failed', reason: 'invalid_format' });
        return;
      }
      const room = rooms.get(code);
      if (!room) {
        send(ws, { type: 'join_failed', reason: 'not_found' });
        return;
      }
      if (room.members.size >= MAX_PLAYERS) {
        send(ws, { type: 'join_failed', reason: 'full' });
        return;
      }
      room.members.set(pid, { ws, name: null });
      meta.roomCode = code;
      send(ws, { type: 'joined', code, playerId: pid, ...roomSnapshot(room) });
      broadcast(room, { type: 'room_state', ...roomSnapshot(room) });
      return;
    }

    const room = meta.roomCode ? rooms.get(meta.roomCode) : null;
    if (!room || !room.members.has(pid)) {
      send(ws, { type: 'error', message: 'Önce oda kur veya katıl.' });
      return;
    }

    if (msg.type === 'start_lobby') {
      if (room.hostId !== pid) {
        send(ws, { type: 'error', message: 'Sadece oda kuran başlatabilir.' });
        return;
      }
      if (room.phase !== 'lobby') {
        send(ws, { type: 'error', message: 'Zaten başladı.' });
        return;
      }
      if (room.members.size < MIN_START) {
        send(ws, { type: 'error', message: `En az ${MIN_START} oyuncu gerekli.` });
        return;
      }
      room.phase = 'naming';
      for (const m of room.members.values()) m.name = null;
      broadcast(room, { type: 'room_state', ...roomSnapshot(room) });
      return;
    }

    if (msg.type === 'set_name') {
      if (room.phase !== 'naming') {
        send(ws, { type: 'error', message: 'İsim aşaması aktif değil.' });
        return;
      }
      const name = sanitizeName(msg.name);
      if (!name.length) {
        send(ws, { type: 'error', message: 'İsim boş olamaz.' });
        return;
      }
      const member = room.members.get(pid);
      if (member) member.name = name;
      broadcast(room, { type: 'room_state', ...roomSnapshot(room) });
      return;
    }

    if (msg.type === 'start_game') {
      if (room.hostId !== pid) {
        send(ws, { type: 'error', message: 'Sadece lider başlatabilir.' });
        return;
      }
      if (room.phase !== 'naming') {
        send(ws, { type: 'error', message: 'Önce lobiyi başlat.' });
        return;
      }
      const unnamed = [...room.members.values()].some((m) => !m.name);
      if (unnamed) {
        send(ws, { type: 'error', message: 'Herkes ismini yazmalı.' });
        return;
      }
      room.phase = 'playing';
      broadcast(room, { type: 'game_started', ...roomSnapshot(room) });
      return;
    }
  });

  ws.on('close', () => leaveRoom(ws));
});

httpServer.listen(PORT, () => {
  console.log(`Lobby WebSocket server listening on ws://127.0.0.1:${PORT}`);
});
