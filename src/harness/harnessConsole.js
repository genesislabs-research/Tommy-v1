/**
 * The typed way in — a small console anchored above the command dock.
 *
 * Deliberately minimal. The mic and everything around it still belong to the
 * OpenAI voice path; this is the second door, for the private model. It shows
 * three things per turn and nothing more: what you typed, what the model said,
 * and which map actions actually ran — with their failures named, not folded
 * into a count that quietly rounds them off.
 *
 * The element is always mounted but starts collapsed to a single chip, so the
 * feature is discoverable without another permanent panel over the globe.
 */

/** Turns kept in the log before the oldest scroll out of the DOM. */
const MAX_LOG_ENTRIES = 40;

export function createHarnessConsole({ reset = false, doc = document } = {}) {
  let root = doc.getElementById('gev-harness-console');
  if (root && reset) {
    root.remove();
    root = null;
  }
  if (!root) {
    root = doc.createElement('div');
    root.id = 'gev-harness-console';
    root.dataset.open = '0';
    root.dataset.status = 'idle';
    root.innerHTML = `
      <button id="gev-harness-launcher" class="gev-harness-launcher" type="button"
        aria-expanded="false" aria-controls="gev-harness-panel"
        title="Tommy — typed command console (backtick to toggle)">
        <span class="gev-harness-launcher-dot" aria-hidden="true"></span>TOMMY
      </button>
      <div id="gev-harness-panel" class="gev-harness-panel" hidden>
        <div class="gev-harness-header">
          <span class="gev-harness-kicker">TOMMY</span>
          <span id="gev-harness-status" class="gev-harness-status">OFFLINE</span>
          <button id="gev-harness-close" class="gev-harness-close" type="button" aria-label="Hide Tommy console">×</button>
        </div>
        <div id="gev-harness-log" class="gev-harness-log" role="log" aria-live="polite" aria-label="Tommy transcript"></div>
        <form id="gev-harness-form" class="gev-harness-form">
          <input id="gev-harness-input" class="gev-harness-input" type="text" autocomplete="off" spellcheck="false"
            placeholder="fly to Tokyo and show me aircraft" aria-label="Tommy command" />
          <button id="gev-harness-send" class="gev-harness-send" type="submit">SEND</button>
        </form>
      </div>
    `;
    doc.body.appendChild(root);
  }

  const panel = root.querySelector('#gev-harness-panel');
  const launcher = root.querySelector('#gev-harness-launcher');
  const log = root.querySelector('#gev-harness-log');
  const statusEl = root.querySelector('#gev-harness-status');
  const input = root.querySelector('#gev-harness-input');
  const sendButton = root.querySelector('#gev-harness-send');

  function appendEntry(kind, text, { detail = '' } = {}) {
    const entry = doc.createElement('div');
    entry.className = `gev-harness-entry gev-harness-entry-${kind}`;
    const body = doc.createElement('div');
    body.className = 'gev-harness-entry-text';
    body.textContent = text;
    entry.appendChild(body);
    if (detail) {
      const note = doc.createElement('div');
      note.className = 'gev-harness-entry-detail';
      note.textContent = detail;
      entry.appendChild(note);
    }
    log.appendChild(entry);
    while (log.childElementCount > MAX_LOG_ENTRIES) log.removeChild(log.firstElementChild);
    log.scrollTop = log.scrollHeight;
    return entry;
  }

  const api = {
    root,
    panel,
    launcher,
    form: root.querySelector('#gev-harness-form'),
    input,
    sendButton,
    closeButton: root.querySelector('#gev-harness-close'),
    log,
    appendEntry,
    setStatus(status, label) {
      root.dataset.status = status;
      statusEl.textContent = label;
    },
    setBusy(busy) {
      root.dataset.busy = busy ? '1' : '0';
      sendButton.disabled = Boolean(busy);
    },
    isOpen: () => root.dataset.open === '1',
    show() {
      root.dataset.open = '1';
      panel.hidden = false;
      launcher.setAttribute('aria-expanded', 'true');
      input?.focus();
    },
    hide() {
      root.dataset.open = '0';
      panel.hidden = true;
      launcher.setAttribute('aria-expanded', 'false');
    },
    toggle() {
      if (api.isOpen()) api.hide();
      else api.show();
      return api.isOpen();
    },
    clear() {
      log.replaceChildren();
    },
  };
  return api;
}

/**
 * One line naming what actually happened on the map.
 *
 * Failures are named individually rather than counted, because "3 actions"
 * hides the one that threw — and a silent failure behind a confident sentence
 * from the model is the exact thing this line exists to catch.
 */
export function formatActionsLine(actions = []) {
  if (!actions.length) return '';
  const parts = actions.map((action) => (action.ok ? action.name : `${action.name} ✗ ${action.error || 'failed'}`));
  return `actions: ${parts.join(' · ')}`;
}

/**
 * Whether a keystroke should toggle the console.
 *
 * Backtick, unmodified, and never while the operator is typing — the same
 * guard the voice path puts on its Space shortcut, for the same reason.
 */
export function shouldToggleHarnessConsole(event) {
  if (!event || event.defaultPrevented) return false;
  if (event.key !== '`' && event.code !== 'Backquote') return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const target = event.target;
  if (target?.isContentEditable) return false;
  return !target?.closest?.('input, textarea, select, [contenteditable], [role="textbox"]');
}
