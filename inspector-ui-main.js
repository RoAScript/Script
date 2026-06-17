(function () {
  'use strict';

  const Inspector = window.CalciumInspector;
  if (!Inspector || !Inspector.coreLoaded || Inspector.uiMainLoaded) return;

  Inspector.uiMainLoaded = true;

  const STATE = Inspector.state;
  const API = Inspector.api;

  const Calcium = {
    guid: {
      account: null,
      player: null,
      realm: null,
      alliance: null,
    },
    Data: {
      Player: {
        username: null,
        power: 0,
        tax: 0,
        level: 0,
        search: [],
        resource: [],
        building: [],
        troop: [],
        items: [],
      },
      Actions: [],
      Buildings: [],
      Search: [],
      Realm: {
        name: null,
      },
      Resource: [],
      Troop: [],
      Item: [],
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

  function initRealmData() {
    const realmData = STATE.dataByCategory['api.realms'] || [];
    Calcium.Data.Realm.name = realmData?.[0]?.member?.[0]?.name || null;
  }

  function initPlayerData() {
    const playerData = STATE.dataByCategory[`api.accounts.${Calcium.guid.account}.players`]?.[0]?.member?.[0] || null;

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
        status: existing?.status ?? buildingData.status ?? null,
        label: getBuildingLabel(buildingData.definitionId, 'fr')
      };
    });
  }

  function initActionData() {
    const categoryKey = `api.players.${Calcium.guid.player}.actions`;
    const rawCategory = STATE.dataByCategory[categoryKey];
    const actionsData = rawCategory?.[0]?.member ?? [];

    Calcium.Data.Actions = actionsData.map(actionData => ({
      ...actionData,
      calciumEntity: String(actionData.entity || '').split('\\').pop().toLowerCase()
    }));
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

  function refreshAllComputedData() {
    initDiscoverData();
    initRealmData();
    initPlayerData();
    initBuildingData();
    initActionData();
    initResearchData();
    initResourceData();
    initTroopData();
    initItemData();
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
    const buildingUuid = action?.metadata?.building_uuid;
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
      if (!action || action.finished) return;
      if (!action.endAt) return;

      const endTimestamp = new Date(action.endAt).getTime();
      if (Number.isNaN(endTimestamp)) return;

      if (endTimestamp > now) {
        action.remainingTime = Math.max(0, Math.floor((endTimestamp - now) / 1000));
        return;
      }

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

  function startActionsWatcher() {
    if (actionsWatcherIntervalId) return;

    actionsWatcherIntervalId = window.setInterval(() => {
      const didChange = processFinishedActions();

      if (didChange) {
        publishSnapshot('actions-expired', true);
      }
    }, 1000);
  }

  function buildSnapshot() {
    refreshAllComputedData();
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

    return snapshot;
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

    return {
      ok: false,
      error: 'UNKNOWN_REQUEST'
    };
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
    processFinishedActions();
    startActionsWatcher();
    publishSnapshot('dataset-ready', true);
  });

  API.onChange(() => {
    refreshAllComputedData();
    processFinishedActions();
    publishSnapshot('api-change');
  });

  console.log('🚀 [Calcium] SidePanel MAIN prêt');
})();