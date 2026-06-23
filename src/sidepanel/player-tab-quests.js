import {
  UI_STATE,
  escapeHtml,
  formatValue,
  formatCompactNumber,
  getLabelTrans,
  requestCalciumApi
} from './player-tab-core.js';

let rerenderQuestsPlayerPanel = null;

function getQuestDefinitions() {
  const calcium = UI_STATE.snapshot?.calcium?.Data || {};
  return (calcium.Quest || []);
}

function getPlayerQuests() {
  const calcium = UI_STATE.snapshot?.calcium?.Data || {};
  const player = calcium.Player || {};
  return (player.quests || []);
}

function getQuestLabel(definitionId, definition) {
  if (definition?.name) return String(definition.name);
  return String(definitionId || 'Quête inconnue');
}

function getQuestDisplayStatus(quest) {
  if (quest?.status === 'completed' && quest?.claimed === false) {
    return {
      label: getLabelTrans('claimable', 'quest'),
      tone: 'claimable',
      claimable: true
    };
  }

  if (quest?.status === 'completed' && quest?.claimed === true) {
    return {
      label: getLabelTrans('claimed', 'quest'),
      tone: 'claimed',
      claimable: false
    };
  }

  return {
    label: getLabelTrans('progress', 'quest'),
    tone: 'progress',
    claimable: false
  };
}

function formatQuestReward(reward) {
  if (!reward || typeof reward !== 'object') return '-';

  const parts = [];

  if (reward.resources && typeof reward.resources === 'object') {
    const resourceText = Object.entries(reward.resources)
      .map(([key, value]) => `${key}: ${formatCompactNumber(value)}`)
      .join(', ');
    if (resourceText) parts.push(resourceText);
  }

  if (reward.quests && typeof reward.quests === 'object') {
    const questText = Object.entries(reward.quests)
      .map(([key, value]) => `${key} → ${value}`)
      .join(', ');
    if (questText) parts.push(`Quête: ${questText}`);
  }

  return parts.join(' • ') || '-';
}

function formatQuestRequirements(requirements) {
  if (!requirements || typeof requirements !== 'object') return '-';

  const parts = [];

  if (requirements.buildings && typeof requirements.buildings === 'object') {
    const buildingsText = Object.entries(requirements.buildings)
      .map(([key, value]) => `${key} ${value}`)
      .join(', ');
    if (buildingsText) parts.push(`Bâtiments: ${buildingsText}`);
  }

  if (requirements.quests && typeof requirements.quests === 'object') {
    const questsText = Object.entries(requirements.quests)
      .map(([key, value]) => `${key} ${value}`)
      .join(', ');
    if (questsText) parts.push(`Quêtes: ${questsText}`);
  }

  return parts.join(' • ') || '-';
}

function getEnrichedPlayerQuests() {
  const definitions = getQuestDefinitions();
  const playerQuests = getPlayerQuests();

  const definitionById = new Map(
    definitions.map((def) => [String(def?.id || ''), def])
  );

  return playerQuests.map((quest) => {
    const definitionId = String(quest?.definitionId || '');
    const definition = definitionById.get(definitionId) || null;
    const level = Number(quest?.level || 0);
    const nextLevel = level + 1;
    const displayStatus = getQuestDisplayStatus(quest);
    const currentReward = definition?.rewards?.[String(level)] || null;
    const nextRequirements = definition?.requirements?.[String(nextLevel)] || null;

    return {
      ...quest,
      label: getQuestLabel(definitionId, definition),
      category: String(definition?.category || 'other'),
      currentReward,
      nextRequirements,
      rewardText: formatQuestReward(currentReward),
      requirementsText: formatQuestRequirements(nextRequirements),
      statusLabel: displayStatus.label,
      statusTone: displayStatus.tone,
      claimable: displayStatus.claimable
    };
  });
}

function buildQuestInfoButton(quest) {
  const lines = [];

  if (quest?.nextRequirements) {
    lines.push(`Prochain requis : ${quest.requirementsText || '-'}`);
  }
  if (quest?.currentReward) {
    lines.push(`Récompense : ${formatQuestReward(quest.currentReward)}`);
  }
  if (quest?.finishedAt) {
    lines.push(`Terminée : ${formatValue(quest.finishedAt)}`);
  }
  if (quest?.claimedAt) {
    lines.push(`Réclamée : ${formatValue(quest.claimedAt)}`);
  }
  if (quest?.scheduledQuest === true) {
    lines.push('Quête planifiée : oui');
  }

  if (!lines.length) {
    return `<span class="calcium-building-meta">-</span>`;
  }

  return `
    <button
      type="button"
      class="calcium-info-trigger"
      aria-label="Informations sur la quête ${escapeHtml(quest?.label || quest?.definitionId || 'inconnue')}"
    >
      i
      <span class="calcium-info-tooltip" role="tooltip">
        ${lines.map(line => `<span class="calcium-info-line">${escapeHtml(line)}</span>`).join('')}
      </span>
    </button>
  `;
}

function getGroupedPlayerQuests() {
  const quests = getEnrichedPlayerQuests();
  const groups = new Map();

  for (const quest of quests) {
    const key = quest.category || 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(quest);
  }

  return Array.from(groups.entries())
    .map(([category, items]) => {
      const sortedItems = [...items].sort((a, b) => {
        const score = (quest) => {
          if (quest?.status === 'completed' && quest?.claimed === false) return 0;
          if (quest?.status === 'in_progress') return 1;
          return 2;
        };

        return score(a) - score(b) || String(a.label || '').localeCompare(String(b.label || ''));
      });

      return {
        category,
        label: getLabelTrans(category, 'quest_category'),
        items: sortedItems,
        total: sortedItems.length,
        claimable: sortedItems.filter(q => q.status === 'completed' && q.claimed === false).length,
        inProgress: sortedItems.filter(q => q.status === 'in_progress').length
      };
    })
    .sort((a, b) => {
      const score = (group) => {
        if (group.claimable > 0) return 0;
        if (group.inProgress > 0) return 1;
        return 2;
      };

      return score(a) - score(b) || a.label.localeCompare(b.label);
    });
}

function claimQuest(questUuid) {
  const calcium = UI_STATE.snapshot?.calcium || null;
  const playerUuid =
    calcium?.guid?.player ||
    calcium?.Data?.Player?.uuid ||
    null;

  if (!playerUuid) {
    return Promise.resolve({ ok: false, error: 'NO_PLAYER_UUID' });
  }

  if (!questUuid) {
    return Promise.resolve({ ok: false, error: 'NO_QUEST_UUID' });
  }

  return requestCalciumApi(
    `/api/players/${playerUuid}/quests/${questUuid}/claim`,
    {
      method: 'POST',
      json: {},
      headers: {
        'X-Calcium-No-Hp': 'true'
      }
    }
  );
}

function applyOptimisticQuestClaim(questUuid) {
  const quests = UI_STATE.snapshot?.calcium?.Data?.Player?.quests;
  if (!Array.isArray(quests)) return;

  const quest = quests.find((entry) => String(entry?.uuid || '') === String(questUuid));
  if (!quest) return;

  quest.claimed = true;
  quest.status = 'completed';
  quest.claimedAt = new Date().toISOString();
}

function buildQuestGroupsAccordion(groups) {
  if (!groups.length) {
    return `<div class="calcium-actions-empty">Aucune quête disponible</div>`;
  }

  return groups.map((group, index) => `
    <details class="calcium-quest-group" ${index === 0 ? 'open' : ''}>
      <summary class="calcium-quest-group-summary">
        <span class="calcium-quest-group-title">${escapeHtml(group.label)}</span>
        <span class="calcium-quest-group-meta">
          ${escapeHtml(String(group.total))} quêtes
          ${group.claimable ? ` · ${escapeHtml(String(group.claimable))} à réclamer` : ''}
        </span>
      </summary>
      <div class="calcium-quest-group-content">
        <div class="calcium-table-wrap">
          <table class="calcium-table">
            <thead>
              <tr>
                <th scope="col">Quête</th>
                <th scope="col">Niv.</th>
                <th scope="col">Statut</th>
                <th scope="col">Infos</th>
              </tr>
            </thead>
            <tbody>
              ${buildQuestGroupRows(group.items)}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  `).join('');
}

function buildQuestGroupRows(items) {
  return items.map((quest) => `
    <tr>
      <td>${escapeHtml(quest.label || quest.definitionId || 'Quête inconnue')}</td>
      <td>${escapeHtml(String(quest.level ?? 0))}</td>
      <td>
        ${
          quest.claimable
            ? `
              <button
                type="button"
                class="calcium-badge calcium-badge-${escapeHtml(quest.statusTone)} calcium-quest-claim-btn"
                data-quest-uuid="${escapeHtml(quest.uuid || '')}"
                title="Cliquer pour réclamer"
              >
                ${escapeHtml(quest.statusLabel)}
              </button>
            `
            : `
              <span class="calcium-badge calcium-badge-${escapeHtml(quest.statusTone)}">
                ${escapeHtml(quest.statusLabel)}
              </span>
            `
        }
      </td>
      <td>${buildQuestInfoButton(quest)}</td>
    </tr>
  `).join('');
}

function renderPlayerQuestsTab() {
  const groups = getGroupedPlayerQuests();

  return `
    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Quêtes par type</div>
      <div class="calcium-quest-groups">
        ${buildQuestGroupsAccordion(groups)}
      </div>
    </div>
  `;
}

function bindQuestClaimButtons(scope = document) {
  if (scope.dataset.questClaimBound === 'true') return;
  scope.dataset.questClaimBound = 'true';

  scope.addEventListener('click', async (event) => {
    const btn = event.target.closest('.calcium-quest-claim-btn');
    if (!btn) return;

    const questUuid = btn.dataset.questUuid;
    if (!questUuid) return;

    btn.disabled = true;
    const previousText = btn.textContent;
    btn.textContent = '...';

    try {
      const response = await claimQuest(questUuid);

      if (!response?.ok) {
        btn.textContent = 'Err';
        return;
      }

      applyOptimisticQuestClaim(questUuid);
      rerenderQuestsPlayerPanel?.();
    } catch (error) {
      console.error('[Calcium][quest-claim] KO', error);
      btn.textContent = 'Err';
    } finally {
      window.setTimeout(() => {
        if (btn.isConnected) {
          btn.disabled = false;
          btn.textContent = previousText;
        }
      }, 250);
    }
  });
}

function bindQuestsTabEvents(panel, renderPlayerPanel) {
  rerenderQuestsPlayerPanel = renderPlayerPanel;
  bindQuestClaimButtons(panel);
}

export {
  renderPlayerQuestsTab,
  bindQuestsTabEvents
};