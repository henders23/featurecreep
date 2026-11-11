const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { RoomManager, catalogue } = require('./rooms');

function createServer(opts) {
  const options = opts || {};
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const manager = new RoomManager();
  const info = catalogue();
  let nextId = 1;

  function broadcast(room, msg) {
    const json = JSON.stringify(msg);
    for (const p of room.players.values()) p.send(json);
  }
  const pushState = (room) => broadcast(room, room.state());

  // Everyone on the start screen sees the list of games and how full they are.
  function pushGames() {
    const json = JSON.stringify({ type: 'games', games: manager.list() });
    for (const ws of wss.clients) if (!ws.room && ws.readyState === 1) ws.send(json);
  }

  function leave(ws) {
    const room = ws.room;
    if (!room) return;
    room.removePlayer(ws.playerId);
    ws.room = null;
    if (room.isEmpty()) manager.removeIfEmpty(room);
    else pushState(room);
  }

  function enter(ws, room, name) {
    const added = room.addPlayer(ws.playerId, name, (json) => { if (ws.readyState === 1) ws.send(json); });
    if (added.error) {
      ws.send(JSON.stringify({ type: 'error', message: added.error }));
      if (room.isEmpty()) manager.removeIfEmpty(room);
      return;
    }
    ws.room = room;
    ws.send(JSON.stringify({ type: 'joined', code: room.code, you: ws.playerId }));
    if (room.phase === 'playing') ws.send(JSON.stringify(room.roundStart()));
    if (room.phase === 'over' && room.results) ws.send(JSON.stringify(room.results));
    pushState(room);
  }

  wss.on('connection', (ws) => {
    ws.playerId = 'p' + (nextId++);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.send(JSON.stringify(Object.assign({ type: 'welcome', you: ws.playerId }, info)));
    ws.send(JSON.stringify({ type: 'games', games: manager.list() }));

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch (e) { return; }
      if (!msg || typeof msg.type !== 'string') return;
      const room = ws.room;
      const me = ws.playerId;

      switch (msg.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', t: msg.t, serverNow: Date.now() }));
          break;
        case 'create':
          leave(ws);
          enter(ws, manager.create(), msg.name);
          break;
        case 'join': {
          const target = manager.get(msg.code);
          if (!target) { ws.send(JSON.stringify({ type: 'error', message: 'No game with that code. Check it and try again.' })); break; }
          if (target === room) break;
          leave(ws);
          enter(ws, target, msg.name);
          break;
        }
        case 'leave':
          leave(ws);
          ws.send(JSON.stringify({ type: 'left' }));
          break;
        case 'settings':
          if (room && room.setSettings(me, msg.settings || {})) pushState(room);
          break;
        case 'start':
          if (room && room.start(me)) {
            broadcast(room, room.roundStart());
            pushState(room);
          }
          break;
        case 'pause':
          if (room && room.togglePause(me)) pushState(room);
          break;
        case 'lobby':
          if (room && room.toLobby(me)) pushState(room);
          break;
        case 'claim':
          if (room) {
            const res = room.claim(me, String(msg.fid));
            ws.send(JSON.stringify(Object.assign({ type: 'claimResult' }, res)));
            if (res.ok) pushState(room);
          }
          break;
        case 'find':
          if (room) {
            const res = room.find(me, Number(msg.seg));
            ws.send(JSON.stringify(Object.assign({ type: 'findResult' }, res)));
            if (res.ok || res.reason === 'wrong') pushState(room);
          }
          break;
        default:
          break;
      }
      if (msg.type !== 'ping' && msg.type !== 'claim' && msg.type !== 'find') pushGames();
    });

    ws.on('close', () => { leave(ws); pushGames(); });
  });

  const ticker = setInterval(() => {
    for (const room of manager.rooms.values()) {
      const moved = room.tick();
      if (moved === 'over') {
        broadcast(room, room.results);
        pushGames();
      }
      if (moved) pushState(room);
    }
  }, options.tickMs || 250);

  const syncer = setInterval(() => {
    for (const room of manager.rooms.values()) if (room.phase === 'playing') pushState(room);
  }, 4000);

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);

  server.on('close', () => {
    clearInterval(ticker);
    clearInterval(syncer);
    clearInterval(heartbeat);
  });

  return { server, wss, manager };
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  createServer().server.listen(port, () => {
    console.log('Feature Creep listening on port ' + port);
  });
}

module.exports = { createServer };
