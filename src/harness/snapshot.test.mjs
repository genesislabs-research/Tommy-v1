import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStateSnapshot,
  describeSnapshot,
  summarizeAnalystResult,
  summarizeViewState,
} from './snapshot.js';

const VIEW_STATE = {
  ok: true,
  action: 'get_current_view_state',
  camera: { latitude: 35.68123456, longitude: 139.76789012, heightM: 1234.567 },
  style: 'ghost',
  context: { mode: 'contacts' },
  cockpit: null,
  controls: { hud: 'full' },
  scenePlayback: null,
  tracked: [],
  layers: [
    { id: 'flights', name: 'Flights', enabled: true, count: 41, error: null },
    { id: 'ships', name: 'Ships', enabled: false, count: 0, error: null },
    { id: 'radio', name: 'Radio', enabled: false, count: 0, error: 'Radio layer unavailable' },
  ],
};

const ANALYST_RESULT = {
  ok: true,
  action: 'analyst_query',
  count: 41,
  scopeLabel: 'in view',
  truncated: false,
  summary: '41 aircraft in view',
  items: Array.from({ length: 20 }, (_, index) => ({ layerKey: 'flights', id: `AC${index}` })),
  coverage: {
    note: 'view scope — counts cover loaded data; the flights layer loads by viewport',
    warmup: 'flights enabled moments ago — data is still loading; counts will rise for ~30-45s. Say so.',
    layersQueried: [{ layerKey: 'flights', count: 41 }],
  },
  contactsWindow: { aircraft: 111, radiusKm: 250, centeredOn: 'Tokyo' },
  contactsWindowCount: 111,
  contactsWindowSubject: 'Tokyo',
  countsReconciliation: 'Contacts is ACTIVE: its window holds 111 aircraft…',
};

function stubRunner(overrides = {}) {
  const calls = [];
  const runner = async (name, args, opts) => {
    calls.push({ name, args, opts });
    if (overrides[name]) return overrides[name](args);
    if (name === 'get_current_view_state') return VIEW_STATE;
    if (name === 'analyst_query') return ANALYST_RESULT;
    throw new Error(`unexpected verb ${name}`);
  };
  return { runner, calls };
}

test('snapshot is built from the same read verbs the voice model calls', async () => {
  const { runner, calls } = stubRunner();
  const snapshot = await buildStateSnapshot(runner);
  assert.deepEqual(calls.map((call) => call.name).sort(), ['analyst_query', 'get_current_view_state']);
  const analystCall = calls.find((call) => call.name === 'analyst_query');
  assert.deepEqual(analystCall.args.scope, { kind: 'view' });
  assert.equal(typeof snapshot.capturedAt, 'string');
});

test('analyst warm-up and provenance notes survive into the snapshot', async () => {
  const { runner } = stubRunner();
  const snapshot = await buildStateSnapshot(runner);
  assert.equal(snapshot.analyst.coverage.warmup, ANALYST_RESULT.coverage.warmup);
  assert.equal(snapshot.analyst.coverage.note, ANALYST_RESULT.coverage.note);
  assert.equal(snapshot.analyst.scopeLabel, 'in view');
  assert.equal(snapshot.analyst.summary, '41 aircraft in view');
  assert.equal(snapshot.analyst.countsReconciliation, ANALYST_RESULT.countsReconciliation);
  assert.equal(snapshot.analyst.contactsWindowCount, 111);
  assert.equal(snapshot.analyst.contactsWindowSubject, 'Tokyo');
  // Serialization is how it actually reaches the model — the notes must be in there.
  const wire = JSON.stringify(snapshot);
  assert.ok(wire.includes('still loading'));
  assert.ok(wire.includes('loads by viewport'));
});

test('an unrecognized coverage field still reaches the model', () => {
  const summary = summarizeAnalystResult({
    ok: true, count: 1, items: [], coverage: { note: 'n', futureHonestyField: 'keep me' },
  });
  assert.equal(summary.coverage.futureHonestyField, 'keep me');
});

test('snapshot trims the item list but says that it did', () => {
  const summary = summarizeAnalystResult(ANALYST_RESULT, 5);
  assert.equal(summary.items.length, 5);
  assert.equal(summary.itemsTruncated, true);
  assert.equal(summary.itemsShown, 5);
  assert.equal(summary.itemsAvailable, 20);
  // The engine's own cap is a separate fact and must not be overwritten.
  assert.equal(summary.truncated, false);
  // The headline count still describes the world, not the trimmed list.
  assert.equal(summary.count, 41);
});

test('view summary keeps enabled and erroring layers, drops the rest to ids', () => {
  const view = summarizeViewState(VIEW_STATE);
  assert.deepEqual(view.enabledLayers.map((layer) => layer.id), ['flights', 'radio']);
  assert.equal(view.enabledLayers[1].error, 'Radio layer unavailable');
  assert.deepEqual(view.disabledLayerIds, ['ships']);
  assert.equal(view.camera.latitude, 35.6812);
  assert.equal(view.camera.heightM, 1235);
  assert.equal(view.style, 'ghost');
});

test('a failing read degrades to an error field instead of sinking the turn', async () => {
  const { runner } = stubRunner({
    analyst_query: () => { throw new Error('no layers enabled'); },
  });
  const snapshot = await buildStateSnapshot(runner);
  assert.equal(snapshot.analyst.error, 'no layers enabled');
  assert.equal(snapshot.view.style, 'ghost');
});

test('an ok:false analyst result carries its coverage through', async () => {
  const { runner } = stubRunner({
    analyst_query: () => ({ ok: false, error: 'flights layer is off', coverage: { note: 'nothing queried' } }),
  });
  const snapshot = await buildStateSnapshot(runner);
  assert.equal(snapshot.analyst.error, 'flights layer is off');
  assert.equal(snapshot.analyst.coverage.note, 'nothing queried');
});

test('the abort signal reaches both read verbs', async () => {
  const { runner, calls } = stubRunner();
  const controller = new AbortController();
  await buildStateSnapshot(runner, { signal: controller.signal });
  assert.ok(calls.every((call) => call.opts.signal === controller.signal));
});

test('describeSnapshot summarizes position, layers, and count', async () => {
  const { runner } = stubRunner();
  const snapshot = await buildStateSnapshot(runner);
  assert.equal(describeSnapshot(snapshot), '35.68, 139.77 · 2 layers on · 41 in view');
});
