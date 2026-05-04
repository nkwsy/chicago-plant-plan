import type { Species, Plant, LayerId } from './types';

/** Fake but plausible species set spanning the four Oudolf roles. Colors
 *  picked to read clearly when several show up next to each other on a
 *  light bed. */
export const SPECIES: Species[] = [
  // ── Matrix (groundcover): the green backdrop, planted dense
  { idx: 1, slug: 'sporobolus-heterolepis', commonName: 'Prairie Dropseed', scientificName: 'Sporobolus heterolepis', color: '#9bb168', layer: 'matrix' },
  { idx: 2, slug: 'carex-pennsylvanica', commonName: 'Penn Sedge', scientificName: 'Carex pensylvanica', color: '#74a35a', layer: 'matrix' },
  { idx: 3, slug: 'schizachyrium-scoparium', commonName: 'Little Bluestem', scientificName: 'Schizachyrium scoparium', color: '#bda878', layer: 'matrix' },
  // ── Structure: silhouette plants, sparse drifts
  { idx: 4, slug: 'eutrochium-purpureum', commonName: 'Joe Pye Weed', scientificName: 'Eutrochium purpureum', color: '#9b4a92', layer: 'structure' },
  { idx: 5, slug: 'asclepias-syriaca', commonName: 'Common Milkweed', scientificName: 'Asclepias syriaca', color: '#e7a2bd', layer: 'structure' },
  // ── Scatter: drift forbs in groups of 6–12
  { idx: 6, slug: 'echinacea-purpurea', commonName: 'Purple Coneflower', scientificName: 'Echinacea purpurea', color: '#c16a9a', layer: 'scatter' },
  { idx: 7, slug: 'liatris-spicata', commonName: 'Blazing Star', scientificName: 'Liatris spicata', color: '#7f6ba2', layer: 'scatter' },
  // ── Filler: low gap-fillers, scattered as accent
  { idx: 8, slug: 'monarda-fistulosa', commonName: 'Wild Bergamot', scientificName: 'Monarda fistulosa', color: '#ee7a70', layer: 'filler' },
  { idx: 9, slug: 'zizia-aurea', commonName: 'Golden Alexanders', scientificName: 'Zizia aurea', color: '#f6c845', layer: 'filler' },
];

/** Hand-laid plants to look like a real (small) planting plan. Coordinates
 *  are SVG px in a 800×500 viewbox; the bed is the inner ~760×460 rect. */
export const INITIAL_PLANTS: Plant[] = (() => {
  const out: Plant[] = [];
  let id = 0;
  const add = (speciesIdx: number, x: number, y: number) => {
    out.push({ id: `p${++id}`, speciesIdx, x, y });
  };

  // Matrix — dense scatter across the whole bed
  const matrixSp = [1, 2, 3];
  for (let i = 0; i < 28; i++) {
    const x = 60 + Math.random() * 680;
    const y = 60 + Math.random() * 380;
    add(matrixSp[Math.floor(Math.random() * 3)], x, y);
  }

  // Structure — 6 silhouette accents, well-spaced
  add(4, 180, 140); add(4, 540, 200); add(4, 360, 380);
  add(5, 240, 260); add(5, 600, 320); add(5, 460, 110);

  // Scatter — two drifts of coneflower + one drift of liatris
  for (let i = 0; i < 7; i++) add(6, 110 + (i % 3) * 35 + Math.random() * 18, 320 + Math.floor(i / 3) * 32 + Math.random() * 12);
  for (let i = 0; i < 6; i++) add(6, 470 + (i % 3) * 35 + Math.random() * 18, 360 + Math.floor(i / 3) * 32 + Math.random() * 12);
  for (let i = 0; i < 8; i++) add(7, 280 + (i % 4) * 32 + Math.random() * 16, 180 + Math.floor(i / 4) * 30 + Math.random() * 12);

  // Filler — scattered evenly
  for (let i = 0; i < 10; i++) add(8, 80 + Math.random() * 640, 80 + Math.random() * 360);
  for (let i = 0; i < 10; i++) add(9, 80 + Math.random() * 640, 80 + Math.random() * 360);

  return out;
})();

export const DEFAULT_LAYERS: Record<LayerId, { visible: boolean; locked: boolean }> = {
  matrix: { visible: true, locked: false },
  structure: { visible: true, locked: false },
  scatter: { visible: true, locked: false },
  filler: { visible: true, locked: false },
};

export const LAYER_LABELS: Record<LayerId, { label: string; description: string; tone: string }> = {
  matrix: { label: 'Matrix', description: 'Groundcover · the green backdrop', tone: 'bg-emerald-100 text-emerald-900 border-emerald-200' },
  structure: { label: 'Structure', description: 'Silhouette accents', tone: 'bg-violet-100 text-violet-900 border-violet-200' },
  scatter: { label: 'Scatter', description: 'Drift forbs', tone: 'bg-rose-100 text-rose-900 border-rose-200' },
  filler: { label: 'Filler', description: 'Seasonal gap-fillers', tone: 'bg-amber-100 text-amber-900 border-amber-200' },
};

/** Bed canvas dimensions — kept small so SVG stays sharp without scrolling. */
export const CANVAS = { w: 800, h: 500, padding: 40 };
