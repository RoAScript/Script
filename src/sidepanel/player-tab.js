import { UI_STATE } from './state.js';
import {
  escapeHtml, formatValue, formatDuration, formatCompactNumber, getRemainingSeconds,
  getLabelTrans, setActivePlayerSubTab
} from './core.js';

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

async function usePlayerItem(itemUuid, quantity = 1) {
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
      json: { count: quantity }
    }
  );
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

  const filtered = visibleItems.filter(i =>
    activeCategory === 'all' || i.category === activeCategory
  );

  const itemsHtml = filtered.length
    ? filtered.map(({ itemDef, playerItem }) => {

        const itemLabel = escapeHtml(
          getLabelTrans(itemDef?.id, 'item') || itemDef?.id
        );

        const itemCount = escapeHtml(
          formatCompactNumber(playerItem?.count ?? 0)
        );

        const itemUuid = escapeHtml(playerItem?.uuid || '');
        const maxQty = playerItem?.count ?? 0;

        const def = calcium?.Data?.Item?.find(i => i.id === itemDef.id);

        const canUse =
          !!playerItem?.uuid &&
          def?.usable &&
          !def?.targetable;

        return `
          <div class="calcium-item-card" style="position: relative;" data-item-uuid="${itemUuid}">
            <div class="calcium-item-line">
              <span class="calcium-item-label" title="${itemLabel}">
                ${itemLabel}
              </span>
              <span class="calcium-item-count">${itemCount}</span>
              ${canUse ? `
                <button class="calcium-item-trigger">⚡</button>
              ` : ''}
            </div>

            ${canUse ? `
              <div class="calcium-item-panel">
                <button class="qty-btn" data-action="dec">-</button>
                <input class="calcium-item-qty" type="number" min="1" max="${maxQty}" value="1" />
                <button class="qty-btn" data-action="inc">+</button>
                <button class="qty-max">MAX</button>
                <button class="calcium-btn calcium-btn-primary calcium-use-item-btn" data-item-uuid="${itemUuid}">
                  OK
                </button>
              </div>
            ` : ''}

          </div>
        `;
      }).join('')
    : `<div class="calcium-resource-empty">Aucun item</div>`;

  return `
    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Items</div>
      ${buildItemCategoryTabs(calcium)}
      <div class="calcium-item-grid" data-item-grid="true">
        ${itemsHtml}
      </div>
    </div>
  `;
}

function bindItemActions(scope = document) {
  const grid = scope.querySelector('[data-item-grid="true"]');
  if (!grid || grid.dataset.bound === 'true') return;

  grid.dataset.bound = 'true';

  // toggle
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.calcium-item-trigger');
    if (!btn) return;

    btn.classList.toggle('active');
    const card = btn.closest('.calcium-item-card');

    grid.querySelectorAll('.open').forEach(c => c !== card && c.classList.remove('open'));

    card.classList.toggle('open');
  });

  // close when click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.calcium-item-card')) {
      document.querySelectorAll('.calcium-item-card.open')
        .forEach(c => c.classList.remove('open'));
    }
  });

  // + / -
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.qty-btn');
    if (!btn) return;

    const card = btn.closest('.calcium-item-card');
    const input = card.querySelector('.calcium-item-qty');

    let v = Number(input.value);
    const max = Number(input.max);

    v += btn.dataset.action === 'inc' ? 1 : -1;

    if (v < 1) v = 1;
    if (v > max) v = max;

    input.value = v;
  });

  // max
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.qty-max');
    if (!btn) return;

    const input = btn.closest('.calcium-item-card').querySelector('.calcium-item-qty');
    input.value = input.max;
  });

  // input securisé
  grid.addEventListener('input', (e) => {
    const input = e.target.closest('.calcium-item-qty');
    if (!input) return;

    let v = Number(input.value);
    const max = Number(input.max);

    if (!v || v < 1) v = 1;
    if (v > max) v = max;

    input.value = v;
  });

  // use
  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.calcium-use-item-btn');
    if (!btn) return;

    const card = btn.closest('.calcium-item-card');
    const input = card.querySelector('.calcium-item-qty');

    const qty = Number(input.value || 1);

    btn.disabled = true;
    btn.textContent = '...';

    try {
      await usePlayerItem(btn.dataset.itemUuid, qty);
      card.classList.remove('open'); // fermeture auto
      btn.textContent = 'OK';
    } catch {
      btn.textContent = 'Err';
    } finally {
      btn.disabled = false;
    }
  });
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
      return `${escapeHtml(getLabelTrans(label, 'buildings'))}${escapeHtml(levels)}`;
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
        ${username} - ${getLabelTrans('level')} ${level} - ${getLabelTrans('power')} ${formatCompactNumber(power)}
      </div>
    </div>

    ${buildResourcesBlock(calcium)}
    ${buildItemBloc(calcium)}

    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Actions en cours</div>
      ${buildActionsOverview(calcium)}
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
        const buildingName = getLabelTrans(building?.label, 'buildings') || 'Bâtiment inconnu';
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
    settlements.map(settlement => [settlement?.['@id'], settlement])
  );

  const grouped = buildings.reduce((acc, building) => {
    const settlementApiId = building?.settlement || '__unknown__';
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
      label: settlement?.name || 'Inconnue',
      buildings: settlementBuildings
    };
  }).sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

function ensureValidActiveBuildingSettlement() {
  const groups = getBuildingsBySettlement();
  const validIds = groups.map(group => group.settlementApiId);

  if (!validIds.includes(UI_STATE.activeBuildingSettlement)) {
    UI_STATE.activeBuildingSettlement = validIds[0] || 'all';
  }
}

function setActiveBuildingSettlement(settlementApiId) {
  UI_STATE.activeBuildingSettlement = settlementApiId;
  renderPlayerPanel();
}

function buildBuildingSettlementTabs() {
  const groups = getBuildingsBySettlement();

  if (!groups.length) return '';

  return `
    <div class="calcium-player-subtabs calcium-building-settlement-tabs">
      ${groups.map(group => `
        <button
          class="calcium-player-subtab calcium-building-settlement-tab ${UI_STATE.activeBuildingSettlement === group.settlementApiId ? 'active' : ''}"
          data-building-settlement="${escapeHtml(group.settlementApiId)}"
          type="button"
        >
          ${escapeHtml(group.label)}
        </button>
      `).join('')}
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
    const key = building?.definitionId || 'unknown';
    const level = Number(building?.level || 0);

    if (!acc[key]) {
      acc[key] = {
        definitionId: key,
        label: getLabelTrans(building?.label, 'buildings') || getLabelTrans(key, 'buildings'),
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
    .join('');

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
        label: getLabelTrans(category, 'quest_category'),
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
        <span class="calcium-badge calcium-badge-${escapeHtml(quest.statusTone)}">
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

  panel.querySelectorAll('[data-building-settlement]').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveBuildingSettlement(button.dataset.buildingSettlement);
    });
  });

  bindItemActions(panel);
}

export { renderPlayerPanel };