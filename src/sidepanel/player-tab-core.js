import { UI_STATE } from './state.js';
import {
  escapeHtml,
  formatValue,
  formatDuration,
  formatCompactNumber,
  getRemainingSeconds,
  getLabelTrans,
  setActivePlayerSubTab
} from './core.js';

let buildingTabRefreshInterval = null;

async function requestCalciumApi(path, {
  method = 'GET',
  json = undefined,
  headers = undefined
} = {}) {
  return chrome.runtime.sendMessage({
    type: 'CALCIUM_API_REQUEST',
    path,
    method,
    json,
    headers
  });
}

function initGlobalTooltips() {
  const tooltip = document.createElement('div');
  tooltip.className = 'calcium-global-tooltip';
  document.body.appendChild(tooltip);

  document.addEventListener('mouseover', (event) => {
    const el = event.target.closest('[title]');
    if (!el) return;

    const text = el.getAttribute('title');
    if (!text) return;

    el.dataset.originalTitle = text;
    el.removeAttribute('title');

    tooltip.textContent = text;
    tooltip.style.opacity = '1';
  });

  document.addEventListener('mousemove', (event) => {
    tooltip.style.left = `${event.pageX + 10}px`;
    tooltip.style.top = `${event.pageY + 10}px`;
  });

  document.addEventListener('mouseout', (event) => {
    const el = event.target.closest('[data-original-title]');
    if (!el) return;

    el.setAttribute('title', el.dataset.originalTitle);
    delete el.dataset.originalTitle;

    tooltip.style.opacity = '0';
  });
}

async function usePlayerItem(itemUuid, options = {}) {
  const calcium = UI_STATE.snapshot?.calcium || null;

  const playerUuid =
    calcium?.guid?.player ||
    calcium?.Data?.Player?.uuid ||
    null;

  if (!playerUuid) {
    return { ok: false, error: 'NO_PLAYER_UUID' };
  }

  if (!itemUuid) {
    return { ok: false, error: 'NO_ITEM_UUID' };
  }

  return requestCalciumApi(
    `/api/players/${playerUuid}/items/${itemUuid}/use`,
    {
      method: 'POST',
      json: options ?? {}
    }
  );
}

function updateBuildingTimersOnly() {
  const panel = document.getElementById('calcium-player-panel');
  if (!panel) return;

  const timers = panel.querySelectorAll('[data-building-remaining-seconds]');
  if (!timers.length) return;

  timers.forEach((node) => {
    const current = Number(node.dataset.buildingRemainingSeconds ?? '0');
    const next = Math.max(0, current - 1);

    node.dataset.buildingRemainingSeconds = String(next);
    node.textContent = formatDuration(next);

    if (next <= 0) {
      node.classList.remove('is-active');
    }
  });
}

function stopBuildingTabRefresh() {
  if (!buildingTabRefreshInterval) return;

  window.clearInterval(buildingTabRefreshInterval);
  buildingTabRefreshInterval = null;
}

function syncBuildingTabRefresh() {
  if (UI_STATE.activePlayerSubTab === 'batiments') {
    if (!buildingTabRefreshInterval) {
      buildingTabRefreshInterval = window.setInterval(() => {
        if (UI_STATE.activePlayerSubTab === 'batiments') {
          updateBuildingTimersOnly();
        }
      }, 1000);
    }

    return;
  }

  stopBuildingTabRefresh();
}

function buildPlayerHero() {
  return `
    <div class="calcium-player-subtabs">
      <button class="calcium-player-subtab ${UI_STATE.activePlayerSubTab === 'general' ? 'active' : ''}" data-player-subtab="general">Général</button>
      <button class="calcium-player-subtab ${UI_STATE.activePlayerSubTab === 'troupes' ? 'active' : ''}" data-player-subtab="troupes">Troupes</button>
      <button class="calcium-player-subtab ${UI_STATE.activePlayerSubTab === 'batiments' ? 'active' : ''}" data-player-subtab="batiments">Bâtiments</button>
      <button class="calcium-player-subtab ${UI_STATE.activePlayerSubTab === 'recherche' ? 'active' : ''}" data-player-subtab="recherche">Recherche</button>
      <button class="calcium-player-subtab ${UI_STATE.activePlayerSubTab === 'quests' ? 'active' : ''}" data-player-subtab="quests">Quêtes</button>
    </div>
  `;
}

function getItemActionReductionSeconds(itemDef) {
  const effects = Array.isArray(itemDef?.effects) ? itemDef.effects : [];
  const effect = effects.find((entry) => entry?.name === 'action_time_reduction');
  if (!effect) return 0;

  return Math.max(0, Number(effect?.default ?? 0));
}

function formatDurationShort(seconds) {
  const total = Math.max(0, Number(seconds || 0));

  if (total < 60) {
    return `${total}s`;
  }

  if (total < 3600) {
    return `${Math.round(total / 60)}m`;
  }

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h${minutes}`;
}

function applyOptimisticInventoryConsumption(itemUuid, usedCount) {
  const items = UI_STATE.snapshot?.calcium?.Data?.Player?.items;
  if (!Array.isArray(items)) return;

  const item = items.find((entry) => String(entry?.uuid || '') === String(itemUuid));
  if (!item) return;

  item.count = Math.max(0, Number(item.count ?? 0) - Number(usedCount ?? 0));
}


function applyOptimisticActionAcceleration(actionUuid, reductionSeconds) {
  const collections = [
    UI_STATE.snapshot?.derived?.buildingActions,
    UI_STATE.snapshot?.derived?.activeBuildingActions,
    UI_STATE.snapshot?.derived?.searchActions,
    UI_STATE.snapshot?.derived?.troopActions,
    UI_STATE.snapshot?.calcium?.Data?.Actions
  ];


  collections.forEach((collection) => {
    if (!Array.isArray(collection)) return;

    const action = collection.find((entry) => String(entry?.uuid || '') === String(actionUuid));
    if (!action) return;

    const currentRemaining = Math.max(
      0,
      Number(action.remainingTime ?? getRemainingSeconds(action))
    );

    const nextRemaining = Math.max(
      0,
      currentRemaining - Number(reductionSeconds ?? 0)
    );

    action.remainingTime = nextRemaining;
    action.endAt = new Date(Date.now() + nextRemaining * 1000).toISOString();

    if (nextRemaining <= 0) {
      action.finished = true;
    }
  });
}

export {
  UI_STATE,
  escapeHtml,
  formatValue,
  formatDuration,
  formatCompactNumber,
  getRemainingSeconds,
  getLabelTrans,
  setActivePlayerSubTab,
  requestCalciumApi,
  initGlobalTooltips,
  usePlayerItem,
  updateBuildingTimersOnly,
  stopBuildingTabRefresh,
  syncBuildingTabRefresh,
  buildPlayerHero,
  getItemActionReductionSeconds,
  formatDurationShort,
  applyOptimisticInventoryConsumption,
  applyOptimisticActionAcceleration
};
