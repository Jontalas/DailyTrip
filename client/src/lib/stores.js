/* Estado global de la app como stores de Svelte.
   Espejo del estado que en public/app.js (v1.1.5) eran variables sueltas:
     searchContext, chosen, routeData, pools, selected, customDurations, rebuildSeq
   más estado de UI (tema, progreso, avisos). */

import { writable, derived, get } from "svelte/store";
import { routeGeometryIndex } from "../../../lib/route-search.js";
import { api } from "./api.js";

/* ---- Datos del flujo -------------------------------------------------------- */
export const providers = writable(null);
export const searchContext = writable(null);
export const baseResults = writable([]); // resultados de /candidates + disclaimer
export const chosen = writable(null); // base elegida
export const routeData = writable(null); // { roadKm, durationMin, coords, source }
export const activeRoute = writable(null); // Recorrido completo de las visitas seleccionadas.

export const emptyPools = () => ({
  route: [],
  routeLunch: [],
  activities: [],
  food: [],
  lodging: []
});
export const emptySelected = () => ({
  route: [],
  activities: [],
  lunch: null,
  dinner: null,
  hotel: null
});

export const pools = writable(emptyPools());
export const selected = writable(emptySelected());

/* Duraciones personalizadas por id de opción (equivale al Map de app.js).
   Se guarda como Map dentro de un writable; usar los helpers de abajo. */
export const customDurations = writable(new Map());

/* Preferencias del día (values de los checkboxes). */
export const preferences = writable(new Set());

/* Controles */
export const departureTime = writable("09:30");
export const theme = writable("dark"); // "system" | "light" | "dark" — por defecto oscuro

/* ---- Estado de UI --------------------------------------------------------- */
export const phase = writable("search"); // search | results | planning | builder
export const search = writable({ status: "", busy: false, steps: [] });
export const planning = writable({ status: "", busy: false, steps: [] });

/* Sincronización lista <-> mapa: id de opción bajo el cursor. */
export const hoveredOptionId = writable(null);
/* Parada cuyo "spur" de desvío se muestra en el mapa. */
export const focusedRouteStopId = writable(null);

/* Acordeón de opciones: grupo desplegado ("route"|"lunch"|"act"|"dinner"|"hotel"|null).
   Vive aquí (no en OptionsPanel) porque el mapa lo necesita: las opciones NO
   seleccionadas sólo se dibujan cuando su grupo está desplegado. */
export const openOptionGroup = writable(null);

/* Móvil (≤1024 px): tarea/hoja enfocada activa. null = sólo mapa + barra.
   Valores de categoría de opción coinciden con openOptionGroup para que un
   toque en un pin del mapa abra la hoja correcta.
   "search" | "prep" | "tune" | "itin" | "route" | "custom" | "lunch" |
   "act" | "dinner" | "hotel" | null */
export const mobileTask = writable(null);

/* Al pulsar un marcador del mapa: id de la opción que hay que revelar en la
   lista (abrir su grupo + hacer scroll hasta ella). Se limpia tras revelarla. */
export const revealOptionId = writable(null);

/* Estado de la consulta a la IA en segundo plano por sección:
   "idle" | "working" | "ready" | "error". Mientras es "working" se muestra un
   indicador; al pasar a "ready" la lista ya se ha fusionado y reordenado. */
export const aiCuration = writable({ route: "idle", activities: "idle" });

/* Paradas personalizadas añadidas por el usuario (búsqueda por nombre o pin en
   el mapa). Van SIEMPRE seleccionadas. Borrarlas no deja rastro. */
export const customStops = writable([]);

/* Modo "marcar en el mapa": el próximo clic en el mapa añade una parada. */
export const mapPickMode = writable(false);

/* ---- Helpers de duración (portados de app.js) --------------------------- */
export function recommendedMinutes(item) {
  return Math.max(1, Math.round(Number(item?.durationMin) || 60));
}

/** Duración efectiva de una opción: la personalizada si existe, si no la recomendada. */
export function selectedDuration(item, durMap) {
  if (!item) return 0;
  const map = durMap || get(customDurations);
  const v = map.get(item.id);
  return v == null ? recommendedMinutes(item) : Math.max(1, Math.round(Number(v) || 1));
}

export function ensureCustomDuration(item) {
  if (!item) return;
  customDurations.update((m) => {
    if (!m.has(item.id)) {
      m.set(item.id, recommendedMinutes(item));
      return new Map(m);
    }
    return m;
  });
}

export function setCustomDuration(id, minutes) {
  const n = Math.max(1, Math.min(720, Math.round(Number(minutes) || 1)));
  customDurations.update((m) => {
    const next = new Map(m);
    next.set(id, n);
    return next;
  });
  return n;
}

/* ---- Reset del plan (equivale al bloque de #loadPlan en app.js) --------- */
export function resetPlan() {
  activeRoute.set(null);
  pools.set(emptyPools());
  selected.set(emptySelected());
  customStops.set([]);
  openOptionGroup.set(null);
  mapPickMode.set(false);
  revealOptionId.set(null);
}

/* ---- Mutadores de selección (equivalen a bindSelections() de app.js) ---- */
export function toggleRouteStop(item) {
  selected.update((s) => {
    const on = s.route.some((y) => y.id === item.id);
    if (on) return { ...s, route: s.route.filter((y) => y.id !== item.id) };
    ensureCustomDuration(item);
    return { ...s, route: [...s.route, item] };
  });
}

export function toggleActivity(item) {
  selected.update((s) => {
    const on = s.activities.some((y) => y.id === item.id);
    if (on) return { ...s, activities: s.activities.filter((y) => y.id !== item.id) };
    ensureCustomDuration(item);
    return { ...s, activities: [...s.activities, item] };
  });
}

export function setLunch(item) {
  if (item) ensureCustomDuration(item);
  selected.update((s) => ({ ...s, lunch: item || null }));
}

export function setDinner(item) {
  if (item) ensureCustomDuration(item);
  selected.update((s) => ({ ...s, dinner: item || null }));
}

export function setHotel(item) {
  if (item) ensureCustomDuration(item);
  selected.update((s) => ({ ...s, hotel: item || null }));
}

/* ---- Paradas personalizadas -------------------------------------------- */
export function addCustomStop(item) {
  if (!item || !Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return;
  const stop = { durationMin: 45, ...item, custom: true, verified: true, source: item.source || "custom" };
  customStops.update((list) => (list.some((x) => x.id === stop.id) ? list : [...list, stop]));
  ensureCustomDuration(stop);
  selected.update((s) => (s.route.some((y) => y.id === stop.id) ? s : { ...s, route: [...s.route, stop] }));
  return stop;
}

/** Progreso (0-100) del punto más cercano de la ruta a un lugar. */
function progressAlongRoute(item, routeData) {
  const coords = routeData?.coords || [];
  if (coords.length < 2) return 50;
  try{return Math.round(routeGeometryIndex(coords).locate(item).routeProgressPct);}catch{return 50;}
}

/** Añade una parada personalizada calculando su posición en la ruta y, en
    segundo plano, sus métricas de desvío (km/min extra) para que el itinerario
    y el mapa la traten como una parada más. */
export function addCustomStopEnriched(raw, routeData) {
  const routeProgressPct = progressAlongRoute(raw, routeData);
  const stop = addCustomStop({ ...raw, routeProgressPct });
  if (!stop || !routeData?.coords?.length) return stop;
  api
    .metricsRouteOptions({ route: routeData, items: [{ ...stop, interestScore: 70 }] })
    .then((m) => {
      const got = m?.items?.[0];
      if (!got) return;
      const patch = {
        extraKm: got.extraKm,
        extraMin: got.extraMin,
        kmFromOrigin: got.kmFromOrigin,
        kmToDestination: got.kmToDestination,
        stageValue: got.stageValue
      };
      customStops.update((l) => l.map((x) => (x.id === stop.id ? { ...x, ...patch } : x)));
      selected.update((s) => ({
        ...s,
        route: s.route.map((x) => (x.id === stop.id ? { ...x, ...patch } : x))
      }));
    })
    .catch(() => {});
  return stop;
}

export function removeCustomStop(id) {
  customStops.update((list) => list.filter((x) => x.id !== id));
  selected.update((s) => ({ ...s, route: s.route.filter((y) => y.id !== id) }));
  customDurations.update((m) => {
    if (!m.has(id)) return m;
    const next = new Map(m);
    next.delete(id);
    return next;
  });
}

/* Grupo del acordeón al que pertenece una opción (para revelarla desde el mapa). */
export function groupOfOptionId(id) {
  if (!id) return null;
  const p = get(pools);
  const cs = get(customStops);
  if(cs.some(x=>x.id===id))return "custom";
  if ((p.route || []).some((x) => x.id === id)) return "route";
  if ((p.activities || []).some((x) => x.id === id)) return "act";
  if ((p.lodging || []).some((x) => x.id === id)) return "hotel";
  const inRouteLunch = (p.routeLunch || []).some((x) => x.id === id);
  const inFood = (p.food || []).some((x) => x.id === id);
  const active=get(openOptionGroup);
  if((inRouteLunch || inFood) && (active==='lunch' || active==='dinner'))return active;
  if (inRouteLunch) return "lunch";
  if (inFood) {
    const s = get(selected);
    if (s.dinner?.id === id) return "dinner";
    return "lunch";
  }
  return null;
}

export function selectFoodFromMap(id) {
  const active=get(openOptionGroup);
  if(active!=='lunch' && active!=='dinner')return;
  const p=get(pools);
  const routeItem=(p.routeLunch || []).find(x=>x.id===id);
  const item=(p.food || []).find(x=>x.id===id) || routeItem;
  if(!item)return;
  if(active==='dinner')setDinner(item);
  else setLunch({...item,lunchPhase:routeItem?'route':'destination'});
}

export function isSelectedRoute(id, s) {
  return (s || get(selected)).route.some((y) => y.id === id);
}
export function isSelectedActivity(id, s) {
  return (s || get(selected)).activities.some((y) => y.id === id);
}

/* ---- Búsqueda de una opción por id en todos los pools + selección ------- */
export function findOptionById(id) {
  const p = get(pools);
  for (const arr of Object.values(p)) {
    const found = (arr || []).find((x) => x.id === id);
    if (found) return found;
  }
  const s = get(selected);
  if (s.lunch?.id === id) return s.lunch;
  if (s.dinner?.id === id) return s.dinner;
  if (s.hotel?.id === id) return s.hotel;
  return null;
}

/* Todas las opciones de comida (ruta + destino) en el orden que usa la UI. */
export const lunchOptions = derived([pools], ([$pools]) => [
  ...$pools.routeLunch.map((x) => ({ ...x, lunchPhase: "route" })),
  ...$pools.food.map((x) => ({ ...x, lunchPhase: "destination" }))
].sort((a, b) => (b.interestScore || 0) - (a.interestScore || 0)));
