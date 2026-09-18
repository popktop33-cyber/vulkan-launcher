'use strict';
/*
 * Минимальный клиент Discord Rich Presence.
 *
 * Discord слушает именованный канал: на Windows это \\.\pipe\discord-ipc-N,
 * на Linux и macOS — сокет в XDG_RUNTIME_DIR. Node умеет работать с именованными
 * каналами Windows напрямую, а Java — нет, поэтому вся интеграция живёт в
 * процессе Electron, а не в бэкенде.
 *
 * Протокол простой: кадр из четырёх байт кода операции, четырёх байт длины
 * и JSON полезной нагрузки, всё little-endian.
 *
 * Операции: 0 — рукопожатие, 1 — кадр, 2 — закрытие, 3 — пинг, 4 — понг.
 */

const net = require('net');
const crypto = require('crypto');

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

const PING_MS = 15000;
const RECONNECT_MS = 10000;

function pipePaths() {
  const paths = [];
  if (process.platform === 'win32') {
    for (let i = 0; i < 10; i++) paths.push(`\\\\?\\pipe\\discord-ipc-${i}`);
    return paths;
  }
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || '/tmp';
  const dirs = [base];
  // Flatpak и Snap держат свои сокеты в подкаталогах
  dirs.push(`${base}/app/com.discordapp.Discord`);
  dirs.push(`${base}/snap.discord`);
  for (const dir of dirs) {
    for (let i = 0; i < 10; i++) paths.push(`${dir}/discord-ipc-${i}`);
  }
  return paths;
}

function frame(op, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

class DiscordRpc {
  constructor(clientId, log = () => {}) {
    this.clientId = String(clientId || '').trim();
    this.log = log;
    this.socket = null;
    this.ready = false;
    this.buffer = Buffer.alloc(0);
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.pipeIndex = 0;
    this.pending = null;    // активность, которую надо выставить после подключения
    this.stopped = false;
  }

  get enabled() {
    return this.clientId.length > 0;
  }

  start() {
    if (!this.enabled || this.socket) return;
    this.stopped = false;
    this.tryConnect(0);
  }

  tryConnect(index) {
    if (this.stopped || !this.enabled) return;
    const paths = pipePaths();
    if (index >= paths.length) {
      // Discord не запущен — это обычная ситуация, молча ждём и пробуем снова
      this.scheduleReconnect();
      return;
    }

    const socket = net.connect(paths[index]);
    let settled = false;

    socket.once('connect', () => {
      settled = true;
      this.socket = socket;
      this.pipeIndex = index;
      this.buffer = Buffer.alloc(0);
      this.log(`[discord] подключились к ${paths[index]}`);
      socket.write(frame(OP_HANDSHAKE, { v: 1, client_id: this.clientId }));
    });

    socket.on('data', (chunk) => this.onData(chunk));

    socket.once('error', () => {
      if (settled) return;
      // Канал занят или не отвечает — пробуем следующий
      socket.destroy();
      this.tryConnect(index + 1);
    });

    socket.once('close', () => {
      if (this.socket === socket) {
        this.socket = null;
        this.ready = false;
      }
      clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (settled) this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.socket) this.tryConnect(0);
    }, RECONNECT_MS);
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const len = this.buffer.readInt32LE(4);
      if (this.buffer.length < 8 + len) return;
      const body = this.buffer.subarray(8, 8 + len).toString('utf8');
      this.buffer = this.buffer.subarray(8 + len);

      if (op === OP_PING) {
        this.send(OP_PONG, JSON.parse(body));
        continue;
      }
      if (op === OP_CLOSE) {
        this.log('[discord] соединение закрыто со стороны Discord');
        if (this.socket) this.socket.destroy();
        continue;
      }
      let msg = null;
      try { msg = JSON.parse(body); } catch (_) { continue; }

      if (msg && msg.evt === 'READY') {
        this.ready = true;
        this.startPing();
        this.log('[discord] готов, пользователь: ' + (msg.data && msg.data.user ? msg.data.user.username : '?'));
        if (this.pending) {
          this.setActivity(this.pending);
          this.pending = null;
        }
      }
    }
  }

  startPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      this.send(OP_PING, { nonce: crypto.randomUUID() });
    }, PING_MS);
  }

  send(op, payload) {
    if (!this.socket || this.socket.destroyed) return false;
    try {
      this.socket.write(frame(op, payload));
      return true;
    } catch (_) {
      return false;
    }
  }

  /** activity === null очищает статус. */
  setActivity(activity) {
    if (!this.enabled) return;
    if (!this.ready) {
      // Запомним и выставим, как только Discord ответит на рукопожатие
      this.pending = activity;
      return;
    }
    const ok = this.send(OP_FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity: activity || null },
      nonce: crypto.randomUUID()
    });
    if (!ok) this.pending = activity;
  }

  stop() {
    this.stopped = true;
    clearInterval(this.pingTimer);
    clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
    if (this.socket) {
      try { this.send(OP_CLOSE, {}); } catch (_) {}
      try { this.socket.destroy(); } catch (_) {}
    }
    this.socket = null;
    this.ready = false;
  }
}

module.exports = { DiscordRpc };
