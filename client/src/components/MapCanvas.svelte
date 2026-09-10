<script>
  import { onMount, onDestroy } from "svelte";
  import { createMapController } from "../lib/map.js";
  import {
    hoveredOptionId,
    openOptionGroup,
    revealOptionId,
    mapPickMode,
    groupOfOptionId,
    selectFoodFromMap,
    addCustomStopEnriched
  } from "../lib/stores.js";
  import { api } from "../lib/api.js";
  import { detourLevel } from "../lib/format.js";
  import {routingSelection} from "../lib/active-route.js";

  let {
    dayPlan = null,
    routeData = null,
    origin = null,
    chosen = null,
    theme = "system",
    pools = null,
    selected = null,
    openGroup = null,
    departureMin = 570,
    durations = null
  } = $props();

  let el;
  let ctl = $state.raw(null);
  let ro = null;

  onMount(() => {
    ctl = createMapController(el);
    ctl.setTheme(theme);
    ctl.setHoverCallback((id) => hoveredOptionId.set(id));
    // Pulsar un marcador: abre su grupo en la lista y pide revelar esa fila.
    ctl.setActivateCallback((id) => {
      selectFoodFromMap(id);
      const g = groupOfOptionId(id);
      if (g) openOptionGroup.set(g);
      revealOptionId.set(id);
    });
    // Modo "marcar en el mapa": el siguiente clic en el mapa añade una parada.
    ctl.map.on("click", onMapClick);

    ro = new ResizeObserver(() => ctl?.invalidate());
    ro.observe(el);
    requestAnimationFrame(() => ctl?.invalidate());
  });

  async function onMapClick(e) {
    if (!$mapPickMode || !e?.latlng) return;
    const { lat, lng } = e.latlng;
    let name = "";
    try {
      const g = await api.geocode({ lat, lon: lng });
      name = g?.name || "";
    } catch {}
    addCustomStopEnriched(
      {
        id: `custom:${lat.toFixed(5)},${lng.toFixed(5)}`,
        name: name || `Punto ${lat.toFixed(3)}, ${lng.toFixed(3)}`,
        lat,
        lon: lng
      },
      routeData
    );
    mapPickMode.set(false);
  }

  onDestroy(() => {
    ro?.disconnect();
    ctl?.destroy();
    ctl = null;
  });

  $effect(() => {
    if (ctl) ctl.setTheme(theme);
  });

  // Corredor base (se redibuja al cambiar la ruta)
  $effect(() => {
    if (!ctl) return;
    if (routeData?.coords?.length) ctl.showRoute(routeData, origin, chosen);
    else ctl.clearRoute();
  });

  // Marcadores de opción + línea del itinerario real
  $effect(() => {
    if (!ctl) return;
    // dependencias reactivas explícitas
    pools;
    selected;
    openGroup;
    ctl.showOptions(pools, selected, openGroup);
  });

  // Sincronización hover lista <-> mapa
  $effect(() => {
    const id = $hoveredOptionId;
    if (ctl) ctl.setHovered(id);
  });

  $effect(() => {
    if(!ctl) return;
    ctl.drawDayRoute(dayPlan?.segments || [], !dayPlan || dayPlan.stops.some(s=>s.kind==='base'));
  });

  // Preview del desvío al pasar el ratón sobre una parada de ruta NO seleccionada
  // (las seleccionadas ya están en la ruta del día de arriba).
  let spurSeq = 0;
  $effect(() => {
    const id = $hoveredOptionId;
    const mine = ++spurSeq;
    if (!ctl) return;
    const stop = id && (pools?.route || []).find((x) => x.id === id);
    const isSelected = stop && (selected?.route || []).some((s) => s.id === id);
    if (!stop || isSelected || !origin || !chosen) {
      ctl.clearSpur();
      return;
    }
    const level = stop.extraMin != null ? detourLevel(stop.extraMin) : "unknown";
    const chip = null;
    ctl.clearSpur();
    const candidate=routingSelection({...selected,route:[...selected.route,stop]});
    const timer=setTimeout(()=>api
      .planDay({origin,chosen,selected:candidate,departureMin,durations})
      .then((d) => {
        if (mine !== spurSeq || $hoveredOptionId !== id) return;
        if (d?.source==='osrm' && d.segments?.length) ctl.drawSpur(d.segments.flatMap((s,i)=>i?s.slice(1):s), level, chip);
      })
      .catch(() => {}),400);
    return ()=>clearTimeout(timer);
  });
</script>

<div
  class="map"
  class:map--picking={$mapPickMode}
  bind:this={el}
  role="region"
  aria-label="Mapa de la ruta y las opciones. Refleja la lista; usa las tarjetas para seleccionar."
></div>

{#if pools}
  <aside class="legend" aria-label="Leyenda del mapa">
    <p class="legend__title">Leyenda</p>
    <div class="legend__body">
      <p class="legend__t">Coste de desvío de una parada</p>
      <ul>
        <li><i class="sw sw--good"></i>hasta +12 min</li>
        <li><i class="sw sw--mid"></i>+12 a +30 min</li>
        <li><i class="sw sw--high"></i>más de +30 min</li>
      </ul>
      <p class="legend__t">Opciones en destino</p>
      <ul>
        <li><i class="sw sw--act"></i>actividad</li>
        <li><i class="sw sw--food"></i>comida</li>
        <li><i class="sw sw--lodging"></i>alojamiento</li>
      </ul>
      <p class="legend__t">Estado</p>
      <ul>
        <li><i class="sw sw--sel">✓</i>seleccionada</li>
        <li><i class="sw sw--custom">★</i>personalizada</li>
      </ul>
    </div>
  </aside>
{/if}

<style>
  .map {
    position: absolute;
    inset: 0;
    z-index: var(--z-map);
    background: var(--surface-sunk);
  }
  .map--picking :global(.leaflet-container),
  .map--picking :global(.leaflet-interactive) {
    cursor: crosshair !important;
  }

  .legend {
    position: absolute;
    right: var(--sp-3);
    bottom: var(--sp-3);
    z-index: var(--z-overlay);
    width: 210px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-md);
    backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--sh-2);
    font-size: var(--fs-11);
    pointer-events: auto;
  }
  .legend__title {
    padding: 7px 12px 0;
    font-weight: 800;
    color: var(--text-soft);
  }
  .legend__body {
    padding: 4px 12px 10px;
  }
  .legend__t {
    margin: 6px 0 3px;
    color: var(--text-faint);
    font-weight: 700;
  }
  .legend ul {
    list-style: none;
    margin: 0 0 4px;
    padding: 0;
    display: grid;
    gap: 3px;
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--text-soft);
  }
  .legend .sw {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    flex: none;
  }
  .sw--good {
    background: var(--data-good);
  }
  .sw--mid {
    background: var(--data-mid);
  }
  .sw--high {
    background: var(--data-high);
  }
  .sw--act {
    background: #7a5cc4;
  }
  .sw--food {
    background: #c9862f;
  }
  .sw--lodging {
    background: #2f7b4c;
  }
  .sw--sel,
  .sw--custom {
    display: grid;
    place-items: center;
    font-size: 8px;
    font-weight: 900;
    color: #fff;
    background: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-ring);
  }
  .sw--custom {
    background: var(--text);
    border-radius: 3px;
  }
  @media (max-width: 1024px) {
    .legend {
      display: none;
    }
  }

  /* -- pines fijos (origen / base) -- */
  :global(.map-pin) {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    font-size: var(--fs-11);
    font-weight: 800;
    color: #fff;
    border: 3px solid var(--surface);
    box-shadow: var(--sh-2);
  }
  :global(.map-pin--origin) {
    background: var(--text);
  }
  :global(.map-pin--base) {
    background: var(--accent);
    width: 30px;
    height: 30px;
  }

  /* -- marcadores de opción --
     El contenedor del icono de Leaflet mide sólo iconSize (18×18) y recortaba la
     etiqueta. La etiqueta va en position:absolute para escaparse de esa caja y
     no depende del ancho del contenedor. */
  :global(.map-opt) {
    position: relative;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
  }
  :global(.map-opt .dot) {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    font-size: 9px;
    font-style: normal;
    font-weight: 900;
    color: #fff;
    background: var(--text-faint);
    border: 2px solid var(--surface);
    box-shadow: var(--sh-1);
    transition: transform var(--dur-1) var(--ease-out), box-shadow var(--dur-1) var(--ease-out);
  }
  :global(.map-opt--route .dot) {
    background: #8a7c65;
  }
  :global(.map-opt--route.is-good .dot) {
    background: var(--data-good);
  }
  :global(.map-opt--route.is-mid .dot) {
    background: var(--data-mid);
  }
  :global(.map-opt--route.is-high .dot) {
    background: var(--data-high);
  }
  :global(.map-opt--act .dot) {
    background: #7a5cc4;
  }
  :global(.map-opt--food .dot) {
    background: #c9862f;
  }
  :global(.map-opt--lodging .dot) {
    background: #2f7b4c;
  }
  /* Seleccionada: MANTIENE su color de categoría/desvío (código de la leyenda) y
     se distingue con borde blanco grueso, halo, tamaño mayor y la marca ✓. */
  :global(.map-opt.is-selected .dot) {
    width: 20px;
    height: 20px;
    font-size: 11px;
    border-width: 3px;
    border-color: #fff;
    transform: scale(1.1);
    box-shadow: 0 0 0 3px var(--accent), var(--sh-2);
    z-index: 1;
  }
  :global(.map-opt.is-custom .dot) {
    border-radius: 6px;
  }
  :global(.map-opt.is-custom:not(.is-selected) .dot) {
    background: var(--text);
    color: #fff;
  }
  :global(.map-opt.is-hover .dot) {
    transform: scale(1.4);
  }
  :global(.map-opt.is-selected.is-hover .dot) {
    transform: scale(1.25);
  }
  :global(.map-opt .chip) {
    position: absolute;
    left: calc(100% + 6px);
    top: 50%;
    transform: translateY(-50%);
    z-index: 3;
    white-space: nowrap;
    font-size: 10px;
    font-weight: 800;
    line-height: 1;
    padding: 3px 6px;
    border-radius: 5px;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--line);
    box-shadow: var(--sh-1);
    pointer-events: none;
  }
  /* Cerca del borde derecho, la etiqueta se coloca a la izquierda del punto. */
  :global(.map-opt.chip-left .chip) {
    left: auto;
    right: calc(100% + 6px);
  }
  :global(.map-opt .chip.det-good) {
    background: var(--data-good);
    color: #fff;
    border: 0;
  }
  :global(.map-opt .chip.det-mid) {
    background: var(--data-mid);
    color: #1c140c;
    border: 0;
  }
  :global(.map-opt .chip.det-high) {
    background: var(--data-high);
    color: #fff;
    border: 0;
  }

  :global(.seq-num) {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    font-size: 9px;
    font-weight: 800;
    color: #fff;
    background: var(--accent);
    border: 2px solid #fff;
    box-shadow: var(--sh-1);
  }

  /* -- chip del ramal de desvío -- */
  :global(.spur-chip) {
    font-size: 10px;
    font-weight: 800;
    padding: 3px 6px;
    border-radius: var(--r-pill);
    white-space: nowrap;
    color: #fff;
    box-shadow: var(--sh-2);
  }
  :global(.spur-chip.det-good) {
    background: var(--data-good);
  }
  :global(.spur-chip.det-mid) {
    background: var(--data-mid);
    color: #1c140c;
  }
  :global(.spur-chip.det-high) {
    background: var(--data-high);
  }
  :global(.spur-chip.det-unknown) {
    background: var(--text-faint);
  }
</style>
