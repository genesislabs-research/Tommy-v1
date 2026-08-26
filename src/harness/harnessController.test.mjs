import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarnessController } from './harnessController.js';

const TOOLS = [
  { type: 'function', function: { name: 'fly_to_location' } },
  { type: 'function', function: { name: 'set_layer_visibility' } },
  { type: 'function', function: { name: 'analyst_query' } },
  { type: 'function', function: { name: 'get_current_view_state' } },
];

const SNAPSHOT = { capturedAt: 'now', view: { style: 'ghost' }, analyst: { count: 3 } };

/** A backend that replays a scripted list of steps, recording what it was sent. */
function scriptedBackend(steps) {
  const seen = [];
  return {
    id: 'scripted',
    seen,
    async step(input) {
      seen.push(input);
      const next = steps.shift();
      if (typeof next === 'function') return next(input);
      return next || { text: 'done', toolCalls: [] };
    },
  };
}

function recordingRunner(impl = null) {
  const calls = [];
  const runner = async (name, args, opts) => {
    calls.push({ name, args, opts });
    if (impl) return impl(name, args, opts);
    return { ok: true, action: name };
  };
  return { runner, calls };
}

const stubSnapshot = async () => SNAPSHOT;

test('a tool call is dispatched through the runner and answered back to the model', async () => {
  const { runner, calls } = recordingRunner();
  const backend = scriptedBackend([
    { text: '', toolCalls: [{ id: 'c1', name: 'fly_to_location', arguments: { query: 'Tokyo' } }] },
    { text: 'Flying to Tokyo.', toolCalls: [] },
  ]);
  const controller = createHarnessController({ runner, backend, tools: TOOLS, buildSnapshot: stubSnapshot });

  const result = await controller.submit('fly to Tokyo');

  assert.equal(result.ok, true);
  assert.equal(result.text, 'Flying to Tokyo.');
  assert.equal(result.rounds, 2);
  assert.deepEqual(calls.map((call) => call.name), ['fly_to_location']);
  assert.deepEqual(calls[0].args, { query: 'Tokyo' });
  assert.deepEqual(result.actions.map((action) => [action.name, action.ok]), [['fly_to_location', true]]);

  // Every call is answered: the assistant message carrying tool_calls, then a
  // matching tool message. A missing pair strands the model mid-turn.
  const messages = controller.getMessages();
  const assistantWithCalls = messages.find((message) => Array.isArray(message.tool_calls));
  assert.equal(assistantWithCalls.tool_calls[0].function.name, 'fly_to_location');
  const toolMessage = messages.find((message) => message.role === 'tool');
  assert.equal(toolMessage.tool_call_id, 'c1');
  assert.equal(JSON.parse(toolMessage.content).ok, true);
});

test('the state snapshot reaches the backend on every step', async () => {
  const { runner } = recordingRunner();
  const backend = scriptedBackend([
    { text: '', toolCalls: [{ id: 'c1', name: 'analyst_query', arguments: {} }] },
    { text: 'Three contacts.', toolCalls: [] },
  ]);
  const controller = createHarnessController({ runner, backend, tools: TOOLS, buildSnapshot: stubSnapshot });
  await controller.submit('what is out there');
  assert.equal(backend.seen.length, 2);
  assert.ok(backend.seen.every((input) => input.stateSnapshot === SNAPSHOT));
});

test('several tool calls in one step all run, in order', async () => {
  const { runner, calls } = recordingRunner();
  const backend = scriptedBackend([
    {
      text: '',
      toolCalls: [
        { id: 'c1', name: 'fly_to_location', arguments: { query: 'Tokyo' } },
        { id: 'c2', name: 'set_layer_visibility', arguments: { layerId: 'flights', enabled: true } },
      ],
    },
    { text: 'Tokyo, flights on.', toolCalls: [] },
  ]);
  const controller = createHarnessController({ runner, backend, tools: TOOLS, buildSnapshot: stubSnapshot });
  const result = await controller.submit('fly to Tokyo and show me aircraft');
  assert.deepEqual(calls.map((call) => call.name), ['fly_to_location', 'set_layer_visibility']);
  assert.equal(result.actions.length, 2);
});

test('a repeated call id runs once; a repeated command with a fresh id runs again', async () => {
  const { runner, calls } = recordingRunner();
  const backend = scriptedBackend([
    {
      text: '',
      toolCalls: [
        { id: 'dup', name: 'fly_to_location', arguments: { query: 'Tokyo' } },
        { id: 'dup', name: 'fly_to_location', arguments: { query: 'Tokyo' } },
        { id: 'fresh', name: 'fly_to_location', arguments: { query: 'Tokyo' } },
      ],
    },
    { text: 'ok', toolCalls: [] },
  ]);
  const controller = createHarnessController({ runner, backend, tools: TOOLS, buildSnapshot: stubSnapshot });
  await controller.submit('go');
  assert.equal(calls.length, 2, 'the duplicate id is dropped, the distinct one is not');

  // The dropped call still gets an answer, or the model deadlocks waiting.
  const toolMessages = controller.getMessages().filter((message) => message.role === 'tool');
  assert.equal(toolMessages.length, 3);
  assert.equal(JSON.parse(toolMessages[1].content).duplicate, true);
});

test('a verb outside the schema is refused before it reaches the runner', async () => {
  const { runner, calls } = recordingRunner();
  const backend = scriptedBackend([
    { text: '', toolCalls: [{ id: 'c1', name: 'launch_missiles', arguments: {} }] },
    { text: 'I cannot do that.', toolCalls: [] },
  ]);
  const controller = createHarnessController({ runner, backend, tools: TOOLS, buildSnapshot: stubSnapshot });
  const result = await controller.submit('do something impossible');
  assert.equal(calls.length, 0);
  assert.equal(result.actions[0].ok, false);
  const toolMessage = controller.getMessages().find((message) => message.role === 'tool');
  assert.match(JSON.parse(toolMessage.content).error, /Unknown tool "launch_missiles"/);
});

test('a throwing action becomes readable feedback rather than a dead turn', async () => {
  const { runner } = recordingRunner(() => { throw new Error('Unknown data layer: submarines'); });
  const backend = scriptedBackend([
    { text: '', toolCalls: [{ id: 'c1', name: 'set_layer_visibility', arguments: { layerId: 'submarines' } }] },
    { text: 'That layer does not exist.', toolCalls: [] },
  ]);
  const controller = createHarnessController({ runner, backend, tools: TOOLS, buildSnapshot: stubSnapshot });
  const result = await controller.submit('show submarines');
  assert.equal(result.ok, true);
  assert.equal(result.actions[0].ok, false);
  assert.equal(result.actions[0].error, 'Unknown data layer: submarines');
  const toolMessage = controller.getMessages().find((message) => message.role === 'tool');
  assert.equal(JSON.parse(toolMessage.content).error, 'Unknown data layer: submarines');
});

test('a new turn aborts the one in flight', async () => {
  const { runner } = recordingRunner();
  let controller;
  let second;
  const backend = {
    id: 'slow',
    calls: 0,
    abortedMidStep: null,
    async step({ signal }) {
      this.calls += 1;
      if (this.calls === 1) {
        // The operator types again while the model is still deciding.
        second = controller.submit('actually, London');
        this.abortedMidStep = signal.aborted;
        return { text: 'stale', toolCalls: [] };
      }
      return { text: 'fresh', toolCalls: [] };
    },
  };
  controller = createHarnessController({ runner, backend, tools: TOOLS, buildSnapshot: stubSnapshot });

  const firstResult = await controller.submit('fly to Tokyo');
  const secondResult = await second;

  assert.equal(backend.abortedMidStep, true, 'the superseded turn sees an aborted signal');
  assert.equal(firstResult.aborted, true);
  assert.equal(firstResult.text, '', 'the stale reply is dropped, not shown');
  assert.equal(secondResult.aborted, false);
  assert.equal(secondResult.text, 'fresh');
});

test('a superseded turn dispatches nothing further', async () => {
  const { runner, calls } = recordingRunner();
  let controller;
  const backend = {
    id: 'supersede-mid-turn',
    step: async () => {
      // The operator types again while the model is deciding.
      controller.abort('operator moved on');
      return { text: '', toolCalls: [{ id: 'c1', name: 'fly_to_location', arguments: { query: 'Tokyo' } }] };
    },
  };
  controller = createHarnessController({ runner, backend, tools: TOOLS, buildSnapshot: stubSnapshot });
  const result = await controller.submit('fly to Tokyo');
  assert.equal(result.aborted, true);
  assert.equal(calls.length, 0);
});

test('runOptions.isCurrent goes false once the turn is superseded', async () => {
  let captured = null;
  const { runner } = recordingRunner((name, args, opts) => {
    captured = opts;
    return { ok: true, action: name };
  });
  const backend = scriptedBackend([
    { text: '', toolCalls: [{ id: 'c1', name: 'fly_to_location', arguments: {} }] },
    { text: 'ok', toolCalls: [] },
  ]);
  const controller = createHarnessController({ runner, backend, tools: TOOLS, buildSnapshot: stubSnapshot });
  await controller.submit('go');
  assert.equal(typeof captured.isCurrent, 'function');
  assert.equal(captured.isCurrent(), false, 'the turn has finished, so nothing is current any more');
});

test('a runaway model is capped and still gets to write a reply', async () => {
  const { runner, calls } = recordingRunner();
  let seq = 0;
  const backend = {
    id: 'runaway',
    sawCap: false,
    async step({ messages }) {
      if (messages.some((message) => String(message.content || '').includes('Tool-call budget reached'))) {
        this.sawCap = true;
        return { text: 'Stopping there.', toolCalls: [] };
      }
      seq += 1;
      return { text: '', toolCalls: [{ id: `c${seq}`, name: 'analyst_query', arguments: {} }] };
    },
  };
  const controller = createHarnessController({
    runner, backend, tools: TOOLS, buildSnapshot: stubSnapshot, maxToolCalls: 3, maxRounds: 20,
  });
  const result = await controller.submit('count everything forever');
  assert.equal(calls.length, 3);
  assert.equal(backend.sawCap, true);
  assert.equal(result.text, 'Stopping there.');
});

test('rounds are bounded even when the model never stops calling tools', async () => {
  const { runner } = recordingRunner();
  let seq = 0;
  const backend = {
    id: 'looping',
    async step() {
      seq += 1;
      return { text: '', toolCalls: [{ id: `c${seq}`, name: 'analyst_query', arguments: {} }] };
    },
  };
  const controller = createHarnessController({
    runner, backend, tools: TOOLS, buildSnapshot: stubSnapshot, maxRounds: 3, maxToolCalls: 100,
  });
  const result = await controller.submit('loop');
  assert.equal(result.rounds, 3);
  assert.equal(result.ok, false);
  assert.match(result.error, /Stopped after 3 tool rounds/);
});

test('a backend failure surfaces as a turn error, not a throw', async () => {
  const { runner } = recordingRunner();
  const backend = { id: 'broken', step: async () => { throw new Error('connection refused'); } };
  const controller = createHarnessController({ runner, backend, tools: TOOLS, buildSnapshot: stubSnapshot });
  const result = await controller.submit('hello');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'connection refused');
});

test('history is trimmed without orphaning tool results from their call', async () => {
  const { runner } = recordingRunner();
  let seq = 0;
  const backend = {
    id: 'chatty',
    async step() {
      seq += 1;
      if (seq % 2 === 1) return { text: '', toolCalls: [{ id: `c${seq}`, name: 'analyst_query', arguments: {} }] };
      return { text: `reply ${seq}`, toolCalls: [] };
    },
  };
  const controller = createHarnessController({
    runner, backend, tools: TOOLS, buildSnapshot: stubSnapshot, maxHistory: 6,
  });
  for (let turn = 0; turn < 6; turn += 1) await controller.submit(`turn ${turn}`);

  const messages = controller.getMessages();
  assert.ok(messages.length <= 6);
  assert.notEqual(messages[0].role, 'tool', 'a tool result must never lead the transcript');
  const callIds = new Set(messages.flatMap((m) => (m.tool_calls || []).map((call) => call.id)));
  for (const message of messages) {
    if (message.role === 'tool') assert.ok(callIds.has(message.tool_call_id));
  }
});

test('the controller reports actions and events to listeners', async () => {
  const { runner } = recordingRunner();
  const backend = scriptedBackend([
    { text: '', toolCalls: [{ id: 'c1', name: 'fly_to_location', arguments: { query: 'Tokyo' } }] },
    { text: 'Done.', toolCalls: [] },
  ]);
  const controller = createHarnessController({ runner, backend, tools: TOOLS, buildSnapshot: stubSnapshot });
  const events = [];
  const off = controller.on((event) => events.push(event.type));
  await controller.submit('go');
  off();
  assert.deepEqual(events, [
    'turn.started', 'snapshot', 'action.start', 'action', 'turn.reply', 'turn.finished',
  ]);
});

test('a listener that throws does not take the turn down', async () => {
  const { runner } = recordingRunner();
  const backend = scriptedBackend([{ text: 'hi', toolCalls: [] }]);
  const controller = createHarnessController({ runner, backend, tools: TOOLS, buildSnapshot: stubSnapshot });
  controller.on(() => { throw new Error('bad listener'); });
  const result = await controller.submit('hello');
  assert.equal(result.ok, true);
  assert.equal(result.text, 'hi');
});

test('empty input is rejected without touching the model', async () => {
  const { runner } = recordingRunner();
  const backend = scriptedBackend([]);
  const controller = createHarnessController({ runner, backend, tools: TOOLS, buildSnapshot: stubSnapshot });
  const result = await controller.submit('   ');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Nothing to send');
  assert.equal(backend.seen.length, 0);
});

test('with no schema loaded, verb policing is off and the runner decides', async () => {
  const { runner, calls } = recordingRunner();
  const backend = scriptedBackend([
    { text: '', toolCalls: [{ id: 'c1', name: 'anything_at_all', arguments: {} }] },
    { text: 'ok', toolCalls: [] },
  ]);
  const controller = createHarnessController({ runner, backend, tools: [], buildSnapshot: stubSnapshot });
  await controller.submit('go');
  assert.deepEqual(calls.map((call) => call.name), ['anything_at_all']);
});

test('setTools accepts the flat Realtime schema shape as well', () => {
  const { runner } = recordingRunner();
  const controller = createHarnessController({
    runner, backend: scriptedBackend([]), tools: [], buildSnapshot: stubSnapshot,
  });
  controller.setTools([{ type: 'function', name: 'zoom_to_globe' }]);
  assert.deepEqual(controller.toolNames, ['zoom_to_globe']);
});

test('construction rejects a missing runner or a malformed backend', () => {
  assert.throws(() => createHarnessController({ backend: scriptedBackend([]) }), /needs a runner/);
  assert.throws(() => createHarnessController({ runner: async () => ({}), backend: {} }), /must expose an async step/);
});
