/**
 * Acceptance: a typed command reaches the map through the real pieces.
 *
 * Everything here is the shipping code except the two ends — Cesium (a
 * recording runner stands in for the map) and the private model (a scripted
 * OpenAI-compatible server stands in for LM Studio). In between, the real
 * console-side backend talks to the real server-side proxy middleware, which
 * reshapes the real GEV_REALTIME_TOOLS schema.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { createHarnessChatMiddleware, harnessChatCompletionTools } from '../../vite.config.js';
import { createOpenAiCompatBackend } from './backends/openaiCompatBackend.js';
import { createHarnessController } from './harnessController.js';
import { buildStateSnapshot } from './snapshot.js';

const ENV = { HARNESS_LLM_BASE_URL: 'http://localhost:1234/v1', HARNESS_LLM_MODEL: 'local-model' };

/** The map, minus Cesium: the two read verbs answer, everything else records. */
function fakeMap() {
  const calls = [];
  const runner = async (name, args = {}) => {
    calls.push({ name, args });
    if (name === 'get_current_view_state') {
      return {
        ok: true,
        camera: { latitude: 30.27, longitude: -97.74, heightM: 2000 },
        style: 'ghost',
        layers: [{ id: 'flights', name: 'Flights', enabled: false, count: 0, error: null }],
      };
    }
    if (name === 'analyst_query') {
      return {
        ok: true,
        count: 2,
        scopeLabel: 'in view',
        summary: '2 aircraft in view',
        items: [{ layerKey: 'flights', id: 'ANA123' }],
        coverage: {
          note: 'view scope — counts cover loaded data; the flights layer loads by viewport',
          warmup: 'flights enabled moments ago — data is still loading; counts will rise for ~30-45s. Say so.',
        },
      };
    }
    if (name === 'fly_to_location') return { ok: true, action: 'fly_to_location', destination: 'Tokyo', arrived: true };
    if (name === 'set_layer_visibility') return { ok: true, action: 'set_layer_visibility', layerId: args.layerId, enabled: args.enabled };
    return { ok: true, action: name };
  };
  return { runner, calls };
}

/**
 * The app's own routes, called the way the browser calls them: fetch(path) in,
 * the real middleware run, a Response out.
 */
function appFetch(upstream) {
  const upstreamCalls = [];
  const chat = createHarnessChatMiddleware({
    env: ENV,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      upstreamCalls.push({ url, body });
      return new Response(JSON.stringify(upstream(body, upstreamCalls.length)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const fetchImpl = async (path, options = {}) => {
    if (path === '/api/harness/tools') {
      return new Response(JSON.stringify({ tools: harnessChatCompletionTools() }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    assert.equal(path, '/api/harness/chat', 'the browser addresses no other host');
    const req = Readable.from([Buffer.from(options.body)]);
    req.method = 'POST';
    req.url = path;
    req.socket = { remoteAddress: '127.0.0.1' };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(payload) { this.payload = payload; },
    };
    await chat(req, res);
    return new Response(res.payload, { status: res.statusCode, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetchImpl, upstreamCalls };
}

function toolCallReply(calls) {
  return {
    choices: [{
      message: {
        content: '',
        tool_calls: calls.map((call, index) => ({
          id: `call_${index}`,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        })),
      },
    }],
  };
}

test('a typed command drives the map through the same runner the voice path uses', async () => {
  const map = fakeMap();
  const { fetchImpl, upstreamCalls } = appFetch((body, turn) => {
    if (turn === 1) {
      return toolCallReply([
        { name: 'fly_to_location', args: { query: 'Tokyo' } },
        { name: 'set_layer_visibility', args: { layerId: 'flights', enabled: true } },
      ]);
    }
    return { choices: [{ message: { content: 'Tokyo is in view with flights on.' } }] };
  });

  const backend = createOpenAiCompatBackend({ fetchImpl });
  const tools = await backend.loadTools();
  assert.equal(tools.length, 28, 'the harness offers the same 28 verbs as the voice schema');

  const controller = createHarnessController({ runner: map.runner, backend, tools });
  const result = await controller.submit('fly to Tokyo and show me aircraft');

  assert.equal(result.ok, true);
  assert.equal(result.text, 'Tokyo is in view with flights on.');
  assert.deepEqual(
    map.calls.map((call) => call.name),
    ['get_current_view_state', 'analyst_query', 'fly_to_location', 'set_layer_visibility'],
    'the snapshot reads first, then the model drives the map',
  );
  assert.deepEqual(map.calls[2].args, { query: 'Tokyo' });
  assert.deepEqual(map.calls[3].args, { layerId: 'flights', enabled: true });
  assert.deepEqual(result.actions.map((action) => [action.name, action.ok]), [
    ['fly_to_location', true],
    ['set_layer_visibility', true],
  ]);

  // The model that decided this was handed the real schema, server-side.
  const sentTools = upstreamCalls[0].body.tools.map((tool) => tool.function.name);
  assert.equal(sentTools.length, 28);
  assert.ok(sentTools.includes('annotate_map'));
});

test('warm-up and provenance notes survive the whole path to the model', async () => {
  const map = fakeMap();
  const { fetchImpl, upstreamCalls } = appFetch(() => ({ choices: [{ message: { content: 'Still loading.' } }] }));
  const backend = createOpenAiCompatBackend({ fetchImpl });
  const controller = createHarnessController({
    runner: map.runner, backend, tools: await backend.loadTools(),
  });

  await controller.submit('how many aircraft are out there');

  const sentMessages = upstreamCalls[0].body.messages;
  const worldState = sentMessages.find((message) => String(message.content || '').startsWith('WORLD STATE'));
  assert.ok(worldState, 'the model receives a world-state message');
  assert.match(worldState.content, /still loading; counts will rise/);
  assert.match(worldState.content, /the flights layer loads by viewport/);
  assert.match(worldState.content, /"scopeLabel":"in view"/);

  // And the system prompt tells it what to do with those fields.
  assert.match(sentMessages[0].content, /coverage\.warmup/);
});

test('the snapshot uses the map read verbs directly, with no second data path', async () => {
  const map = fakeMap();
  const snapshot = await buildStateSnapshot(map.runner);
  assert.deepEqual(map.calls.map((call) => call.name).sort(), ['analyst_query', 'get_current_view_state']);
  assert.equal(snapshot.analyst.coverage.warmup.startsWith('flights enabled moments ago'), true);
  assert.deepEqual(snapshot.view.disabledLayerIds, ['flights']);
});

test('a map action that fails is reported to the model and to the operator', async () => {
  const map = fakeMap();
  const runner = async (name, args) => {
    if (name === 'set_layer_visibility') throw new Error('Unknown data layer: submarines');
    return map.runner(name, args);
  };
  const { fetchImpl, upstreamCalls } = appFetch((body, turn) => (turn === 1
    ? toolCallReply([{ name: 'set_layer_visibility', args: { layerId: 'submarines', enabled: true } }])
    : { choices: [{ message: { content: 'There is no submarines layer.' } }] }));

  const backend = createOpenAiCompatBackend({ fetchImpl });
  const controller = createHarnessController({ runner, backend, tools: await backend.loadTools() });
  const result = await controller.submit('show submarines');

  assert.equal(result.actions[0].ok, false);
  assert.equal(result.actions[0].error, 'Unknown data layer: submarines');
  const toolMessage = upstreamCalls[1].body.messages.find((message) => message.role === 'tool');
  assert.match(toolMessage.content, /Unknown data layer: submarines/);
});

test('an unreachable local model fails the turn without touching the map', async () => {
  const map = fakeMap();
  const chat = createHarnessChatMiddleware({
    env: ENV,
    fetchImpl: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:1234'); },
  });
  const fetchImpl = async (path, options = {}) => {
    if (path === '/api/harness/tools') {
      return new Response(JSON.stringify({ tools: harnessChatCompletionTools() }), { status: 200 });
    }
    const req = Readable.from([Buffer.from(options.body)]);
    req.method = 'POST';
    req.socket = { remoteAddress: '127.0.0.1' };
    const res = {
      statusCode: 200, headers: {}, setHeader() {}, end(payload) { this.payload = payload; },
    };
    await chat(req, res);
    return new Response(res.payload, { status: res.statusCode });
  };

  const backend = createOpenAiCompatBackend({ fetchImpl });
  const controller = createHarnessController({ runner: map.runner, backend, tools: await backend.loadTools() });
  const result = await controller.submit('fly to Tokyo');

  assert.equal(result.ok, false);
  assert.match(result.error, /ECONNREFUSED/);
  assert.deepEqual(
    map.calls.map((call) => call.name),
    ['get_current_view_state', 'analyst_query'],
    'only the read verbs ran; nothing moved',
  );
});
