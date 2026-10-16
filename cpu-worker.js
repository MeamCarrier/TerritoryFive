import { chooseMove } from './cpu.js';

self.addEventListener('message', (event) => {
  const { token, state } = event.data ?? {};
  const choice = chooseMove(state);
  self.postMessage({ token, choice });
});
