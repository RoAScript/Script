import {
  UI_STATE,
  escapeHtml,
  formatValue,
  formatDuration,
  getRemainingSeconds,
  usePlayerItem,
  getItemActionReductionSeconds,
  formatDurationShort,
  applyOptimisticInventoryConsumption,
  applyOptimisticActionAcceleration
} from './player-tab-core.js';

let rerenderResearchPlayerPanel = null;

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
              ${
                search.status === 'searching'
                  ? `<span class="calcium-building-indicator" title="Recherche en cours"></span>`
                  : `<span class="calcium-building-indicator is-idle"></span>`
              }
              <span class="calcium-building-name">${escapeHtml(displayLabel)}</span>
              <span class="calcium-building-meta">${escapeHtml(levelRange)}</span>
            </div>
          </div>
        </td>
        <td>
          ${
            search.status === 'searching'
              ? `<span class="calcium-building-group-status is-active">En recherche</span>`
              : `<span class="calcium-building-group-status">Stable</span>`
          }
        </td>
      </tr>
    `;
  }).join('');
}

function getAvailableResearchAccelerationItems(calcium) {
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
        && contexts.includes('research')
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

function buildAccelerationResearchButtons(action, calcium) {
  const items = getAvailableResearchAccelerationItems(calcium);
  if (!items.length) return '';

  return `
    <div class="calcium-accel-buttons">
      ${items.map(({ itemDef, playerItem }) => {
        const seconds = getItemActionReductionSeconds(itemDef);
        const label = formatDurationShort(seconds);
        const stock = Number(playerItem?.count ?? 0);
        const itemLabel = getLabelTrans(itemDef?.id, 'item') || itemDef?.id || 'Item';

        return `
          <button
            type="button"
            class="calcium-accel-btn calcium-research-accel-btn"
            data-item-uuid="${escapeHtml(playerItem.uuid || '')}"
            data-action-uuid="${escapeHtml(action.uuid || '')}"
            data-reduction-seconds="${seconds}"
            title="${escapeHtml(`${itemLabel} • stock ${stock}`)}"
          >
            ${escapeHtml(label)}
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function buildSearchActionsSummary() {
  const calcium = UI_STATE.snapshot?.calcium || null;
  const actions = [...(UI_STATE.snapshot?.derived?.searchActions || [])]
    .filter(action => !action.finished)
    .sort((a, b) => getRemainingSeconds(a) - getRemainingSeconds(b));

  if (!actions.length) {
    return `<div class="calcium-actions-empty">Aucune action de recherche en cours</div>`;
  }

  return `
    <div class="calcium-actions-list calcium-research-actions-list">
      ${actions.map(action => {
        const searchUuid = action.metadata?.research_uuid;
        const searchP = (UI_STATE.snapshot?.calcium?.Data?.Player?.search || []).find(
          search => search.uuid === String(searchUuid)
        );

        const definitionId = action.metadata?.definitionId || searchP?.definitionId;
        const searchName = getLabelTrans(definitionId, 'research') || 'Recherche inconnue';
        const remainingSeconds = getRemainingSeconds(action);
        const remaining = formatDuration(remainingSeconds);

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
          <div class="calcium-action-item calcium-research-action-item" data-action-uuid="${escapeHtml(action.uuid)}">
            <div class="calcium-action-main">
              <span class="calcium-action-badge"></span>
              <span class="calcium-action-title">
                ${escapeHtml(searchName)} ${currentLevel} -> ${targetLevel}
              </span>
              <span
                class="calcium-action-timer"
                data-end-at="${escapeHtml(formatValue(action.endAt, ''))}"
                data-finished="${String(!!action.finished)}"
                data-remaining-time="${Number(action.remainingTime || 0)}"
              >
                ${escapeHtml(remaining)}
              </span>
            </div>

            ${calcium ? buildAccelerationResearchButtons(action, calcium) : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function bindResearchAccelerationButtons(scope = document) {
  const container = scope.querySelector('.calcium-research-actions-list');
  if (!container || container.dataset.researchAccelBound === 'true') return;

  container.dataset.researchAccelBound = 'true';

  container.addEventListener('click', async (event) => {
    const btn = event.target.closest('.calcium-research-accel-btn');
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
      rerenderResearchPlayerPanel?.();
    } catch (error) {
      console.error('[Calcium][research-accel] KO', error);
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

function bindResearchTabEvents(panel, renderPlayerPanel) {
  rerenderResearchPlayerPanel = renderPlayerPanel;
  bindResearchAccelerationButtons(panel);
}

export {
  renderPlayerSearchTab,
  bindResearchTabEvents
};
