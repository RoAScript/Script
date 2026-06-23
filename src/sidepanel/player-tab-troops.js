import {
  UI_STATE,
  escapeHtml,
  formatValue,
  formatDuration,
  formatCompactNumber,
  getRemainingSeconds,
  getLabelTrans
} from './player-tab-core.js';

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


export { renderPlayerTroopsTab };
