/**
 * HarnessBackend — the one thing the Tommy harness swaps out.
 *
 * The map seam is `runner` (createGevActionRunner, src/voice/gevActions.js):
 * it takes an action name + JSON args and drives Cesium. It knows nothing
 * about any model. A backend is the OTHER end of that seam — the thing that
 * decides WHICH action to call. Everything between the two (turn loop, state
 * snapshot, dispatch discipline) is provider-agnostic and lives in
 * harnessController.js.
 *
 * So: to point the harness at a different model, write a backend here. Nothing
 * in src/voice/, and nothing about the map, needs to change.
 *
 * @typedef {object} HarnessToolCall
 * @property {string} id        Stable per-call id; the controller dedupes on it.
 * @property {string} name      An action verb from the GEV tool schema.
 * @property {object} arguments Parsed JSON arguments for the verb.
 *
 * @typedef {object} HarnessStep
 * @property {string} [text]                 Assistant prose for the operator.
 * @property {HarnessToolCall[]} [toolCalls] Actions to dispatch through `runner`.
 * @property {object} [raw]                  Provider payload, kept for debugging.
 *
 * @typedef {object} HarnessStepInput
 * @property {object[]} messages     Conversation so far, in OpenAI-chat shape.
 * @property {object[]} tools        Tool schema the model may call.
 * @property {object|null} stateSnapshot  Live world state for THIS step.
 * @property {AbortSignal} [signal]  Aborted when the operator starts a new turn.
 *
 * @typedef {object} HarnessBackend
 * @property {string} id
 * @property {(input: HarnessStepInput) => Promise<HarnessStep>} step
 */

/** Backends registered by id, so the UI can offer a choice without importing each. */
const REGISTRY = new Map();

/**
 * Register a backend factory under an id.
 *
 * @param {string} id
 * @param {(options?: object) => HarnessBackend} factory
 */
export function registerHarnessBackend(id, factory) {
  const key = String(id || '').trim();
  if (!key) throw new Error('Harness backend id is required');
  if (typeof factory !== 'function') throw new Error(`Harness backend "${key}" needs a factory function`);
  REGISTRY.set(key, factory);
  return key;
}

/** Ids of every registered backend, in registration order. */
export function listHarnessBackends() {
  return [...REGISTRY.keys()];
}

/**
 * Build a registered backend.
 *
 * @param {string} id
 * @param {object} [options] Passed straight to the factory.
 * @returns {HarnessBackend}
 */
export function createHarnessBackend(id, options = {}) {
  const key = String(id || '').trim();
  const factory = REGISTRY.get(key);
  if (!factory) {
    throw new Error(`Unknown harness backend "${key}". Registered: ${listHarnessBackends().join(', ') || 'none'}`);
  }
  return assertHarnessBackend(factory(options), key);
}

/** Reject a malformed backend at construction rather than mid-turn. */
export function assertHarnessBackend(backend, id = 'backend') {
  if (!backend || typeof backend.step !== 'function') {
    throw new Error(`Harness backend "${id}" must expose an async step({ messages, tools, stateSnapshot })`);
  }
  return backend;
}

/** Reset the registry. Test-only; production registration happens at import. */
export function clearHarnessBackends() {
  REGISTRY.clear();
}

/**
 * Coerce whatever a backend returned into the HarnessStep contract.
 *
 * Local models are messy in ways hosted ones are not: arguments arrive as JSON
 * strings, as already-parsed objects, or as truncated JSON that will not parse
 * at all. Normalizing HERE means the controller — and every future backend —
 * only ever handles one shape, and a malformed argument blob degrades to `{}`
 * (the runner then throws its own "needs a locationId" style error, which the
 * model can read and correct) instead of throwing inside the dispatch loop.
 */
export function normalizeHarnessStep(step, { idPrefix = 'call' } = {}) {
  const text = typeof step?.text === 'string' ? step.text : '';
  const rawCalls = Array.isArray(step?.toolCalls) ? step.toolCalls : [];
  const toolCalls = [];
  rawCalls.forEach((call, index) => {
    const name = String(call?.name || '').trim();
    if (!name) return;
    toolCalls.push({
      id: String(call?.id || `${idPrefix}-${index}`),
      name,
      arguments: parseToolArguments(call?.arguments),
    });
  });
  return { text, toolCalls, raw: step?.raw ?? null };
}

/** Tool arguments as an object, whatever shape the provider handed back. */
export function parseToolArguments(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
