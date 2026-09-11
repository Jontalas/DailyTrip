/* Cliente HTTP de la API. Un método por endpoint, con los MISMOS payloads que
   usaba public/app.js (v1.1.5). El backend no cambia. */

async function post(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || `Error ${r.status} en ${url}`);
    err.status = r.status;
    err.payload = data;
    throw err;
  }
  return data;
}

const contentQueue=[];
let contentActive=0;
function pumpContent() {
  while(contentActive<2 && contentQueue.length) {
    const job=contentQueue.shift();contentActive++;
    post('/api/place/content',{item:job.item}).then(job.resolve,job.reject).finally(()=>{contentActive--;pumpContent();});
  }
}
export const api = {
  placeContent(item) { return new Promise((resolve,reject)=>{contentQueue.push({item,resolve,reject});pumpContent();}); },
  planDay(body) { return post('/api/plan/day',body); },
  async providers() {
    const r = await fetch("/api/providers");
    if (!r.ok) throw new Error("No se pudo leer el estado de proveedores");
    return r.json();
  },

  searchContext({ origin, target, toleranceKm }) {
    return post("/api/search/context", { origin, target, toleranceKm });
  },

  searchCandidates({ origin, target, toleranceKm }) {
    return post("/api/search/candidates", { origin, target, toleranceKm });
  },

  planRoute({ origin, destination }) {
    return post("/api/plan/route", { origin, destination });
  },

  geocode({ q, lat, lon, place=false, near=null }) {
    return post("/api/geocode", { q, lat, lon, place, near });
  },

  optionsRoute({ route, destination }) {
    return post("/api/options/route", { route, destination });
  },

  optionsRouteLunch({ route, destination }) {
    return post("/api/options/route-lunch", { route, destination });
  },

  optionsActivities({ destination }) {
    return post("/api/options/activities", { destination });
  },

  // Curación por IA en segundo plano. Se sondea hasta status:"ready" (o "off"
  // si no hay clave). Ver /api/ai/curate en server.js.
  aiCurate({ kind, route, destination }) {
    return post("/api/ai/curate", { kind, route, destination });
  },

  // Asistente conversacional de sólo lectura sobre el itinerario ya calculado.
  // `context.planText`/`warningsText` son texto ya formateado (ver lib/assistant.js
  // en el cliente); el servidor no recalcula nada, sólo responde con Gemini.
  assistantAsk({ question, context, history }) {
    return post("/api/assistant/ask", { question, context, history });
  },

  optionsServices({ destination }) {
    return post("/api/options/services", { destination });
  },

  async metricsRouteOptions({ route, items }) {
    const merged = new Map(items.map(x => [x.id, x]));
    let degraded = false;
    // Lotes de 20, hasta 4 en paralelo (antes secuenciales: con ~150 paradas
    // eran ~8 llamadas OSRM en fila). OSRM tolera esta concurrencia moderada.
    const batches = [];
    for (let i = 0; i < items.length; i += 20) batches.push(items.slice(i, i + 20));
    const runBatch = async (batch) => {
      try {
        const result = await post("/api/metrics/route-options", { route, items: batch });
        if (result.source !== "osrm" || result.items?.length !== batch.length) degraded = true;
        for (const item of result.items || []) if (merged.has(item.id)) merged.set(item.id, { ...merged.get(item.id), ...item });
      } catch { degraded = true; }
    };
    for (let i = 0; i < batches.length; i += 4) await Promise.all(batches.slice(i, i + 4).map(runBatch));
    return { items: items.map(x => merged.get(x.id)), degraded };
  },

  metricsRouteDetour({ origin, stop, destination }) {
    return post("/api/metrics/route-detour", { origin, stop, destination });
  },

  planRouteVia({ origin, vias, destination }) {
    return post("/api/plan/route-via", { origin, vias, destination });
  },

  async travelSequence({ points }) {
    const legs = [];
    for (let i = 0; i < points.length - 1; i += 19) {
      const result = await post("/api/travel/sequence", { points: points.slice(i, i + 20) });
      if (result.legs?.length !== Math.min(19, points.length - i - 1)) throw new Error("Desplazamientos incompletos");
      legs.push(...result.legs.map(leg => ({ ...leg, source: result.source })));
    }
    return { legs };
  }
};
