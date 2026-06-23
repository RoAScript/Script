import { UI_STATE, syncStaticUiVisibility } from './state.js';
import {
  formatDuration, getRemainingSeconds, connectLiveUpdates, loadState, setFilter,
  setSearchText, refreshToken, renderMainTabs, setActiveMainTab, setActivePlayerSubTab,
  rebuildCategoryOptions, refreshSelectedDataView
} from './core.js';
import { renderPlayerPanel, initGlobalTooltips } from './player-tab.js';
import { renderAlliancePanel, renderCalciumPanel } from './calcium-tab.js';

function refreshCountdownElements() {
  const elements = document.querySelectorAll('[data-end-at][data-finished]');

  elements.forEach(el => {
    const fakeAction = {
      endAt: el.dataset.endAt,
      finished: el.dataset.finished === 'true',
      remainingTime: Number(el.dataset.remainingTime || 0)
    };

    el.textContent = formatDuration(getRemainingSeconds(fakeAction));
  });
}

function startCountdownRefresh() {
  stopCountdownRefresh();

  UI_STATE.countdownInterval = window.setInterval(() => {
    refreshCountdownElements();
  }, 1000);
}

function stopCountdownRefresh() {
  if (UI_STATE.countdownInterval) {
    window.clearInterval(UI_STATE.countdownInterval);
    UI_STATE.countdownInterval = null;
  }
}

function renderAll() {
  rebuildCategoryOptions();
  renderPlayerPanel();
  renderAlliancePanel();
  refreshCountdownElements();
  startCountdownRefresh();
}

function bindStaticEvents() {
  document.querySelectorAll('.ext-filter-tab').forEach(button => {
    button.addEventListener('click', () => {
      setFilter(button.dataset.filter);
    });
  });

  const searchInput = document.getElementById('ext-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      setSearchText(event.target.value || '');
    });
  }

  const selectEl = document.getElementById('ext-data-select');
  if (selectEl) {
    selectEl.addEventListener('change', () => {
      refreshSelectedDataView();
    });
  }

  const refreshBtn = document.getElementById('refresh-view-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadState();
    });
  }

  const tokenRefreshBtn = document.getElementById('token-refresh-btn');
  if (tokenRefreshBtn) {
    tokenRefreshBtn.addEventListener('click', () => {
      refreshToken();
    });
  }

  document.addEventListener('click', (event) => {
    const action = event.target?.dataset?.treeAction;
    if (!action) return;

    const root = document.querySelector('.calcium-tree-root');
    if (!root) return;

    const nodes = root.querySelectorAll('details.calcium-tree-branch');

    if (action === 'expand-all') {
      nodes.forEach(node => { node.open = true; });
    }

    if (action === 'collapse-all') {
      nodes.forEach(node => { node.open = false; });
    }
  });
  
}

function init() {
  syncStaticUiVisibility();
  bindStaticEvents();
  renderMainTabs();
  connectLiveUpdates();
  setActiveMainTab(UI_STATE.activeMainTab || 'joueur');
  setActivePlayerSubTab(UI_STATE.activePlayerSubTab || 'general');
  loadState();

  if (!window.__calciumTooltipsInit) {
    initGlobalTooltips();
    window.__calciumTooltipsInit = true;
  }

}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

export { renderAll };
