import './styles.css';
import { loadGameData } from './lib/data.ts';
import { randomSeed } from './lib/rng.ts';
import { generateBuild, type GeneratedBuild } from './lib/generator.ts';
import type { BuildOptions, DamageStyle, DefenseStyle, EconomyMode, LeagueMode } from './lib/archetype.ts';
import type { GameData } from './lib/types.ts';
import { TreeCanvas } from './components/TreeCanvas.ts';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function main() {
  const root = document.getElementById('app')!;
  root.innerHTML = `<div class="loading">Loading Path of Exile 3.30 tree, gems, bases, mods & uniques...</div>`;

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

  let activeTab: 'tree' | 'skills' | 'gear' | 'export' = 'tree';
  let currentBuild: GeneratedBuild | null = null;
  let treeCanvas: TreeCanvas | null = null;

  root.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand">
          <h1>PoB Build Randomizer</h1>
          <p>Path of Exile 1 (3.30) · Full Tree, Gems &amp; Gear</p>
        </div>

        <div class="knob">
          <div class="knob-label">League Mode</div>
          <div class="segmented" id="league-seg">
            <button type="button" data-mode="softcore" class="active">Softcore</button>
            <button type="button" data-mode="hardcore">Hardcore</button>
          </div>
          <div class="knob-hint" id="league-hint">Balanced offense &amp; crit scaling, full unique pool.</div>
        </div>

        <div class="knob">
          <div class="knob-label">Economy</div>
          <div class="segmented" id="eco-seg">
            <button type="button" data-eco="ssf">SSF</button>
            <button type="button" data-eco="trade" class="active">Trade</button>
          </div>
          <div class="knob-hint" id="eco-hint">Endgame rares, chase uniques &amp; Awakened supports enabled.</div>
        </div>

        <div class="knob">
          <label for="class-select">Class</label>
          <select id="class-select">
            <option value="random">Random Class</option>
            ${data.tree.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
          </select>
        </div>

        <div class="knob">
          <label for="asc-select">Ascendancy</label>
          <select id="asc-select" disabled>
            <option value="random">Random Ascendancy</option>
          </select>
        </div>

        <div class="knob">
          <label for="style-select">Damage Archetype</label>
          <select id="style-select">
            <option value="random">Random Style</option>
            <option value="attack">Attack</option>
            <option value="spell">Spell</option>
            <option value="minion">Minion</option>
            <option value="totem">Totem</option>
            <option value="trap_mine">Trap / Mine</option>
            <option value="dot">Damage Over Time</option>
          </select>
        </div>

        <div class="knob">
          <label for="def-select">Defense Layer</label>
          <select id="def-select">
            <option value="random">Random Defense</option>
            <option value="life">Life</option>
            <option value="es">Energy Shield (CI)</option>
            <option value="hybrid">Hybrid Life + ES</option>
          </select>
        </div>

        <div class="knob">
          <label for="level-range">Target Level: <span id="level-val">92</span></label>
          <input type="range" id="level-range" min="80" max="100" value="92" />
        </div>

        <div class="knob">
          <label for="seed-input">Build Seed</label>
          <div class="seed-row">
            <input type="text" id="seed-input" value="${esc(options.seed)}" />
            <button type="button" class="btn" id="apply-seed-btn">Apply</button>
          </div>
        </div>

        <button type="button" class="btn btn-primary btn-full" id="reroll-btn">Randomize New Build</button>
      </aside>

      <main class="workspace">
        <section class="build-header" id="build-header"></section>

        <nav class="tabs" id="tabs-nav">
          <button type="button" class="tab-btn active" data-tab="tree">Passive Tree</button>
          <button type="button" class="tab-btn" data-tab="skills">Skills &amp; Gems</button>
          <button type="button" class="tab-btn" data-tab="gear">Gear, Flasks &amp; Jewels</button>
          <button type="button" class="tab-btn" data-tab="export">PoB Code &amp; XML</button>
        </nav>

        <section class="tab-panel active" id="panel-tree">
          <div class="tree-grid">
            <div id="tree-canvas-host"></div>
            <div class="tree-side" id="tree-side"></div>
          </div>
        </section>
        <section class="tab-panel" id="panel-skills"></section>
        <section class="tab-panel" id="panel-gear"></section>
        <section class="tab-panel" id="panel-export"></section>
      </main>
    </div>
  `;

  treeCanvas = new TreeCanvas(document.getElementById('tree-canvas-host')!, data.tree);

  const leagueHint = document.getElementById('league-hint')!;
  const ecoHint = document.getElementById('eco-hint')!;
  const classSel = document.getElementById('class-select') as HTMLSelectElement;
  const ascSel = document.getElementById('asc-select') as HTMLSelectElement;
  const styleSel = document.getElementById('style-select') as HTMLSelectElement;
  const defSel = document.getElementById('def-select') as HTMLSelectElement;
  const levelRange = document.getElementById('level-range') as HTMLInputElement;
  const levelVal = document.getElementById('level-val')!;
  const seedInput = document.getElementById('seed-input') as HTMLInputElement;

  function syncAscDropdown() {
    if (options.classId === 'random') {
      ascSel.innerHTML = `<option value="random">Random Ascendancy</option>`;
      ascSel.disabled = true;
      options.ascendancyIndex = 'random';
      return;
    }
    const cls = data.tree.classes.find((c) => c.id === options.classId);
    ascSel.disabled = false;
    ascSel.innerHTML = `<option value="random">Random Ascendancy</option>` +
      (cls?.ascendancies.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('') ?? '');
    if (options.ascendancyIndex !== 'random') ascSel.value = String(options.ascendancyIndex);
  }

  async function regenerate() {
    seedInput.value = options.seed;
    const build = await generateBuild(data, options);
    currentBuild = build;
    renderHeader(build);
    renderTreeSide(build);
    renderSkills(build);
    renderGear(build);
    renderExport(build);
    treeCanvas?.setBuildTree(build.tree);
  }

  function renderHeader(b: GeneratedBuild) {
    const a = b.archetype;
    const mainLinks = b.skills.groups[0]?.gems.map((g) => g.gem.name).join(' · ') ?? a.mainSkill.name;
    const r = b.gear.resists;
    const at = b.gear.attributes;
    const req = b.skills.maxReq;
    const pantheonMaj = data.pantheons.major.find((p) => p.id === a.pantheonMajor)?.name ?? a.pantheonMajor;
    const pantheonMin = data.pantheons.minor.find((p) => p.id === a.pantheonMinor)?.name ?? a.pantheonMinor;

    document.getElementById('build-header')!.innerHTML = `
      <div class="header-top">
        <div>
          <h2 class="build-title">${esc(a.title)}</h2>
          <p class="build-subtitle">Level ${a.options.level} ${esc(a.classData.name)} (${esc(a.ascendancy.name)}) · ${esc(mainLinks)}</p>
          <div class="badges">
            <span class="badge ${a.options.leagueMode === 'hardcore' ? 'badge-hc' : 'badge-sc'}">${esc(a.options.leagueMode)}</span>
            <span class="badge ${a.options.economy === 'ssf' ? 'badge-ssf' : 'badge-trade'}">${esc(a.options.economy)}</span>
            <span class="badge">${esc(a.damageStyle)}</span>
            <span class="badge">${esc(a.defenseStyle)}</span>
            <span class="badge">${esc(a.critMode === 'crit' ? 'Crit' : a.critMode === 'dot' ? 'DoT' : 'Non-Crit')}</span>
            <span class="badge">Seed: ${esc(a.options.seed)}</span>
          </div>
        </div>
        <div class="actions">
          <button type="button" class="btn btn-primary" id="copy-pob-btn">Copy PoB Import Code</button>
          <button type="button" class="btn" id="download-xml-btn">Download .xml</button>
          <a class="btn" href="${esc(b.tree.url)}" target="_blank" rel="noreferrer">Official Tree</a>
        </div>
      </div>

      <div class="stats-strip">
        <div class="stat-box">
          <div class="k">Passive / Ascendancy</div>
          <div class="v">${b.tree.pointsUsed}/${b.tree.pointsBudget} · ${b.tree.ascPointsUsed}/8</div>
        </div>
        <div class="stat-box">
          <div class="k">Tree Life / ES</div>
          <div class="v">${b.tree.summary.lifePct}% Life · ${b.tree.summary.esPct}% ES</div>
        </div>
        <div class="stat-box">
          <div class="k">Resists (after -60%)</div>
          <div class="v">
            <span class="res-fire">${r.fire}%</span> /
            <span class="res-cold">${r.cold}%</span> /
            <span class="res-light">${r.lightning}%</span> /
            <span class="res-chaos">${r.chaos}%</span>
          </div>
        </div>
        <div class="stat-box">
          <div class="k">Attributes (Req)</div>
          <div class="v">${at.str}(${req.str}) / ${at.dex}(${req.dex}) / ${at.int}(${req.int})</div>
        </div>
        <div class="stat-box">
          <div class="k">Mana Reserved</div>
          <div class="v">${b.skills.manaReservedPct}%</div>
        </div>
        <div class="stat-box">
          <div class="k">Bandit · Pantheon</div>
          <div class="v">${a.bandit === 'None' ? 'Kill All' : a.bandit} · ${esc(pantheonMaj)} / ${esc(pantheonMin)}</div>
        </div>
      </div>
    `;

    document.getElementById('copy-pob-btn')!.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      await navigator.clipboard.writeText(b.pobCode);
      const orig = btn.textContent;
      btn.textContent = 'Copied PoB Code!';
      setTimeout(() => { btn.textContent = orig; }, 1600);
    });

    document.getElementById('download-xml-btn')!.addEventListener('click', () => {
      const blob = new Blob([b.xml], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${a.ascendancy.name.toLowerCase()}-${a.options.seed}.xml`;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  function renderTreeSide(b: GeneratedBuild) {
    const s = b.tree.summary;
    const ascNodes = b.tree.ascendancyNodes
      .map((id) => data.tree.nodes[id])
      .filter((n) => n && (n.t === 'notable' || n.mco));
    document.getElementById('tree-side')!.innerHTML = `
      <div>
        <h3>Ascendancy (${esc(b.archetype.ascendancy.name)})</h3>
        <div class="pill-list">
          ${ascNodes.map((n) => `<span class="pill pill-keystone">${esc(n.n)}</span>`).join('')}
        </div>
      </div>
      <div>
        <h3>Keystones (${s.keystones.length})</h3>
        <div class="pill-list">
          ${s.keystones.length ? s.keystones.map((k) => `<span class="pill pill-keystone">${esc(k)}</span>`).join('') : '<span class="tt-muted">None</span>'}
        </div>
      </div>
      <div>
        <h3>Masteries (${s.masteries.length})</h3>
        <div class="gem-list">
          ${s.masteries.map((m) => `<div class="gem-row"><span><strong>${esc(m.name)}:</strong> ${esc(m.text)}</span></div>`).join('') || '<span class="tt-muted">None</span>'}
        </div>
      </div>
      <div>
        <h3>Notable Passives (${s.notables.length})</h3>
        <div class="pill-list">
          ${s.notables.map((n) => `<span class="pill">${esc(n)}</span>`).join('')}
        </div>
      </div>
    `;
  }

  function renderSkills(b: GeneratedBuild) {
    document.getElementById('panel-skills')!.innerHTML = `
      <div class="skills-grid">
        ${b.skills.groups.map((grp) => `
          <div class="card">
            <div class="card-title">
              <span>${esc(grp.label)}</span>
              <span class="card-slot">${esc(grp.slot)} (${grp.gems.length}L)</span>
            </div>
            <div class="gem-list">
              ${grp.gems.map((gi) => `
                <div class="gem-row">
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
    document.getElementById('panel-gear')!.innerHTML = `
      <div class="items-grid">
        ${b.gear.items.map((item) => `
          <div class="item-card rarity-${item.rarity}">
            <div>
              <div class="item-name-${item.rarity}">${esc(item.name)}</div>
              <div class="item-base">${esc(item.baseName)} · <span class="card-slot">${esc(item.slot)}</span></div>
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
    document.getElementById('panel-export')!.innerHTML = `
      <div class="card" style="display:flex;flex-direction:column;gap:12px;">
        <div class="card-title">
          <span>Path of Building Import Code</span>
          <button type="button" class="btn btn-primary" id="copy-code-tab-btn">Copy Code</button>
        </div>
        <p class="knob-hint" style="margin:0;">
          In Path of Building Community: <strong>Import/Export Build → Import from Pastebin / Code</strong> and paste this string.
        </p>
        <textarea class="code-box" readonly id="pob-code-area">${esc(b.pobCode)}</textarea>
        <div class="card-title" style="margin-top:8px;">
          <span>Raw PoB XML Preview</span>
        </div>
        <textarea class="code-box" style="min-height:260px;" readonly>${esc(b.xml)}</textarea>
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
  document.getElementById('league-seg')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    const mode = btn.dataset.mode as LeagueMode;
    options.leagueMode = mode;
    document.querySelectorAll('#league-seg button').forEach((b) => b.classList.toggle('active', b === btn));
    leagueHint.textContent = mode === 'hardcore'
      ? 'Prioritizes Life/ES, overcapped Ele + Chaos res, Spell Suppression, Guard skills & safe uniques.'
      : 'Balanced offense & crit scaling, full unique pool.';
    void regenerate();
  });

  document.getElementById('eco-seg')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    const eco = btn.dataset.eco as EconomyMode;
    options.economy = eco;
    document.querySelectorAll('#eco-seg button').forEach((b) => b.classList.toggle('active', b === btn));
    ecoHint.textContent = eco === 'ssf'
      ? 'Filters out Awakened gems & boss/chase uniques; realistic 5–6L and accessible rares.'
      : 'Endgame rares, chase uniques & Awakened supports enabled.';
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

  document.getElementById('tabs-nav')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    activeTab = btn.dataset.tab as typeof activeTab;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${activeTab}`));
    if (activeTab === 'tree') {
      treeCanvas?.resize();
      if (currentBuild) treeCanvas?.fitToBuild();
    }
  });

  await regenerate();
}

void main();
