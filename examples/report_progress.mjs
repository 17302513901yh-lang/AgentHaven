// Report a simulated training run to a local AgentHaven board (Node.js 20+).
// Start AgentHaven, create a task, then run: node examples/report_progress.mjs
import { setTimeout as delay } from 'node:timers/promises';

const base = process.env.AGENTHAVEN_URL || 'http://127.0.0.1:4777';
const agent = process.env.AGENTHAVEN_AGENT || 'trainer-01';
const workspace = process.env.AGENTHAVEN_WORKSPACE || 'default';

async function post(path, body) {
  const url = new URL(path, base);
  url.searchParams.set('workspace', workspace);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AgentHaven-Agent': agent },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const details = await response.json().catch(() => null);
    throw new Error(`AgentHaven said ${response.status}: ${details?.error || response.statusText}`);
  }
  return response.json();
}

// Replace this stand-in with one step of your own training loop.
async function trainOneEpoch(epoch) {
  await delay(500);
  const loss = 2 * Math.exp(-epoch / 4);
  return { loss, accuracy: Math.min(0.99, 1 - loss / 2.2) };
}

async function main() {
  await post('/api/agents', { kind: 'neural-network', vendor: 'local', model: 'intent-classifier', skills: ['gpu', 'training'] });
  const { task, hint } = await post('/api/tasks/next', { claim: true });
  if (!task) {
    console.log('Nothing to do:', hint);
    return;
  }
  console.log(`Claimed ${task.id}: ${task.title}`);

  const epochs = 10;
  for (let epoch = 1; epoch <= epochs; epoch++) {
    const { loss, accuracy } = await trainOneEpoch(epoch);
    const state = await post(`/api/tasks/${task.id}/progress`, {
      progress: 100 * epoch / epochs,
      message: `epoch ${epoch}/${epochs}`,
      usage: { costUsd: 0.01 }, // Example usage per step.
      metrics: { loss: Number(loss.toFixed(4)), accuracy: Number(accuracy.toFixed(4)) },
    });
    console.log(`epoch ${epoch}: loss ${loss.toFixed(3)} accuracy ${accuracy.toFixed(3)}`);
    if (state.status === 'blocked') {
      console.log('Stopped by the board:', state.blockedReason);
      return;
    }
  }

  await post(`/api/tasks/${task.id}/submit`, {
    summary: `Completed ${epochs} simulated epochs.`,
    verification: `The demo completed all ${epochs} epochs and reported progress and simulated metrics for each.`,
  });
  console.log('Sent to review.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
