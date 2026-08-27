/**
 * Tommy harness — the text-in / actions-out controller.
 *
 * This is GevRealtimeController's sibling with the audio removed. It occupies
 * the same position in the stack and hits the identical seam:
 *
 *     backend.step(...)        ← any model, any provider
 *            │
 *            ▼
 *     runner(name, args)       ← createGevActionRunner, model-agnostic
 *            │
 *            ▼
 *     the map (Cesium, layers, HUD)
 *
 * The dispatch discipline is copied from the voice path because it was learned
 * the hard way, not because the transport demands it:
 *
 *  - ONE TURN AT A TIME. A new `submit` aborts the turn in flight. A stale
 *    model deciding to fly somewhere after the operator has moved on is worse
 *    than a dropped reply.
 *  - NEVER RUN A CALL TWICE. Calls are deduped on id for the life of a turn.
 *  - EVERY CALL GETS A RESULT. Success, failure, refusal, abort — each tool
 *    call is answered with a `tool` message. Leaving one unanswered strands a
 *    chat-completions model mid-turn exactly as it strands a Realtime one.
 *  - NEVER INVENT A VERB. A tool name outside the schema is refused with a
 *    readable error the model can correct from, rather than reaching `runner`.
 *
 * It does NOT touch the OpenAI voice controller, and it does not reimplement a
 * single action — `runner` is shared or rebuilt, and it is stateless with
 * respect to whichever model is driving.
 */

import { assertHarnessBackend } from './backends/backend.js';
import { buildStateSnapshot } from './snapshot.js';

/** Tool-calling rounds per turn before we stop and answer with what we have. */
const DEFAULT_MAX_ROUNDS = 6;
/** Tool calls dispatched per turn. A local model in a loop must not run away. */
const DEFAULT_MAX_TOOL_CALLS = 24;
/** Transcript messages retained. Older turns fall off; the snapshot is live anyway. */
const DEFAULT_MAX_HISTORY = 40;

export function createHarnessController({
  runner,
  backend,
  tools = [],
  dataManager = null,
  maxRounds = DEFAULT_MAX_ROUNDS,
  maxToolCalls = DEFAULT_MAX_TOOL_CALLS,
  maxHistory = DEFAULT_MAX_HISTORY,
  buildSnapshot = buildStateSnapshot,
} = {}) {
  if (typeof runner !== 'function') throw new Error('createHarnessController needs a runner function');
  assertHarnessBackend(backend, backend?.id || 'harness backend');

  const listeners = new Set();
  const messages = [];
  let knownTools = normalizeToolNames(tools);
  let activeTurn = null;
  let turnSeq = 0;

  function emit(event) {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // A broken UI listener must not take the turn down with it.
      }
    }
  }

  /** Replace the known-verb list (e.g. after fetching the schema from the server). */
  function setTools(next) {
    knownTools = normalizeToolNames(next);
    return knownTools.size;
  }

  function abort(reason = 'superseded') {
    if (!activeTurn) return false;
    const turn = activeTurn;
    activeTurn = null;
    turn.aborted = true;
    turn.controller.abort(reason);
    emit({ type: 'turn.aborted', turnId: turn.id, reason });
    return true;
  }

  /**
   * Run one operator turn: snapshot → model → actions → model → reply.
   *
   * @param {string} userText
   * @returns {Promise<{ok: boolean, text: string, actions: object[], rounds: number, aborted: boolean, error: string|null}>}
   */
  async function submit(userText) {
    const text = String(userText ?? '').trim();
    if (!text) return { ok: false, text: '', actions: [], rounds: 0, aborted: false, error: 'Nothing to send' };

    // A new turn supersedes the old one, mirroring the voice path's
    // abort-on-new-user-turn rule.
    abort('new user turn');

    const turn = {
      id: (turnSeq += 1),
      controller: new AbortController(),
      aborted: false,
      processedCalls: new Set(),
      actions: [],
      toolCallCount: 0,
    };
    activeTurn = turn;
    const isCurrent = () => activeTurn === turn && !turn.aborted && !turn.controller.signal.aborted;

    messages.push({ role: 'user', content: text });
    trimHistory(messages, maxHistory);
    emit({ type: 'turn.started', turnId: turn.id, text });

    let rounds = 0;
    let replyText = '';
    let error = null;

    try {
      const snapshot = await buildSnapshot(runner, { signal: turn.controller.signal });
      if (!isCurrent()) return abortedResult(turn);
      emit({ type: 'snapshot', turnId: turn.id, snapshot });

      while (rounds < maxRounds) {
        rounds += 1;
        const step = await backend.step({
          messages: [...messages],
          tools: [...knownTools].map((name) => ({ name })),
          stateSnapshot: snapshot,
          signal: turn.controller.signal,
        });
        if (!isCurrent()) return abortedResult(turn);

        const stepText = String(step?.text || '').trim();
        const toolCalls = Array.isArray(step?.toolCalls) ? step.toolCalls : [];
        if (stepText) replyText = stepText;

        if (!toolCalls.length) {
          if (stepText) messages.push({ role: 'assistant', content: stepText });
          emit({ type: 'turn.reply', turnId: turn.id, text: stepText, rounds });
          break;
        }

        // The assistant message carrying the calls must precede their results,
        // or a chat-completions server rejects the orphaned `tool` messages.
        messages.push({
          role: 'assistant',
          content: stepText || null,
          tool_calls: toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) },
          })),
        });

        for (const call of toolCalls) {
          const outcome = await dispatch(turn, call, isCurrent);
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify(outcome.result),
          });
          if (!isCurrent()) return abortedResult(turn);
        }
        trimHistory(messages, maxHistory);

        if (turn.toolCallCount >= maxToolCalls) {
          // Stop dispatching, but let the model see the cap and write the
          // reply — an unexplained silence reads to the operator as a hang.
          messages.push({
            role: 'system',
            content: `Tool-call budget reached (${maxToolCalls} this turn). Answer now with what the results show; do not call more tools.`,
          });
          const closing = await backend.step({
            messages: [...messages],
            tools: [],
            stateSnapshot: snapshot,
            signal: turn.controller.signal,
          });
          if (!isCurrent()) return abortedResult(turn);
          const closingText = String(closing?.text || '').trim();
          if (closingText) {
            replyText = closingText;
            messages.push({ role: 'assistant', content: closingText });
          }
          emit({ type: 'turn.reply', turnId: turn.id, text: replyText, rounds, capped: true });
          break;
        }
      }

      if (rounds >= maxRounds && !replyText) {
        error = `Stopped after ${maxRounds} tool rounds without a reply`;
      }
    } catch (caught) {
      if (turn.aborted || turn.controller.signal.aborted) return abortedResult(turn);
      error = caught?.message || 'Harness turn failed';
      emit({ type: 'turn.error', turnId: turn.id, error });
    } finally {
      if (activeTurn === turn) activeTurn = null;
      trimHistory(messages, maxHistory);
    }

    const result = {
      ok: !error,
      text: replyText,
      actions: turn.actions,
      rounds,
      aborted: false,
      error,
    };
    emit({ type: 'turn.finished', turnId: turn.id, ...result });
    return result;
  }

  /**
   * Dispatch one tool call through the shared `runner`.
   *
   * Always resolves — the returned object is what goes back to the model, so a
   * thrown action becomes readable feedback rather than a dead turn.
   */
  async function dispatch(turn, call, isCurrent) {
    if (turn.processedCalls.has(call.id)) {
      return { result: { ok: false, tool: call.name, error: 'Duplicate tool call ignored', duplicate: true } };
    }
    turn.processedCalls.add(call.id);

    if (knownTools.size && !knownTools.has(call.name)) {
      const result = {
        ok: false,
        tool: call.name,
        error: `Unknown tool "${call.name}". Call only the provided tools.`,
      };
      turn.actions.push({ name: call.name, args: call.arguments, ok: false, error: result.error });
      emit({ type: 'action', turnId: turn.id, name: call.name, args: call.arguments, ok: false, error: result.error });
      return { result };
    }

    turn.toolCallCount += 1;
    emit({ type: 'action.start', turnId: turn.id, name: call.name, args: call.arguments });

    let result;
    try {
      result = await runner(call.name, call.arguments, {
        signal: turn.controller.signal,
        isCurrent,
      });
    } catch (caught) {
      result = { ok: false, tool: call.name, error: caught?.message || 'GEV command failed' };
    }
    const record = {
      name: call.name,
      args: call.arguments,
      ok: result?.ok !== false,
      error: result?.ok === false ? result.error || 'failed' : null,
      result,
    };
    turn.actions.push(record);
    emit({ type: 'action', turnId: turn.id, ...record });
    return { result: result ?? { ok: true, tool: call.name } };
  }

  function abortedResult(turn) {
    const result = { ok: false, text: '', actions: turn.actions, rounds: 0, aborted: true, error: null };
    emit({ type: 'turn.finished', turnId: turn.id, ...result });
    return result;
  }

  return {
    submit,
    abort,
    setTools,
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Live transcript, for debugging and for the console's replay. */
    getMessages: () => messages.map((message) => ({ ...message })),
    reset() {
      abort('reset');
      messages.length = 0;
      emit({ type: 'reset' });
    },
    isBusy: () => Boolean(activeTurn),
    get backendId() {
      return backend?.id || null;
    },
    get toolNames() {
      return [...knownTools];
    },
    dataManager,
  };
}

/** Accept either the chat-completions tool shape or the flat Realtime one. */
function normalizeToolNames(tools) {
  const names = new Set();
  for (const tool of Array.isArray(tools) ? tools : []) {
    const name = tool?.function?.name || tool?.name;
    if (typeof name === 'string' && name) names.add(name);
  }
  return names;
}

/**
 * Trim the transcript from the front, never splitting an assistant message
 * from the `tool` results that answer it — a chat-completions server rejects a
 * `tool` message whose originating `tool_calls` has been trimmed away.
 */
function trimHistory(messages, maxHistory) {
  if (messages.length <= maxHistory) return messages;
  let cut = messages.length - maxHistory;
  while (cut < messages.length && messages[cut]?.role === 'tool') cut += 1;
  messages.splice(0, cut);
  return messages;
}
