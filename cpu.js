import { neighbors, group, tryMove, territory, score, RULES } from './engine.js';

const PASS = null;
const MAX_DEPTH = 9;
const NODE_BUDGET = 140_000;
const NINE_NODE_BUDGET = 9_000;
const SEARCH_LIMIT = Symbol('search-limit');

function evaluate(board, color, captures, includeCaptures, rules = 'custom', komi = 0) {
  const size = Math.sqrt(board.length);
  const totals = score(board, captures, includeCaptures, rules, komi);
  const sign = color === 1 ? 1 : -1;
  let value = sign * (totals.black - totals.white) * 3.5;
  const seen = new Set();

  for (let i = 0; i < board.length; i += 1) {
    const stone = board[i];
    if (!stone || seen.has(i)) continue;
    const g = group(board, i);
    for (const point of g.stones) seen.add(point);
    const side = stone === color ? 1 : -1;
    const libertyCount = g.liberties.length;
    if (libertyCount === 1) value -= side * (7 + g.stones.length * 2.2);
    else if (libertyCount === 2) value -= side * (2 + g.stones.length * 0.7);
    else value += side * Math.min(libertyCount, 5) * 0.12;
  }

  if (rules !== RULES.JUNGO) {
    // Empty intersections near safe stones are useful for future territory,
    // but never count until the selected territory rule assigns them.
    for (let i = 0; i < board.length; i += 1) {
      if (board[i] !== 0) continue;
      let own = 0;
      let enemy = 0;
      for (const next of neighbors(i, size)) {
        if (board[next] === color) own += 1;
        else if (board[next] === 3 - color) enemy += 1;
      }
      value += (own - enemy) * 0.16;
    }
  }
  return value;
}

function legalMoves(board, color) {
  const moves = [];
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== 0) continue;
    const move = tryMove(board, color, index);
    if (move.ok) moves.push({ index, board: move.board, captured: move.captured });
  }
  return moves;
}

function movePriority(move, color, includeCaptures, rules) {
  const size = Math.sqrt(move.board.length);
  const capture = includeCaptures || rules === RULES.JUNGO ? move.captured.length * 12 : 0;
  const liberties = group(move.board, move.index).liberties.length;
  let contact = 0;
  for (const next of neighbors(move.index, size)) {
    if (move.board[next] === 3 - color) contact += 1;
  }
  return capture + Math.min(liberties, 4) * 1.5 + contact * 0.3;
}

function orderedMoves(board, color, includeCaptures, rules) {
  const size = Math.sqrt(board.length);
  const moves = legalMoves(board, color)
    .map((move) => ({ ...move, priority: movePriority(move, color, includeCaptures, rules) }))
    .sort((a, b) => b.priority - a.priority);
  if (size !== 9) return moves;

  // On the larger board, search locally around existing stones plus a compact
  // set of central/opening points. This keeps the worker responsive.
  const occupied = board.flatMap((point, index) => point ? [index] : []);
  const distanceFromCenter = (index) => {
    const row = Math.floor(index / size);
    const col = index % size;
    return Math.abs(row - 4) + Math.abs(col - 4);
  };
  const local = moves.filter(({ index, captured }) => captured.length || occupied.some((stone) => {
    const rowGap = Math.abs(Math.floor(index / size) - Math.floor(stone / size));
    const colGap = Math.abs(index % size - stone % size);
    return Math.max(rowGap, colGap) <= 2;
  }));
  const candidates = local.length ? local : moves;
  return candidates
    .map((move) => ({ ...move, priority: move.priority - distanceFromCenter(move.index) * (occupied.length ? 0.08 : 0.45) }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 16);
}

function search(board, color, captures, passes, depth, alpha, beta, budget, includeCaptures, rules, komi) {
  budget.nodes += 1;
  if (budget.nodes > (board.length === 81 ? NINE_NODE_BUDGET : NODE_BUDGET)) throw SEARCH_LIMIT;
  if (passes >= 2) {
    const result = score(board, captures, includeCaptures, rules, komi);
    return (color === 1 ? result.black - result.white : result.white - result.black) * 10000;
  }
  if (depth === 0) return evaluate(board, color, captures, includeCaptures, rules, komi);

  let best = -Infinity;
  const nextColor = 3 - color;
  const moves = orderedMoves(board, color, includeCaptures, rules);
  moves.push({ index: PASS, board, captured: [], priority: -1 });

  for (const move of moves) {
    const nextPasses = move.index === PASS ? passes + 1 : 0;
    const nextCaptures = { ...captures, [color]: captures[color] + move.captured.length };
    const value = -search(move.board, nextColor, nextCaptures, nextPasses, depth - 1, -beta, -alpha, budget, includeCaptures, rules, komi);
    if (value > best) best = value;
    if (value > alpha) alpha = value;
    if (alpha >= beta) break;
  }
  return best;
}

export function chooseMove(state) {
  if (!state || state.over) return { index: PASS, reason: '対局は終了しています。' };
  const color = state.turn;
  const includeCaptures = state.includeCaptures !== false;
  const rules = state.rules ?? 'custom';
  const komi = state.komi ?? 0;
  let chosen = { index: PASS, board: state.board, captured: [], value: -Infinity };
  let previous = null;
  const budget = { nodes: 0 };

  for (let depth = 1; depth <= MAX_DEPTH; depth += 1) {
    let iterationBest = { index: PASS, board: state.board, captured: [], value: -Infinity };
    let alpha = -Infinity;
    const moves = orderedMoves(state.board, color, includeCaptures, rules);
    if (previous && previous.index !== PASS) {
      moves.sort((a, b) => (a.index === previous.index ? -1 : b.index === previous.index ? 1 : 0));
    }
    moves.push({ index: PASS, board: state.board, captured: [], priority: -1 });
    try {
      for (const move of moves) {
        const nextPasses = move.index === PASS ? state.passes + 1 : 0;
        const nextCaptures = { ...state.captures, [color]: state.captures[color] + move.captured.length };
        const prior = state.log?.at(-1);
        if ([RULES.JAPANESE, RULES.JUNGO].includes(rules) && prior?.index !== null && prior?.captured?.length === 1 && move.index !== PASS && state.history?.length > 1 &&
            move.board.join('') === state.history[state.history.length - 2].split(':')[0]) continue;
        const value = -search(move.board, 3 - color, nextCaptures, nextPasses, depth - 1, -Infinity, -alpha, budget, includeCaptures, rules, komi);
        if (value > iterationBest.value) {
          iterationBest = { ...move, value };
          alpha = value;
        }
      }
      chosen = iterationBest;
      previous = iterationBest;
    } catch (error) {
      if (error !== SEARCH_LIMIT) throw error;
      break;
    }
  }

  if (chosen.index === PASS) return { index: PASS, reason: '探索した範囲では、打つより空点を残す方が有利と判断しました。' };
  if (chosen.captured.length) return { index: chosen.index, reason: '相手の石を' + chosen.captured.length + '個取り、盤面を読み直します。' };
  return { index: chosen.index, reason: '数手先の陣地と石の安全を読んで選びました。' };
}
