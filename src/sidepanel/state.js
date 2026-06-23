const UI_STATE = {
  showResources : {
    food: true,
    lumber: true,
    metal: true,
    stone: true,
    blue_energy: false,
    gold: true,
    soulc: false,
    ruby: false,
    population: false,
    talisman: false,
    elixir: true,
    fangtooth: false,
    glowing_mandrake: false
  },
  activeMainTab: 'joueur',
  activePlayerSubTab: 'general',
  activeItemCategory: 'all',
  activeBuildingSettlement: "all",
  showTopHeaderPanel: false,
  showDataTab: true,
  showAllianceTab: true,
  showCalciumTab: true,
  snapshot: null,
  countdownInterval: null,
  port: null
};

function getMainTabs() {
  return [
    { id: 'datas', label: 'Datas', visible: UI_STATE.showDataTab },
    { id: 'joueur', label: 'Joueur', visible: true },
    { id: 'alliance', label: 'Alliance', visible: UI_STATE.showAllianceTab },
    { id: 'calcium', label: 'Calcium', visible: UI_STATE.showCalciumTab }
  ].filter(tab => tab.visible);
}

function syncStaticUiVisibility() {
  const headerEl = document.querySelector('.calcium-header');

  if (headerEl) {
    headerEl.classList.toggle('calcium-hidden', !UI_STATE.showTopHeaderPanel);
  }
}

export { UI_STATE, getMainTabs, syncStaticUiVisibility };
