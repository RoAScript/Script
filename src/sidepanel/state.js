const CONFIGURATION_STORAGE_KEY = 'calcium.configuration.v1';
const AUTOMATION_TRACE_STORAGE_KEY = 'calcium.building.automation.trace.v1';

const DEFAULT_UI_CONFIG = {
  showResources: {
    food: true,
    lumber: true,
    metal: true,
    stone: true,
    blue_energy: false,
    gold: true,
    soul: false,
    ruby: false,
    population: false,
    talisman: false,
    elixir: true,
    fangtooth: false,
    glowing_mandrake: false
  },
  showTopHeaderPanel: false,
  showDataTab: false,
  showAllianceTab: true,
  showCalciumTab: false,
  showQuestClaimed: true,
  buildingAutomation: {
    enabled: false,
    scanIntervalSeconds: 10,
    targets: {}
  }
};

let AUTOMATION_TRACE = [];

const UI_CONFIG = cloneConfiguration(DEFAULT_UI_CONFIG);

const UI_STATE = {
  showResources: cloneConfiguration(DEFAULT_UI_CONFIG.showResources),
  activeMainTab: 'joueur',
  activePlayerSubTab: 'general',
  activeItemCategory: 'all',
  activeBuildingSettlement: 'all',
  showTopHeaderPanel: DEFAULT_UI_CONFIG.showTopHeaderPanel,
  showDataTab: DEFAULT_UI_CONFIG.showDataTab,
  showAllianceTab: DEFAULT_UI_CONFIG.showAllianceTab,
  showCalciumTab: DEFAULT_UI_CONFIG.showCalciumTab,
  buildingAutomation: cloneConfiguration(DEFAULT_UI_CONFIG.buildingAutomation),
  snapshot: null,
  countdownInterval: null,
  port: null
};

function cloneConfiguration(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeConfiguration(savedConfiguration = {}) {
  return {
    ...cloneConfiguration(DEFAULT_UI_CONFIG),
    ...(savedConfiguration || {}),
    showResources: {
      ...cloneConfiguration(DEFAULT_UI_CONFIG.showResources),
      ...(savedConfiguration?.showResources || {})
    },
    buildingAutomation: {
      ...cloneConfiguration(DEFAULT_UI_CONFIG.buildingAutomation),
      ...(savedConfiguration?.buildingAutomation || {}),
      targets: {
        ...cloneConfiguration(DEFAULT_UI_CONFIG.buildingAutomation.targets),
        ...(savedConfiguration?.buildingAutomation?.targets || {})
      }
    }
  };
}

function applyConfiguration(config) {
  UI_STATE.showResources = cloneConfiguration(config.showResources);
  UI_STATE.showTopHeaderPanel = config.showTopHeaderPanel === true;
  UI_STATE.showDataTab = config.showDataTab !== false;
  UI_STATE.showAllianceTab = config.showAllianceTab !== false;
  UI_STATE.showCalciumTab = config.showCalciumTab !== false;
  UI_STATE.showQuestClaimed = config.showQuestClaimed !== false;
  UI_STATE.buildingAutomation = cloneConfiguration(
    config.buildingAutomation || DEFAULT_UI_CONFIG.buildingAutomation
  );

  Object.keys(UI_CONFIG).forEach((key) => {
    delete UI_CONFIG[key];
  });

  Object.assign(UI_CONFIG, cloneConfiguration(config));
}

function getUiConfig() {
  return cloneConfiguration(UI_CONFIG);
}

async function loadPersistentConfiguration() {
  try {
    const result = await chrome.storage.local.get(CONFIGURATION_STORAGE_KEY);
    const savedConfiguration = result?.[CONFIGURATION_STORAGE_KEY] || {};
    const config = mergeConfiguration(savedConfiguration);

    applyConfiguration(config);

    return getUiConfig();
  } catch (error) {
    console.warn('[Calcium][configuration] Chargement configuration KO', error);

    const config = mergeConfiguration({});
    applyConfiguration(config);

    return getUiConfig();
  }
}

async function savePersistentConfiguration(patch = {}) {
  const current = getUiConfig();

  const nextConfig = mergeConfiguration({
    ...current,
    ...patch,
    showResources: {
      ...current.showResources,
      ...(patch.showResources || {})
    }
  });

  applyConfiguration(nextConfig);

  await chrome.storage.local.set({
    [CONFIGURATION_STORAGE_KEY]: nextConfig
  });

  return getUiConfig();
}

async function resetPersistentConfiguration() {
  const config = mergeConfiguration({});

  applyConfiguration(config);

  await chrome.storage.local.set({
    [CONFIGURATION_STORAGE_KEY]: config
  });

  return getUiConfig();
}

function getMainTabs() {
  return [
    { id: 'datas', label: 'Datas', visible: UI_STATE.showDataTab },
    { id: 'joueur', label: 'Joueur', visible: true },
    { id: 'alliance', label: 'Alliance', visible: UI_STATE.showAllianceTab },
    { id: 'calcium', label: 'Calcium', visible: UI_STATE.showCalciumTab },
    { id: 'configuration', label: '⚙️', title: 'Configuration', visible: true }
  ].filter(tab => tab.visible);
}

function syncStaticUiVisibility() {
  const headerEl = document.querySelector('.calcium-header');

  if (headerEl) {
    headerEl.classList.toggle('calcium-hidden', !UI_STATE.showTopHeaderPanel);
  }
}


function getAutomationTrace() {
  return [...AUTOMATION_TRACE];
}

async function pushAutomationTrace(entry) {
  const traceEntry = {
    id: `trace-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    ...entry
  };

  AUTOMATION_TRACE.push(traceEntry);

  // garde seulement les 200 derniers
  if (AUTOMATION_TRACE.length > 200) {
    AUTOMATION_TRACE = AUTOMATION_TRACE.slice(-200);
  }

  try {
    await chrome.storage.local.set({
      [AUTOMATION_TRACE_STORAGE_KEY]: AUTOMATION_TRACE
    });
  } catch (e) {
    console.warn('[automation-trace] persist KO', e);
  }
}

async function loadAutomationTrace() {
  try {
    const result = await chrome.storage.local.get(AUTOMATION_TRACE_STORAGE_KEY);
    AUTOMATION_TRACE = result?.[AUTOMATION_TRACE_STORAGE_KEY] || [];
  } catch {
    AUTOMATION_TRACE = [];
  }
}

export {
  UI_STATE,
  DEFAULT_UI_CONFIG,
  getUiConfig,
  loadPersistentConfiguration,
  savePersistentConfiguration,
  resetPersistentConfiguration,
  getMainTabs,
  syncStaticUiVisibility,
  getAutomationTrace,
  pushAutomationTrace,
  loadAutomationTrace
};