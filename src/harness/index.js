/**
 * Tommy harness — wiring.
 *
 * Builds the provider-agnostic controller, points it at a backend, and hangs a
 * typed console off it. Everything here is ADDITIVE: the OpenAI voice
 * controller is neither imported nor modified, and both paths end up calling
 * the same `runner`.
 *
 * The runner is shared with the voice path when one is handed in. It is
 * stateless with respect to whichever model is driving — sharing it simply
 * means one instance of the camera-prewarm and camera-verb setup that
 * `createGevActionRunner` performs, rather than two.
 */

import { createGevActionRunner } from '../voice/gevActions.js';
import { createHarnessController } from './harnessController.js';
import { createOpenAiCompatBackend, OPENAI_COMPAT_BACKEND_ID } from './backends/openaiCompatBackend.js';
import { createHarnessBackend } from './backends/backend.js';
import { createHarnessConsole, formatActionsLine, shouldToggleHarnessConsole } from './harnessConsole.js';
import { describeSnapshot } from './snapshot.js';

/**
 * Stand the harness up.
 *
 * Returns null when no private-LLM endpoint is configured — a production build
 * with no proxy behind it should not grow a console that cannot answer.
 *
 * @param {object} options
 * @param {object} options.viewer Cesium viewer.
 * @param {object} options.styleManager
 * @param {object} options.dataManager
 * @param {object} [options.sceneDirector]
 * @param {object} [options.annotations]
 * @param {Function} [options.runner] Existing runner to share; built if absent.
 * @param {string} [options.backendId]
 * @param {object} [options.backendOptions]
 * @param {boolean} [options.mountUi]
 */
export async function initGevHarness({
  viewer,
  styleManager,
  dataManager,
  sceneDirector = null,
  annotations = null,
  runner = null,
  backendId = OPENAI_COMPAT_BACKEND_ID,
  backendOptions = {},
  mountUi = true,
} = {}) {
  const backend = backendId === OPENAI_COMPAT_BACKEND_ID
    ? createOpenAiCompatBackend(backendOptions)
    : createHarnessBackend(backendId, backendOptions);

  const config = typeof backend.describe === 'function'
    ? await backend.describe()
    : { enabled: true };
  if (!config?.enabled) {
    console.info('[gev-harness] disabled —', config?.error || 'no private-LLM endpoint configured');
    return null;
  }

  const activeRunner = runner || createGevActionRunner({
    viewer, styleManager, dataManager, sceneDirector, annotations,
  });

  // The tool schema is fetched rather than duplicated so the harness can only
  // ever offer the same verbs GEV_REALTIME_TOOLS declares. A failure here is
  // not fatal: with an empty list the controller stops policing verb names and
  // lets the runner reject anything it does not implement.
  let tools = [];
  try {
    tools = await backend.loadTools();
  } catch (error) {
    console.warn('[gev-harness] tool schema unavailable; verb validation is off —', error?.message || error);
  }

  const controller = createHarnessController({ runner: activeRunner, backend, tools, dataManager });
  const harness = { controller, backend, config, console: null, dispose: () => {} };

  if (mountUi && typeof document !== 'undefined') {
    harness.console = mountHarnessConsole(controller, config, harness);
  }

  window.__gevHarness = harness;
  return harness;
}

/** Bind the console to a controller. Exported so a headless caller can skip it. */
export function mountHarnessConsole(controller, config = {}, harness = {}) {
  const ui = createHarnessConsole({ reset: true });
  ui.setStatus('ready', `READY · ${config.model || 'local'}`);

  const unsubscribe = controller.on((event) => {
    if (event.type === 'snapshot') {
      ui.appendEntry('state', describeSnapshot(event.snapshot));
    }
  });

  const onSubmit = async (event) => {
    event.preventDefault();
    const text = ui.input.value.trim();
    if (!text) return;
    ui.input.value = '';
    ui.appendEntry('user', text);
    ui.setBusy(true);
    ui.setStatus('busy', 'THINKING');
    try {
      const result = await controller.submit(text);
      if (result.aborted) {
        ui.appendEntry('note', 'superseded by a newer command');
      } else if (result.error) {
        ui.appendEntry('error', result.error, { detail: formatActionsLine(result.actions) });
      } else {
        ui.appendEntry('reply', result.text || '(no reply)', { detail: formatActionsLine(result.actions) });
      }
    } catch (error) {
      ui.appendEntry('error', error?.message || 'Harness turn failed');
    } finally {
      ui.setBusy(false);
      ui.setStatus('ready', `READY · ${config.model || 'local'}`);
    }
  };

  const onKeyDown = (event) => {
    if (shouldToggleHarnessConsole(event)) {
      event.preventDefault();
      ui.toggle();
      return;
    }
    if (event.key === 'Escape' && ui.isOpen() && ui.root.contains(event.target)) {
      ui.hide();
    }
  };

  const onLauncher = () => ui.toggle();
  const onClose = () => ui.hide();

  ui.form.addEventListener('submit', onSubmit);
  ui.launcher.addEventListener('click', onLauncher);
  ui.closeButton.addEventListener('click', onClose);
  document.addEventListener('keydown', onKeyDown);

  harness.dispose = () => {
    unsubscribe();
    ui.form.removeEventListener('submit', onSubmit);
    ui.launcher.removeEventListener('click', onLauncher);
    ui.closeButton.removeEventListener('click', onClose);
    document.removeEventListener('keydown', onKeyDown);
    ui.root.remove();
  };
  return ui;
}
