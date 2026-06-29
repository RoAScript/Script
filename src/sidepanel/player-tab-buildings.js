import { pushAutomationTrace, savePersistentConfiguration, getAutomationTrace } from './state.js';
import {
  evaluateBuildingUpgradePrerequisites
} from './building-prerequisites-core.js';
import {
  UI_STATE,
  escapeHtml,
  formatDuration,
  formatDurationCompact,
  formatCompactNumber,
  getRemainingSeconds,
  getLabelTrans,
  requestCalciumApi,
  usePlayerItem,
  getItemActionReductionSeconds,
  formatDurationShort,
  applyOptimisticInventoryConsumption
} from './player-tab-core.js';

let rerenderBuildingsPlayerPanel = null;
let buildingAutomationRunning = false;
let buildingAutomationIntervalId = null;
let buildingAutomationIntervalSeconds = null;
let lastKnownActiveConstructionCount = 0;
let buildingCooldownUntil = 0;
let buildingAutomationCooldownUiIntervalId = null;
let lastTraceByType = {};

const coolDownConstruction = 10000;
const collapsedBuildingActions = new Set();

/* =========================================================
   ACCÉLÉRATEURS BÂTIMENTS
   ========================================================= */

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

      return (
        !!playerItem &&
        itemDef?.category === 'acceleration' &&
        itemDef?.usable === true &&
        itemDef?.targetable === true &&
        contexts.includes('building') &&
        reductionSeconds > 0
      );
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

function getBuildingActionCollapseKey(action) {
  return String(
    action?.uuid ||
    action?.id ||
    action?.['@id'] ||
    action?.metadata?.action_uuid ||
    action?.metadata?.actionUuid ||
    action?.metadata?.building_uuid ||
    action?.metadata?.buildingUuid ||
    ''
  );
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
        const itemLabel = getLabelTrans(itemDef?.id, 'item') || itemDef?.id || 'Item';

        return `
          <button
            type="button"
            class="calcium-accel-btn"
            data-item-uuid="${escapeHtml(playerItem?.uuid || '')}"
            data-action-uuid="${escapeHtml(action?.uuid || '')}"
            data-reduction-seconds="${escapeHtml(String(seconds))}"
            title="${escapeHtml(`${itemLabel} · stock ${stock}`)}"
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

  container.addEventListener('click', async (event) => {
    const collapseBtn = event.target.closest('.calcium-building-action-collapse');
    if (collapseBtn) {
      const collapseKey = collapseBtn.dataset.buildingActionCollapse;
      if (!collapseKey) return;

      if (collapsedBuildingActions.has(collapseKey)) {
        collapsedBuildingActions.delete(collapseKey);
      } else {
        collapsedBuildingActions.add(collapseKey);
      }

      rerenderBuildingsPlayerPanel?.();
      return;
    }

    const btn = event.target.closest('.calcium-accel-btn');
    if (!btn) return;

    const itemUuid = btn.dataset.itemUuid;
    const actionUuid = btn.dataset.actionUuid;
    if (!itemUuid || !actionUuid) return;

    btn.disabled = true;
    const previousText = btn.textContent;
    btn.textContent = '...';

    try {
      const response = await usePlayerItem(itemUuid, {
        count: 1,
        target: { type: 'action', value: actionUuid }
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
        if (!btn.isConnected) return;
        btn.disabled = false;
        btn.textContent = previousText;
      }, 250);
    }
  });
}

function buildBuildingActionsSummary() {
  const calcium = UI_STATE.snapshot?.calcium || null;

  const actions = [...(UI_STATE.snapshot?.derived?.buildingActions || [])]
    .filter((action) => !action.finished)
    .sort((a, b) => getRemainingSeconds(a) - getRemainingSeconds(b));

  if (!actions.length) {
    return `
      <div class="calcium-actions-empty">Aucune action de bâtiment en cours</div>
    `;
  }

  return `
    <div class="calcium-actions-list">
      ${actions.map((action) => {

        const collapseKey = getBuildingActionCollapseKey(action);
        const isCollapsed = collapseKey && collapsedBuildingActions.has(collapseKey);
        const settlement = calcium.Data?.Player?.settlements?.find(item => item.uuid === action.metadata.settlement_uuid);

        const buildingUuid =
          action.metadata?.building_uuid ||
          action.metadata?.buildingUuid;

        const building = getPlayerBuildings().find((entry) => {
          return String(entry?.uuid || '') === String(buildingUuid || '');
        });

        const remainingSeconds = getRemainingSeconds(action);

        const currentLevel = Number(
          action.metadata?.currentLevel ??
          building?.level ??
          0
        );

        const targetLevel = Number(
          action.metadata?.targetLevel ??
          currentLevel + 1
        );

        const buildingName =
          getLabelTrans(building?.definitionId, 'buildings') ||
          building?.label ||
          'Bâtiment inconnu';

        const iconSrc = chrome.runtime.getURL(`images/${building?.definitionId}.webp`);

        return `
          <div class="calcium-action-item calcium-building-action-item ${isCollapsed ? 'is-collapsed' : ''}"
              data-building-action-key="${escapeHtml(collapseKey)}">

            <div class="calcium-action-main calcium-building-action-main">

              <button
                type="button"
                class="calcium-building-action-collapse"
                data-building-action-collapse="${escapeHtml(collapseKey)}"
                title="${isCollapsed ? 'Déplier les accélérateurs' : 'Replier les accélérateurs'}"
                aria-label="${isCollapsed ? 'Déplier les accélérateurs' : 'Replier les accélérateurs'}"
                aria-expanded="${isCollapsed ? 'false' : 'true'}">
                ▾
              </button>

              <span class="calcium-action-badge"></span>

              <img
                src="${iconSrc}"
                class="calcium-building-icon"
                alt="${escapeHtml(buildingName)}"
                title="${escapeHtml(buildingName)}"
              >

              <div class="calcium-action-info">
                <div class="calcium-action-title">
                  ${escapeHtml(buildingName)} - ${escapeHtml(settlement?.name)}
                </div>
                <div class="calcium-action-meta">
                  ${escapeHtml(String(currentLevel))} -> ${escapeHtml(String(targetLevel))}
                </div>
              </div>

              <div class="calcium-action-timer" data-building-remaining-seconds="${remainingSeconds}">
                ${escapeHtml(formatDuration(remainingSeconds))}
              </div>

            </div>

            ${calcium ? buildAccelerationBuildingButtons(action, calcium) : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/* =========================================================
   DONNÉES BÂTIMENTS / SETTLEMENTS
   ========================================================= */

function getPlayerSettlements() {
  return Array.isArray(UI_STATE.snapshot?.calcium?.Data?.Player?.settlements)
    ? UI_STATE.snapshot.calcium.Data.Player.settlements
    : [];
}

function getPlayerBuildings() {
  return Array.isArray(UI_STATE.snapshot?.calcium?.Data?.Player?.building)
    ? UI_STATE.snapshot.calcium.Data.Player.building
    : [];
}

function getBuildingsBySettlement() {
  const buildings = getPlayerBuildings();
  const settlements = getPlayerSettlements();

  const settlementsByApiId = Object.fromEntries(
    settlements.map((settlement) => [settlement?.['@id'], settlement])
  );

  const grouped = buildings.reduce((acc, building) => {
    const settlementApiId = building?.settlement || '__unknown__';

    if (!acc[settlementApiId]) {
      acc[settlementApiId] = [];
    }

    acc[settlementApiId].push(building);

    return acc;
  }, {});

  return Object.entries(grouped)
    .map(([settlementApiId, settlementBuildings]) => {
      const settlement = settlementsByApiId[settlementApiId] || null;

      return {
        settlementApiId,
        settlement,
        label: settlement?.name || 'Inconnue',
        buildings: settlementBuildings
      };
    })
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

function ensureValidActiveBuildingSettlement() {
  const groups = getBuildingsBySettlement();
  const validIds = groups.map((group) => group.settlementApiId);

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
    <div class="calcium-building-settlement-tabs">
      ${groups.map((group) => `
        <button
          type="button"
          class="calcium-player-subtab ${UI_STATE.activeBuildingSettlement === group.settlementApiId ? 'active' : ''}"
          data-building-settlement="${escapeHtml(group.settlementApiId)}"
        >
          ${escapeHtml(group.label)}
        </button>
      `).join('')}
    </div>
  `;
}

function getBuildingAutomationState() {
  return UI_STATE.buildingAutomation || {
    enabled: false,
    scanIntervalSeconds: 10,
    targets: {}
  };
}

function getBuildingAutomationTargets() {
  return getBuildingAutomationState().targets || {};
}

function buildBuildingAutomationKey(settlementApiId, definitionId) {
  return `${settlementApiId || '__unknown_settlement__'}::${definitionId || '__unknown_building__'}`;
}

function getBuildingAutomationTarget(automationKey) {
  return getBuildingAutomationTargets()[automationKey] || {
    enabled: false,
    targetLevel: null
  };
}

function normalizeTargetLevel(value, fallback = 1) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.floor(parsed));
}

async function saveBuildingAutomationTarget(automationKey, patch = {}) {
  const currentAutomation = getBuildingAutomationState();
  const currentTargets = currentAutomation.targets || {};
  const currentTarget = currentTargets[automationKey] || {};

  const nextTarget = {
    ...currentTarget,
    ...patch
  };

  const nextTargets = {
    ...currentTargets,
    [automationKey]: nextTarget
  };

  await savePersistentConfiguration({
    buildingAutomation: {
      ...currentAutomation,
      targets: nextTargets
    }
  });
}

async function setBuildingAutomationEnabled(enabled) {
  const currentAutomation = getBuildingAutomationState();

  await savePersistentConfiguration({
    buildingAutomation: {
      ...currentAutomation,
      enabled: enabled === true,
      targets: currentAutomation.targets || {}
    }
  });
}

/* =========================================================
   AUTOMATISATION - DRY RUN / CANDIDAT
   ========================================================= */

function parseBuildingAutomationKey(key) {
  const raw = String(key || '');
  const separatorIndex = raw.indexOf('::');

  if (separatorIndex === -1) {
    return {
      settlementApiId: '',
      definitionId: raw
    };
  }

  return {
    settlementApiId: raw.slice(0, separatorIndex),
    definitionId: raw.slice(separatorIndex + 2)
  };
}

function getEnabledBuildingAutomationTargets() {
  const targets = getBuildingAutomationTargets();

  return Object.entries(targets)
    .filter(([, target]) => target?.enabled === true)
    .map(([key, target]) => ({
      key,
      enabled: true,
      targetLevel: normalizeTargetLevel(target?.targetLevel, 1)
    }));
}

function getAutomationCandidateBuildingsForTarget(calcium, targetEntry) {
  const { settlementApiId, definitionId } = parseBuildingAutomationKey(targetEntry.key);

  const buildings = Array.isArray(calcium?.Data?.Player?.building)
    ? calcium.Data.Player.building
    : [];

  const finalTargetLevel = normalizeTargetLevel(targetEntry.targetLevel, 1);

  return buildings
    .filter((building) => {
      const level = Number(building?.level || 0);

      return (
        String(building?.settlement || '') === String(settlementApiId || '') &&
        String(building?.definitionId || '') === String(definitionId || '') &&
        level < finalTargetLevel
      );
    })
    .sort((a, b) => {
      const levelA = Number(a?.level || 0);
      const levelB = Number(b?.level || 0);

      if (levelA !== levelB) return levelA - levelB;

      return String(a?.uuid || '').localeCompare(String(b?.uuid || ''));
    });
}

function getNextLevelToCheck(building, finalTargetLevel) {
  const currentLevel = Number(building?.level || 0);
  const normalizedFinalTargetLevel = normalizeTargetLevel(
    finalTargetLevel,
    currentLevel + 1
  );

  return Math.min(currentLevel + 1, normalizedFinalTargetLevel);
}

function evaluateAutomationBuilding(calcium, building, finalTargetLevel) {
  const nextLevelToCheck = getNextLevelToCheck(building, finalTargetLevel);

  return evaluateBuildingUpgradePrerequisites(
    calcium,
    building.uuid,
    {
      targetLevel: nextLevelToCheck,
      checkConstructionQueue: true
    }
  );
}

function getNextBuildingAutomationCandidate() {
  const calcium = UI_STATE.snapshot?.calcium || null;

  if (!calcium) {
    return {
      ok: false,
      reason: 'NO_CALCIUM_DATA',
      candidate: null,
      diagnostics: [],
      summary: {
        enabledTargets: 0,
        pendingBuildings: 0,
        ready: 0,
        blocked: 0,
        completedTargets: 0
      }
    };
  }

  const enabledTargets = getEnabledBuildingAutomationTargets();
  const diagnostics = [];
  let completedTargets = 0;

  enabledTargets.forEach((targetEntry) => {
    const candidateBuildings = getAutomationCandidateBuildingsForTarget(
      calcium,
      targetEntry
    );

    if (!candidateBuildings.length) {
      completedTargets += 1;
      return;
    }

    candidateBuildings.forEach((building) => {
      const diagnostic = evaluateAutomationBuilding(
        calcium,
        building,
        targetEntry.targetLevel
      );

      diagnostics.push({
        targetEntry,
        building,
        diagnostic
      });
    });
  });

  const ready = diagnostics.filter((entry) => {
    return entry?.diagnostic?.canUpgrade === true;
  });

  const blocked = diagnostics.filter((entry) => {
    return entry?.diagnostic?.canUpgrade !== true;
  });

  const sortedReady = [...ready].sort((a, b) => {
    const levelA = Number(a?.building?.level || 0);
    const levelB = Number(b?.building?.level || 0);

    if (levelA !== levelB) return levelA - levelB;

    const durationA = Number(a?.diagnostic?.duration || 0);
    const durationB = Number(b?.diagnostic?.duration || 0);

    if (durationA !== durationB) return durationA - durationB;

    return String(a?.building?.uuid || '').localeCompare(String(b?.building?.uuid || ''));
  });

  const candidate = sortedReady[0] || null;

  return {
    ok: true,
    reason: candidate ? 'CANDIDATE_FOUND' : 'NO_READY_CANDIDATE',
    candidate,
    diagnostics,
    summary: {
      enabledTargets: enabledTargets.length,
      pendingBuildings: diagnostics.length,
      ready: ready.length,
      blocked: blocked.length,
      completedTargets
    }
  };
}

/* =========================================================
   AUTOMATISATION - APPEL API RÉEL
   ========================================================= */

function upgradeBuilding(buildingUuid) {
  if (!buildingUuid) {
    return Promise.resolve({
      ok: false,
      error: 'NO_BUILDING_UUID'
    });
  }

  return requestCalciumApi(
    `/api/buildings/${buildingUuid}/upgrade`,
    {
      method: 'POST',
      json: {},
      headers: {
        'X-Calcium-No-Hp': 'true'
      }
    }
  );
}

function getUpdatedBuildingFromUpgradeResponse(response, fallbackBuilding) {
  if (response?.data?.uuid) return response.data;
  if (response?.json?.uuid) return response.json;
  if (response?.result?.uuid) return response.result;
  if (response?.body?.uuid) return response.body;
  if (response?.uuid) return response;

  if (fallbackBuilding?.uuid) {
    return {
      ...fallbackBuilding,
      status: 'building'
    };
  }

  return null;
}

function applyOptimisticBuildingUpgrade(updatedBuilding) {
  if (!updatedBuilding?.uuid) return;

  const buildings = UI_STATE.snapshot?.calcium?.Data?.Player?.building;

  if (!Array.isArray(buildings)) return;

  const index = buildings.findIndex((building) => {
    return String(building?.uuid || '') === String(updatedBuilding.uuid || '');
  });

  if (index === -1) return;

  buildings[index] = {
    ...buildings[index],
    ...updatedBuilding,
    status: updatedBuilding.status || 'building'
  };
}

function getActiveBuildingConstructionCount() {
  const actions = Array.isArray(UI_STATE.snapshot?.derived?.buildingActions)
    ? UI_STATE.snapshot.derived.buildingActions
    : [];

  return actions.filter((action) => !action?.finished).length;
}

function getBuildingCooldownRemainingSeconds() {
  const remainingMs = Math.max(0, buildingCooldownUntil - Date.now());

  return Math.ceil(remainingMs / 1000);
}

function updateBuildingAutomationCooldownUi() {
  const cooldownNode = document.querySelector('[data-building-automation-cooldown]');

  if (!cooldownNode) return;

  const remainingSeconds = getBuildingCooldownRemainingSeconds();

  cooldownNode.textContent = remainingSeconds > 0
    ? `Pause ${remainingSeconds}s`
    : 'Pause prête';

  cooldownNode.classList.toggle('is-waiting', remainingSeconds > 0);
}

function syncBuildingAutomationCooldownUiLoop() {
  if (buildingAutomationCooldownUiIntervalId) return;

  buildingAutomationCooldownUiIntervalId = window.setInterval(() => {
    updateBuildingAutomationCooldownUi();

    const automation = getBuildingAutomationState();
    const remainingSeconds = getBuildingCooldownRemainingSeconds();

    if (automation?.enabled !== true && remainingSeconds <= 0) {
      window.clearInterval(buildingAutomationCooldownUiIntervalId);
      buildingAutomationCooldownUiIntervalId = null;
    }
  }, 1000);
}

async function runBuildingAutomationTick() {
  const automation = getBuildingAutomationState();
  const currentActiveCount = getActiveBuildingConstructionCount();

  await pushAutomationTraceDedup({
    type: 'TICK',
    enabled: automation?.enabled === true,
    activeConstructions: currentActiveCount,
    cooldownRemaining: getBuildingCooldownRemainingSeconds()
  });


  if (currentActiveCount < lastKnownActiveConstructionCount) {
    buildingCooldownUntil = Date.now() + coolDownConstruction;

    console.log('[Calcium][building-automation] Fin de construction détectée, pause 10s');

    updateBuildingAutomationCooldownUi();
    syncBuildingAutomationCooldownUiLoop();
  }

  lastKnownActiveConstructionCount = currentActiveCount;

  if (automation?.enabled !== true) {
    return;
  }

  if (buildingAutomationRunning) {
    return;
  }

  if (getBuildingCooldownRemainingSeconds() > 0) {
    updateBuildingAutomationCooldownUi();
    return;
  }

  const result = getNextBuildingAutomationCandidate();
  await pushAutomationTraceDedup({
    type: 'SCAN_RESULT',
    summary: result?.summary
  });
  const candidate = result?.candidate || null;

  if (!candidate) {
    await pushAutomationTraceDedup({
      type: 'NO_CANDIDATE',
      reason: result?.reason,
      summary: result?.summary
    });
    return;
  }

  const building = candidate.building || null;
  const diagnostic = candidate.diagnostic || null;

  await pushAutomationTraceDedup({
    type: 'CANDIDATE_SELECTED',
    buildingUuid: building?.uuid,
    definitionId: building?.definitionId,
    currentLevel: diagnostic?.currentLevel,
    targetLevel: diagnostic?.targetLevel,
    finalTarget: candidate?.targetEntry?.targetLevel
  });

  if (!building?.uuid) {
    return;
  }

  if (diagnostic?.canUpgrade !== true) {
    await pushAutomationTraceDedup({
      type: 'BLOCKED',
      buildingUuid: building?.uuid,
      reason: diagnostic?.reason,
      missing: diagnostic?.missing
    });
    return;
  }

  buildingAutomationRunning = true;

  try {
    await pushAutomationTraceDedup({
      type: 'UPGRADE_START',
      buildingUuid: building.uuid,
      definitionId: building.definitionId
    });
    const response = await upgradeBuilding(building.uuid);

    if (!response?.ok) {
      const isAuthError = response?.status === 401;
      const isSynError = response?.status === 400;

      await pushAutomationTraceDedup({
        type: 'UPGRADE_FAILED',
        buildingUuid: building.uuid,
        response
      });

      if (isAuthError) {
        console.warn('[Calcium][automation] Auth KO → désactivation automation');
        await setBuildingAutomationEnabled(false);
      }
      if (isSynError) {
        console.warn('[Calcium][automation] Sync KO → désactivation automation');
        await setBuildingAutomationEnabled(false);
      }
      console.warn('[Calcium][building-automation] Upgrade KO', response);
      return;
    }

    await pushAutomationTraceDedup({
      type: 'UPGRADE_SUCCESS',
      buildingUuid: building.uuid
    });

    const updatedBuilding = getUpdatedBuildingFromUpgradeResponse(
      response,
      building
    );

    if (updatedBuilding?.uuid) {
      applyOptimisticBuildingUpgrade(updatedBuilding);
    }

    rerenderBuildingsPlayerPanel?.();
  } catch (error) {
    console.error('[Calcium][building-automation] Tick KO', error);
  } finally {
    buildingAutomationRunning = false;
  }
}

function syncBuildingAutomationLoop() {
  const automation = getBuildingAutomationState();
  const enabled = automation?.enabled === true;

  const intervalSeconds = normalizeTargetLevel(
    automation?.scanIntervalSeconds,
    10
  );

  syncBuildingAutomationCooldownUiLoop();
  updateBuildingAutomationCooldownUi();

  if (!enabled) {
    if (buildingAutomationIntervalId) {
      window.clearInterval(buildingAutomationIntervalId);
      buildingAutomationIntervalId = null;
      buildingAutomationIntervalSeconds = null;
    }

    return;
  }

  if (
    buildingAutomationIntervalId &&
    buildingAutomationIntervalSeconds === intervalSeconds
  ) {
    return;
  }

  if (buildingAutomationIntervalId) {
    window.clearInterval(buildingAutomationIntervalId);
    buildingAutomationIntervalId = null;
    buildingAutomationIntervalSeconds = null;
  }

  buildingAutomationIntervalSeconds = intervalSeconds;

  buildingAutomationIntervalId = window.setInterval(() => {
    runBuildingAutomationTick();
  }, intervalSeconds * 1000);

  runBuildingAutomationTick();
}

/* =========================================================
   AUTOMATISATION - PANNEAU VISUEL
   ========================================================= */

function formatBuildingAutomationCandidateLabel(candidate) {
  const building = candidate?.building || null;
  const diagnostic = candidate?.diagnostic || null;
  const targetEntry = candidate?.targetEntry || null;

  if (!building || !diagnostic) {
    return 'Aucune action prête';
  }

  const label =
    getLabelTrans(building.definitionId, 'buildings') ||
    building.definitionId ||
    'Bâtiment';

  const finalTargetLevel = normalizeTargetLevel(
    targetEntry?.targetLevel,
    diagnostic.targetLevel
  );

  return `${label} ${diagnostic.currentLevel} → ${diagnostic.targetLevel} / cible ${finalTargetLevel}`;
}

function formatBuildingAutomationCandidateTitle(candidate) {
  const building = candidate?.building || null;
  const diagnostic = candidate?.diagnostic || null;
  const targetEntry = candidate?.targetEntry || null;

  if (!building || !diagnostic) {
    return 'Aucun bâtiment éligible actuellement.';
  }

  const label =
    getLabelTrans(building.definitionId, 'buildings') ||
    building.definitionId ||
    'Bâtiment';

  const finalTargetLevel = normalizeTargetLevel(
    targetEntry?.targetLevel,
    diagnostic.targetLevel
  );

  const lines = [];

  lines.push(label);
  lines.push(`Prochaine montée : ${diagnostic.currentLevel} → ${diagnostic.targetLevel}`);
  lines.push(`Niveau cible final : ${finalTargetLevel}`);

  if (diagnostic.duration) {
    lines.push(`Durée : ${formatDuration(diagnostic.duration)}`);
  }

  if (diagnostic?.constructionQueue) {
    const queue = diagnostic.constructionQueue;

    if (queue.activeCount != null && queue.maxSimultaneous != null) {
      lines.push(`File construction : ${queue.activeCount} / ${queue.maxSimultaneous}`);
    }

    if (queue.requirementContext === 'city') {
      lines.push(
        queue.hasPremium
          ? 'Premium : 2 constructions simultanées autorisées en city.'
          : 'Standard : 1 construction simultanée autorisée en city.'
      );
    }

    if (
      queue.requirementContext === 'outpost' ||
      queue.requirementContext === 'water' ||
      queue.requirementContext === 'stone'
    ) {
      lines.push('Outpost : 1 construction simultanée autorisée.');
    }
  }

  return lines.join('\n');
}

function buildBuildingAutomationPanel() {
  const automation = getBuildingAutomationState();
  const enabled = automation.enabled === true;

  const scan = getNextBuildingAutomationCandidate();

  const summary = scan.summary || {
    enabledTargets: 0,
    pendingBuildings: 0,
    ready: 0,
    blocked: 0,
    completedTargets: 0
  };

  const candidate = scan.candidate || null;
  const candidateLabel = formatBuildingAutomationCandidateLabel(candidate);
  const candidateTitle = formatBuildingAutomationCandidateTitle(candidate);
  const cooldownRemainingSeconds = getBuildingCooldownRemainingSeconds();

  return `
    <div class="calcium-building-automation-panel">

      <div class="calcium-building-automation-main">

        <div class="calcium-building-automation-text">

          <div class="calcium-building-automation-title-row">

            <div class="calcium-building-automation-title">
              Automatisation bâtiments
            </div>

          </div>

          <div class="calcium-building-automation-subtitle">
            ${enabled ? 'Actif' : 'Inactif'}
          </div>

        </div>

        <button
          class="calcium-building-automation-toggle ${enabled ? 'is-active' : ''}"
          data-building-automation-toggle>
          ${enabled ? '⏸ Désactiver' : '▶ Activer'}
        </button>

      </div>

      <div class="calcium-building-automation-content">

        <div class="calcium-building-automation-stats">
          <div class="calcium-building-automation-chip ${enabled ? 'is-active' : ''}">
            ${enabled ? 'Actif' : 'Inactif'}
          </div>
          <div class="calcium-building-automation-chip ${cooldownRemainingSeconds > 0 ? 'is-waiting' : ''}">
            ${cooldownRemainingSeconds > 0 ? `Pause ${cooldownRemainingSeconds}s` : 'Pause prête'}
          </div>
          <div class="calcium-building-automation-chip">
            Cibles ${escapeHtml(String(summary.enabledTargets ?? 0))}
          </div>
          <div class="calcium-building-automation-chip">
            À traiter ${escapeHtml(String(summary.pendingBuildings ?? 0))}
          </div>
          <div class="calcium-building-automation-chip is-ok">
            Prêtes ${escapeHtml(String(summary.ready ?? 0))}
          </div>
          <div class="calcium-building-automation-chip is-ko">
            Bloquées ${escapeHtml(String(summary.blocked ?? 0))}
          </div>
          <div class="calcium-building-automation-chip">
            Atteintes ${escapeHtml(String(summary.completedTargets ?? 0))}
          </div>
        </div>

        <div class="calcium-building-automation-next">
          <div class="calcium-building-automation-next-label">
            Prochaine action
          </div>
          <div class="calcium-building-automation-next-value">
            ${escapeHtml(candidateLabel)}
          </div>
        </div>

      </div>

    </div>
  `;
}

/* =========================================================
   DIAGNOSTIC PRÉREQUIS
   ========================================================= */

function formatAutomationDiagnosticLabel(diagnostic) {
  if (!diagnostic?.ok) return 'Erreur';

  if (diagnostic.reason === 'MAX_LEVEL_REACHED') return 'Max';
  if (diagnostic.reason === 'TARGET_LEVEL_ALREADY_REACHED') return 'Atteint';
  if (diagnostic.reason === 'BUILDING_NOT_IDLE') return 'Occupé';
  if (diagnostic.reason === 'REQUIREMENT_NOT_FOUND') return 'Préreq. inconnu';

  if (diagnostic.canUpgrade) return 'OK';

  const missing = diagnostic.missing || {};

  if (missing.constructionQueue?.length) return 'File';
  if (missing.items?.length) return 'Objet';
  if (missing.buildings?.length) return 'Bâtiment';
  if (missing.resources?.length) return 'Ressources';
  if (missing.researches?.length) return 'Recherche';

  return 'Bloqué';
}

function getAutomationDiagnosticTone(diagnostic) {
  if (!diagnostic?.ok) return 'error';

  if (
    diagnostic.reason === 'MAX_LEVEL_REACHED' ||
    diagnostic.reason === 'TARGET_LEVEL_ALREADY_REACHED'
  ) {
    return 'neutral';
  }

  if (diagnostic.reason === 'BUILDING_NOT_IDLE') return 'warning';

  if (diagnostic.missing?.constructionQueue?.length) return 'queue';

  if (diagnostic.canUpgrade) {
    const activeCount = Number(diagnostic?.constructionQueue?.activeCount || 0);
    return activeCount > 0 ? 'queue' : 'ok';
  }

  return 'ko';
}

function formatMissingResourceLine(entry) {
  return `${entry.type}: ${formatCompactNumber(entry.available)} / ${formatCompactNumber(entry.required)}`
    + (entry.missing > 0 ? `, manque ${formatCompactNumber(entry.missing)}` : '');
}

function formatMissingItemLine(entry) {
  return `${entry.definitionId}: ${formatCompactNumber(entry.available)} / ${formatCompactNumber(entry.required)}`
    + (entry.missing > 0 ? `, manque ${formatCompactNumber(entry.missing)}` : '');
}

function formatMissingBuildingLine(entry) {
  const label = getLabelTrans(entry.definitionId, 'buildings') || entry.definitionId;

  return `${label}: niv. ${entry.availableLevel} / ${entry.requiredLevel}`;
}

function formatMissingResearchLine(entry) {
  const label = getLabelTrans(entry.definitionId, 'research') || entry.definitionId;

  return `${label}: niv. ${entry.availableLevel} / ${entry.requiredLevel}`;
}

function buildAutomationDiagnosticTooltip(diagnostic) {
  if (!diagnostic?.ok) {
    return diagnostic?.reason || 'Diagnostic indisponible';
  }

  const lines = [];
  const missing = diagnostic.missing || {};

  lines.push(`Niveau testé : ${diagnostic.currentLevel} → ${diagnostic.targetLevel}`);

  if (diagnostic.duration) {
    lines.push(`Durée : ${formatDuration(diagnostic.duration)}`);
  }

  if (diagnostic.reason === 'MAX_LEVEL_REACHED') {
    lines.push(`Niveau maximum atteint : ${diagnostic.maxLevel}`);
  }

  if (diagnostic.reason === 'TARGET_LEVEL_ALREADY_REACHED') {
    lines.push('Le niveau cible est déjà atteint.');
  }

  if (diagnostic.reason === 'BUILDING_NOT_IDLE') {
    lines.push(`Statut actuel : ${diagnostic.status || diagnostic.building?.status || 'occupé'}`);
  }

  if (diagnostic?.constructionQueue) {
    const queue = diagnostic.constructionQueue;

    if (queue.activeCount != null && queue.maxSimultaneous != null) {
      lines.push(`File construction : ${queue.activeCount} / ${queue.maxSimultaneous}`);
    }

    if (queue.requirementContext === 'city') {
      lines.push(
        queue.hasPremium
          ? 'Premium : 2 constructions simultanées autorisées en city.'
          : 'Standard : 1 construction simultanée autorisée en city.'
      );
    }

    if (
      queue.requirementContext === 'outpost' ||
      queue.requirementContext === 'water' ||
      queue.requirementContext === 'stone'
    ) {
      lines.push('Outpost : 1 construction simultanée autorisée.');
    }

    if (!queue.ok) {
      lines.push('File pleine : aucune place disponible actuellement.');
    }
  }

  if (missing.constructionQueue?.length) {
    lines.push('Capacité de construction atteinte.');
  }

  if (missing.resources?.length) {
    lines.push('Ressources manquantes :');

    missing.resources.forEach((entry) => {
      lines.push(`- ${formatMissingResourceLine(entry)}`);
    });
  }

  if (missing.items?.length) {
    lines.push('Objets manquants :');

    missing.items.forEach((entry) => {
      lines.push(`- ${formatMissingItemLine(entry)}`);
    });
  }

  if (missing.buildings?.length) {
    lines.push('Bâtiments prérequis :');

    missing.buildings.forEach((entry) => {
      lines.push(`- ${formatMissingBuildingLine(entry)}`);
    });
  }

  if (missing.researches?.length) {
    lines.push('Recherches prérequises :');

    missing.researches.forEach((entry) => {
      lines.push(`- ${formatMissingResearchLine(entry)}`);
    });
  }

  if (
    diagnostic.canUpgrade &&
    !missing.constructionQueue?.length &&
    !missing.resources?.length &&
    !missing.items?.length &&
    !missing.buildings?.length &&
    !missing.researches?.length
  ) {
    lines.push('Tous les prérequis directs sont remplis.');
  }

  return lines.join('\n');
}

function buildAutomationDiagnosticBadge(diagnostic) {
  const label = formatAutomationDiagnosticLabel(diagnostic);
  const tone = getAutomationDiagnosticTone(diagnostic);
  const tooltip = buildAutomationDiagnosticTooltip(diagnostic);

  return `
    <span
      class="calcium-building-auto-diagnostic calcium-building-auto-diagnostic-${escapeHtml(tone)}"
      title="${escapeHtml(tooltip)}"
    >
      ${escapeHtml(label)}
    </span>
  `;
}

function buildAutomationTraceTable() {
  const allTrace = getAutomationTrace() || [];
  const trace = allTrace.slice().reverse().slice(0, 10);

  if (!trace.length) {
    return `<div>Aucune trace</div>`;
  }

  return `
    <div class="calcium-player-section">
      
      <div class="calcium-row-between">
        <div class="calcium-player-subtitle">Trace automatisation</div>
        <button class="calcium-btn" data-copy-trace>
          📋 Copier
        </button>
      </div>

      <div class="calcium-table-wrap">
        <table class="calcium-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            ${trace.map(entry => `
              <tr>
                <td>${entry.at}</td>
                <td>${entry.type}</td>
                <td>
                  ${entry.definitionId || ''} 
                  ${entry.reason || ''} 
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* =========================================================
   TABLEAU BÂTIMENTS
   ========================================================= */

function buildGroupedBuildingsRowsBySettlement() {
  ensureValidActiveBuildingSettlement();

  const groups = getBuildingsBySettlement();

  const activeGroup = groups.find((group) => {
    return group.settlementApiId === UI_STATE.activeBuildingSettlement;
  });

  const buildings = Array.isArray(activeGroup?.buildings)
    ? activeGroup.buildings
    : [];

  if (!buildings.length) {
    return `
      <tr>
        <td colspan="5" class="calcium-cell-empty">Aucun bâtiment</td>
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
      getLabelTrans(key, 'buildings') ||
      building?.label ||
      key;

    if (!acc[key]) {
      acc[key] = {
        definitionId: key,
        label,
        count: 0,
        minLevel: level,
        maxLevel: level,
        candidateBuilding: building,
        hasAction: false,
        remainingSeconds: null
      };
    }

    acc[key].count += 1;
    acc[key].minLevel = Math.min(acc[key].minLevel, level);
    acc[key].maxLevel = Math.max(acc[key].maxLevel, level);

    if (level < Number(acc[key].candidateBuilding?.level || 0)) {
      acc[key].candidateBuilding = building;
    }

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

  return Object.values(groupedByDefinition)
    .sort((a, b) => String(a.label).localeCompare(String(b.label)))
    .map((group) => {
      const levelLabel =
        group.minLevel === group.maxLevel
          ? `Niv. ${group.minLevel}`
          : `Niv. ${group.minLevel} à ${group.maxLevel}`;

      const iconSrc = chrome.runtime.getURL(`images/${group.definitionId}.webp`);
      const iconAlt = escapeHtml(group.label);

      const automationKey = buildBuildingAutomationKey(
        activeGroup?.settlementApiId,
        group.definitionId
      );

      const automationTarget = getBuildingAutomationTarget(automationKey);
      const defaultTargetLevel = Number(group.maxLevel || 0) + 1;

      const finalTargetLevel = normalizeTargetLevel(
        automationTarget.targetLevel,
        defaultTargetLevel
      );

      const calcium = UI_STATE.snapshot?.calcium || null;

      const diagnostic =
        group.candidateBuilding?.uuid && calcium
          ? evaluateAutomationBuilding(
              calcium,
              group.candidateBuilding,
              finalTargetLevel
            )
          : {
              ok: false,
              canUpgrade: false,
              reason: 'NO_CANDIDATE_BUILDING'
            };

      return `
        <tr>
          <td>
            <div class="calcium-building-cell">
              <div>
                <span
                  class="calcium-building-indicator ${group.hasAction ? '' : 'is-idle'}"
                ></span>

                <img
                  class="calcium-building-icon"
                  src="${escapeHtml(iconSrc)}"
                  alt="${iconAlt}"
                  title="${iconAlt}"
                />

                <span class="calcium-building-meta">${escapeHtml(levelLabel)}</span>
              </div>
            </div>
          </td>

          <td>
            <label class="calcium-building-auto-toggle">
              <input
                type="checkbox"
                class="calcium-building-auto-checkbox"
                data-building-auto-enabled="true"
                data-building-auto-key="${escapeHtml(automationKey)}"
                data-building-auto-default-level="${escapeHtml(String(defaultTargetLevel))}"
                ${automationTarget.enabled ? 'checked' : ''}
              />
            </label>
          </td>

          <td>
            <input
              type="number"
              class="calcium-building-auto-level"
              min="1"
              step="1"
              value="${escapeHtml(String(finalTargetLevel))}"
              data-building-auto-target-level="true"
              data-building-auto-key="${escapeHtml(automationKey)}"
            />
          </td>

          <td>
            ${buildAutomationDiagnosticBadge(diagnostic)}
          </td>

          <td>
            ${
              group.hasAction && group.remainingSeconds != null
                ? `
                  <span
                    class="calcium-building-group-status is-active calcium-building-timer-pill"
                    data-building-remaining-seconds="${escapeHtml(String(group.remainingSeconds))}"
                    data-building-timer-format="compact"
                    title="${escapeHtml(formatDuration(group.remainingSeconds))}"
                  >
                    ⏱ ${escapeHtml(formatDurationCompact(group.remainingSeconds))}
                  </span>
                `
                : ''
            }
          </td>
        </tr>
      `;
    })
    .join('');
}

/* =========================================================
   RENDU PRINCIPAL
   ========================================================= */

function renderPlayerBuildingsTab() {
  return `
    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Actions de bâtiments</div>
      ${buildBuildingActionsSummary()}
    </div>

    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Bâtiments par cité</div>

      ${buildBuildingAutomationPanel()}

      ${buildBuildingSettlementTabs()}

      <div class="calcium-table-wrap">
        <table class="calcium-table calcium-building-auto-table">
          <thead>
            <tr>
              <th>Bâtiment</th>
              <th>Auto</th>
              <th>Niv. cible</th>
              <th>Préreq.</th>
              <th>Statut</th>
            </tr>
          </thead>

          <tbody>
            ${buildGroupedBuildingsRowsBySettlement()}
          </tbody>
        </table>
      </div>
    </div>

    ${buildAutomationTraceTable()}
  `;
}

/* =========================================================
   BINDINGS
   ========================================================= */

function findAutomationInputByKey(panel, selector, automationKey) {
  return Array.from(panel.querySelectorAll(selector)).find((node) => {
    return String(node.dataset.buildingAutoKey || '') === String(automationKey || '');
  }) || null;
}

async function pushAutomationTraceDedup(entry) {
  const type = entry?.type;

  if (!type) {
    return pushAutomationTrace(entry);
  }

  const previous = lastTraceByType[type];

  // comparaison simplifiée (clé métier)
  const isSame =
    previous &&
    JSON.stringify(cleanTraceForCompare(previous)) ===
    JSON.stringify(cleanTraceForCompare(entry));

  if (isSame) {
    return; // 🚫 skip duplicate
  }

  lastTraceByType[type] = entry;

  return pushAutomationTrace(entry);
}

function cleanTraceForCompare(entry) {
  const { at, id, ...rest } = entry;
  return rest;
}

function bindBuildingsTabEvents(panel, renderPlayerPanel) {
  rerenderBuildingsPlayerPanel = renderPlayerPanel;

  const automationToggle = panel.querySelector('[data-building-automation-toggle]');

  if (automationToggle) {
    automationToggle.addEventListener('click', async () => {
      const currentAutomation = getBuildingAutomationState();

      automationToggle.disabled = true;

      try {
        await setBuildingAutomationEnabled(currentAutomation.enabled !== true);
        syncBuildingAutomationLoop();
        rerenderBuildingsPlayerPanel?.();
      } catch (error) {
        console.error('[Calcium][building-automation] Toggle KO', error);

        if (automationToggle.isConnected) {
          automationToggle.disabled = false;
        }
      }
    });
  }

  panel.querySelectorAll('[data-building-settlement]').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveBuildingSettlement(button.dataset.buildingSettlement);
    });
  });

  panel.querySelectorAll('[data-building-auto-enabled]').forEach((input) => {
    input.addEventListener('change', async () => {
      const automationKey = input.dataset.buildingAutoKey;

      const defaultLevel = normalizeTargetLevel(
        input.dataset.buildingAutoDefaultLevel,
        1
      );

      const levelInput = findAutomationInputByKey(
        panel,
        '[data-building-auto-target-level]',
        automationKey
      );

      const targetLevel = normalizeTargetLevel(
        levelInput?.value,
        defaultLevel
      );

      input.disabled = true;

      try {
        await saveBuildingAutomationTarget(automationKey, {
          enabled: input.checked === true,
          targetLevel
        });

        rerenderBuildingsPlayerPanel?.();
      } catch (error) {
        console.error('[Calcium][building-automation] Save enabled KO', error);

        if (input.isConnected) {
          input.disabled = false;
        }
      }
    });
  });

  panel.querySelectorAll('[data-building-auto-target-level]').forEach((input) => {
    input.addEventListener('change', async () => {
      const automationKey = input.dataset.buildingAutoKey;
      const targetLevel = normalizeTargetLevel(input.value, 1);

      input.value = String(targetLevel);
      input.disabled = true;

      const enabledInput = findAutomationInputByKey(
        panel,
        '[data-building-auto-enabled]',
        automationKey
      );

      try {
        await saveBuildingAutomationTarget(automationKey, {
          enabled: enabledInput?.checked === true,
          targetLevel
        });

        rerenderBuildingsPlayerPanel?.();
      } catch (error) {
        console.error('[Calcium][building-automation] Save target level KO', error);

        if (input.isConnected) {
          input.disabled = false;
        }
      }
    });
  });

  const btn = panel.querySelector('[data-copy-trace]');
  btn?.addEventListener('click', async () => {
    try {
      const traces = getAutomationTrace() || [];
      const json = JSON.stringify(traces, null, 2);
      
      await navigator.clipboard.writeText(json);

      btn.textContent = '✅ Copié';
      setTimeout(() => {
        if (btn.isConnected) btn.textContent = 'Copier';
      }, 1500);

      console.log('[Automation][Trace] Copied 200 entries');
    } catch (e) {
      console.error('[Automation][Trace] Copy failed', e);
      btn.textContent = '❌ Erreur';
    }
  });

  syncBuildingAutomationLoop();
  bindBuildingAccelerationButtons(panel);
}

export {
  renderPlayerBuildingsTab,
  bindBuildingsTabEvents
};