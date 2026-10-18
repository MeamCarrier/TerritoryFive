import { neighbors, group, tryMove, territory, score } from './engine.js';

const PASS = null;
const MAX_DEPTH = 9;
const NODE_BUDGET = 140_000;
const SEARCH_LIMIT = Symbol('search-limit');

function evaluate(board, color, captures, includeCaptures) {
  const area = territory(board);
  const sign = color === 1 ? 1 : -1;
  let value = sign * ((area.black - area.white) + (includeCaptures ? captures[1] - captures[2] : 0)) * 3.5;
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

  // Empty intersections near safe stones are useful for future territory,
  // but never count as points until the territory rule actually assigns them.
  for (let i = 0; i < board.length; i += 1) {
    if (board[i] !== 0) continue;
    let own = 0;
    let enemy = 0;
    for (const next of neighbors(i)) {
      if (board[next] === color) own += 1;
      else if (board[next] === 3 - color) enemy += 1;
    }
    value += (own - enemy) * 0.16;
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

function movePriority(move, color, includeCaptures) {
  const capture = includeCaptures ? move.captured.length * 12 : 0;
  const liberties = group(move.board, move.index).liberties.length;
  let contact = 0;
  for (const next of neighbors(move.index)) {
    if (move.board[next] === 3 - color) contact += 1;
  }
  return capture + Math.min(liberties, 4) * 1.5 + contact * 0.3;
}

function orderedMoves(board, color, includeCaptures) {
  return legalMoves(board, color)
    .map((move) => ({ ...move, priority: movePriority(move, color, includeCaptures) }))
    .sort((a, b) => b.priority - a.priority);
}

function search(board, color, captures, passes, depth, alpha, beta, budget, includeCaptures) {
  budget.nodes += 1;
  if (budget.nodes > NODE_BUDGET) throw SEARCH_LIMIT;
  if (passes >= 2) {
    const result = score(board, captures, includeCaptures);
    return (color === 1 ? result.black - result.white : result.white - result.black) * 10000;
  }
  if (depth === 0) return evaluate(board, color, captures, includeCaptures);

  let best = -Infinity;
  const nextColor = 3 - color;
  const moves = orderedMoves(board, color, includeCaptures);
  moves.push({ index: PASS, board, captured: [], priority: -1 });

  for (const move of moves) {
    const nextPasses = move.index === PASS ? passes + 1 : 0;
    const nextCaptures = { ...captures, [color]: captures[color] + move.captured.length };
    const value = -search(move.board, nextColor, nextCaptures, nextPasses, depth - 1, -beta, -alpha, budget, includeCaptures);
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
  let chosen = { index: PASS, board: state.board, captured: [], value: -Infinity };
  let previous = null;
  const budget = { nodes: 0 };

  for (let depth = 1; depth <= MAX_DEPTH; depth += 1) {
    let iterationBest = { index: PASS, board: state.board, captured: [], value: -Infinity };
    let alpha = -Infinity;
    const moves = orderedMoves(state.board, color, includeCaptures);
    if (previous && previous.index !== PASS) {
      moves.sort((a, b) => (a.index === previous.index ? -1 : b.index === previous.index ? 1 : 0));
    }
    moves.push({ index: PASS, board: state.board, captured: [], priority: -1 });
    try {
      for (const move of moves) {
        const nextPasses = move.index === PASS ? state.passes + 1 : 0;
        const nextCaptures = { ...state.captures, [color]: state.captures[color] + move.captured.length };
        const value = -search(move.board, 3 - color, nextCaptures, nextPasses, depth - 1, -Infinity, -alpha, budget, includeCaptures);
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

export function lesson(name) {
  const patterns = {
    pass: ['BBWWW', 'B.W.W', 'BBWWW', 'B.W.W', 'BBWWW'],
    capture: ['.B...', 'BWB..', '.....', '...W.', '.....'],
    space: ['BBBBB', 'B...B', 'B...B', 'BBBBB', 'WWWWW'],
  };
  return patterns[name]?.flatMap((row) => [...row].map((v) => v === 'B' ? 1 : v === 'W' ? 2 : 0));
}

// These are verified teaching lines, not a joseki book or an exhaustive solution.
// All lessons use territory-only scoring and the same black-first rules as play.
export const BASIC_LESSONS = [
  {
    id: 'take', title: '1. アタリを取る',
    rows: ['.WBBB', 'WWBBB', 'BBBBB', 'B.BWW', 'BBB.W'],
    objective: '白3子の最後の呼吸点を見つけ、取ってから勝ち切ろう。',
    focus: [1, 5, 6], good: 0, bad: 16,
    hint: '白のB1・A2・B2はひとつの石の集まり。最後の呼吸点はA1。',
    principle: 'アタリは呼吸点があと1つの状態。その最後の空点に打つと、つながった相手の石を取れる。',
    goodLine: [0, 6, null, null], badLine: [16, 23, null, null],
    goodNotes: ['A1で白3子を捕獲。空いた場所も、白が入り直せばまだ確定した地ではない。', '白はB2へ入り直す。取った石は表示するが、この練習では得点に加えない。', '黒はB4の空点を残してパス。', '白もパス。黒の地1点、白0点で黒の勝ち。'],
    badNote: 'B4を埋めると、黒の大きな石群の呼吸点はD5だけになる。白D5で取られ、連続パスで黒0点・白18点。取る手と、自分の安全を一緒に見る。',
  },
  {
    id: 'connect', title: '2. 切られる前につなぐ',
    rows: ['BBWW.', 'W.BBB', 'WBB.B', 'WBBBB', '.BBBB'],
    objective: '左上の黒2子を仲間につなぎ、取られずに勝ち切ろう。',
    focus: [0, 1], good: 6, bad: null,
    hint: 'A1・B1の黒2子の呼吸点はB2だけ。B2なら右と下の黒にもつながる。',
    principle: '石は上下左右でつながる。弱い石を仲間につなぐと、呼吸点を共有して助けられる。',
    goodLine: [6, null, null], badLine: [null, 6, null, null],
    goodNotes: ['B2で左上の黒2子が大きな黒の石群につながり、呼吸点が増える。', '白はパス。黒のD3は、まだ埋めない。', '黒もパス。黒の地1点、白0点で黒の勝ち。'],
    badNote: 'つながずパスすると、白B2で左上の黒2子を取られる。その後に連続パスすると、黒1点・白2点で白の勝ち。今は地を埋めるより、弱い石を助ける。',
  },
  {
    id: 'keep', title: '3. 地を埋めずに残す',
    rows: ['BBWWW', '.BWWW', 'BBWW.', '.BWWW', 'BBWWW'],
    objective: '黒の2つの空点を守り、余計な一手を打たずに勝とう。',
    focus: [5, 15], good: null, bad: 5,
    hint: '黒の地はA2とA4の2点、白はE3の1点。今の形なら、打たずにパスで残せる。',
    principle: '地は囲った空点。完成した地を埋めると点が減る。この配置では、2つの独立した空点を残すことが石の安全にもつながる。',
    goodLine: [null, null], badLine: [5, 15, null, null],
    goodNotes: ['黒はパス。A2・A4の2つの地をそのまま残す。', '白もパス。黒2点、白1点で黒の勝ち。'],
    badNote: 'A2を埋めると、黒の石群の呼吸点はA4だけになる。白A4で黒が全部取られ、連続パスで黒0点・白10点。ただ点が減るだけでなく、石を失う場合もある。',
  },
];

export function basicLessonBoard(item) {
  return item.rows.flatMap((row) => [...row].map((v) => v === 'B' ? 1 : v === 'W' ? 2 : 0));
}
