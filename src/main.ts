import './styles.css';
import { loadGameData } from './lib/data.ts';
import { randomSeed } from './lib/rng.ts';
import {
  TARGET_STAT_DEFS,
  evaluateBuildTargets,
  generateBuild,
  hasActiveTargets,
  rerollBuildItem,
  rerollBuildSupportGem,
  type GeneratedBuild,
} from './lib/generator.ts';
import { isMandatoryTotemSupport } from './lib/skills.ts';
import type {
  BuildOptions,
  BuildTargets,
  DamageStyle,
  DefenseStyle,
  EconomyMode,
  LeagueMode,
  TargetStatKey,
} from './lib/archetype.ts';
import type { GameData } from './lib/types.ts';
import { TreeCanvas } from './components/TreeCanvas.ts';
import {
  buildOptionsSignature,
  clearSavedBuilds,
  deleteSavedBuild,
  loadSavedBuilds,
  renameSavedBuild,
  saveBuildToStorage,
  type SavedBuildEntry,
} from './lib/storage.ts';

type ThemePref = 'system' | 'light' | 'dark';
type NavView = 'dashboard' | 'tree' | 'skills' | 'gear' | 'export' | 'saved';

const THEME_STORAGE_KEY = 'pob-randomizer-theme';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getSavedTheme(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // ignore storage errors
  }
  return 'system';
}

function resolveIsDark(pref: ThemePref, media: MediaQueryList): boolean {
  if (pref === 'dark') return true;
  if (pref === 'light') return false;
  return media.matches;
}

async function main() {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let themePref: ThemePref = getSavedTheme();
  let isDark = resolveIsDark(themePref, media);
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';

  const root = document.getElementById('app')!;
  root.innerHTML = `<div class="loading">Loading Path of Exile tree, gems, bases, mods &amp; uniques...</div>`;

  const data: GameData = await loadGameData();

  const options: BuildOptions = {
    seed: randomSeed(),
    leagueMode: 'softcore',
    economy: 'trade',
    classId: 'random',
    ascendancyIndex: 'random',
    level: 92,
    damageStyle: 'random',
    defenseStyle: 'random',
  };

  let activeView: NavView = 'dashboard';
  let currentBuild: GeneratedBuild | null = null;
  let treeCanvas: TreeCanvas | null = null;

  root.innerHTML = `
    <div class="layout" id="app-layout">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">PoB</div>
          <div class="brand-text">
            <h1>PoB Forge</h1>
            <p>PoE 1 (${esc(data.tree.version.replace('_', '.'))}) Randomizer</p>
          </div>
        </div>

        <nav class="nav-list" id="sidebar-nav">
          <button type="button" class="nav-item active" data-view="dashboard">
            <span class="nav-icon">⊞</span>
            <span class="nav-label">Dashboard</span>
          </button>
          <button type="button" class="nav-item" data-view="tree">
            <span class="nav-icon">⑂</span>
            <span class="nav-label">Passive Tree</span>
            <span class="nav-pill" id="nav-pts-pill">115</span>
          </button>
          <button type="button" class="nav-item" data-view="skills">
            <span class="nav-icon">✦</span>
            <span class="nav-label">Skill Gems</span>
            <span class="nav-pill" id="nav-links-pill">6L</span>
          </button>
          <button type="button" class="nav-item" data-view="gear">
            <span class="nav-icon">◈</span>
            <span class="nav-label">Gear &amp; Flasks</span>
          </button>
          <button type="button" class="nav-item" data-view="export">
            <span class="nav-icon">⇄</span>
            <span class="nav-label">PoB Export</span>
          </button>
          <button type="button" class="nav-item" data-view="saved">
            <span class="nav-icon">★</span>
            <span class="nav-label">Saved Builds</span>
            <span class="nav-pill" id="nav-saved-pill">0</span>
          </button>
        </nav>

        <div class="sidebar-section">
          <div class="section-caption">Build Knobs</div>

          <div class="knob">
            <div class="knob-label">League Mode</div>
            <div class="segmented" id="league-seg">
              <button type="button" data-mode="softcore" class="active">Softcore</button>
              <button type="button" data-mode="hardcore">Hardcore</button>
            </div>
          </div>

          <div class="knob">
            <div class="knob-label">Economy</div>
            <div class="segmented" id="eco-seg">
              <button type="button" data-eco="ssf">SSF</button>
              <button type="button" data-eco="trade" class="active">Trade</button>
            </div>
          </div>

          <div class="knob-row">
            <div class="knob">
              <label for="class-select">Class</label>
              <select id="class-select">
                <option value="random">Random</option>
                ${data.tree.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
              </select>
            </div>
            <div class="knob">
              <label for="asc-select">Ascendancy</label>
              <select id="asc-select" disabled>
                <option value="random">Random</option>
              </select>
            </div>
          </div>

          <div class="knob-row">
            <div class="knob">
              <label for="style-select">Style</label>
              <select id="style-select">
                <option value="random">Random</option>
                <option value="attack">Attack</option>
                <option value="spell">Spell</option>
                <option value="minion">Minion</option>
                <option value="totem">Totem</option>
                <option value="trap_mine">Trap / Mine</option>
                <option value="dot">DoT</option>
                <option value="link_support">Mercenary / Link</option>
              </select>
            </div>
            <div class="knob">
              <label for="def-select">Defense</label>
              <select id="def-select">
                <option value="random">Random</option>
                <option value="life">Life</option>
                <option value="es">ES (CI)</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>
          </div>

          <div class="knob">
            <label for="level-range"><span>Target Level</span><span id="level-val">92</span></label>
            <input type="range" id="level-range" min="80" max="100" value="92" />
          </div>

          <div class="knob-targets-head">
            <span class="section-caption" style="padding:0;">Targets (Optional)</span>
            <div class="target-head-actions">
              <button type="button" class="target-clear-btn" id="clear-targets-btn" hidden>Clear</button>
              <button type="button" class="target-add-btn" id="add-target-btn">+ Add</button>
            </div>
          </div>
          <div class="target-picker-row" id="target-picker-row" hidden>
            <select id="target-stat-picker" aria-label="Choose target stat"></select>
            <button type="button" class="target-picker-cancel" id="cancel-target-picker-btn" title="Cancel">×</button>
          </div>
          <div class="target-rows" id="target-rows"></div>
          <div class="target-empty-hint" id="target-empty-hint">No targets set — click + Add to steer stats.</div>
        </div>

        <div class="promo-card">
          <h3>Roll a New Build</h3>
          <p id="sidebar-knob-summary">Softcore · Trade · Level 92</p>
          <button type="button" class="promo-btn" id="reroll-btn">Randomize Build</button>
        </div>

        <button type="button" class="collapse-btn" id="collapse-btn" title="Collapse or expand sidebar">
          <span class="collapse-icon">«</span>
          <span class="collapse-label">Collapse sidebar</span>
        </button>
      </aside>

      <main class="workspace">
        <header class="topbar">
          <div class="seed-search">
            <span>Seed</span>
            <input type="text" id="seed-input" value="${esc(options.seed)}" aria-label="Build seed" />
            <button type="button" class="btn btn-sm" id="apply-seed-btn">Apply</button>
          </div>

          <div class="topbar-actions">
            <div class="theme-switch" id="theme-switch" title="Color Theme">
              <button type="button" data-theme-pref="system">Auto</button>
              <button type="button" data-theme-pref="light">Light</button>
              <button type="button" data-theme-pref="dark">Dark</button>
            </div>
            <button type="button" class="btn" id="save-build-btn">Save Build</button>
            <button type="button" class="btn btn-cta" id="copy-pob-btn">Copy PoB Code</button>
            <button type="button" class="btn" id="download-xml-btn">Download .xml</button>
            <a class="btn" id="official-tree-link" href="#" target="_blank" rel="noreferrer">Official Tree</a>
          </div>
        </header>

        <section class="view-panel active" id="view-dashboard"></section>

        <section class="view-panel" id="view-tree">
          <div class="tree-grid">
            <div id="tree-canvas-host"></div>
            <div class="tree-side" id="tree-side"></div>
          </div>
        </section>

        <section class="view-panel" id="view-skills"></section>
        <section class="view-panel" id="view-gear"></section>
        <section class="view-panel" id="view-export"></section>
        <section class="view-panel" id="view-saved"></section>
      </main>
    </div>
  `;

  treeCanvas = new TreeCanvas(document.getElementById('tree-canvas-host')!, data.tree, isDark, () => {
    document.querySelectorAll('#tree-side [data-node-id].is-focused').forEach((el) => el.classList.remove('is-focused'));
  });

  const layoutEl = document.getElementById('app-layout')!;
  const classSel = document.getElementById('class-select') as HTMLSelectElement;
  const ascSel = document.getElementById('asc-select') as HTMLSelectElement;
  const styleSel = document.getElementById('style-select') as HTMLSelectElement;
  const defSel = document.getElementById('def-select') as HTMLSelectElement;
  const levelRange = document.getElementById('level-range') as HTMLInputElement;
  const levelVal = document.getElementById('level-val')!;
  const targetRowsEl = document.getElementById('target-rows')!;
  const targetPickerRow = document.getElementById('target-picker-row')!;
  const targetStatPicker = document.getElementById('target-stat-picker') as HTMLSelectElement;
  const addTargetBtn = document.getElementById('add-target-btn') as HTMLButtonElement;
  const cancelTargetPickerBtn = document.getElementById('cancel-target-picker-btn') as HTMLButtonElement;
  const targetEmptyHint = document.getElementById('target-empty-hint')!;
  const clearTargetsBtn = document.getElementById('clear-targets-btn') as HTMLButtonElement;
  let activeTargetKeys: TargetStatKey[] = [];
  const seedInput = document.getElementById('seed-input') as HTMLInputElement;
  const knobSummaryEl = document.getElementById('sidebar-knob-summary')!;
  const promoCardEl = knobSummaryEl.closest('.promo-card')!;
  const officialTreeLink = document.getElementById('official-tree-link') as HTMLAnchorElement;
  const saveBuildBtn = document.getElementById('save-build-btn') as HTMLButtonElement;
  const navSavedPill = document.getElementById('nav-saved-pill')!;
  let savedBuilds: SavedBuildEntry[] = loadSavedBuilds();
  let editingSavedId: string | null = null;
  const itemRerollCounts = new Map<number, number>();
  const supportRerollCounts = new Map<string, number>();

  function applyTheme(pref: ThemePref) {
    themePref = pref;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch {
      // ignore
    }
    isDark = resolveIsDark(pref, media);
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    treeCanvas?.setTheme(isDark);
    document.querySelectorAll('#theme-switch button').forEach((btn) => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.themePref === pref);
    });
  }

  media.addEventListener('change', () => {
    if (themePref === 'system') applyTheme('system');
  });
  applyTheme(themePref);

  function switchView(view: NavView) {
    activeView = view;
    gemTooltip.classList.add('hidden');
    document.querySelectorAll('#sidebar-nav .nav-item').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.view === view);
    });
    document.querySelectorAll('.view-panel').forEach((p) => {
      p.classList.toggle('active', p.id === `view-${view}`);
    });
    if (view === 'tree') {
      treeCanvas?.resize();
      if (currentBuild) treeCanvas?.fitToBuild();
    }
  }

  function syncAscDropdown() {
    if (options.classId === 'random') {
      ascSel.innerHTML = `<option value="random">Random</option>`;
      ascSel.disabled = true;
      options.ascendancyIndex = 'random';
      return;
    }
    const cls = data.tree.classes.find((c) => c.id === options.classId);
    ascSel.disabled = false;
    ascSel.innerHTML = `<option value="random">Random</option>` +
      (cls?.ascendancies.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('') ?? '');
    if (options.ascendancyIndex !== 'random') ascSel.value = String(options.ascendancyIndex);
  }

  const TARGET_DEF_BY_KEY = new Map(TARGET_STAT_DEFS.map((d) => [d.key, d]));

  function renderTargetPickerOptions() {
    const remaining = TARGET_STAT_DEFS.filter((d) => !activeTargetKeys.includes(d.key));
    targetStatPicker.innerHTML = [
      '<option value="">Select stat to add…</option>',
      ...remaining.map((d) => `<option value="${d.key}">${esc(d.label)}</option>`),
    ].join('');
    addTargetBtn.disabled = remaining.length === 0;
    if (remaining.length === 0) targetPickerRow.hidden = true;
  }

  function renderTargetRows() {
    targetRowsEl.innerHTML = activeTargetKeys
      .map((key) => {
        const def = TARGET_DEF_BY_KEY.get(key);
        if (!def) return '';
        const val = options.targets?.[key];
        const maxAttr = def.max !== undefined ? ` max="${def.max}"` : '';
        return `
          <div class="target-row" data-target-row="${key}">
            <label class="target-row-label" for="target-input-${key}">${esc(def.label)}</label>
            <div class="target-row-input-wrap">
              <input
                type="number"
                id="target-input-${key}"
                data-target-key="${key}"
                min="${def.min}"${maxAttr}
                step="${def.step}"
                placeholder="${esc(def.placeholder)}"
                value="${val && val > 0 ? val : ''}"
              />
              ${def.unit ? `<span class="target-row-unit">${def.unit}</span>` : ''}
            </div>
            <button type="button" class="target-remove-btn" data-remove-target="${key}" title="Remove ${esc(def.label)}">×</button>
          </div>
        `;
      })
      .join('');
    targetEmptyHint.hidden = activeTargetKeys.length > 0;
    clearTargetsBtn.hidden = activeTargetKeys.length === 0;
    renderTargetPickerOptions();
  }

  function syncTargetControls() {
    activeTargetKeys = TARGET_STAT_DEFS
      .filter((d) => {
        const v = options.targets?.[d.key];
        return typeof v === 'number' && Number.isFinite(v) && v > 0;
      })
      .map((d) => d.key);
    targetPickerRow.hidden = true;
    renderTargetRows();
  }

  function addTargetStat(key: TargetStatKey) {
    if (activeTargetKeys.includes(key)) return;
    const def = TARGET_DEF_BY_KEY.get(key);
    if (!def) return;
    activeTargetKeys.push(key);
    options.targets = {
      ...(options.targets ?? {}),
      [key]: def.defaultValue,
    };
    targetPickerRow.hidden = true;
    renderTargetRows();
    const inp = targetRowsEl.querySelector<HTMLInputElement>(`input[data-target-key="${key}"]`);
    inp?.focus();
    inp?.select();
    updateKnobSummary();
  }

  function removeTargetStat(key: TargetStatKey) {
    activeTargetKeys = activeTargetKeys.filter((k) => k !== key);
    if (options.targets) {
      const next: BuildTargets = { ...options.targets };
      delete next[key];
      options.targets = hasActiveTargets(next) ? next : undefined;
    }
    renderTargetRows();
    updateKnobSummary();
  }

  function commitTargetInput(key: TargetStatKey, raw: string) {
    const def = TARGET_DEF_BY_KEY.get(key);
    if (!def) return;
    const n = Number(raw.trim());
    const next: BuildTargets = { ...(options.targets ?? {}) };
    if (Number.isFinite(n) && n > 0) {
      next[key] = def.max !== undefined ? Math.min(def.max, n) : n;
    } else {
      delete next[key];
    }
    options.targets = hasActiveTargets(next) ? next : undefined;
  }

  function commitAllTargetInputs() {
    targetRowsEl.querySelectorAll<HTMLInputElement>('input[data-target-key]').forEach((inp) => {
      commitTargetInput(inp.dataset.targetKey as TargetStatKey, inp.value);
    });
  }

  function hasPendingSidebarChanges(): boolean {
    if (!currentBuild) return false;
    return buildOptionsSignature(options) !== buildOptionsSignature(currentBuild.archetype.options);
  }

  function updateKnobSummary() {
    const modeLabel = options.leagueMode === 'hardcore' ? 'Hardcore' : 'Softcore';
    const ecoLabel = options.economy === 'ssf' ? 'SSF' : 'Trade';
    const targetTag = hasActiveTargets(options.targets) ? ' · Targeted' : '';
    const dirty = hasPendingSidebarChanges();
    knobSummaryEl.textContent = `${modeLabel} · ${ecoLabel} · Level ${options.level}${targetTag}${dirty ? ' · Pending' : ''}`;
    promoCardEl.classList.toggle('has-pending', dirty);
  }

  function updateSidebarMeta(b: GeneratedBuild) {
    updateKnobSummary();
    document.getElementById('nav-pts-pill')!.textContent = String(b.tree.pointsUsed);
    const mainLinks = b.skills.groups[0]?.gems.length ?? 6;
    document.getElementById('nav-links-pill')!.textContent = `${mainLinks}L`;
    officialTreeLink.href = b.tree.url;
  }

  function syncControlsFromOptions(next: BuildOptions) {
    Object.assign(options, {
      ...next,
      targets: next.targets ? { ...next.targets } : undefined,
    });
    document.querySelectorAll('#league-seg button').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.mode === options.leagueMode);
    });
    document.querySelectorAll('#eco-seg button').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.eco === options.economy);
    });
    classSel.value = String(options.classId);
    syncAscDropdown();
    if (options.ascendancyIndex !== 'random') ascSel.value = String(options.ascendancyIndex);
    styleSel.value = String(options.damageStyle);
    defSel.value = String(options.defenseStyle);
    levelRange.value = String(options.level);
    levelVal.textContent = String(options.level);
    syncTargetControls();
    seedInput.value = options.seed;
  }

  function updateSavedUiState() {
    navSavedPill.textContent = String(savedBuilds.length);
    const sig = buildOptionsSignature(currentBuild?.archetype.options ?? options);
    const isSaved = savedBuilds.some((e) => e.id === sig);
    saveBuildBtn.textContent = isSaved ? 'Saved ✓' : 'Save Build';
    saveBuildBtn.classList.toggle('is-saved', isSaved);
  }

  async function regenerate() {
    seedInput.value = options.seed;
    itemRerollCounts.clear();
    supportRerollCounts.clear();
    const snapshot: BuildOptions = {
      ...options,
      targets: options.targets ? { ...options.targets } : undefined,
    };
    const build = await generateBuild(data, snapshot);
    currentBuild = build;
    updateSidebarMeta(build);
    updateSavedUiState();
    renderDashboard(build);
    renderTreeSide(build);
    renderSkills(build);
    renderGear(build);
    renderExport(build);
    renderSavedBuilds();
    treeCanvas?.setBuildTree(build.tree);
  }

  function meterHtml(label: string, valText: string, pct: number, color: string): string {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    return `
      <div class="meter-item">
        <div class="meter-top">
          <span>${esc(label)}</span>
          <span>${esc(valText)}</span>
        </div>
        <div class="meter-track">
          <div class="meter-fill" style="width:${clamped}%;background:${color};"></div>
        </div>
      </div>
    `;
  }

  function renderDashboard(b: GeneratedBuild) {
    const a = b.archetype;
    const r = b.gear.resists;
    const at = b.gear.attributes;
    const req = b.gear.requiredAttributes;
    const mainGems = b.skills.groups[0]?.gems ?? [];
    const mainLinksText = mainGems.map((g) => g.gem.name).join(' · ') || a.mainSkill.name;
    const pantheonMaj = data.pantheons.major.find((p) => p.id === a.pantheonMajor)?.name ?? a.pantheonMajor;
    const pantheonMin = data.pantheons.minor.find((p) => p.id === a.pantheonMinor)?.name ?? a.pantheonMinor;

    const d = b.defenses;
    const o = b.offense;
    const reserved = Math.min(100, b.skills.manaReservedPct);
    const unreservedMana = d.maxMana === 0 ? 0 : Math.max(0, d.maxMana - Math.ceil((d.maxMana * reserved) / 100));
    const uniques = b.gear.items.filter((i) => i.rarity === 'UNIQUE');
    const ascNotableNodes = b.tree.ascendancyNodes
      .map((id) => ({ id, node: data.tree.nodes[id] }))
      .filter((x) => x.node && (x.node.t === 'notable' || x.node.mco));
    const keystoneNodes = b.tree.nodes
      .map((id) => ({ id, node: b.tree.clusterNodes?.[id] ?? data.tree.nodes[id] }))
      .filter((x) => x.node && x.node.t === 'keystone');
    const notableNodes = b.tree.nodes
      .map((id) => ({ id, node: b.tree.clusterNodes?.[id] ?? data.tree.nodes[id] }))
      .filter((x) => x.node && x.node.t === 'notable' && !x.node.a)
      .slice(0, 8);

    const eleCapped = r.fire >= d.maxFireRes && r.cold >= d.maxColdRes && r.lightning >= d.maxLightRes;

    const targetEval = evaluateBuildTargets(b);
    const fmtTargetActual = (val: number, unit: '' | '%') =>
      !Number.isFinite(val) ? 'Immune' : unit === '%' ? `${Math.round(val)}%` : Math.round(val).toLocaleString();
    const fmtTargetGoal = (val: number, unit: '' | '%') =>
      unit === '%' ? `${Math.round(val)}%` : Math.round(val).toLocaleString();
    const targetTooltip = targetEval.items
      .map((it) => `${it.met ? '✓' : '✗'} ${it.label}: ${fmtTargetActual(it.actual, it.unit)} / ${fmtTargetGoal(it.target, it.unit)}`)
      .join('\n');
    const hasCustomCaps = d.maxFireRes !== 75 || d.maxColdRes !== 75 || d.maxLightRes !== 75 || d.maxChaosRes !== 75;
    const resCapSummary = !hasCustomCaps
      ? '75% default cap'
      : d.maxFireRes === d.maxColdRes && d.maxColdRes === d.maxLightRes && d.maxChaosRes === 75
        ? `${d.maxFireRes}% raised ele cap`
        : `${d.maxFireRes}/${d.maxColdRes}/${d.maxLightRes}% ele · ${d.maxChaosRes}% chaos cap`;

    document.getElementById('view-dashboard')!.innerHTML = `
      <div class="bento-card">
        <div class="card-head">
          <div>
            <h2 class="hero-title">${esc(a.title)}</h2>
            <p class="card-sub">Level ${a.options.level} ${esc(a.classData.name)} (${esc(a.ascendancy.name)}) · ${esc(mainLinksText)}</p>
            <div class="badges">
              <span class="badge ${a.options.leagueMode === 'hardcore' ? 'badge-hc' : 'badge-sc'}">${esc(a.options.leagueMode)}</span>
              <span class="badge ${a.options.economy === 'ssf' ? 'badge-ssf' : 'badge-trade'}">${esc(a.options.economy)}</span>
              <span class="badge">${esc(a.damageStyle)}</span>
              <span class="badge">${esc(a.defenseStyle)}</span>
              <span class="badge">${esc(a.critMode === 'crit' ? 'Crit' : a.critMode === 'dot' ? 'DoT' : 'Non-Crit')}</span>
              ${targetEval.active
                ? `<span class="badge ${targetEval.metAll ? 'badge-ssf' : 'badge-hc'}" title="${esc(targetTooltip)}">${targetEval.metAll ? `Targets Met (${targetEval.metCount}/${targetEval.totalCount})` : `Closest Match (${targetEval.metCount}/${targetEval.totalCount})`}</span>`
                : ''}
            </div>
            ${targetEval.active
              ? `<div class="target-status-strip">${targetEval.items
                  .map((it) => `<span class="target-chip ${it.met ? 'met' : 'missed'}" title="${esc(it.label)}">${it.met ? '✓' : '✗'} ${esc(it.shortLabel)} ${esc(fmtTargetActual(it.actual, it.unit))}/${esc(fmtTargetGoal(it.target, it.unit))}</span>`)
                  .join('')}</div>`
              : ''}
          </div>
          <button type="button" class="btn btn-sm" data-jump="tree">View Tree →</button>
        </div>

        <div class="hero-metrics">
          <div class="hero-metric hero-metric-col">
            <div class="hero-metric-top">
              <div>
                <div class="kpi-label">Projected ${esc(o.dpsMode)}</div>
                <div class="kpi-value hero-dps-val">${o.dpsMode === 'Support' ? 'Link Buff' : `${o.totalDps.toLocaleString()} DPS`}</div>
              </div>
              <span class="kpi-tag">Lv ${o.skillLevel}</span>
            </div>
            <div class="hero-dps-stats">
              ${o.dpsMode === 'Support'
                ? '<div class="hero-dps-stat"><span>Role</span><strong>Allied Link Buff</strong></div>'
                : `
                  <div class="hero-dps-stat"><span>Avg Damage</span><strong>${o.hitDmg.toLocaleString()}</strong></div>
                  <div class="hero-dps-stat"><span>${o.dpsMode === 'DoT DPS' ? 'DoT Multi' : 'Rate'}</span><strong>${esc(o.rateLabel)}</strong></div>
                  <div class="hero-dps-stat"><span>Inc Damage</span><strong>+${o.incDamagePct}%</strong></div>
                  <div class="hero-dps-stat"><span>Crit</span><strong>${o.critChancePct > 0 ? `${o.critChancePct}% / ${o.critMultiPct}%` : 'Non-Crit'}</strong></div>
                `}
            </div>
          </div>
          <div class="hero-metric hero-metric-col">
            <div class="hero-metric-top">
              <div>
                <div class="kpi-label">Ascendancy &amp; Keystones</div>
                <div class="kpi-value">${esc(a.ascendancy.name)}</div>
              </div>
              <span class="kpi-tag kpi-tag-hover" tabindex="0" data-hover-keystones="1">${keystoneNodes.length} KS</span>
            </div>
            <div class="pill-list">
              ${ascNotableNodes.map(({ id, node }) => `<span class="pill pill-hover pill-accent" tabindex="0" data-hover-node="${id}">${esc(node.n)}</span>`).join('')}
            </div>
          </div>
          <div class="hero-metric hero-metric-col">
            <div class="kpi-label">Bandit &amp; Pantheon</div>
            <div class="pill-list">
              <span class="pill pill-hover" tabindex="0" data-hover-bandit="${esc(a.bandit)}">${a.bandit === 'None' ? 'Kill All (Eramir)' : `Help ${esc(a.bandit)}`}</span>
              <span class="pill pill-hover pill-accent" tabindex="0" data-hover-pantheon="${esc(a.pantheonMajor)}">${esc(pantheonMaj)}</span>
              <span class="pill pill-hover" tabindex="0" data-hover-pantheon="${esc(a.pantheonMinor)}">${esc(pantheonMin)}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="bento-row-2">
        <div class="bento-card">
          <div class="card-head">
            <div>
              <h3>Resistances</h3>
              <p class="card-sub">Post-Kitava (-60%) vs ${esc(resCapSummary)}</p>
            </div>
            <span class="badge">${eleCapped ? 'Ele Capped' : 'Uncapped'}</span>
          </div>
          <div class="meter-stack">
            ${meterHtml('Fire Resistance', `${Math.min(d.maxFireRes, r.fire)}% / ${d.maxFireRes}% (${r.fire}%)`, (Math.max(0, r.fire) / d.maxFireRes) * 100, '#ef4444')}
            ${meterHtml('Cold Resistance', `${Math.min(d.maxColdRes, r.cold)}% / ${d.maxColdRes}% (${r.cold}%)`, (Math.max(0, r.cold) / d.maxColdRes) * 100, '#3b82f6')}
            ${meterHtml('Lightning Resistance', `${Math.min(d.maxLightRes, r.lightning)}% / ${d.maxLightRes}% (${r.lightning}%)`, (Math.max(0, r.lightning) / d.maxLightRes) * 100, '#eab308')}
            ${b.tree.summary.keystones.includes('Chaos Inoculation')
              ? meterHtml('Chaos Resistance (CI)', 'Immune (CI)', 100, '#8b5cf6')
              : meterHtml('Chaos Resistance', `${Math.min(d.maxChaosRes, r.chaos)}% / ${d.maxChaosRes}% (${r.chaos}%)`, (Math.max(0, r.chaos) / d.maxChaosRes) * 100, '#8b5cf6')}
          </div>
        </div>

        <div class="bento-card">
          <div class="card-head">
            <div>
              <h3>Attribute Requirements</h3>
              <p class="card-sub">Total attributes vs highest gem &amp; gear requirement</p>
            </div>
            <span class="badge">${at.str >= req.str && at.dex >= req.dex && at.int >= req.int ? 'All Met' : 'Deficit'}</span>
          </div>
          <div class="meter-stack">
            ${meterHtml('Strength', `${at.str} / ${req.str} req`, req.str > 0 ? (at.str / req.str) * 100 : 100, 'var(--gem-r)')}
            ${meterHtml('Dexterity', `${at.dex} / ${req.dex} req`, req.dex > 0 ? (at.dex / req.dex) * 100 : 100, 'var(--gem-g)')}
            ${meterHtml('Intelligence', `${at.int} / ${req.int} req`, req.int > 0 ? (at.int / req.int) * 100 : 100, 'var(--gem-b)')}
          </div>
        </div>
      </div>

      <div class="bento-row-3">
        <div class="bento-card">
          <div class="card-head">
            <div>
              <h3>Defenses &amp; Max Hits</h3>
              <p class="card-sub">Projected pools &amp; hit mitigation</p>
            </div>
          </div>
          <div class="def-pool-grid">
            <div class="def-stat-box">
              <div class="def-stat-top">
                <span class="def-stat-label">Max HP</span>
                <span class="def-pct-badge" title="${d.lifePct}% increased maximum Life">${d.lifePct}%</span>
              </div>
              <span class="def-stat-val def-life">${d.maxLife.toLocaleString()}</span>
            </div>
            <div class="def-stat-box">
              <div class="def-stat-top">
                <span class="def-stat-label">Max ES</span>
                <span class="def-pct-badge" title="${d.esPct}% increased maximum Energy Shield">${d.esPct}%</span>
              </div>
              <span class="def-stat-val def-es">${d.maxEs.toLocaleString()}</span>
            </div>
            <div class="def-stat-box">
              <div class="def-stat-top">
                <span class="def-stat-label">Max Mana</span>
                <span class="def-pct-badge" title="${d.manaPct}% increased maximum Mana">${d.manaPct}%</span>
              </div>
              <span class="def-stat-val def-mana">${d.maxMana.toLocaleString()}</span>
            </div>
          </div>
          <div class="def-mana-res" title="${reserved}% mana reserved — ${unreservedMana.toLocaleString()} of ${d.maxMana.toLocaleString()} mana available">
            <div class="def-mana-top">
              <span class="def-hit-name">Unreserved Mana</span>
              <span class="def-hit-meta">${reserved}% res</span>
              <span class="def-hit-val def-mana">${unreservedMana.toLocaleString()} mana</span>
            </div>
            <div class="meter-track def-mana-track">
              <div class="meter-fill" style="width:${reserved}%;background:var(--lime);"></div>
            </div>
          </div>
          <div class="def-hit-list">
            <div class="def-hit-row">
              <span class="def-hit-name">Phys Max Hit</span>
              <span class="def-hit-meta">${d.armour.toLocaleString()} AR</span>
              <span class="def-hit-val">${d.physMaxHit.toLocaleString()}</span>
            </div>
            <div class="def-hit-row">
              <span class="def-hit-name">Ele Max Hit</span>
              <span class="def-hit-meta">${d.spellSuppressPct >= 100 ? `${d.effEleRes}% Res · Spell ${d.spellEleMaxHit.toLocaleString()}` : `${d.effEleRes}% Res`}</span>
              <span class="def-hit-val">${d.eleMaxHit.toLocaleString()}</span>
            </div>
            <div class="def-hit-row">
              <span class="def-hit-name">Chaos Max Hit</span>
              <span class="def-hit-meta">${d.chaosMaxHit === null ? 'CI' : `${d.effChaosRes}% Res`}</span>
              <span class="def-hit-val ${d.chaosMaxHit === null ? 'def-immune' : ''}">${d.chaosMaxHit === null ? 'Immune' : d.chaosMaxHit.toLocaleString()}</span>
            </div>
            <div class="def-hit-row">
              <span class="def-hit-name">Evasion</span>
              <span class="def-hit-meta">${d.evadeChancePct}% Evade</span>
              <span class="def-hit-val">${d.evasion.toLocaleString()}</span>
            </div>
            <div class="def-hit-row">
              <span class="def-hit-name">Spell Suppression</span>
              <span class="def-hit-meta">${d.spellSuppressPct > 0 ? `${d.spellSuppressPreventPct}% Prev${d.isSuppressLucky ? ' · Lucky' : ''}` : (d.spellDodgePct > 0 ? 'Acrobatics' : '0% Prev')}</span>
              <span class="def-hit-val">${d.spellSuppressPct}%</span>
            </div>
            <div class="def-hit-row">
              <span class="def-hit-name">Dodge (Atk / Spell)</span>
              <span class="def-hit-meta">Cap 75%</span>
              <span class="def-hit-val">${d.attackDodgePct}% / ${d.spellDodgePct}%</span>
            </div>
            <div class="def-hit-row">
              <span class="def-hit-name">Block (Atk / Spell)</span>
              <span class="def-hit-meta">Cap ${d.maxAttackBlockPct}% / ${d.maxSpellBlockPct}%</span>
              <span class="def-hit-val">${d.attackBlockPct}% / ${d.spellBlockPct}%</span>
            </div>
          </div>
        </div>

        <div class="bento-card">
          <div class="card-head">
            <div>
              <h3>Keystones &amp; Notables</h3>
              <p class="card-sub">${b.tree.summary.masteries.length} masteries · ${b.tree.jewelSockets.length} jewel sockets</p>
            </div>
            <button type="button" class="btn btn-sm" data-jump="tree">Inspect →</button>
          </div>
          <div class="pill-list">
            ${keystoneNodes.map(({ id, node }) => `<span class="pill pill-hover pill-accent" tabindex="0" data-hover-node="${id}">${esc(node.n)}</span>`).join('')}
            ${notableNodes.map(({ id, node }) => `<span class="pill pill-hover" tabindex="0" data-hover-node="${id}">${esc(node.n)}</span>`).join('')}
          </div>
        </div>

        <div class="bento-card">
          <div class="card-head">
            <div>
              <h3>Loadout Highlights</h3>
              <p class="card-sub">${b.gear.items.length} equipped · ${uniques.length} unique${uniques.length === 1 ? '' : 's'}</p>
            </div>
            <button type="button" class="btn btn-sm" data-jump="gear">Gear →</button>
          </div>
          <div class="feed-list feed-list-compact">
            ${(['Weapon 1', 'Weapon 2', 'Helmet', 'Body Armour', 'Gloves', 'Boots', 'Amulet', 'Ring 1', 'Ring 2', 'Belt'] as const)
              .map((slot) => {
                const idx = b.gear.items.findIndex((it) => it.slot === slot);
                return idx >= 0 ? { item: b.gear.items[idx], idx } : null;
              })
              .filter((x): x is { item: GeneratedBuild['gear']['items'][number]; idx: number } => Boolean(x))
              .map(({ item, idx }) => `
              <div class="feed-row feed-row-hover" tabindex="0" data-hover-item="${idx}" data-item-mode="full">
                <div>
                  <div class="feed-title item-name-${item.rarity}">${esc(item.name)}</div>
                  <div class="feed-meta">${esc(item.baseName)}</div>
                </div>
                <span class="badge">${esc(item.slot)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    document.querySelectorAll('#view-dashboard [data-jump]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = (btn as HTMLElement).dataset.jump as NavView;
        switchView(target);
      });
    });
  }

  function renderTreeSide(b: GeneratedBuild) {
    const s = b.tree.summary;
    const ascNodes = b.tree.ascendancyNodes
      .map((id) => ({ id, node: data.tree.nodes[id] }))
      .filter((x) => x.node && (x.node.t === 'notable' || x.node.mco));
    const keystones = b.tree.nodes
      .map((id) => ({ id, node: b.tree.clusterNodes?.[id] ?? data.tree.nodes[id] }))
      .filter((x) => x.node && x.node.t === 'keystone');
    const notables = b.tree.nodes
      .map((id) => ({ id, node: b.tree.clusterNodes?.[id] ?? data.tree.nodes[id] }))
      .filter((x) => x.node && x.node.t === 'notable' && !x.node.a);

    const sideEl = document.getElementById('tree-side')!;
    sideEl.innerHTML = `
      <div>
        <h3>Ascendancy (${esc(b.archetype.ascendancy.name)})</h3>
        <div class="pill-list">
          ${ascNodes.map(({ id, node }) => `<button type="button" class="pill pill-btn pill-accent" data-node-id="${id}">${esc(node.n)}</button>`).join('')}
        </div>
      </div>
      <div>
        <h3>Keystones (${keystones.length})</h3>
        <div class="pill-list">
          ${keystones.length ? keystones.map(({ id, node }) => `<button type="button" class="pill pill-btn pill-accent" data-node-id="${id}">${esc(node.n)}</button>`).join('') : '<span class="tt-muted">None</span>'}
        </div>
      </div>
      <div>
        <h3>Masteries (${s.masteries.length})</h3>
        <div class="gem-list">
          ${s.masteries.map((m) => `<button type="button" class="gem-row gem-row-btn" data-node-id="${m.nodeId}"><span><strong>${esc(m.name)}:</strong> ${esc(m.text)}</span></button>`).join('') || '<span class="tt-muted">None</span>'}
        </div>
      </div>
      <div>
        <h3>Notable Passives (${notables.length})</h3>
        <div class="pill-list">
          ${notables.map(({ id, node }) => `<button type="button" class="pill pill-btn" data-node-id="${id}">${esc(node.n)}</button>`).join('')}
        </div>
      </div>
    `;
  }

  function formatGemTags(tags: string[]): string {
    const skip = new Set(['grants_active_skill', 'strength', 'dexterity', 'intelligence', 'support', 'low_max_level', 'exceptional']);
    return tags
      .filter((t) => !skip.has(t))
      .map((t) => t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
      .join(' · ');
  }

  function renderSkills(b: GeneratedBuild) {
    document.getElementById('view-skills')!.innerHTML = `
      <div class="skills-grid">
        ${b.skills.groups.map((grp, gIdx) => `
          <div class="bento-card">
            <div class="card-head">
              <div>
                <h3>${esc(grp.label)}</h3>
                <p class="card-sub">${esc(grp.slot)} · ${grp.gems.length}-Link</p>
              </div>
              <span class="badge">${grp.gems.length}L</span>
            </div>
            <div class="gem-list">
              ${grp.gems.map((gi, idx) => {
                const rerollBtn = gi.gem.support
                  ? (isMandatoryTotemSupport(b.archetype, gi.gem.name)
                    ? `<button type="button" class="gear-reroll-btn gem-reroll-btn" disabled title="Required by totem setup" aria-label="${esc(gi.gem.name)} required by totem setup">↻</button>`
                    : `<button type="button" class="gear-reroll-btn gem-reroll-btn" data-reroll-grp="${gIdx}" data-reroll-gem="${idx}" title="Reroll ${esc(gi.gem.name)} for this build" aria-label="Reroll ${esc(gi.gem.name)}">↻</button>`)
                  : '';
                return `
                  <div class="gem-row gem-row-hover" tabindex="0" data-grp="${gIdx}" data-gem="${idx}">
                    <span style="display:flex;align-items:center;">
                      <i class="gem-dot gem-c${gi.gem.color}"></i>
                      ${esc(gi.gem.name)}
                    </span>
                    <span class="gem-row-right">
                      <span class="gem-meta">Lv ${gi.level} / ${gi.quality}%</span>
                      ${rerollBtn}
                    </span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderGearCard(item: GeneratedBuild['gear']['items'][number], slotLabel?: string): string {
    return `
      <div class="item-card gear-item-card rarity-${item.rarity}">
        <div class="gear-item-head">
          <div class="gear-item-titles">
            <div class="item-name-${item.rarity}">${esc(item.name)}</div>
            <div class="item-base">${esc(item.baseName)}</div>
          </div>
          <div class="gear-item-head-top">
            <span class="gear-slot-tag">${esc(slotLabel ?? item.slot)}</span>
            <button
              type="button"
              class="gear-reroll-btn"
              data-reroll-item="${item.id}"
              title="Reroll ${esc(slotLabel ?? item.slot)} for this build"
              aria-label="Reroll ${esc(slotLabel ?? item.slot)}"
            >↻</button>
          </div>
        </div>
        <div class="item-meta-line">
          <span>iLvl ${item.itemLevel}</span>
          ${item.quality ? `<span>+${item.quality}%</span>` : ''}
          ${item.sockets ? `<span>${esc(item.sockets)}</span>` : ''}
        </div>
        ${item.implicits.length ? `<div class="item-implicits">${item.implicits.map(esc).join('<br>')}</div>` : ''}
        <div class="item-mods">
          ${item.explicits.map((line) =>
            line.endsWith('(crafted)')
              ? `<div class="item-crafted">${esc(line)}</div>`
              : `<div>${esc(line)}</div>`,
          ).join('')}
        </div>
      </div>
    `;
  }

  function renderGear(b: GeneratedBuild) {
    const itemById = new Map(b.gear.items.map((it) => [it.id, it]));
    const slotItem = (slot: string) => {
      const id = b.gear.slotMap[slot];
      return id ? itemById.get(id) : undefined;
    };
    const renderSlot = (slot: string, areaClass: string, emptyNote?: string) => {
      const it = slotItem(slot);
      if (it) {
        return `<div class="gear-slot ${areaClass}">${renderGearCard(it, slot)}</div>`;
      }
      return `
        <div class="gear-slot ${areaClass}">
          <div class="item-card gear-item-card gear-slot-empty">
            <div class="gear-slot-tag">${esc(slot)}</div>
            <div class="gear-empty-note">${esc(emptyNote ?? 'Empty')}</div>
          </div>
        </div>
      `;
    };

    const flasks = ['Flask 1', 'Flask 2', 'Flask 3', 'Flask 4', 'Flask 5']
      .map((slot) => slotItem(slot))
      .filter((it): it is NonNullable<typeof it> => Boolean(it));
    const jewels = b.gear.items.filter((it) => it.jewelNodeId !== undefined);
    const clusterJewels = jewels.filter((j) => j.base.subType === 'Cluster');
    const baseJewels = jewels.filter((j) => j.base.subType !== 'Cluster');

    document.getElementById('view-gear')!.innerHTML = `
      <div class="gear-layout">
        <div class="bento-card gear-equipment-panel">
          <div class="card-head gear-section-head">
            <div>
              <h2>Equipment</h2>
              <p class="card-sub">${esc(b.archetype.weaponSetup.replace(/_/g, ' '))} · ${esc(b.archetype.defenseStyle)} profile</p>
            </div>
          </div>

          <div class="gear-paperdoll">
            ${renderSlot('Weapon 1', 'slot-weapon1')}
            ${renderSlot('Helmet', 'slot-helmet')}
            ${renderSlot('Weapon 2', 'slot-weapon2', 'Occupied by 2H Weapon')}
            ${renderSlot('Body Armour', 'slot-body')}
            ${renderSlot('Amulet', 'slot-amulet')}
            ${renderSlot('Ring 1', 'slot-ring1')}
            ${renderSlot('Ring 2', 'slot-ring2')}
            ${renderSlot('Gloves', 'slot-gloves')}
            ${renderSlot('Belt', 'slot-belt')}
            ${renderSlot('Boots', 'slot-boots')}
          </div>

          <div class="gear-flasks">
            ${flasks.map((f) => renderGearCard(f, f.slot)).join('')}
          </div>
        </div>

        ${clusterJewels.length > 0 || baseJewels.length > 0 ? `
          <div class="bento-card gear-jewels-panel">
            ${clusterJewels.length > 0 ? `
              <div class="gear-jewel-group">
                <div class="card-head gear-section-head">
                  <div>
                    <h3>Cluster Jewels</h3>
                    <p class="card-sub">${clusterJewels.length} cluster jewel${clusterJewels.length === 1 ? '' : 's'} socketed in passive tree</p>
                  </div>
                </div>
                <div class="gear-jewels-grid">
                  ${clusterJewels.map((j) => renderGearCard(j, `Cluster #${j.jewelNodeId}`)).join('')}
                </div>
              </div>
            ` : ''}
            ${baseJewels.length > 0 ? `
              <div class="gear-jewel-group">
                <div class="card-head gear-section-head">
                  <div>
                    <h3>Base Jewels</h3>
                    <p class="card-sub">${baseJewels.length} jewel socket${baseJewels.length === 1 ? '' : 's'} allocated</p>
                  </div>
                </div>
                <div class="gear-jewels-grid">
                  ${baseJewels.map((j) => renderGearCard(j, `Socket #${j.jewelNodeId}`)).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderExport(b: GeneratedBuild) {
    document.getElementById('view-export')!.innerHTML = `
      <div class="bento-card" style="display:flex;flex-direction:column;gap:12px;">
        <div class="card-head" style="margin-bottom:0;">
          <div>
            <h2>Path of Building Import Code</h2>
            <p class="card-sub">In Path of Building Community: Import/Export Build → Import from Pastebin / Code</p>
          </div>
          <button type="button" class="btn btn-cta" id="copy-code-tab-btn">Copy Code</button>
        </div>
        <textarea class="code-box" readonly id="pob-code-area">${esc(b.pobCode)}</textarea>
        <div class="card-head" style="margin:6px 0 0;">
          <h3>Raw PoB XML Preview</h3>
        </div>
        <textarea class="code-box" style="min-height:280px;" readonly>${esc(b.xml)}</textarea>
      </div>
    `;
    document.getElementById('copy-code-tab-btn')!.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      await navigator.clipboard.writeText(b.pobCode);
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy Code'; }, 1500);
    });
  }

  function formatSavedDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  }

  function renderSavedBuilds() {
    const viewSavedEl = document.getElementById('view-saved')!;
    const activeSig = buildOptionsSignature(options);
    viewSavedEl.innerHTML = `
      <div class="bento-card">
        <div class="card-head" style="margin-bottom:0;">
          <div>
            <h2>Saved Builds</h2>
            <p class="card-sub">${savedBuilds.length} saved in browser localStorage · deterministic by seed &amp; knobs</p>
          </div>
          <div class="saved-header-actions">
            <button type="button" class="btn btn-cta" id="saved-tab-save-btn">Save Current Build</button>
            ${savedBuilds.length ? `<button type="button" class="btn" id="saved-clear-all-btn">Clear All</button>` : ''}
          </div>
        </div>
      </div>
      ${savedBuilds.length === 0
        ? `
          <div class="bento-card saved-empty">
            <h3>No builds saved yet</h3>
            <p class="card-sub">Click <strong>Save Build</strong> in the top bar (or <strong>Save Current Build</strong> above) to bookmark a build locally so you can reload it anytime.</p>
          </div>
        `
        : `
          <div class="saved-grid">
            ${savedBuilds.map((entry) => {
              const s = entry.summary;
              const o = entry.options;
              const isCurrent = entry.id === activeSig;
              const isEditing = editingSavedId === entry.id;
              return `
                <div class="bento-card saved-card ${isCurrent ? 'is-active' : ''}" data-saved-id="${esc(entry.id)}">
                  <div class="card-head" style="margin-bottom:8px;">
                    <div style="min-width:0;flex:1;">
                      ${isEditing
                        ? `<div class="saved-rename-row">
                            <input type="text" class="saved-rename-input" value="${esc(entry.name)}" data-rename-input="${esc(entry.id)}" aria-label="Build name" />
                            <button type="button" class="btn btn-sm btn-cta" data-saved-action="save-rename" data-id="${esc(entry.id)}">Save</button>
                            <button type="button" class="btn btn-sm" data-saved-action="cancel-rename" data-id="${esc(entry.id)}">Cancel</button>
                          </div>`
                        : `<h3 class="saved-title">${esc(entry.name)}${isCurrent ? ' <span class="badge">Active</span>' : ''}</h3>`}
                      <p class="card-sub">${esc(s.className)} (${esc(s.ascendancyName)}) · ${esc(s.mainSkill)} · Lv ${o.level}</p>
                    </div>
                  </div>
                  <div class="badges" style="margin-bottom:10px;">
                    <span class="badge ${o.leagueMode === 'hardcore' ? 'badge-hc' : 'badge-sc'}">${esc(o.leagueMode)}</span>
                    <span class="badge ${o.economy === 'ssf' ? 'badge-ssf' : 'badge-trade'}">${esc(o.economy)}</span>
                    <span class="badge">${esc(s.damageStyle)}</span>
                    <span class="badge">${esc(s.defenseStyle)}</span>
                    <span class="badge">PoE ${esc(entry.treeVersion.replace('_', '.'))}</span>
                  </div>
                  <div class="saved-stats">
                    <div class="saved-stat"><span>Offense</span><strong>${s.dpsMode === 'Support' ? 'Link Buff' : `${s.totalDps.toLocaleString()} DPS`}</strong></div>
                    <div class="saved-stat"><span>Pool</span><strong>${s.maxLife.toLocaleString()} HP / ${s.maxEs.toLocaleString()} ES</strong></div>
                    <div class="saved-stat"><span>Resists</span><strong>${s.effEleRes}% Ele / ${s.effChaosRes}% Chaos</strong></div>
                    <div class="saved-stat"><span>Seed</span><strong><code>${esc(o.seed)}</code></strong></div>
                  </div>
                  <div class="saved-card-foot">
                    <span class="saved-date">Saved ${esc(formatSavedDate(entry.savedAt))}</span>
                    <div class="saved-actions">
                      <button type="button" class="btn btn-sm btn-cta" data-saved-action="load" data-id="${esc(entry.id)}">Load</button>
                      <button type="button" class="btn btn-sm" data-saved-action="rename" data-id="${esc(entry.id)}">Rename</button>
                      <button type="button" class="btn btn-sm" data-saved-action="delete" data-id="${esc(entry.id)}">Delete</button>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
    `;
  }

  // Event wiring
  const gemTooltip = document.createElement('div');
  gemTooltip.className = 'gem-tooltip hidden';
  document.body.appendChild(gemTooltip);

  const positionFloatingTip = (anchor: HTMLElement) => {
    gemTooltip.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    const tipRect = gemTooltip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - tipRect.width - 12, Math.max(12, r.left));
    const spaceBelow = window.innerHeight - r.bottom;
    const top = spaceBelow >= tipRect.height + 14
      ? r.bottom + 8
      : Math.max(12, r.top - tipRect.height - 8);
    gemTooltip.style.left = `${left}px`;
    gemTooltip.style.top = `${top}px`;
  };

  const showNodeTooltipFor = (el: HTMLElement) => {
    if (el.dataset.hoverKeystones && currentBuild) {
      const ks = currentBuild.tree.nodes
        .map((id) => currentBuild?.tree.clusterNodes?.[id] ?? data.tree.nodes[id])
        .filter((n) => n && n.t === 'keystone');
      gemTooltip.innerHTML = ks.length
        ? ks.map((k) => `
            <div style="margin-bottom:8px;">
              <div class="gt-head"><span>${esc(k.n)}</span><span class="gt-kind">Keystone</span></div>
              <div class="gt-desc">${(k.s ?? []).map(esc).join('<br>')}</div>
            </div>
          `).join('')
        : `<div class="gt-head"><span>Keystones</span></div><div class="gt-desc">No keystones allocated.</div>`;
      positionFloatingTip(el);
      return;
    }
    const nodeId = Number(el.dataset.hoverNode);
    const n = currentBuild?.tree.clusterNodes?.[nodeId] ?? data.tree.nodes[nodeId];
    if (!n) return;
    const kind = n.a ? `${n.a} Ascendancy` : n.t === 'keystone' ? 'Keystone' : 'Notable';
    gemTooltip.innerHTML = `
      <div class="gt-head">
        <span>${esc(n.n)}</span>
        <span class="gt-kind">${esc(kind)}</span>
      </div>
      ${n.s?.length ? `<div class="gt-desc">${n.s.map(esc).join('<br>')}</div>` : ''}
    `;
    positionFloatingTip(el);
  };

  const formatItemBaseLines = (item: GeneratedBuild['gear']['items'][number]): string[] => {
    const out: string[] = [];
    const b = item.base;
    if (b.weapon) {
      const aps = b.weapon.AttackRateBase;
      const phys = b.weapon.PhysicalMin !== undefined && b.weapon.PhysicalMax !== undefined
        ? `Phys ${b.weapon.PhysicalMin}-${b.weapon.PhysicalMax}`
        : '';
      out.push([phys, `Crit ${b.weapon.CritChanceBase}%`, `APS ${aps}`].filter(Boolean).join(' · '));
    }
    if (b.armour) {
      const parts: string[] = [];
      if (b.armour.ArmourBaseMax) parts.push(`Armour ${b.armour.ArmourBaseMin}-${b.armour.ArmourBaseMax}`);
      if (b.armour.EvasionBaseMax) parts.push(`Evasion ${b.armour.EvasionBaseMin}-${b.armour.EvasionBaseMax}`);
      if (b.armour.EnergyShieldBaseMax) parts.push(`ES ${b.armour.EnergyShieldBaseMin}-${b.armour.EnergyShieldBaseMax}`);
      if (b.armour.BlockChance) parts.push(`Block ${b.armour.BlockChance}%`);
      if (parts.length) out.push(parts.join(' · '));
    }
    if (b.flask) {
      const f = b.flask as Record<string, unknown>;
      const parts: string[] = [];
      if (f.life) parts.push(`Recovers ${f.life} Life`);
      if (f.mana) parts.push(`Recovers ${f.mana} Mana`);
      if (f.duration) parts.push(`Lasts ${f.duration}s`);
      if (f.chargesUsed && f.chargesMax) parts.push(`${f.chargesUsed}/${f.chargesMax} Charges`);
      if (Array.isArray(f.buff) && f.buff.length) parts.push(f.buff.join(', '));
      if (parts.length) out.push(parts.join(' · '));
    }
    const reqs: string[] = [];
    if (b.req.level) reqs.push(`Lv ${b.req.level}`);
    if (b.req.str) reqs.push(`${b.req.str} Str`);
    if (b.req.dex) reqs.push(`${b.req.dex} Dex`);
    if (b.req.int) reqs.push(`${b.req.int} Int`);
    if (reqs.length) out.push(`Requires ${reqs.join(', ')}`);
    return out;
  };

  const showItemTooltipFor = (el: HTMLElement) => {
    if (!currentBuild) return;
    const item = currentBuild.gear.items[Number(el.dataset.hoverItem)];
    if (!item) return;
    const baseStats = formatItemBaseLines(item);
    const mode = el.dataset.itemMode;

    if (mode === 'full') {
      gemTooltip.innerHTML = `
        <div class="gt-head">
          <span class="item-name-${item.rarity}">${esc(item.name)}</span>
          <span class="gt-kind">${esc(item.slot)}</span>
        </div>
        <div class="gt-tags" style="color:var(--muted);">${esc(item.baseName)} · iLvl ${item.itemLevel}${item.sockets ? ` · ${esc(item.sockets)}` : ''}</div>
        ${baseStats.length ? `<div class="gt-desc" style="margin-bottom:5px;color:var(--muted);">${baseStats.map(esc).join('<br>')}</div>` : ''}
        ${item.implicits.length ? `<div class="gt-desc" style="margin-bottom:5px;">${item.implicits.map(esc).join('<br>')}</div>` : ''}
        <div class="gt-desc">${item.explicits.map(esc).join('<br>')}</div>
      `;
    } else {
      const affixLines = [
        ...item.prefixes.map((p) => `<span class="gt-affix">P</span> <strong>${esc(p.mod.affix)}</strong> (Lv ${p.mod.lvl}, ${Math.round(p.range * 100)}% roll): ${p.resolvedLines.map(esc).join(', ')}`),
        ...item.suffixes.map((s) => `<span class="gt-affix">S</span> <strong>${esc(s.mod.affix)}</strong> (Lv ${s.mod.lvl}, ${Math.round(s.range * 100)}% roll): ${s.resolvedLines.map(esc).join(', ')}`),
        ...(item.craftedMod ? [`<span class="gt-affix">C</span> <strong>Bench Craft</strong>: ${esc(item.craftedMod)}`] : []),
      ];
      gemTooltip.innerHTML = `
        <div class="gt-head">
          <span class="item-name-${item.rarity}">${esc(item.name)}</span>
          <span class="gt-kind">${esc(item.rarity)} · ${esc(item.slot)}</span>
        </div>
        <div class="gt-tags" style="color:var(--muted);">${esc(item.baseName)}</div>
        ${baseStats.length ? `<div class="gt-desc" style="margin-bottom:6px;">${baseStats.map(esc).join('<br>')}</div>` : ''}
        ${affixLines.length ? `<div class="gt-desc" style="border-top:1px solid var(--border);padding-top:6px;">${affixLines.join('<br>')}</div>` : ''}
      `;
    }
    positionFloatingTip(el);
  };

  const BANDIT_INFO: Record<string, { title: string; desc: string }> = {
    None: { title: 'Kill All Bandits (Eramir)', desc: '+1 Passive Skill Point' },
    Alira: { title: 'Help Alira', desc: '+15% to all Elemental Resistances' },
    Oak: { title: 'Help Oak', desc: '+40 to maximum Life' },
    Kraityn: { title: 'Help Kraityn', desc: '8% increased Movement Speed' },
  };

  const showBanditOrPantheonTip = (el: HTMLElement) => {
    if (el.dataset.hoverBandit) {
      const info = BANDIT_INFO[el.dataset.hoverBandit] ?? BANDIT_INFO.None;
      gemTooltip.innerHTML = `
        <div class="gt-head"><span>${esc(info.title)}</span><span class="gt-kind">Act 2 Bandit</span></div>
        <div class="gt-desc">${esc(info.desc)}</div>
      `;
      positionFloatingTip(el);
      return;
    }
    const gid = el.dataset.hoverPantheon;
    if (gid) {
      const maj = data.pantheons.major.find((p) => p.id === gid);
      const min = data.pantheons.minor.find((p) => p.id === gid);
      const god = maj ?? min;
      if (!god) return;
      const kind = maj ? 'Major God' : 'Minor God';
      gemTooltip.innerHTML = `
        <div class="gt-head"><span>Soul of ${esc(god.name)}</span><span class="gt-kind">${kind}</span></div>
        <div class="gt-desc">${god.mods.map(esc).join('<br>')}</div>
      `;
      positionFloatingTip(el);
    }
  };

  const viewDashEl = document.getElementById('view-dashboard')!;
  viewDashEl.addEventListener('mouseover', (e) => {
    const bpTarget = (e.target as HTMLElement).closest<HTMLElement>('[data-hover-bandit], [data-hover-pantheon]');
    if (bpTarget) { showBanditOrPantheonTip(bpTarget); return; }
    const itemTarget = (e.target as HTMLElement).closest<HTMLElement>('[data-hover-item]');
    if (itemTarget) { showItemTooltipFor(itemTarget); return; }
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-hover-node], [data-hover-keystones]');
    if (target) showNodeTooltipFor(target);
  });
  viewDashEl.addEventListener('mouseout', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-hover-node], [data-hover-keystones], [data-hover-item], [data-hover-bandit], [data-hover-pantheon]');
    if (!target) return;
    const related = e.relatedTarget as Node | null;
    if (!related || !target.contains(related)) gemTooltip.classList.add('hidden');
  });
  viewDashEl.addEventListener('focusin', (e) => {
    const bpTarget = (e.target as HTMLElement).closest<HTMLElement>('[data-hover-bandit], [data-hover-pantheon]');
    if (bpTarget) { showBanditOrPantheonTip(bpTarget); return; }
    const itemTarget = (e.target as HTMLElement).closest<HTMLElement>('[data-hover-item]');
    if (itemTarget) { showItemTooltipFor(itemTarget); return; }
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-hover-node], [data-hover-keystones]');
    if (target) showNodeTooltipFor(target);
  });
  viewDashEl.addEventListener('focusout', () => {
    gemTooltip.classList.add('hidden');
  });

  const showGemTooltipFor = (row: HTMLElement) => {
    if (!currentBuild) return;
    const gIdx = Number(row.dataset.grp);
    const idx = Number(row.dataset.gem);
    const gi = currentBuild.skills.groups[gIdx]?.gems[idx];
    if (!gi) return;
    const tagLine = formatGemTags(gi.gem.tags);
    const kind = gi.gem.support ? 'Support' : 'Active';
    gemTooltip.innerHTML = `
      <div class="gt-head">
        <span><i class="gem-dot gem-c${gi.gem.color}"></i>${esc(gi.gem.name)}</span>
        <span class="gt-kind">${kind} · Lv ${gi.level}/${gi.quality}%</span>
      </div>
      ${tagLine ? `<div class="gt-tags">${esc(tagLine)}</div>` : ''}
      ${gi.gem.description ? `<div class="gt-desc">${esc(gi.gem.description)}</div>` : ''}
    `;
    positionFloatingTip(row);
  };

  const viewSkillsEl = document.getElementById('view-skills')!;
  viewSkillsEl.addEventListener('mouseover', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.gem-row-hover');
    if (row) showGemTooltipFor(row);
  });
  viewSkillsEl.addEventListener('mouseout', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.gem-row-hover');
    if (!row) return;
    const related = e.relatedTarget as Node | null;
    if (!related || !row.contains(related)) gemTooltip.classList.add('hidden');
  });
  viewSkillsEl.addEventListener('focusin', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.gem-row-hover');
    if (row) showGemTooltipFor(row);
  });
  viewSkillsEl.addEventListener('focusout', () => {
    gemTooltip.classList.add('hidden');
  });
  viewSkillsEl.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-reroll-grp]');
    if (!btn || btn.disabled || !currentBuild) return;
    e.stopPropagation();
    gemTooltip.classList.add('hidden');
    const gIdx = Number(btn.dataset.rerollGrp);
    const gemIdx = Number(btn.dataset.rerollGem);
    if (!Number.isFinite(gIdx) || !Number.isFinite(gemIdx)) return;
    const key = `${gIdx}:${gemIdx}`;
    const nextCount = (supportRerollCounts.get(key) ?? 0) + 1;
    supportRerollCounts.set(key, nextCount);
    btn.disabled = true;
    try {
      const next = await rerollBuildSupportGem(
        data,
        currentBuild,
        gIdx,
        gemIdx,
        `${currentBuild.archetype.options.seed}|sup-${gIdx}-${gemIdx}|reroll-${nextCount}`,
      );
      const ws = document.querySelector<HTMLElement>('.workspace');
      const prevScroll = ws?.scrollTop ?? 0;
      currentBuild = next;
      updateSidebarMeta(next);
      renderDashboard(next);
      renderSkills(next);
      renderGear(next);
      renderExport(next);
      if (ws) ws.scrollTop = prevScroll;
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('tree-side')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
    if (!btn) return;
    const nodeId = Number(btn.dataset.nodeId);
    document.querySelectorAll('#tree-side [data-node-id].is-focused').forEach((el) => el.classList.remove('is-focused'));
    btn.classList.add('is-focused');
    treeCanvas?.focusNode(nodeId);
  });

  document.getElementById('sidebar-nav')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-view]') as HTMLElement | null;
    if (!btn) return;
    switchView(btn.dataset.view as NavView);
  });

  document.getElementById('collapse-btn')!.addEventListener('click', () => {
    layoutEl.classList.toggle('sidebar-collapsed');
    if (activeView === 'tree') {
      setTimeout(() => treeCanvas?.resize(), 220);
    }
  });

  document.getElementById('theme-switch')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-theme-pref]') as HTMLElement | null;
    if (!btn) return;
    applyTheme(btn.dataset.themePref as ThemePref);
  });

  function saveCurrentBuild() {
    if (!currentBuild) return;
    const res = saveBuildToStorage(currentBuild, data.tree.version);
    savedBuilds = res.entries;
    updateSavedUiState();
    renderSavedBuilds();
    const orig = saveBuildBtn.textContent;
    saveBuildBtn.textContent = res.updated ? 'Updated!' : 'Saved!';
    setTimeout(() => {
      if (saveBuildBtn.textContent === 'Saved!' || saveBuildBtn.textContent === 'Updated!') {
        updateSavedUiState();
      } else {
        saveBuildBtn.textContent = orig;
      }
    }, 1200);
  }

  saveBuildBtn.addEventListener('click', saveCurrentBuild);

  const viewSavedEl = document.getElementById('view-saved')!;
  viewSavedEl.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('#saved-tab-save-btn')) {
      saveCurrentBuild();
      return;
    }
    if (target.closest('#saved-clear-all-btn')) {
      savedBuilds = clearSavedBuilds();
      editingSavedId = null;
      updateSavedUiState();
      renderSavedBuilds();
      return;
    }
    const actionBtn = target.closest<HTMLElement>('[data-saved-action]');
    if (!actionBtn) return;
    const action = actionBtn.dataset.savedAction;
    const id = actionBtn.dataset.id ?? '';
    if (action === 'load') {
      const found = savedBuilds.find((entry) => entry.id === id);
      if (!found) return;
      syncControlsFromOptions(found.options);
      await regenerate();
      switchView('dashboard');
    } else if (action === 'delete') {
      savedBuilds = deleteSavedBuild(id);
      if (editingSavedId === id) editingSavedId = null;
      updateSavedUiState();
      renderSavedBuilds();
    } else if (action === 'rename') {
      editingSavedId = id;
      renderSavedBuilds();
      const inp = viewSavedEl.querySelector<HTMLInputElement>(`input[data-rename-input="${CSS.escape(id)}"]`);
      inp?.focus();
      inp?.select();
    } else if (action === 'cancel-rename') {
      editingSavedId = null;
      renderSavedBuilds();
    } else if (action === 'save-rename') {
      const inp = viewSavedEl.querySelector<HTMLInputElement>(`input[data-rename-input="${CSS.escape(id)}"]`);
      if (inp) savedBuilds = renameSavedBuild(id, inp.value);
      editingSavedId = null;
      renderSavedBuilds();
    }
  });
  viewSavedEl.addEventListener('keydown', (e) => {
    const inp = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-rename-input]');
    if (!inp) return;
    if (e.key === 'Enter') {
      const id = inp.dataset.renameInput ?? '';
      savedBuilds = renameSavedBuild(id, inp.value);
      editingSavedId = null;
      renderSavedBuilds();
    } else if (e.key === 'Escape') {
      editingSavedId = null;
      renderSavedBuilds();
    }
  });

  document.getElementById('copy-pob-btn')!.addEventListener('click', async (e) => {
    if (!currentBuild) return;
    const btn = e.currentTarget as HTMLButtonElement;
    await navigator.clipboard.writeText(currentBuild.pobCode);
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });

  document.getElementById('download-xml-btn')!.addEventListener('click', () => {
    if (!currentBuild) return;
    const blob = new Blob([currentBuild.xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${currentBuild.archetype.ascendancy.name.toLowerCase()}-${currentBuild.archetype.options.seed}.xml`;
    link.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('view-gear')!.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-reroll-item]');
    if (!btn || !currentBuild) return;
    const itemId = Number(btn.dataset.rerollItem);
    if (!Number.isFinite(itemId)) return;
    const nextCount = (itemRerollCounts.get(itemId) ?? 0) + 1;
    itemRerollCounts.set(itemId, nextCount);
    btn.disabled = true;
    try {
      const next = await rerollBuildItem(
        data,
        currentBuild,
        itemId,
        `${currentBuild.archetype.options.seed}|item-${itemId}|reroll-${nextCount}`,
      );
      const ws = document.querySelector<HTMLElement>('.workspace');
      const prevScroll = ws?.scrollTop ?? 0;
      currentBuild = next;
      updateSidebarMeta(next);
      renderDashboard(next);
      renderTreeSide(next);
      renderGear(next);
      renderExport(next);
      treeCanvas?.setBuildTree(next.tree);
      if (ws) ws.scrollTop = prevScroll;
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('league-seg')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    options.leagueMode = btn.dataset.mode as LeagueMode;
    document.querySelectorAll('#league-seg button').forEach((b) => b.classList.toggle('active', b === btn));
    updateKnobSummary();
  });

  document.getElementById('eco-seg')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    options.economy = btn.dataset.eco as EconomyMode;
    document.querySelectorAll('#eco-seg button').forEach((b) => b.classList.toggle('active', b === btn));
    updateKnobSummary();
  });

  classSel.addEventListener('change', () => {
    options.classId = classSel.value === 'random' ? 'random' : Number(classSel.value);
    options.ascendancyIndex = 'random';
    syncAscDropdown();
    updateKnobSummary();
  });

  ascSel.addEventListener('change', () => {
    options.ascendancyIndex = ascSel.value === 'random' ? 'random' : Number(ascSel.value);
    updateKnobSummary();
  });

  styleSel.addEventListener('change', () => {
    options.damageStyle = styleSel.value as DamageStyle | 'random';
    updateKnobSummary();
  });

  defSel.addEventListener('change', () => {
    options.defenseStyle = defSel.value as DefenseStyle | 'random';
    updateKnobSummary();
  });

  levelRange.addEventListener('input', () => {
    levelVal.textContent = levelRange.value;
    options.level = Number(levelRange.value);
    updateKnobSummary();
  });

  addTargetBtn.addEventListener('click', () => {
    renderTargetPickerOptions();
    targetPickerRow.hidden = false;
    targetStatPicker.value = '';
    targetStatPicker.focus();
  });

  cancelTargetPickerBtn.addEventListener('click', () => {
    targetPickerRow.hidden = true;
  });

  targetStatPicker.addEventListener('change', () => {
    const key = targetStatPicker.value as TargetStatKey;
    if (key) addTargetStat(key);
  });

  targetRowsEl.addEventListener('input', (e) => {
    const inp = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-target-key]');
    if (!inp) return;
    commitTargetInput(inp.dataset.targetKey as TargetStatKey, inp.value);
    updateKnobSummary();
  });

  targetRowsEl.addEventListener('change', (e) => {
    const inp = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-target-key]');
    if (!inp) return;
    commitTargetInput(inp.dataset.targetKey as TargetStatKey, inp.value);
    updateKnobSummary();
  });

  targetRowsEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-remove-target]');
    if (!btn) return;
    removeTargetStat(btn.dataset.removeTarget as TargetStatKey);
  });

  clearTargetsBtn.addEventListener('click', () => {
    activeTargetKeys = [];
    options.targets = undefined;
    targetPickerRow.hidden = true;
    renderTargetRows();
    updateKnobSummary();
  });

  document.getElementById('apply-seed-btn')!.addEventListener('click', () => {
    commitAllTargetInputs();
    options.seed = seedInput.value.trim() || randomSeed();
    void regenerate();
  });

  seedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commitAllTargetInputs();
      options.seed = seedInput.value.trim() || randomSeed();
      void regenerate();
    }
  });

  document.getElementById('reroll-btn')!.addEventListener('click', () => {
    commitAllTargetInputs();
    options.seed = randomSeed();
    void regenerate();
  });

  syncTargetControls();
  await regenerate();
}

void main();
