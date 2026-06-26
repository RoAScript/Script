import { readFileSync, writeFileSync, watch } from 'node:fs';
import { resolve } from 'node:path';

const moduleOrder = [
  'src/sidepanel/i18n.js',
  'src/sidepanel/state.js',
  'src/sidepanel/core.js',

  // Player split modules
  'src/sidepanel/player-tab-core.js',
  'src/sidepanel/player-tab-general.js',
  'src/sidepanel/player-tab-troops.js',
  'src/sidepanel/building-prerequisites-core.js',
  'src/sidepanel/player-tab-buildings.js',
  'src/sidepanel/player-tab-research.js',
  'src/sidepanel/player-tab-quests.js',
  'src/sidepanel/player-tab.js',

  'src/sidepanel/alliance-tab.js',
  'src/sidepanel/calcium-tab.js',
  'src/sidepanel/configuration-tab.js',
  'src/sidepanel/app.js',
  'src/sidepanel/index.js'
];

function stripModuleSyntax(text) {
  return text
    .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
    .replace(/^\s*export\s*\{[^}]+\};\s*$/gm, '')
    .replace(/\bexport\s+(?=const|function|class)/g, '')
    .trim();
}

function buildBundle() {
  const parts = [
    '/* GENERATED FILE - Calcium full runtime bundle */',
    '(function () {',
    "'use strict';",
    ''
  ];

  for (const rel of moduleOrder) {
    const text = readFileSync(resolve(rel), 'utf8');
    parts.push(`\n/* ===== MODULE: ${rel} ===== */\n`);
    parts.push(stripModuleSyntax(text));
    parts.push('\n');
  }

  parts.push('})();\n');
  writeFileSync('sidepanel.bundle.js', parts.join('\n'), 'utf8');
  console.log('[Calcium][full-clean] sidepanel.bundle.js generated');
}

if (process.argv.includes('--watch')) {
  buildBundle();
  for (const rel of moduleOrder) {
    watch(resolve(rel), { persistent: true }, () => {
      try {
        buildBundle();
      } catch (error) {
        console.error('[Calcium][full-clean] build error:', error);
      }
    });
  }
  console.log('[Calcium][full-clean] watch active');
} else {
  buildBundle();
}
