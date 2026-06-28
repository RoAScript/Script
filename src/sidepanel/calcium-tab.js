import { UI_STATE } from './state.js';
import { escapeHtml } from './core.js';
import { renderAllianceOverview, renderAllianceMembersTable, bindAllianceTooltips } from './alliance-tab.js';

function renderCalciumPanel() {
  const panel = document.getElementById('calcium-calcium-panel');
  const calcium = UI_STATE.snapshot?.calcium || null;

  if (!panel) return;

  if (!calcium) {
    panel.innerHTML = `
      <div class="calcium-actions-empty">Aucune donnée Calcium disponible</div>
    `;
    return;
  }

  panel.innerHTML = `
    <section class="calcium-player-section">
      <div class="calcium-player-subtitle">Explorateur Calcium</div>
      <div class="calcium-tree-toolbar">
        <button type="button" class="calcium-btn-secondary" data-tree-action="expand-all">Tout ouvrir</button>
        <button type="button" class="calcium-btn-secondary" data-tree-action="collapse-all">Tout fermer</button>
      </div>
      <div class="calcium-tree-root">
        ${renderTreeNode('calcium', calcium, 'calcium')}
      </div>
    </section>
  `;

    panel.addEventListener('click', (e) => {
      const target = e.target.closest('[data-path]');
      if (!target) return;

      const path = target.dataset.path;
      if (!path) return;

      navigator.clipboard.writeText(path);

      // feedback visuel (optionnel)
      target.style.background = 'rgba(77,134,255,0.3)';
      setTimeout(() => {
        target.style.background = '';
      }, 600);
  });
}

function escapeTreeValue(value) {
  return escapeHtml(String(value));
}

function getValueType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function buildSafePath(path, key) {
  if (!path) return key;

  // tableau -> on garde [index]
  if (key.startsWith('[')) {
    return `${path}${key}`;
  }

  // objet -> on met ?.
  return `${path}?.${key}`;
}

function renderTreeNode(key, value, path = '', depth = 0) {
  const type = getValueType(value);

  if (type === 'array') {
    const count = value.length;
    const isOpen = depth < 2;

    return `
      <details class="calcium-tree-node calcium-tree-branch" ${isOpen ? 'open' : ''}>
        <summary class="calcium-tree-summary" data-path="${path}">
          <span class="calcium-tree-key">${escapeTreeValue(key)}</span>
          <span class="calcium-tree-meta">Array(${count})</span>
        </summary>
        <div class="calcium-tree-children">
          ${count
            ? value.map((item, index) => renderTreeNode(`[${index}]`, item, `${path}[${index}]`, depth + 1)).join('')
            : `<div class="calcium-tree-leaf"><span class="calcium-tree-empty">[]</span></div>`
          }
        </div>
      </details>
    `;
  }

  if (type === 'object') {
    const entries = Object.entries(value || {});
    const isOpen = depth < 2;

    return `
      <details class="calcium-tree-node calcium-tree-branch" ${isOpen ? 'open' : ''}>
        <summary class="calcium-tree-summary">
          <span class="calcium-tree-key">${escapeTreeValue(key)}</span>
          <span class="calcium-tree-meta">Object(${entries.length})</span>
        </summary>
        <div class="calcium-tree-children">
          ${entries.length
            ? entries.map(([childKey, childValue]) =>
                renderTreeNode(
                  childKey,
                  childValue,
                  buildSafePath(path, childKey),
                  depth + 1
                )
              ).join('')
            : `<div class="calcium-tree-leaf"><span class="calcium-tree-empty">{}</span></div>`
          }
        </div>
      </details>
    `;
  }

  return `
    <div class="calcium-tree-node calcium-tree-leaf" data-path="${path}">
      <span class="calcium-tree-key">${escapeTreeValue(key)}</span>
      <span class="calcium-tree-separator">:</span>
      <span class="calcium-tree-value calcium-tree-value-${type}">
        ${escapeTreeValue(formatTreePrimitive(value))}
      </span>
    </div>
  `;
}

function formatTreePrimitive(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'undefined') return 'undefined';
  return String(value);
}

function renderAlliancePanel() {
  const panel = document.getElementById("calcium-alliance-panel");
  const calcium = UI_STATE.snapshot?.calcium;
  const alliance = calcium?.Data?.Alliance;

  if (!panel) return;

  if (!alliance || !alliance.name) {
    panel.innerHTML = `
      <div class="calcium-player-title">Alliance</div>
      <div class="calcium-player-text">
        En attente du parsing du dataset alliance...
      </div>
    `;
    return;
  }

  panel.innerHTML = `
    ${renderAllianceOverview(alliance)}
    ${renderAllianceMembersTable(alliance)}
  `;

  bindAllianceTooltips(panel);
}

export { renderCalciumPanel, renderAlliancePanel };
