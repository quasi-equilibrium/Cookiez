import { choice, randRange } from './math.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function winnerTtt(cells) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6]
  ];
  for (const [a, b, c] of lines) {
    if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) return cells[a];
  }
  if (cells.every((x) => x)) return 'draw';
  return null;
}

function bestMoveTtt(cells, cpu = 'O', human = 'X') {
  // Small minimax for 3x3.
  const win = winnerTtt(cells);
  if (win === cpu) return { score: 1 };
  if (win === human) return { score: -1 };
  if (win === 'draw') return { score: 0 };

  const moves = [];
  for (let i = 0; i < 9; i++) {
    if (cells[i]) continue;
    const next = cells.slice();
    next[i] = cpu;
    const reply = bestMoveTttMin(next, human, cpu);
    moves.push({ idx: i, score: reply.score });
  }
  moves.sort((a, b) => b.score - a.score);
  return moves[0] ?? { idx: null, score: 0 };
}

function bestMoveTttMin(cells, turn, other) {
  const win = winnerTtt(cells);
  if (win === other) return { score: 1 };
  if (win === turn) return { score: -1 };
  if (win === 'draw') return { score: 0 };

  const isCpuTurn = turn === 'O';
  const scores = [];
  for (let i = 0; i < 9; i++) {
    if (cells[i]) continue;
    const next = cells.slice();
    next[i] = turn;
    const nextTurn = other;
    const nextOther = turn;
    const res = bestMoveTttMin(next, nextTurn, nextOther);
    scores.push(res.score);
  }
  if (scores.length === 0) return { score: 0 };
  // If current player is CPU, they maximize; otherwise minimize.
  const score = isCpuTurn ? Math.max(...scores) : Math.min(...scores);
  return { score };
}

export class TaskSystem {
  constructor({ input, elP1, elP2, onComplete, onClose }) {
    this.input = input;
    this.el = { p1: elP1, p2: elP2 };
    this.onComplete = onComplete;
    this.onClose = onClose;

    this.active = {
      p1: null,
      p2: null
    };

    // Snake runtime per player.
    this.snake = {
      p1: null,
      p2: null
    };
  }

  isOpen(playerId) {
    return !!this.active[playerId];
  }

  close(playerId) {
    this.active[playerId] = null;
    this.snake[playerId] = null;
    const host = this.el[playerId];
    host.classList.add('hidden');
    host.innerHTML = '';
    this.onClose?.(playerId);
  }

  open(playerId, taskIndex) {
    const host = this.el[playerId];
    host.classList.remove('hidden');
    host.innerHTML = '';

    const card = el('div', 'task-card');
    host.appendChild(card);

    const title = el('div', 'task-title');
    const sub = el('div', 'task-sub');
    card.appendChild(title);
    card.appendChild(sub);

    const footer = el('div', 'task-row');
    const exitBtn = el('button', 'task-btn', playerId === 'p1' ? 'E - Exit' : 'Right Click - Exit');
    footer.appendChild(exitBtn);
    card.appendChild(footer);

    exitBtn.addEventListener('click', () => this.close(playerId));

    if (taskIndex === 0) {
      title.textContent = 'TASK 1 — Tic Tac Toe';
      sub.textContent = 'Beat the CPU to earn your next weapon.';
      this._mountTicTacToe(playerId, card, () => this._complete(playerId, taskIndex));
    } else if (taskIndex === 1) {
      title.textContent = 'TASK 2 — Multiplication';
      sub.textContent = 'Answer correctly to upgrade your weapon.';
      this._mountMultiplication(playerId, card, () => this._complete(playerId, taskIndex));
    } else {
      title.textContent = 'TASK 3 — Snake';
      sub.textContent = 'Eat 10 food. Crash = restart.';
      this._mountSnake(playerId, card, () => this._complete(playerId, taskIndex));
    }

    this.active[playerId] = { taskIndex };
  }

  _complete(playerId, taskIndex) {
    this.onComplete?.(playerId, taskIndex);
    this.close(playerId);
  }

  update(dt) {
    // Snake runs while the task is open.
    for (const id of ['p1', 'p2']) {
      const s = this.snake[id];
      if (!s) continue;

      // Controls while in snake:
      // - P1 uses WASD
      // - P2 uses Arrow keys
      const up = id === 'p1' ? 'KeyW' : 'ArrowUp';
      const down = id === 'p1' ? 'KeyS' : 'ArrowDown';
      const left = id === 'p1' ? 'KeyA' : 'ArrowLeft';
      const right = id === 'p1' ? 'KeyD' : 'ArrowRight';

      if (this.input.wasPressed(up) && s.dir.y !== 1) s.nextDir = { x: 0, y: -1 };
      if (this.input.wasPressed(down) && s.dir.y !== -1) s.nextDir = { x: 0, y: 1 };
      if (this.input.wasPressed(left) && s.dir.x !== 1) s.nextDir = { x: -1, y: 0 };
      if (this.input.wasPressed(right) && s.dir.x !== -1) s.nextDir = { x: 1, y: 0 };

      s.acc += dt;
      const stepDt = 0.11;
      while (s.acc >= stepDt) {
        s.acc -= stepDt;
        this._snakeStep(id, s);
      }
      this._snakeDraw(s);
    }
  }

  _mountTicTacToe(playerId, card, onWin) {
    const grid = el('div', '');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
    grid.style.gap = '8px';

    const status = el('div', 'task-sub', 'You are X. CPU is O.');
    status.style.marginTop = '10px';
    status.style.marginBottom = '0';

    const cells = Array(9).fill(null);
    let locked = false;

    const render = () => {
      for (let i = 0; i < 9; i++) {
        btns[i].textContent = cells[i] ?? '';
      }
    };

    const cpuMove = () => {
      const empty = [];
      for (let i = 0; i < 9; i++) if (!cells[i]) empty.push(i);
      if (empty.length === 0) return;

      const useOptimal = Math.random() < 0.6;
      const idx = useOptimal ? bestMoveTtt(cells).idx : choice(empty);
      if (idx == null) return;
      cells[idx] = 'O';
    };

    const reset = () => {
      for (let i = 0; i < 9; i++) cells[i] = null;
      locked = false;
      status.textContent = 'You are X. CPU is O.';
      render();
    };

    const btns = [];
    for (let i = 0; i < 9; i++) {
      const b = el('button', 'task-btn');
      b.style.height = '64px';
      b.style.fontSize = '24px';
      b.style.fontWeight = '1000';
      b.style.display = 'flex';
      b.style.alignItems = 'center';
      b.style.justifyContent = 'center';
      b.addEventListener('click', () => {
        if (locked) return;
        if (cells[i]) return;
        cells[i] = 'X';
        let w = winnerTtt(cells);
        if (w === 'X') {
          locked = true;
          status.textContent = 'You won! Weapon upgraded.';
          onWin();
          return;
        }
        if (w === 'draw') {
          locked = true;
          status.textContent = 'Draw. Press Restart.';
          return;
        }

        // CPU move after a tiny delay for readability.
        locked = true;
        render();
        setTimeout(() => {
          cpuMove();
          locked = false;
          const w2 = winnerTtt(cells);
          if (w2 === 'O') {
            locked = true;
            status.textContent = 'CPU won. Try again.';
          } else if (w2 === 'draw') {
            locked = true;
            status.textContent = 'Draw. Press Restart.';
          }
          render();
        }, 220);
      });
      btns.push(b);
      grid.appendChild(b);
    }

    const row = el('div', 'task-row');
    const restartBtn = el('button', 'task-btn', 'Restart');
    row.appendChild(restartBtn);
    restartBtn.addEventListener('click', reset);

    card.appendChild(grid);
    card.appendChild(status);
    card.appendChild(row);
    reset();
  }

  _mountMultiplication(playerId, card, onWin) {
    const question = el('div', 'task-sub');
    question.style.fontSize = '18px';
    question.style.fontWeight = '900';

    const inputWrap = el('div', '');
    inputWrap.style.display = 'flex';
    inputWrap.style.gap = '10px';
    inputWrap.style.alignItems = 'center';

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.inputMode = 'numeric';
    inp.placeholder = 'Answer...';
    inp.style.flex = '1';
    inp.style.borderRadius = '12px';
    inp.style.padding = '10px 12px';
    inp.style.border = '1px solid rgba(255,255,255,0.18)';
    inp.style.background = 'rgba(0,0,0,0.35)';
    inp.style.color = '#fff';
    inp.style.fontWeight = '900';
    inp.style.fontSize = '16px';

    const submit = el('button', 'task-btn', 'Enter');

    inputWrap.appendChild(inp);
    inputWrap.appendChild(submit);

    const status = el('div', 'task-sub', 'Type the answer and press Enter.');
    status.style.marginTop = '10px';

    let a = 1;
    let b = 1;
    const newQ = () => {
      a = Math.floor(randRange(2, 10));
      b = Math.floor(randRange(2, 10));
      question.textContent = `${a} × ${b} = ?`;
      inp.value = '';
      inp.focus();
    };

    const check = () => {
      const v = Number.parseInt(inp.value, 10);
      if (Number.isFinite(v) && v === a * b) {
        status.textContent = 'Correct! Weapon upgraded.';
        onWin();
      } else {
        status.textContent = 'Wrong. New question.';
        newQ();
      }
    };

    submit.addEventListener('click', check);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') check();
    });

    card.appendChild(question);
    card.appendChild(inputWrap);
    card.appendChild(status);
    newQ();
  }

  _mountSnake(playerId, card, onWin) {
    const canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 360;
    canvas.style.width = '100%';
    canvas.style.borderRadius = '14px';
    canvas.style.border = '1px solid rgba(255,255,255,0.14)';
    canvas.style.background = 'rgba(0,0,0,0.45)';
    const ctx = canvas.getContext('2d');

    const status = el('div', 'task-sub', 'Eat 10 food. Crash = restart.');

    const restart = el('button', 'task-btn', 'Restart');
    restart.addEventListener('click', () => this._snakeReset(playerId));

    const row = el('div', 'task-row');
    row.appendChild(restart);

    card.appendChild(canvas);
    card.appendChild(status);
    card.appendChild(row);

    this.snake[playerId] = {
      canvas,
      ctx,
      grid: 20,
      acc: 0,
      dir: { x: 1, y: 0 },
      nextDir: { x: 1, y: 0 },
      body: [],
      food: { x: 10, y: 10 },
      eaten: 0,
      onWin,
      status
    };

    this._snakeReset(playerId);
  }

  _snakeReset(playerId) {
    const s = this.snake[playerId];
    if (!s) return;
    s.acc = 0;
    s.dir = { x: 1, y: 0 };
    s.nextDir = { x: 1, y: 0 };
    s.body = [
      { x: 8, y: 10 },
      { x: 7, y: 10 },
      { x: 6, y: 10 }
    ];
    s.food = { x: 13, y: 10 };
    s.eaten = 0;
    s.status.textContent = 'Eat 10 food. Crash = restart.';
    this._snakeDraw(s);
  }

  _snakeStep(playerId, s) {
    s.dir = s.nextDir;
    const head = s.body[0];
    const next = { x: head.x + s.dir.x, y: head.y + s.dir.y };
    if (next.x < 0 || next.y < 0 || next.x >= s.grid || next.y >= s.grid) {
      this._snakeReset(playerId);
      return;
    }
    for (const seg of s.body) {
      if (seg.x === next.x && seg.y === next.y) {
        this._snakeReset(playerId);
        return;
      }
    }
    s.body.unshift(next);
    if (next.x === s.food.x && next.y === s.food.y) {
      s.eaten++;
      s.status.textContent = `Food: ${s.eaten}/10`;
      // New food.
      const empties = [];
      for (let y = 0; y < s.grid; y++) {
        for (let x = 0; x < s.grid; x++) {
          if (s.body.some((q) => q.x === x && q.y === y)) continue;
          empties.push({ x, y });
        }
      }
      s.food = choice(empties) ?? { x: 10, y: 10 };
      if (s.eaten >= 10) {
        s.status.textContent = 'Complete! Weapon upgraded.';
        s.onWin();
      }
    } else {
      s.body.pop();
    }
  }

  _snakeDraw(s) {
    const { ctx, canvas } = s;
    const size = canvas.width;
    const cell = size / s.grid;
    ctx.clearRect(0, 0, size, size);

    // Grid background.
    ctx.fillStyle = 'rgba(5,10,18,0.9)';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i <= s.grid; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cell);
      ctx.lineTo(size, i * cell);
      ctx.stroke();
    }

    // Food.
    ctx.fillStyle = '#ff4fd7';
    ctx.fillRect(s.food.x * cell + 2, s.food.y * cell + 2, cell - 4, cell - 4);

    // Snake.
    ctx.fillStyle = '#37e6a1';
    for (let i = 0; i < s.body.length; i++) {
      const seg = s.body[i];
      const pad = i === 0 ? 1 : 3;
      ctx.fillRect(seg.x * cell + pad, seg.y * cell + pad, cell - pad * 2, cell - pad * 2);
    }
  }
}

