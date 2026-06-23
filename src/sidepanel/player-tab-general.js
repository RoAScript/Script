import {
  UI_STATE,
  escapeHtml,
  formatValue,
  formatDuration,
  formatCompactNumber,
  getRemainingSeconds,
  getLabelTrans,
  usePlayerItem
} from './player-tab-core.js';

let rerenderGeneralPlayerPanel = null;

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

  rerenderGeneralPlayerPanel?.();
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

    grid.querySelectorAll('.open').forEach(c => {
      if (c !== card) c.classList.remove('open');
    });

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
    const input = card?.querySelector('.calcium-item-qty');
    if (!input) return;

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

    const input = btn.closest('.calcium-item-card')?.querySelector('.calcium-item-qty');
    if (!input) return;

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
    const input = card?.querySelector('.calcium-item-qty');
    if (!card || !input) return;

    const qty = Number(input.value || 1);

    btn.disabled = true;
    btn.textContent = '...';

    try {
      const response = await usePlayerItem(btn.dataset.itemUuid, { count: qty });

      if (!response?.ok) {
        btn.textContent = 'Err';
        return;
      }

      card.classList.remove('open');
      btn.textContent = 'OK';
    } catch {
      btn.textContent = 'Err';
    } finally {
      btn.disabled = false;
    }
  });
}


function getResourceGenerationStats(calcium) {
  const playerBuildings = Array.isArray(calcium?.Data?.Player?.building)
    ? calcium.Data.Player.building
    : Array.isArray(calcium?.Data?.Player?.buildings)
      ? calcium.Data.Player.buildings
      : [];

  const buildingDefinitions = Array.isArray(calcium?.Data?.Buildings)
    ? calcium.Data.Buildings
    : [];

  const searchDefinitions = Array.isArray(calcium?.Data?.Search)
    ? calcium.Data.Search
    : Array.isArray(calcium?.Data?.search)
      ? calcium.Data.search
      : [];

  const playerSearches = Array.isArray(calcium?.Data?.Player?.search)
    ? calcium.Data.Player.search
    : Array.isArray(calcium?.Data?.Player?.searches)
      ? calcium.Data.Player.searches
      : Array.isArray(calcium?.Player?.search)
        ? calcium.Player.search
        : [];

  const buildingDefinitionsById = new Map(
    buildingDefinitions.map((definition) => [definition?.id, definition])
  );

  const playerSearchesByDefinitionId = new Map(
    playerSearches.map((research) => [research?.definitionId, research])
  );

  const statsByResource = {};

  for (const playerBuilding of playerBuildings) {
    const definitionId = playerBuilding?.definitionId;
    const level = playerBuilding?.level;
    if (!definitionId || level == null) continue;

    const definition = buildingDefinitionsById.get(definitionId);
    const generations = definition?.generations;
    if (!generations) continue;

    const generationAtLevel = generations[String(level)];
    if (!generationAtLevel) continue;

    const generatedResources = generationAtLevel?.resources ?? {};
    const capacity = Number(generationAtLevel?.capacity) || 0;

    for (const [resourceType, perHourRaw] of Object.entries(generatedResources)) {
      const perHour = Number(perHourRaw) || 0;

      if (!statsByResource[resourceType]) {
        statsByResource[resourceType] = {
          basePerHour: 0,
          bonusRate: 0,
          bonusPerHour: 0,
          perHour: 0,
          capacity: 0,
          appliedResearches: []
        };
      }

      statsByResource[resourceType].basePerHour += perHour;
      statsByResource[resourceType].capacity += capacity;
    }
  }

  for (const searchDefinition of searchDefinitions) {
    if (searchDefinition?.enabled === false) continue;
    const searchId = searchDefinition?.id;
    if (!searchId) continue;

    const effects = Array.isArray(searchDefinition?.effects)
      ? searchDefinition.effects
      : [];

    if (!effects.length) continue;

    const playerResearch = playerSearchesByDefinitionId.get(searchId);
    if (!playerResearch) continue;

    const researchLevel = Number(playerResearch?.level);
    if (!Number.isFinite(researchLevel)) continue;

    for (const effect of effects) {
      if (effect?.name !== 'resource_generation_increase') continue;
      const resourceType = effect?.resource_type;
      if (!resourceType) continue;

      const defaultValue = Number(effect?.default) || 0;
      const scaleValue = Number(effect?.scale) || 0;
      const bonusRate = defaultValue + researchLevel * scaleValue;

      if (!statsByResource[resourceType]) {
        statsByResource[resourceType] = {
          basePerHour: 0,
          bonusRate: 0,
          bonusPerHour: 0,
          perHour: 0,
          capacity: 0,
          appliedResearches: []
        };
      }

      statsByResource[resourceType].bonusRate += bonusRate;
      statsByResource[resourceType].appliedResearches.push({
        researchId: searchId,
        researchLevel,
        bonusRate,
        defaultValue,
        scaleValue
      });
    }
  }

  for (const resourceType of Object.keys(statsByResource)) {
    const stat = statsByResource[resourceType];
    const basePerHour = Number(stat.basePerHour) || 0;
    const totalBonusRate = Number(stat.bonusRate) || 0;
    const finalPerHour = basePerHour * (1 + totalBonusRate);
    const bonusPerHour = finalPerHour - basePerHour;

    stat.bonusPerHour = bonusPerHour;
    stat.perHour = finalPerHour;
  }

  return statsByResource;
}


function bindEventResource() {
  if (document.body.dataset.resourceBound === 'true') return;
  document.body.dataset.resourceBound = 'true';

  document.addEventListener('click', function (e) {
    const header = e.target.closest('.calcium-resource-header');
    if (!header) return;

    const card = header.closest('.calcium-resource-card');
    if (!card) return;

    const isOpen = card.classList.contains('is-open');

    document.querySelectorAll('.calcium-resource-card.is-open').forEach(el => {
      if (el !== card) el.classList.remove('is-open');
    });

    card.classList.toggle('is-open', !isOpen);
  });
}


function buildResourcesBlock(calcium) {
  const resources = Array.isArray(calcium?.Data?.Player?.resource)
    ? calcium.Data.Player.resource
    : [];

  const visibleResources = resources.filter(
    (resource) => UI_STATE.showResources[resource?.type] === true
  );

  const playerBuildings = Array.isArray(calcium?.Data?.Player?.building)
    ? calcium.Data.Player.building
    : Array.isArray(calcium?.Data?.Player?.buildings)
      ? calcium.Data.Player.buildings
      : [];

  const buildingDefinitions = Array.isArray(calcium?.Data?.Buildings)
    ? calcium.Data.Buildings
    : [];

  const generationStats = getResourceGenerationStats(calcium);

  const storageVaultPlayer = playerBuildings.find(
    (b) => b?.definitionId === 'storage_vault'
  );
  const storageVaultLevel = storageVaultPlayer?.level ?? null;
  const storageVaultDefinition = buildingDefinitions.find(
    (b) => b?.id === 'storage_vault'
  );
  const storageVaultProtection =
    storageVaultDefinition?.metadata?.[String(storageVaultLevel)]?.protection ?? {};

  const resourcesHtml = visibleResources.length
    ? visibleResources.map((resource) => {
        const type = resource?.type;
        const imageSrc = chrome.runtime.getURL(`images/${type}.webp`);
        const imageAlt = escapeHtml(getLabelTrans(type, 'resource'));
        const amountValue = Number(resource?.amount) || 0;
        const amount = escapeHtml(formatCompactNumber(amountValue));
        const protectedValue = Number(storageVaultProtection?.[type] ?? 0);
        const resProtected = escapeHtml(formatCompactNumber(protectedValue));

        const stats = generationStats?.[type] ?? {};
        const basePerHour = Number(stats?.basePerHour ?? 0);
        const bonusRate = Number(stats?.bonusRate ?? 0);
        const bonusPerHour = Number(stats?.bonusPerHour ?? 0);
        const genPerHour = Number(stats?.perHour ?? 0);
        const storageCapacity = Number(stats?.capacity ?? 0);

        const baseDisplay = escapeHtml(formatCompactNumber(basePerHour));
        const finalDisplay = escapeHtml(formatCompactNumber(genPerHour));
        const bonusPerHourDisplay = escapeHtml(formatCompactNumber(bonusPerHour, 2));
        const capacityDisplay = escapeHtml(formatCompactNumber(storageCapacity));
        const bonusPercentDisplay = `${(bonusRate * 100).toFixed(
          bonusRate * 100 >= 10 ? 0 : 1
        )}%`;

        const appliedResearches = Array.isArray(stats?.appliedResearches)
          ? stats.appliedResearches
          : [];

        return `
          <div class="calcium-resource-card">
            <div class="calcium-resource-header">
              <span class="calcium-resource-label">
                <img
                  src="${imageSrc}"
                  alt="${imageAlt}"
                  title="${imageAlt}"
                  class="calcium-resource-icon"
                >
              </span>
              <div class="calcium-resource-values">
                <span class="calcium-resource-amount">${amount}</span>
                <span class="calcium-resource-pill">🔒 ${resProtected}</span>
              </div>
            </div>
            <div class="calcium-resource-details">
              <div class="calcium-details-line">
                <span>Base</span>
                <span>${baseDisplay}/h</span>
              </div>
              ${
                bonusRate > 0
                  ? `
                    <div class="calcium-details-line">
                      <span>Bonus</span>
                      <span>+${bonusPercentDisplay}</span>
                    </div>
                    <div class="calcium-details-line">
                      <span>Gain bonus</span>
                      <span>+${bonusPerHourDisplay}/h</span>
                    </div>
                  `
                  : ''
              }
              <div class="calcium-details-line calcium-details-line--final">
                <span>Final</span>
                <span>${finalDisplay}/h</span>
              </div>
              ${
                storageCapacity > 0
                  ? `
                    <div class="calcium-details-line">
                      <span>Stockage</span>
                      <span>${capacityDisplay}</span>
                    </div>
                  `
                  : ''
              }
              ${
                appliedResearches.length
                  ? `
                    <div class="calcium-details-section">
                      <div class="calcium-details-title">Recherches</div>
                      ${appliedResearches.map(r => `
                        <div class="calcium-details-line">
                          <span>${getLabelTrans(r.researchId, 'research')} niv.${r.researchLevel}</span>
                          <span>+${(r.bonusRate * 100).toFixed(0)}%</span>
                        </div>
                      `).join('')}
                    </div>
                  `
                  : ''
              }
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
  const versionCalcium = `v${chrome.runtime.getManifest().version}`;

  return `
    <div class="calcium-player-hero">
      <div class="calcium-player-title-realm">Royaume : ${realmName} - Calcium ${versionCalcium}</div>
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


function bindGeneralTabEvents(panel, renderPlayerPanel) {
  rerenderGeneralPlayerPanel = renderPlayerPanel;

  panel.querySelectorAll('.calcium-item-subtab').forEach(tab => {
    tab.addEventListener('click', () => {
      setActiveItemCategory(tab.dataset.itemCategory);
    });
  });

  bindItemActions(panel);
  bindEventResource();
}

export { renderPlayerGeneralTab, bindGeneralTabEvents };
