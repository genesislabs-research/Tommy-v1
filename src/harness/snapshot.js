/**
 * The world-state snapshot handed to the model at the start of every harness
 * turn.
 *
 * It is built from the SAME read verbs the voice model calls —
 * `get_current_view_state` and `analyst_query` — dispatched through the same
 * `runner`. No new data path, no second source of truth: if the snapshot and
 * the voice model ever disagree about what is on screen, that is a bug in one
 * shared function rather than a divergence between two.
 *
 * Two rules govern what comes back:
 *
 *  1. NO FIREHOSE. `analyst_query` already returns a compact, context-safe
 *     payload (identity plus the fields queries sort and filter on). We trim
 *     the item list further for the snapshot, but we never reach past it into
 *     raw layer records.
 *
 *  2. NO LAUNDERING. `analyst_query`'s honesty fields — `coverage.warmup`
 *     (a layer enabled seconds ago is still loading, so a low count is not a
 *     fact), `coverage.note` (viewport-loaded vs. full cohort), `scopeLabel`,
 *     and `countsReconciliation` — travel through untouched. Stripping them
 *     would leave the model confidently reporting numbers it should be
 *     hedging, which is precisely the failure those fields exist to prevent.
 */

/** Items to carry per snapshot. The model can always call analyst_query for more. */
const DEFAULT_ITEM_LIMIT = 12;

/**
 * Build the per-turn state snapshot.
 *
 * Neither read is allowed to sink a turn: a snapshot is context, not the
 * command. If `get_current_view_state` throws we still send the analyst view;
 * if `analyst_query` throws (layers off, engine cold) we say so in `error` and
 * let the model narrate that honestly.
 *
 * @param {(name: string, args?: object, opts?: object) => Promise<object>} runner
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.itemLimit]
 * @param {object} [options.analystQuery] Override the default view-scope query.
 * @returns {Promise<object>} Snapshot object; never throws.
 */
export async function buildStateSnapshot(runner, {
  signal = null,
  itemLimit = DEFAULT_ITEM_LIMIT,
  analystQuery = null,
} = {}) {
  const runOptions = signal ? { signal } : {};
  const query = analystQuery || { scope: { kind: 'view' }, limit: itemLimit };

  const [viewResult, analystResult] = await Promise.all([
    settle(() => runner('get_current_view_state', {}, runOptions)),
    settle(() => runner('analyst_query', query, runOptions)),
  ]);

  return {
    capturedAt: new Date().toISOString(),
    view: summarizeViewState(viewResult),
    analyst: summarizeAnalystResult(analystResult, itemLimit),
  };
}

/**
 * Compact `get_current_view_state` for the model.
 *
 * Camera degrees are rounded to four places (~10 m — finer than any framing
 * decision) and layers are reduced to the ones that are ON plus any that are
 * erroring, because a 30-entry list of disabled layers is noise the model then
 * has to scan past on every single turn.
 */
export function summarizeViewState(result) {
  if (!result || result.ok === false) {
    return { error: result?.error || 'view state unavailable' };
  }
  const camera = result.camera || {};
  const layers = Array.isArray(result.layers) ? result.layers : [];
  return {
    camera: {
      latitude: round(camera.latitude, 4),
      longitude: round(camera.longitude, 4),
      heightM: round(camera.heightM, 0),
    },
    style: result.style ?? null,
    context: result.context ?? null,
    cockpit: result.cockpit ?? null,
    controls: result.controls ?? null,
    scenePlayback: result.scenePlayback ?? null,
    tracked: result.tracked ?? null,
    enabledLayers: layers
      .filter((layer) => layer.enabled || layer.error)
      .map((layer) => ({
        id: layer.id,
        name: layer.name,
        enabled: Boolean(layer.enabled),
        count: layer.count ?? 0,
        ...(layer.error ? { error: layer.error } : {}),
      })),
    disabledLayerIds: layers.filter((layer) => !layer.enabled && !layer.error).map((layer) => layer.id),
  };
}

/**
 * Compact an `analyst_query` result, preserving every honesty field.
 *
 * `coverage` is passed by reference-copy, not rebuilt field by field: a future
 * note added inside runAnalystQuery reaches the model automatically instead of
 * being silently dropped by a whitelist here.
 */
export function summarizeAnalystResult(result, itemLimit = DEFAULT_ITEM_LIMIT) {
  if (!result || result.ok === false) {
    return {
      error: result?.error || 'analyst query unavailable',
      ...(result?.coverage ? { coverage: result.coverage } : {}),
    };
  }
  const items = Array.isArray(result.items) ? result.items : [];
  const kept = items.slice(0, itemLimit);
  return {
    count: result.count ?? kept.length,
    scopeLabel: result.scopeLabel ?? null,
    summary: result.summary ?? null,
    coverage: result.coverage ?? null,
    items: kept,
    // Two truncation flags, and they mean different things: `truncated` is the
    // engine's (its own result set was capped), `itemsTruncated` is ours (the
    // snapshot carried fewer items than the engine returned). Collapsing them
    // would let the model report "there are only 12" about a list we shortened.
    truncated: Boolean(result.truncated),
    ...(items.length > kept.length
      ? { itemsTruncated: true, itemsShown: kept.length, itemsAvailable: items.length }
      : {}),
    ...(result.contactsWindow ? { contactsWindow: result.contactsWindow } : {}),
    ...(result.contactsWindowCount !== undefined ? { contactsWindowCount: result.contactsWindowCount } : {}),
    ...(result.contactsWindowSubject !== undefined ? { contactsWindowSubject: result.contactsWindowSubject } : {}),
    ...(result.countsReconciliation ? { countsReconciliation: result.countsReconciliation } : {}),
  };
}

/** One-line snapshot digest for the console status row. */
export function describeSnapshot(snapshot) {
  const camera = snapshot?.view?.camera;
  const where = camera && Number.isFinite(camera.latitude)
    ? `${camera.latitude.toFixed(2)}, ${camera.longitude.toFixed(2)}`
    : 'unknown';
  const layers = snapshot?.view?.enabledLayers?.length ?? 0;
  const count = snapshot?.analyst?.count;
  const contacts = Number.isFinite(count) ? `${count} in view` : 'no analyst read';
  return `${where} · ${layers} layer${layers === 1 ? '' : 's'} on · ${contacts}`;
}

async function settle(run) {
  try {
    return await run();
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

function round(value, digits) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}
