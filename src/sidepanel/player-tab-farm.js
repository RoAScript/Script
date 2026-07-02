import { escapeHtml, formatCompactNumber, formatDuration, getLabelTrans } from './player-tab-core.js';

const FARM_DETAILS_STORAGE_KEY = 'calcium.farm.details.open.v1';
const FARM_REWARDS_STORAGE_KEY = 'calcium.farm.rewards.byBattle.v1';
const FARM_TAB_STORAGE_KEY = 'calcium.farm.activeTab';

let rerenderFarmPlayerPanel = null;

function getActiveFarmTab() {
  return localStorage.getItem(FARM_TAB_STORAGE_KEY) || 'runs';
}

function setActiveFarmTab(tab) {
  localStorage.setItem(FARM_TAB_STORAGE_KEY, tab);
}

function getCollection(value) {
  return Array.isArray(value) ? value : [];
}

function readFarmRewardsHistory() {
  try {
    const raw = localStorage.getItem(FARM_REWARDS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeFarmRewardsHistory(history) {
  try {
    localStorage.setItem(FARM_REWARDS_STORAGE_KEY, JSON.stringify(history || {}));
  } catch {
    // silencieux volontairement
  }
}

function bindFarmTabs(container, renderPlayerPanel) {
  rerenderFarmPlayerPanel = renderPlayerPanel;

  const buttons = container.querySelectorAll('[data-farm-tab]');

  buttons.forEach(btn => {
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();

      const tab = btn.dataset.farmTab;
      if (!tab) return;

      setActiveFarmTab(tab);

      if (typeof rerenderFarmPlayerPanel === 'function') {
        rerenderFarmPlayerPanel();
      }
    });
  });
}

function normalizeRewardObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((acc, [key, amount]) => {
    const numberValue = Number(amount || 0);

    if (!key || !Number.isFinite(numberValue)) {
      return acc;
    }

    acc[key] = numberValue;
    return acc;
  }, {});
}

function normalizeEventItems(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map(item => {
      if (typeof item === 'string') {
        return {
          id: item,
          amount: 1
        };
      }

      if (!item || typeof item !== 'object') {
        return null;
      }

      const id =
        item.item_id ||
        item.id ||
        item.definitionId ||
        item.definition_id ||
        null;

      if (!id) return null;

      return {
        id,
        amount: Number(item.amount || item.count || 1)
      };
    })
    .filter(Boolean);
}

function getWaveCountFromRun(run) {
  return Number(
    run?.action?.metadata?.wave_count ??
    run?.battle?.metadata?.wave_count ??
    0
  );
}

function getTicksAccruedFromRun(run) {
  return Number(run?.farmStatus?.ticksAccrued ?? 0);
}

function buildFarmRewardRecord(run) {
  const rewards = run?.farmStatus?.bankedRewards || {};
  const battleUuid = run?.battleUuid || null;

  if (!battleUuid) return null;

  return {
    battleUuid,
    actionUuid: run?.action?.uuid || null,

    waveCount: getWaveCountFromRun(run),
    ticksAccrued: getTicksAccruedFromRun(run),

    resources: normalizeRewardObject(rewards.resources),
    items: normalizeRewardObject(rewards.items),
    eventItems: normalizeEventItems(rewards.event_items),

    target: {
      name:
        run?.action?.metadata?.target_name ||
        run?.action?.metadata?.target_cell?.type ||
        null,
      level:
        run?.action?.metadata?.target_cell?.level ??
        run?.battle?.metadata?.target_level ??
        null,
      coordinates:
        run?.battle?.targetCoordinates ||
        run?.action?.metadata?.target_cell?.coordinate ||
        null
    },

    farm: {
      active: run?.farmStatus?.active === true,
      remainingFarmSeconds: Number(run?.farmStatus?.remainingFarmSeconds || 0),
      rewardIntervalSeconds: Number(run?.farmStatus?.rewardIntervalSeconds || 0),
      nextRewardInSeconds: Number(run?.farmStatus?.nextRewardInSeconds || 0),
      farmEndsAt: run?.farmStatus?.farmEndsAt || null
    },

    battleState:
      run?.battle?.state ||
      run?.battle?.battleLifecycleMarking ||
      run?.battle?.lifecycleMarking ||
      null,

    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/* =========================================================
   PERSISTENCE ÉTAT DETAILS FARM
   ========================================================= */

function readFarmDetailsState() {
  try {
    const raw = localStorage.getItem(FARM_DETAILS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeFarmDetailsState(state) {
  try {
    localStorage.setItem(FARM_DETAILS_STORAGE_KEY, JSON.stringify(state || {}));
  } catch {
    // volontairement silencieux : l'UI doit continuer à fonctionner
  }
}

function setFarmDetailsOpen(detailsKey, isOpen) {
  if (!detailsKey) return;

  const state = readFarmDetailsState();
  state[detailsKey] = isOpen === true;
  writeFarmDetailsState(state);
}

function isFarmDetailsOpen(detailsKey) {
  if (!detailsKey) return false;

  const state = readFarmDetailsState();
  return state[detailsKey] === true;
}

function getFarmDetailsKey(run) {
  return (
    run?.battleUuid ||
    run?.action?.metadata?.battle_uuid ||
    run?.action?.uuid ||
    run?.battle?.uuid ||
    'unknown-farm'
  );
}

function ensureFarmDetailsPersistenceBound() {
  if (window.__calciumFarmDetailsPersistenceBound === true) return;

  window.__calciumFarmDetailsPersistenceBound = true;

  document.addEventListener(
    'toggle',
    event => {
      const details = event.target;

      if (!(details instanceof HTMLDetailsElement)) return;
      if (!details.classList.contains('calcium-farm-details')) return;

      const detailsKey = details.dataset.farmDetailsKey;
      if (!detailsKey) return;

      setFarmDetailsOpen(detailsKey, details.open);
    },
    true
  );
}

function saveFarmRewardRecord(run) {
  const record = buildFarmRewardRecord(run);

  if (!record?.battleUuid) {
    return false;
  }

  const history = readFarmRewardsHistory();
  const previous = history[record.battleUuid] || null;

  history[record.battleUuid] = {
    ...record,
    firstSeenAt: previous?.firstSeenAt || record.firstSeenAt,
    updatedAt: new Date().toISOString()
  };

  writeFarmRewardsHistory(history);

  return true;
}

function saveFarmRewardRecords(runs) {
  if (!Array.isArray(runs) || !runs.length) {
    return;
  }

  runs.forEach(run => {
    const hasRewards =
      run?.farmStatus?.bankedRewards &&
      typeof run.farmStatus.bankedRewards === 'object';

    if (!hasRewards) return;

    saveFarmRewardRecord(run);
  });
}

function getFarmRewardsHistory() {
  return readFarmRewardsHistory();
}

function getFarmRewardsHistoryList() {
  return Object.values(readFarmRewardsHistory());
}

/* =========================================================
   FORMATTERS
   ========================================================= */

function formatDateSmart(isoString) {
  if (!isoString) return '—';

  const date = new Date(isoString);
  if (isNaN(date)) return '—';

  const diffSec = Math.floor((date - Date.now()) / 1000);
  const title = date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  return `
    <span title="${escapeHtml(title)}">
      ${escapeHtml(formatDuration(diffSec))}
    </span>
  `;
}

function formatCoordinate(coordinate) {
  if (!coordinate) return '—';

  const x = coordinate?.x;
  const y = coordinate?.y;

  if (x === undefined || y === undefined || x === null || y === null) {
    return '—';
  }

  return `${x}, ${y}`;
}

function formatTroops(troops = []) {
  const safeTroops = getCollection(troops);

  if (!safeTroops.length) {
    return '—';
  }

  return safeTroops
    .map(troop => {
      const troopId = troop?.troop_id || troop?.troopDefinitionId || 'unknown';
      const label = getLabelTrans(troopId, 'troop') || troopId;
      const amount = formatCompactNumber(troop?.amount || 0);

      return `${label} × ${amount}`;
    })
    .join(', ');
}

function formatRewards(rewards) {
  if (!rewards || typeof rewards !== 'object') {
    return '—';
  }

  const parts = [];

  const resources = rewards.resources || {};
  const resourceEntries = Object.entries(resources);

  if (resourceEntries.length) {
    parts.push(
      resourceEntries
        .map(([resourceId, amount]) => {
          const label = getLabelTrans(resourceId, 'resource') || resourceId;
          return `${label}: ${formatCompactNumber(amount || 0)}`;
        })
        .join(', ')
    );
  }

  const items = rewards.items || {};
  const itemEntries = Object.entries(items);

  if (itemEntries.length) {
    parts.push(
      itemEntries
        .map(([itemId, amount]) => {
          const label = getLabelTrans(itemId, 'item') || itemId;
          return `${label}: ${formatCompactNumber(amount || 0)}`;
        })
        .join(', ')
    );
  }

  const eventItems = Array.isArray(rewards.event_items)
    ? rewards.event_items
    : [];

  if (eventItems.length) {
    parts.push(
      eventItems
        .map(item => {
          if (typeof item === 'string') return item;
          return item?.item_id || item?.id || 'event_item';
        })
        .join(', ')
    );
  }

  return parts.length ? parts.join(' • ') : '—';
}

function formatStateLabel(value) {
  const state = String(value || '').trim();

  if (!state) return '—';

  const labels = {
    waiting_for_start: 'En attente',
    created: 'Créé',
    marching: 'En marche',
    auto_farming: 'Auto farm',
    finished: 'Terminé',
    resolved: 'Résolu',
    failed: 'Échec',
    attacker_won: 'attacker_won',
    defender_won: 'defender_won'
  };

  return labels[state] || state;
}

/* =========================================================
   DONNÉES FARM
   ========================================================= */

function getActionsFarm(calcium) {
  const actions = getCollection(calcium?.Data?.Actions);

  return actions.filter(action => {
    if (!action || typeof action !== 'object') return false;

    const isBattle =
      action?.calciumEntity === 'battle' ||
      String(action?.entity || '').includes('Battle');

    const metadata = action?.metadata || {};

    const isAutoFarm =
      metadata?.march_type === 'auto_farming' ||
      metadata?.marching_state === 'auto_farming' ||
      metadata?.from_auto_farming === true;

    return isBattle && isAutoFarm;
  });
}

function getBattleUuidFromAction(action) {
  return action?.metadata?.battle_uuid || null;
}

function getFarmRewardsTotals() {
  const history = getFarmRewardsHistoryList();

  const emptyTotals = {
    totalBattles: 0,
    totalWaveCount: 0,
    totalTicksAccrued: 0,
    totalAttacks: 0,
    resources: {},
    items: {},
    eventItems: {},
    byTarget: {}
  };

  if (!Array.isArray(history)) {
    return emptyTotals;
  }

  const totals = {
    totalBattles: history.length,
    totalWaveCount: 0,
    totalTicksAccrued: 0,
    totalAttacks: 0,
    resources: {},
    items: {},
    eventItems: {},
    byTarget: {}
  };

  // Helper ajout sécurisé
  function addAmount(bucket, key, value) {
    if (!key) return;

    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return;

    bucket[key] = (bucket[key] || 0) + amount;
  }

  // Helper pour eventItems (array)
  function addEventItems(bucket, eventItems) {
    if (!Array.isArray(eventItems)) return;

    eventItems.forEach(item => {
      if (!item) return;

      if (typeof item === 'string') {
        addAmount(bucket, item, 1);
        return;
      }

      if (typeof item !== 'object') return;

      const id =
        item.id ||
        item.item_id ||
        item.definitionId ||
        item.definition_id ||
        null;

      const amount = Number(item.amount || item.count || 1);

      if (!id) return;

      addAmount(bucket, id, amount);
    });
  }

  // 🔄 Parcours des runs
  history.forEach(entry => {
    if (!entry || typeof entry !== 'object') return;

    const waves = Number(entry.waveCount || 0);
    const ticks = Number(entry.ticksAccrued || 0);
    const attacks = waves * ticks;

    // GLOBAL
    totals.totalWaveCount += waves;
    totals.totalTicksAccrued += ticks;
    totals.totalAttacks += attacks;

    Object.entries(entry.resources || {}).forEach(([key, value]) => {
      addAmount(totals.resources, key, value);
    });

    Object.entries(entry.items || {}).forEach(([key, value]) => {
      addAmount(totals.items, key, value);
    });

    addEventItems(totals.eventItems, entry.eventItems || []);

    // PAR CIBLE
    const targetName = entry.target?.name || 'unknown';
    const targetLevel = entry.target?.level ?? 'x';
    const targetKey = `${targetName} ${targetLevel}`;

    if (!totals.byTarget[targetKey]) {
      totals.byTarget[targetKey] = {
        battles: 0,
        waveCount: 0,
        ticksAccrued: 0,
        totalAttacks: 0,
        resources: {},
        items: {},
        eventItems: {}
      };
    }

    const target = totals.byTarget[targetKey];

    target.battles += 1;
    target.waveCount += waves;
    target.ticksAccrued += ticks;
    target.totalAttacks += attacks;

    Object.entries(entry.resources || {}).forEach(([key, value]) => {
      addAmount(target.resources, key, value);
    });

    Object.entries(entry.items || {}).forEach(([key, value]) => {
      addAmount(target.items, key, value);
    });

    addEventItems(target.eventItems, entry.eventItems || []);
  });

  return totals;
}

function getBattleForAction(calcium, action) {
  const battleUuid = getBattleUuidFromAction(action);
  if (!battleUuid) return null;

  const battles = calcium?.Data?.Player?.battles || {};
  return battles[battleUuid] || null;
}

function getFarmStatusForAction(calcium, action) {
  const battleUuid = getBattleUuidFromAction(action);
  if (!battleUuid) return null;

  const farmStatus = calcium?.Data?.Player?.farmStatus || {};
  return farmStatus[battleUuid] || null;
}

/* =========================================================
   BADGES
   ========================================================= */

function renderStatusBadge(label, tone = 'muted') {
  return `
    <span class="calcium-badge calcium-badge-${escapeHtml(tone)}">
      ${escapeHtml(label)}
    </span>
  `;
}

function getFarmTone(run) {
  if (run?.farmStatus?.active === true) return 'success';
  if (run?.farmStatus && run?.farmStatus?.active !== true) return 'muted';
  return 'warning';
}

function getFarmLabel(run) {
  if (run?.farmStatus?.active === true) return 'Actif';
  if (run?.farmStatus && run?.farmStatus?.active !== true) return 'Inactif';
  return 'Statut non reçu';
}

/* =========================================================
   PRESETS
   ========================================================= */

function buildPresetRows(calcium) {
  const presets =
    calcium?.Data?.Player?.account?.metadata?.auto_farming_presets || [];

  if (!Array.isArray(presets) || !presets.length) {
    return `
      <div class="calcium-actions-empty">
        Aucun preset de farm disponible.
      </div>
    `;
  }

  return `
    <div class="calcium-table-wrap">
      <table class="calcium-table">
        <thead>
          <tr>
            <th>Preset</th>
            <th>Cible</th>
            <th>Vagues</th>
            <th>Troupes</th>
          </tr>
        </thead>
        <tbody>
          ${presets.map((preset, presetIndex) => {
            const lines = Array.isArray(preset?.lines) ? preset.lines : [];

            if (!lines.length) {
              return `
                <tr>
                  <td>${escapeHtml(preset?.name || `Preset ${presetIndex + 1}`)}</td>
                  <td colspan="3">Aucune ligne</td>
                </tr>
              `;
            }

            return lines.map((line, lineIndex) => {
              const target = line?.target || '—';
              const level = line?.level ?? '—';
              const waveAmount = line?.waveAmount ?? '—';
              const troops = formatTroops(line?.troops || []);

              return `
                <tr>
                  <td>
                    ${
                      lineIndex === 0
                        ? escapeHtml(preset?.name || `Preset ${presetIndex + 1}`)
                        : ''
                    }
                  </td>
                  <td>${escapeHtml(target)} niv.${escapeHtml(String(level))}</td>
                  <td>${escapeHtml(String(waveAmount))}</td>
                  <td>${escapeHtml(troops)}</td>
                </tr>
              `;
            }).join('');
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* =========================================================
   FARM EN COURS
   ========================================================= */

function buildFarmRunSummary(run) {
  const action = run.action;
  const battle = run.battle;
  const farmStatus = run.farmStatus;

  const targetFromAction = action?.metadata?.target_cell || {};
  const targetFromBattle = battle?.targetCoordinates || null;

  const targetName =
    action?.metadata?.target_name ||
    targetFromAction?.type ||
    'cible';

  const targetLevel =
    targetFromAction?.level ||
    battle?.metadata?.target_level ||
    '—';

  const coordinates =
    formatCoordinate(targetFromBattle) !== '—'
      ? formatCoordinate(targetFromBattle)
      : formatCoordinate(targetFromAction?.coordinate);

  const waveCount =
    action?.metadata?.wave_count ||
    battle?.metadata?.wave_count ||
    '—';

  const remainingAction = formatDuration(action?.remainingTime || 0);

  const remainingFarm = farmStatus
    ? formatDuration(farmStatus?.remainingFarmSeconds || 0)
    : '—';

  const nextReward = farmStatus
    ? formatDuration(farmStatus?.nextRewardInSeconds || 0)
    : '—';

  const rewardInterval = farmStatus
    ? formatDuration(farmStatus?.rewardIntervalSeconds || 0)
    : '—';

  const ticksAccrued =
    farmStatus?.ticksAccrued !== undefined
      ? String(farmStatus.ticksAccrued)
      : '—';

  const lifecycle =
    battle?.state ||
    battle?.battleLifecycleMarking ||
    battle?.lifecycleMarking ||
    '—';

  return `
    <div class="calcium-action-main">
      <span class="calcium-action-badge"></span>

      <div class="calcium-action-info">
        <div class="calcium-action-title">
          ${escapeHtml(targetName)} niv.${escapeHtml(String(targetLevel))}
          · ${escapeHtml(coordinates)}
        </div>

        <div class="calcium-action-meta">
          Battle ${escapeHtml(run.battleUuid || '—')}
        </div>
      </div>

      <div class="calcium-action-timer">
        ${escapeHtml(remainingFarm)}
      </div>
    </div>

    <div class="calcium-building-automation-stats">
      ${renderStatusBadge(getFarmLabel(run), getFarmTone(run))}
      ${renderStatusBadge(`Vagues x${waveCount}`, 'muted')}
      ${renderStatusBadge(`Gains ${ticksAccrued}`, 'muted')}
      ${renderStatusBadge(formatStateLabel(lifecycle), 'muted')}
    </div>
  `;
}

function buildFarmRunDetails(run) {
  const battle = run.battle;
  const farmStatus = run.farmStatus;

  const attackerTroops = battle?.attackerTroops || [];
  const rewards = farmStatus?.bankedRewards || null;

  const detailsKey = getFarmDetailsKey(run);
  const escapedDetailsKey = escapeHtml(detailsKey);
  const openAttribute = isFarmDetailsOpen(detailsKey) ? 'open' : '';

  return `
    <details
      class="calcium-quest-group calcium-farm-details"
      data-farm-details-key="${escapedDetailsKey}"
      ${openAttribute}
    >
      <summary class="calcium-quest-group-summary">
        <span class="calcium-quest-group-title">
          Détails
        </span>
        <span class="calcium-details-chevron"></span>
      </summary>

      <div class="calcium-quest-group-content">
        <div class="calcium-table-wrap">
          <table class="calcium-table">
            <tbody>
              <tr>
                <th>Troupes</th>
                <td>${escapeHtml(formatTroops(attackerTroops))}</td>
              </tr>
              <tr>
                <th>Récompenses</th>
                <td>${renderRewardsBlock(rewards)}</td>
              </tr>
              <tr>
                <th>Fin du farm</th>
                <td>${formatDateSmart(farmStatus?.farmEndsAt) || '—'}</td>
              </tr>
              <tr>
                <th>État battle</th>
                <td>${escapeHtml(formatStateLabel(battle?.state || battle?.battleLifecycleMarking))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </details>
  `;
}

/* =========================================================
   RÉCOMPENSES
   ========================================================= */

function renderRewardsBlock(rewards) {
  if (!rewards || typeof rewards !== 'object') {
    return '—';
  }

  const resources = Object.entries(rewards.resources || {});
  const items = Object.entries(rewards.items || {});
  const eventItems = Array.isArray(rewards.event_items)
    ? rewards.event_items
    : [];

  return `
    <div class="calcium-rewards-block">

      ${resources.length ? `
        <div class="calcium-rewards-section">
          <div class="calcium-rewards-title">Ressources</div>
          ${resources.map(([key, value]) => `
            <div class="calcium-rewards-line">
              <span>
                <img
                  src="${chrome.runtime.getURL(`images/${key}.webp`)}"
                  alt="${escapeHtml(getLabelTrans(key, 'resource') || key)}"
                  title="${escapeHtml(getLabelTrans(key, 'resource') || key)}"
                  class="calcium-resource-icon"
                >
              </span>
              <span>${escapeHtml(formatCompactNumber(value))}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${items.length ? `
        <div class="calcium-rewards-section">
          <div class="calcium-rewards-title">Objets</div>
          ${items.map(([key, value]) => `
            <div class="calcium-rewards-line">
              <span>${escapeHtml(getLabelTrans(key, 'item') || key)}</span>
              <span>× ${escapeHtml(formatCompactNumber(value))}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${eventItems.length ? `
        <div class="calcium-rewards-section">
          <div class="calcium-rewards-title">Événement</div>
          ${eventItems.map(item => `
            <div class="calcium-rewards-line">
              <span>${escapeHtml(item?.item_id || item?.id || item || 'item')}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

    </div>
  `;
}

/* =========================================================
   LISTE DES RUNS
   ========================================================= */

function buildFarmRuns(calcium) {
  const actions = getActionsFarm(calcium);

  if (!actions.length) {
    return `
      <div class="calcium-actions-empty">
        Aucun auto-farm en cours.
      </div>
    `;
  }

  const runs = actions
    .map(action => {
      const battleUuid = getBattleUuidFromAction(action);

      return {
        battleUuid,
        action,
        battle: getBattleForAction(calcium, action),
        farmStatus: getFarmStatusForAction(calcium, action)
      };
    })
    .filter(run => !!run.battleUuid);

  saveFarmRewardRecords(runs);

  if (!runs.length) {
    return `
      <div class="calcium-actions-empty">
        Des actions de farm existent, mais aucune ne contient de battle_uuid exploitable.
      </div>
    `;
  }

  return `
    <div class="calcium-actions-list">
      ${runs.map(run => `
        <div
          class="calcium-action-item calcium-building-action-item"
          data-farm-run="${escapeHtml(getFarmDetailsKey(run))}"
        >
          ${buildFarmRunSummary(run)}
          ${buildFarmRunDetails(run)}
        </div>
      `).join('')}
    </div>
  `;
}

/* =========================================================
   RENDER PRINCIPAL
   ========================================================= */

function renderFarmStats() {
  const data = getFarmRewardsTotals();

  if (!data.totalBattles) {
    return `
      <div class="calcium-actions-empty">
        Aucune donnée statistique disponible pour le moment.
      </div>
    `;
  }

  return `
    <div class="calcium-stats-grid">

      <div class="calcium-stat-card">
        <div class="calcium-stat-title">Attaques totales</div>
        <div class="calcium-stat-value">${data.totalAttacks}</div>
      </div>

      <div class="calcium-stat-card">
        <div class="calcium-stat-title">Tick moyen / farm</div>
        <div class="calcium-stat-value">
          ${(data.totalTicksAccrued / data.totalBattles).toFixed(1)}
        </div>
      </div>

    </div>

    <div class="calcium-player-section">
        <div class="calcium-player-subtitle">Drops par cible</div>

        <div class="calcium-table-wrap">
            <table class="calcium-table">
            <thead>
                <tr>
                <th>Cible</th>
                <th>Attaques</th>
                <th>Drops</th>
                </tr>
            </thead>

            <tbody>
                ${Object.entries(data.byTarget || {})
                .sort((a, b) => Number(b[1].totalAttacks || 0) - Number(a[1].totalAttacks || 0))
                .map(([targetKey, target]) => `
                    <tr>
                    <td>${escapeHtml(targetKey)}</td>
                    <td>${escapeHtml(formatCompactNumber(target.totalAttacks || 0))}</td>
                    <td>
                        ${renderDropLines(
                        target.items || {},
                        target.eventItems || {},
                        target.totalAttacks || 0
                        )}
                    </td>
                    </tr>
                `).join('')}
            </tbody>
            </table>
        </div>
    </div>
    <div class="calcium-player-section">
        <div class="calcium-player-subtitle">Drops cumulés</div>

        <div class="calcium-table-wrap">
            <table class="calcium-table">
            <thead>
                <tr>
                <th>Type</th>
                <th>Récompenses</th>
                </tr>
            </thead>

            <tbody>
                <tr>
                <th>Items</th>
                <td>
                    ${renderDropLines(data.items || {}, {}, data.totalAttacks || 0)}
                </td>
                </tr>

                <tr>
                <th>Event items</th>
                <td>
                    ${renderDropLines({}, data.eventItems || {}, data.totalAttacks || 0)}
                </td>
                </tr>
            </tbody>
            </table>
        </div>
    </div>
  `;
}

function formatDropPercent(amount, totalAttacks) {
  const attacks = Number(totalAttacks || 0);

  if (!attacks) {
    return '0.00 %';
  }

  return `${((Number(amount || 0) / attacks) * 100).toFixed(2)} %`;
}

function renderDropLines(items = {}, eventItems = {}, totalAttacks = 0) {
  const itemEntries = Object.entries(items || {})
    .filter(([, amount]) => Number(amount || 0) > 0)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));

  const eventItemEntries = Object.entries(eventItems || {})
    .filter(([, amount]) => Number(amount || 0) > 0)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));

  if (!itemEntries.length && !eventItemEntries.length) {
    return '—';
  }

  return `
    <div class="calcium-drop-lines">
      ${itemEntries.map(([key, amount]) => {
        const label = getLabelTrans(key, 'item') || key;

        return `
          <div class="calcium-drop-line">
            <span class="calcium-drop-name">${escapeHtml(label)}</span>
            <span class="calcium-drop-count">× ${escapeHtml(formatCompactNumber(amount))}</span>
            <span class="calcium-drop-percent">${escapeHtml(formatDropPercent(amount, totalAttacks))}</span>
          </div>
        `;
      }).join('')}

      ${eventItemEntries.map(([key, amount]) => {
        const label = getLabelTrans(key, 'item') || key;

        return `
          <div class="calcium-drop-line calcium-drop-line-event">
            <span class="calcium-drop-name">${escapeHtml(label)}</span>
            <span class="calcium-drop-count">× ${escapeHtml(formatCompactNumber(amount))}</span>
            <span class="calcium-drop-percent">${escapeHtml(formatDropPercent(amount, totalAttacks))}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderPlayerFarmTab(calcium) {
  ensureFarmDetailsPersistenceBound();

  const activeTab = getActiveFarmTab();

  return `
    <div class="calcium-tabs">

      <button class="calcium-tab ${activeTab === 'runs' ? 'active' : ''}"
        data-farm-tab="runs">
        Attaque
      </button>

      <button class="calcium-tab ${activeTab === 'stats' ? 'active' : ''}"
        data-farm-tab="stats">
        Stats
      </button>

      <button class="calcium-tab ${activeTab === 'presets' ? 'active' : ''}"
        data-farm-tab="presets">
        Presets
      </button>

    </div>

    <div class="calcium-tab-content">
      ${
        activeTab === 'runs'
          ? `
            <div class="calcium-player-section">
              <div class="calcium-player-subtitle">Farm en cours</div>
              ${buildFarmRuns(calcium)}
            </div>
          `
          : ''
      }

      ${
        activeTab === 'stats'
          ? `
            <div class="calcium-player-section">
              <div class="calcium-player-subtitle">Statistiques</div>
              ${renderFarmStats()}
            </div>
          `
          : ''
      }

      ${
        activeTab === 'presets'
          ? `
            <div class="calcium-player-section">
              <div class="calcium-player-subtitle">Presets de farm</div>
              ${buildPresetRows(calcium)}
            </div>
          `
          : ''
      }

    </div>
  `;
}

export {
  renderPlayerFarmTab,
  getActionsFarm,
  bindFarmTabs
};