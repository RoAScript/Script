import {
  UI_STATE,
  escapeHtml,
  formatValue,
  formatDuration,
  getRemainingSeconds,
  getLabelTrans,
  usePlayerItem,
  getItemActionReductionSeconds,
  formatDurationShort,
  applyOptimisticInventoryConsumption,
  applyOptimisticActionAcceleration
} from './player-tab-core.js';

let rerenderBuildingsPlayerPanel = null;

function getAvailableBuildingAccelerationItems(calcium) {
  const itemDefinitions = Array.isArray(calcium?.Data?.Item)
    ? calcium.Data.Item
    : [];

  const playerItems = Array.isArray(calcium?.Data?.Player?.items)
    ? calcium.Data.Player.items
    : [];

  const playerItemsByDefinitionId = Object.fromEntries(
    playerItems
      .filter((item) => item?.definitionId && Number(item?.count ?? 0) > 0)
      .map((item) => [item.definitionId, item])
  );

  return itemDefinitions
    .filter((itemDef) => {
      const playerItem = playerItemsByDefinitionId[itemDef?.id];
      const contexts = Array.isArray(itemDef?.contexts) ? itemDef.contexts : [];
      const reductionSeconds = getItemActionReductionSeconds(itemDef);

      return !!playerItem
        && itemDef?.category === 'acceleration'
        && itemDef?.usable === true
        && itemDef?.targetable === true
        && contexts.includes('building')
        && reductionSeconds > 0;
    })
    .map((itemDef) => ({
      itemDef,
      playerItem: playerItemsByDefinitionId[itemDef.id]
    }))
    .sort((a, b) => {
      const aSeconds = getItemActionReductionSeconds(a.itemDef);
      const bSeconds = getItemActionReductionSeconds(b.itemDef);
      return aSeconds - bSeconds;
    });
}


function buildAccelerationBuildingButtons(action, calcium) {
  const items = getAvailableBuildingAccelerationItems(calcium);
  if (!items.length) return '';

  return `
    <div class="calcium-accel-buttons">
      ${items.map(({ itemDef, playerItem }) => {
        const seconds = getItemActionReductionSeconds(itemDef);
        const label = formatDurationShort(seconds);
        const stock = Number(playerItem?.count ?? 0);

        return `
          <button
            type="button"
            class="calcium-accel-btn"
            data-item-uuid="${escapeHtml(playerItem.uuid || '')}"
            data-action-uuid="${escapeHtml(action.uuid || '')}"
            data-reduction-seconds="${seconds}"
            title="${escapeHtml(`${getLabelTrans(itemDef?.id, 'item') || itemDef?.id} • stock ${stock}`)}"
          >
            ${escapeHtml(label)}
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function bindBuildingAccelerationButtons(scope = document) {
  const container = scope.querySelector('.calcium-actions-list');
  if (!container || container.dataset.buildingAccelBound === 'true') return;

  container.dataset.buildingAccelBound = 'true';

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('.calcium-accel-btn');
    if (!btn) return;

    const itemUuid = btn.dataset.itemUuid;
    const actionUuid = btn.dataset.actionUuid;
    const reductionSeconds = Number(btn.dataset.reductionSeconds || 0);

    if (!itemUuid || !actionUuid) return;

    btn.disabled = true;
    const previousText = btn.textContent;
    btn.textContent = '...';

    try {
      const response = await usePlayerItem(itemUuid, {
        count: 1,
        target: {
          type: 'action',
          value: actionUuid
        }
      });

      if (!response?.ok) {
        btn.textContent = 'Err';
        return;
      }

      applyOptimisticInventoryConsumption(itemUuid, 1);
      rerenderBuildingsPlayerPanel?.();
    } catch (error) {
      console.error('[Calcium][building-accel] KO', error);
      btn.textContent = 'Err';
    } finally {
      window.setTimeout(() => {
        btn.disabled = false;
        if (btn.isConnected) {
          btn.textContent = previousText;
        }
      }, 250);
    }
  });
}

function buildBuildingActionsSummary() {
  const calcium = UI_STATE.snapshot?.calcium || null;
  const actions = [...(UI_STATE.snapshot?.derived?.buildingActions || [])]
    .filter(action => !action.finished)
    .sort((a, b) => getRemainingSeconds(a) - getRemainingSeconds(b));

  if (!actions.length) {
    return `<div class="calcium-actions-empty">Aucune action de bâtiment en cours</div>`;
  }

  return `
    <div class="calcium-actions-list">
      ${actions.map(action => {
        const buildingUuid = action.metadata?.building_uuid || action.metadata?.buildingUuid;
        const building = (UI_STATE.snapshot?.calcium?.Data?.Player?.building || []).find(
          b => b.uuid === String(buildingUuid)
        );

        const remainingSeconds = getRemainingSeconds(action);
        const remaining = formatDuration(remainingSeconds);
        const currentLevel = Number(
          action.metadata?.currentLevel ??
          building?.level ??
          0
        );
        const targetLevel = Number(
          action.metadata?.targetLevel ??
          (currentLevel + 1)
        );

        const iconSrc = chrome.runtime.getURL(`images/${building?.definitionId}.webp`);
        const buildingName = getLabelTrans(building?.label, 'buildings') || 'Bâtiment inconnu';

        return `
          <div class="calcium-action-item calcium-building-action-item" data-action-uuid="${escapeHtml(action.uuid)}">
            <div class="calcium-action-main calcium-building-action-main">
              <span class="calcium-action-badge"></span>
              <span class="calcium-action-title">
                <img
                  src="${iconSrc}"
                  alt="${escapeHtml(buildingName)}"
                  title="${escapeHtml(buildingName)}"
                  class="calcium-resource-icon"
                >
                ${currentLevel} -> ${targetLevel}
              </span>
              <span
                class="calcium-action-timer"
                data-end-at="${escapeHtml(formatValue(action.endAt, ''))}"
                data-finished="${String(!!action.finished)}"
                data-remaining-time="${Number(action.remainingTime || 0)}"
                data-building-remaining-seconds="${Number(remainingSeconds || 0)}"
              >
                ${escapeHtml(remaining)}
              </span>
            </div>
            ${calcium ? buildAccelerationBuildingButtons(action, calcium) : ''}
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
  rerenderBuildingsPlayerPanel?.();
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
    (group) => group.settlementApiId === UI_STATE.activeBuildingSettlement
  );

  const buildings = Array.isArray(activeGroup?.buildings) ? activeGroup.buildings : [];
  if (!buildings.length) {
    return `
      <tr>
        <td colspan="2" class="calcium-cell-empty">Aucun bâtiment</td>
      </tr>
    `;
  }

  const buildingActions = Array.isArray(UI_STATE.snapshot?.derived?.buildingActions)
    ? UI_STATE.snapshot.derived.buildingActions
    : [];

  const groupedByDefinition = buildings.reduce((acc, building) => {
    const key = building?.definitionId || 'unknown';
    const level = Number(building?.level || 0);
    const label =
      getLabelTrans(building?.label, 'buildings') ||
      getLabelTrans(key, 'buildings') ||
      key;

    if (!acc[key]) {
      acc[key] = {
        definitionId: key,
        label,
        count: 0,
        minLevel: level,
        maxLevel: level,
        hasAction: false,
        remainingSeconds: null
      };
    }

    acc[key].count += 1;
    acc[key].minLevel = Math.min(acc[key].minLevel, level);
    acc[key].maxLevel = Math.max(acc[key].maxLevel, level);

    const buildingAction = buildingActions.find((action) => {
      if (action?.finished) return false;
      return (
        action?.metadata?.building_uuid === building.uuid ||
        action?.metadata?.buildingUuid === building.uuid
      );
    });

    if (buildingAction) {
      const remainingSeconds = getRemainingSeconds(buildingAction);
      acc[key].hasAction = true;
      if (
        acc[key].remainingSeconds === null ||
        remainingSeconds < acc[key].remainingSeconds
      ) {
        acc[key].remainingSeconds = remainingSeconds;
      }
    }

    return acc;
  }, {});

  const rows = Object.values(groupedByDefinition)
    .sort((a, b) => String(a.label).localeCompare(String(b.label)))
    .map((group) => {
      const levelLabel =
        group.minLevel === group.maxLevel
          ? `Niv. ${group.minLevel}`
          : `Niv. ${group.minLevel} à ${group.maxLevel}`;

      const iconSrc = chrome.runtime.getURL(`images/${group.definitionId}.webp`);
      const iconAlt = escapeHtml(group.label);

      return `
        <tr>
          <td>
            <div class="calcium-building-cell">
              <div>
                <span
                  class="calcium-building-indicator ${group.hasAction ? '' : 'is-idle'}"
                  ${group.hasAction ? 'title="Au moins un bâtiment de ce type est en construction"' : ''}
                ></span>
                <span class="calcium-building-name">
                  <img
                    src="${iconSrc}"
                    alt="${iconAlt}"
                    title="${iconAlt}"
                    class="calcium-resource-icon"
                  >
                </span>
                <span class="calcium-building-meta">${escapeHtml(levelLabel)}</span>
              </div>
            </div>
          </td>
          <td>
            ${
              group.hasAction && group.remainingSeconds != null
                ? `
                  <span
                    class="calcium-building-group-status is-active"
                    data-building-remaining-seconds="${group.remainingSeconds}"
                  >
                    ${escapeHtml(formatDuration(group.remainingSeconds))}
                  </span>
                `
                : ``
            }
          </td>
        </tr>
      `;
    })
    .join('');

  return rows;
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

function bindBuildingsTabEvents(panel, renderPlayerPanel) {
  rerenderBuildingsPlayerPanel = renderPlayerPanel;

  panel.querySelectorAll('[data-building-settlement]').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveBuildingSettlement(button.dataset.buildingSettlement);
    });
  });

  bindBuildingAccelerationButtons(panel);
}

export { renderPlayerBuildingsTab, bindBuildingsTabEvents };
