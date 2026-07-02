(function () {
  'use strict';

  const Inspector = window.CalciumInspector;
  if (!Inspector || !Inspector.coreLoaded || Inspector.uiMainLoaded) return;

  Inspector.uiMainLoaded = true;

  const STATE = Inspector.state;
  const API = Inspector.api;

  const Calcium = {
    bearer: null,
    guid: {
      account: null,
      player: null,
      realm: null,
      alliance: null,
    },
    Data: {
      Alliance: {
        members: [],
      },
      Player: {
        uuid: null,
        username: null,
        power: 0,
        tax: 0,
        level: 0,
        search: [],
        resource: [],
        building: [],
        troop: [],
        items: [],
        settlements: [],
        quests: [],
        account: [],
        battles: {},
        farmStatus: {}
      },
      Actions: [],
      Buildings: [],
      Search: [],
      Realm: [],
      Resource: [],
      Troop: [],
      Item: [],
      Settlement: [],
      Quest: [],
    }
  };

  if (!STATE.uiEnabled) {
    console.log('[Calcium] UI désactivée dans cette frame');
    return;
  }

  const REQUEST_SOURCE = 'CALCIUM_BRIDGE_REQUEST';
  const RESPONSE_SOURCE = 'CALCIUM_BRIDGE_RESPONSE';
  const PUSH_SOURCE = 'CALCIUM_BRIDGE_PUSH';
  const CONFIGURATION_STORAGE_KEY = 'calcium.configuration.v1';

  let lastPublishedSignature = null;
  let actionsWatcherIntervalId = null;
  let appliedCompletedActionUuids = new Set();
  let appliedCompletedActionBusinessKeys = new Set();
  let forcedBuildingLevelsByUuid = new Map();
  let derivedBuildingActions = [];

  function isPageReload() {
    const nav = performance.getEntriesByType('navigation');
    return nav.length && nav[0].type === 'reload';
  }

  function safePostMessage(payload) {
    window.postMessage(payload, window.location.origin);
  }

  function getLabelTrans(str, type, lang = 'fr') {
    if (!str || !type) return str ?? '';
    const dict = window.CalciumI18n?.[lang]?.[type] ?? {};
    return dict[str] ?? str;
  }

  function getBuildingLabel(definitionId, lang = 'fr') {
    return getLabelTrans(definitionId, 'buildings', lang);
  }

  function getRemainingSeconds(action) {
    if (!action || action.finished) return 0;

    const endTimestamp = new Date(action.endAt).getTime();
    if (Number.isNaN(endTimestamp)) {
      return Math.max(0, Number(action.remainingTime || 0));
    }

    return Math.max(0, Math.floor((endTimestamp - Date.now()) / 1000));
  }

  function getActionsByType(type) {
    return Calcium.Data.Actions.filter(action =>
      action.calciumEntity === String(type).toLowerCase()
    );
  }

  function getLatestCategoryEntry(categoryKey) {
    const entries = STATE.dataByCategory?.[categoryKey];

    if (!Array.isArray(entries) || !entries.length) {
      return null;
    }

    return entries[entries.length - 1] || null;
  }

  function getActionByTypeAndUuid(type, uuid) {
    if (!type || !uuid) return null;

    const entityType = String(type).toLowerCase();
    const metadataKey = `${entityType}_uuid`;

    return Calcium.Data.Actions.find(action =>
      action.calciumEntity === entityType &&
      action.metadata?.[metadataKey] === String(uuid)
    ) || null;
  }

  function getGroupedBuildings() {
    const grouped = (Calcium.Data.Player.building || []).reduce((acc, building) => {
      const key = building.definitionId || 'unknown';
      const level = Number(building.level || 0);

      if (!acc[key]) {
        acc[key] = {
          definitionId: key,
          count: 0,
          minLevel: level,
          maxLevel: level,
          hasAction: false
        };
      }

      acc[key].count += 1;
      acc[key].minLevel = Math.min(acc[key].minLevel, level);
      acc[key].maxLevel = Math.max(acc[key].maxLevel, level);

      const buildingAction = getActionByTypeAndUuid('building', building.uuid);
      if (buildingAction) {
        acc[key].hasAction = true;
      }

      return acc;
    }, {});

    return Object.values(grouped).sort((a, b) =>
      getBuildingLabel(a.definitionId, 'fr').localeCompare(getBuildingLabel(b.definitionId, 'fr'))
    );
  }

  function getFilteredByVisibleCategories() {
    const categories = API.getVisibleCategories();
    const result = {};

    categories.forEach(category => {
      result[category] = API.getFilteredPayload(category);
    });

    return result;
  }

  function getSearchSummary() {
    return API.getSearchResultSummary();
  }

  function initDiscoverData() {
    const discoverData = STATE.dataByCategory['api.discover'] || [];
    const ids = discoverData?.[0]?.['@id'] || [];

    Calcium.guid.account = ids.find(v => v.startsWith('/accounts/'))?.split('/')[2] || null;
    Calcium.guid.player = ids.find(v => v.startsWith('/players/'))?.split('/')[2] || null;
    Calcium.guid.realm = ids.find(v => v.startsWith('/realms/'))?.split('/')[2] || null;
    Calcium.guid.alliance = ids.find(v => v.startsWith('/alliances/') && !v.includes('/members'))?.split('/')[2] || null;
  }

  function initTokenRefresh() {
    const tokenData = STATE.dataByCategory?.['api.token.refresh'] || [];
    const entry = tokenData[tokenData.length - 1] || null;

    Calcium.bearer = entry?.token || null;
  }

  function initRealmData() {
    const realmData = STATE.dataByCategory['api.realms'] || [];
    Calcium.Data.Realm = realmData?.[0]?.member?.[0];
  }

  function initBattleData() {
    const playerUuid = Calcium?.guid?.player || Calcium?.Data?.Player?.uuid;

    Calcium.Data.Player.battles = {};
    Calcium.Data.Player.farmStatus = {};

    if (!playerUuid) {
      return;
    }

    const battleBaseRegex = new RegExp(`^api\\.players\\.${playerUuid}\\.battles\\.([^.]+)$`);
    const farmStatusRegex = new RegExp(`^api\\.players\\.${playerUuid}\\.battles\\.([^.]+)\\.farm-status$`);

    Object.keys(STATE.dataByCategory || {}).forEach((categoryKey) => {
      const battleMatch = categoryKey.match(battleBaseRegex);

      if (battleMatch) {
        const battleUuid = battleMatch[1];
        const latestEntry = getLatestCategoryEntry(categoryKey);

        if (battleUuid && latestEntry) {
          Calcium.Data.Player.battles[battleUuid] = latestEntry;
        }

        return;
      }

      const farmStatusMatch = categoryKey.match(farmStatusRegex);

      if (farmStatusMatch) {
        const battleUuid = farmStatusMatch[1];
        const latestEntry = getLatestCategoryEntry(categoryKey);

        if (battleUuid && latestEntry) {
          Calcium.Data.Player.farmStatus[battleUuid] = latestEntry;
        }
      }
    });
  }

  function initPlayerData() {
    const playerData = STATE.dataByCategory[`api.accounts.${Calcium.guid.account}.players`]?.[0]?.member?.[0] || null;

    Calcium.Data.Player.account = playerData;
    Calcium.Data.Player.uuid = playerData?.uuid;
    Calcium.Data.Player.username = playerData?.username || null;
    Calcium.Data.Player.level = playerData?.level || 0;
    Calcium.Data.Player.power = playerData?.power || 0;
    Calcium.Data.Player.tax = playerData?.tax || 0;
  }

  function normalizeFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function initBuildingData() {
    const categoryDefKey = `api.definitions.building`;
    const rawDefCategory = STATE.dataByCategory[categoryDefKey];
    const defData = rawDefCategory?.[0]?.member ?? [];
    Calcium.Data.Buildings = defData;

    const buildingsData =
      STATE.dataByCategory[`api.players.${Calcium.guid.player}.buildings`]?.[0]?.member || [];

    const existingBuildingsByUuid = Object.fromEntries(
      (Calcium.Data.Player.building || []).map(building => [String(building.uuid || ''), building])
    );

    Calcium.Data.Player.building = buildingsData.map(buildingData => {
      const buildingUuid = String(buildingData.uuid || '');
      const existing = existingBuildingsByUuid[buildingUuid];

      const backendLevel = normalizeFiniteNumber(
        buildingData.level,
        normalizeFiniteNumber(existing?.level, 0)
      );

      const forcedLevel = forcedBuildingLevelsByUuid.get(buildingUuid);

      const resolvedLevel = Number.isFinite(Number(forcedLevel))
        ? Math.max(backendLevel, Number(forcedLevel))
        : backendLevel;

      if (
        Number.isFinite(Number(forcedLevel)) &&
        backendLevel >= Number(forcedLevel)
      ) {
        forcedBuildingLevelsByUuid.delete(buildingUuid);
      }

      return {
        definitionId: buildingData.definitionId,
        level: resolvedLevel,
        plot: buildingData.plot,
        uuid: buildingData.uuid,
        settlement: buildingData.settlement,
        status: existing?.status ?? buildingData.status ?? null,
        label: getBuildingLabel(buildingData.definitionId, 'fr')
      };
    });
  }

  function initActionData() {
    const categoryKey = `api.players.${Calcium.guid.player}.actions`;
    const rawCategory = STATE.dataByCategory[categoryKey];

    const latestEntry = Array.isArray(rawCategory) && rawCategory.length
      ? rawCategory[rawCategory.length - 1]
      : null;

    const actionsData = latestEntry?.member ?? [];

    // ✅ Actions serveur
    const serverActions = actionsData.map(actionData => {
      const endTimestamp = new Date(actionData.endAt).getTime();

      const remainingTime = Number.isNaN(endTimestamp)
        ? Math.max(0, Number(actionData.remainingTime ?? 0))
        : Math.max(0, Math.floor((endTimestamp - Date.now()) / 1000));

      return {
        ...actionData,
        finished: actionData.finished === true,
        remainingTime,
        calciumEntity: String(actionData.entity || '')
          .split('\\')
          .pop()
          .toLowerCase()
      };
    });

    // ✅ Actions dérivées persistantes (clé du fix)
    const validDerivedActions = derivedBuildingActions.filter(action => {
      if (!action) return false;

      // supprimée uniquement si terminée
      if (isActionAlreadyCompleted(action)) return false;

      // supprimée uniquement si backend a une vraie action équivalente ACTIVE
      const hasEquivalentServerAction = serverActions.some(server =>
        !server.finished && actionsLookEquivalent(action, server)
      );

      return !hasEquivalentServerAction;
    });

    Calcium.Data.Actions = [
      ...serverActions,
      ...validDerivedActions
    ];
  }

  function initResearchData() {
    const categoryDefKey = `api.definitions.research`;
    const rawDefCategory = STATE.dataByCategory[categoryDefKey];
    const defData = rawDefCategory?.[0]?.member ?? [];
    Calcium.Data.Search = defData;

    const categoryUserKey = `api.players.${Calcium.guid.player}.researches`;
    const rawUserCategory = STATE.dataByCategory[categoryUserKey];
    const userData = rawUserCategory?.[0]?.member ?? [];

    const existingResearchByUuid = Object.fromEntries(
      (Calcium.Data.Player.search || []).map(research => [research.uuid, research])
    );

    Calcium.Data.Player.search = userData.map(researchData => {
      const existing = existingResearchByUuid[researchData.uuid];

      return {
        ...researchData,
        level: existing?.level ?? researchData.level ?? 0,
        status: existing?.status ?? researchData.status ?? null
      };
    });
  }

  function initAllianceData() {
    const categoryAllianceKey = `api.alliances.${Calcium.guid.alliance}`;
    const categoryAllianceMembersKey = `api.alliances.${Calcium.guid.alliance}.members`;

    const rawAllianceCategory = STATE.dataByCategory[categoryAllianceKey];
    const rawAllianceMembersCategory = STATE.dataByCategory[categoryAllianceMembersKey];

    const allianceData = rawAllianceCategory?.[0] || null;
    const detailedMembers = rawAllianceMembersCategory?.[0]?.member || [];

    Calcium.Data.Alliance = allianceData
      ? {
          ...allianceData,
          members: detailedMembers
        }
      : {
          members: []
        };
  }

  function initResourceData() {
    const categoryDefKey = `api.definitions.resource`;
    const rawDefCategory = STATE.dataByCategory[categoryDefKey];
    const defData = rawDefCategory?.[0]?.member ?? [];
    Calcium.Data.Resource = defData;

    const categoryUserKey = `api.players.${Calcium.guid.player}.resources`;
    const rawUserCategory = STATE.dataByCategory[categoryUserKey];
    const userData = rawUserCategory?.[0]?.member ?? [];
    Calcium.Data.Player.resource = userData;
  }

  function initTroopData() {
    const categoryDefKey = `api.definitions.troop`;
    const rawDefCategory = STATE.dataByCategory[categoryDefKey];
    const defData = rawDefCategory?.[0]?.member ?? [];
    Calcium.Data.Troop = defData;

    const categoryUserKey = `api.players.${Calcium.guid.player}.troops`;
    const rawUserCategory = STATE.dataByCategory[categoryUserKey];
    const userData = rawUserCategory?.[0]?.member ?? [];
    Calcium.Data.Player.troop = userData;
  }

  function initItemData() {
    const categoryDefKey = `api.definitions.item`;
    const rawDefCategory = STATE.dataByCategory[categoryDefKey];
    const defData = rawDefCategory?.[0]?.member ?? [];
    Calcium.Data.Item = defData;

    const categoryUserKey = `api.players.${Calcium.guid.player}.items`;
    const rawUserCategory = STATE.dataByCategory[categoryUserKey];
    const userData = rawUserCategory?.[0]?.member ?? [];
    Calcium.Data.Player.items = userData;
  }

  function initSettlementData() {
    const categoryDefKey = `api.definitions.settlement`;
    const rawDefCategory = STATE.dataByCategory[categoryDefKey];
    const defData = rawDefCategory?.[0]?.member ?? [];
    Calcium.Data.Settlement = defData;

    const categoryUserKey = `api.players.${Calcium.guid.player}.settlements`;
    const rawUserCategory = STATE.dataByCategory[categoryUserKey];
    const userData = rawUserCategory?.[0]?.member ?? [];
    Calcium.Data.Player.settlements = userData;
  }

  function initQuestData() {
    const categoryDefKey = `api.definitions.quest`;
    const rawDefCategory = STATE.dataByCategory[categoryDefKey];
    const defData = rawDefCategory?.[0]?.member ?? [];
    Calcium.Data.Quest = defData;

    const categoryUserKey = `api.players.${Calcium.guid.player}.quests`;
    const rawUserCategory = STATE.dataByCategory[categoryUserKey];
    const userData = rawUserCategory?.[0]?.member ?? [];
    Calcium.Data.Player.quests = userData;
  }

  function refreshAllComputedData() {
    initDiscoverData();
    initRealmData();
    initPlayerData();
    initBuildingData();
    initActionData();
    initBattleData();
    initResearchData();
    initResourceData();
    initAllianceData();
    initTroopData();
    initSettlementData();
    initQuestData();
    initItemData();
    initTokenRefresh();
  }

  async function doRefreshToken() {
    if (!STATE.currentClientId) {
      return { ok: false, message: 'No clientId' };
    }

    try {
      const response = await window.fetch('/api/token/refresh', {
        method: 'GET',
        headers: { 'X-Auth-Client-Id': STATE.currentClientId },
        credentials: 'same-origin'
      });

      // ✅ IMPORTANT : injecter immédiatement le bearer
      if (data?.token) {
        Calcium.bearer = data.token;

        console.log('[Calcium][auth] Nouveau bearer injecté');
      } else {
        console.warn('[Calcium][auth] Pas de token dans la réponse refresh');
      }

      return {
        ok: response.ok,
        message: response.ok ? 'Refresh OK' : `ERR ${response.status}`
      };
    } catch (error) {
      console.error('[Calcium] refresh error:', error);
      return {
        ok: false,
        message: 'ERR'
      };
    }
  }

  function getActionMetadata(action) {
    return action?.metadata || {};
  }

  function getActionEntityName(action) {
    return String(action?.entity || action?.calciumEntity || '')
      .split('\\')
      .pop()
      .toLowerCase();
  }

  function getActionBuildingUuid(action) {
    const metadata = getActionMetadata(action);
    return (
      metadata.building_uuid ||
      metadata.buildingUuid ||
      null
    );
  }

  function getActionResearchUuid(action) {
    const metadata = getActionMetadata(action);
    return (
      metadata.research_uuid ||
      metadata.researchUuid ||
      null
    );
  }

  function getActionTargetLevel(action) {
    const metadata = getActionMetadata(action);
    const value =
      metadata.targetLevel ??
      metadata.target_level ??
      null;

    if (value === null || value === undefined || value === '') {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /**
   * Clés utilisées pour rapprocher une action locale dérivée
   * avec une action réelle backend.
   *
   * Important :
   * - on inclut une clé large building:<uuid> / research:<uuid>
   *   pour détecter que le backend a créé une action équivalente
   *   même si son UUID est différent et même s'il ne fournit pas targetLevel.
   * - ces clés larges ne doivent PAS être utilisées comme clés de complétion,
   *   sinon on bloquerait les upgrades suivants du même bâtiment.
   */
  function getActionMatchKeys(action) {
    if (!action) return [];

    const entity = getActionEntityName(action);
    const targetLevel = getActionTargetLevel(action);
    const keys = [];

    if (entity.includes('building')) {
      const buildingUuid = getActionBuildingUuid(action);
      if (!buildingUuid) return keys;

      keys.push(`building:${buildingUuid}`);

      if (targetLevel !== null) {
        keys.push(`building:${buildingUuid}:${targetLevel}`);
      }

      return keys;
    }

    if (entity.includes('research')) {
      const researchUuid = getActionResearchUuid(action);
      if (!researchUuid) return keys;

      keys.push(`research:${researchUuid}`);

      if (targetLevel !== null) {
        keys.push(`research:${researchUuid}:${targetLevel}`);
      }

      return keys;
    }

    if (action.uuid) {
      keys.push(`uuid:${action.uuid}`);
    }

    return keys;
  }

  /**
   * Clés utilisées pour mémoriser qu'une action est terminée.
   *
   * Ici on évite volontairement les clés larges du type building:<uuid>,
   * car un même bâtiment peut avoir plusieurs upgrades successifs.
   */
  function getActionCompletionKeys(action) {
    if (!action) return [];

    const entity = getActionEntityName(action);
    const targetLevel = getActionTargetLevel(action);
    const keys = [];

    if (action.uuid) {
      keys.push(`uuid:${action.uuid}`);
    }

    if (entity.includes('building')) {
      const buildingUuid = getActionBuildingUuid(action);
      if (buildingUuid && targetLevel !== null) {
        keys.push(`building:${buildingUuid}:${targetLevel}`);
      }
    }

    if (entity.includes('research')) {
      const researchUuid = getActionResearchUuid(action);
      if (researchUuid && targetLevel !== null) {
        keys.push(`research:${researchUuid}:${targetLevel}`);
      }
    }

    return keys;
  }

  function rememberCompletedAction(action) {
    if (!action) return;

    if (action.uuid) {
      appliedCompletedActionUuids.add(action.uuid);
    }

    getActionCompletionKeys(action).forEach(key => {
      appliedCompletedActionBusinessKeys.add(key);
    });
  }

  function isActionAlreadyCompleted(action) {
    if (!action) return false;

    if (action.uuid && appliedCompletedActionUuids.has(action.uuid)) {
      return true;
    }

    return getActionCompletionKeys(action).some(key =>
      appliedCompletedActionBusinessKeys.has(key)
    );
  }

  function actionsLookEquivalent(actionA, actionB) {
    const keysA = getActionMatchKeys(actionA);
    const keysB = new Set(getActionMatchKeys(actionB));

    return keysA.some(key => keysB.has(key));
  }

  function hasEquivalentActiveAction(candidateAction) {
    const actions = Calcium?.Data?.Actions || [];

    return actions.some(action => {
      if (!action || action.finished === true) return false;
      return actionsLookEquivalent(action, candidateAction);
    });
  }

  function markActionAsFinished(action) {
    if (!action) return;
    action.finished = true;
    action.remainingTime = 0;
  }

  function applyBuildingCompletion(action) {
    const buildingUuid =
      action?.metadata?.building_uuid ||
      action?.metadata?.buildingUuid;

    if (!buildingUuid) return false;

    const building = (Calcium.Data.Player.building || []).find(
      buildingItem => String(buildingItem?.uuid || '') === String(buildingUuid)
    );

    if (!building) return false;

    const currentLevel = normalizeFiniteNumber(building.level, 0);

    const targetLevel = normalizeFiniteNumber(
      action?.metadata?.targetLevel ?? action?.metadata?.target_level,
      currentLevel + 1
    );

    const nextLevel = Math.max(currentLevel + 1, targetLevel);

    building.level = nextLevel;
    building.status = 'stable';

    forcedBuildingLevelsByUuid.set(String(buildingUuid), nextLevel);

    console.log('[Calcium][building-completion] Niveau bâtiment forcé localement', {
      buildingUuid,
      completedActionUuid: action.uuid,
      currentLevel,
      targetLevel,
      nextLevel
    });

    return true;
  }

  function applyResearchCompletion(action) {
    const researchUuid = action?.metadata?.research_uuid;
    if (!researchUuid) return false;

    const research = (Calcium.Data.Player.search || []).find(
      researchItem => researchItem?.uuid === researchUuid
    );

    if (!research) return false;

    research.level = Number(research.level || 0) + 1;
    research.status = 'stable';
    return true;
  }

  function applyTroopCompletion(action) {
    return false;
  }

  function applyBattleCompletion(action) {
    return false;
  }

  function applyActionCompletion(action) {
    if (!action) return false;

    const entity = String(action.entity || '');

    if (entity.endsWith('Building')) {
      return applyBuildingCompletion(action);
    }

    if (entity.endsWith('Research')) {
      return applyResearchCompletion(action);
    }

    if (entity.endsWith('Troop')) {
      return applyTroopCompletion(action);
    }

    if (entity.endsWith('Battle') || entity === 'Battle') {
      return applyBattleCompletion(action);
    }

    return false;
  }

  function processFinishedActions() {
    const actions = Calcium.Data.Actions;

    if (!Array.isArray(actions) || actions.length === 0) {
      return false;
    }

    const now = Date.now();
    const finishedActionUuids = [];
    let hasMutation = false;

    actions.forEach(action => {
      if (!action) return;

      if (isActionAlreadyCompleted(action)) {
        finishedActionUuids.push(action.uuid);
        hasMutation = true;
        return;
      }

      if (action.finished === true) {
        rememberCompletedAction(action);
        finishedActionUuids.push(action.uuid);
        hasMutation = true;
        return;
      }

      if (!action.endAt) return;

      const endTimestamp = new Date(action.endAt).getTime();

      if (Number.isNaN(endTimestamp)) return;

      if (endTimestamp > now) {
        action.remainingTime = Math.max(0, Math.floor((endTimestamp - now) / 1000));
        return;
      }

      rememberCompletedAction(action);
      markActionAsFinished(action);
      applyActionCompletion(action);

      finishedActionUuids.push(action.uuid);
      hasMutation = true;
    });

    if (!hasMutation) {
      return false;
    }

    Calcium.Data.Actions = actions.filter(action => {
      if (!action) return false;

      if (action.uuid && finishedActionUuids.includes(action.uuid)) {
        return false;
      }

      return !isActionAlreadyCompleted(action);
    });

    derivedBuildingActions = derivedBuildingActions.filter(action => {
      return !isActionAlreadyCompleted(action);
    });

    return true;
  }

  function registerBuildingUpgradeActionFromResponse(responseJson) {
    try {
      const upgrade = Array.isArray(responseJson) ? responseJson[0] : responseJson;
      if (!upgrade || !upgrade.definitionId || !upgrade.uuid) {
        console.warn('[Calcium][building-upgrade] Réponse invalide ou vide:', responseJson);
        return false;
      }

      const buildingDefs = Calcium?.Data?.Buildings;
      const playerBuildings = Calcium?.Data?.Player?.building || [];
      const playerResearches = Calcium?.Data?.Player?.search || [];

      if (!Array.isArray(buildingDefs)) {
        console.warn('[Calcium][building-upgrade] Données Buildings/Actions indisponibles.');
        return false;
      }
      
      const definitionId = String(upgrade.definitionId);
      const buildingUuid = String(upgrade.uuid);
      const plot = upgrade.plot ?? null;
      const currentLevel = normalizeFiniteNumber(upgrade.level, 0);
      const targetLevel = currentLevel + 1;

      const actionUuid = `building-upgrade-${buildingUuid}-${targetLevel}`;

      const candidateAction = {
        uuid: actionUuid,
        entity: 'App\\Entity\\Building',
        calciumEntity: 'building',
        metadata: {
          derived: true,
          building_uuid: buildingUuid,
          buildingUuid: buildingUuid,
          definitionId,
          currentLevel,
          targetLevel
        }
      };

      const forcedLevel = forcedBuildingLevelsByUuid.get(buildingUuid);

      if (
        isActionAlreadyCompleted(candidateAction) ||
        appliedCompletedActionUuids.has(actionUuid) ||
        (Number.isFinite(Number(forcedLevel)) && Number(forcedLevel) >= targetLevel)
      ) {
        console.log('[Calcium][building-upgrade] action ignorée avant création', {
            reason: 'ALREADY_COMPLETED_OR_FORCED',
            actionUuid,
            buildingUuid,
            currentLevel,
            targetLevel,
            forcedLevel,
            isAlreadyCompleted: isActionAlreadyCompleted(candidateAction),
            uuidAlreadyCompleted: appliedCompletedActionUuids.has(actionUuid)
          });
        return false;
      }

      const buildingDef = buildingDefs.find(entry => entry?.id === definitionId);

      if (!buildingDef) {
        console.warn('[Calcium][building-upgrade] Définition introuvable pour:', definitionId);
        return false;
      }

      const playerBuilding = playerBuildings.find( building => String(building?.uuid || '') === buildingUuid);
      const settlementApiId = playerBuilding?.settlement || null;
      const settlements = Calcium?.Data?.Player?.settlements || [];
      const settlement = settlements.find(s => {
        return String(s?.['@id'] || s?.id || '') === String(settlementApiId);
      });

      if (!settlement) {
        console.warn('[Calcium][building-upgrade] settlement introuvable', settlementApiId);
      }

      const type = settlement?.type || 'city'; 
      const requirement = buildingDef?.requirements?.[String(type)]?.[String(targetLevel)];

      if (!requirement) {
        console.warn( '[Calcium][building-upgrade] Requirement city introuvable pour', definitionId, 'niveau', targetLevel);
        return false;
      }

      const baseDuration = Number(requirement.duration || 0);
      if (!baseDuration) {
        console.warn('[Calcium][building-upgrade] Duration absente/invalide pour', definitionId, 'niveau', targetLevel);
        return false;
      }

      const levitationResearch = playerResearches.find(
        research => research?.definitionId === 'levitation'
      );
      const levitationLevel = Number(levitationResearch?.level || 0);
      const reductionPercent = levitationLevel * 5;
      const reducedDuration = Math.max(1, Math.floor(baseDuration * (1 - reductionPercent / 100)));

      if (playerBuilding) {
        const localForcedLevel = forcedBuildingLevelsByUuid.get(buildingUuid);

        playerBuilding.definitionId = definitionId;
        playerBuilding.plot = plot;
        playerBuilding.level = Number.isFinite(Number(localForcedLevel))
          ? Math.max(currentLevel, Number(localForcedLevel))
          : currentLevel;
        playerBuilding.status = upgrade.status || 'building';
      } else {
        console.warn(
          '[Calcium][building-upgrade] Building joueur introuvable par uuid:',
          buildingUuid
        );
      }

      if (hasEquivalentActiveAction(candidateAction)) {
        console.log('[Calcium][building-upgrade] action ignorée car équivalente active', {
            actionUuid,
            buildingUuid,
            currentLevel,
            targetLevel,
            existingActions: Calcium.Data.Actions
          });
        return false;
      }

      const nowMs = Date.now();
      const startAt = new Date(nowMs).toISOString();
      const endAt = new Date(nowMs + reducedDuration * 1000).toISOString();

      if (appliedCompletedActionUuids.has(actionUuid)) {
        console.log(
          '[Calcium][building-upgrade] Action dérivée déjà terminée, non recréée:',
          actionUuid
        );
        return false;
      }

      const action = {
        uuid: actionUuid,
        entity: 'App\\Entity\\Building',
        calciumEntity: 'building',
        plot,
        startAt,
        endAt,
        remainingTime: reducedDuration,
        finished: false,
        metadata: {
          type: 'upgrade',
          category: 'building',
          derived: true,
          building_uuid: buildingUuid,
          buildingUuid: buildingUuid,
          definitionId,
          currentLevel,
          targetLevel,
          baseDuration,
          durationReductionPercent: reductionPercent,
          levitationLevel,
          settlement_uuid: settlement?.uuid,
          status: upgrade.status || null
        }
      };

      derivedBuildingActions.push(action);

      console.log(
        '[Calcium][building-upgrade] Action créée:',
        action,
        'baseDuration =', baseDuration,
        'levitationLevel =', levitationLevel,
        'reductionPercent =', reductionPercent,
        'reducedDuration =', reducedDuration
      );

      return true;
    } catch (error) {
      console.error('[Calcium][building-upgrade] Erreur création action:', error);
      return false;
    }
  }


  
  function registerResearchUpgradeActionFromResponse(responseJson) {
    try {
      const upgrade = Array.isArray(responseJson) ? responseJson[0] : responseJson;
      if (!upgrade || !upgrade.definitionId || !upgrade.uuid) {
        console.warn('[Calcium][research-upgrade] Réponse invalide ou vide:', responseJson);
        return false;
      }

      const researchDefs = Calcium?.Data?.Search;
      const actions = Calcium?.Data?.Actions;
      const playerResearches = Calcium?.Data?.Player?.search || [];

      if (!Array.isArray(researchDefs) || !Array.isArray(actions)) {
        console.warn('[Calcium][research-upgrade] Données Search/Actions indisponibles.');
        return false;
      }

      const definitionId = String(upgrade.definitionId);
      const researchUuid = String(upgrade.uuid);
      const currentLevel = Number(upgrade.level || 0);
      const targetLevel = currentLevel + 1;

      const researchDef = researchDefs.find(entry => String(entry?.id || '') === definitionId);
      if (!researchDef) {
        console.warn('[Calcium][research-upgrade] Définition introuvable pour:', definitionId);
        return false;
      }

      const baseDuration = Number(researchDef.duration || 0);
      if (!baseDuration) {
        console.warn(
          '[Calcium][research-upgrade] Duration absente/invalide pour',
          definitionId
        );
        return false;
      }

      const computedDuration = Math.max(1, Math.floor(baseDuration * Math.pow(2, currentLevel)));

      const playerResearch = playerResearches.find(
        research => String(research?.uuid || '') === researchUuid
      );

      if (playerResearch) {
        playerResearch.definitionId = definitionId;
        playerResearch.level = currentLevel;
        playerResearch.status = upgrade.status || 'searching';
      } else {
        console.warn(
          '[Calcium][research-upgrade] Recherche joueur introuvable par uuid:',
          researchUuid
        );
      }

      const candidateAction = {
        uuid: `research-upgrade-${researchUuid}-${targetLevel}`,
        entity: 'App\\Entity\\Research',
        calciumEntity: 'research',
        metadata: {
          derived: true,
          research_uuid: researchUuid,
          researchUuid: researchUuid,
          definitionId,
          currentLevel,
          targetLevel
        }
      };

      if (isActionAlreadyCompleted(candidateAction)) {
        console.log(
          '[Calcium][research-upgrade] Action déjà terminée, non recréée:',
          candidateAction.uuid
        );
        return false;
      }

      if (hasEquivalentActiveAction(candidateAction)) {
        console.log(
          '[Calcium][research-upgrade] Action équivalente déjà active pour',
          definitionId,
          'uuid recherche',
          researchUuid,
          'niveau cible',
          targetLevel
        );
        return false;
      }

      const nowMs = Date.now();
      const startAt = new Date(nowMs).toISOString();
      const endAt = new Date(nowMs + computedDuration * 1000).toISOString();
      const actionUuid = candidateAction.uuid;

      if (appliedCompletedActionUuids.has(actionUuid)) {
        console.log(
          '[Calcium][research-upgrade] Action dérivée déjà terminée, non recréée:',
          actionUuid
        );
        return false;
      }


      const action = {
        uuid: actionUuid,
        entity: 'App\\Entity\\Research',
        calciumEntity: 'research',
        startAt,
        endAt,
        remainingTime: computedDuration,
        finished: false,
        metadata: {
          type: 'upgrade',
          category: 'research',
          derived: true,
          research_uuid: researchUuid,
          definitionId,
          currentLevel,
          targetLevel,
          baseDuration,
          computedDuration,
          status: upgrade.status || null
        }
      };

      actions.push(action);

      console.log(
        '[Calcium][research-upgrade] Action créée:',
        action,
        'baseDuration =', baseDuration,
        'currentLevel =', currentLevel,
        'computedDuration =', computedDuration
      );

      return true;
    } catch (error) {
      console.error('[Calcium][research-upgrade] Erreur création action:', error);
      return false;
    }
  }

  function tryRegisterDerivedActionsFromDatasets() {
    let hasMutation = false;

    Object.entries(STATE.dataByCategory || {}).forEach(([categoryKey, entries]) => {
      const payloads = Array.isArray(entries) ? entries : [];

      if (/api\.buildings\.[^.]+\.upgrade/.test(categoryKey)) {
        console.log('[Calcium][upgrade-dataset] catégorie upgrade bâtiment trouvée', {
          categoryKey,
          payloadCount: payloads.length,
          payloads
        });

        payloads.forEach(entry => {
          const response = entry?.response ?? entry?.data ?? entry;

          console.log('[Calcium][upgrade-dataset] réponse upgrade bâtiment analysée', {
            categoryKey,
            response
          });

          const didCreate = registerBuildingUpgradeActionFromResponse(response);

          console.log('[Calcium][upgrade-dataset] résultat création action bâtiment', {
            categoryKey,
            didCreate
          });

          if (didCreate) {
            hasMutation = true;
          }
        });
      }

      if (/api\.researches\.[^.]+\.upgrade/.test(categoryKey)) {
        payloads.forEach(entry => {
          const response = entry?.response ?? entry?.data ?? entry;
          const didCreate = registerResearchUpgradeActionFromResponse(response);
          if (didCreate) {
            hasMutation = true;
          }
        });
      }
    });

    return hasMutation;
  }

  function buildSnapshot() {
    refreshAllComputedData();
    tryRegisterDerivedActionsFromDatasets();
    processFinishedActions();

    return {
      state: {
        uiEnabled: STATE.uiEnabled,
        currentFilter: STATE.currentFilter,
        currentClientId: STATE.currentClientId ? 'SET' : null
      },
      calcium: JSON.parse(JSON.stringify(Calcium)),
      visibleCategories: API.getVisibleCategories(),
      filteredByCategory: getFilteredByVisibleCategories(),
      requestsByCategory: JSON.parse(JSON.stringify(STATE.requestsByCategory)),
      requestMetaByCategory: JSON.parse(JSON.stringify(STATE.requestMetaByCategory)),
      searchSummary: JSON.parse(JSON.stringify(getSearchSummary())),
      derived: {
        groupedBuildings: JSON.parse(JSON.stringify(getGroupedBuildings())),
        buildingActions: JSON.parse(JSON.stringify(getActionsByType('building'))),
        searchActions: JSON.parse(JSON.stringify(getActionsByType('research'))),
        troopActions: JSON.parse(JSON.stringify(getActionsByType('troop'))),
        activeBuildingActions: JSON.parse(JSON.stringify(
          getActionsByType('building').filter(action => !action.finished)
        ))
      }
    };
  }

  function computeSignature(snapshot) {
    return JSON.stringify(snapshot);
  }

  function publishSnapshot(reason = 'state-changed', force = false) {
    const snapshot = buildSnapshot();
    const signature = computeSignature(snapshot);

    if (!force && signature === lastPublishedSignature) {
      return snapshot;
    }

    lastPublishedSignature = signature;

    safePostMessage({
      source: PUSH_SOURCE,
      payload: {
        reason,
        snapshot
      }
    });

    try {
      chrome.runtime.sendMessage({
        type: 'CALCIUM_STATE_UPDATED',
        snapshot,
        reason
      });
    } catch (error) {
      console.warn('[Calcium] Impossible de notifier le background:', error);
    }

    return snapshot;
  }

  function startActionsWatcher() {
    if (actionsWatcherIntervalId) return;

    actionsWatcherIntervalId = window.setInterval(() => {
      const didChange = processFinishedActions();

      if (didChange) {
        publishSnapshot('actions-expired', true);
      }
    }, 1000);
  }

  async function handleBridgeRequest(data) {
    if (data?.type === 'CALCIUM_GET_STATE') {
      return {
        ok: true,
        snapshot: buildSnapshot()
      };
    }

    if (data?.type === 'CALCIUM_SET_FILTER') {
      API.setFilter(data.filter || 'all');
      const snapshot = publishSnapshot('filter-changed', true);
      return {
        ok: true,
        snapshot
      };
    }

    if (data?.type === 'CALCIUM_SET_SEARCH_TEXT') {
      API.setSearchText(data.text || '');
      const snapshot = publishSnapshot('search-changed', true);
      return {
        ok: true,
        snapshot
      };
    }

    if (data?.type === 'CALCIUM_REFRESH_TOKEN') {
      return await doRefreshToken();
    }

    
    if (data?.type === 'CALCIUM_API_REQUEST') {
      const response = await calciumApiFetch(data.path, {
        method: data.method || 'GET',
        json: data.json,
        headers: data.headers || {}
      });

      const questClaimMatch = String(data.path || '').match(
        /^\/api\/players\/[^/]+\/quests\/([^/]+)\/claim$/
      );

      if (response?.ok && questClaimMatch) {
        const questUuid = questClaimMatch[1];
        const didMutate = applyQuestClaimToDatasets(questUuid);

        if (didMutate) {
          publishSnapshot('quest-claimed', true);
        }
      }

      const itemUseMatch = String(data.path || '').match(
        /^\/api\/players\/[^/]+\/items\/[^/]+\/use$/
      );

      const targetType = data?.json?.target?.type;
      const actionUuid = data?.json?.target?.value;

      if (response?.ok && itemUseMatch && targetType === 'action' && actionUuid) {
        const itemUuid = String(data.path).split('/items/')[1]?.split('/use')[0] || null;

        let reductionSeconds = 0;

        if (itemUuid) {
          const playerItems = Calcium?.Data?.Player?.items || [];
          const itemDefs = Calcium?.Data?.Item || [];

          const playerItem = playerItems.find((item) => String(item?.uuid || '') === String(itemUuid));
          const itemDef = itemDefs.find((def) => String(def?.id || '') === String(playerItem?.definitionId || ''));

          const effect = Array.isArray(itemDef?.effects)
            ? itemDef.effects.find((entry) => entry?.name === 'action_time_reduction')
            : null;

          reductionSeconds = Number(effect?.default ?? 0);
        }

        if (reductionSeconds > 0) {
          const didMutate = applyActionAccelerationToDatasets(actionUuid, reductionSeconds);

          if (didMutate) {
            publishSnapshot('action-accelerated', true);
          }
        }
      }

      return response;
    }

    return {
      ok: false,
      error: 'UNKNOWN_REQUEST'
    };
  }

  function applyActionAccelerationToDatasets(actionUuid, reductionSeconds) {
    if (!actionUuid || !reductionSeconds) {
      return false;
    }

    const playerUuid = Calcium?.guid?.player || Calcium?.Data?.Player?.uuid;
    if (!playerUuid) {
      return false;
    }

    const reductionMs = Number(reductionSeconds) * 1000;
    if (!Number.isFinite(reductionMs) || reductionMs <= 0) {
      return false;
    }

    const categoryKey = `api.players.${playerUuid}.actions`;
    const entries = STATE.dataByCategory?.[categoryKey];

    let hasMutation = false;

    if (Array.isArray(entries)) {
      entries.forEach((entry) => {
        const members = entry?.member;
        if (!Array.isArray(members)) return;

        const action = members.find(
          (item) => String(item?.uuid || '') === String(actionUuid)
        );
        if (!action) return;

        const currentEndTs = new Date(action?.endAt).getTime();
        if (Number.isNaN(currentEndTs)) return;

        const nextEndTs = Math.max(Date.now(), currentEndTs - reductionMs);

        action.endAt = new Date(nextEndTs).toISOString();
        action.remainingTime = Math.max(
          0,
          Math.floor((nextEndTs - Date.now()) / 1000)
        );

        if (action.remainingTime <= 0) {
          action.finished = true;
        }

        hasMutation = true;
      });
    }

    const calciumActions = Calcium?.Data?.Actions;
    if (Array.isArray(calciumActions)) {
      const action = calciumActions.find(
        (item) => String(item?.uuid || '') === String(actionUuid)
      );

      if (action) {
        const currentEndTs = new Date(action?.endAt).getTime();
        if (!Number.isNaN(currentEndTs)) {
          const nextEndTs = Math.max(Date.now(), currentEndTs - reductionMs);

          action.endAt = new Date(nextEndTs).toISOString();
          action.remainingTime = Math.max(
            0,
            Math.floor((nextEndTs - Date.now()) / 1000)
          );

          if (action.remainingTime <= 0) {
            action.finished = true;
          }

          hasMutation = true;
        }
      }
    }

    return hasMutation;
  }

  function findClientIdFromCapturedRequests() {
    if (STATE.currentClientId) return STATE.currentClientId;

    const categories = Object.keys(STATE.requestMetaByCategory || {});
    for (const category of categories) {
      if (!category.startsWith('api.definitions.')) continue;

      const metas = STATE.requestMetaByCategory[category] || [];
      for (let i = metas.length - 1; i >= 0; i -= 1) {
        const headers = metas[i]?.headers || {};
        const clientId =
          headers['x-auth-client-id'] ||
          headers['X-Auth-Client-Id'] ||
          null;

        if (clientId) {
          STATE.currentClientId = clientId;
          return clientId;
        }
      }
    }

    return null;
  }

  function applyQuestClaimToDatasets(questUuid) {
    if (!questUuid) return false;

    const playerUuid = Calcium?.guid?.player || Calcium?.Data?.Player?.uuid;
    if (!playerUuid) return false;

    const categoryKey = `api.players.${playerUuid}.quests`;
    const entries = STATE.dataByCategory?.[categoryKey];

    if (!Array.isArray(entries) || !entries.length) {
      return false;
    }

    let hasMutation = false;

    entries.forEach((entry) => {
      const members = entry?.member;
      if (!Array.isArray(members)) return;

      const quest = members.find((item) => String(item?.uuid || '') === String(questUuid));
      if (!quest) return;

      quest.claimed = true;
      quest.status = 'completed';
      quest.claimedAt = new Date().toISOString();
      hasMutation = true;
    });

    const playerQuests = Calcium?.Data?.Player?.quests;
    if (Array.isArray(playerQuests)) {
      const quest = playerQuests.find((item) => String(item?.uuid || '') === String(questUuid));
      if (quest) {
        quest.claimed = true;
        quest.status = 'completed';
        quest.claimedAt = new Date().toISOString();
        hasMutation = true;
      }
    }

    return hasMutation;
  }

  function getMandatorySessionHeaders({ withJson = false, includeHpHeaders = true } = {}) {
    const clientId = findClientIdFromCapturedRequests();
    const bearer = Calcium?.bearer || null;
    const realmId = Calcium?.guid?.realm || null;
    const hpItem = Calcium?.Data?.Realm?.variables?.item_use_honey_pot_value ?? null;
    const hpPlayer = Calcium?.Data?.Realm?.variables?.player_update_honey_pot_value ?? null;
    const hpMap = Calcium?.Data?.Realm?.variables?.map_honey_pot_value ?? null;
    const hpBattle = Calcium?.Data?.Realm?.variables?.battle_send_honey_pot_value;

    const headers = new Headers();

    headers.set('Accept', '*/*');

    if (withJson) {
      headers.set('Content-Type', 'application/json');
    }

    if (bearer) {
      headers.set('Authorization', `Bearer ${bearer}`);
    }

    if (clientId) {
      headers.set('X-Auth-Client-Id', String(clientId));
    }

    if (realmId) {
      headers.set('X-Realm-Id', String(realmId));
    }

    if (includeHpHeaders && hpItem !== null && hpItem !== undefined) {
      headers.set('X-Roa-Hp-Item', String(hpItem));
    }

    return headers;
  }

  async function calciumApiFetch(path, {
    method = 'GET',
    json = undefined,
    headers = {},
    credentials = 'include'
  } = {}) {

    async function executeFetch(withRefreshAttempt = false) {

      const noHpHeaders =
        headers?.['X-Calcium-No-Hp'] === 'true' ||
        headers?.['x-calcium-no-hp'] === 'true';

      const finalHeaders = getMandatorySessionHeaders({
        withJson: json !== undefined,
        includeHpHeaders: !noHpHeaders
      });

      Object.entries(headers || {}).forEach(([key, value]) => {
        const lowerKey = String(key).toLowerCase();

        if (lowerKey === 'x-calcium-no-hp') {
          return;
        }

        if (value !== undefined && value !== null) {
          finalHeaders.set(key, String(value));
        }
      });

      const response = await window.fetch(path, {
        method,
        credentials,
        cache: 'no-cache',
        headers: finalHeaders,
        body: json !== undefined ? JSON.stringify(json) : undefined
      });

      // ✅ CAS CRITIQUE : 401
      if (response.status === 401 && !withRefreshAttempt) {
        console.warn('[Calcium][API] '+response.status+' détecté → tentative refresh token');

        const refresh = await doRefreshToken();

        if (refresh?.ok) {
          console.log('[Calcium][API] refresh OK → retry requête');

          // ⚠️ IMPORTANT : recharger les données auth
          refreshAllComputedData();

          return executeFetch(true); // retry UNE SEULE FOIS
        }

        console.error('[Calcium][API] refresh KO → abandon');

        return {
          ok: false,
          status: 401,
          statusText: 'Unauthorized (refresh failed)',
          data: null
        };
      }

      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();

      let data = text;
      if (contentType.includes('application/json')) {
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          // on garde text brut
        }
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data
      };
    }

    return executeFetch(false);
  }

  async function useItem(playerUuid, itemUuid, payload = {}) {
    return calciumApiFetch(
      `/api/players/${playerUuid}/items/${itemUuid}/use`,
      {
        method: 'POST',
        json: payload
      }
    );
  }

  async function useCurrentPlayerItem(itemUuid, payload = {}) {
    const playerUuid = Calcium?.guid?.player || Calcium?.Data?.Player?.uuid;

    if (!playerUuid) {
      return { ok: false, error: 'NO_PLAYER_UUID' };
    }

    return useItem(playerUuid, itemUuid, payload);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;

    const data = event.data;
    if (!data || data.source !== REQUEST_SOURCE || !data.requestId) return;

    Promise.resolve(handleBridgeRequest(data.payload))
      .then((response) => {
        safePostMessage({
          source: RESPONSE_SOURCE,
          requestId: data.requestId,
          response
        });
      })
      .catch((error) => {
        safePostMessage({
          source: RESPONSE_SOURCE,
          requestId: data.requestId,
          response: {
            ok: false,
            error: error?.message || String(error)
          }
        });
      });
  });

  API.onDatasetReady(() => {
    console.log('[Calcium][SidePanel][MAIN] Dataset prêt');
    refreshAllComputedData();
    tryRegisterDerivedActionsFromDatasets();
    processFinishedActions();
    startActionsWatcher();
    publishSnapshot('dataset-ready', true);
  });

  API.onChange(() => {
    console.log('[Calcium][SidePanel][MAIN] Dataset prêt');
    refreshAllComputedData();
    tryRegisterDerivedActionsFromDatasets();
    processFinishedActions();
    publishSnapshot('api-change');
  });

  console.log('🚀 [Calcium] SidePanel MAIN prêt');
})();