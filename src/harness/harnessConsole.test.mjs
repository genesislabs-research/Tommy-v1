import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatActionsLine, shouldToggleHarnessConsole } from './harnessConsole.js';

const consoleSource = readFileSync(new URL('./harnessConsole.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const realtimeSource = readFileSync(new URL('../voice/gevRealtime.js', import.meta.url), 'utf8');

test('every element the console looks up exists in its own template', () => {
  const template = consoleSource.slice(consoleSource.indexOf('root.innerHTML'), consoleSource.indexOf('doc.body.appendChild'));
  const queried = [...consoleSource.matchAll(/querySelector\('#([\w-]+)'\)/g)].map((match) => match[1]);
  assert.ok(queried.length >= 6, 'the console still queries its parts by id');
  for (const id of new Set(queried)) {
    assert.ok(template.includes(`id="${id}"`), `#${id} is missing from the console template`);
  }
});

test('every console class the template uses is styled', () => {
  const template = consoleSource.slice(consoleSource.indexOf('root.innerHTML'), consoleSource.indexOf('doc.body.appendChild'));
  const classes = new Set([...template.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/)));
  for (const className of classes) {
    assert.ok(css.includes(`.${className}`), `.${className} has no style rule`);
  }
  assert.ok(css.includes('#gev-harness-console'), 'the console root is positioned');
});

test('the console yields the screen in cockpit mode, as the command dock does', () => {
  assert.match(css, /body\.cockpit-mode #gev-harness-console \{[^}]*display: none/);
});

test('the console is additive — the voice control is untouched', () => {
  // The harness must not reach into the voice UI, and must not be inside it.
  assert.ok(!consoleSource.includes('gev-voice'), 'the console never touches voice UI ids');
  assert.ok(!indexSource.includes('gevRealtime'), 'the harness never imports the voice controller');
  // main.js still starts voice exactly as before, and hands its runner across.
  assert.match(mainSource, /window\.__godsEyeView\.voiceCommands = initGevVoiceCommands\(/);
  assert.match(mainSource, /runner: window\.__godsEyeView\.voiceCommands\?\.runner/);
  // The seam itself: the voice controller still owns a runner to share.
  assert.match(realtimeSource, /const runner = createGevActionRunner\(/);
  assert.match(realtimeSource, /this\.runner = runner;/);
});

test('a failed harness start never blocks app init', () => {
  const block = mainSource.slice(mainSource.indexOf('initGevHarness({'));
  assert.match(block, /\.catch\(/, 'harness init failures are caught');
});

test('the actions line names each failure instead of counting them', () => {
  assert.equal(formatActionsLine([]), '');
  assert.equal(
    formatActionsLine([{ name: 'fly_to_location', ok: true }, { name: 'set_layer_visibility', ok: true }]),
    'actions: fly_to_location · set_layer_visibility',
  );
  assert.equal(
    formatActionsLine([
      { name: 'fly_to_location', ok: true },
      { name: 'set_layer_visibility', ok: false, error: 'Unknown data layer: submarines' },
    ]),
    'actions: fly_to_location · set_layer_visibility ✗ Unknown data layer: submarines',
  );
});

test('a failure with no message still reads as a failure', () => {
  assert.equal(formatActionsLine([{ name: 'track_entity', ok: false }]), 'actions: track_entity ✗ failed');
});

test('the toggle key never fires while the operator is typing', () => {
  const plain = { key: '`', target: { closest: () => null } };
  assert.equal(shouldToggleHarnessConsole(plain), true);
  assert.equal(shouldToggleHarnessConsole({ ...plain, ctrlKey: true }), false);
  assert.equal(shouldToggleHarnessConsole({ ...plain, metaKey: true }), false);
  assert.equal(shouldToggleHarnessConsole({ ...plain, shiftKey: true }), false);
  assert.equal(shouldToggleHarnessConsole({ ...plain, defaultPrevented: true }), false);
  assert.equal(shouldToggleHarnessConsole({ key: 'a', target: { closest: () => null } }), false);
  assert.equal(shouldToggleHarnessConsole(null), false);
  assert.equal(
    shouldToggleHarnessConsole({ key: '`', target: { closest: (sel) => (sel.includes('input') ? {} : null) } }),
    false,
    'a backtick typed into the harness input is a backtick, not a toggle',
  );
  assert.equal(shouldToggleHarnessConsole({ key: '`', target: { isContentEditable: true } }), false);
});

test('the Backquote code is accepted for layouts that report it that way', () => {
  assert.equal(shouldToggleHarnessConsole({ code: 'Backquote', key: 'Dead', target: { closest: () => null } }), true);
});
