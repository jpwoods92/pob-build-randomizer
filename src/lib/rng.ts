// Small seeded PRNG so every build is reproducible from its seed string.

function hashString(str: string): number {
  // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private state: number;

  constructor(seed: string | number) {
    this.state = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  /** mulberry32 – returns a float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (!arr.length) throw new Error('pick from empty array');
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Picks an element with probability proportional to weight(el). Returns undefined if all weights are <= 0. */
  weighted<T>(arr: readonly T[], weight: (el: T) => number): T | undefined {
    let total = 0;
    const ws = arr.map((el) => {
      const w = Math.max(0, weight(el));
      total += w;
      return w;
    });
    if (total <= 0) return undefined;
    let r = this.next() * total;
    for (let i = 0; i < arr.length; i++) {
      r -= ws[i];
      if (r <= 0 && ws[i] > 0) return arr[i];
    }
    for (let i = arr.length - 1; i >= 0; i--) if (ws[i] > 0) return arr[i];
    return undefined;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Fork a child generator so sub-systems don't perturb each other's sequences. */
  fork(label: string): Rng {
    return new Rng((hashString(label) ^ Math.floor(this.next() * 4294967296)) >>> 0);
  }
}

export function randomSeed(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
