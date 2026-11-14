// Biome registry. A biome is a module with:
//   id, label, heading (compass azimuth of local -Z), moon {az, alt},
//   sky (optional) { coverMul, fogMul } for the local climate,
//   create(ctx) -> { group, anchor (Vector3, ground under the platform), titlePath, titlePathTall (optional, portrait), heightAt,
//                    update(dt, time, camera, atmosphere), setQuality(tier), dispose() }
// To add one: write ./<name>.js with the same shape and list it here.
import tropicalCoast from "./tropical-coast.js";
import dryCoast from "./dry-coast.js";

export const BIOMES = [tropicalCoast, dryCoast];
export const DEFAULT_BIOME = "tropical-coast";
// The id of the biome a realm is drawn in. It is an explicit setting, never guessed from a place name:
// realm.biome when the realm carries one, else the world's default (<meta name="wog-biome">, the DEFAULT_BIOME
// variable in wrangler.toml, docs/SETUP.md), else tropical-coast.
export function biomeId(realm) {
  const known = (id) => (typeof id === "string" && BIOMES.some((b) => b.id === id) ? id : null);
  const meta = typeof document !== "undefined" ? document.querySelector('meta[name="wog-biome"]')?.getAttribute("content") : null;
  return known(realm?.biome) || known(meta) || DEFAULT_BIOME;
}
export function pickBiome(realm) {
  const id = biomeId(realm);
  return BIOMES.find((b) => b.id === id);
}
