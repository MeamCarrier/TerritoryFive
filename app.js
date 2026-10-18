import { SIZE, newGame, play, territory, score, stopGame, setupGame, undoHumanTurn } from './engine.js?v=20261017-3';
import { chooseMove, lesson, BASIC_LESSONS, basicLessonBoard } from './cpu.js?v=20261018-1';

const $ = (id) => document.getElementById(id);
const boardNode = $('points');
const phaseNode = $('phase');
const announcement = $('announcement');
const resultNode = $('result');
const HISTORY_NAMES = { pass: 'パスで余白を残す', capture: '取って空点を広げる', space: '広い空間を見る' };
const MOVE_ERRORS = {
  occupied: 'そこにはすでに石があります。',
  suicide: '自分の石の呼吸点がなくなる手は打てません。',
  'invalid-index': 'その交点には打てません。',
};

let game = newGame();
let showTerritory = true;
let cpuThinking = false;
let generation = 0;
let draftBoard = null;
let training = null;
function makeCpuWorker() {
  try {
    return new Worker(new URL('./cpu-worker.js?v=20261017-2', import.meta.url), { type: 'module' });
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
function isHumanTurn() { return !draftBoard && !game.over && game.turn === 1 && !cpuThinking && (!training || training.mode === 'challenge'); }

function teachingLine(item, moves) {
  let state = setupGame(basicLessonBoard(item));
  for (const index of moves) {
    const next = play(state, index);
    if (!next.ok) throw new Error('invalid-teaching-line');
    state = next.state;
  }
  return state;
}

function startTraining(mode = 'demo', branch = 'good') {
  const item = BASIC_LESSONS.find((entry) => entry.id === $('basic-select').value) ?? BASIC_LESSONS[0];
  cancelCpu();
  draftBoard = null;
  training = { item, mode, branch, step: 0, hinted: false };
  game = mode === 'compare' ? teachingLine(item, branch === 'good' ? item.goodLine : item.badLine) : setupGame(basicLessonBoard(item));
  setAnnouncement(mode === 'challenge' ? 'ヒントなしで挑戦。黒の手を考え、最後は連続パスで勝敗を確かめよう。' : 'お手本・比較では盤への着手はできません。手順と変化を見てみよう。');
  render();
}

function renderTraining() {
  $('basic-training').hidden = !training;
  $('basic-feedback').hidden = !training;
  $('normal-mode').setAttribute('aria-pressed', String(!training));
  $('learn-mode').setAttribute('aria-pressed', String(Boolean(training)));
  $('again').textContent = training ? '同じ配置で再挑戦' : 'もう一局、余白をつくる';
  if (!training) return;
  const { item, mode, step, hinted, branch } = training;
  $('basic-objective').textContent = item.objective;
  for (const stage of ['demo', 'compare', 'challenge']) {
    $(`basic-${stage}`).setAttribute('aria-pressed', String(mode === stage));
    $(`basic-${stage}-controls`).hidden = mode !== stage;
  }
  const scope = $('basic-scope');
  scope.textContent = mode === 'challenge' ? '白は通常対局と同じCPUが考えます。お手本と違う応手もあります。あらゆる応手への必勝を保証する問題ではありません。' : 'お手本と比較は、決められた白の応手での結果です。どんな応手にも勝てるという意味ではありません。';
  let text = item.principle;
  if (mode === 'demo') {
    text = step === 0 ? `${item.principle} 「次の一手を見る」で1手ずつ進めよう。` : `${step}手目／${item.goodLine.length}手：${item.goodNotes[step - 1]}`;
    $('basic-next').disabled = step >= item.goodLine.length;
    $('basic-next').textContent = step >= item.goodLine.length ? 'お手本は完了 · 次は「比べる」へ' : '次の一手を見る';
  } else if (mode === 'compare') {
    text = branch === 'good' ? `${item.principle} ${item.goodNotes.at(-1)}` : item.badNote;
    const summary = (moves) => {
      const state = teachingLine(item, moves);
      const totals = score(state.board, state.captures, false);
      const first = moves[0] === null ? 'パス' : coordinate(moves[0]);
      return `${first}から：黒${totals.black}点・白${totals.white}点`;
    };
    $('basic-comparison').textContent = `同じ初期配置から終局まで比較。正しい手 ${summary(item.goodLine)} ／ 失敗する手 ${summary(item.badLine)}。手の記録で全手順を確認できます。`;
    $('basic-good').setAttribute('aria-pressed', String(branch === 'good'));
    $('basic-bad').setAttribute('aria-pressed', String(branch === 'bad'));
  } else {
    text = game.log.length === 0 ? item.objective : '途中の点数だけで決めず、石の安全と最後に残す空点を考えよう。';
    if (hinted) text += ` ヒント：${item.hint}`;
    $('basic-hint').disabled = game.over;
    if (game.over) {
      if (game.reason !== 'passes') text = '今回は任意終了。達成にはせず、同じ配置から再挑戦できます。';
      else if (game.winner === 1) text = `${hinted ? 'ヒントを使って達成！' : '自力で達成！'} ${game.log[0]?.index === item.good ? '覚えた基本の手で' : 'お手本とは別の手で'}CPUに勝ちました。${item.principle}`;
      else text = `${game.winner === 0 ? '今回は引き分け。' : '今回は白の勝ち。'} お手本や比較で効き目を見直し、もう一度試そう。`;
    }
  }
  $('basic-explanation').textContent = text;
}

function setAnnouncement(message, error = false) {
  announcement.textContent = message;
  announcement.classList.toggle('error', error);
}

function scoreTrend() {
  let replay = setupGame(game.initialBoard ?? Array(SIZE * SIZE).fill(0));
  const points = [{ ...score(replay.board, replay.captures, game.includeCaptures), move: 0 }];
  for (const [index, move] of game.log.entries()) {
    const next = play(replay, move.index);
    if (!next.ok) break;
    replay = next.state;
    points.push({ ...score(replay.board, replay.captures, game.includeCaptures), move: index + 1 });
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
  const totals = score(board, game.captures, game.includeCaptures);
  const humanTurn = isHumanTurn();
  const ended = game.over;
  const fixedLine = Boolean(training && training.mode !== 'challenge');
  $('black-who').textContent = fixedLine ? 'お手本' : 'あなた';
  $('white-who').textContent = fixedLine ? '固定応手' : 'CPU';
  phaseNode.textContent = training && training.mode !== 'challenge' ? (training.mode === 'demo' ? 'お手本の手順' : '比較：終局した盤面') : draftBoard ? '置き石の配置中' : ended ? '対局終了' : cpuThinking ? 'CPUが読みを進めています…' : humanTurn ? 'あなた（黒）の手番' : 'CPU（白）の手番';
  $('move-no').textContent = `第 ${game.moveNumber + 1} 手`;
  $('black-points').innerHTML = `${totals.black}<small>点</small>`;
  $('white-points').innerHTML = `${totals.white}<small>点</small>`;
  $('black-breakdown').textContent = `地 ${area.black}${game.includeCaptures ? ' + ' : '・'}捕獲 ${game.captures[1]}子`;
  $('white-breakdown').textContent = `地 ${area.white}${game.includeCaptures ? ' + ' : '・'}捕獲 ${game.captures[2]}子`;
  $('include-captures').checked = game.includeCaptures;
  $('include-captures').disabled = ended || Boolean(draftBoard) || Boolean(training);
  $('pass-count').textContent = `連続パス ${Math.min(game.passes, 2)} / 2`;
  $('pass').disabled = !humanTurn;
  $('stop-game').disabled = ended || Boolean(draftBoard) || Boolean(training && training.mode !== 'challenge');
  $('undo').disabled = Boolean(draftBoard) || Boolean(training && training.mode !== 'challenge') || !game.log.some((move) => move.color === 1);
  $('setup-controls').hidden = !draftBoard;
  $('edit-setup').disabled = Boolean(draftBoard) || Boolean(training);
  $('black-score').classList.toggle('active-player', !draftBoard && !ended && game.turn === 1);
  $('white-score').classList.toggle('active-player', !draftBoard && !ended && game.turn === 2);

  boardNode.replaceChildren();
  board.forEach((stone, index) => {
    const point = document.createElement('button');
    const row = Math.floor(index / SIZE);
    const col = index % SIZE;
    const owner = showTerritory ? area.owners[index] : 0;
    point.type = 'button';
    point.className = `point${owner === 1 ? ' owned-black' : owner === 2 ? ' owned-white' : ''}${!draftBoard && game.lastMove === index ? ' last' : ''}`;
    if (training && (training.mode !== 'challenge' || training.hinted)) {
      if (training.item.focus.includes(index)) point.className += ' teaching-focus';
      if (training.item.good === index && game.board[index] === 0) point.className += ' teaching-target';
    }
    point.style.left = `${14 + col * 18}%`;
    point.style.top = `${14 + row * 18}%`;
    point.setAttribute('aria-label', `${coordinate(index)} ${stone ? `${colorName(stone)}の石` : '空点'}${owner ? `・${colorName(owner)}の地` : ''}`);
    point.disabled = !draftBoard && (!humanTurn || stone !== 0);
    if (stone) {
      const stoneNode = document.createElement('span');
      stoneNode.className = `stone ${stone === 1 ? 'black' : 'white'}`;
      point.append(stoneNode);
    }
    point.addEventListener('click', () => {
      if (draftBoard) {
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
    const player = move.color === 1 ? (fixedLine ? '黒（お手本）' : 'あなた（黒）') : (fixedLine ? '白（固定応手）' : 'CPU（白）');
    const action = move.index === null ? 'パス' : coordinate(move.index);
    item.textContent = `${index + 1}. ${player}：${action}${move.captured.length ? `、${move.captured.length}子を捕獲` : ''}`;
    history.append(item);
  });

  resultNode.hidden = !ended || Boolean(draftBoard);
  if (ended && !draftBoard) renderResult(totals);
  renderTraining();
}

function renderResult(score) {
  const kind = $('result-kind');
  const title = $('result-title');
  const detail = $('result-detail');
  if (game.reason === 'passes') {
    kind.textContent = '双方連続パスで終局';
    title.textContent = game.winner === 0 ? '引き分け' : `${colorName(game.winner)}の勝ち`;
    detail.textContent = `黒：地 ${score.territory.black} 点${game.includeCaptures ? ` + 捕獲 ${score.captures[1]} 子` : ''} = ${score.black} 点。白：地 ${score.territory.white} 点${game.includeCaptures ? ` + 捕獲 ${score.captures[2]} 子` : ''} = ${score.white} 点。`;
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
    const totals = score(game.board, game.captures, game.includeCaptures);
    setAnnouncement(`双方が続けてパスしました。黒 ${totals.black} 点、白 ${totals.white} 点で終局です。`);
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
  if (draftBoard || game.over || game.turn !== 2 || cpuThinking || (training && training.mode !== 'challenge')) return;
  cpuThinking = true;
  const token = generation;
  setAnnouncement('CPUが数手先を読んでいます。');
  render();
  const finish = (choice) => {
    if (token !== generation || game.over || game.turn !== 2) return;
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
      if (token === generation && !draftBoard && !game.over && game.turn === 2) finish(chooseMove(game));
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

function beginGame(nextGame, message, keepTraining = false) {
  cancelCpu();
  if (!keepTraining) training = null;
  draftBoard = null;
  game = nextGame;
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
  beginGame(restored, 'あなたが打つ前に戻しました。別の手を試せます。', true);
});
$('edit-setup').addEventListener('click', () => {
  if (training) return;
  cancelCpu();
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
    beginGame(setupGame(draftBoard), '置き石から対局開始。あなた（黒）の手番です。');
  } catch {
    setAnnouncement('呼吸点が0の石があります。消しゴムで石を取り除くか、隣の交点を空けてください。', true);
  }
});
$('hint').addEventListener('click', () => { showTerritory = !showTerritory; render(); });
$('include-captures').addEventListener('change', (event) => {
  if (game.over || draftBoard || training) return;
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
$('again').addEventListener('click', () => training ? startTraining('challenge') : beginGame(newGame(), '新しい対局です。あなた（黒）の初手を打ってください。'));
$('cancel-dialog').addEventListener('click', () => $('confirm-dialog').close());
$('confirm-dialog-button').addEventListener('click', () => {
  $('confirm-dialog').close();
  beginGame(newGame(), '新しい対局です。あなた（黒）の初手を打ってください。');
});
$('load-lesson').addEventListener('click', () => {
  const name = $('lesson-select').value;
  const board = lesson(name);
  if (!board) return;
  const next = setupGame(board);
  beginGame(next, `${HISTORY_NAMES[name]}の練習盤です。黒の手を考えてください。`);
});

$('learn-mode').addEventListener('click', () => { if (!training) startTraining(); });
$('normal-mode').addEventListener('click', () => { if (training) beginGame(newGame(), '通常対局に戻りました。黒の初手を打ってください。'); });
$('basic-select').addEventListener('change', () => startTraining());
for (const mode of ['demo', 'compare', 'challenge']) {
  $(`basic-${mode}`).addEventListener('click', () => startTraining(mode));
}
$('basic-next').addEventListener('click', () => {
  if (!training || training.mode !== 'demo' || training.step >= training.item.goodLine.length) return;
  const next = play(game, training.item.goodLine[training.step]);
  if (!next.ok) return;
  game = next.state;
  training.step += 1;
  setAnnouncement(training.item.goodNotes[training.step - 1]);
  render();
});
$('basic-replay').addEventListener('click', () => startTraining());
$('basic-good').addEventListener('click', () => startTraining('compare', 'good'));
$('basic-bad').addEventListener('click', () => startTraining('compare', 'bad'));
$('basic-retry').addEventListener('click', () => startTraining('challenge'));
$('basic-hint').addEventListener('click', () => {
  if (!training || training.mode !== 'challenge') return;
  training.hinted = true;
  render();
});

setAnnouncement('あなたは黒・先手です。空いている交点をタップして初手を打ちましょう。');
render();
window.addEventListener('resize', renderScoreChart, { passive: true });
