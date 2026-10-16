export const SIZE = 5;
const POINTS = SIZE * SIZE;

export function neighbors(index) {
  if (!Number.isInteger(index) || index < 0 || index >= POINTS) return [];

  const row = Math.floor(index / SIZE);
  const col = index % SIZE;
  const result = [];
  if (row > 0) result.push(index - SIZE);
  if (col > 0) result.push(index - 1);
  if (col < SIZE - 1) result.push(index + 1);
  if (row < SIZE - 1) result.push(index + SIZE);
  return result;
}

function validBoard(board) {
  return Array.isArray(board) && board.length === POINTS &&
    board.every((point) => point === 0 || point === 1 || point === 2);
}

export function group(board, index) {
  if (!validBoard(board) || !Number.isInteger(index) || index < 0 || index >= POINTS || board[index] === 0) {
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
    for (const next of neighbors(current)) {
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
  if (!validBoard(board)) return failedMove(board, 'invalid-board');
  if (color !== 1 && color !== 2) return failedMove(board, 'invalid-color');
  if (index === null) return failedMove(board, 'pass-not-allowed');
  if (!Number.isInteger(index) || index < 0 || index >= POINTS) return failedMove(board, 'invalid-index');
  if (board[index] !== 0) return failedMove(board, 'occupied');

  const nextBoard = board.slice();
  nextBoard[index] = color;
  const opponent = color === 1 ? 2 : 1;
  const examined = new Set();
  const captured = [];

  for (const adjacent of neighbors(index)) {
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
  if (!validBoard(board)) throw new TypeError('board must be a 25-point array containing only 0, 1, or 2');

  const owners = Array(POINTS).fill(0);
  const visited = new Set();
  let black = 0;
  let white = 0;
  let neutral = 0;

  for (let start = 0; start < POINTS; start += 1) {
    if (board[start] !== 0 || visited.has(start)) continue;
    const region = [];
    const boundaryColors = new Set();
    const pending = [start];
    visited.add(start);

    while (pending.length > 0) {
      const current = pending.pop();
      region.push(current);
      for (const next of neighbors(current)) {
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

export function score(board, captures = {}, includeCaptures = true) {
  const area = territory(board);
  const captured = { 1: captures[1] ?? 0, 2: captures[2] ?? 0 };
  return {
    ...area,
    territory: { black: area.black, white: area.white },
    captures: captured,
    black: area.black + (includeCaptures ? captured[1] : 0),
    white: area.white + (includeCaptures ? captured[2] : 0),
    includeCaptures,
  };
}

function positionKey(board, nextTurn) {
  return `${board.join('')}:${nextTurn}`;
}

function finishByPasses(state) {
  const result = territory(state.board);
  const totals = score(state.board, state.captures, state.includeCaptures !== false);
  const winner = totals.black > totals.white ? 1 : totals.white > totals.black ? 2 : 0;
  return { ...state, over: true, reason: 'passes', result, winner };
}

export function newGame() {
  const board = Array(POINTS).fill(0);
  return {
    board,
    initialBoard: board.slice(),
    turn: 1,
    passes: 0,
    over: false,
    reason: '',
    moveNumber: 0,
    lastMove: null,
    captures: { 1: 0, 2: 0 },
    includeCaptures: true,
    history: [positionKey(board, 1)],
    log: [],
  };
}

export function play(state, indexOrNull) {
  if (!state || !validBoard(state.board) || (state.turn !== 1 && state.turn !== 2)) {
    return { ok: false, state, captured: [], error: 'invalid-state' };
  }
  if (state.over) return { ok: false, state, captured: [], error: 'game-over' };

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

export function setupGame(board) {
  if (!validBoard(board)) throw new TypeError('invalid-board');
  for (let index = 0; index < POINTS; index += 1) {
    if (board[index] && group(board, index).liberties.length === 0) {
      throw new Error('no-liberties');
    }
  }
  return { ...newGame(), board: board.slice(), initialBoard: board.slice(), history: [positionKey(board, 1)] };
}

// Return to just before the latest human move, including any CPU reply.
// Replay also restores captures, pass streak, last move, score and ko history.
export function undoHumanTurn(state) {
  const lastHuman = state.log.findLastIndex((move) => move.color === 1);
  if (lastHuman < 0) return null;
  let restored = setupGame(state.initialBoard ?? Array(POINTS).fill(0));
  for (const move of state.log.slice(0, lastHuman)) {
    const result = play(restored, move.index);
    if (!result.ok) throw new Error('invalid-history');
    restored = result.state;
  }
  return { ...restored, includeCaptures: state.includeCaptures !== false };
}
