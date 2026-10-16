import { chooseMove } from './cpu.js?v=20261017-2';

self.addEventListener('message', (event) => {
  const { token, state } = event.data ?? {};
  const choice = chooseMove(state);
  self.postMessage({ token, choice });
});
