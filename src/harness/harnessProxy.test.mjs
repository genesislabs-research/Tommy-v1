import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import {
  HARNESS_SYSTEM_INSTRUCTIONS,
  createHarnessChatMiddleware,
  harnessChatCompletionTools,
  resolveHarnessLlmConfig,
  sanitizeHarnessChatRequest,
} from '../../vite.config.js';

const ENV = { HARNESS_LLM_BASE_URL: 'http://localhost:1234/v1', HARNESS_LLM_MODEL: 'qwen3-coder', HARNESS_LLM_API_KEY: 'secret-key' };

function request(body, { method = 'POST' } = {}) {
  const stream = Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  stream.method = method;
  stream.url = '/api/harness/chat';
  stream.socket = { remoteAddress: '127.0.0.1' };
  return stream;
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(payload) { this.body = payload ?? null; this.ended = true; },
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

test('the realtime tool schema is reshaped for chat completions, not rewritten', async () => {
  const tools = harnessChatCompletionTools();
  assert.equal(tools.length, 28, 'all 28 GEV verbs reach the harness');
  const names = tools.map((tool) => tool.function.name);
  for (const verb of ['fly_to_location', 'analyst_query', 'get_current_view_state', 'annotate_map', 'track_entity']) {
    assert.ok(names.includes(verb), `${verb} is offered`);
  }
  const flyTo = tools.find((tool) => tool.function.name === 'fly_to_location');
  assert.equal(flyTo.type, 'function');
  assert.equal(flyTo.function.parameters.type, 'object');
  // Same schema, only a different envelope — a nested `parameters` here means
  // the voice and harness paths could not have drifted apart.
  assert.ok(flyTo.function.parameters.properties.locationId);
  assert.ok(flyTo.function.description.length > 0);
});

test('a tool with no declared parameters still gets an object schema', () => {
  const [tool] = harnessChatCompletionTools([{ type: 'function', name: 'zoom_to_globe', description: 'x' }]);
  assert.deepEqual(tool.function.parameters, { type: 'object', properties: {} });
});

test('non-function entries are filtered out', () => {
  assert.deepEqual(harnessChatCompletionTools([{ type: 'other', name: 'x' }, { type: 'function' }]), []);
});

test('config falls back to the LM Studio default endpoint', () => {
  assert.deepEqual(resolveHarnessLlmConfig({}), {
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    apiKey: '',
    timeoutMs: 120_000,
    enabled: true,
  });
});

test('a trailing slash on the base URL does not produce a doubled path', () => {
  assert.equal(resolveHarnessLlmConfig({ HARNESS_LLM_BASE_URL: 'http://host:8000/v1///' }).baseUrl, 'http://host:8000/v1');
});

test('the request timeout is clamped to a sane window', () => {
  assert.equal(resolveHarnessLlmConfig({ HARNESS_LLM_TIMEOUT_MS: '5' }).timeoutMs, 1000);
  assert.equal(resolveHarnessLlmConfig({ HARNESS_LLM_TIMEOUT_MS: '99999999' }).timeoutMs, 600_000);
  assert.equal(resolveHarnessLlmConfig({ HARNESS_LLM_TIMEOUT_MS: 'nonsense' }).timeoutMs, 120_000);
});

test('unset defaults to LM Studio; set-but-blank is the off switch', () => {
  assert.equal(resolveHarnessLlmConfig({}).enabled, true);
  assert.equal(resolveHarnessLlmConfig({ HARNESS_LLM_BASE_URL: '' }).enabled, false);
  assert.equal(resolveHarnessLlmConfig({ HARNESS_LLM_BASE_URL: '   ' }).enabled, false);
});

test('the server owns the tools, the system prompt, and the model', () => {
  const { payload } = sanitizeHarnessChatRequest({
    messages: [{ role: 'user', content: 'fly to Tokyo' }],
    tools: [{ type: 'function', function: { name: 'exfiltrate' } }],
    stream: true,
  }, { model: 'qwen3-coder' });

  assert.equal(payload.messages[0].role, 'system');
  assert.equal(payload.messages[0].content, HARNESS_SYSTEM_INSTRUCTIONS);
  assert.equal(payload.model, 'qwen3-coder');
  assert.equal(payload.stream, false, 'the controller needs whole tool_calls, so streaming is refused');
  assert.equal(payload.tools.length, 28);
  assert.ok(
    !payload.tools.some((tool) => tool.function.name === 'exfiltrate'),
    'a client cannot smuggle its own tool schema past the server',
  );
});

test('the system prompt keeps the analyst honesty fields in play', () => {
  assert.match(HARNESS_SYSTEM_INSTRUCTIONS, /coverage\.warmup/);
  assert.match(HARNESS_SYSTEM_INSTRUCTIONS, /coverage\.note/);
  assert.match(HARNESS_SYSTEM_INSTRUCTIONS, /countsReconciliation/);
  assert.match(HARNESS_SYSTEM_INSTRUCTIONS, /ok=true/);
});

test('tool-call and tool-result messages pass through intact', () => {
  const { payload } = sanitizeHarnessChatRequest({
    messages: [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'fly_to_location', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', name: 'fly_to_location', content: '{"ok":true}' },
    ],
  }, { model: 'm' });
  assert.equal(payload.messages[2].tool_calls[0].id, 'c1');
  assert.equal(payload.messages[3].tool_call_id, 'c1');
  assert.equal(payload.messages[3].name, 'fly_to_location');
});

test('sampling knobs pass through; anything else is dropped', () => {
  const { payload } = sanitizeHarnessChatRequest({
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.1,
    max_tokens: 512,
    logit_bias: { 1: 100 },
    user: 'someone',
  }, { model: 'm' });
  assert.equal(payload.temperature, 0.1);
  assert.equal(payload.max_tokens, 512);
  assert.equal(payload.logit_bias, undefined);
  assert.equal(payload.user, undefined);
});

test('a blank client model falls back to the server default', () => {
  const { payload } = sanitizeHarnessChatRequest({ messages: [{ role: 'user', content: 'hi' }], model: '  ' }, { model: 'm' });
  assert.equal(payload.model, 'm');
});

test('malformed requests are rejected before any upstream call', () => {
  assert.match(sanitizeHarnessChatRequest(null, { model: 'm' }).error, /JSON object/);
  assert.match(sanitizeHarnessChatRequest({}, { model: 'm' }).error, /non-empty array/);
  assert.match(sanitizeHarnessChatRequest({ messages: [] }, { model: 'm' }).error, /non-empty array/);
  assert.match(sanitizeHarnessChatRequest({ messages: ['hi'] }, { model: 'm' }).error, /must be an object/);
  assert.match(sanitizeHarnessChatRequest({ messages: [{ content: 'hi' }] }, { model: 'm' }).error, /needs a role/);
});

test('the middleware forwards to the configured endpoint with the server-side key', async () => {
  const seen = [];
  const chat = createHarnessChatMiddleware({
    env: ENV,
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return jsonResponse({ choices: [{ message: { content: 'Flying to Tokyo.' } }] });
    },
  });
  const res = response();
  await chat(request({ messages: [{ role: 'user', content: 'fly to Tokyo' }] }), res);

  assert.equal(seen[0].url, 'http://localhost:1234/v1/chat/completions');
  assert.equal(seen[0].options.headers.Authorization, 'Bearer secret-key');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-gev-harness-model'], 'qwen3-coder');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(JSON.parse(res.body).choices[0].message.content, 'Flying to Tokyo.');
  // The reply the browser receives never names the endpoint or the key.
  assert.doesNotMatch(res.body, /secret-key|localhost:1234/);
});

test('no key configured means no Authorization header — the LM Studio default', async () => {
  let captured;
  const chat = createHarnessChatMiddleware({
    env: { HARNESS_LLM_BASE_URL: 'http://localhost:1234/v1' },
    fetchImpl: async (url, options) => { captured = options; return jsonResponse({ choices: [] }); },
  });
  await chat(request({ messages: [{ role: 'user', content: 'hi' }] }), response());
  assert.equal(captured.headers.Authorization, undefined);
});

test('an unset base URL answers 503 instead of calling out', async () => {
  let called = false;
  const chat = createHarnessChatMiddleware({
    env: { HARNESS_LLM_BASE_URL: '' },
    fetchImpl: async () => { called = true; return jsonResponse({}); },
  });
  const res = response();
  await chat(request({ messages: [{ role: 'user', content: 'hi' }] }), res);
  assert.equal(called, false);
  assert.equal(res.statusCode, 503);
  assert.match(JSON.parse(res.body).error, /HARNESS_LLM_BASE_URL is not set/);
});

test('a non-POST request is refused', async () => {
  const chat = createHarnessChatMiddleware({ env: ENV, fetchImpl: async () => jsonResponse({}) });
  const res = response();
  await chat(request({}, { method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
});

test('unparseable JSON answers 400, not 502', async () => {
  const chat = createHarnessChatMiddleware({ env: ENV, fetchImpl: async () => jsonResponse({}) });
  const res = response();
  await chat(request('{not json'), res);
  assert.equal(res.statusCode, 400);
});

test('an upstream status is passed through rather than masked', async () => {
  const chat = createHarnessChatMiddleware({
    env: ENV,
    fetchImpl: async () => jsonResponse({ error: { message: 'model not loaded' } }, 404),
  });
  const res = response();
  await chat(request({ messages: [{ role: 'user', content: 'hi' }] }), res);
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /model not loaded/);
});

test('an unreachable local model answers 502 with the reason', async () => {
  const chat = createHarnessChatMiddleware({
    env: ENV,
    fetchImpl: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:1234'); },
  });
  const res = response();
  await chat(request({ messages: [{ role: 'user', content: 'hi' }] }), res);
  assert.equal(res.statusCode, 502);
  assert.match(JSON.parse(res.body).error, /ECONNREFUSED/);
});

test('a timeout is reported as a timeout', async () => {
  const chat = createHarnessChatMiddleware({
    env: { ...ENV, HARNESS_LLM_TIMEOUT_MS: '1000' },
    fetchImpl: async () => {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    },
  });
  const res = response();
  await chat(request({ messages: [{ role: 'user', content: 'hi' }] }), res);
  assert.equal(res.statusCode, 502);
  assert.match(JSON.parse(res.body).error, /did not respond within 1000ms/);
});
