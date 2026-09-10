/* Preferencias del día e interés ajustado.
   Portado VERBATIM desde public/app.js (v1.1.5): mismos bonus y mismo criterio
   de ordenación de los pools. */

export const PREFERENCE_DEFS = [
  { value: "history", label: "Historia" },
  { value: "nature", label: "Naturaleza" },
  { value: "walk", label: "Pasear" },
  { value: "gastronomy", label: "Gastronomía" },
  { value: "museums", label: "Museos" },
  { value: "views", label: "Miradores" }
];

export function preferenceBonus(item, prefs) {
  const has = (k) => (prefs instanceof Set ? prefs.has(k) : prefs.includes(k));
  const c = String(item.category || "").toLowerCase();
  let bonus = 0;

  if (has("history") && (c.includes("historic") || c.includes("sights") || c.includes("cultural"))) bonus += 10;
  if (has("nature") && (c.includes("nature") || c.includes("park") || c.includes("garden"))) bonus += 10;
  if (has("walk") && (c.includes("park") || c.includes("sights") || c.includes("walk") || c.includes("viewpoint"))) bonus += 7;
  if (has("gastronomy") && (c.includes("restaurant") || c.includes("cafe") || c.includes("food"))) bonus += 10;
  if (has("museums") && c.includes("museum")) bonus += 12;
  if (has("views") && c.includes("viewpoint")) bonus += 12;

  return bonus;
}

export function adjustedInterest(item, prefs) {
  return Math.max(1, Math.min(100, (item.interestScore || 50) + preferenceBonus(item, prefs)));
}

export function adjustedStageValue(item, prefs) {
  const base = item.stageValue ?? item.interestScore ?? 50;
  return Math.max(1, Math.min(100, base + preferenceBonus(item, prefs)));
}

/** Devuelve una COPIA de pools con adjustedInterest/adjustedStageValue calculados
    y cada pool reordenado (equivale a sortPools() de app.js). */
export function applyPreferences(pools, prefs) {
  const out = {};
  for (const k of Object.keys(pools)) {
    out[k] = [...(pools[k] || [])]
      .map((x) => ({
        ...x,
        adjustedInterest: adjustedInterest(x, prefs),
        adjustedStageValue: adjustedStageValue(x, prefs)
      }))
      .sort((a, b) => {
        const av = a.adjustedInterest ?? a.interestScore ?? 0;
        const bv = b.adjustedInterest ?? b.interestScore ?? 0;
        return bv - av;
      });
  }
  return out;
}
