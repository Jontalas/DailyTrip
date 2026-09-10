/* Controlador del mapa (Leaflet). Map-forward: el mapa es la capa de fondo.

   Capas (de abajo a arriba):
     tiles Esri  ->  routeCasing/route (corredor base)  ->  spur (ramal de desvío)
     ->  itinerary (línea del día real)  ->  markers (origen/base/opciones)

   Teselas: Esri "Gray Canvas" (base + referencia), gratuitas, sólo atribución.
   zoomSnap:1 obligatorio (Esri usa LOD enteros). Fallback: OSM (TILE_FALLBACK). */

import L from "leaflet";
import { detourLevel } from "./format.js";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const ESRI_ATTR = 'Teselas &copy; <a href="https://www.esri.com">Esri</a>';
const TILES = {
  light: {
    base: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    ref: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`
  },
  dark: {
    base: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    ref: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`
  }
};
// eslint-disable-next-line no-unused-vars
const TILE_FALLBACK = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

const SPAIN_CENTER = [40.0, -3.7];

// Encuadre inicial: margen modesto (la ruta debe verse a un zoom útil aunque los
// extremos queden algo cerca de los paneles glass).
const FIT_INSETS = { paddingTopLeft: [110, 96], paddingBottomRight: [110, 44] };

function pinIcon(kind, label) {
  return L.divIcon({
    className: "",
    html: `<span class="map-pin map-pin--${kind}">${label || ""}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function optionIcon(item, kind, { selected, hovered, flip = false }) {
  const det = kind === "route" && item.extraMin != null ? detourLevel(item.extraMin) : null;
  const show = selected || hovered;
  const chip = show ? `<b class="chip">${esc(item.name)}</b>` : '';
  const cls = [
    "map-opt",
    `map-opt--${kind}`,
    selected ? "is-selected" : "",
    hovered ? "is-hover" : "",
    item.custom ? "is-custom" : "",
    flip ? "chip-left" : "",
    det ? `is-${det}` : ""
  ].join(" ");
  // Seleccionada: el punto conserva su color de categoría/desvío pero lleva una
  // marca de verificación y un halo grueso para que "se vea claramente elegida".
  const glyph = selected ? "✓" : item.custom ? "★" : "";
  return L.divIcon({
    className: "",
    html: `<span class="${cls}"><i class="dot">${glyph}</i>${chip}</span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

export function createMapController(container) {
  const map = L.map(container, {
    zoomControl: true,
    attributionControl: true,
    center: SPAIN_CENTER,
    zoom: 6,
    zoomSnap: 1,
    zoomDelta: 1,
    worldCopyJump: true,
    maxZoom: 18
  });
  // La leyenda ocupa la esquina inferior derecha; la atribución va a la izquierda.
  map.attributionControl.setPosition("bottomleft");

  const tileOpts = { attribution: ESRI_ATTR, maxNativeZoom: 16, maxZoom: 18 };
  const tileLayers = {
    base: L.tileLayer(TILES.light.base, { ...tileOpts, zIndex: 1 }).addTo(map),
    ref: L.tileLayer(TILES.light.ref, { ...tileOpts, zIndex: 2, opacity: 0.9 }).addTo(map)
  };

  const layers = {
    routeCasing: L.layerGroup().addTo(map), // corredor directo (referencia, tenue)
    route: L.layerGroup().addTo(map),
    itinRoute: L.layerGroup().addTo(map), // ruta REAL del día con paradas seleccionadas
    spur: L.layerGroup().addTo(map), // preview del desvío al pasar el ratón
    itinerary: L.layerGroup().addTo(map), // saltos en destino (base -> actividades -> cena)
    markers: L.layerGroup().addTo(map)
  };

  let currentTheme = "light";
  let baseIsWaypoint = true;
  let base = null; // { origin, chosen, routeData }
  const markersById = new Map();
  let onHover = null; // callback (id|null) hacia el store
  let onActivate = null; // callback (id) al pulsar un marcador (revelar en la lista)
  let openGroup = null; // grupo del acordeón desplegado ("route"|"lunch"|...)

  function resolveTheme(t) {
    if (t === "light" || t === "dark") return t;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function setTheme(t) {
    const r = resolveTheme(t);
    if (r === currentTheme) return;
    currentTheme = r;
    tileLayers.base.setUrl(TILES[r].base);
    tileLayers.ref.setUrl(TILES[r].ref);
    if (base?.routeData) drawCorridor();
  }

  function setHoverCallback(fn) {
    onHover = fn;
  }
  function setActivateCallback(fn) {
    onActivate = fn;
  }

  /* ---- corredor base + marcadores fijos ------------------------------- */
  function drawCorridor() {
    layers.routeCasing.clearLayers();
    layers.route.clearLayers();
    if (!base?.routeData?.coords?.length) return;
    const ll = base.routeData.coords.map((c) => [c.lat, c.lon]);
    L.polyline(ll, {
      color: currentTheme === "dark" ? "#000" : "#1c140c",
      opacity: currentTheme === "dark" ? 0.45 : 0.18,
      weight: 9,
      lineCap: "round"
    }).addTo(layers.routeCasing);
    L.polyline(ll, {
      color: "#c9862f",
      opacity: 0.65,
      weight: 3,
      dashArray: "1 7",
      lineCap: "round"
    }).addTo(layers.route);
  }

  function fitToRoute() {
    if (!base?.routeData?.coords?.length) return;
    const ll = base.routeData.coords.map((c) => [c.lat, c.lon]);
    map.fitBounds(L.latLngBounds(ll), { animate: true, ...FIT_INSETS });
  }

  const EMPTY_POOLS = { route: [], activities: [], food: [], lodging: [] };
  const EMPTY_SEL = { route: [], activities: [], lunch: null, dinner: null, hotel: null };

  function showRoute(routeData, origin, chosen) {
    base = { routeData, origin, chosen };
    drawCorridor();
    layers.spur.clearLayers();
    layers.itinRoute.clearLayers();
    layers.itinerary.clearLayers();
    renderMarkers(lastPools, lastSelected);
    if (routeData?.coords?.length) fitToRoute();
  }

  function clearRoute() {
    base = null;
    lastPools = EMPTY_POOLS;
    lastSelected = EMPTY_SEL;
    hoveredId = null;
    Object.values(layers).forEach((l) => l.clearLayers());
    markersById.clear();
  }

  /* ---- marcadores de opción -----------------------------------------
     El corredor se satura si pintamos las ~100 opciones de destino, así que:
       - paradas en ruta: siempre (16, repartidas, cuentan la historia del desvío)
       - opciones de destino: sólo las SELECCIONADAS, más una transitoria para la
         que se está señalando (hover). Cualquier tarjeta tiene marcador al que
         saltar porque `itemsById` guarda todas las coordenadas.  */
  let lastPools = EMPTY_POOLS;
  let lastSelected = EMPTY_SEL;
  let hoveredId = null;
  let hoverMarker = null; // marcador transitorio para el destino señalado
  const itemsById = new Map(); // id -> { item, kind }  (todas las opciones)
  const SPUR_COLOR = { good: "#3f9d5c", mid: "#e0a63c", high: "#d3524a", unknown: "#8a7c65" };

  function selectedIdSet(sel) {
    return new Set(
      [
        ...sel.route.map((x) => x.id),
        ...sel.activities.map((x) => x.id),
        sel.lunch?.id,
        sel.dinner?.id,
        sel.hotel?.id
      ].filter(Boolean)
    );
  }

  function makeMarker(item, kind, selected) {
    const m = L.marker([item.lat, item.lon], {
      icon: optionIcon(item, kind, {
        selected,
        hovered: hoveredId === item.id,
        flip: shouldFlip(item.lat, item.lon)
      }),
      title: item.name,
      alt: `${kind === "route" ? "Parada" : "Opción"}: ${item.name}`,
      keyboard: true,
      zIndexOffset: selected ? 500 : kind === "route" ? 300 : 100,
      riseOnHover: true
    });
    m.on("mouseover", () => onHover?.(item.id));
    m.on("mouseout", () => onHover?.(null));
    m.on("click", () => {
      onHover?.(item.id);
      onActivate?.(item.id);
    });
    m.on("focus", () => onHover?.(item.id));
    m.on("blur", () => onHover?.(null));
    return m;
  }

  function renderMarkers(pools, selected) {
    lastPools = pools || EMPTY_POOLS;
    lastSelected = selected || EMPTY_SEL;
    layers.markers.clearLayers();
    markersById.clear();
    itemsById.clear();
    hoverMarker = null;
    if (!base) return;

    const { origin, chosen } = base;
    if (origin) L.marker([origin.lat, origin.lon], { icon: pinIcon("origin"), title: origin.name, interactive: false }).bindTooltip(esc(origin.name), {permanent:true,direction:"right"}).addTo(layers.markers);
    if (chosen && baseIsWaypoint) L.marker([chosen.lat, chosen.lon], { icon: pinIcon("base"), title: chosen.name, interactive: false }).bindTooltip(esc(chosen.name), {permanent:true,direction:"right"}).addTo(layers.markers);

    const selIds = selectedIdSet(lastSelected);
    // Las opciones NO seleccionadas sólo se pintan si su grupo del acordeón está
    // desplegado. Las seleccionadas se ven SIEMPRE (y bien marcadas).
    const register = (list, kind, revealGroups) => {
      const groupOpen = revealGroups.includes(openGroup);
      for (const item of list || []) {
        if (!Number.isFinite(item?.lat) || !Number.isFinite(item?.lon)) continue;
        itemsById.set(item.id, { item, kind });
        const isSel = selIds.has(item.id);
        if (isSel || groupOpen) {
          const m = makeMarker(item, kind, isSel).addTo(layers.markers);
          markersById.set(item.id, { marker: m, item, kind });
        }
      }
    };
    register((lastPools.route || []).filter(x=>!x.custom), "route", ["route"]);
    register((lastPools.route || []).filter(x=>x.custom), "route", ["custom"]);
    register(lastPools.routeLunch, "food", ["lunch"]); // comida en ruta
    register(lastPools.activities, "act", ["act"]);
    register(lastPools.food, "food", ["lunch", "dinner"]); // comida/cena en destino
    register(lastPools.lodging, "lodging", ["hotel"]);

    // rehacer el marcador transitorio si seguimos señalando un destino no fijado
    if (hoveredId && !markersById.has(hoveredId)) {
      const rec = itemsById.get(hoveredId);
      if (rec && rec.kind !== "route") {
        hoverMarker = makeMarker(rec.item, rec.kind, false).addTo(layers.markers);
      }
    }

    drawItineraryLine();
  }

  // ¿El punto está tan a la derecha que su etiqueta se saldría? -> ponerla a la
  // izquierda del punto.
  function shouldFlip(lat, lon) {
    if (!Number.isFinite(lat)) return false;
    try {
      const p = map.latLngToContainerPoint(L.latLng(lat, lon));
      return p.x > map.getSize().x * 0.72;
    } catch {
      return false;
    }
  }

  // Si el punto no se ve (o queda muy al borde), centrarlo en la ventana
  // manteniendo el zoom actual.
  function ensureVisible(lat, lon) {
    if (!Number.isFinite(lat)) return;
    const ll = L.latLng(lat, lon);
    if (!map.getBounds().pad(-0.12).contains(ll)) {
      map.panTo(ll, { animate: true });
    }
  }

  function setHovered(id) {
    if (id === hoveredId) return;
    const prev = hoveredId;
    hoveredId = id;

    // marcador anterior
    const prevReal = prev && markersById.get(prev);
    if (prevReal) {
      const wasSel = selectedIdSet(lastSelected).has(prev);
      prevReal.marker.setIcon(
        optionIcon(prevReal.item, prevReal.kind, {
          selected: wasSel,
          hovered: false,
          flip: shouldFlip(prevReal.item.lat, prevReal.item.lon)
        })
      );
    }
    if (hoverMarker) {
      layers.markers.removeLayer(hoverMarker);
      hoverMarker = null;
    }

    if (!id) return;

    const real = markersById.get(id);
    if (real) {
      const isSel = selectedIdSet(lastSelected).has(id);
      real.marker.setIcon(
        optionIcon(real.item, real.kind, {
          selected: isSel,
          hovered: true,
          flip: shouldFlip(real.item.lat, real.item.lon)
        })
      );
      real.marker.setZIndexOffset(900);
      ensureVisible(real.item.lat, real.item.lon);
      return;
    }

    // opción sin marcador fijo (destino no seleccionado): marcador transitorio
    const rec = itemsById.get(id);
    if (rec && Number.isFinite(rec.item.lat)) {
      if (rec.kind !== "route") hoverMarker = makeMarker(rec.item, rec.kind, false).addTo(layers.markers);
      ensureVisible(rec.item.lat, rec.item.lon);
    }
  }

  /* ---- ramal de desvío (lo dibuja MapCanvas con geometría real) ------
     coords: [{lat,lon}]  ·  level: good|mid|high|unknown  ·  chip: texto o null */
  function drawSpur(coords, level = "mid", chip = null) {
    layers.spur.clearLayers();
    if (!Array.isArray(coords) || coords.length < 2) return;
    const ll = coords.map((c) => [c.lat, c.lon]);
    const color = SPUR_COLOR[level] || SPUR_COLOR.mid;
    L.polyline(ll, { color: "#fff", weight: 7, opacity: 0.5, lineCap: "round" }).addTo(layers.spur);
    L.polyline(ll, { color, weight: 3.5, opacity: 0.95, dashArray: "5 6", lineCap: "round" }).addTo(layers.spur);
    if (chip) {
      const mid = coords[Math.floor(coords.length / 2)];
      L.marker([mid.lat, mid.lon], {
        interactive: false,
        icon: L.divIcon({ className: "", html: `<b class="spur-chip det-${level}">${chip}</b>`, iconSize: [10, 10], iconAnchor: [-4, 10] })
      }).addTo(layers.spur);
    }
  }
  function clearSpur() {
    layers.spur.clearLayers();
  }

  /* ---- ruta REAL del día: origen -> paradas seleccionadas -> base ------
     Se dibuja SIEMPRE que hay paradas seleccionadas (el desvío se ve en todo
     momento). El corredor directo queda debajo como referencia tenue. */
  function drawItineraryRoute(coords) {
    layers.itinRoute.clearLayers();
    if (!Array.isArray(coords) || coords.length < 2) return;
    const ll = coords.map((c) => [c.lat, c.lon]);
    L.polyline(ll, {
      color: currentTheme === "dark" ? "#000" : "#1c140c",
      opacity: currentTheme === "dark" ? 0.5 : 0.22,
      weight: 9,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(layers.itinRoute);
    L.polyline(ll, {
      color: "#dd7a3b",
      opacity: 1,
      weight: 4,
      lineCap: "round",
      lineJoin: "round",
      className: "route-line"
    }).addTo(layers.itinRoute);
  }
  function clearItineraryRoute() {
    layers.itinRoute.clearLayers();
  }

  /* ---- línea del itinerario en destino ------------------------------
     Sólo los saltos locales base -> check-in -> actividades -> cena.
     El tramo origen->base ya lo representa el corredor real. */
  function drawItineraryLine() { layers.itinerary.clearLayers(); }
  function drawDayRoute(segments,includeBase=true) {
    if(baseIsWaypoint!==includeBase){baseIsWaypoint=includeBase;renderMarkers(lastPools,lastSelected);}
    if(includeBase && !segments.length)drawCorridor();
    else {layers.route.clearLayers();layers.routeCasing.clearLayers();}
    layers.itinRoute.clearLayers();
    for(const coords of segments) {
      if(coords.length<2) continue;
      L.polyline(coords.map(p=>[p.lat,p.lon]),{color:'#dd7a3b',weight:4,opacity:1,className:'route-line'}).addTo(layers.itinRoute);
    }
  }

  function showOptions(pools, selected, group) {
    openGroup = group ?? null;
    renderMarkers(pools, selected);
  }

  function invalidate() {
    map.invalidateSize({ animate: false });
  }
  function destroy() {
    map.remove();
  }

  return {
    map,
    setTheme,
    setHoverCallback,
    setActivateCallback,
    showRoute,
    clearRoute,
    showOptions,
    setHovered,
    drawSpur,
    clearSpur,
    drawDayRoute,
    drawItineraryRoute,
    clearItineraryRoute,
    invalidate,
    destroy
  };
}
