import {
  UI_STATE,
  getMainTabs,
  syncStaticUiVisibility
} from './state.js';
import { CalciumI18n } from './i18n.js';
import { renderPlayerPanel } from './player-tab.js';
import { renderAlliancePanel, renderCalciumPanel } from './calcium-tab.js';
import { renderConfigurationPanel, bindConfigurationEvents } from './configuration-tab.js';
import { renderAll } from './app.js';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatValue(value, fallback = '—') {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));

  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const values = [
    { value: days, label: "jr" },
    { value: hours, label: "h" },
    { value: minutes, label: "min" },
    { value: secs, label: "s" }
  ];

  // Trouve le premier élément non nul
  const firstIndex = values.findIndex(v => v.value > 0);

  // Si tout est à 0 → afficher 0s
  if (firstIndex === -1) {
    return "0s";
  }

  return values
    .slice(firstIndex)
    .map((v, i) => {
      const val = i === 0
        ? v.value               // premier : pas de padding
        : String(v.value).padStart(2, '0'); // suivants : padding

      return `${val}${v.label}`;
    })
    .join(" ");
}

function formatCompactNumber(value, decimals = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';

  const safeDecimals = Number.isInteger(decimals) && decimals >= 0 ? decimals : 1;

  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';

  let shortValue;
  let suffix = '';

  if (abs >= 1e9) {
    shortValue = abs / 1e9;
    suffix = ' B';
  } else if (abs >= 1e6) {
    shortValue = abs / 1e6;
    suffix = ' M';
  } else if (abs >= 1e3) {
    shortValue = abs / 1e3;
    suffix = ' k';
  } else {
    return `${num}`;
  }

  const factor = 10 ** safeDecimals;
  const rounded = Math.round(shortValue * factor) / factor;

  const display = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(safeDecimals);

  return `${sign}${display}${suffix}`;
}

function getRemainingSeconds(action) {
  if (!action || action.finished) return 0;

  const endTimestamp = new Date(action.endAt).getTime();
  if (Number.isNaN(endTimestamp)) {
    return Math.max(0, Number(action.remainingTime || 0));
  }

  return Math.max(0, Math.floor((endTimestamp - Date.now()) / 1000));
}

function setStatus(text, badge = 'Info') {
  document.getElementById('status-text').textContent = text;
  document.getElementById('status-badge').textContent = badge;
}

async function requestBridge(message) {
  return chrome.runtime.sendMessage(message);
}

function connectLiveUpdates() {
  if (UI_STATE.port) {
    console.log('[SIDEPANEL][live] connectLiveUpdates() ignoré : port déjà ouvert', UI_STATE.port?.name);
    return;
  }

  console.log('[SIDEPANEL][live] Tentative de connexion live au background…');

  let port;
  try {
    port = chrome.runtime.connect({ name: 'calcium-sidepanel' });
  } catch (e) {
    console.warn('[SIDEPANEL][live] Échec immédiat de chrome.runtime.connect :', e);
    setStatus('Canal live indisponible (connect).', 'Erreur');

    window.setTimeout(() => {
      console.log('[SIDEPANEL][live] Nouvelle tentative de connexion après erreur connect()…');
      connectLiveUpdates();
    }, 2000);
    return;
  }

  UI_STATE.port = port;
  console.log('[SIDEPANEL][live] Port connecté vers background.', port);

  try {
    port.postMessage({ type: 'CALCIUM_PANEL_READY' });
    console.log('[SIDEPANEL][live] CALCIUM_PANEL_READY envoyé au background.');
  } catch (e) {
    console.warn('[SIDEPANEL][live] Erreur lors de l’envoi de CALCIUM_PANEL_READY :', e);
  }

  port.onMessage.addListener((message) => {
    console.log('[SIDEPANEL][live] Message reçu du background :', message?.type, message);

    if (message?.type === 'CALCIUM_PANEL_READY_ACK') {
      console.log('[SIDEPANEL][live] Handshake ACK reçu, live prêt.');
      return;
    }

    if (message?.type === 'CALCIUM_STATE_UPDATED') {
      console.log(
        '[SIDEPANEL][live] Snapshot live reçu.',
        'reason =', message.reason,
        'categories =', Object.keys(message.snapshot?.requestsByCategory || {})
      );

      UI_STATE.snapshot = message.snapshot;
      setStatus(`Mise à jour reçue (${message.reason || 'live'}).`, 'Live');
      renderAll();
    }
  });

  port.onDisconnect.addListener(() => {
    const lastError = chrome.runtime.lastError;
    console.warn('[SIDEPANEL][live] Port déconnecté.', lastError ? lastError.message : '(aucune erreur runtime)');

    UI_STATE.port = null;
    setStatus('Canal live fermé. Reconnexion…', 'Info');

    window.setTimeout(() => {
      console.log('[SIDEPANEL][live] Tentative de reconnexion après déconnexion…');
      connectLiveUpdates();
    }, 1000);
  });
}

function formatBooleanBadge(value, trueLabel = 'Oui', falseLabel = 'Non') {
  return value
    ? `<span class="calcium-badge calcium-badge-success">${escapeHtml(trueLabel)}</span>`
    : `<span class="calcium-badge calcium-badge-muted">${escapeHtml(falseLabel)}</span>`;
}

function formatAllianceGrade(grade) {
  const value = String(grade || '').trim();
  if (!value) return '—';

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatCoordinates(coords) {
  const x = coords?.x;
  const y = coords?.y;

  if (x === undefined || y === undefined || x === null || y === null) {
    return '—';
  }

  return `${x}, ${y}`;
}

function getLabelTrans(str, type = 'general', lang = 'fr') {
  if (!str || !type) return str ?? '';
  const dict = CalciumI18n?.[lang]?.[type] ?? {};
  return dict[str] ?? str;
}

async function loadState() {
  setStatus("Récupération des données du tab actif…", "Chargement");

  const response = await requestBridge({ type: "CALCIUM_GET_ACTIVE_TAB_STATE" });

  if (!response?.ok) {
    UI_STATE.snapshot = null;
    setStatus(response?.error || "Impossible de joindre le content script.", "Erreur");
    renderAll();
    return;
  }

  UI_STATE.snapshot = response.snapshot;

  if (response?.source === "cache") {
    setStatus("Données restaurées depuis le cache.", "Cache");
  } else if (UI_STATE.snapshot?.state?.uiEnabled) {
    setStatus("Données récupérées.", "Connecté");
  } else {
    setStatus("UI désactivée dans cette frame ou page non prête.", "Inactif");
  }

  renderAll();
}

async function setFilter(filter) {
  setStatus('Application du filtre…', 'Action');

  const response = await requestBridge({
    type: 'CALCIUM_SET_FILTER_ON_ACTIVE_TAB',
    filter
  });

  if (!response?.ok) {
    setStatus(response?.error || 'Impossible d’appliquer le filtre.', 'Erreur');
    return;
  }

  UI_STATE.snapshot = response.snapshot;
  setStatus('Filtre appliqué.', 'OK');
  renderAll();
}

async function setSearchText(text) {
  const response = await requestBridge({
    type: 'CALCIUM_SET_SEARCH_TEXT_ON_ACTIVE_TAB',
    text
  });

  if (!response?.ok) {
    setStatus(response?.error || 'Impossible d’appliquer la recherche.', 'Erreur');
    return;
  }

  UI_STATE.snapshot = response.snapshot;
  renderAll();
}

async function refreshToken() {
  setStatus('Refresh token en cours…', 'Action');

  const response = await requestBridge({
    type: 'CALCIUM_REFRESH_TOKEN'
  });

  if (!response?.ok) {
    setStatus(response?.error || response?.message || 'Refresh impossible.', 'Erreur');
    return;
  }

  setStatus(response.message || 'Refresh terminé.', 'OK');
  await loadState();
}

function renderMainTabs() {
  const container = document.getElementById('calcium-main-tabs');
  if (!container) return;

  const tabs = getMainTabs();

  container.innerHTML = tabs.map(tab => `
    <button
      class="calcium-main-tab ${UI_STATE.activeMainTab === tab.id ? 'active' : ''}"
      type="button"
      data-main-tab="${escapeHtml(tab.id)}"
      title="${escapeHtml(tab.title || tab.label)}"
      aria-label="${escapeHtml(tab.title || tab.label)}"
    >
      ${escapeHtml(tab.label)}
    </button>
  `).join('');

  container.querySelectorAll('[data-main-tab]').forEach(button => {
    button.addEventListener('click', () => {
      setActiveMainTab(button.dataset.mainTab);
    });
  });
}

function setActiveMainTab(tabId) {
  const visibleTabs = getMainTabs().map(tab => tab.id);

  UI_STATE.activeMainTab = visibleTabs.includes(tabId)
    ? tabId
    : (visibleTabs[0] || 'joueur');

  document.querySelectorAll('.calcium-tab-panel').forEach(panel => {
    panel.classList.toggle(
      'active',
      panel.dataset.panel === UI_STATE.activeMainTab
    );
  });

  renderMainTabs();

  if (UI_STATE.activeMainTab === 'joueur') {
    renderPlayerPanel();
  } else if (UI_STATE.activeMainTab === 'datas') {
    rebuildCategoryOptions();
    refreshSelectedDataView();
  } else if (UI_STATE.activeMainTab === 'alliance') {
    renderAlliancePanel();
  } else if (UI_STATE.activeMainTab === 'calcium') {
    renderCalciumPanel();
  } else if (UI_STATE.activeMainTab === 'configuration') {
      const panel = document.getElementById('calcium-configuration-panel');

      renderConfigurationPanel();

      bindConfigurationEvents(panel, () => {
        syncStaticUiVisibility();
        renderMainTabs();
        renderConfigurationPanel();

        const refreshedPanel = document.getElementById('calcium-configuration-panel');
        if (refreshedPanel) {
          refreshedPanel.dataset.configurationBound = 'false';
          bindConfigurationEvents(refreshedPanel, () => {
            syncStaticUiVisibility();
            renderMainTabs();
            renderConfigurationPanel();
          });
        }
      });
    }
}

function setActivePlayerSubTab(tabId) {
  UI_STATE.activePlayerSubTab = tabId;
  renderPlayerPanel();
}

function buildSearchSummaryHtml(summary) {
  if (!summary?.term) {
    return `
      <div class="calcium-search-line">
        Recherche globale inactive.
      </div>
    `;
  }

  if (!summary.totalCategories) {
    return `
      <div class="calcium-search-line">
        Aucun résultat pour <strong>${escapeHtml(summary.term)}</strong>.
      </div>
    `;
  }

  const itemsHtml = (summary.summary || []).map(item => `
    <div class="calcium-search-chip">
      <span class="calcium-search-chip-name">${escapeHtml(item.category)}</span>
      <span class="calcium-search-chip-count">${item.matchCount}</span>
    </div>
  `).join('');

  return `
    <div class="calcium-search-line">
      Trouvé <strong>${summary.totalObjects}</strong> objet(s) dans <strong>${summary.totalCategories}</strong> catégorie(s).
    </div>
    <div class="calcium-search-found-in">
      ${itemsHtml}
    </div>
  `;
}

function rebuildCategoryOptions() {
  const snapshot = UI_STATE.snapshot;
  const selectEl = document.getElementById('ext-data-select');
  const countEl = document.getElementById('ext-data-count');
  const emptyEl = document.getElementById('ext-empty-state');
  const summaryEl = document.getElementById('ext-search-summary');
  const searchInput = document.getElementById('ext-search-input');

  if (!selectEl) return;

  const previous = selectEl.value;
  const visible = snapshot?.visibleCategories || [];
  const extra = Object.keys(snapshot?.requestsByCategory || {});
  const categories = Array.from(new Set([...visible, ...extra])).sort();

  selectEl.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = categories.length
    ? '-- Choisir une catégorie trouvée --'
    : '-- Aucune catégorie trouvée --';
  selectEl.appendChild(placeholder);

  categories.forEach(category => {
    const payload = snapshot?.filteredByCategory?.[category] || [];
    const requests = snapshot?.requestsByCategory?.[category] || 0;
    const option = document.createElement('option');
    option.value = category;
    option.textContent = `${category} (${payload.length} match / ${requests} req)`;
    selectEl.appendChild(option);
  });

  if (categories.includes(previous)) {
    selectEl.value = previous;
  } else if (categories.length === 1) {
    selectEl.value = categories[0];
  }

  countEl.innerText = `${categories.length} type(s)`;
  emptyEl.style.display = categories.length ? 'none' : 'block';
  summaryEl.innerHTML = buildSearchSummaryHtml(snapshot?.searchSummary || {});
  searchInput.value = snapshot?.searchSummary?.term || '';

  const currentFilter = snapshot?.state?.currentFilter || 'all';
  document.querySelectorAll('.ext-filter-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.filter === currentFilter);
  });

  refreshSelectedDataView();
}

function refreshSelectedDataView() {
  const snapshot = UI_STATE.snapshot;
  const selectEl = document.getElementById('ext-data-select');
  const viewEl = document.getElementById('ext-data-view');
  const metaEl = document.getElementById('ext-selection-meta');

  if (!selectEl || !viewEl || !metaEl) return;

  const selected = selectEl.value;

  if (!selected) {
    viewEl.style.display = 'none';
    viewEl.innerHTML = '';
    metaEl.innerText = '';
    return;
  }

  const payload = snapshot?.filteredByCategory?.[selected] || [];
  const requests = snapshot?.requestsByCategory?.[selected] || 0;
  const requestMeta = snapshot?.requestMetaByCategory?.[selected] || [];

  metaEl.innerText =
    `${payload.length} objet(s) visible(s) dans ${selected} • ${requests} requête(s) capturée(s) • ${requestMeta.length} méta(s)`;

  if (!payload.length && !requestMeta.length) {
    viewEl.style.display = 'none';
    viewEl.innerHTML = '';
    return;
  }

  const responseJson = JSON.stringify(payload, null, 2);
  const requestJson = JSON.stringify(requestMeta, null, 2);

  viewEl.style.display = 'block';
  viewEl.innerHTML = `
    <div class="calcium-json-block">
      <div class="calcium-json-title">Réponse JSON</div>
      <pre class="calcium-json-pre"><code>${escapeHtml(responseJson)}</code></pre>
    </div>
    <div class="calcium-json-block">
      <div class="calcium-json-title">Métadonnées requête</div>
      <pre class="calcium-json-pre"><code>${escapeHtml(requestJson)}</code></pre>
    </div>
  `;
}

async function callApi(path, { method = 'GET', json, headers } = {}) {
  return requestBridge({
    type: 'CALCIUM_API_REQUEST',
    path,
    method,
    json,
    headers
  });
}

export {
  escapeHtml, formatValue, formatDuration, formatCompactNumber, getRemainingSeconds,
  setStatus, requestBridge, connectLiveUpdates, formatBooleanBadge, formatAllianceGrade,
  formatCoordinates, getLabelTrans, loadState, setFilter, setSearchText, refreshToken,
  renderMainTabs, setActiveMainTab, setActivePlayerSubTab, buildSearchSummaryHtml,
  rebuildCategoryOptions, refreshSelectedDataView
};
