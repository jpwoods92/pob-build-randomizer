import './styles.css';
import { loadGameData } from './lib/data.ts';
import { randomSeed } from './lib/rng.ts';
import { generateBuild, type GeneratedBuild } from './lib/generator.ts';
import type { BuildOptions, DamageStyle, DefenseStyle, EconomyMode, LeagueMode } from './lib/archetype.ts';
import type { GameData } from './lib/types.ts';
import { TreeCanvas } from './components/TreeCanvas.ts';

type ThemePref = 'system' | 'light' | 'dark';
type NavView = 'dashboard' | 'tree' | 'skills' | 'gear' | 'export';

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
  root.innerHTML = `<div class="loading">Loading Path of Exile 3.30 tree, gems, bases, mods &amp; uniques...</div>`;

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
            <p>PoE 1 (3.30) Randomizer</p>
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
  const seedInput = document.getElementById('seed-input') as HTMLInputElement;
  const knobSummaryEl = document.getElementById('sidebar-knob-summary')!;
  const officialTreeLink = document.getElementById('official-tree-link') as HTMLAnchorElement;

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

  function updateSidebarMeta(b: GeneratedBuild) {
    const modeLabel = options.leagueMode === 'hardcore' ? 'Hardcore' : 'Softcore';
    const ecoLabel = options.economy === 'ssf' ? 'SSF' : 'Trade';
    knobSummaryEl.textContent = `${modeLabel} · ${ecoLabel} · Level ${options.level}`;
    document.getElementById('nav-pts-pill')!.textContent = String(b.tree.pointsUsed);
    const mainLinks = b.skills.groups[0]?.gems.length ?? 6;
    document.getElementById('nav-links-pill')!.textContent = `${mainLinks}L`;
    officialTreeLink.href = b.tree.url;
  }

  async function regenerate() {
    seedInput.value = options.seed;
    const build = await generateBuild(data, options);
    currentBuild = build;
    updateSidebarMeta(build);
    renderDashboard(build);
    renderTreeSide(build);
    renderSkills(build);
    renderGear(build);
    renderExport(build);
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
    const req = b.skills.maxReq;
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
      .map((id) => ({ id, node: data.tree.nodes[id] }))
      .filter((x) => x.node && x.node.t === 'keystone');
    const notableNodes = b.tree.nodes
      .map((id) => ({ id, node: data.tree.nodes[id] }))
      .filter((x) => x.node && x.node.t === 'notable' && !x.node.a)
      .slice(0, 8);

    const eleCapped = r.fire >= 75 && r.cold >= 75 && r.lightning >= 75;

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
            </div>
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
              <p class="card-sub">Post-Kitava (-60%) vs 75% default cap</p>
            </div>
            <span class="badge">${eleCapped ? 'Ele Capped' : 'Uncapped'}</span>
          </div>
          <div class="meter-stack">
            ${meterHtml('Fire Resistance', `${Math.min(75, r.fire)}% / 75% (${r.fire}%)`, (Math.max(0, r.fire) / 75) * 100, '#ef4444')}
            ${meterHtml('Cold Resistance', `${Math.min(75, r.cold)}% / 75% (${r.cold}%)`, (Math.max(0, r.cold) / 75) * 100, '#3b82f6')}
            ${meterHtml('Lightning Resistance', `${Math.min(75, r.lightning)}% / 75% (${r.lightning}%)`, (Math.max(0, r.lightning) / 75) * 100, '#eab308')}
            ${b.tree.summary.keystones.includes('Chaos Inoculation')
              ? meterHtml('Chaos Resistance (CI)', 'Immune (CI)', 100, '#8b5cf6')
              : meterHtml('Chaos Resistance', `${Math.min(75, r.chaos)}% / 75% (${r.chaos}%)`, (Math.max(0, r.chaos) / 75) * 100, '#8b5cf6')}
          </div>
        </div>

        <div class="bento-card">
          <div class="card-head">
            <div>
              <h3>Attribute Requirements</h3>
              <p class="card-sub">Total attributes vs highest gem requirement</p>
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
              <span class="def-hit-meta">${d.effEleRes}% Res</span>
              <span class="def-hit-val">${d.eleMaxHit.toLocaleString()}</span>
            </div>
            <div class="def-hit-row">
              <span class="def-hit-name">Chaos Max Hit</span>
              <span class="def-hit-meta">${d.chaosMaxHit === null ? 'CI' : `${d.effChaosRes}% Res`}</span>
              <span class="def-hit-val ${d.chaosMaxHit === null ? 'def-immune' : ''}">${d.chaosMaxHit === null ? 'Immune' : d.chaosMaxHit.toLocaleString()}</span>
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
          <div class="feed-list">
            ${b.gear.items.slice(0, 5).map((item, idx) => `
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
      .map((id) => ({ id, node: data.tree.nodes[id] }))
      .filter((x) => x.node && x.node.t === 'keystone');
    const notables = b.tree.nodes
      .map((id) => ({ id, node: data.tree.nodes[id] }))
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
              ${grp.gems.map((gi, idx) => `
                <div class="gem-row gem-row-hover" tabindex="0" data-grp="${gIdx}" data-gem="${idx}">
                  <span style="display:flex;align-items:center;">
                    <i class="gem-dot gem-c${gi.gem.color}"></i>
                    ${esc(gi.gem.name)}
                  </span>
                  <span class="gem-meta">Lv ${gi.level} / ${gi.quality}%</span>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderGear(b: GeneratedBuild) {
    document.getElementById('view-gear')!.innerHTML = `
      <div class="items-grid">
        ${b.gear.items.map((item, idx) => `
          <div class="item-card item-card-hover rarity-${item.rarity}" tabindex="0" data-hover-item="${idx}" data-item-mode="detail">
            <div>
              <div class="item-name-${item.rarity}">${esc(item.name)}</div>
              <div class="item-base">${esc(item.baseName)} · ${esc(item.slot)}</div>
            </div>
            <div class="item-meta-line">
              <span>iLvl ${item.itemLevel}</span>
              ${item.quality ? `<span>Qual +${item.quality}%</span>` : ''}
              ${item.sockets ? `<span>Sockets: ${esc(item.sockets)}</span>` : ''}
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
        `).join('')}
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
        .map((id) => data.tree.nodes[id])
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
    const n = data.tree.nodes[nodeId];
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

  const viewGearEl = document.getElementById('view-gear')!;
  viewGearEl.addEventListener('mouseover', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-hover-item]');
    if (target) showItemTooltipFor(target);
  });
  viewGearEl.addEventListener('mouseout', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-hover-item]');
    if (!target) return;
    const related = e.relatedTarget as Node | null;
    if (!related || !target.contains(related)) gemTooltip.classList.add('hidden');
  });
  viewGearEl.addEventListener('focusin', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-hover-item]');
    if (target) showItemTooltipFor(target);
  });
  viewGearEl.addEventListener('focusout', () => {
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

  document.getElementById('league-seg')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    options.leagueMode = btn.dataset.mode as LeagueMode;
    document.querySelectorAll('#league-seg button').forEach((b) => b.classList.toggle('active', b === btn));
    void regenerate();
  });

  document.getElementById('eco-seg')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    options.economy = btn.dataset.eco as EconomyMode;
    document.querySelectorAll('#eco-seg button').forEach((b) => b.classList.toggle('active', b === btn));
    void regenerate();
  });

  classSel.addEventListener('change', () => {
    options.classId = classSel.value === 'random' ? 'random' : Number(classSel.value);
    options.ascendancyIndex = 'random';
    syncAscDropdown();
    void regenerate();
  });

  ascSel.addEventListener('change', () => {
    options.ascendancyIndex = ascSel.value === 'random' ? 'random' : Number(ascSel.value);
    void regenerate();
  });

  styleSel.addEventListener('change', () => {
    options.damageStyle = styleSel.value as DamageStyle | 'random';
    void regenerate();
  });

  defSel.addEventListener('change', () => {
    options.defenseStyle = defSel.value as DefenseStyle | 'random';
    void regenerate();
  });

  levelRange.addEventListener('input', () => {
    levelVal.textContent = levelRange.value;
    options.level = Number(levelRange.value);
  });
  levelRange.addEventListener('change', () => void regenerate());

  document.getElementById('apply-seed-btn')!.addEventListener('click', () => {
    options.seed = seedInput.value.trim() || randomSeed();
    void regenerate();
  });

  seedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      options.seed = seedInput.value.trim() || randomSeed();
      void regenerate();
    }
  });

  document.getElementById('reroll-btn')!.addEventListener('click', () => {
    options.seed = randomSeed();
    void regenerate();
  });

  await regenerate();
}

void main();
