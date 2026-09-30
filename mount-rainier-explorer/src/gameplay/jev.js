/**
 * Jev (TypeSafe's "System One" decision model) through OpenRouter's Decisions
 * endpoint. Jev doesn't write text: it reads a block of state plus typed
 * questions (choice / score / noul) and returns typed answers with calibrated
 * probabilities in one fast parallel pass. The endpoint is alpha, so
 * everything that knows its shape lives in this file.
 *
 * The player's own OpenRouter key is kept in this browser's localStorage and
 * sent only to openrouter.ai. With no key, callers fall back to the game's
 * built-in behaviour.
 */
const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const MODEL = 'typesafe/jev-1.13';
const KEY_STORE = 'rainier-explorer:jev-key';

export class Jev {
  constructor({ fetchImpl } = {}) {
    this.fetch = fetchImpl || ((...a) => fetch(...a));
    try { this.key = localStorage.getItem(KEY_STORE) || ''; } catch (e) { this.key = ''; }
    this.stats = { calls: 0, failures: 0, cost: 0, lastMs: 0 };
  }

  get enabled() { return !!this.key; }

  setKey(key) {
    this.key = (key || '').trim();
    try {
      if (this.key) localStorage.setItem(KEY_STORE, this.key);
      else localStorage.removeItem(KEY_STORE);
    } catch (e) { /* storage blocked: key lives for this page only */ }
  }

  /**
   * Ask typed questions about one state.
   * questions: { name: { type: 'choice'|'noul'|'score', instructions, criteria } }
   *   choice: criteria = { label: description, ... } (2-255 labels)
   *   noul:   criteria = { true: description, false: description }
   *   score:  criteria = [lowest, ..., highest]
   * Returns the `answers` map, e.g. { team: { choice, confidence, probabilities } }.
   */
  async decide(state, questions, { timeout = 6000 } = {}) {
    if (!this.key) throw new Error('No Jev key set');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    const t0 = performance.now();
    this.stats.calls++;
    try {
      const res = await this.fetch(ENDPOINT, {
        method: 'POST',
        signal: ctl.signal,
        headers: {
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
          'X-Title': 'Rainier Explorer',
        },
        body: JSON.stringify({ model: MODEL, state, questions }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.answers) {
        const msg = body?.error?.message || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      this.stats.lastMs = Math.round(performance.now() - t0);
      this.stats.cost += body.usage?.cost || 0;
      return body.answers;
    } catch (e) {
      this.stats.failures++;
      throw e.name === 'AbortError' ? new Error('Jev timed out') : e;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Top choice with its probability, or null if the model is unsure. */
export function pick(answer, minProb = 0) {
  if (!answer || answer.type !== 'choice') return null;
  const p = answer.probabilities?.[answer.choice] ?? answer.confidence ?? 0;
  return p >= minProb ? { value: answer.choice, p, confidence: answer.confidence ?? p } : null;
}
