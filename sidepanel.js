const UI_STATE = {
  activeMainTab: 'datas',
  activePlayerSubTab: 'general',
  snapshot: null,
  countdownInterval: null,
  port: null
};

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
  if (UI_STATE.port) return;

  const port = chrome.runtime.connect({ name: 'calcium-sidepanel' });
  UI_STATE.port = port;

  port.onMessage.addListener((message) => {
    if (message?.type === 'CALCIUM_PANEL_READY_ACK') {
      return;
    }

    if (message?.type === 'CALCIUM_STATE_UPDATED') {
      console.log('[SIDEPANEL] live snapshot reçu', message.reason, Object.keys(message.snapshot?.requestsByCategory || {}));   
      UI_STATE.snapshot = message.snapshot;
      setStatus(`Mise à jour reçue (${message.reason || 'live'}).`, 'Live');
      renderAll();
    }
  });

  port.onDisconnect.addListener(() => {
    UI_STATE.port = null;
    setStatus('Canal live fermé. Reconnexion…', 'Info');
    window.setTimeout(connectLiveUpdates, 500);
  });

  port.postMessage({ type: 'CALCIUM_PANEL_READY' });
}

function getLabelTrans(str, type= 'general', lang = 'fr') {
  if (!str || !type) return str ?? '';
  const dict = window.CalciumI18n?.[lang]?.[type] ?? {};
  return dict[str] ?? str;
}

async function loadState() {
  setStatus('Récupération des données du tab actif…', 'Chargement');

  const response = await requestBridge({
    type: 'CALCIUM_GET_ACTIVE_TAB_STATE'
  });

  if (!response?.ok) {
    UI_STATE.snapshot = null;
    setStatus(response?.error || 'Impossible de joindre le content script.', 'Erreur');
    renderAll();
    return;
  }

  UI_STATE.snapshot = response.snapshot;

  if (!UI_STATE.snapshot?.state?.uiEnabled) {
    setStatus('UI désactivée dans cette frame ou page non prête.', 'Inactif');
  } else {
    setStatus('Données récupérées.', 'Connecté');
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

function setActiveMainTab(tabName) {
  UI_STATE.activeMainTab = tabName;

  document.querySelectorAll('.calcium-main-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mainTab === tabName);
  });

  document.querySelectorAll('.calcium-tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.panel === tabName);
  });
}

function setActivePlayerSubTab(tabName) {
  UI_STATE.activePlayerSubTab = tabName;

  document.querySelectorAll('.calcium-player-subtab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.playerTab === tabName);
  });

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

  // Base : ce que le moteur considère "visible"
  const visible = snapshot?.visibleCategories || [];

  // On ajoute les catégories qui ont eu au moins 1 requête
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
      <button class="calcium-player-subtab ${UI_STATE.activePlayerSubTab === 'general' ? 'active' : ''}" data-player-tab="general">Général</button>
      <button class="calcium-player-subtab ${UI_STATE.activePlayerSubTab === 'troupes' ? 'active' : ''}" data-player-tab="troupes">Troupes</button>
      <button class="calcium-player-subtab ${UI_STATE.activePlayerSubTab === 'batiments' ? 'active' : ''}" data-player-tab="batiments">Bâtiments</button>
      <button class="calcium-player-subtab ${UI_STATE.activePlayerSubTab === 'recherche' ? 'active' : ''}" data-player-tab="recherche">Recherche</button>
    </div>
  `;
}

function buildItemBloc(calcium) {
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

  const visibleItemDefinitions = itemDefinitions.filter(
    (itemDef) => (playerItemsByDefinitionId[itemDef?.id]?.count ?? 0) > 0
  );

  const itemsHtml = visibleItemDefinitions.length
    ? visibleItemDefinitions
        .slice()
        .sort((a, b) => String(a?.id || '').localeCompare(String(b?.id || '')))
        .map((itemDef) => {
          const playerItem = playerItemsByDefinitionId[itemDef?.id] || null;
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
    : `<div class="calcium-resource-empty">Aucun item</div>`;

  return `
    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Items</div>
      <div class="calcium-item-grid">
        ${itemsHtml}
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
    'App\\Entity\\Building': { label: getLabelTrans("building","general"), badgeClass: 'badge-building', order: 1 },
    'App\\Entity\\Research': { label: getLabelTrans("research","general"), badgeClass: 'badge-research', order: 2 },
    'App\\Entity\\Troop': { label: getLabelTrans("troop","general"), badgeClass: 'badge-troop', order: 3 },
    'App\\Entity\\Battle': { label: getLabelTrans("battle","general"), badgeClass: 'badge-battle', order: 4 },
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
    const endLabel = action.endAt
      ? new Date(action.endAt).toLocaleString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })
      : '—';

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

        <div class="calcium-action-overview-bottom">
          
          <!--<span class="calcium-action-overview-end" title="Fin : ${escapeHtml(endLabel)}">
            ${escapeHtml(endLabel)}
          </span>-->
        </div>
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

  const showResources = {
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
  };

  const resources = Array.isArray(calcium?.Data?.Player?.resource)
    ? calcium.Data.Player.resource
    : [];

  const visibleResources = resources.filter(
    (resource) => showResources[resource?.type] === true
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
    <div class="calcium-player-hero">
      <div class="calcium-player-title-realm">Royaume : ${realmName}</div>
      <div class="calcium-player-title-sub">
        ${username} - ${getLabelTrans('level')} ${level} - ${getLabelTrans('power')} ${power}
      </div>
    </div>

    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Ressources</div>
      <div class="calcium-resource-grid">
        ${resourcesHtml}
      </div>
    </div>

    ${buildItemBloc(calcium)}

    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Actions en cours</div>
      ${buildActionsOverview(calcium)}
    </div>

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
    const displayLabel = UI_STATE.snapshot?.calcium?.Data?.Player.building?.find(b => b.definitionId === group.definitionId)?.label || buildingLabel;
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
  const playerSearch = UI_STATE.snapshot?.calcium?.Data.Player.search || [];
  
  return playerSearch.map(search => {
    const displayLabel = getLabelTrans(search.definitionId, "research");
    const levelRange = search.level;

    return `
      <tr>
        <td>
          <div class="calcium-building-cell">
            <div>
              ${search.status == "searching"
                ? `<span class="calcium-building-indicator" title="Au moins un bâtiment de ce type est en construction"></span>`
                : `<span class="calcium-building-indicator is-idle"></span>`
              }
              <span class="calcium-building-name">${escapeHtml(displayLabel)}</span>
              <span class="calcium-building-meta">${levelRange}</span>
            </div>
          </div>
        </td>
        <td>
          ${search.status == "searching"
            ? `<span class="calcium-building-group-status is-active">En recheche</span>`
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
        const search = (UI_STATE.snapshot?.calcium?.Data?.Search || []).find(b => b.uuid === String(searchUuid));
        const searchP = (UI_STATE.snapshot?.calcium?.Data?.Player.search || []).find(b => b.uuid === String(searchUuid));
        const searchName = getLabelTrans(searchP?.definitionId, "research") || 'Recherche inconnue';
        const remaining = formatDuration(getRemainingSeconds(action));


        return `
          <div class="calcium-action-item" data-action-uuid="${escapeHtml(action.uuid)}">
            <div class="calcium-action-main">
              <span class="calcium-action-badge"></span>
              <span class="calcium-action-title">${escapeHtml(searchName)} ${searchP.level} -> ${searchP.level+1}</span>
              <span
                class="calcium-action-timer"
                data-end-at="${escapeHtml(formatValue(action.endAt, ''))}"
                data-finished="${String(!!action.finished)}"
                data-remaining-time="${Number(action.remainingTime || 0)}"
              >
                ${remaining}
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
        const building = (UI_STATE.snapshot?.calcium?.Data?.Player.building || []).find(b => b.uuid === String(buildingUuid));
        const buildingName = building?.label || 'Bâtiment inconnu';
        const remaining = formatDuration(getRemainingSeconds(action));

        return `
          <div class="calcium-action-item" data-action-uuid="${escapeHtml(action.uuid)}">
            <div class="calcium-action-main">
              <span class="calcium-action-badge"></span>
              <span class="calcium-action-title">${escapeHtml(buildingName)} ${building.level} -> ${building.level+1}</span>
              <span
                class="calcium-action-timer"
                data-end-at="${escapeHtml(formatValue(action.endAt, ''))}"
                data-finished="${String(!!action.finished)}"
                data-remaining-time="${Number(action.remainingTime || 0)}"
              >
                ${remaining}
              </span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
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
        const troopUuid = action.metadata?.troop_uuid;
        const troop = (UI_STATE.snapshot?.calcium?.Data?.Troop || []).find(b => b.uuid === String(troopUuid));
        const troopP = (UI_STATE.snapshot?.calcium?.Data?.Player.troop || []).find(b => b.uuid === String(troopUuid));
        const troopName = getLabelTrans(troopP?.definitionId, "troop");
        const remaining = formatDuration(getRemainingSeconds(action));


        return `
          <div class="calcium-action-item" data-action-uuid="${escapeHtml(action.uuid)}">
            <div class="calcium-action-main">
              <span class="calcium-action-badge"></span>
              <span class="calcium-action-title">${escapeHtml(troopName)} x${action.metadata.amount}</span>
              <span
                class="calcium-action-timer"
                data-end-at="${escapeHtml(formatValue(action.endAt, ''))}"
                data-finished="${String(!!action.finished)}"
                data-remaining-time="${Number(action.remainingTime || 0)}"
              >
                ${remaining}
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
      <div class="calcium-player-subtitle">Bâtiments</div>
      <div class="calcium-table-wrap">
        <table class="calcium-table">
          <thead>
            <tr>
              <th scope="col">Bâtiment</th>
              <th scope="col">Statut</th>
            </tr>
          </thead>
          <tbody>
            ${buildBuildingsRows()}
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
      <div class="calcium-player-subtitle">Bâtiments</div>
      <div class="calcium-table-wrap">
        <table class="calcium-table">
          <thead>
            <tr>
              <th scope="col">Bâtiment</th>
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
  }

  panel.innerHTML = `
    ${buildPlayerHero()}
    ${content}
  `;

  panel.querySelectorAll('.calcium-player-subtab').forEach(tab => {
    tab.addEventListener('click', () => {
      setActivePlayerSubTab(tab.dataset.playerTab);
    });
  });
}

function refreshCountdownElements() {
  const elements = document.querySelectorAll('[data-end-at][data-finished]');
  elements.forEach(el => {
    const fakeAction = {
      endAt: el.dataset.endAt,
      finished: el.dataset.finished === 'true',
      remainingTime: el.dataset.remainingTime || 0
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
    clearInterval(UI_STATE.countdownInterval);
    UI_STATE.countdownInterval = null;
  }
}

function renderAll() {
  rebuildCategoryOptions();
  renderPlayerPanel();
  refreshCountdownElements();
  startCountdownRefresh();
}

function bindStaticEvents() {
  document.querySelectorAll('.calcium-main-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      setActiveMainTab(tab.dataset.mainTab);
    });
  });

  document.querySelectorAll('.ext-filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      setFilter(tab.dataset.filter);
    });
  });

  document.getElementById('ext-search-input').addEventListener('input', (event) => {
    setSearchText(event.target.value);
  });

  document.getElementById('ext-data-select').addEventListener('change', refreshSelectedDataView);
  document.getElementById('refresh-view-btn').addEventListener('click', loadState);
  document.getElementById('token-refresh-btn').addEventListener('click', refreshToken);
}

bindStaticEvents();
connectLiveUpdates();
setActiveMainTab('datas');
loadState();