const UI_STATE = {
  showResources : {
    food: true,
    lumber: true,
    metal: true,
    stone: true,
    blue_energy: true,
    gold: true,
    soulc: false,
    ruby: false,
    population: false,
    talisman: false,
    elixir: true,
    fangtooth: false,
    glowing_mandrake: false
  },
  cities: [
    { id: 'city' },
    { id: 'water_outpost' },
    { id: 'stone_outpost' }
  ],
  activeMainTab: 'joueur',
  activePlayerSubTab: 'general',
  activeAllianceSubTab: 'general',
  activeItemCategory: 'all',
  activeBuildingSettlement: "all",
  showTopHeaderPanel: true,
  showPlayerSummary: true,
  showDataTab: true,
  showAllianceTab: true,
  snapshot: null,
  countdownInterval: null,
  port: null,
  handledFinishedActions: new Set()
};

function getMainTabs() {
  return [
    { id: 'datas', label: 'Datas', visible: UI_STATE.showDataTab },
    { id: 'joueur', label: 'Joueur', visible: true },
    { id: 'alliance', label: 'Alliance', visible: UI_STATE.showAllianceTab }
  ].filter(tab => tab.visible);
}

function syncStaticUiVisibility() {
  const headerEl = document.querySelector('.calcium-header');

  if (headerEl) {
    headerEl.classList.toggle('calcium-hidden', !UI_STATE.showTopHeaderPanel);
  }
}

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

  const parts = [];

  if (days > 0) parts.push(`${days} jr`);
  if (hours > 0) parts.push(`${hours} hr`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs} s`);

  return parts.join(' ');
}

function formatCompactNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';

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

  const rounded = Math.round(shortValue * 10) / 10;
  const display = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1);

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
  const dict = window.CalciumI18n?.[lang]?.[type] ?? {};
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
      data-main-tab="${tab.id}"
    >
      ${tab.label}
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

function normalizeItemCategory(category) {
  return String(category || '').trim();
}

function formatItemCategoryLabel(category) {
  if (category === 'all') {
    return 'Tous';
  }

  const translated = getLabelTrans(category.toLowerCase(), 'item_category');
  if (translated && translated !== category) {
    return translated;
  }

  return String(category)
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getVisiblePlayerItems(calcium) {
  const itemDefinitions = Array.isArray(calcium?.Data?.Item)
    ? calcium.Data.Item
    : [];

  const playerItems = Array.isArray(calcium?.Data?.Player?.items)
    ? calcium.Data.Player.items
    : [];

  const playerItemsByDefinitionId = Object.fromEntries(
    playerItems
      .filter((item) => item?.definitionId)
      .map((item) => [item.definitionId, item])
  );

  return itemDefinitions
    .filter((itemDef) => (playerItemsByDefinitionId[itemDef?.id]?.count ?? 0) > 0)
    .map((itemDef) => ({
      itemDef,
      playerItem: playerItemsByDefinitionId[itemDef.id] || null,
      category: normalizeItemCategory(itemDef?.category)
    }));
}

function getAvailableItemCategories(calcium) {
  const categories = Array.from(
    new Set(
      (calcium?.Data?.Item || [])
        .map(item => normalizeItemCategory(item?.category))
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  return ['all', ...categories];
}

function ensureValidActiveItemCategory(calcium) {
  const availableCategories = getAvailableItemCategories(calcium);

  if (!availableCategories.includes(UI_STATE.activeItemCategory)) {
    UI_STATE.activeItemCategory = 'all';
  }
}

function setActiveItemCategory(category) {
  UI_STATE.activeItemCategory = normalizeItemCategory(category || 'all') || 'all';

  document.querySelectorAll('.calcium-item-subtab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.itemCategory === UI_STATE.activeItemCategory);
  });

  renderPlayerPanel();
}

function buildItemCategoryTabs(calcium) {
  const categories = getAvailableItemCategories(calcium);

  if (categories.length <= 1) {
    return '';
  }

  return `
    <div class="calcium-item-subtabs">
      ${categories.map((category) => `
        <button
          class="calcium-item-subtab ${UI_STATE.activeItemCategory === category ? 'active' : ''}"
          type="button"
          data-item-category="${escapeHtml(category)}"
        >
          ${escapeHtml(formatItemCategoryLabel(category))}
        </button>
      `).join('')}
    </div>
  `;
}

function buildItemBloc(calcium) {
  ensureValidActiveItemCategory(calcium);

  const visibleItems = getVisiblePlayerItems(calcium);
  const activeCategory = UI_STATE.activeItemCategory || 'all';

  const filteredItems = visibleItems.filter(({ category }) => {
    return activeCategory === 'all' || category === activeCategory;
  });

  const itemsHtml = filteredItems.length
    ? filteredItems
        .slice()
        .sort((a, b) => String(a?.itemDef?.id || '').localeCompare(String(b?.itemDef?.id || '')))
        .map(({ itemDef, playerItem }) => {
          const itemLabel = escapeHtml(
            getLabelTrans(itemDef?.id, 'item') || formatValue(itemDef?.id, '—')
          );
          const itemCount = escapeHtml(
            formatCompactNumber(playerItem?.count ?? 0)
          );

          return `
            <div class="calcium-item-card">
              <span class="calcium-item-label">${itemLabel}</span>
              <span class="calcium-item-count">${itemCount}</span>
            </div>
          `;
        }).join('')
    : `<div class="calcium-resource-empty">Aucun item dans cette catégorie</div>`;

  return `
    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Items</div>
      ${buildItemCategoryTabs(calcium)}
      <div class="calcium-item-grid">
        ${itemsHtml}
      </div>
    </div>
  `;
}

function buildResourcesBlock(calcium) {
  const resources = Array.isArray(calcium?.Data?.Player?.resource)
    ? calcium.Data.Player.resource
    : [];

  const visibleResources = resources.filter(
    (resource) => UI_STATE.showResources[resource?.type] === true
  );

  const storageVaultPlayer = (calcium?.Data?.Player?.building || []).find(
    (building) => building?.definitionId === 'storage_vault'
  );

  const storageVaultLevel = storageVaultPlayer?.level ?? null;

  const storageVaultDefinition = (calcium?.Data?.Buildings || []).find(
    (building) => building?.id === 'storage_vault'
  );

  const storageVaultProtection =
    storageVaultDefinition?.metadata?.[String(storageVaultLevel)]?.protection ?? {};

  const resourcesHtml = visibleResources.length
    ? visibleResources.map((resource) => {
        const label = escapeHtml(getLabelTrans(resource?.type, 'resource'));
        const amount = escapeHtml(formatCompactNumber(Number(resource?.amount)));
        const resProtected = escapeHtml(
          formatCompactNumber(storageVaultProtection?.[resource?.type] ?? 0)
        );

        return `
          <div class="calcium-resource-card">
            <span class="calcium-resource-label">${label}</span>
            <div class="calcium-resource-values">
              <span class="calcium-resource-amount">${amount}</span>
              <span class="calcium-resource-pill">🔒 ${resProtected}</span>
            </div>
          </div>
        `;
      }).join('')
    : `<div class="calcium-resource-empty">Aucune ressource</div>`;

  return `
    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Ressources</div>
      <div class="calcium-resource-grid">
        ${resourcesHtml}
      </div>
    </div>
  `;
}

function buildActionsOverview(calcium) {
  const actions = Array.isArray(calcium?.Data?.Actions)
    ? calcium.Data.Actions.filter((a) => !a.finished)
    : [];

  if (!actions.length) {
    return `<div class="calcium-actions-empty">Aucune action en cours</div>`;
  }

  const ENTITY_META = {
    'App\\Entity\\Building': { label: getLabelTrans('building', 'general'), badgeClass: 'badge-building', order: 1 },
    'App\\Entity\\Research': { label: getLabelTrans('research', 'general'), badgeClass: 'badge-research', order: 2 },
    'App\\Entity\\Troop': { label: getLabelTrans('troop', 'general'), badgeClass: 'badge-troop', order: 3 },
    'App\\Entity\\Battle': { label: getLabelTrans('battle', 'general'), badgeClass: 'badge-battle', order: 4 },
  };

  function getActionTitle(action) {
    const meta = action.metadata || {};
    const entity = action.entity || '';

    if (entity.includes('Troop')) {
      const label = getLabelTrans(meta.troop_definition_id, 'troop')
        || meta.troop_definition_id
        || 'Troupe inconnue';
      const amount = meta.amount ? ` × ${formatCompactNumber(meta.amount)}` : '';
      return `${escapeHtml(label)}${escapeHtml(amount)}`;
    }

    if (entity.includes('Research')) {
      const searchP = (calcium?.Data?.Player?.search || [])
        .find((s) => s.uuid === meta.research_uuid);
      const label = getLabelTrans(searchP?.definitionId, 'research')
        || meta.research_uuid
        || 'Recherche inconnue';
      const levels = searchP ? ` ${searchP.level} → ${searchP.level + 1}` : '';
      return `${escapeHtml(label)}${escapeHtml(levels)}`;
    }

    if (entity.includes('Building')) {
      const building = (calcium?.Data?.Player?.building || [])
        .find((b) => b.uuid === meta.building_uuid);
      const label = building?.label || meta.building_uuid || 'Bâtiment inconnu';
      const levels = building ? ` ${building.level} → ${building.level + 1}` : '';
      return `${escapeHtml(label)}${escapeHtml(levels)}`;
    }

    if (entity.includes('Battle')) {
      const marchType = meta.march_type || 'battle';
      const coord = meta.target_cell?.coordinate;
      const coordText = coord ? ` (${coord.x}, ${coord.y})` : '';
      const targetName = meta.target_name || meta.march_type || 'cible inconnue';
      return `${escapeHtml(getLabelTrans(marchType, 'march') || marchType)} → ${escapeHtml(targetName)}${escapeHtml(coordText)}`;
    }

    return escapeHtml(entity.split('\\').pop() || 'Action inconnue');
  }

  const sorted = [...actions].sort((a, b) => {
    const orderA = ENTITY_META[a.entity]?.order ?? 999;
    const orderB = ENTITY_META[b.entity]?.order ?? 999;

    if (orderA !== orderB) {
      return orderA - orderB;
    }

    return getRemainingSeconds(a) - getRemainingSeconds(b);
  });

  const rows = sorted.map((action) => {
    const entityInfo = ENTITY_META[action.entity] || {
      label: action.entity?.split('\\').pop() || '?',
      badgeClass: 'badge-default',
      order: 999
    };

    const title = getActionTitle(action);
    const remaining = formatDuration(getRemainingSeconds(action));

    return `
      <div class="calcium-action-overview-row">
        <div class="calcium-action-overview-top">
          <span class="calcium-action-overview-badge ${escapeHtml(entityInfo.badgeClass)}">
            ${escapeHtml(entityInfo.label.charAt(0))}
          </span>
          <span class="calcium-action-overview-title" title="${title}">
            ${title}
          </span>
          <span
            class="calcium-action-overview-timer"
            data-end-at="${escapeHtml(formatValue(action.endAt, ''))}"
            data-finished="${String(!!action.finished)}"
            data-remaining-time="${Number(action.remainingTime || 0)}"
          >
            ${escapeHtml(remaining)}
          </span>
        </div>
        <div class="calcium-action-overview-bottom"></div>
      </div>
    `;
  }).join('');

  return `<div class="calcium-action-overview-list">${rows}</div>`;
}

function renderPlayerGeneralTab(calcium) {
  const username = escapeHtml(formatValue(calcium?.Data?.Player?.username));
  const level = formatValue(calcium?.Data?.Player?.level, '0');
  const power = formatValue(calcium?.Data?.Player?.power, '0');
  const realmName = escapeHtml(formatValue(calcium?.Data?.Realm?.name));

  return `
    <div class="calcium-player-hero">
      <div class="calcium-player-title-realm">Royaume : ${realmName}</div>
      <div class="calcium-player-title-sub">
        ${username} - ${getLabelTrans('level')} ${level} - ${getLabelTrans('power')} ${power}
      </div>
    </div>

    ${buildResourcesBlock(calcium)}
    ${buildItemBloc(calcium)}

    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Actions en cours</div>
      ${buildActionsOverview(calcium)}
    </div>

    ${UI_STATE.showPlayerSummary ? `
      <div class="calcium-player-section">
        <div class="calcium-player-subtitle">Résumé</div>
        <div class="calcium-table-wrap">
          <table class="calcium-table">
            <tbody>
              <tr>
                <th scope="row">Account UUID</th>
                <td><code>${escapeHtml(formatValue(calcium?.guid?.account))}</code></td>
              </tr>
              <tr>
                <th scope="row">Player UUID</th>
                <td><code>${escapeHtml(formatValue(calcium?.guid?.player))}</code></td>
              </tr>
              <tr>
                <th scope="row">Realm UUID</th>
                <td><code>${escapeHtml(formatValue(calcium?.guid?.realm))}</code></td>
              </tr>
              <tr>
                <th scope="row">Alliance UUID</th>
                <td><code>${escapeHtml(formatValue(calcium?.guid?.alliance))}</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}
  `;
}

function renderPlayerTroopsTab(calcium) {
  const troopDefinitions = Array.isArray(calcium?.Data?.Troop)
    ? calcium.Data.Troop
    : [];

  const playerTroops = Array.isArray(calcium?.Data?.Player?.troop)
    ? calcium.Data.Player.troop
    : [];

  const playerTroopsByDefinitionId = Object.fromEntries(
    playerTroops
      .filter((troop) => troop?.definitionId)
      .map((troop) => [troop.definitionId, troop])
  );

  const troopsHtml = troopDefinitions.length
    ? troopDefinitions
        .filter((troopDef) => troopDef?.is_dragon !== true)
        .slice()
        .sort((a, b) => Number(a?.order ?? 0) - Number(b?.order ?? 0))
        .map((troopDef) => {
          const playerTroop = playerTroopsByDefinitionId[troopDef?.id] || null;
          const troopLabel = escapeHtml(getLabelTrans(troopDef?.id, 'troop'));
          const troopAmount = escapeHtml(formatCompactNumber(playerTroop?.amount ?? 0));
          const troopPower = escapeHtml(formatValue(troopDef?.stats?.['1']?.power, '0'));

          return `
            <tr>
              <td>
                <div class="calcium-building-cell">
                  <div>
                    ${troopDef?.available
                      ? `<span class="calcium-building-indicator" title="Troupe disponible"></span>`
                      : `<span class="calcium-building-indicator is-idle" title="Troupe indisponible"></span>`
                    }
                    <span class="calcium-building-name">${troopLabel}</span>
                  </div>
                </div>
              </td>
              <td><span class="calcium-building-meta">${troopPower}</span></td>
              <td>${troopAmount}</td>
            </tr>
          `;
        }).join('')
    : `
      <tr>
        <td colspan="3" class="calcium-cell-empty">Aucune troupe disponible</td>
      </tr>
    `;

  return `
    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Actions de formation</div>
      ${buildTroopActionsSummary()}
    </div>

    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Troupes</div>
      <div class="calcium-table-wrap">
        <table class="calcium-table">
          <thead>
            <tr>
              <th scope="col">${getLabelTrans('troop')}</th>
              <th scope="col">${getLabelTrans('power')}</th>
              <th scope="col">${getLabelTrans('quantity')}</th>
            </tr>
          </thead>
          <tbody>
            ${troopsHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function buildBuildingsRows() {
  const groupedBuildings = UI_STATE.snapshot?.derived?.groupedBuildings || [];

  if (!groupedBuildings.length) {
    return `
      <tr>
        <td colspan="3" class="calcium-cell-empty">Aucun bâtiment</td>
      </tr>
    `;
  }

  return groupedBuildings.map(group => {
    const buildingLabel = group.definitionId || 'unknown';
    const displayLabel = UI_STATE.snapshot?.calcium?.Data?.Player.building?.find(
      b => b.definitionId === group.definitionId
    )?.label || buildingLabel;

    const levelRange = group.minLevel === group.maxLevel
      ? `Niv. ${group.minLevel}`
      : `Niv. ${group.minLevel} à ${group.maxLevel}`;

    return `
      <tr>
        <td>
          <div class="calcium-building-cell">
            <div>
              ${group.hasAction
                ? `<span class="calcium-building-indicator" title="Au moins un bâtiment de ce type est en construction"></span>`
                : `<span class="calcium-building-indicator is-idle"></span>`
              }
              <span class="calcium-building-name">${escapeHtml(displayLabel)}</span>
              <span class="calcium-building-meta">${levelRange}</span>
            </div>
          </div>
        </td>
        <td>
          ${group.hasAction
            ? `<span class="calcium-building-group-status is-active">En construction</span>`
            : `<span class="calcium-building-group-status">Stable</span>`
          }
        </td>
      </tr>
    `;
  }).join('');
}

function buildSearchRows() {
  const playerSearch = UI_STATE.snapshot?.calcium?.Data?.Player?.search || [];

  return playerSearch.map(search => {
    const displayLabel = getLabelTrans(search.definitionId, 'research');
    const levelRange = search.level;

    return `
      <tr>
        <td>
          <div class="calcium-building-cell">
            <div>
              ${search.status === 'searching'
                ? `<span class="calcium-building-indicator" title="Recherche en cours"></span>`
                : `<span class="calcium-building-indicator is-idle"></span>`
              }
              <span class="calcium-building-name">${escapeHtml(displayLabel)}</span>
              <span class="calcium-building-meta">${levelRange}</span>
            </div>
          </div>
        </td>
        <td>
          ${search.status === 'searching'
            ? `<span class="calcium-building-group-status is-active">En recherche</span>`
            : `<span class="calcium-building-group-status">Stable</span>`
          }
        </td>
      </tr>
    `;
  }).join('');
}

function buildSearchActionsSummary() {
  const actions = [...(UI_STATE.snapshot?.derived?.searchActions || [])]
    .filter(action => !action.finished)
    .sort((a, b) => getRemainingSeconds(a) - getRemainingSeconds(b));

  if (!actions.length) {
    return `<div class="calcium-actions-empty">Aucune action de recherche en cours</div>`;
  }

  return `
    <div class="calcium-actions-list">
      ${actions.map(action => {
        const searchUuid = action.metadata?.research_uuid;
        const searchP = (UI_STATE.snapshot?.calcium?.Data?.Player?.search || []).find(
          b => b.uuid === String(searchUuid)
        );

        const definitionId = action.metadata?.definitionId || searchP?.definitionId;
        const searchName = getLabelTrans(definitionId, 'research') || 'Recherche inconnue';

        const remaining = formatDuration(getRemainingSeconds(action));

        const currentLevel = Number(
          action.metadata?.currentLevel ??
          searchP?.level ??
          0
        );

        const targetLevel = Number(
          action.metadata?.targetLevel ??
          (currentLevel + 1)
        );

        return `
          <div class="calcium-action-item" data-action-uuid="${escapeHtml(action.uuid)}">
            <div class="calcium-action-main">
              <span class="calcium-action-badge"></span>
              <span class="calcium-action-title">${escapeHtml(searchName)} ${currentLevel} -> ${targetLevel}</span>
              <span
                class="calcium-action-timer"
                data-end-at="${escapeHtml(formatValue(action.endAt, ''))}"
                data-finished="${String(!!action.finished)}"
                data-remaining-time="${Number(action.remainingTime || 0)}"
              >
                ${escapeHtml(remaining)}
              </span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function buildBuildingActionsSummary() {
  const actions = [...(UI_STATE.snapshot?.derived?.buildingActions || [])]
    .filter(action => !action.finished)
    .sort((a, b) => getRemainingSeconds(a) - getRemainingSeconds(b));

  if (!actions.length) {
    return `<div class="calcium-actions-empty">Aucune action de bâtiment en cours</div>`;
  }

  return `
    <div class="calcium-actions-list">
      ${actions.map(action => {
        const buildingUuid = action.metadata?.building_uuid;
        const building = (UI_STATE.snapshot?.calcium?.Data?.Player?.building || []).find(
          b => b.uuid === String(buildingUuid)
        );
        const buildingName = building?.label || 'Bâtiment inconnu';
        const remaining = formatDuration(getRemainingSeconds(action));
        const currentLevel = Number(building?.level ?? 0);

        return `
          <div class="calcium-action-item" data-action-uuid="${escapeHtml(action.uuid)}">
            <div class="calcium-action-main">
              <span class="calcium-action-badge"></span>
              <span class="calcium-action-title">${escapeHtml(buildingName)} ${currentLevel} -> ${currentLevel + 1}</span>
              <span
                class="calcium-action-timer"
                data-end-at="${escapeHtml(formatValue(action.endAt, ''))}"
                data-finished="${String(!!action.finished)}"
                data-remaining-time="${Number(action.remainingTime || 0)}"
              >
                ${escapeHtml(remaining)}
              </span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function getPlayerSettlements() {
  return Array.isArray(UI_STATE.snapshot?.calcium?.Data?.Player?.settlements)
    ? UI_STATE.snapshot.calcium.Data.Player.settlements
    : [];
}

function getBuildingsBySettlement() {
  const buildings = Array.isArray(UI_STATE.snapshot?.calcium?.Data?.Player?.building)
    ? UI_STATE.snapshot.calcium.Data.Player.building
    : [];

  const settlements = getPlayerSettlements();

  const settlementsByApiId = Object.fromEntries(
    settlements.map(settlement => [settlement?.["@id"], settlement])
  );

  const grouped = buildings.reduce((acc, building) => {
    const settlementApiId = building?.settlement || "__unknown__";
    if (!acc[settlementApiId]) {
      acc[settlementApiId] = [];
    }
    acc[settlementApiId].push(building);
    return acc;
  }, {});

  return Object.entries(grouped).map(([settlementApiId, settlementBuildings]) => {
    const settlement = settlementsByApiId[settlementApiId] || null;

    return {
      settlementApiId,
      settlement,
      label: settlement?.name || "Inconnue",
      buildings: settlementBuildings
    };
  }).sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

function ensureValidActiveBuildingSettlement() {
  const groups = getBuildingsBySettlement();
  const validIds = groups.map(group => group.settlementApiId);

  if (!validIds.includes(UI_STATE.activeBuildingSettlement)) {
    UI_STATE.activeBuildingSettlement = validIds[0] || "all";
  }
}

function setActiveBuildingSettlement(settlementApiId) {
  UI_STATE.activeBuildingSettlement = settlementApiId;
  renderPlayerPanel();
}

function buildBuildingSettlementTabs() {
  const groups = getBuildingsBySettlement();

  if (!groups.length) return "";

  return `
    <div class="calcium-player-subtabs calcium-building-settlement-tabs">
      ${groups.map(group => `
        <button
          class="calcium-player-subtab calcium-building-settlement-tab ${UI_STATE.activeBuildingSettlement === group.settlementApiId ? "active" : ""}"
          data-building-settlement="${escapeHtml(group.settlementApiId)}"
          type="button"
        >
          ${escapeHtml(group.label)}
        </button>
      `).join("")}
    </div>
  `;
}

function buildGroupedBuildingsRowsBySettlement() {
  ensureValidActiveBuildingSettlement();

  const groups = getBuildingsBySettlement();
  const activeGroup = groups.find(
    group => group.settlementApiId === UI_STATE.activeBuildingSettlement
  );

  const buildings = Array.isArray(activeGroup?.buildings) ? activeGroup.buildings : [];

  if (!buildings.length) {
    return `
      <tr>
        <td colspan="2" class="calcium-cell-empty">Aucun bâtiment</td>
      </tr>
    `;
  }

  const groupedByDefinition = buildings.reduce((acc, building) => {
    const key = building?.definitionId || "unknown";
    const level = Number(building?.level || 0);

    if (!acc[key]) {
      acc[key] = {
        definitionId: key,
        label: building?.label || key,
        count: 0,
        minLevel: level,
        maxLevel: level,
        hasAction: false
      };
    }

    acc[key].count += 1;
    acc[key].minLevel = Math.min(acc[key].minLevel, level);
    acc[key].maxLevel = Math.max(acc[key].maxLevel, level);

    const buildingAction = (UI_STATE.snapshot?.derived?.buildingActions || []).find(action => {
      if (action?.finished) return false;

      return (
        action?.metadata?.building_uuid === building.uuid ||
        action?.metadata?.buildingUuid === building.uuid
      );
    });

    if (buildingAction) {
      acc[key].hasAction = true;
    }

    return acc;
  }, {});

  const rows = Object.values(groupedByDefinition)
    .sort((a, b) => String(a.label).localeCompare(String(b.label)))
    .map((group) => {
      const levelLabel = group.minLevel === group.maxLevel
        ? `Niv. ${group.minLevel}`
        : `Niv. ${group.minLevel} à ${group.maxLevel}`;

      return `
        <tr>
          <td>
            <div class="calcium-building-cell">
              <div>
                ${group.hasAction
                  ? '<span class="calcium-building-indicator" title="Au moins un bâtiment de ce type est en construction"></span>'
                  : '<span class="calcium-building-indicator is-idle"></span>'}
                <span class="calcium-building-name">${escapeHtml(group.label)}</span>
                <span class="calcium-building-meta">${escapeHtml(levelLabel)}</span>
              </div>
            </div>
          </td>
          <td>
            ${group.hasAction
              ? '<span class="calcium-building-group-status is-active">En construction</span>'
              : '<span class="calcium-building-group-status">Stable</span>'}
          </td>
        </tr>
      `;
    })
    .join("");

  return rows;
}

function buildTroopActionsSummary() {
  const actions = [...(UI_STATE.snapshot?.derived?.troopActions || [])]
    .filter(action => !action.finished)
    .sort((a, b) => getRemainingSeconds(a) - getRemainingSeconds(b));

  if (!actions.length) {
    return `<div class="calcium-actions-empty">Rien dans la file d'attente</div>`;
  }

  return `
    <div class="calcium-actions-list">
      ${actions.map(action => {
        const troopP = (UI_STATE.snapshot?.calcium?.Data?.Player?.troop || []).find(
          b => b.uuid === String(action.metadata?.troop_uuid)
        );
        const troopName = getLabelTrans(troopP?.definitionId, 'troop') || 'Troupe inconnue';
        const remaining = formatDuration(getRemainingSeconds(action));

        return `
          <div class="calcium-action-item" data-action-uuid="${escapeHtml(action.uuid)}">
            <div class="calcium-action-main">
              <span class="calcium-action-badge"></span>
              <span class="calcium-action-title">${escapeHtml(troopName)} x${escapeHtml(formatValue(action.metadata?.amount, '0'))}</span>
              <span
                class="calcium-action-timer"
                data-end-at="${escapeHtml(formatValue(action.endAt, ''))}"
                data-finished="${String(!!action.finished)}"
                data-remaining-time="${Number(action.remainingTime || 0)}"
              >
                ${escapeHtml(remaining)}
              </span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderPlayerBuildingsTab() {
  return `
    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Actions de bâtiments</div>
      ${buildBuildingActionsSummary()}
    </div>

    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Bâtiments par cité</div>
      ${buildBuildingSettlementTabs()}
      <div class="calcium-table-wrap">
        <table class="calcium-table">
          <thead>
            <tr>
              <th scope="col">Bâtiment</th>
              <th scope="col">Statut</th>
            </tr>
          </thead>
          <tbody>
            ${buildGroupedBuildingsRowsBySettlement()}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderPlayerSearchTab() {
  return `
    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Action de recherche</div>
      ${buildSearchActionsSummary()}
    </div>

    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Recherche</div>
      <div class="calcium-table-wrap">
        <table class="calcium-table">
          <thead>
            <tr>
              <th scope="col">Recherche</th>
              <th scope="col">Statut</th>
            </tr>
          </thead>
          <tbody>
            ${buildSearchRows()}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function getQuestDefinitions() {
  const calcium = UI_STATE.snapshot?.calcium?.Data || {};

  return (
    calcium.QuestDefinitions ||
    calcium.QuestsDefinitions ||
    calcium.QuestDefinition ||
    calcium.Quest ||
    []
  );
}

function getPlayerQuests() {
  const calcium = UI_STATE.snapshot?.calcium?.Data || {};
  const player = calcium.Player || {};

  return (
    player.quests ||
    player.Quests ||
    calcium.PlayerQuests ||
    calcium.Quests ||
    []
  );
}

function getQuestLabel(definitionId, definition) {
  if (definition?.name) return String(definition.name);
  return String(definitionId || 'Quête inconnue');
}

function formatQuestCategoryLabel(category) {
  const value = String(category || 'other');
  const labels = getLabelTrans(category, 'quest_category');
  return labels;
}

function getQuestDisplayStatus(quest) {
  if (quest?.status === 'completed' && quest?.claimed === false) {
    return { label: 'À réclamer', tone: 'claimable' };
  }

  if (quest?.status === 'completed' && quest?.claimed === true) {
    return { label: 'Réclamée', tone: 'claimed' };
  }

  return { label: 'En cours', tone: 'progress' };
}

function formatQuestReward(reward) {
  if (!reward || typeof reward !== 'object') return '-';

  const parts = [];

  if (reward.resources && typeof reward.resources === 'object') {
    const resourceText = Object.entries(reward.resources)
      .map(([key, value]) => `${key}: ${formatCompactNumber(value)}`)
      .join(', ');

    if (resourceText) parts.push(resourceText);
  }

  if (reward.quests && typeof reward.quests === 'object') {
    const questText = Object.entries(reward.quests)
      .map(([key, value]) => `${key} → ${value}`)
      .join(', ');

    if (questText) parts.push(`Quête: ${questText}`);
  }

  return parts.join(' • ') || '-';
}

function formatQuestRequirements(requirements) {
  if (!requirements || typeof requirements !== 'object') return '-';

  const parts = [];

  if (requirements.buildings && typeof requirements.buildings === 'object') {
    const buildingsText = Object.entries(requirements.buildings)
      .map(([key, value]) => `${key} ${value}`)
      .join(', ');

    if (buildingsText) parts.push(`Bâtiments: ${buildingsText}`);
  }

  if (requirements.quests && typeof requirements.quests === 'object') {
    const questsText = Object.entries(requirements.quests)
      .map(([key, value]) => `${key} ${value}`)
      .join(', ');

    if (questsText) parts.push(`Quêtes: ${questsText}`);
  }

  return parts.join(' • ') || '-';
}

function getEnrichedPlayerQuests() {
  const definitions = getQuestDefinitions();
  const playerQuests = getPlayerQuests();

  const definitionById = new Map(
    definitions.map((def) => [String(def?.id || ''), def])
  );

  return playerQuests.map((quest) => {
    const definitionId = String(quest?.definitionId || '');
    const definition = definitionById.get(definitionId) || null;
    const level = Number(quest?.level || 0);
    const nextLevel = level + 1;
    const displayStatus = getQuestDisplayStatus(quest);

    const currentReward = definition?.rewards?.[String(level)] || null;
    const nextRequirements = definition?.requirements?.[String(nextLevel)] || null;

    return {
      ...quest,
      label: getQuestLabel(definitionId, definition),
      category: String(definition?.category || 'other'),
      currentReward,
      nextRequirements,
      rewardText: formatQuestReward(currentReward),
      requirementsText: formatQuestRequirements(nextRequirements),
      statusLabel: displayStatus.label,
      statusTone: displayStatus.tone
    };
  });
}

function buildQuestInfoButton(quest) {
  const lines = [];

  if (quest?.nextRequirements) {
    lines.push(`Prochain requis : ${quest.requirementsText || '-'}`);
  }

  if (quest?.currentReward) {
    lines.push(`Récompense : ${formatQuestReward(quest.currentReward)}`);
  }

  if (quest?.finishedAt) {
    lines.push(`Terminée : ${formatValue(quest.finishedAt)}`);
  }

  if (quest?.claimedAt) {
    lines.push(`Réclamée : ${formatValue(quest.claimedAt)}`);
  }

  if (quest?.scheduledQuest === true) {
    lines.push('Quête planifiée : oui');
  }

  if (!lines.length) {
    return `<span class="calcium-building-meta">-</span>`;
  }

  return `
    <button
      type="button"
      class="calcium-info-trigger"
      aria-label="Informations sur la quête ${escapeHtml(quest?.label || quest?.definitionId || 'inconnue')}"
    >
      i
      <span class="calcium-info-tooltip" role="tooltip">
        ${lines.map(line => `<span class="calcium-info-line">${escapeHtml(line)}</span>`).join('')}
      </span>
    </button>
  `;
}

function getGroupedPlayerQuests() {
  const quests = getEnrichedPlayerQuests();
  const groups = new Map();

  for (const quest of quests) {
    const key = quest.category || 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(quest);
  }

  return Array.from(groups.entries())
    .map(([category, items]) => {
      const sortedItems = [...items].sort((a, b) => {
        const score = (quest) => {
          if (quest?.status === 'completed' && quest?.claimed === false) return 0;
          if (quest?.status === 'in_progress') return 1;
          return 2;
        };

        return score(a) - score(b) || String(a.label || '').localeCompare(String(b.label || ''));
      });

      return {
        category,
        label: formatQuestCategoryLabel(category),
        items: sortedItems,
        total: sortedItems.length,
        claimable: sortedItems.filter(q => q.status === 'completed' && q.claimed === false).length,
        inProgress: sortedItems.filter(q => q.status === 'in_progress').length
      };
    })
    .sort((a, b) => {
      const score = (group) => {
        if (group.claimable > 0) return 0;
        if (group.inProgress > 0) return 1;
        return 2;
      };

      return score(a) - score(b) || a.label.localeCompare(b.label);
    });
}

function renderPlayerQuestsTab() {
  const groups = getGroupedPlayerQuests();

  return `
    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Quêtes par type</div>
      <div class="calcium-quest-groups">
        ${buildQuestGroupsAccordion(groups)}
      </div>
    </div>
  `;
}

function buildQuestGroupsAccordion(groups) {
  if (!groups.length) {
    return `<div class="calcium-actions-empty">Aucune quête disponible</div>`;
  }

  return groups.map((group, index) => `
    <details class="calcium-quest-group" ${index === 0 ? 'open' : ''}>
      <summary class="calcium-quest-group-summary">
        <span class="calcium-quest-group-title">${escapeHtml(group.label)}</span>
        <span class="calcium-quest-group-meta">
          ${escapeHtml(String(group.total))} quêtes
          ${group.claimable ? ` · ${escapeHtml(String(group.claimable))} à réclamer` : ''}
        </span>
      </summary>

      <div class="calcium-quest-group-content">
        <div class="calcium-table-wrap">
          <table class="calcium-table">
            <thead>
              <tr>
                <th scope="col">Quête</th>
                <th scope="col">Niv.</th>
                <th scope="col">Statut</th>
                <th scope="col">Infos</th>
              </tr>
            </thead>
            <tbody>
              ${buildQuestGroupRows(group.items)}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  `).join('');
}

function buildQuestGroupRows(items) {
  return items.map((quest) => `
    <tr>
      <td>${escapeHtml(quest.label || quest.definitionId || 'Quête inconnue')}</td>
      <td>${escapeHtml(String(quest.level ?? 0))}</td>
      <td>
        <span class="calcium-badge calcium-badge--${escapeHtml(quest.statusTone)}">
          ${escapeHtml(quest.statusLabel)}
        </span>
      </td>
      <td>${buildQuestInfoButton(quest)}</td>
    </tr>
  `).join('');
}

function renderPlayerPanel() {
  const panel = document.getElementById('calcium-player-panel');
  const calcium = UI_STATE.snapshot?.calcium;

  if (!panel) return;

  if (!calcium) {
    panel.innerHTML = `
      <div class="calcium-player-title">Joueur</div>
      <div class="calcium-player-text">En attente du parsing du dataset...</div>
    `;
    return;
  }

  let content = '';

  if (UI_STATE.activePlayerSubTab === 'general') {
    content = renderPlayerGeneralTab(calcium);
  } else if (UI_STATE.activePlayerSubTab === 'troupes') {
    content = renderPlayerTroopsTab(calcium);
  } else if (UI_STATE.activePlayerSubTab === 'batiments') {
    content = renderPlayerBuildingsTab();
  } else if (UI_STATE.activePlayerSubTab === 'recherche') {
    content = renderPlayerSearchTab();
  } else if (UI_STATE.activePlayerSubTab === 'quests') {
    content = renderPlayerQuestsTab();
  }

  panel.innerHTML = `
    ${buildPlayerHero()}
    ${content}
  `;

  panel.querySelectorAll('[data-player-subtab]').forEach(tab => {
    tab.addEventListener('click', () => {
      setActivePlayerSubTab(tab.dataset.playerSubtab);
    });
  });

  panel.querySelectorAll('.calcium-item-subtab').forEach(tab => {
    tab.addEventListener('click', () => {
      setActiveItemCategory(tab.dataset.itemCategory);
    });
  });

  panel.querySelectorAll("[data-building-settlement]").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveBuildingSettlement(button.dataset.buildingSettlement);
    });
  });
}

function renderAllianceOverview(alliance) {
  const name = escapeHtml(formatValue(alliance?.name));
  const rank = escapeHtml(formatValue(alliance?.rank));
  const masterUsername = escapeHtml(formatValue(alliance?.masterUsername));
  const totalPower = escapeHtml(formatCompactNumber(alliance?.total_power ?? 0));
  const memberCount = escapeHtml(formatValue(alliance?.memberCount, '0'));
  const createdAt = escapeHtml(formatValue(alliance?.createdAt));

  return `
    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Alliance</div>
      <div class="calcium-table-wrap">
        <table class="calcium-table">
          <tbody>
            <tr>
              <th scope="row">Nom</th>
              <td>${name}</td>
            </tr>
            <tr>
              <th scope="row">Rang</th>
              <td>${rank}</td>
            </tr>
            <tr>
              <th scope="row">Chef</th>
              <td>${masterUsername}</td>
            </tr>
            <tr>
              <th scope="row">Puissance totale</th>
              <td>${totalPower}</td>
            </tr>
            <tr>
              <th scope="row">Membres</th>
              <td>${memberCount}</td>
            </tr>
            <tr>
              <th scope="row">Créée le</th>
              <td>${createdAt}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function getGlobalTooltip() {
  return document.getElementById("calcium-global-tooltip");
}

function buildTooltipHtml(trigger) {
  const race = trigger.dataset.tooltipRace || "—";
  const city = trigger.dataset.tooltipCity || "—";
  const pve = trigger.dataset.tooltipPve || "0";
  const pvp = trigger.dataset.tooltipPvp || "0";
  const joined = trigger.dataset.tooltipJoined || "—";

  return `
    <span class="calcium-info-line">Race : ${race}</span>
    <span class="calcium-info-line">City : ${city}</span>
    <span class="calcium-info-line">PvE : ${pve}</span>
    <span class="calcium-info-line">PvP : ${pvp}</span>
    <span class="calcium-info-line">Entrée : ${joined}</span>
  `;
}

function positionTooltip(trigger, tooltip) {
  const rect = trigger.getBoundingClientRect();
  const spacing = 10;
  const viewportPadding = 8;

  tooltip.classList.add("is-visible");
  tooltip.style.left = "0px";
  tooltip.style.top = "0px";

  const tooltipRect = tooltip.getBoundingClientRect();

  let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
  let top = rect.top - tooltipRect.height - spacing;

  if (top < viewportPadding) {
    top = rect.bottom + spacing;
  }

  if (left < viewportPadding) {
    left = viewportPadding;
  }

  if (left + tooltipRect.width > window.innerWidth - viewportPadding) {
    left = window.innerWidth - tooltipRect.width - viewportPadding;
  }

  if (top + tooltipRect.height > window.innerHeight - viewportPadding) {
    top = Math.max(viewportPadding, rect.top - tooltipRect.height - spacing);
  }

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

function showGlobalTooltip(trigger) {
  const tooltip = getGlobalTooltip();
  if (!tooltip) return;

  tooltip.innerHTML = buildTooltipHtml(trigger);
  tooltip.setAttribute("aria-hidden", "false");
  tooltip.dataset.owner = "active";
  positionTooltip(trigger, tooltip);
}

function hideGlobalTooltip() {
  const tooltip = getGlobalTooltip();
  if (!tooltip) return;

  tooltip.classList.remove("is-visible");
  tooltip.setAttribute("aria-hidden", "true");
  tooltip.innerHTML = "";
  delete tooltip.dataset.owner;
}

function bindAllianceTooltips(scope = document) {
  scope.querySelectorAll(".calcium-info-trigger").forEach((button) => {
    button.addEventListener("mouseenter", () => {
      showGlobalTooltip(button);
    });

    button.addEventListener("focus", () => {
      showGlobalTooltip(button);
    });

    button.addEventListener("mouseleave", () => {
      hideGlobalTooltip();
    });

    button.addEventListener("blur", () => {
      hideGlobalTooltip();
    });

    button.addEventListener("click", (event) => {
      event.preventDefault();
      if (getGlobalTooltip()?.classList.contains("is-visible")) {
        hideGlobalTooltip();
      } else {
        showGlobalTooltip(button);
      }
    });
  });
}

function renderAllianceMembersTable(alliance) {
  const members = Array.isArray(alliance?.members) ? alliance.members : [];

  if (!members.length) {
    return `
      <div class="calcium-player-section">
        <div class="calcium-player-subtitle">Membres</div>
        <div class="calcium-actions-empty">Aucun membre disponible</div>
      </div>
    `;
  }

  const sortedMembers = [...members].sort((a, b) => {
    return Number(b?.player?.power || 0) - Number(a?.player?.power || 0);
  });

  const rows = sortedMembers.map((member) => {
    const player = member?.player || {};
    const username = escapeHtml(formatValue(player?.username));
    const power = escapeHtml(formatCompactNumber(player?.power ?? 0));
    const premium = formatBooleanBadge(!!player?.has_premium, 'Premium', 'Standard');
    const grade = escapeHtml(formatAllianceGrade(member?.grade));
    const dragonLevel = escapeHtml(formatValue(member?.dragon_level, '0'));
    const city = escapeHtml(formatCoordinates(member?.city_coordinates));

    const race = escapeHtml(formatValue(player?.race));
    const pvePower = escapeHtml(formatCompactNumber(player?.pvePower ?? 0));
    const pvpPower = escapeHtml(formatCompactNumber(player?.pvpPower ?? 0));
    const joinedAt = escapeHtml(formatValue(member?.joinedAt));
    const playerUuid = escapeHtml(formatValue(player?.uuid));
    const memberUuid = escapeHtml(formatValue(member?.uuid));

    return `
      <tr class="calcium-alliance-row">
        <td>
          <div class="calcium-building-cell">
            <div class="calcium-alliance-member-main">
              <div class="calcium-alliance-member-head">
                <span class="calcium-building-name">${username}</span>

                <button
                  type="button"
                  class="calcium-info-trigger"
                  aria-label="Informations sur ${username}"
                  data-tooltip-race="${escapeHtml(formatValue(race))}"
                  data-tooltip-city="${escapeHtml(formatValue(city))}"
                  data-tooltip-pve="${escapeHtml(formatCompactNumber(pvePower))}"
                  data-tooltip-pvp="${escapeHtml(formatCompactNumber(pvpPower))}"
                  data-tooltip-joined="${escapeHtml(formatValue(joinedAt))}"
                >
                  i
                </button>
              </div>
            </div>
          </div>
        </td>
        <td>${power}</td>
        <td>${premium}</td>
        <td>${grade}</td>
        <td>${dragonLevel}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Membres</div>
      <div class="calcium-table-wrap">
        <table class="calcium-table">
          <thead>
            <tr>
              <th scope="col">Nom</th>
              <th scope="col">Power</th>
              <th scope="col">Premium</th>
              <th scope="col">Grade</th>
              <th scope="col">Dragon</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderAlliancePanel() {
  const panel = document.getElementById("calcium-alliance-panel");
  const calcium = UI_STATE.snapshot?.calcium;
  const alliance = calcium?.Data?.Alliance;

  if (!panel) return;

  if (!alliance || !alliance.name) {
    panel.innerHTML = `
      <div class="calcium-player-title">Alliance</div>
      <div class="calcium-player-text">
        En attente du parsing du dataset alliance...
      </div>
    `;
    return;
  }

  panel.innerHTML = `
    ${renderAllianceOverview(alliance)}
    ${renderAllianceMembersTable(alliance)}
  `;

  bindAllianceTooltips(panel);
}

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
}

function init() {
  syncStaticUiVisibility();
  bindStaticEvents();
  renderMainTabs();
  connectLiveUpdates();
  setActiveMainTab(UI_STATE.activeMainTab || 'joueur');
  setActivePlayerSubTab(UI_STATE.activePlayerSubTab || 'general');
  loadState();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}