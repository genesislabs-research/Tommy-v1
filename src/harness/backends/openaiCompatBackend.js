/**
 * OpenAI-compatible chat-completions backend.
 *
 * Covers essentially every self-host stack — LM Studio (Bionic and classic),
 * vLLM, Ollama's tool-calling API, llama.cpp's server, LM proxies — because
 * they all expose `/v1/chat/completions` with a `tools` array and `tool_calls`
 * in the reply.
 *
 * It does NOT talk to that endpoint directly. It posts to this app's own
 * /api/harness/chat proxy, which holds the base URL, the key, the model id,
 * and the authoritative GEV tool schema (see vite.config.js). Nothing about
 * the private model reaches the browser bundle — the same rule the OpenAI
 * voice path follows with /api/realtime/token.
 */

import { normalizeHarnessStep, registerHarnessBackend } from './backend.js';

export const OPENAI_COMPAT_BACKEND_ID = 'openai-compat';
const DEFAULT_CHAT_ENDPOINT = '/api/harness/chat';
const DEFAULT_TOOLS_ENDPOINT = '/api/harness/tools';
const DEFAULT_CONFIG_ENDPOINT = '/api/harness/config';

/**
 * The world-state snapshot the controller built for this step, as a system
 * message the model reads before deciding anything.
 *
 * It is injected fresh on every step and never appended to the stored history:
 * a snapshot is true for one moment, and a transcript full of stale ones is
 * how a model ends up describing a camera position two flights ago.
 */
export function snapshotSystemMessage(stateSnapshot) {
  if (!stateSnapshot) return null;
  return {
    role: 'system',
    content: [
      'WORLD STATE (live, captured for this turn — trust it over anything earlier in this conversation):',
      JSON.stringify(stateSnapshot),
    ].join('\n'),
  };
}

/** Chat-completions `messages` for one step: history with the snapshot spliced in. */
export function buildChatMessages(messages, stateSnapshot) {
  const snapshot = snapshotSystemMessage(stateSnapshot);
  if (!snapshot) return [...messages];
  // Before the trailing user turn when there is one, so the model reads the
  // state and then the request — not a wall of JSON after the question.
  const lastUserIndex = findLastIndex(messages, (message) => message?.role === 'user');
  if (lastUserIndex < 0) return [...messages, snapshot];
  return [...messages.slice(0, lastUserIndex), snapshot, ...messages.slice(lastUserIndex)];
}

/** Assistant text out of a chat-completions choice, tolerant of content parts. */
export function readChoiceText(choice) {
  const content = choice?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('')
      .trim();
  }
  return '';
}

/**
 * Tool calls out of a chat-completions choice.
 *
 * Handles both the current `tool_calls` array and the deprecated single
 * `function_call`, because some local servers still emit the older shape.
 */
export function readChoiceToolCalls(choice) {
  const calls = Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls : [];
  const out = calls
    .filter((call) => call?.function?.name || call?.name)
    .map((call, index) => ({
      id: call.id || `${call?.function?.name || call?.name}-${index}`,
      name: call?.function?.name || call?.name,
      arguments: call?.function?.arguments ?? call?.arguments,
    }));
  const legacy = choice?.message?.function_call;
  if (!out.length && legacy?.name) {
    out.push({ id: legacy.name, name: legacy.name, arguments: legacy.arguments });
  }
  return out;
}

/**
 * Build the backend.
 *
 * @param {object} [options]
 * @param {string} [options.endpoint]  Proxy chat route.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.temperature] Sampling temperature sent upstream.
 * @param {string} [options.model]     Override the server's default model id.
 */
export function createOpenAiCompatBackend({
  endpoint = DEFAULT_CHAT_ENDPOINT,
  toolsEndpoint = DEFAULT_TOOLS_ENDPOINT,
  configEndpoint = DEFAULT_CONFIG_ENDPOINT,
  fetchImpl = null,
  temperature = 0.2,
  model = null,
} = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));

  return {
    id: OPENAI_COMPAT_BACKEND_ID,

    /** What the server is pointed at, for the console's status line. */
    async describe() {
      try {
        const response = await doFetch(configEndpoint, { method: 'GET' });
        if (!response.ok) return { enabled: false, error: `Harness config unavailable (${response.status})` };
        return await response.json();
      } catch (error) {
        return { enabled: false, error: error?.message || 'Harness config unavailable' };
      }
    },

    /**
     * The tool schema, fetched from the server so it stays single-sourced with
     * GEV_REALTIME_TOOLS. The controller uses it to reject verbs that do not
     * exist; the server sends its own copy upstream regardless.
     */
    async loadTools() {
      const response = await doFetch(toolsEndpoint, { method: 'GET' });
      if (!response.ok) throw new Error(`Harness tool schema unavailable (${response.status})`);
      const data = await response.json();
      return Array.isArray(data?.tools) ? data.tools : [];
    },

    async step({ messages, stateSnapshot = null, signal = null } = {}) {
      const body = {
        messages: buildChatMessages(Array.isArray(messages) ? messages : [], stateSnapshot),
        temperature,
      };
      if (model) body.model = model;

      const response = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error?.message || data?.error || `Harness LLM request failed (${response.status})`);
      }
      const choice = data?.choices?.[0];
      return normalizeHarnessStep({
        text: readChoiceText(choice),
        toolCalls: readChoiceToolCalls(choice),
        raw: data,
      });
    },
  };
}

registerHarnessBackend(OPENAI_COMPAT_BACKEND_ID, createOpenAiCompatBackend);

/** Array.prototype.findLastIndex, spelled out for older browser targets. */
function findLastIndex(list, predicate) {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (predicate(list[index], index)) return index;
  }
  return -1;
}
