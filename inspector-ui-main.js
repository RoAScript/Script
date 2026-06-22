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

  let lastPublishedSignature = null;
  let actionsWatcherIntervalId = null;
  let appliedCompletedActionUuids = new Set();

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

  function initPlayerData() {
    const playerData = STATE.dataByCategory[`api.accounts.${Calcium.guid.account}.players`]?.[0]?.member?.[0] || null;

    Calcium.Data.Player.uuid = playerData?.uuid;
    Calcium.Data.Player.username = playerData?.username || null;
    Calcium.Data.Player.level = playerData?.level || 0;
    Calcium.Data.Player.power = playerData?.power || 0;
    Calcium.Data.Player.tax = playerData?.tax || 0;
  }

  function initBuildingData() {
    const categoryDefKey = `api.definitions.building`;
    const rawDefCategory = STATE.dataByCategory[categoryDefKey];
    const defData = rawDefCategory?.[0]?.member ?? [];
    Calcium.Data.Buildings = defData;

    const buildingsData = STATE.dataByCategory[`api.players.${Calcium.guid.player}.buildings`]?.[0]?.member || [];

    const existingBuildingsByUuid = Object.fromEntries(
      (Calcium.Data.Player.building || []).map(building => [building.uuid, building])
    );

    Calcium.Data.Player.building = buildingsData.map(buildingData => {
      const existing = existingBuildingsByUuid[buildingData.uuid];

      return {
        definitionId: buildingData.definitionId,
        level: existing?.level ?? buildingData.level ?? 0,
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
    const actionsData = rawCategory?.[0]?.member ?? [];

    const existingActionsByUuid = Object.fromEntries(
      (Calcium.Data.Actions || []).map(action => [action.uuid, action])
    );

    const derivedActions = (Calcium.Data.Actions || []).filter(
      action => action?.metadata?.derived === true
    );

    Calcium.Data.Actions = [
      ...actionsData
        .filter(actionData => !appliedCompletedActionUuids.has(actionData.uuid))
        .map(actionData => {
          const existing = existingActionsByUuid[actionData.uuid];
          const endTimestamp = new Date(actionData.endAt).getTime();
          const remainingTime = Number.isNaN(endTimestamp)
            ? Math.max(0, Number(actionData.remainingTime || existing?.remainingTime || 0))
            : Math.max(0, Math.floor((endTimestamp - Date.now()) / 1000));

          return {
            ...actionData,
            finished: existing?.finished ?? actionData.finished,
            remainingTime,
            calciumEntity: String(actionData.entity || '').split('\\').pop().toLowerCase()
          };
        }),
      ...derivedActions.filter(action => !appliedCompletedActionUuids.has(action.uuid))
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
      buildingItem => buildingItem?.uuid === buildingUuid
    );

    if (!building) return false;

    building.level = Number(building.level || 0) + 1;
    building.status = 'stable';
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
    if (!Array.isArray(actions) || actions.length === 0) return false;

    const now = Date.now();
    const finishedActionUuids = [];
    let hasMutation = false;

    actions.forEach(action => {
      if (!action) return;
      if (appliedCompletedActionUuids.has(action.uuid)) return;
      if (action.finished) return;
      if (!action.endAt) return;

      const endTimestamp = new Date(action.endAt).getTime();
      if (Number.isNaN(endTimestamp)) return;

      if (endTimestamp > now) {
        action.remainingTime = Math.max(0, Math.floor((endTimestamp - now) / 1000));
        return;
      }

      appliedCompletedActionUuids.add(action.uuid);
      markActionAsFinished(action);
      applyActionCompletion(action);
      finishedActionUuids.push(action.uuid);
      hasMutation = true;
    });

    if (!hasMutation) return false;

    Calcium.Data.Actions = actions.filter(
      action => !finishedActionUuids.includes(action?.uuid)
    );

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
      const actions = Calcium?.Data?.Actions;
      const playerBuildings = Calcium?.Data?.Player?.building || [];
      const playerResearches = Calcium?.Data?.Player?.search || [];

      if (!Array.isArray(buildingDefs) || !Array.isArray(actions)) {
        console.warn('[Calcium][building-upgrade] Données Buildings/Actions indisponibles.');
        return false;
      }

      const definitionId = String(upgrade.definitionId);
      const buildingUuid = String(upgrade.uuid);
      const plot = upgrade.plot ?? null;
      const currentLevel = Number(upgrade.level || 0);
      const targetLevel = currentLevel + 1;

      const buildingDef = buildingDefs.find(entry => entry?.id === definitionId);
      if (!buildingDef) {
        console.warn('[Calcium][building-upgrade] Définition introuvable pour:', definitionId);
        return false;
      }

      const requirement = buildingDef?.requirements?.city?.[String(targetLevel)];
      if (!requirement) {
        console.warn(
          '[Calcium][building-upgrade] Requirement city introuvable pour',
          definitionId,
          'niveau',
          targetLevel
        );
        return false;
      }

      const baseDuration = Number(requirement.duration || 0);
      if (!baseDuration) {
        console.warn(
          '[Calcium][building-upgrade] Duration absente/invalide pour',
          definitionId,
          'niveau',
          targetLevel
        );
        return false;
      }

      const levitationResearch = playerResearches.find(
        research => research?.definitionId === 'levitation'
      );
      const levitationLevel = Number(levitationResearch?.level || 0);
      const reductionPercent = levitationLevel * 5;
      const reducedDuration = Math.max(
        1,
        Math.floor(baseDuration * (1 - reductionPercent / 100))
      );

      const playerBuilding = playerBuildings.find(
        building => String(building?.uuid || '') === buildingUuid
      );

      if (playerBuilding) {
        playerBuilding.definitionId = definitionId;
        playerBuilding.plot = plot;
        playerBuilding.level = currentLevel;
        playerBuilding.status = upgrade.status || 'building';
      } else {
        console.warn(
          '[Calcium][building-upgrade] Building joueur introuvable par uuid:',
          buildingUuid
        );
      }

      const alreadyExists = actions.some(action =>
        action?.finished !== true &&
        String(action?.entity || '').endsWith('Building') &&
        (
          action?.metadata?.building_uuid === buildingUuid ||
          action?.metadata?.buildingUuid === buildingUuid
        ) &&
        Number(action?.metadata?.targetLevel) === targetLevel
      );

      if (alreadyExists) {
        console.log(
          '[Calcium][building-upgrade] Action déjà présente pour',
          definitionId,
          'uuid',
          buildingUuid,
          'niveau',
          targetLevel
        );
        return false;
      }

      const nowMs = Date.now();
      const startAt = new Date(nowMs).toISOString();
      const endAt = new Date(nowMs + reducedDuration * 1000).toISOString();

      const action = {
        uuid: `building-upgrade-${buildingUuid}-${targetLevel}`,
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
          status: upgrade.status || null
        }
      };

      actions.push(action);

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

      const alreadyExists = actions.some(action =>
        action?.finished !== true &&
        String(action?.entity || '').endsWith('Research') &&
        action?.metadata?.research_uuid === researchUuid &&
        Number(action?.metadata?.targetLevel) === targetLevel
      );

      if (alreadyExists) {
        console.log(
          '[Calcium][research-upgrade] Action déjà présente pour',
          definitionId,
          'uuid',
          researchUuid,
          'niveau',
          targetLevel
        );
        return false;
      }

      const nowMs = Date.now();
      const startAt = new Date(nowMs).toISOString();
      const endAt = new Date(nowMs + computedDuration * 1000).toISOString();

      const action = {
        uuid: `research-upgrade-${researchUuid}-${targetLevel}`,
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
        payloads.forEach(entry => {
          const response = entry?.response ?? entry?.data ?? entry;
          const didCreate = registerBuildingUpgradeActionFromResponse(response);
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
      return await calciumApiFetch(data.path, {
        method: data.method || 'GET',
        json: data.json,
        headers: data.headers || {}
      });
    }

    return {
      ok: false,
      error: 'UNKNOWN_REQUEST'
    };
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

  function getMandatorySessionHeaders({ withJson = false } = {}) {
    const clientId = findClientIdFromCapturedRequests();
    const bearer = Calcium?.bearer || null;
    const realmId = Calcium?.guid?.realm || null;
    const hpItem = Calcium?.Data?.Realm?.variables?.item_use_honey_pot_value ?? null;

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

    if (hpItem !== null && hpItem !== undefined) {
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
    const finalHeaders = getMandatorySessionHeaders({ withJson: json !== undefined });

    Object.entries(headers || {}).forEach(([key, value]) => {
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

  async function useItem(playerUuid, itemUuid, quantity = 1) {
    return calciumApiFetch(
      `/api/players/${playerUuid}/items/${itemUuid}/use`,
      {
        method: 'POST',
        json: { quantity }
      }
    );
  }

  async function useCurrentPlayerItem(itemUuid, quantity = 1) {
    const playerUuid = Calcium?.guid?.player || Calcium?.Data?.Player?.uuid;
    if (!playerUuid) {
      return { ok: false, error: 'NO_PLAYER_UUID' };
    }

    return useItem(playerUuid, itemUuid, quantity);
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
    refreshAllComputedData();
    tryRegisterDerivedActionsFromDatasets();
    processFinishedActions();
    publishSnapshot('api-change');
  });

  console.log('🚀 [Calcium] SidePanel MAIN prêt');
})();