export const SIZE = 5;
export const SUPPORTED_SIZES = Object.freeze([5, 9]);
export const RULES = Object.freeze({ CUSTOM: 'custom', JAPANESE: 'japanese' });

export function boardSize(board) {
  if (!Array.isArray(board)) return 0;
  const size = Math.sqrt(board.length);
  return Number.isInteger(size) && SUPPORTED_SIZES.includes(size) ? size : 0;
}

// Share only the starting board and rule settings; the fragment stays local to
// the browser and is not sent to the hosting server.
export function encodeSetup(board, rules = RULES.CUSTOM, komi = 0, includeCaptures = false, playerColor = 1, nextTurn = playerColor) {
  if (!validBoard(board) || !Object.values(RULES).includes(rules)) throw new TypeError('invalid-setup');
  if (playerColor !== 1 && playerColor !== 2) throw new TypeError('invalid-player-color');
  if (nextTurn !== 1 && nextTurn !== 2) throw new TypeError('invalid-turn');
  if (!Number.isFinite(komi) || komi < 0 || komi > 7.5 || Math.round(komi * 2) !== komi * 2) throw new TypeError('invalid-komi');
  const cells = board.map((point) => point === 1 ? 'B' : point === 2 ? 'W' : '.').join('');
  return `#tf=1&size=${boardSize(board)}&board=${cells}&rules=${rules}&komi=${komi}&captures=${rules === RULES.JAPANESE ? 1 : Number(Boolean(includeCaptures))}&player=${playerColor}&turn=${nextTurn}`;
}

export function decodeSetup(hash) {
  try {
    const params = new URLSearchParams(String(hash).replace(/^#/, ''));
    if (params.get('tf') !== '1') return null;
    const cells = params.get('board');
    const size = Number(params.get('size') ?? Math.sqrt(cells?.length ?? 0));
    const rules = params.get('rules');
    const komiText = params.get('komi') ?? '0';
    const capturesText = params.get('captures') ?? '0';
    const playerText = params.get('player') ?? '1';
    const turnText = params.get('turn') ?? playerText;
    const komi = Number(komiText);
    if (!cells || !SUPPORTED_SIZES.includes(size) || cells.length !== size * size || !new RegExp(`^[.BW]{${size * size}}$`).test(cells) ||
        !Object.values(RULES).includes(rules) ||
        !/^(?:0|[1-7])(?:\.5)?$/.test(komiText) || komi > 7.5 || !['0', '1'].includes(capturesText) || !['1', '2'].includes(playerText) || !['1', '2'].includes(turnText)) return null;
    return { board: [...cells].map((cell) => cell === 'B' ? 1 : cell === 'W' ? 2 : 0), size, rules, komi, includeCaptures: rules === RULES.JAPANESE || capturesText === '1', playerColor: Number(playerText), turn: Number(turnText) };
  } catch { return null; }
}

export function neighbors(index, size = SIZE) {
  if (!SUPPORTED_SIZES.includes(size) || !Number.isInteger(index) || index < 0 || index >= size * size) return [];

  const row = Math.floor(index / size);
  const col = index % size;
  const result = [];
  if (row > 0) result.push(index - size);
  if (col > 0) result.push(index - 1);
  if (col < size - 1) result.push(index + 1);
  if (row < size - 1) result.push(index + size);
  return result;
}

function validBoard(board) {
  return boardSize(board) > 0 &&
    board.every((point) => point === 0 || point === 1 || point === 2);
}

export function group(board, index) {
  const size = boardSize(board);
  if (!size || !Number.isInteger(index) || index < 0 || index >= board.length || board[index] === 0) {
    return { stones: [], liberties: [] };
  }

  const color = board[index];
  const stones = [];
  const liberties = new Set();
  const seen = new Set([index]);
  const pending = [index];

  while (pending.length > 0) {
    const current = pending.pop();
    stones.push(current);
    for (const next of neighbors(current, size)) {
      if (board[next] === 0) {
        liberties.add(next);
      } else if (board[next] === color && !seen.has(next)) {
        seen.add(next);
        pending.push(next);
      }
    }
  }

  stones.sort((a, b) => a - b);
  return { stones, liberties: [...liberties].sort((a, b) => a - b) };
}

function failedMove(board, error) {
  return { ok: false, board: Array.isArray(board) ? board.slice() : board, captured: [], error };
}

export function tryMove(board, color, index) {
  const size = boardSize(board);
  if (!validBoard(board)) return failedMove(board, 'invalid-board');
  if (color !== 1 && color !== 2) return failedMove(board, 'invalid-color');
  if (index === null) return failedMove(board, 'pass-not-allowed');
  if (!Number.isInteger(index) || index < 0 || index >= board.length) return failedMove(board, 'invalid-index');
  if (board[index] !== 0) return failedMove(board, 'occupied');

  const nextBoard = board.slice();
  nextBoard[index] = color;
  const opponent = color === 1 ? 2 : 1;
  const examined = new Set();
  const captured = [];

  for (const adjacent of neighbors(index, size)) {
    if (nextBoard[adjacent] !== opponent || examined.has(adjacent)) continue;
    const opposingGroup = group(nextBoard, adjacent);
    for (const stone of opposingGroup.stones) examined.add(stone);
    if (opposingGroup.liberties.length === 0) {
      for (const stone of opposingGroup.stones) {
        nextBoard[stone] = 0;
        captured.push(stone);
      }
    }
  }

  captured.sort((a, b) => a - b);
  if (group(nextBoard, index).liberties.length === 0) {
    return failedMove(board, 'suicide');
  }

  return { ok: true, board: nextBoard, captured, error: null };
}

export function territory(board) {
  if (!validBoard(board)) throw new TypeError('board must be a 25- or 81-point array containing only 0, 1, or 2');

  const size = boardSize(board);
  const points = board.length;
  const owners = Array(points).fill(0);
  const visited = new Set();
  let black = 0;
  let white = 0;
  let neutral = 0;

  for (let start = 0; start < points; start += 1) {
    if (board[start] !== 0 || visited.has(start)) continue;
    const region = [];
    const boundaryColors = new Set();
    const pending = [start];
    visited.add(start);

    while (pending.length > 0) {
      const current = pending.pop();
      region.push(current);
      for (const next of neighbors(current, size)) {
        if (board[next] === 0 && !visited.has(next)) {
          visited.add(next);
          pending.push(next);
        } else if (board[next] === 1 || board[next] === 2) {
          boundaryColors.add(board[next]);
        }
      }
    }

    const owner = boundaryColors.size === 1 ? [...boundaryColors][0] : 0;
    for (const point of region) owners[point] = owner;
    if (owner === 1) black += region.length;
    else if (owner === 2) white += region.length;
    else neutral += region.length;
  }

  return { black, white, neutral, owners };
}

export function score(board, captures = {}, includeCaptures = true, rules = RULES.CUSTOM, komi = 0) {
  const area = territory(board);
  const captured = { 1: captures[1] ?? 0, 2: captures[2] ?? 0 };
  const countCaptures = rules === RULES.JAPANESE || includeCaptures;
  return {
    ...area,
    territory: { black: area.black, white: area.white },
    captures: captured,
    black: area.black + (countCaptures ? captured[1] : 0),
    white: area.white + (countCaptures ? captured[2] : 0) + (rules === RULES.JAPANESE ? komi : 0),
    includeCaptures: countCaptures,
    rules, komi: rules === RULES.JAPANESE ? komi : 0,
  };
}

function positionKey(board, nextTurn) {
  return `${board.join('')}:${nextTurn}`;
}

function finishByPasses(state) {
  if (state.rules === RULES.JAPANESE) {
    return { ...state, passes: 2, phase: 'agreement', over: false, reason: '', result: null, winner: null };
  }
  const result = territory(state.board);
  const totals = score(state.board, state.captures, state.includeCaptures !== false, state.rules, state.komi ?? 0);
  const winner = totals.black > totals.white ? 1 : totals.white > totals.black ? 2 : 0;
  return { ...state, over: true, reason: 'passes', result, winner };
}

export function newGame(size = SIZE) {
  if (!SUPPORTED_SIZES.includes(size)) throw new TypeError('invalid-size');
  const board = Array(size * size).fill(0);
  return {
    board,
    size,
    initialBoard: board.slice(),
    turn: 1,
    initialTurn: 1,
    playerColor: 1,
    passes: 0,
    over: false,
    reason: '',
    moveNumber: 0,
    lastMove: null,
    captures: { 1: 0, 2: 0 },
    includeCaptures: false,
    rules: RULES.CUSTOM,
    komi: 0,
    phase: 'play',
    history: [positionKey(board, 1)],
    log: [],
  };
}

export function play(state, indexOrNull) {
  if (!state || !validBoard(state.board) || (state.turn !== 1 && state.turn !== 2)) {
    return { ok: false, state, captured: [], error: 'invalid-state' };
  }
  if (state.over || state.phase === 'agreement') return { ok: false, state, captured: [], error: 'game-over' };

  const color = state.turn;
  const nextTurn = color === 1 ? 2 : 1;
  if (indexOrNull === null) {
    const nextState = {
      ...state,
      turn: nextTurn,
      passes: state.passes + 1,
      moveNumber: state.moveNumber + 1,
      lastMove: null,
      history: [...state.history, positionKey(state.board, nextTurn)],
      log: [...state.log, { color, index: null, captured: [] }],
    };
    return { ok: true, state: nextState.passes >= 2 ? finishByPasses(nextState) : nextState, captured: [], error: null };
  }

  const move = tryMove(state.board, color, indexOrNull);
  if (!move.ok) return { ok: false, state, captured: [], error: move.error };
  const previousMove = state.log?.at(-1);
  if (state.rules === RULES.JAPANESE && previousMove?.index !== null && previousMove?.captured?.length === 1 && state.history?.length > 1 &&
      positionKey(move.board, nextTurn) === state.history[state.history.length - 2]) {
    return { ok: false, state, captured: [], error: 'ko' };
  }

  const captures = { ...state.captures, [color]: state.captures[color] + move.captured.length };
  const nextState = {
    ...state,
    board: move.board,
    turn: nextTurn,
    passes: 0,
    moveNumber: state.moveNumber + 1,
    lastMove: indexOrNull,
    captures,
    history: [...state.history, positionKey(move.board, nextTurn)],
    log: [...state.log, { color, index: indexOrNull, captured: move.captured.slice() }],
  };
  return { ok: true, state: nextState, captured: move.captured, error: null };
}

export function repetitionCount(state) {
  if (!state || !Array.isArray(state.history)) return 0;
  const counts = new Map();
  let maximum = 0;
  for (const key of state.history) {
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    maximum = Math.max(maximum, count);
  }
  return maximum;
}

export function stopGame(state) {
  return { ...state, over: true, reason: 'stopped', result: territory(state.board), winner: null };
}

export function finishAgreement(state, deadStones = []) {
  if (!state || state.phase !== 'agreement') return { ok: false, state, error: 'not-agreement' };
  const board = state.board.slice();
  const removed = new Set();
  for (const index of deadStones) {
    if (!Number.isInteger(index) || index < 0 || index >= board.length || !board[index]) continue;
    for (const stone of group(board, index).stones) removed.add(stone);
  }
  const captures = { ...state.captures };
  for (const index of removed) {
    captures[3 - board[index]] += 1;
    board[index] = 0;
  }
  const result = territory(board);
  const totals = score(board, captures, true, RULES.JAPANESE, state.komi ?? 0);
  const winner = totals.black > totals.white ? 1 : totals.white > totals.black ? 2 : 0;
  return { ok: true, state: { ...state, board, captures, phase: 'finished', over: true, reason: 'passes', result, winner } };
}

export function resumeAfterAgreement(state) {
  if (!state || state.phase !== 'agreement') return state;
  return { ...state, phase: 'play', passes: 0 };
}

export function setupGame(board, rules = RULES.CUSTOM, komi = 0, includeCaptures = false, playerColor = 1, nextTurn = playerColor) {
  if (!validBoard(board)) throw new TypeError('invalid-board');
  if (playerColor !== 1 && playerColor !== 2) throw new TypeError('invalid-player-color');
  if (nextTurn !== 1 && nextTurn !== 2) throw new TypeError('invalid-turn');
  if (!Object.values(RULES).includes(rules) || !Number.isFinite(komi) || komi < 0 || komi > 7.5 || Math.round(komi * 2) !== komi * 2) throw new TypeError('invalid-rules');
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] && group(board, index).liberties.length === 0) {
      throw new Error('no-liberties');
    }
  }
  return { ...newGame(boardSize(board)), board: board.slice(), initialBoard: board.slice(), turn: nextTurn, initialTurn: nextTurn, playerColor, rules, komi: rules === RULES.JAPANESE ? komi : 0, includeCaptures: rules === RULES.JAPANESE || Boolean(includeCaptures), history: [positionKey(board, nextTurn)] };
}

// Return to just before the latest human move, including any CPU reply.
// Replay also restores captures, pass streak, last move, score and ko history.
export function undoHumanTurn(state) {
  const playerColor = state.playerColor ?? 1;
  const lastHuman = state.log.findLastIndex((move) => move.color === playerColor);
  if (lastHuman < 0) return null;
  let restored = setupGame(state.initialBoard ?? Array((state.size ?? SIZE) ** 2).fill(0), state.rules ?? RULES.CUSTOM, state.komi ?? 0, state.includeCaptures, playerColor, state.initialTurn ?? playerColor);
  for (const move of state.log.slice(0, lastHuman)) {
    const result = play(restored, move.index);
    if (!result.ok) throw new Error('invalid-history');
    restored = result.state;
  }
  return { ...restored, includeCaptures: state.includeCaptures !== false };
}
