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

/* Coincidencia por familias de categoría. Las paradas EN RUTA usan categorías
   como "natural", "natural.cave", "historic.castle", "heritage", "leisure.park"…
   El matching con `includes("nature")` fallaba justo para "natural" (y para
   "heritage"), así que las preferencias apenas movían la lista de ruta. Regex
   por familia para que "qué te apetece hoy" valga igual en ruta y en destino. */
const PREF_MATCH = {
  history: /historic|heritage|sights|cultural|castle|church|monument|archaeolog|palac|monaster|conven|ruin|fort|muralla|alcaz/,
  nature: /natur|park|garden|forest|beach|cala|cave|cueva|gruta|mountain|sierra|cliff|acantilad|waterfall|cascad|reserve|volcano|lago|laguna|dune/,
  walk: /park|garden|sights|walk|paseo|promenade|viewpoint|mirador|beach|cala|natur|trail|sender|casco/,
  gastronomy: /restaurant|cafe|\bfood\b|catering|winery|bodega|market|mercado/,
  museums: /museum|museo|gallery|galer|pinacote/,
  views: /viewpoint|mirador|panoram|overlook/
};
const PREF_WEIGHT = { history: 10, nature: 10, walk: 7, gastronomy: 10, museums: 12, views: 12 };

export function preferenceBonus(item, prefs) {
  const has = (k) => (prefs instanceof Set ? prefs.has(k) : prefs.includes(k));
  const c = String(item.category || "").toLowerCase();
  let bonus = 0;
  for (const k of Object.keys(PREF_MATCH)) if (has(k) && PREF_MATCH[k].test(c)) bonus += PREF_WEIGHT[k];
  return bonus;
}

/* Nota base para ordenar una opción: si la IA la puntuó (`aiInterest`, 0–100),
   esa es la base; si no, el `interestScore` calculado. Así la lista queda
   ordenada "por lo que recomienda la IA" y las preferencias sólo la matizan.
   Lo que la IA no menciona conserva su sitio por interés (no se oculta). */
export function baseInterest(item) {
  return item.aiInterest != null && Number.isFinite(Number(item.aiInterest))
    ? Number(item.aiInterest)
    : (item.interestScore || 50);
}

export function adjustedInterest(item, prefs) {
  return Math.max(1, Math.min(100, baseInterest(item) + preferenceBonus(item, prefs)));
}

/* Normalización de nombre — igual que la del servidor (lib/ai-curator.js) — para
   casar la nota de la IA con una opción ya presente en el pool. */
export function normName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* Fusiona en un pool el resultado de `/api/ai/curate` (segundo plano):
   1) anota `aiInterest`/`aiReason` en las opciones ya presentes cuyo nombre
      casa con el ranking de la IA;
   2) añade las candidatas nuevas de la IA que no estuvieran ya (por id o nombre).
   NO ordena: de eso se encarga `applyPreferences` sobre el pool resultante.
   Devuelve el nuevo array (o el mismo si no hay nada que aplicar). */
export function applyAiToPool(pool, result) {
  const list = Array.isArray(pool) ? pool : [];
  if (!result || (result.status && result.status !== "ready")) return list;
  const ranking = result.ranking || {};
  const reasons = result.reasons || {};
  const byId = new Set(list.map((x) => x.id));
  const byName = new Set(list.map((x) => normName(x.name)));
  const annotated = list.map((x) => {
    if (x.aiInterest != null) return x;
    const k = normName(x.name);
    return ranking[k] != null
      ? { ...x, aiInterest: ranking[k], aiReason: x.aiReason || reasons[k] || "" }
      : x;
  });
  const additions = (result.items || []).filter(
    (it) => it && !byId.has(it.id) && !byName.has(normName(it.name))
  );
  return additions.length ? [...annotated, ...additions] : annotated;
}

export function adjustedStageValue(item, prefs) {
  const base = item.aiInterest != null && Number.isFinite(Number(item.aiInterest))
    ? Number(item.aiInterest)
    : (item.stageValue ?? item.interestScore ?? 50);
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
