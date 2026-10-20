import { SIZE, RULES, encodeSetup, decodeSetup, newGame, play, territory, score, stopGame, setupGame, group, finishAgreement, resumeAfterAgreement, undoHumanTurn } from './engine.js?v=20261020-4';
import { chooseMove } from './cpu.js?v=20261020-2';

const $ = (id) => document.getElementById(id);
const boardNode = $('points');
const phaseNode = $('phase');
const announcement = $('announcement');
const resultNode = $('result');
const MOVE_ERRORS = {
  occupied: 'そこにはすでに石があります。',
  suicide: '自分の石の呼吸点がなくなる手は打てません。',
  'invalid-index': 'その交点には打てません。',
  ko: 'コウの直後の取り返しはできません。別の場所に打ってから試してください。',
};

let game = newGame();
let showTerritory = true;
let cpuThinking = false;
let generation = 0;
let draftBoard = null;
let draftIncludeCaptures = false;
function makeCpuWorker() {
  try {
    return new Worker(new URL('./cpu-worker.js?v=20261020-2', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}
let cpuWorker = makeCpuWorker();

function cancelCpu() {
  generation += 1;
  cpuThinking = false;
  cpuWorker?.terminate();
  cpuWorker = makeCpuWorker();
}

function colorName(color) { return color === 1 ? '黒' : '白'; }
function coordinate(index) {
  return `${String.fromCharCode(65 + index % SIZE)}${Math.floor(index / SIZE) + 1}`;
}
function isHumanTurn() { return !draftBoard && !game.over && game.turn === (game.playerColor ?? 1) && !cpuThinking; }

function setAnnouncement(message, error = false) {
  announcement.textContent = message;
  announcement.classList.toggle('error', error);
}

function scoreTrend() {
  // Replay legality under the permissive rule so changing rule mode mid-game
  // does not truncate earlier moves that are no longer legal under simple ko.
  let replay = setupGame(game.initialBoard ?? Array(SIZE * SIZE).fill(0), RULES.CUSTOM, 0, false, game.initialTurn ?? 1);
  const points = [{ ...score(replay.board, replay.captures, game.includeCaptures, game.rules, game.komi), move: 0 }];
  for (const [index, move] of game.log.entries()) {
    const next = play(replay, move.index);
    if (!next.ok) break;
    replay = next.state;
    points.push({ ...score(replay.board, replay.captures, game.includeCaptures, game.rules, game.komi), move: index + 1 });
  }
  return points.slice(-7);
}

function renderScoreChart() {
  const svg = $('score-chart');
  const data = scoreTrend();
  const width = Math.max(280, Math.round(svg.clientWidth || 520));
  const height = Math.max(90, Math.round(($('board').clientWidth || 440) * 0.34));
  const left = width * 0.09;
  const right = width * 0.97;
  const top = height * 0.12;
  const bottom = height * 0.76;
  const maxScore = Math.max(1, ...data.flatMap((point) => [point.black, point.white]));
  const ceiling = Math.max(5, Math.ceil(maxScore / 5) * 5);
  const x = (index) => data.length < 2 ? (left + right) / 2 : left + (right - left) * index / (data.length - 1);
  const y = (value) => bottom - (bottom - top) * value / ceiling;
  const make = (name, attrs = {}) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  };
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.height = `${height}px`;
  const desc = make('desc');
  desc.textContent = `現在の採点方法で再集計。直近最大6手の得点推移。黒は${data.at(-1).black}点、白は${data.at(-1).white}点。`;
  svg.append(desc);
  for (let tick = 0; tick <= 2; tick += 1) {
    const value = ceiling * tick / 2;
    const yy = y(value);
    svg.append(make('line', { x1: left, y1: yy, x2: right, y2: yy, class: 'chart-grid' }));
    const label = make('text', { x: left - 8, y: yy + 4, 'text-anchor': 'end', class: 'chart-axis' });
    label.textContent = String(Math.round(value * 10) / 10);
    svg.append(label);
  }
  const axis = make('text', { x: left, y: height * 0.94, class: 'chart-axis' });
  axis.textContent = data.length === 7 ? `${data[0].move}手目` : '開始';
  svg.append(axis);
  const end = make('text', { x: right, y: height * 0.94, 'text-anchor': 'end', class: 'chart-axis' });
  end.textContent = data.at(-1).move ? `${data.at(-1).move}手目` : '開始';
  svg.append(end);
  for (const [key, color, className] of [['black', 1, 'chart-black'], ['white', 2, 'chart-white']]) {
    const path = data.map((point, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(point[key])}`).join(' ');
    svg.append(make('path', { d: path, class: className }));
    data.forEach((point, index) => {
      const dot = make('circle', { cx: x(index), cy: y(point[key]), r: 3, class: className });
      const title = make('title');
      title.textContent = `${point.move === 0 ? '開始時' : `${point.move}手目`}・${color === 1 ? '黒' : '白'} ${point[key]}点`;
      dot.append(title);
      svg.append(dot);
    });
  }
  $('chart-note').textContent = `直近${Math.min(game.log.length, 6)}手（累計点）`;
}

function render() {
  const board = draftBoard ?? game.board;
  const area = territory(board);
  const totals = score(board, game.captures, game.includeCaptures, game.rules, game.komi);
  const humanTurn = isHumanTurn();
  const ended = game.over;
  $('black-who').textContent = game.playerColor === 1 ? 'あなた' : 'CPU';
  $('white-who').textContent = game.playerColor === 2 ? 'あなた' : 'CPU';
  phaseNode.textContent = draftBoard ? '置き石の配置中' : game.phase === 'agreement' ? '死活確認・終局前' : ended ? '対局終了' : cpuThinking ? 'CPUが読みを進めています…' : `${humanTurn ? 'あなた' : 'CPU'}（${colorName(game.turn)}）の手番`;
  $('move-no').textContent = `第 ${game.moveNumber + 1} 手`;
  $('black-points').innerHTML = `${totals.black}<small>点</small>`;
  $('white-points').innerHTML = `${totals.white}<small>点</small>`;
  $('black-breakdown').textContent = `地 ${area.black}${game.includeCaptures ? ' + ' : '・'}捕獲 ${game.captures[1]}子`;
  $('white-breakdown').textContent = `地 ${area.white}${game.includeCaptures ? ' + ' : '・'}捕獲 ${game.captures[2]}子${game.rules === RULES.JAPANESE ? ` + コミ ${game.komi}` : ''}`;
  const setupRules = draftBoard ? $('ruleset').value : game.rules ?? RULES.CUSTOM;
  $('include-captures').checked = game.rules === RULES.JAPANESE || (draftBoard ? draftIncludeCaptures : game.includeCaptures);
  const rulesLocked = !draftBoard && (ended || game.phase === 'agreement');
  $('include-captures').disabled = setupRules === RULES.JAPANESE || rulesLocked;
  $('ruleset').value = setupRules;
  $('ruleset').disabled = rulesLocked;
  if (!draftBoard) {
    $('komi').value = String(game.komi ?? 0);
  }
  $('komi').disabled = setupRules !== RULES.JAPANESE || rulesLocked;
  $('komi-row').hidden = setupRules !== RULES.JAPANESE;
  $('komi').hidden = setupRules !== RULES.JAPANESE;
  $('share-setup').disabled = false;
  $('agreement-controls').hidden = game.phase !== 'agreement';
  $('pass-count').textContent = `連続パス ${Math.min(game.passes, 2)} / 2`;
  $('pass').disabled = !humanTurn || game.phase === 'agreement';
  $('stop-game').disabled = ended || Boolean(draftBoard);
  $('undo').disabled = Boolean(draftBoard) || !game.log.some((move) => move.color === (game.playerColor ?? 1));
  $('setup-controls').hidden = !draftBoard;
  $('setup-player').value = String(draftBoard ? ($('setup-player').value || game.playerColor || 1) : (game.playerColor ?? 1));
  $('edit-setup').disabled = Boolean(draftBoard) || game.phase === 'agreement';
  $('black-score').classList.toggle('active-player', !draftBoard && game.phase === 'play' && !ended && game.turn === 1);
  $('white-score').classList.toggle('active-player', !draftBoard && game.phase === 'play' && !ended && game.turn === 2);

  boardNode.replaceChildren();
  board.forEach((stone, index) => {
    const point = document.createElement('button');
    const row = Math.floor(index / SIZE);
    const col = index % SIZE;
    const owner = showTerritory ? area.owners[index] : 0;
    point.type = 'button';
    point.className = `point${owner === 1 ? ' owned-black' : owner === 2 ? ' owned-white' : ''}${!draftBoard && game.lastMove === index ? ' last' : ''}${window.__deadMarks?.has(index) ? ' dead-marked' : ''}`;
    point.style.left = `${14 + col * 18}%`;
    point.style.top = `${14 + row * 18}%`;
    point.setAttribute('aria-label', `${coordinate(index)} ${stone ? `${colorName(stone)}の石` : '空点'}${owner ? `・${colorName(owner)}の地` : ''}`);
    point.disabled = game.phase === 'agreement' ? !stone : !draftBoard && (!humanTurn || stone !== 0);
    if (stone) {
      const stoneNode = document.createElement('span');
      stoneNode.className = `stone ${stone === 1 ? 'black' : 'white'}`;
      point.append(stoneNode);
    }
    point.addEventListener('click', () => {
      if (game.phase === 'agreement' && !draftBoard) {
        const indices = group(game.board, index).stones;
        window.__deadMarks ??= new Set();
        const remove = indices.every((i) => window.__deadMarks.has(i));
        for (const i of indices) remove ? window.__deadMarks.delete(i) : window.__deadMarks.add(i);
        render();
        setAnnouncement('死に石候補を選択中。選択した石群は終局時に取り除かれます。');
      } else if (draftBoard) {
        const color = Number($('setup-color').value);
        draftBoard[index] = draftBoard[index] === color ? 0 : color;
        render();
      } else humanMove(index);
    });
    boardNode.append(point);
  });

  $('hint').setAttribute('aria-pressed', String(showTerritory));
  $('hint').innerHTML = `空点の色分け <span>${showTerritory ? 'ON' : 'OFF'}</span>`;
  $('history-count').textContent = `${game.log.length}手`;
  renderScoreChart();
  const history = $('history');
  history.replaceChildren();
  game.log.forEach((move, index) => {
    const item = document.createElement('li');
    const player = move.color === game.playerColor ? `あなた（${colorName(move.color)}）` : `CPU（${colorName(move.color)}）`;
    const action = move.index === null ? 'パス' : coordinate(move.index);
    item.textContent = `${index + 1}. ${player}：${action}${move.captured.length ? `、${move.captured.length}子を捕獲` : ''}`;
    history.append(item);
  });

  resultNode.hidden = !ended || Boolean(draftBoard);
  if (ended && !draftBoard) renderResult(totals);
}

$('score-chart-panel').addEventListener('toggle', () => {
  if ($('score-chart-panel').open) renderScoreChart();
});

function renderResult(score) {
  const kind = $('result-kind');
  const title = $('result-title');
  const detail = $('result-detail');
  if (game.reason === 'passes') {
    kind.textContent = '双方連続パスで終局';
    title.textContent = game.winner === 0 ? '引き分け' : `${colorName(game.winner)}の勝ち`;
    detail.textContent = `黒：地 ${score.territory.black} 点 + 捕獲 ${score.captures[1]} 子 = ${score.black} 点。白：地 ${score.territory.white} 点 + 捕獲 ${score.captures[2]} 子 + コミ ${score.komi} 目 = ${score.white} 点。`;
  } else {
    kind.textContent = '任意終了';
    title.textContent = '対局を終了しました';
    detail.textContent = 'この対局の勝敗・得点は確定していません。新しい対局を始められます。';
  }
}

function recordMove(index) {
  const result = play(game, index);
  if (!result.ok) {
    setAnnouncement(MOVE_ERRORS[result.error] ?? 'その手は打てません。', true);
    return false;
  }
  game = result.state;
  const mover = result.state.log.at(-1);
  if (game.over) {
    const totals = score(game.board, game.captures, game.includeCaptures, game.rules, game.komi);
    setAnnouncement(game.phase === 'agreement' ? '双方がパスしました。死活を確認して終局するか、対局を再開してください。' : `双方が続けてパスしました。黒 ${totals.black} 点、白 ${totals.white} 点で終局です。`);
  } else if (mover.index === null) {
    setAnnouncement(`${colorName(mover.color)}がパスしました。${game.passes === 1 ? '相手もパスすると終局です。' : '対局を続けます。'}`);
  } else if (mover.captured.length) {
    setAnnouncement(`${colorName(mover.color)}が${mover.captured.length}子を取りました。`);
  } else {
    setAnnouncement(`${colorName(mover.color)}が${coordinate(mover.index)}に打ちました。`);
  }
  render();
  return true;
}

function humanMove(index) {
  if (!isHumanTurn()) return;
  if (recordMove(index)) scheduleCpu();
}

function scheduleCpu() {
  if (draftBoard || game.over || game.turn === (game.playerColor ?? 1) || cpuThinking) return;
  cpuThinking = true;
  const token = generation;
  setAnnouncement('CPUが数手先を読んでいます。');
  render();
  const finish = (choice) => {
    if (token !== generation || game.over || game.turn === (game.playerColor ?? 1)) return;
    cpuThinking = false;
    recordMove(choice.index);
    if (!game.over) setAnnouncement(`CPU：${choice.reason}`);
    render();
  };
  if (cpuWorker) {
    cpuWorker.onmessage = (event) => {
      if (event.data?.token === token) finish(event.data.choice);
    };
    cpuWorker.onerror = () => {
      if (token === generation) {
        cpuThinking = false;
        setAnnouncement('CPUの探索に失敗しました。新しい対局でやり直してください。', true);
        render();
      }
    };
    cpuWorker.postMessage({ token, state: game });
  } else {
    window.setTimeout(() => {
      if (token === generation && !draftBoard && !game.over && game.turn !== (game.playerColor ?? 1)) finish(chooseMove(game));
    }, 40);
  }
}

function stopGameNow() {
  if (game.over) return;
  cancelCpu();
  game = stopGame(game);
  setAnnouncement('対局を終了しました。勝敗・得点は確定していません。');
  render();
  resultNode.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function beginGame(nextGame, message) {
  cancelCpu();
  draftBoard = null;
  game = nextGame;
  window.__deadMarks = new Set();
  resultNode.hidden = true;
  setAnnouncement(message);
  render();
}

$('pass').addEventListener('click', () => {
  if (isHumanTurn() && recordMove(null)) scheduleCpu();
});
$('stop-game').addEventListener('click', stopGameNow);
$('undo').addEventListener('click', () => {
  if (draftBoard) return;
  const restored = undoHumanTurn(game);
  if (!restored) return;
  beginGame(restored, 'あなたが打つ前に戻しました。別の手を試せます。');
});
$('edit-setup').addEventListener('click', () => {
  if (game.phase === 'agreement') return;
  cancelCpu();
  $('ruleset').value = game.rules ?? RULES.CUSTOM;
  $('komi').value = String(game.komi ?? 0);
  draftIncludeCaptures = game.rules === RULES.JAPANESE || game.includeCaptures;
  $('setup-player').value = String(game.playerColor ?? 1);
  draftBoard = game.board.slice();
  setAnnouncement('黒・白・消しゴムを選んで盤をタップ。配置から始めると手の記録をリセットします。');
  render();
});
$('clear-setup').addEventListener('click', () => {
  if (draftBoard) { draftBoard.fill(0); render(); }
});
$('cancel-setup').addEventListener('click', () => {
  draftBoard = null;
  setAnnouncement('配置を取り消し、元の対局に戻りました。');
  render();
  scheduleCpu();
});
$('start-setup').addEventListener('click', () => {
  if (!draftBoard) return;
  try {
    const rules = $('ruleset').value;
    const komi = rules === RULES.JAPANESE ? Number($('komi').value) : 0;
    const playerColor = Number($('setup-player').value);
    beginGame(setupGame(draftBoard, rules, komi, draftIncludeCaptures, playerColor), `置き石から対局開始。あなた（${colorName(playerColor)}）の手番です。`);
    scheduleCpu();
  } catch (error) {
    setAnnouncement(error.message === 'invalid-rules' ? 'コミは0〜7.5目のリストから選んでください。' : '呼吸点が0の石があります。消しゴムで石を取り除くか、隣の交点を空けてください。', true);
  }
});
$('ruleset').addEventListener('change', (event) => {
  const japanese = event.currentTarget.value === RULES.JAPANESE;
  $('komi-row').hidden = !japanese;
  $('komi').hidden = !japanese;
  if (draftBoard) {
    draftIncludeCaptures = japanese || $('include-captures').checked;
    $('include-captures').checked = draftIncludeCaptures;
    $('include-captures').disabled = japanese;
    render();
    return;
  }
  if (game.over || game.phase === 'agreement') return;
  const wasThinking = cpuThinking;
  if (wasThinking) cancelCpu();
  game = {
    ...game,
    rules: japanese ? RULES.JAPANESE : RULES.CUSTOM,
    komi: japanese ? Number($('komi').value) : 0,
    includeCaptures: japanese || game.includeCaptures,
  };
  setAnnouncement(`対局中のルールを${japanese ? '日本式（簡略対局）' : '五路の余白（独自ルール）'}へ変更しました。${wasThinking ? 'CPUは新しい条件で読み直します。' : ''}`);
  render();
  scheduleCpu();
});
$('komi').addEventListener('change', (event) => {
  if (draftBoard || game.over || game.phase === 'agreement' || game.rules !== RULES.JAPANESE) return;
  const wasThinking = cpuThinking;
  if (wasThinking) cancelCpu();
  game = { ...game, komi: Number(event.currentTarget.value) };
  setAnnouncement(`コミを${game.komi}目に変更しました。${wasThinking ? 'CPUは新しい条件で読み直します。' : ''}`);
  render();
  scheduleCpu();
});
$('share-setup').addEventListener('click', async () => {
  try {
    const board = draftBoard ?? game.initialBoard ?? game.board;
    const rules = draftBoard ? $('ruleset').value : game.rules;
    const komi = rules === RULES.JAPANESE ? Number(draftBoard ? $('komi').value : game.komi) : 0;
    const includeCaptures = rules === RULES.JAPANESE || Boolean(draftBoard ? draftIncludeCaptures : game.includeCaptures);
    const playerColor = Number(draftBoard ? $('setup-player').value : game.playerColor ?? 1);
    const nextTurn = draftBoard ? playerColor : (game.initialTurn ?? game.playerColor ?? 1);
    const link = new URL(location.href);
    link.hash = encodeSetup(board, rules, komi, includeCaptures, playerColor, nextTurn);
    $('setup-url').value = link.href;
    $('setup-url').hidden = false;
    await navigator.clipboard.writeText(link.href);
    setAnnouncement(`置き石・あなたの色（${colorName(playerColor)}）・ルール・コミを含むURLをコピーしました。`);
  } catch {
    $('setup-url').hidden = false;
    $('setup-url').focus(); $('setup-url').select();
    setAnnouncement('URLを表示しました。選択してコピーしてください。');
  }
});
$('finish-agreement').addEventListener('click', () => {
  const settled = finishAgreement(game, [...(window.__deadMarks ?? [])]);
  if (!settled.ok) return;
  game = settled.state;
  setAnnouncement('死活を確認して終局しました。日本式の地・捕獲石・コミで計算します。');
  render();
});
$('resume-game').addEventListener('click', () => {
  game = resumeAfterAgreement(game);
  window.__deadMarks = new Set();
  setAnnouncement('終局確認を取り消し、対局に戻ります。');
  render();
  scheduleCpu();
});
$('hint').addEventListener('click', () => { showTerritory = !showTerritory; render(); });
$('include-captures').addEventListener('change', (event) => {
  if (draftBoard) {
    draftIncludeCaptures = event.currentTarget.checked;
    return;
  }
  if (game.over) return;
  const wasThinking = cpuThinking;
  if (wasThinking) cancelCpu();
  game = { ...game, includeCaptures: event.currentTarget.checked };
  setAnnouncement(`捕獲した石を${game.includeCaptures ? '得点に含めます' : '得点から除外します'}。${wasThinking ? 'CPUはこの条件で読み直します。' : ''}`);
  render();
  scheduleCpu();
});
$('new-game').addEventListener('click', () => {
  if (game.over) return beginGame(newGame(), '新しい対局です。あなた（黒）の初手を打ってください。');
  $('confirm-dialog').showModal();
});
$('again').addEventListener('click', () => beginGame(newGame(), '新しい対局です。あなた（黒）の初手を打ってください。'));
$('cancel-dialog').addEventListener('click', () => $('confirm-dialog').close());
$('confirm-dialog-button').addEventListener('click', () => {
  $('confirm-dialog').close();
  beginGame(newGame(), '新しい対局です。あなた（黒）の初手を打ってください。');
});
let sharedSetup = decodeSetup(location.hash);
let invalidSharedSetup = false;
if (sharedSetup) {
  try {
    game = setupGame(sharedSetup.board, sharedSetup.rules, sharedSetup.komi, sharedSetup.includeCaptures, sharedSetup.playerColor, sharedSetup.turn);
  } catch {
    sharedSetup = null;
    invalidSharedSetup = true;
    setAnnouncement('共有URLの盤面は開始できません（呼吸点がない石があります）。', true);
  }
}
if (!invalidSharedSetup) setAnnouncement(sharedSetup ? `共有された置き石・ルール設定を読み込みました。あなたは${colorName(game.playerColor)}です。` : 'あなたは黒・先手です。空いている交点をタップして初手を打ちましょう。');
render();
scheduleCpu();
window.addEventListener('resize', renderScoreChart, { passive: true });
