import { getLabelTrans } from './player-tab-core.js';
import {
  getUiConfig,
  savePersistentConfiguration,
  resetPersistentConfiguration
} from './state.js';
import { escapeHtml } from './core.js';

function buildConfigurationSwitch({
  key,
  label,
  description,
  checked
}) {
  return `
    <label class="calcium-config-row">
      <span class="calcium-config-row-main">
        <span class="calcium-config-label">${escapeHtml(label)}</span>
        ${
          description
            ? `<span class="calcium-config-description">${escapeHtml(description)}</span>`
            : ''
        }
      </span>

      <input
        type="checkbox"
        class="calcium-config-checkbox"
        data-config-key="${escapeHtml(key)}"
        ${checked ? 'checked' : ''}
      />
    </label>
  `;
}

function buildResourceConfigurationSwitch(resourceKey, checked) {
  const label = getLabelTrans(resourceKey, "resource") || resourceKey;

  return `
    <label class="calcium-config-resource">
      <input
        type="checkbox"
        class="calcium-config-checkbox"
        data-config-resource="${escapeHtml(resourceKey)}"
        ${checked ? 'checked' : ''}
      />
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function renderConfigurationPanel() {
  const panel = document.getElementById('calcium-configuration-panel');
  if (!panel) return;

  const config = getUiConfig();
  const resources = config.showResources || {};

  panel.innerHTML = `
    <div class="calcium-player-section">
      <div class="calcium-config-title-row">
        <div>
          <div class="calcium-player-title">⚙️ Configuration</div>
          <div class="calcium-player-text">
            Ces réglages sont sauvegardés dans le stockage local de l’extension.
          </div>
        </div>
      </div>

      <div class="calcium-config-section">
        <div class="calcium-player-subtitle">Interface</div>

        <!--${buildConfigurationSwitch({
          key: 'showTopHeaderPanel',
          label: 'Afficher le bandeau supérieur',
          description: 'Boutons Actualiser, Refresh token et statut de connexion.',
          checked: config.showTopHeaderPanel
        })}-->

        ${buildConfigurationSwitch({
          key: 'showDataTab',
          label: 'Afficher l’onglet Datas',
          description: 'Explorateur des réponses JSON capturées.',
          checked: config.showDataTab
        })}

        ${buildConfigurationSwitch({
          key: 'showAllianceTab',
          label: 'Afficher l’onglet Alliance',
          description: 'Vue synthétique de l’alliance et de ses membres.',
          checked: config.showAllianceTab
        })}

        ${buildConfigurationSwitch({
          key: 'showCalciumTab',
          label: 'Afficher l’onglet Calcium',
          description: 'Explorateur complet du snapshot Calcium.',
          checked: config.showCalciumTab
        })}
        ${buildConfigurationSwitch({
          key: 'showQuestClaimed',
          label: 'Afficher les quêtes réclamées',
          description: 'Permet de réduire la hauteur des accordéons.',
          checked: config.showQuestClaimed
        })}
      </div>

      <div class="calcium-config-section">
        <div class="calcium-player-subtitle">Ressources visibles</div>

        <div class="calcium-config-resource-grid">
          ${Object.keys(resources)
            .map(resourceKey => buildResourceConfigurationSwitch(resourceKey, resources[resourceKey] === true))
            .join('')}
        </div>
      </div>

      <div class="calcium-config-actions">
        <button
          type="button"
          class="calcium-btn calcium-btn-primary"
          id="calcium-config-reset-btn"
        >
          Réinitialiser la configuration
        </button>
      </div>
    </div>
  `;
}

function bindConfigurationEvents(scope = document, onConfigurationChanged = () => {}) {
  const panel = scope.querySelector
    ? scope
    : document.getElementById('calcium-configuration-panel');

  if (!panel || panel.dataset.configurationBound === 'true') return;
  panel.dataset.configurationBound = 'true';

  panel.addEventListener('change', async (event) => {
    const input = event.target.closest('.calcium-config-checkbox');
    if (!input) return;

    const configKey = input.dataset.configKey;
    const resourceKey = input.dataset.configResource;

    if (configKey) {
      await savePersistentConfiguration({
        [configKey]: input.checked
      });

      onConfigurationChanged();
      return;
    }

    if (resourceKey) {
      const currentConfig = getUiConfig();

      await savePersistentConfiguration({
        showResources: {
          ...currentConfig.showResources,
          [resourceKey]: input.checked
        }
      });

      onConfigurationChanged();
    }
  });

  const resetBtn = panel.querySelector('#calcium-config-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      await resetPersistentConfiguration();
      renderConfigurationPanel();
      panel.dataset.configurationBound = 'false';
      bindConfigurationEvents(panel, onConfigurationChanged);
      onConfigurationChanged();
    });
  }
}

export {
  renderConfigurationPanel,
  bindConfigurationEvents
};