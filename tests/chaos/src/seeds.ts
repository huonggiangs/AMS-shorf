/** Hat giong: CHAOS_SEEDS=so luong (mac dinh 6), CHAOS_SEED_BASE=so dau (mac dinh 1000). CHAOS_SEED=n chay dung mot seed de tai hien. */
export function seeds(): number[] {
  const one = process.env['CHAOS_SEED'];
  if (one) return [Number(one)];
  const n = Number(process.env['CHAOS_SEEDS'] ?? 6);
  const base = Number(process.env['CHAOS_SEED_BASE'] ?? 1000);
  return Array.from({ length: n }, (_, i) => base + i);
}
