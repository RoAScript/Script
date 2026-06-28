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

  function hideTooltip() {
    const owner = document.querySelector('[data-original-title]');

    if (owner?.dataset?.originalTitle) {
      owner.setAttribute('title', owner.dataset.originalTitle);
      delete owner.dataset.originalTitle;
    }

    tooltip.textContent = '';
    tooltip.style.opacity = '0';
  }

  function positionTooltip(event) {
    const spacing = 12;
    const viewportPadding = 8;

    tooltip.style.left = '0px';
    tooltip.style.top = '0px';

    const rect = tooltip.getBoundingClientRect();

    let left = event.clientX + spacing;
    let top = event.clientY + spacing;

    if (left + rect.width > window.innerWidth - viewportPadding) {
      left = event.clientX - rect.width - spacing;
    }

    if (top + rect.height > window.innerHeight - viewportPadding) {
      top = event.clientY - rect.height - spacing;
    }

    left = Math.max(viewportPadding, left);
    top = Math.max(viewportPadding, top);

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  document.addEventListener('mouseover', (event) => {
    const el = event.target.closest('[title]');

    if (!el) return;

    const text = el.getAttribute('title');

    if (!text) return;

    el.dataset.originalTitle = text;
    el.removeAttribute('title');

    tooltip.textContent = text;
    tooltip.style.opacity = '1';

    positionTooltip(event);
  });

  document.addEventListener('mousemove', (event) => {
    if (tooltip.style.opacity !== '1') return;

    positionTooltip(event);
  });

  document.addEventListener('mouseout', (event) => {
    const el = event.target.closest('[data-original-title]');

    if (!el) return;

    el.setAttribute('title', el.dataset.originalTitle);
    delete el.dataset.originalTitle;

    tooltip.textContent = '';
    tooltip.style.opacity = '0';
  });

  document.addEventListener('scroll', hideTooltip, true);
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
    if (node.dataset.buildingTimerFormat === 'compact') {
      node.textContent = formatDurationCompact(next);
      node.title = formatDuration(next);
    } else {
      node.textContent = formatDuration(next);
    }

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
      <button class="calcium-player-subtab ${UI_STATE.activePlayerSubTab === 'farm' ? 'active' : ''}" data-player-subtab="farm">Farm</button>
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
  const total = Math.max(0, Math.floor(Number(seconds || 0)));

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const pad = (v) => String(v).padStart(2, '0');

  if (hours > 0) {
    return `${hours}h ${pad(minutes)}`;
  }

  if (minutes > 0) {
    return `${minutes}m ${pad(secs)}`;
  }

  return `${secs}s`;
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

function formatDurationCompact(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));

  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const pad = (value) => String(value).padStart(2, '0');

  if (days > 0) {
    return `${days}j ${pad(hours)}h`;
  }

  if (hours > 0) {
    return `${hours}h ${pad(minutes)}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${pad(secs)}s`;
  }

  return `${secs}s`;
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
  applyOptimisticActionAcceleration,
  formatDurationCompact
};
