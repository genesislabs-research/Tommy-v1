import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildChatMessages,
  createOpenAiCompatBackend,
  readChoiceText,
  readChoiceToolCalls,
  snapshotSystemMessage,
} from './openaiCompatBackend.js';
import {
  assertHarnessBackend,
  clearHarnessBackends,
  createHarnessBackend,
  listHarnessBackends,
  normalizeHarnessStep,
  parseToolArguments,
  registerHarnessBackend,
} from './backend.js';

const SNAPSHOT = { view: { style: 'ghost' }, analyst: { coverage: { warmup: 'still loading' } } };

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

test('the snapshot is spliced in before the trailing user turn', () => {
  const messages = [
    { role: 'assistant', content: 'earlier' },
    { role: 'user', content: 'what is out there' },
  ];
  const built = buildChatMessages(messages, SNAPSHOT);
  assert.deepEqual(built.map((message) => message.role), ['assistant', 'system', 'user']);
  assert.match(built[1].content, /WORLD STATE/);
  // The warm-up note must survive into what the model actually reads.
  assert.match(built[1].content, /still loading/);
});

test('with no user turn the snapshot is appended rather than dropped', () => {
  const built = buildChatMessages([{ role: 'assistant', content: 'hi' }], SNAPSHOT);
  assert.deepEqual(built.map((message) => message.role), ['assistant', 'system']);
});

test('no snapshot means no injected system message', () => {
  assert.equal(snapshotSystemMessage(null), null);
  const built = buildChatMessages([{ role: 'user', content: 'hi' }], null);
  assert.deepEqual(built.map((message) => message.role), ['user']);
});

test('the snapshot is never stored in the transcript it is spliced into', () => {
  const messages = [{ role: 'user', content: 'hi' }];
  buildChatMessages(messages, SNAPSHOT);
  assert.equal(messages.length, 1, 'a stale snapshot must not accumulate in history');
});

test('tool calls are read out of a chat-completions choice', () => {
  const choice = {
    message: {
      content: 'On it.',
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'fly_to_location', arguments: '{"query":"Tokyo"}' } },
      ],
    },
  };
  assert.equal(readChoiceText(choice), 'On it.');
  const calls = readChoiceToolCalls(choice);
  assert.deepEqual(calls, [{ id: 'call_1', name: 'fly_to_location', arguments: '{"query":"Tokyo"}' }]);
});

test('the deprecated single function_call shape is still understood', () => {
  const calls = readChoiceToolCalls({
    message: { function_call: { name: 'zoom_to_globe', arguments: '{}' } },
  });
  assert.deepEqual(calls.map((call) => call.name), ['zoom_to_globe']);
});

test('array content parts are joined into text', () => {
  assert.equal(readChoiceText({ message: { content: [{ text: 'Flying ' }, { text: 'to Tokyo.' }] } }), 'Flying to Tokyo.');
});

test('a step posts the conversation and returns a normalized step', async () => {
  const seen = [];
  const backend = createOpenAiCompatBackend({
    fetchImpl: async (url, options) => {
      seen.push({ url, body: JSON.parse(options.body) });
      return jsonResponse({
        choices: [{
          message: {
            content: 'Flying to Tokyo.',
            tool_calls: [{ id: 'call_1', function: { name: 'fly_to_location', arguments: '{"query":"Tokyo"}' } }],
          },
        }],
      });
    },
  });

  const step = await backend.step({
    messages: [{ role: 'user', content: 'fly to Tokyo' }],
    stateSnapshot: SNAPSHOT,
  });

  assert.equal(seen[0].url, '/api/harness/chat');
  assert.deepEqual(seen[0].body.messages.map((message) => message.role), ['system', 'user']);
  assert.equal(step.text, 'Flying to Tokyo.');
  assert.deepEqual(step.toolCalls, [{ id: 'call_1', name: 'fly_to_location', arguments: { query: 'Tokyo' } }]);
});

test('no endpoint or key is ever named client-side', async () => {
  const seen = [];
  const backend = createOpenAiCompatBackend({
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    },
  });
  await backend.step({ messages: [{ role: 'user', content: 'hi' }], stateSnapshot: null });
  assert.equal(seen[0].url, '/api/harness/chat', 'the browser only ever addresses the app proxy');
  const wire = JSON.stringify(seen[0]);
  assert.doesNotMatch(wire, /localhost:1234|Authorization|api[_-]?key/i);
});

test('an upstream failure becomes a readable error', async () => {
  const backend = createOpenAiCompatBackend({
    fetchImpl: async () => jsonResponse({ error: 'HARNESS_LLM_BASE_URL is not set' }, 503),
  });
  await assert.rejects(
    () => backend.step({ messages: [{ role: 'user', content: 'hi' }] }),
    /HARNESS_LLM_BASE_URL is not set/,
  );
});

test('the tool schema is fetched from the server, not duplicated in the bundle', async () => {
  const backend = createOpenAiCompatBackend({
    fetchImpl: async (url) => {
      assert.equal(url, '/api/harness/tools');
      return jsonResponse({ tools: [{ type: 'function', function: { name: 'fly_to_location' } }] });
    },
  });
  const tools = await backend.loadTools();
  assert.deepEqual(tools.map((tool) => tool.function.name), ['fly_to_location']);
});

test('describe reports a disabled harness instead of throwing', async () => {
  const backend = createOpenAiCompatBackend({
    fetchImpl: async () => { throw new Error('connection refused'); },
  });
  assert.deepEqual(await backend.describe(), { enabled: false, error: 'connection refused' });
});

test('tool arguments survive every shape a local model emits', () => {
  assert.deepEqual(parseToolArguments('{"query":"Tokyo"}'), { query: 'Tokyo' });
  assert.deepEqual(parseToolArguments({ query: 'Tokyo' }), { query: 'Tokyo' });
  assert.deepEqual(parseToolArguments('{"query":'), {}, 'truncated JSON degrades to empty args');
  assert.deepEqual(parseToolArguments('[1,2]'), {}, 'a non-object payload is not usable as args');
  assert.deepEqual(parseToolArguments(''), {});
  assert.deepEqual(parseToolArguments(null), {});
});

test('a nameless tool call is dropped and a missing id is filled in', () => {
  const step = normalizeHarnessStep({
    text: 42,
    toolCalls: [{ name: '' }, { name: 'zoom_to_globe' }],
  });
  assert.equal(step.text, '', 'non-string text is not passed off as a reply');
  assert.deepEqual(step.toolCalls, [{ id: 'call-1', name: 'zoom_to_globe', arguments: {} }]);
});

test('the registry builds registered backends and rejects unknown ids', () => {
  const registered = listHarnessBackends();
  assert.ok(registered.includes('openai-compat'), 'importing the adapter registers it');
  const built = createHarnessBackend('openai-compat', { fetchImpl: async () => jsonResponse({}) });
  assert.equal(built.id, 'openai-compat');
  assert.throws(() => createHarnessBackend('nope'), /Unknown harness backend "nope"/);
});

test('a backend without a step function is rejected at construction', () => {
  assert.throws(() => assertHarnessBackend({}, 'x'), /must expose an async step/);
  assert.throws(() => registerHarnessBackend('', () => ({})), /id is required/);
  assert.throws(() => registerHarnessBackend('x', null), /needs a factory function/);
});

test('clearHarnessBackends empties the registry', () => {
  const before = listHarnessBackends();
  clearHarnessBackends();
  assert.deepEqual(listHarnessBackends(), []);
  before.forEach((id) => registerHarnessBackend(id, createOpenAiCompatBackend));
});
