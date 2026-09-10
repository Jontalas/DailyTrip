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

function haversineKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* Colapsa opciones repetidas dentro de un pool. Dos entradas son la misma si su
   nombre normalizado coincide (o una contiene a la otra, o comparten la mayoría
   de palabras) Y están cerca (< 1 km; < 150 m para el solape parcial). Dos
   lugares con el mismo nombre en municipios distintos NO se fusionan.
   Conserva la primera (más interés) y le rellena los datos que le falten. */
export function dedupePool(list) {
  const out = [];
  for (const item of list) {
    if (!item || !item.name) { if (item) out.push(item); continue; }
    const k = normName(item.name);
    const dup = out.find((x) => {
      const xk = normName(x.name);
      if (!k || !xk) return false;
      const coordsClose =
        !Number.isFinite(item.lat) || !Number.isFinite(x.lat) || haversineKm(item, x) < 1;
      if (k === xk) return coordsClose;
      if (k.length > 4 && xk.length > 4 && (k.includes(xk) || xk.includes(k))) return coordsClose;
      const wa = k.split(" ").filter((w) => w.length > 2);
      const wb = new Set(xk.split(" ").filter((w) => w.length > 2));
      if (wa.length && wb.size) {
        const inter = wa.filter((w) => wb.has(w)).length;
        if (
          inter / Math.min(wa.length, wb.size) >= 0.75 &&
          Number.isFinite(item.lat) && Number.isFinite(x.lat) && haversineKm(item, x) < 0.15
        )
          return true;
      }
      return false;
    });
    if (!dup) { out.push(item); continue; }
    if (dup.aiInterest == null && item.aiInterest != null) dup.aiInterest = item.aiInterest;
    if (!dup.aiReason && item.aiReason) dup.aiReason = item.aiReason;
    if ((item.interestScore || 0) > (dup.interestScore || 0)) dup.interestScore = item.interestScore;
    for (const f of ["description", "imageUrl", "wikipediaUrl", "website", "openingHours", "rating", "userRatingCount", "shortDesc"])
      if (dup[f] == null || dup[f] === "") dup[f] = item[f];
    if (item.categories) dup.categories = [...new Set([...(dup.categories || []), ...item.categories])];
  }
  return out;
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
    // Copias frescas -> `dedupePool` puede rellenar campos sin tocar el store.
    out[k] = dedupePool((pools[k] || []).map((x) => ({ ...x })))
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
