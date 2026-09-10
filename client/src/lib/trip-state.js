/* Guardar / cargar el estado completo de un viaje.
   Se serializa SÓLO lo que no se puede recomputar: contexto de búsqueda, base
   elegida, geometría de ruta, opciones descubiertas y selecciones. El itinerario,
   la ruta del día, el legCache y activeRoute los reconstruyen los `$effect` de
   App.svelte al cargar (una única llamada a /api/plan/day, normalmente en caché).

   Eficiencia:
   - las coordenadas de ruta van como array plano [lat,lon,lat,lon,…] (sin las
     claves repetidas "lat"/"lon": ~45 % menos que un array de objetos);
   - no se guarda searchContext.referenceRoute (sólo se usa antes de elegir base). */

import { get } from "svelte/store";
import {
  searchContext, baseResults, chosen, routeData, activeRoute,
  pools, selected, customDurations, preferences, departureTime,
  customStops, openOptionGroup, emptyPools, emptySelected
} from "./stores.js";

export const TRIP_VERSION = 1;

const packCoords = (arr) => {
  const out = new Array((arr?.length || 0) * 2);
  for (let i = 0; i < (arr?.length || 0); i++) { out[i * 2] = arr[i].lat; out[i * 2 + 1] = arr[i].lon; }
  return out;
};
const unpackCoords = (flat) => {
  const out = [];
  for (let i = 0; i + 1 < (flat?.length || 0); i += 2) out.push({ lat: flat[i], lon: flat[i + 1] });
  return out;
};
const packRoute = (rd) => (rd && Array.isArray(rd.coords) ? { ...rd, coords: packCoords(rd.coords) } : rd || null);
const unpackRoute = (rd) => (rd && Array.isArray(rd.coords) ? { ...rd, coords: unpackCoords(rd.coords) } : rd || null);

/** Instantánea serializable del viaje. `extra` mezcla estado local de App
    (p. ej. planLoaded, originText) que no vive en stores. */
export function buildSnapshot(extra = {}) {
  const ctx = get(searchContext);
  return {
    v: TRIP_VERSION,
    savedAt: new Date().toISOString(),
    ...extra,
    searchContext: ctx ? { ...ctx, referenceRoute: undefined } : null,
    baseResults: get(baseResults) || [],
    chosen: get(chosen) || null,
    routeData: packRoute(get(routeData)),
    pools: get(pools) || emptyPools(),
    selected: get(selected) || emptySelected(),
    customStops: get(customStops) || [],
    customDurations: [...get(customDurations)],
    preferences: [...get(preferences)],
    departureTime: get(departureTime) || "09:30"
  };
}

/** ¿Es `s` una instantánea de viaje compatible? */
export function isSnapshot(s) {
  return !!s && s.v === TRIP_VERSION && typeof s === "object";
}

/** Vuelca la instantánea a los stores. El estado local de App (planLoaded,
    originText, categoryState, editingSearch, mobileTask…) lo pone quien llama. */
export function applySnapshot(s) {
  searchContext.set(s.searchContext || null);
  baseResults.set(s.baseResults || []);
  chosen.set(s.chosen || null);
  routeData.set(unpackRoute(s.routeData));
  activeRoute.set(null);
  pools.set(s.pools || emptyPools());
  selected.set(s.selected || emptySelected());
  customStops.set(s.customStops || []);
  customDurations.set(new Map(s.customDurations || []));
  preferences.set(new Set(s.preferences || []));
  departureTime.set(s.departureTime || "09:30");
  openOptionGroup.set(null);
}

/** Nombre de archivo legible: dailytrip-malaga-almeria-2026-09-10.json */
export function snapshotFilename(s) {
  const slug = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "viaje";
  const o = slug(s.searchContext?.origin?.name);
  const d = slug(s.chosen?.name || s.searchContext?.target?.name);
  return `dailytrip-${o}-${d}-${(s.savedAt || "").slice(0, 10)}.json`;
}
