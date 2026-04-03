const JOIN_NOT_FOUND = 'Böyle bir kod yok :(';
const JOIN_FULL = 'Oda dolu (en fazla 6 kişi).';
const JOIN_FORMAT = 'Kod 6 karakter olmalı.';
const DEVICE_STORAGE_KEY = 'lobby-device-mode';

function wsUrl() {
  const env = import.meta.env.VITE_LOBBY_WS_URL;
  if (env) return env;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${proto}//${host}/lobby-ws`;
}

const el = (id) => document.getElementById(id);

const lobbyRoot = el('lobby-root');
const screenDevice = el('screen-device');
const siteUrlEl = el('site-url');
const btnChangeDevice = el('btn-change-device');
const btnDeviceMobile = el('btn-device-mobile');
const btnDeviceDesktop = el('btn-device-desktop');

const screenConnect = el('screen-connect');
const screenHome = el('screen-home');
const screenNaming = el('screen-naming');
const screenPlaying = el('screen-playing');
const connectStatus = el('connect-status');
const connectHelp = el('connect-help');
const btnRetryConnect = el('btn-retry-connect');
const createdBlock = el('created-block');
const roomCodeDisplay = el('room-code-display');
const joinInput = el('join-input');
const joinError = el('join-error');
const btnCreate = el('btn-create');
const btnJoin = el('btn-join');
const hostActions = el('host-actions');
const playerCountHint = el('player-count-hint');
const btnStartLobby = el('btn-start-lobby');
const homeActions = el('home-actions');
const waitingMsg = el('waiting-msg');
const nameInput = el('name-input');
const nameError = el('name-error');
const btnSaveName = el('btn-save-name');
const playerTbody = el('player-tbody');
const leaderStartWrap = el('leader-start-wrap');
const btnStartGame = el('btn-start-game');
const finalRoster = el('final-roster');

let ws = null;
let myPlayerId = null;
let lastState = null;
/** Bu sayfa yüklemesinde en az bir kez WebSocket açıldı mı */
let wsOpenedThisPage = false;
let connectStuckTimer = null;
/** Son oyun ekranı (cihaz seçiminden sonra dönülecek) */
let flowScreen = 'connect';

function readSavedDevice() {
  try {
    const v = localStorage.getItem(DEVICE_STORAGE_KEY);
    if (v === 'mobile' || v === 'desktop') return v;
  } catch {
    /* ignore */
  }
  return null;
}

function saveDeviceMode(mode) {
  try {
    localStorage.setItem(DEVICE_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

function applyDeviceLayout(mode) {
  lobbyRoot.classList.remove('device-mobile', 'device-desktop');
  if (mode === 'mobile') lobbyRoot.classList.add('device-mobile');
  if (mode === 'desktop') lobbyRoot.classList.add('device-desktop');
}

function setSiteUrl() {
  siteUrlEl.textContent = `${window.location.origin}${window.location.pathname}`;
}

function showScreen(which) {
  if (which !== 'device') flowScreen = which;
  screenDevice.classList.toggle('hidden', which !== 'device');
  screenConnect.classList.toggle('hidden', which !== 'connect');
  screenHome.classList.toggle('hidden', which !== 'home');
  screenNaming.classList.toggle('hidden', which !== 'naming');
  screenPlaying.classList.toggle('hidden', which !== 'playing');
}

function finishDeviceChoice(mode) {
  saveDeviceMode(mode);
  applyDeviceLayout(mode);
  btnChangeDevice.classList.remove('hidden');
  setSiteUrl();
  showScreen(flowScreen);
  const needConnect = !ws || ws.readyState === WebSocket.CLOSED;
  if (needConnect) connect();
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function applyState(state) {
  lastState = state;
  const { phase, players, count, hostId, code } = state;
  const isHost = myPlayerId === hostId;

  if (phase === 'lobby') {
    showScreen('home');
    joinError.classList.add('hidden');
    const imInRoom = myPlayerId && players.some((p) => p.id === myPlayerId);
    playerCountHint.textContent = `Oyuncu: ${count} / 6`;
    if (isHost && code) {
      homeActions.classList.remove('hidden');
      waitingMsg.classList.add('hidden');
      createdBlock.classList.remove('hidden');
      roomCodeDisplay.textContent = code;
      hostActions.classList.remove('hidden');
      btnStartLobby.classList.toggle('hidden', count < 2);
    } else if (!isHost && imInRoom) {
      homeActions.classList.add('hidden');
      waitingMsg.classList.remove('hidden');
      createdBlock.classList.add('hidden');
      hostActions.classList.add('hidden');
    } else {
      homeActions.classList.remove('hidden');
      waitingMsg.classList.add('hidden');
      createdBlock.classList.add('hidden');
      hostActions.classList.add('hidden');
    }
    return;
  }

  if (phase === 'naming') {
    showScreen('naming');
    renderPlayerTable(players);
    leaderStartWrap.classList.toggle('hidden', !isHost);
    const allNamed = players.length > 0 && players.every((p) => p.name);
    btnStartGame.disabled = !allNamed;
    return;
  }

  if (phase === 'playing') {
    showScreen('playing');
    finalRoster.innerHTML = '';
    for (const p of players) {
      const li = document.createElement('li');
      li.textContent = p.name || p.id;
      finalRoster.appendChild(li);
    }
  }
}

function renderPlayerTable(players) {
  playerTbody.innerHTML = '';
  for (const p of players) {
    const tr = document.createElement('tr');
    const tdRole = document.createElement('td');
    if (p.isHost) {
      tdRole.innerHTML = `Lider<span class="badge-host">KURAN</span>`;
    } else {
      tdRole.textContent = 'Oyuncu';
    }
    if (p.id === myPlayerId) {
      tdRole.innerHTML += '<span class="badge-you">(sen)</span>';
    }
    const tdName = document.createElement('td');
    tdName.textContent = p.name || '—';
    tr.appendChild(tdRole);
    tr.appendChild(tdName);
    playerTbody.appendChild(tr);
  }
}

function clearConnectStuckTimer() {
  if (connectStuckTimer) {
    clearTimeout(connectStuckTimer);
    connectStuckTimer = null;
  }
}

function connect() {
  if (!readSavedDevice()) return;
  if (ws) {
    ws.close();
    ws = null;
  }
  clearConnectStuckTimer();
  showScreen('connect');
  connectHelp.classList.add('hidden');
  connectStatus.textContent = 'Sunucuya bağlanılıyor…';

  const sock = new WebSocket(wsUrl());
  ws = sock;

  connectStuckTimer = setTimeout(() => {
    if (ws === sock && sock.readyState === WebSocket.CONNECTING) {
      connectStatus.textContent = 'Sunucu yanıt vermiyor.';
      connectHelp.classList.remove('hidden');
    }
  }, 6000);

  sock.onopen = () => {
    if (ws !== sock) return;
    clearConnectStuckTimer();
    wsOpenedThisPage = true;
    connectHelp.classList.add('hidden');
    connectStatus.textContent = 'Bağlandı.';
    showScreen('home');
  };

  sock.onerror = () => {
    if (ws !== sock) return;
    connectStatus.textContent = 'Bağlantı hatası.';
    if (!wsOpenedThisPage) connectHelp.classList.remove('hidden');
  };

  sock.onclose = () => {
    if (ws !== sock) return;
    clearConnectStuckTimer();
    if (!wsOpenedThisPage) {
      connectStatus.textContent = 'Sunucuya bağlanılamadı.';
      connectHelp.classList.remove('hidden');
    } else {
      connectStatus.textContent = 'Bağlantı koptu. Sayfayı yenile veya Tekrar dene.';
      connectHelp.classList.remove('hidden');
    }
    showScreen('connect');
    if (ws === sock) ws = null;
  };

  sock.onmessage = (ev) => {
    if (ws !== sock) return;
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }

    if (msg.type === 'hello') {
      myPlayerId = msg.playerId;
      return;
    }

    if (msg.type === 'created') {
      myPlayerId = msg.playerId;
      applyState(msg);
      return;
    }

    if (msg.type === 'joined') {
      myPlayerId = msg.playerId;
      joinError.classList.add('hidden');
      applyState(msg);
      return;
    }

    if (msg.type === 'join_failed') {
      const map = {
        not_found: JOIN_NOT_FOUND,
        full: JOIN_FULL,
        invalid_format: JOIN_FORMAT
      };
      joinError.textContent = map[msg.reason] || 'Katılınamadı.';
      joinError.classList.remove('hidden');
      return;
    }

    if (msg.type === 'room_state') {
      applyState(msg);
      return;
    }

    if (msg.type === 'game_started') {
      applyState(msg);
      return;
    }

    if (msg.type === 'error') {
      if (lastState?.phase === 'naming') {
        nameError.textContent = msg.message;
        nameError.classList.remove('hidden');
      } else {
        joinError.textContent = msg.message;
        joinError.classList.remove('hidden');
      }
    }
  };
}

btnCreate.addEventListener('click', () => {
  joinError.classList.add('hidden');
  send({ type: 'create' });
});

btnJoin.addEventListener('click', () => {
  joinError.classList.add('hidden');
  const raw = joinInput.value.trim();
  send({ type: 'join', code: raw });
});

joinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnJoin.click();
});

btnStartLobby.addEventListener('click', () => {
  send({ type: 'start_lobby' });
});

btnSaveName.addEventListener('click', () => {
  nameError.classList.add('hidden');
  const name = nameInput.value.trim().slice(0, 10);
  if (!name.length) {
    nameError.textContent = 'İsim yaz.';
    nameError.classList.remove('hidden');
    return;
  }
  send({ type: 'set_name', name });
});

btnStartGame.addEventListener('click', () => {
  nameError.classList.add('hidden');
  send({ type: 'start_game' });
});

btnDeviceMobile.addEventListener('click', () => finishDeviceChoice('mobile'));
btnDeviceDesktop.addEventListener('click', () => finishDeviceChoice('desktop'));
btnChangeDevice.addEventListener('click', () => {
  showScreen('device');
});

btnRetryConnect.addEventListener('click', () => {
  connectHelp.classList.add('hidden');
  connect();
});

setSiteUrl();
if (readSavedDevice()) {
  applyDeviceLayout(readSavedDevice());
  btnChangeDevice.classList.remove('hidden');
  connect();
} else {
  showScreen('device');
}
