import type { TreeData, TreeNode } from '../lib/types.ts';
import type { GeneratedTree } from '../lib/tree.ts';

interface TreePalette {
  unallocEdge: string;
  allocEdge: string;
  allocAscEdge: string;
  nodeNormal: string;
  nodeNotable: string;
  nodeKeystone: string;
  nodeJewel: string;
  nodeMastery: string;
  allocNormal: string;
  allocNotable: string;
  allocKeystone: string;
  allocJewel: string;
  allocMastery: string;
  allocAsc: string;
  allocAscNotable: string;
  strokeDefault: string;
  strokeAlloc: string;
  strokeHover: string;
}

const DARK_PALETTE: TreePalette = {
  unallocEdge: 'rgba(110, 125, 150, 0.22)',
  allocEdge: '#a3e635',
  allocAscEdge: '#f59e0b',
  nodeNormal: '#1d2433',
  nodeNotable: '#2d3548',
  nodeKeystone: '#3f3622',
  nodeJewel: '#1e3a4c',
  nodeMastery: '#2e223d',
  allocNormal: '#84cc16',
  allocNotable: '#bef264',
  allocKeystone: '#fde047',
  allocJewel: '#38bdf8',
  allocMastery: '#c084fc',
  allocAsc: '#f59e0b',
  allocAscNotable: '#fb923c',
  strokeDefault: '#475569',
  strokeAlloc: '#ecfccb',
  strokeHover: '#ffffff',
};

const LIGHT_PALETTE: TreePalette = {
  unallocEdge: 'rgba(148, 163, 184, 0.42)',
  allocEdge: '#65a30d',
  allocAscEdge: '#ea580c',
  nodeNormal: '#e2e8f0',
  nodeNotable: '#cbd5e1',
  nodeKeystone: '#fef3c7',
  nodeJewel: '#e0f2fe',
  nodeMastery: '#f3e8ff',
  allocNormal: '#84cc16',
  allocNotable: '#4d7c0f',
  allocKeystone: '#d97706',
  allocJewel: '#0284c7',
  allocMastery: '#7c3aed',
  allocAsc: '#f97316',
  allocAscNotable: '#c2410c',
  strokeDefault: '#94a3b8',
  strokeAlloc: '#18181b',
  strokeHover: '#09090b',
};

export class TreeCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tooltip: HTMLDivElement;
  private treeData: TreeData;
  private buildTree: GeneratedTree | null = null;
  private allocSet = new Set<number>();
  private isDark = false;

  private scale = 0.045;
  private offsetX = 0;
  private offsetY = 0;
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private hoveredId: number | null = null;
  private focusedId: number | null = null;
  private nodeEntries: [number, TreeNode][];

  constructor(container: HTMLElement, treeData: TreeData, isDark = false) {
    this.treeData = treeData;
    this.isDark = isDark;
    this.nodeEntries = Object.entries(treeData.nodes).map(([k, v]) => [Number(k), v]);

    container.classList.add('tree-viewport');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tree-canvas';
    container.appendChild(this.canvas);

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'tree-tooltip hidden';
    container.appendChild(this.tooltip);

    const controls = document.createElement('div');
    controls.className = 'tree-controls';
    controls.innerHTML = `
      <button type="button" data-zoom="in" title="Zoom In">+</button>
      <button type="button" data-zoom="out" title="Zoom Out">-</button>
      <button type="button" data-zoom="fit" title="Center on Build">Fit</button>
    `;
    container.appendChild(controls);

    controls.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn) return;
      const action = btn.dataset.zoom;
      if (action === 'in') this.zoomBy(1.28);
      else if (action === 'out') this.zoomBy(1 / 1.28);
      else if (action === 'fit') {
        this.focusedId = null;
        this.tooltip.classList.add('hidden');
        this.fitToBuild();
      }
    });

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;

    this.attachEvents();
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.resize()).observe(container);
    } else {
      window.addEventListener('resize', () => this.resize());
    }
  }

  setTheme(isDark: boolean): void {
    if (this.isDark === isDark) return;
    this.isDark = isDark;
    this.draw();
  }

  setBuildTree(buildTree: GeneratedTree): void {
    this.buildTree = buildTree;
    this.focusedId = null;
    this.tooltip.classList.add('hidden');
    const cls = this.treeData.classes.find((c) => c.id === buildTree.classId);
    const asc = cls?.ascendancies[buildTree.ascendClassId - 1];
    this.allocSet = new Set(buildTree.nodes);
    if (cls) this.allocSet.add(cls.start);
    if (asc?.start) this.allocSet.add(asc.start);
    this.fitToBuild();
  }

  focusNode(nodeId: number): void {
    const n = this.treeData.nodes[nodeId];
    if (!n) return;
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || 800;
    const h = rect.height || 500;
    this.focusedId = nodeId;
    this.scale = Math.max(this.scale, 0.14);
    this.offsetX = w / 2 - n.x * this.scale;
    this.offsetY = h / 2 - n.y * this.scale;
    this.draw();
    this.showTooltip(nodeId, w / 2, h / 2, rect);
  }

  resize(): void {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  fitToBuild(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || 800;
    const h = rect.height || 500;
    if (!this.buildTree || this.allocSet.size === 0) {
      this.scale = Math.min(w / 24000, h / 20000);
      this.offsetX = w / 2;
      this.offsetY = h / 2;
      this.draw();
      return;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const id of this.allocSet) {
      const n = this.treeData.nodes[id];
      if (!n || n.a) continue;
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }
    if (!Number.isFinite(minX)) {
      minX = -8000; maxX = 8000; minY = -8000; maxY = 8000;
    }
    const pad = 1200;
    const spanX = Math.max(3000, maxX - minX + pad * 2);
    const spanY = Math.max(3000, maxY - minY + pad * 2);
    this.scale = Math.min(w / spanX, h / spanY, 0.12);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this.offsetX = w / 2 - cx * this.scale;
    this.offsetY = h / 2 - cy * this.scale;
    this.draw();
  }

  private zoomBy(factor: number, clientX?: number, clientY?: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const cx = clientX !== undefined ? clientX - rect.left : rect.width / 2;
    const cy = clientY !== undefined ? clientY - rect.top : rect.height / 2;
    const nextScale = Math.min(0.35, Math.max(0.02, this.scale * factor));
    const ratio = nextScale / this.scale;
    this.offsetX = cx - (cx - this.offsetX) * ratio;
    this.offsetY = cy - (cy - this.offsetY) * ratio;
    this.scale = nextScale;
    this.draw();
  }

  private attachEvents(): void {
    this.canvas.addEventListener('mousedown', (e) => {
      this.dragging = true;
      this.dragStartX = e.clientX - this.offsetX;
      this.dragStartY = e.clientY - this.offsetY;
      this.canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mouseup', () => {
      this.dragging = false;
      this.canvas.style.cursor = 'grab';
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.dragging) {
        this.offsetX = e.clientX - this.dragStartX;
        this.offsetY = e.clientY - this.dragStartY;
        this.tooltip.classList.add('hidden');
        this.draw();
        return;
      }
      this.handleHover(e);
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoveredId = null;
      this.tooltip.classList.add('hidden');
      this.draw();
    });

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        this.zoomBy(factor, e.clientX, e.clientY);
      },
      { passive: false },
    );
  }

  private handleHover(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = (mx - this.offsetX) / this.scale;
    const wy = (my - this.offsetY) / this.scale;
    const hitDist = 180 / Math.max(0.03, Math.sqrt(this.scale * 20));

    let bestId: number | null = null;
    let bestD2 = hitDist * hitDist;
    for (const [id, n] of this.nodeEntries) {
      const dx = n.x - wx;
      const dy = n.y - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestId = id;
      }
    }

    if (bestId !== this.hoveredId) {
      this.hoveredId = bestId;
      this.draw();
    }

    if (bestId === null) {
      this.tooltip.classList.add('hidden');
      return;
    }

    this.showTooltip(bestId, mx, my, rect);
  }

  private showTooltip(nodeId: number, mx: number, my: number, rect: DOMRect): void {
    const n = this.treeData.nodes[nodeId];
    if (!n) return;
    const isAlloc = this.allocSet.has(nodeId);
    let statsHtml = '';
    if (n.t === 'mastery' && this.buildTree?.masteryEffects[nodeId]) {
      const effId = this.buildTree.masteryEffects[nodeId];
      const eff = n.me?.find((m) => m.e === effId);
      if (eff) {
        statsHtml = `<div class="tt-mastery">${eff.s.map(escapeHtml).join('<br>')}</div>`;
      }
    } else if (n.s?.length) {
      statsHtml = `<div class="tt-stats">${n.s.map(escapeHtml).join('<br>')}</div>`;
    } else if (n.t === 'mastery' && n.me?.length) {
      statsHtml = `<div class="tt-muted">${n.me.length} Mastery options</div>`;
    }

    const badge = isAlloc ? '<span class="tt-alloc">Allocated</span>' : '';
    const ascTag = n.a ? `<span class="tt-asc">${escapeHtml(n.a)}</span>` : '';
    this.tooltip.innerHTML = `
      <div class="tt-head">${escapeHtml(n.n)} ${badge} ${ascTag}</div>
      ${statsHtml}
    `;
    this.tooltip.classList.remove('hidden');
    const left = Math.min(rect.width - 280, Math.max(10, mx + 14));
    const top = Math.min(rect.height - 140, Math.max(10, my + 14));
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  draw(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (!w || !h) return;

    const pal = this.isDark ? DARK_PALETTE : LIGHT_PALETTE;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    // 1. Unallocated edges (keep ascendancy clusters visually separate from main tree)
    ctx.lineWidth = Math.max(18, 1.1 / this.scale);
    ctx.strokeStyle = pal.unallocEdge;
    ctx.beginPath();
    for (const [id, n] of this.nodeEntries) {
      for (const adj of n.adj) {
        if (adj <= id) continue;
        const other = this.treeData.nodes[adj];
        if (!other) continue;
        if ((n.a ?? '') !== (other.a ?? '')) continue;
        if (this.allocSet.has(id) && this.allocSet.has(adj)) continue;
        ctx.moveTo(n.x, n.y);
        ctx.lineTo(other.x, other.y);
      }
    }
    ctx.stroke();

    // 2. Allocated main edges
    ctx.lineWidth = Math.max(38, 2.4 / this.scale);
    ctx.strokeStyle = pal.allocEdge;
    ctx.beginPath();
    for (const id of this.allocSet) {
      const n = this.treeData.nodes[id];
      if (!n || n.a) continue;
      for (const adj of n.adj) {
        if (adj <= id || !this.allocSet.has(adj)) continue;
        const other = this.treeData.nodes[adj];
        if (!other || other.a) continue;
        ctx.moveTo(n.x, n.y);
        ctx.lineTo(other.x, other.y);
      }
    }
    ctx.stroke();

    // 3. Allocated ascendancy edges
    ctx.lineWidth = Math.max(38, 2.4 / this.scale);
    ctx.strokeStyle = pal.allocAscEdge;
    ctx.beginPath();
    for (const id of this.allocSet) {
      const n = this.treeData.nodes[id];
      if (!n || !n.a) continue;
      for (const adj of n.adj) {
        if (adj <= id || !this.allocSet.has(adj)) continue;
        const other = this.treeData.nodes[adj];
        if (!other || other.a !== n.a) continue;
        ctx.moveTo(n.x, n.y);
        ctx.lineTo(other.x, other.y);
      }
    }
    ctx.stroke();

    // 4. Nodes
    for (const [id, n] of this.nodeEntries) {
      const alloc = this.allocSet.has(id);
      const hovered = id === this.hoveredId;
      const focused = id === this.focusedId;
      let r = 42;
      if (n.t === 'keystone' || n.t === 'start' || n.t === 'ascStart') r = 95;
      else if (n.t === 'notable' || n.t === 'jewel') r = 68;
      else if (n.t === 'mastery') r = 60;

      if (hovered || focused) r *= 1.35;

      if (focused) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 2.1, 0, Math.PI * 2);
        ctx.fillStyle = this.isDark ? 'rgba(163, 230, 53, 0.22)' : 'rgba(132, 204, 22, 0.25)';
        ctx.fill();
        ctx.lineWidth = Math.max(24, 2.2 / this.scale);
        ctx.strokeStyle = this.isDark ? '#bef264' : '#4d7c0f';
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);

      if (alloc) {
        if (n.a) ctx.fillStyle = n.t === 'notable' ? pal.allocAscNotable : pal.allocAsc;
        else if (n.t === 'keystone') ctx.fillStyle = pal.allocKeystone;
        else if (n.t === 'jewel') ctx.fillStyle = pal.allocJewel;
        else if (n.t === 'mastery') ctx.fillStyle = pal.allocMastery;
        else if (n.t === 'notable') ctx.fillStyle = pal.allocNotable;
        else ctx.fillStyle = pal.allocNormal;
      } else {
        if (n.t === 'keystone') ctx.fillStyle = pal.nodeKeystone;
        else if (n.t === 'notable') ctx.fillStyle = pal.nodeNotable;
        else if (n.t === 'jewel') ctx.fillStyle = pal.nodeJewel;
        else if (n.t === 'mastery') ctx.fillStyle = pal.nodeMastery;
        else ctx.fillStyle = pal.nodeNormal;
      }
      ctx.fill();

      if (alloc || hovered || focused || n.t === 'keystone' || n.t === 'jewel') {
        ctx.lineWidth = (hovered || focused) ? Math.max(30, 2.5 / this.scale) : Math.max(16, 1.1 / this.scale);
        ctx.strokeStyle = (hovered || focused) ? pal.strokeHover : alloc ? pal.strokeAlloc : pal.strokeDefault;
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
