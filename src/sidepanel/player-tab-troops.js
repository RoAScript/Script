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

function getPlayerTroopStatEffects(calcium) {
  const playerSearches = Array.isArray(calcium?.Data?.Player?.search)
    ? calcium.Data.Player.search
    : [];

  const searchDefinitions = Array.isArray(calcium?.Data?.Search)
    ? calcium.Data.Search
    : [];

  const playerSearchesByDefinitionId = Object.fromEntries(
    playerSearches
      .filter((search) => search?.definitionId || search?.id)
      .map((search) => {
        const definitionId = search.definitionId || search.id;

        return [
          definitionId,
          {
            ...search,
            definitionId,
            level: Number(search.level ?? 0)
          }
        ];
      })
  );

  return searchDefinitions
    .filter((searchDef) => playerSearchesByDefinitionId[searchDef?.id])
    .flatMap((searchDef) => {
      const playerSearch = playerSearchesByDefinitionId[searchDef.id];
      const level = Number(playerSearch?.level ?? 0);

      const effects = Array.isArray(searchDef?.effects)
        ? searchDef.effects
        : [];

      return effects
        .filter((effect) => effect?.name === 'increase_troop_stats')
        .map((effect) => {
          const baseValue = Number(effect?.default ?? 0);
          const scale = Number(effect?.scale ?? 0);
          const value = baseValue + (scale * level);

          return {
            searchId: searchDef.id,
            playerLevel: level,

            name: effect?.name ?? null,
            type: effect?.type ?? null,

            value,
            default: baseValue,
            scale,

            rawEffect: effect,
            rawSearchDefinition: searchDef,
            rawPlayerSearch: playerSearch
          };
        });
    });
}

function getModifiedTroopStat(calcium, statName, baseValue) {
  const modifier = getTroopStatModifier(calcium, statName);

  return Math.round(
    (Number(baseValue) || 0) * (1 + modifier)
  );
}

function getTroopStatModifier(calcium, statName) {
  const playerTroopStatEffects = getPlayerTroopStatEffects(calcium);

  if (!Array.isArray(playerTroopStatEffects) || !statName) {
    return 0;
  }

  return playerTroopStatEffects
    .filter(effect =>
      effect?.type &&
      statName.endsWith(effect.type)
    )
    .reduce((sum, effect) => sum + Number(effect.value ?? 0), 0);
}

function renderTroopStat(calcium, statName, baseValue) {
    const modifiedValue = getModifiedTroopStat(
        calcium,
        statName,
        baseValue
    );

    const isBoosted = modifiedValue > baseValue;

    return `
        <span class="calcium-building-meta ${isBoosted ? 'calcium-stat-boosted' : ''}">
            ${escapeHtml(formatValue(modifiedValue))}
        </span>
    `;
}

function renderPlayerDragonTroopTab(calcium) {
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
        .filter((troopDef) => troopDef?.is_dragon == true)
        .slice()
        .sort((a, b) => Number(a?.order ?? 0) - Number(b?.order ?? 0))
        .map((troopDef) => {
          const stats = troopDef?.stats?.['1'] ?? {};
          const playerTroop = playerTroopsByDefinitionId[troopDef?.id] || null;
          const troopLabel = escapeHtml(getLabelTrans(troopDef?.id, 'troop'));
          const troopAmount = escapeHtml(formatCompactNumber(playerTroop?.amount ?? 0));

          const meleeAttack = getModifiedTroopStat(calcium, 'melee_attack', stats.melee_attack);
          const rangeAttack = getModifiedTroopStat(calcium, 'range_attack', stats.range_attack);
          const hp = getModifiedTroopStat(calcium, 'hp', stats.hp);
          const defense = getModifiedTroopStat(calcium, 'defense', stats.defense);
          const speed = getModifiedTroopStat(calcium, 'speed', stats.speed);
          const range = getModifiedTroopStat(calcium, 'range',stats.range);
          const load = getModifiedTroopStat(calcium, 'load', stats.load);
          const upkeep = getModifiedTroopStat(calcium, 'upkeep', stats.upkeep);
          const power = getModifiedTroopStat(calcium, 'power', stats.power);

          return `
            <tr>
              <td>
                <div class="calcium-building-cell">
                  <div>
                    ${troopDef?.available
                      ? `<span class="calcium-building-indicator is-idle" title="Troupe disponible"></span>`
                      : `<span class="calcium-building-indicator" title="Troupe indisponible"></span>`
                    }
                    <span class="calcium-building-name">${troopLabel}</span>
                  </div>
                </div>
              </td>
              <td>${renderTroopStat(calcium, 'melee_attack', stats.melee_attack)}</td>
              <td>${renderTroopStat(calcium, 'range_attack', stats.range_attack)}</td>
              <td>${renderTroopStat(calcium, 'hp', stats.hp)}</td>
              <td>${renderTroopStat(calcium, 'defense', stats.defense)}</td>
              <td>${renderTroopStat(calcium, 'speed', stats.speed)}</td>
              <td>${renderTroopStat(calcium, 'range', stats.range)}</td>
              <td>${renderTroopStat(calcium, 'load', stats.load)}</td>
              <td>${renderTroopStat(calcium, 'upkeep', stats.upkeep)}</td>
              <td>${renderTroopStat(calcium, 'power', stats.power)}</td>
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
      <div class="calcium-player-subtitle">Dragons</div>
      <div class="calcium-table-wrap">
        <table class="calcium-table calcium-troops-table">
          <thead>
            <tr>
              <th scope="col">${getLabelTrans('troop')}</th>
              <th scope="col">
                <img
                  src="${chrome.runtime.getURL(`images/stat_melee_attack.webp`)}"
                  class="calcium-troop-icon"
                  alt="${getLabelTrans('melee_attack')}"
                  title="${getLabelTrans('melee_attack')}"
                >
              </th>
              <th scope="col">
                <img
                  src="${chrome.runtime.getURL(`images/stat_range_attack.webp`)}"
                  class="calcium-troop-icon"
                  alt="${getLabelTrans('range_attack')}"
                  title="${getLabelTrans('range_attack')}"
                >
              </th>
              <th scope="col">
                <img
                  src="${chrome.runtime.getURL(`images/stat_hp.webp`)}"
                  class="calcium-troop-icon"
                  alt="${getLabelTrans('hp')}"
                  title="${getLabelTrans('hp')}"
                >
              </th>
              <th scope="col">
                <img
                  src="${chrome.runtime.getURL(`images/stat_defense.webp`)}"
                  class="calcium-troop-icon"
                  alt="${getLabelTrans('defense')}"
                  title="${getLabelTrans('defense')}"
                >
              </th>
              <th scope="col">
                <img
                  src="${chrome.runtime.getURL(`images/stat_speed.webp`)}"
                  class="calcium-troop-icon"
                  alt="${getLabelTrans('speed')}"
                  title="${getLabelTrans('speed')}"
                >
              </th>
              <th scope="col">
                <img
                  src="${chrome.runtime.getURL(`images/stat_range.webp`)}"
                  class="calcium-troop-icon"
                  alt="${getLabelTrans('range')}"
                  title="${getLabelTrans('range')}"
                >
              </th>
              <th scope="col">
                <img
                  src="${chrome.runtime.getURL(`images/stat_load.webp`)}"
                  class="calcium-troop-icon"
                  alt="${getLabelTrans('load')}"
                  title="${getLabelTrans('load')}"
                >
              </th>
              <th scope="col">
                <img
                  src="${chrome.runtime.getURL(`images/stat_upkeep.webp`)}"
                  class="calcium-troop-icon"
                  alt="${getLabelTrans('upkeeo')}"
                  title="${getLabelTrans('upkeep')}"
                >
              </th>
              <th scope="col">
                <img
                  src="${chrome.runtime.getURL(`images/stat_power.webp`)}"
                  class="calcium-troop-icon"
                  alt="${getLabelTrans('power')}"
                  title="${getLabelTrans('power')}"
                >
              </th>
              <th scope="col">${getLabelTrans('quantity')}</th>
            </tr>
          </thead>
          <tbody>
            ${troopsHtml}
          </tbody>
        </table>
      </div>
  `;

}

function renderPlayerTroopsTab(calcium) {
  const playerTroopStatEffect = getPlayerTroopStatEffects(calcium);

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
          const stats = troopDef?.stats?.['1'] ?? {};
          const playerTroop = playerTroopsByDefinitionId[troopDef?.id] || null;
          const troopLabel = escapeHtml(getLabelTrans(troopDef?.id, 'troop'));
          const troopAmount = escapeHtml(formatCompactNumber(playerTroop?.amount ?? 0));

          const meleeAttack = getModifiedTroopStat(calcium, 'melee_attack', stats.melee_attack);
          const rangeAttack = getModifiedTroopStat(calcium, 'range_attack', stats.range_attack);
          const hp = getModifiedTroopStat(calcium, 'hp', stats.hp);
          const defense = getModifiedTroopStat(calcium, 'defense', stats.defense);
          const speed = getModifiedTroopStat(calcium, 'speed', stats.speed);
          const range = getModifiedTroopStat(calcium, 'range',stats.range);
          const load = getModifiedTroopStat(calcium, 'load', stats.load);
          const upkeep = getModifiedTroopStat(calcium, 'upkeep', stats.upkeep);
          const power = getModifiedTroopStat(calcium, 'power', stats.power);

          return `
            <tr>
              <td>
                <div class="calcium-building-cell">
                  <div>
                    ${troopDef?.available
                      ? `<span class="calcium-building-indicator is-idle" title="Troupe disponible"></span>`
                      : `<span class="calcium-building-indicator" title="Troupe indisponible"></span>`
                    }
                    <span class="calcium-building-name">${troopLabel}</span>
                  </div>
                </div>
              </td>
              <td>${renderTroopStat(calcium, 'melee_attack', stats.melee_attack)}</td>
              <td>${renderTroopStat(calcium, 'range_attack', stats.range_attack)}</td>
              <td>${renderTroopStat(calcium, 'hp', stats.hp)}</td>
              <td>${renderTroopStat(calcium, 'defense', stats.defense)}</td>
              <td>${renderTroopStat(calcium, 'speed', stats.speed)}</td>
              <td>${renderTroopStat(calcium, 'range', stats.range)}</td>
              <td>${renderTroopStat(calcium, 'load', stats.load)}</td>
              <td>${renderTroopStat(calcium, 'upkeep', stats.upkeep)}</td>
              <td>${renderTroopStat(calcium, 'power', stats.power)}</td>
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
        <table class="calcium-table calcium-troops-table">
          <thead>
            <tr>
              <th scope="col">${getLabelTrans('troop')}</th>
              <th scope="col">
                <img
                  src="${chrome.runtime.getURL(`images/stat_melee_attack.webp`)}"
                  class="calcium-troop-icon"
                  alt="${getLabelTrans('melee_attack')}"
                  title="${getLabelTrans('melee_attack')}"
                >
              </th>
              <th scope="col">
                <img
                  src="${chrome.runtime.getURL(`images/stat_range_attack.webp`)}"
                  class="calcium-troop-icon"
                  alt="${getLabelTrans('range_attack')}"
                  title="${getLabelTrans('range_attack')}"
                >
              </th>
              <th scope="col">
                <img
                  src="${chrome.runtime.getURL(`images/stat_hp.webp`)}"
                  class="calcium-troop-icon"
                  alt="${getLabelTrans('hp')}"
                  title="${getLabelTrans('hp')}"
                >
              </th>
              <th scope="col">
                <img
                  src="${chrome.runtime.getURL(`images/stat_defense.webp`)}"
                  class="calcium-troop-icon"
                  alt="${getLabelTrans('defense')}"
                  title="${getLabelTrans('defense')}"
                >
              </th>
              <th scope="col">
                <img
                  src="${chrome.runtime.getURL(`images/stat_speed.webp`)}"
                  class="calcium-troop-icon"
                  alt="${getLabelTrans('speed')}"
                  title="${getLabelTrans('speed')}"
                >
              </th>
              <th scope="col">
                <img
                  src="${chrome.runtime.getURL(`images/stat_range.webp`)}"
                  class="calcium-troop-icon"
                  alt="${getLabelTrans('range')}"
                  title="${getLabelTrans('range')}"
                >
              </th>
              <th scope="col">
                <img
                  src="${chrome.runtime.getURL(`images/stat_load.webp`)}"
                  class="calcium-troop-icon"
                  alt="${getLabelTrans('load')}"
                  title="${getLabelTrans('load')}"
                >
              </th>
              <th scope="col">
                <img
                  src="${chrome.runtime.getURL(`images/stat_upkeep.webp`)}"
                  class="calcium-troop-icon"
                  alt="${getLabelTrans('upkeeo')}"
                  title="${getLabelTrans('upkeep')}"
                >
              </th>
              <th scope="col">
                <img
                  src="${chrome.runtime.getURL(`images/stat_power.webp`)}"
                  class="calcium-troop-icon"
                  alt="${getLabelTrans('power')}"
                  title="${getLabelTrans('power')}"
                >
              </th>
              <th scope="col">${getLabelTrans('quantity')}</th>
            </tr>
          </thead>
          <tbody>
            ${troopsHtml}
          </tbody>
        </table>
      </div>
      ${renderPlayerDragonTroopTab(calcium)}
    </div>
  `;
}

export { renderPlayerTroopsTab };
