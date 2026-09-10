<script>
  import { tick } from "svelte";
  import OptionCard from "./OptionCard.svelte";
  import {
    selected,
    routeData,
    activeRoute,
    toggleRouteStop,
    toggleActivity,
    setLunch,
    setDinner,
    setHotel,
    openOptionGroup,
    revealOptionId,
    mapPickMode,
    customStops,
    addCustomStopEnriched,
    removeCustomStop
  } from "../lib/stores.js";
  import { api } from "../lib/api.js";

  let {
    pools,
    categoryState = {},
    onretry,
    lunchOptions = [],
    lateActivityIds = new Set(),
    lateLunchKeys = new Set(),
    mobile = false
  } = $props();

  let routeSel = $derived(new Set($selected.route.map((x) => x.id)));
  let actSel = $derived(new Set($selected.activities.map((x) => x.id)));
  // El servidor devuelve muchas más paradas de ruta de las que caben en pantalla.
  // `pools.route` ya viene ordenado por interés AJUSTADO con "qué te apetece hoy"
  // (applyPreferences en App). Se muestran las N mejores; al cambiar una
  // preferencia se reordena todo y cambian cuáles se ven. Las seleccionadas se
  // muestran siempre. No se descarta nada por horario ni viabilidad (v1.2.24).
  const ROUTE_CAP = 55;
  let allRoute = $derived((pools.route || []).filter((x) => !x.custom));
  let routeOptions = $derived(
    allRoute.length <= ROUTE_CAP
      ? allRoute
      : [
          ...allRoute.slice(0, ROUTE_CAP),
          ...allRoute.slice(ROUTE_CAP).filter((x) => routeSel.has(x.id))
        ]
  );

  function lunchIsSelected(item) {
    return $selected.lunch?.id === item.id && $selected.lunch?.lunchPhase === item.lunchPhase;
  }


  // Acordeón: arranca todo colapsado; abrir uno cierra los demás. El grupo
  // desplegado vive en un store porque el mapa lo necesita (sólo pinta las
  // opciones NO seleccionadas del grupo abierto).
  function toggle(e, key) {
    e.preventDefault();
    openOptionGroup.update((k) => (k === key ? null : key));
  }

  // Revelar una opción al pulsar su marcador en el mapa: su grupo ya lo abre
  // MapCanvas; aquí hacemos scroll hasta la fila.
  let listEl;
  $effect(() => {
    const id = $revealOptionId;
    if (!id) return;
    tick().then(() => {
      const node = listEl?.querySelector?.(`[data-opt-id="${cssEscape(id)}"]`);
      if (node) node.scrollIntoView({ block: "nearest", behavior: "smooth" });
      revealOptionId.set(null);
    });
  });
  function cssEscape(s) {
    return String(s).replace(/["\\]/g, "\\$&");
  }

  // ---- Alta de paradas personalizadas ----
  let customQuery = $state("");
  let customBusy = $state(false);
  let customError = $state("");

  async function addByName() {
    const q = customQuery.trim();
    if (!q || customBusy) return;
    customBusy = true;
    customError = "";
    try {
      const g = await api.geocode({ q, place:true });
      if (!g || !Number.isFinite(g.lat)) throw new Error("No se encontró ese lugar.");
      addCustomStopEnriched(
        { id: `custom:${g.lat.toFixed(5)},${g.lon.toFixed(5)}`, name: g.name || q, lat: g.lat, lon: g.lon },
        $activeRoute || $routeData
      );
      customQuery = "";
      openOptionGroup.set("custom");
    } catch (e) {
      customError = e.message || "No se pudo añadir.";
    } finally {
      customBusy = false;
    }
  }
</script>

{#snippet loadStatus(key)}
  {@const state = categoryState[key]}
  {#if state && (state.status !== "ok" || state.message)}
    <div class="load-state" role="status">
      <p>{state.status === "loading" ? "Consultando opciones…" : state.message}</p>
      {#if state.status !== "loading" && (state.status !== "ok" || state.canRetry)}
        <button type="button" class="mini" onclick={() => onretry?.(["food","lodging"].includes(key)?"services":key)}>Reintentar</button>
      {/if}
    </div>
  {/if}
{/snippet}

<div class="groups" class:mobile bind:this={listEl}>
  <details class="custom-section" open={$openOptionGroup === "custom"}>
    <summary onclick={(e) => toggle(e, "custom")}>
      <span class="g-title">Paradas personalizadas</span>
      <span class="g-count">{$customStops.length}</span>
    </summary>
    <p class="custom-help">Añade cualquier lugar por nombre o en el mapa. Se colocará automáticamente donde encaje mejor en el itinerario.</p>
    <div class="custom-add">
      <div class="custom-row">
        <input
          type="text"
          placeholder="Añadir parada por nombre…"
          bind:value={customQuery}
          onkeydown={(e) => e.key === "Enter" && addByName()}
          aria-label="Buscar un lugar para añadirlo al itinerario"
        />
        <button type="button" class="mini" onclick={addByName} disabled={customBusy || !customQuery.trim()}>
          {customBusy ? "…" : "Añadir"}
        </button>
      </div>
      <button
        type="button"
        class="mini mini--ghost"
        class:on={$mapPickMode}
        onclick={() => mapPickMode.update((v) => !v)}
      >
        {$mapPickMode ? "Pulsa un punto del mapa… (cancelar)" : "＋ Marcar en el mapa"}
      </button>
      {#if customError}<p class="c-err">{customError}</p>{/if}
    </div>
    {#if $customStops.length}
      <div class="list scroll-y">
        {#each $customStops as item (item.id)}
          <OptionCard {item} mode="multi" custom selected={routeSel.has(item.id)} ontoggle={toggleRouteStop} onremove={(x)=>removeCustomStop(x.id)} />
        {/each}
      </div>
    {/if}
  </details>

  <details class="group" data-category="route" open={$openOptionGroup === "route"}>
    <summary onclick={(e) => toggle(e, "route")}>
      <span class="g-title">Paradas en ruta</span>
      <span class="g-count">{allRoute.length}</span>
    </summary>

    {@render loadStatus("route")}


    <div class="list scroll-y">
      {#if allRoute.length > ROUTE_CAP}
        <p class="hint">{allRoute.length} paradas posibles en el recorrido · mostrando las {ROUTE_CAP} de mayor interés según «qué te apetece hoy».</p>
      {/if}
      {#each routeOptions as item (item.id)}
        <OptionCard
          {item}
          mode="multi"
          selected={routeSel.has(item.id)}
          ontoggle={toggleRouteStop}
        />
      {:else}
        {#if categoryState.route?.status === "ok"}<p class="empty">Sin paradas propuestas en el corredor.</p>{/if}
      {/each}
    </div>
  </details>

  <details class="group" open={$openOptionGroup === "lunch"}>
    <summary onclick={(e) => toggle(e, "lunch")}>
      <span class="g-title">Comida <span class="win">12:30–14:30</span></span>
      <span class="g-count">{lunchOptions.length}</span>
    </summary>
    {@render loadStatus("routeLunch")}
    {@render loadStatus("food")}
    <div class="list scroll-y">
      <button class="none" class:on={!$selected.lunch} type="button" onclick={() => setLunch(null)}>
        Sin restaurante — se reserva el bloque igualmente
      </button>
      {#each lunchOptions as item (item.lunchPhase + ":" + item.id)}
        <OptionCard
          {item}
          mode="single"
          quality
          meal="lunch"
          lateArrival={lateLunchKeys.has(`${item.lunchPhase}:${item.id}`)}
          selected={lunchIsSelected(item)}
          phaseLabel={item.lunchPhase === "route" ? "EN RUTA" : "EN DESTINO"}
          onselect={(x) => setLunch(x)}
        />
      {/each}

    </div>
  </details>

  <details class="group" open={$openOptionGroup === "act"}>
    <summary onclick={(e) => toggle(e, "act")}>
      <span class="g-title">Actividades en destino</span>
      <span class="g-count">{(pools.activities || []).length}</span>
    </summary>
    <div class="list scroll-y">
      {@render loadStatus("activities")}
      {#each pools.activities || [] as item (item.id)}
        <OptionCard
          {item}
          mode="multi"
          selected={actSel.has(item.id)}
          lateFinish={lateActivityIds.has(item.id)}
          ontoggle={toggleActivity}
        />
      {:else}
        {#if categoryState.activities?.status === "ok"}<p class="empty">Sin actividades propuestas.</p>{/if}
      {/each}
    </div>
  </details>

  <details class="group" open={$openOptionGroup === "dinner"}>
    <summary onclick={(e) => toggle(e, "dinner")}>
      <span class="g-title">Cena</span>
      <span class="g-count">{(pools.food || []).length}</span>
    </summary>
    <div class="list scroll-y">
      {@render loadStatus("food")}
      <button class="none" class:on={!$selected.dinner} type="button" onclick={() => setDinner(null)}>Sin cena</button>
      {#each pools.food || [] as item (item.id)}
        <OptionCard {item} mode="single" quality meal="dinner" selected={$selected.dinner?.id === item.id} onselect={(x) => setDinner(x)} />
      {/each}
    </div>
  </details>

  <details class="group" open={$openOptionGroup === "hotel"}>
    <summary onclick={(e) => toggle(e, "hotel")}>
      <span class="g-title">Alojamiento</span>
      <span class="g-count">{(pools.lodging || []).length}</span>
    </summary>
    <div class="list scroll-y">
      {@render loadStatus("lodging")}
      <button class="none" class:on={!$selected.hotel} type="button" onclick={() => setHotel(null)}>Sin alojamiento</button>
      {#each pools.lodging || [] as item (item.id)}
        <OptionCard {item} mode="single" quality selected={$selected.hotel?.id === item.id} onselect={(x) => setHotel(x)} />
      {/each}
    </div>
  </details>
</div>

<style>
  .custom-section .custom-add {margin:0 10px 8px;}
  .custom-help {margin:4px 10px;font-size:11px;line-height:1.5;color:var(--text-faint);}

  .load-state { padding: 8px; color: var(--text-soft); font-size: var(--fs-12); }
  .load-state p { margin-bottom: 6px; }
  .groups {
    display: grid;
    gap: 6px;
  }
  .group, .custom-section {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
  }
  summary {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 9px 12px;
    font-weight: 700;
    font-size: var(--fs-13);
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary::before {
    content: "▸";
    color: var(--text-faint);
    font-size: 10px;
    transition: transform var(--dur-1) var(--ease-out);
  }
  .group[open] summary::before,
  .custom-section[open] summary::before {
    transform: rotate(90deg);
  }
  .g-title {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .g-count {
    font-size: 11px;
    font-weight: 800;
    color: var(--text-faint);
    background: var(--surface-2);
    border-radius: var(--r-pill);
    padding: 1px 7px;
  }
  .win {
    font-size: 10px;
    font-weight: 700;
    color: var(--warning);
    background: var(--warning-tint);
    padding: 1px 5px;
    border-radius: var(--r-pill);
  }
  .group[open] summary,
  .custom-section[open] summary {
    border-bottom: 1px solid var(--line);
  }

  /* alta de paradas personalizadas */
  .custom-add {
    display: grid;
    gap: 5px;
    padding: 8px 0 4px;
  }
  .custom-row {
    display: flex;
    gap: 5px;
  }
  .custom-row input {
    flex: 1;
    min-width: 0;
    height: 30px;
    padding: 0 8px;
    font-size: 12px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 5px;
  }
  .mini {
    flex: none;
    height: 30px;
    padding: 0 10px;
    font-size: 11px;
    font-weight: 700;
    color: var(--accent-text);
    background: var(--accent);
    border-radius: 5px;
  }
  .mini:disabled {
    opacity: 0.5;
  }
  .mini--ghost {
    color: var(--text-soft);
    background: var(--surface-2);
    border: 1px solid var(--line);
    text-align: center;
  }
  .mini--ghost.on {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-tint);
  }
  .c-err {
    font-size: 11px;
    color: var(--danger);
  }

  /* Lista con scroll vertical: ~8 filas colapsadas visibles, el resto haciendo
     scroll. Sin enlaces de "ver más". */
  .list {
    display: grid;
    gap: 2px;
    padding: 6px;
    min-width: 0;
    max-height: 58vh;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
  }
  .empty,
  .hint {
    font-size: 11px;
    color: var(--text-faint);
    padding: 4px 6px;
    line-height: 1.5;
  }
  .none {
    text-align: left;
    padding: 8px 10px;
    font-size: 12px;
    color: var(--text-soft);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
  }
  .none.on {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent-tint) 55%, transparent);
    font-weight: 600;
  }

  /* ---- móvil: una sola categoría, sin acordeón, objetivos táctiles grandes ---- */
  .groups.mobile { gap: 0; }
  .groups.mobile > :global(details:not([open])) { display: none; }
  .groups.mobile > :global(details[open]) {
    border: 0;
    background: transparent;
    border-radius: 0;
  }
  .groups.mobile :global(summary) { display: none; }
  .groups.mobile .list {
    max-height: none;
    overflow: visible;
    padding: 0;
    gap: 6px;
  }
  .groups.mobile .load-state { padding: 6px 0 10px; }
  .groups.mobile .custom-help,
  .groups.mobile .custom-section .custom-add { margin-left: 0; margin-right: 0; }
  .groups.mobile .custom-row input { height: 44px; font-size: var(--fs-14); }
  .groups.mobile .mini,
  .groups.mobile .mini--ghost { height: 44px; font-size: var(--fs-13); }
  .groups.mobile .none { padding: 13px 12px; font-size: var(--fs-13); }
  .groups.mobile :global(.row) { padding: 11px 10px; }
  .groups.mobile :global(.face) { gap: 12px; }
  .groups.mobile :global(.name) { font-size: var(--fs-14); }
</style>
