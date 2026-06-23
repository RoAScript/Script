import {
  escapeHtml, formatValue, formatCompactNumber, formatBooleanBadge,
  formatAllianceGrade, formatCoordinates
} from './core.js';

function renderAllianceOverview(alliance) {
  const name = escapeHtml(formatValue(alliance?.name));
  const rank = escapeHtml(formatValue(alliance?.rank));
  const masterUsername = escapeHtml(formatValue(alliance?.masterUsername));
  const totalPower = escapeHtml(formatCompactNumber(alliance?.total_power ?? 0));
  const memberCount = escapeHtml(formatValue(alliance?.memberCount, '0'));
  const createdAt = escapeHtml(formatValue(alliance?.createdAt));

  return `
    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Alliance</div>
      <div class="calcium-table-wrap">
        <table class="calcium-table">
          <tbody>
            <tr>
              <th scope="row">Nom</th>
              <td>${name}</td>
            </tr>
            <tr>
              <th scope="row">Rang</th>
              <td>${rank}</td>
            </tr>
            <tr>
              <th scope="row">Chef</th>
              <td>${masterUsername}</td>
            </tr>
            <tr>
              <th scope="row">Puissance totale</th>
              <td>${totalPower}</td>
            </tr>
            <tr>
              <th scope="row">Membres</th>
              <td>${memberCount}</td>
            </tr>
            <tr>
              <th scope="row">Créée le</th>
              <td>${createdAt}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function getGlobalTooltip() {
  return document.getElementById("calcium-global-tooltip");
}

function buildTooltipHtml(trigger) {
  const race = trigger.dataset.tooltipRace || "—";
  const city = trigger.dataset.tooltipCity || "—";
  const pve = trigger.dataset.tooltipPve || "0";
  const pvp = trigger.dataset.tooltipPvp || "0";
  const joined = trigger.dataset.tooltipJoined || "—";

  return `
    <span class="calcium-info-line">Race : ${race}</span>
    <span class="calcium-info-line">City : ${city}</span>
    <span class="calcium-info-line">PvE : ${pve}</span>
    <span class="calcium-info-line">PvP : ${pvp}</span>
    <span class="calcium-info-line">Entrée : ${joined}</span>
  `;
}

function positionTooltip(trigger, tooltip) {
  const rect = trigger.getBoundingClientRect();
  const spacing = 10;
  const viewportPadding = 8;

  tooltip.classList.add("is-visible");
  tooltip.style.left = "0px";
  tooltip.style.top = "0px";

  const tooltipRect = tooltip.getBoundingClientRect();

  let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
  let top = rect.top - tooltipRect.height - spacing;

  if (top < viewportPadding) {
    top = rect.bottom + spacing;
  }

  if (left < viewportPadding) {
    left = viewportPadding;
  }

  if (left + tooltipRect.width > window.innerWidth - viewportPadding) {
    left = window.innerWidth - tooltipRect.width - viewportPadding;
  }

  if (top + tooltipRect.height > window.innerHeight - viewportPadding) {
    top = Math.max(viewportPadding, rect.top - tooltipRect.height - spacing);
  }

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

function showGlobalTooltip(trigger) {
  const tooltip = getGlobalTooltip();
  if (!tooltip) return;

  tooltip.innerHTML = buildTooltipHtml(trigger);
  tooltip.setAttribute("aria-hidden", "false");
  tooltip.dataset.owner = "active";
  positionTooltip(trigger, tooltip);
}

function hideGlobalTooltip() {
  const tooltip = getGlobalTooltip();
  if (!tooltip) return;

  tooltip.classList.remove("is-visible");
  tooltip.setAttribute("aria-hidden", "true");
  tooltip.innerHTML = "";
  delete tooltip.dataset.owner;
}

function bindAllianceTooltips(scope = document) {
  scope.querySelectorAll(".calcium-info-trigger").forEach((button) => {
    button.addEventListener("mouseenter", () => {
      showGlobalTooltip(button);
    });

    button.addEventListener("focus", () => {
      showGlobalTooltip(button);
    });

    button.addEventListener("mouseleave", () => {
      hideGlobalTooltip();
    });

    button.addEventListener("blur", () => {
      hideGlobalTooltip();
    });

    button.addEventListener("click", (event) => {
      event.preventDefault();
      if (getGlobalTooltip()?.classList.contains("is-visible")) {
        hideGlobalTooltip();
      } else {
        showGlobalTooltip(button);
      }
    });
  });
}

function renderAllianceMembersTable(alliance) {
  const members = Array.isArray(alliance?.members) ? alliance.members : [];

  if (!members.length) {
    return `
      <div class="calcium-player-section">
        <div class="calcium-player-subtitle">Membres</div>
        <div class="calcium-actions-empty">Aucun membre disponible</div>
      </div>
    `;
  }

  const sortedMembers = [...members].sort((a, b) => {
    return Number(b?.player?.power || 0) - Number(a?.player?.power || 0);
  });

  const rows = sortedMembers.map((member) => {
    const player = member?.player || {};
    const username = escapeHtml(formatValue(player?.username));
    const power = escapeHtml(formatCompactNumber(player?.power ?? 0));
    const premium = formatBooleanBadge(!!player?.has_premium, 'Premium', 'Standard');
    const grade = escapeHtml(formatAllianceGrade(member?.grade));
    const dragonLevel = escapeHtml(formatValue(member?.dragon_level, '0'));
    const city = escapeHtml(formatCoordinates(member?.city_coordinates));

    const race = escapeHtml(formatValue(player?.race));
    const pvePower = escapeHtml(formatCompactNumber(player?.pvePower ?? 0));
    const pvpPower = escapeHtml(formatCompactNumber(player?.pvpPower ?? 0));
    const joinedAt = escapeHtml(formatValue(member?.joinedAt));

    return `
      <tr class="calcium-alliance-row">
        <td>
          <div class="calcium-building-cell">
            <div class="calcium-alliance-member-main">
              <div class="calcium-alliance-member-head">
              <button
                  type="button"
                  class="calcium-info-trigger"
                  aria-label="Informations sur ${username}"
                  data-tooltip-race="${escapeHtml(formatValue(race))}"
                  data-tooltip-city="${escapeHtml(formatValue(city))}"
                  data-tooltip-pve="${escapeHtml(formatCompactNumber(pvePower))}"
                  data-tooltip-pvp="${escapeHtml(formatCompactNumber(pvpPower))}"
                  data-tooltip-joined="${escapeHtml(formatValue(joinedAt))}"
                >
                  i
                </button>

              <span class="calcium-building-name">${username}</span>
              </div>
            </div>
          </div>
        </td>
        <td>${power}</td>
        <td>${premium}</td>
        <td>${grade}</td>
        <td>${dragonLevel}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="calcium-player-section">
      <div class="calcium-player-subtitle">Membres</div>
      <div class="calcium-table-wrap">
        <table class="calcium-table">
          <thead>
            <tr>
              <th scope="col">Nom</th>
              <th scope="col">Power</th>
              <th scope="col">Premium</th>
              <th scope="col">Grade</th>
              <th scope="col">Dragon</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export { renderAllianceOverview, bindAllianceTooltips, renderAllianceMembersTable };
