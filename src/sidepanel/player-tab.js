import {
  UI_STATE,
  setActivePlayerSubTab,
  syncBuildingTabRefresh,
  stopBuildingTabRefresh,
  buildPlayerHero,
  initGlobalTooltips
} from './player-tab-core.js';

import {
  renderPlayerGeneralTab,
  bindGeneralTabEvents
} from './player-tab-general.js';

import {
  renderPlayerTroopsTab
} from './player-tab-troops.js';

import {
  renderPlayerBuildingsTab,
  bindBuildingsTabEvents
} from './player-tab-buildings.js';

import {
  renderPlayerSearchTab,
  bindResearchTabEvents
} from './player-tab-research.js';

import {
  renderPlayerQuestsTab
} from './player-tab-quests.js';

function renderPlayerPanel() {
  const panel = document.getElementById('calcium-player-panel');
  const calcium = UI_STATE.snapshot?.calcium;

  if (!panel) return;

  if (!calcium) {
    stopBuildingTabRefresh();

    panel.innerHTML = `
      <div class="calcium-player-panel">
        <div class="calcium-player-title">Joueur</div>
        <div class="calcium-player-text">En attente du parsing du dataset...</div>
      </div>
    `;

    return;
  }

  let content = '';

  if (UI_STATE.activePlayerSubTab === 'general') {
    content = renderPlayerGeneralTab(calcium);
  } else if (UI_STATE.activePlayerSubTab === 'troupes') {
    content = renderPlayerTroopsTab(calcium);
  } else if (UI_STATE.activePlayerSubTab === 'batiments') {
    content = renderPlayerBuildingsTab();
  } else if (UI_STATE.activePlayerSubTab === 'recherche') {
    content = renderPlayerSearchTab();
  } else if (UI_STATE.activePlayerSubTab === 'quests') {
    content = renderPlayerQuestsTab();
  }

  syncBuildingTabRefresh();

  panel.innerHTML = `
    ${buildPlayerHero()}
    ${content}
  `;

  panel.querySelectorAll('[data-player-subtab]').forEach(tab => {
    tab.addEventListener('click', () => {
      setActivePlayerSubTab(tab.dataset.playerSubtab);
    });
  });

  if (UI_STATE.activePlayerSubTab === 'general') {
    bindGeneralTabEvents(panel, renderPlayerPanel);
  } else if (UI_STATE.activePlayerSubTab === 'batiments') {
    bindBuildingsTabEvents(panel, renderPlayerPanel);
  }  else if (UI_STATE.activePlayerSubTab === 'recherche') {
    bindResearchTabEvents(panel, renderPlayerPanel);
  }

}

export {
  renderPlayerPanel,
  initGlobalTooltips
};