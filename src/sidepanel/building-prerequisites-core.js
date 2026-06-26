function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function normalizeLevel(value, fallback = 1) {
  return Math.max(1, Math.floor(normalizeNumber(value, fallback)));
}

function getCollection(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.member)) return value.member;
  return [];
}

function getCurrentPlayerUuid(calcium) {
  return (
    calcium?.guid?.player ||
    calcium?.Data?.Player?.uuid ||
    null
  );
}

function getCurrentPlayerUsername(calcium) {
  return calcium?.Data?.Player?.username || null;
}

function isCurrentPlayerPremium(calcium) {
  const player = calcium?.Data?.Player || {};

  if (player?.has_premium === true) return true;
  if (player?.hasPremium === true) return true;
  if (player?.premium === true) return true;

  const playerUuid = getCurrentPlayerUuid(calcium);
  const username = getCurrentPlayerUsername(calcium);

  const allianceMembers = Array.isArray(calcium?.Data?.Alliance?.members)
    ? calcium.Data.Alliance.members
    : [];

  const currentAllianceMember = allianceMembers.find((member) => {
    const memberPlayer = member?.player || {};

    return (
      String(memberPlayer?.uuid || '') === String(playerUuid || '') ||
      String(memberPlayer?.username || '') === String(username || '')
    );
  });

  return currentAllianceMember?.player?.has_premium === true;
}

function getSettlementType(settlement) {
  return (
    settlement?.type ||
    settlement?.settlementType ||
    settlement?.kind ||
    null
  );
}

function getSettlementSubtype(settlement) {
  return (
    settlement?.subtype ||
    settlement?.settlementSubtype ||
    settlement?.resourceType ||
    settlement?.typeSubtype ||
    null
  );
}

function inferSettlementKindFromRequirementContext(context) {
  if (context === 'city') return 'city';
  if (context === 'outpost') return 'outpost';
  if (context === 'water') return 'outpost';
  if (context === 'stone') return 'outpost';

  return null;
}

function getSettlementBuildQueueLimit({
  calcium,
  settlement,
  requirementContext
}) {
  const explicitType = getSettlementType(settlement);
  const inferredType = inferSettlementKindFromRequirementContext(requirementContext);
  const settlementType = explicitType || inferredType;

  const hasPremium = isCurrentPlayerPremium(calcium);

  if (settlementType === 'city') {
    return hasPremium ? 2 : 1;
  }

  // Outpost water / stone / outpost générique
  return 1;
}

function evaluateConstructionQueueRequirement({
  calcium,
  settlement,
  settlementApiId,
  requirementContext
}) {
  const activeActions = getActiveBuildingActionsForSettlement(
    calcium,
    settlementApiId
  );

  const activeCount = activeActions.length;

  const maxSimultaneous = getSettlementBuildQueueLimit({
    calcium,
    settlement,
    requirementContext
  });

  const hasPremium = isCurrentPlayerPremium(calcium);

  const ok = activeCount < maxSimultaneous;

  return {
    ok,
    activeCount,
    maxSimultaneous,
    remainingSlots: Math.max(0, maxSimultaneous - activeCount),
    hasPremium,
    settlement: settlementApiId || null,
    requirementContext: requirementContext || null,
    actions: activeActions
  };
}

function getPlayerBuildings(calcium) {
  return getCollection(calcium?.Data?.Player?.building);
}

function getBuildingDefinitions(calcium) {
  return getCollection(calcium?.Data?.Buildings);
}

function getPlayerResources(calcium) {
  return getCollection(calcium?.Data?.Player?.resource);
}

function getPlayerItems(calcium) {
  return getCollection(calcium?.Data?.Player?.items);
}

function getPlayerResearches(calcium) {
  return getCollection(calcium?.Data?.Player?.search);
}

function getPlayerSettlements(calcium) {
  return getCollection(calcium?.Data?.Player?.settlements);
}

function getPlayerActions(calcium) {
  return getCollection(calcium?.Data?.Actions);
}

function findPlayerBuildingByUuid(calcium, buildingUuid) {
  return getPlayerBuildings(calcium).find((building) => {
    return String(building?.uuid || '') === String(buildingUuid || '');
  }) || null;
}

function findBuildingDefinition(calcium, definitionId) {
  return getBuildingDefinitions(calcium).find((definition) => {
    return String(definition?.id || '') === String(definitionId || '');
  }) || null;
}

function findSettlementByApiId(calcium, settlementApiId) {
  if (!settlementApiId) return null;

  return getPlayerSettlements(calcium).find((settlement) => {
    return (
      String(settlement?.['@id'] || '') === String(settlementApiId) ||
      String(settlement?.id || '') === String(settlementApiId) ||
      String(settlement?.uuid || '') === String(settlementApiId).split('/').pop()
    );
  }) || null;
}

function buildResourceMap(calcium) {
  return Object.fromEntries(
    getPlayerResources(calcium).map((resource) => [
      String(resource?.type || ''),
      normalizeNumber(resource?.amount, 0)
    ])
  );
}

function buildItemCountMap(calcium) {
  const result = {};

  getPlayerItems(calcium).forEach((item) => {
    const definitionId = String(item?.definitionId || '');
    if (!definitionId) return;

    result[definitionId] = (result[definitionId] || 0) + normalizeNumber(item?.count, 0);
  });

  return result;
}

function buildResearchLevelMap(calcium) {
  const result = {};

  getPlayerResearches(calcium).forEach((research) => {
    const definitionId = String(research?.definitionId || '');
    if (!definitionId) return;

    result[definitionId] = Math.max(
      result[definitionId] || 0,
      normalizeLevel(research?.level, 0)
    );
  });

  return result;
}

function getBuildingsInSettlement(calcium, settlementApiId) {
  return getPlayerBuildings(calcium).filter((building) => {
    return String(building?.settlement || '') === String(settlementApiId || '');
  });
}

function getHighestBuildingLevelInSettlement(calcium, settlementApiId, definitionId) {
  return getBuildingsInSettlement(calcium, settlementApiId)
    .filter((building) => String(building?.definitionId || '') === String(definitionId || ''))
    .reduce((maxLevel, building) => {
      return Math.max(maxLevel, normalizeLevel(building?.level, 0));
    }, 0);
}

function getActiveBuildingActionsForSettlement(calcium, settlementApiId) {
  const settlementBuildings = getBuildingsInSettlement(calcium, settlementApiId);
  const settlementBuildingUuids = new Set(
    settlementBuildings.map((building) => String(building?.uuid || ''))
  );

  return getPlayerActions(calcium).filter((action) => {
    if (!action || action.finished === true) return false;

    const entity = String(action?.entity || action?.calciumEntity || '').toLowerCase();
    const isBuildingAction = entity.includes('building');

    if (!isBuildingAction) return false;

    const actionBuildingUuid =
      action?.metadata?.building_uuid ||
      action?.metadata?.buildingUuid ||
      null;

    return settlementBuildingUuids.has(String(actionBuildingUuid || ''));
  });
}

function guessRequirementContext({ definition, settlement }) {
  const requirements = definition?.requirements || {};
  const keys = Object.keys(requirements);

  if (!keys.length) return null;

  const settlementSubtype =
    settlement?.subtype ||
    settlement?.settlementSubtype ||
    settlement?.typeSubtype ||
    settlement?.resourceType ||
    null;

  const settlementType =
    settlement?.type ||
    settlement?.settlementType ||
    null;

  if (settlementSubtype && requirements[settlementSubtype]) {
    return settlementSubtype;
  }

  if (settlementType && requirements[settlementType]) {
    return settlementType;
  }

  if (requirements.city) {
    return 'city';
  }

  if (requirements.outpost) {
    return 'outpost';
  }

  if (keys.length === 1 && typeof requirements[keys[0]] === 'object') {
    return keys[0];
  }

  return null;
}

function getRequirementForLevel({ definition, settlement, targetLevel }) {
  const requirements = definition?.requirements || {};
  const levelKey = String(targetLevel);

  if (requirements[levelKey]) {
    return {
      context: null,
      requirement: requirements[levelKey]
    };
  }

  const context = guessRequirementContext({ definition, settlement });

  if (!context) {
    return {
      context: null,
      requirement: null
    };
  }

  return {
    context,
    requirement: requirements?.[context]?.[levelKey] || null
  };
}

function evaluateResourceRequirements(requiredResources = {}, availableResources = {}) {
  return Object.entries(requiredResources || {}).map(([resourceType, requiredAmount]) => {
    const required = normalizeNumber(requiredAmount, 0);
    const available = normalizeNumber(availableResources?.[resourceType], 0);
    const missing = Math.max(0, required - available);

    return {
      type: resourceType,
      required,
      available,
      missing,
      ok: missing <= 0
    };
  });
}

function evaluateItemRequirements(requiredItems = {}, availableItems = {}) {
  return Object.entries(requiredItems || {}).map(([itemDefinitionId, requiredAmount]) => {
    const required = normalizeNumber(requiredAmount, 0);
    const available = normalizeNumber(availableItems?.[itemDefinitionId], 0);
    const missing = Math.max(0, required - available);

    return {
      definitionId: itemDefinitionId,
      required,
      available,
      missing,
      ok: missing <= 0
    };
  });
}

function evaluateBuildingRequirements(calcium, settlementApiId, requiredBuildings = {}) {
  return Object.entries(requiredBuildings || {}).map(([definitionId, requiredLevel]) => {
    const required = normalizeLevel(requiredLevel, 0);
    const available = getHighestBuildingLevelInSettlement(
      calcium,
      settlementApiId,
      definitionId
    );
    const missing = Math.max(0, required - available);

    return {
      definitionId,
      requiredLevel: required,
      availableLevel: available,
      missingLevel: missing,
      ok: missing <= 0
    };
  });
}

function evaluateResearchRequirements(requiredResearches = {}, availableResearches = {}) {
  return Object.entries(requiredResearches || {}).map(([definitionId, requiredLevel]) => {
    const required = normalizeLevel(requiredLevel, 0);
    const available = normalizeLevel(availableResearches?.[definitionId], 0);
    const missing = Math.max(0, required - available);

    return {
      definitionId,
      requiredLevel: required,
      availableLevel: available,
      missingLevel: missing,
      ok: missing <= 0
    };
  });
}

function getResearchRequirementsFromRequirement(requirement) {
  return (
    requirement?.researches ||
    requirement?.research ||
    requirement?.searches ||
    requirement?.search ||
    {}
  );
}

/**
 * Vérifie si un bâtiment joueur unique peut être amélioré.
 *
 * @param {object} calcium Snapshot Calcium complet.
 * @param {string} buildingUuid UUID du bâtiment joueur.
 * @param {object} options
 * @param {number|null} options.targetLevel Niveau cible à tester. Par défaut : niveau actuel + 1.
 * @param {boolean} options.checkConstructionQueue Si true, ajoute l'état des constructions en cours dans la cité.
 */
function evaluateBuildingUpgradePrerequisites(
  calcium,
  buildingUuid,
  {
    targetLevel = null,
    checkConstructionQueue = true
  } = {}
) {
  const building = findPlayerBuildingByUuid(calcium, buildingUuid);
  if (!building) {
    return {
      ok: false,
      canUpgrade: false,
      reason: 'BUILDING_NOT_FOUND',
      buildingUuid,
      building: null
    };
  }

  const definition = findBuildingDefinition(calcium, building.definitionId);
  if (!definition) {
    return {
      ok: false,
      canUpgrade: false,
      reason: 'BUILDING_DEFINITION_NOT_FOUND',
      buildingUuid,
      building,
      definition: null
    };
  }

  const currentLevel = normalizeLevel(building.level, 0);
  const nextLevel = targetLevel == null
    ? currentLevel + 1
    : normalizeLevel(targetLevel, currentLevel + 1);

  const maxLevel = normalizeLevel(definition.max_level, 0);

  if (maxLevel > 0 && nextLevel > maxLevel) {
    return {
      ok: true,
      canUpgrade: false,
      reason: 'MAX_LEVEL_REACHED',
      buildingUuid,
      building,
      definition,
      currentLevel,
      targetLevel: nextLevel,
      maxLevel
    };
  }

  if (nextLevel <= currentLevel) {
    return {
      ok: true,
      canUpgrade: false,
      reason: 'TARGET_LEVEL_ALREADY_REACHED',
      buildingUuid,
      building,
      definition,
      currentLevel,
      targetLevel: nextLevel,
      maxLevel
    };
  }

  /**
   * ✅ ✅ ✅ CORRECTIF CRITIQUE ICI
   * On remplace complètement le check basé sur building.status
   * par un check sur les actions actives
   */
  const actions = getPlayerActions(calcium);

  const hasActiveBuildingAction = actions.some((action) => {
    if (!action || action.finished === true) return false;

    const entity = String(action?.entity || '').toLowerCase();
    if (!entity.includes('building')) return false;

    const actionBuildingUuid =
      action?.metadata?.building_uuid ||
      action?.metadata?.buildingUuid ||
      null;

    return String(actionBuildingUuid || '') === String(building.uuid || '');
  });

  if (hasActiveBuildingAction) {
    return {
      ok: true,
      canUpgrade: false,
      reason: 'BUILDING_NOT_IDLE',
      buildingUuid,
      building,
      definition,
      currentLevel,
      targetLevel: nextLevel,
      maxLevel
    };
  }

  // 🔽 suite inchangée
  const settlement = findSettlementByApiId(calcium, building.settlement);

  const { context, requirement } = getRequirementForLevel({
    definition,
    settlement,
    targetLevel: nextLevel
  });

  if (!requirement) {
    return {
      ok: true,
      canUpgrade: false,
      reason: 'REQUIREMENT_NOT_FOUND',
      buildingUuid,
      building,
      definition,
      settlement,
      context,
      currentLevel,
      targetLevel: nextLevel,
      maxLevel
    };
  }

  const availableResources = buildResourceMap(calcium);
  const availableItems = buildItemCountMap(calcium);
  const availableResearches = buildResearchLevelMap(calcium);

  const resources = evaluateResourceRequirements(
    requirement.resources || {},
    availableResources
  );

  const items = evaluateItemRequirements(
    requirement.items || {},
    availableItems
  );

  const buildings = evaluateBuildingRequirements(
    calcium,
    building.settlement,
    requirement.buildings || {}
  );

  const researches = evaluateResearchRequirements(
    getResearchRequirementsFromRequirement(requirement),
    availableResearches
  );

  const constructionQueue = checkConstructionQueue
    ? evaluateConstructionQueueRequirement({
        calcium,
        settlement,
        settlementApiId: building.settlement,
        requirementContext: context
      })
    : {
        ok: true,
        activeCount: 0,
        maxSimultaneous: null,
        remainingSlots: null,
        settlement: building.settlement || null,
        requirementContext: context || null,
        actions: []
      };

  const blockingChecks = [
    ...resources,
    ...items,
    ...buildings,
    ...researches,
    constructionQueue
  ];

  const canUpgrade = blockingChecks.every((entry) => entry.ok === true);

  return {
    ok: true,
    canUpgrade,
    reason: canUpgrade ? 'OK' : 'PREREQUISITES_MISSING',
    buildingUuid,
    building,
    definition,
    settlement,
    context,
    currentLevel,
    targetLevel: nextLevel,
    maxLevel,
    requirement,
    duration: normalizeNumber(requirement.duration, 0),
    checks: {
      resources,
      items,
      buildings,
      researches
    },
    missing: {
      resources: resources.filter((entry) => !entry.ok),
      items: items.filter((entry) => !entry.ok),
      buildings: buildings.filter((entry) => !entry.ok),
      researches: researches.filter((entry) => !entry.ok),
      constructionQueue: constructionQueue.ok ? [] : [constructionQueue]
    },
    constructionQueue
  };
}

export {
  evaluateBuildingUpgradePrerequisites,
  findPlayerBuildingByUuid,
  findBuildingDefinition,
  getRequirementForLevel,
  getActiveBuildingActionsForSettlement
};