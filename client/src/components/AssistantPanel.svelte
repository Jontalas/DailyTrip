<script>
  /* Asistente conversacional (Fase 1 preguntas + Fase 2 acciones, ver doc
     §46.9/§46.10). Responde usando el plan ya calculado (`describePlan`/
     `describeWarnings`) y puede aplicar cambios que el modelo pida mediante
     "tools" — pero SIEMPRE resolviendo el id contra las listas reales
     (`describeOptions`) y ejecutando la MISMA función que usan los botones
     de la UI (`setLunch`, `toggleRouteStop`, etc.). El texto que confirma un
     cambio lo construye este componente a partir de lo que realmente se ha
     hecho, nunca la afirmación del modelo. Vive dentro de ItineraryPanel para
     heredar gratis su colocación en escritorio (rail derecho) y en móvil
     (hoja "itin"). */
  import { tick } from "svelte";
  import {
    assistantMessages, assistantBusy,
    pools, selected, customStops, lunchOptions, departureTime, chosen, routeData, activeRoute,
    toggleRouteStop, toggleActivity, setLunch, setDinner, setHotel, setSkipLunch,
    removeCustomStop, addCustomStopEnriched, setCustomMeal,
    excludedPlaces, excludePlace, includePlace
  } from "../lib/stores.js";
  import { describePlan, describeWarnings, describeOptions } from "../lib/assistant.js";
  import { api } from "../lib/api.js";

  let { result = { events: [], warnings: [] } } = $props();

  let open = $state(false);
  let text = $state("");
  let error = $state("");
  let logEl = $state();

  $effect(() => {
    $assistantMessages;
    $assistantBusy;
    if (!open) return;
    tick().then(() => { if (logEl) logEl.scrollTop = logEl.scrollHeight; });
  });

  function findById(id, ...lists) {
    for (const list of lists) {
      const found = (list || []).find((x) => x.id === id);
      if (found) return found;
    }
    return null;
  }

  // Caja de la ruta activa, para sesgar (no restringir) la geocodificación de
  // `add_place` cuando kind==="route" — mismo patrón que `routeBox()` en
  // OptionsPanel.svelte.
  function routeBox() {
    const c = ($activeRoute || $routeData)?.coords;
    if (!c?.length) return $chosen ? { lat: $chosen.lat, lon: $chosen.lon } : null;
    let minLat = 90, minLon = 180, maxLat = -90, maxLon = -180;
    for (const p of c) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
    return { minLat, minLon, maxLat, maxLon };
  }

  const MEAL_LABEL = { lunch: "Comida", dinner: "Cena", hotel: "Alojamiento" };

  // Ejecuta UNA acción propuesta por el modelo. Nunca confía en nada del
  // modelo salvo un id/nombre a buscar: cualquier id que no exista en las
  // listas reales simplemente no tiene efecto (se avisa, no se adivina).
  async function runAction(action) {
    const tool = action?.tool;
    const args = action?.args || {};
    switch (tool) {
      case "set_lunch": {
        const item = findById(args.id, $lunchOptions);
        if (!item) return "No encontré esa opción de comida entre las disponibles.";
        setLunch(item);
        return `Comida → ${item.name}.`;
      }
      case "clear_lunch":
        setLunch(null);
        return "Sin restaurante para comer (se sigue reservando el bloque 12:30-14:30).";
      case "skip_lunch":
        setSkipLunch(true);
        return "Hecho: no se reservará tiempo para comer.";
      case "set_dinner": {
        const item = findById(args.id, $pools.food);
        if (!item) return "No encontré esa opción de cena entre las disponibles.";
        setDinner(item);
        return `Cena → ${item.name}.`;
      }
      case "clear_dinner":
        setDinner(null);
        return "Sin cena.";
      case "set_hotel": {
        const item = findById(args.id, $pools.lodging);
        if (!item) return "No encontré esa opción de alojamiento entre las disponibles.";
        setHotel(item);
        return `Alojamiento → ${item.name}.`;
      }
      case "clear_hotel":
        setHotel(null);
        return "Sin alojamiento.";
      case "add_route_stop": {
        const item = findById(args.id, $pools.route, $customStops);
        if (!item) return "No encontré esa parada entre las disponibles.";
        if ($selected.route.some((x) => x.id === item.id)) return `${item.name} ya estaba entre las paradas.`;
        toggleRouteStop(item);
        return `Añadida la parada: ${item.name}.`;
      }
      case "remove_route_stop": {
        const item = findById(args.id, $pools.route, $customStops);
        if (!item) return "No encontré esa parada entre las disponibles.";
        if (!$selected.route.some((x) => x.id === item.id)) return `${item.name} no estaba entre las paradas elegidas.`;
        toggleRouteStop(item);
        return `Quitada la parada: ${item.name}.`;
      }
      case "add_activity": {
        const item = findById(args.id, $pools.activities);
        if (!item) return "No encontré esa actividad entre las disponibles.";
        if ($selected.activities.some((x) => x.id === item.id)) return `${item.name} ya estaba entre las actividades.`;
        toggleActivity(item);
        return `Añadida la actividad: ${item.name}.`;
      }
      case "remove_activity": {
        const item = findById(args.id, $pools.activities);
        if (!item) return "No encontré esa actividad entre las disponibles.";
        if (!$selected.activities.some((x) => x.id === item.id)) return `${item.name} no estaba entre las actividades elegidas.`;
        toggleActivity(item);
        return `Quitada la actividad: ${item.name}.`;
      }
      case "remove_custom_stop": {
        const item = findById(args.id, $customStops);
        if (!item) return "No encontré esa parada personalizada.";
        removeCustomStop(item.id);
        return `Eliminada la parada: ${item.name}.`;
      }
      case "set_departure_time": {
        const m = String(args.time || "").match(/^([0-2]?\d):([0-5]\d)$/);
        if (!m) return `No entendí la hora «${args.time}».`;
        const hh = Math.min(23, parseInt(m[1], 10));
        const val = `${String(hh).padStart(2, "0")}:${m[2]}`;
        departureTime.set(val);
        return `Hora de salida → ${val}.`;
      }
      case "add_place": {
        const kind = ["route", "lunch", "dinner", "hotel"].includes(args.kind) ? args.kind : "route";
        const q = String(args.query || "").trim();
        if (!q) return "No indicó qué lugar añadir.";
        try {
          const near = kind === "route" ? routeBox() : ($chosen ? { lat: $chosen.lat, lon: $chosen.lon } : null);
          const g = await api.geocode({ q, place: true, near });
          if (!g || !Number.isFinite(g.lat)) return `No encontré «${q}».`;
          if (kind === "route") {
            addCustomStopEnriched(
              { id: `custom:${g.lat.toFixed(5)},${g.lon.toFixed(5)}`, name: q || g.name, lat: g.lat, lon: g.lon },
              $activeRoute || $routeData
            );
            return `Añadida parada: ${q}.`;
          }
          setCustomMeal(kind, { name: q || g.name, lat: g.lat, lon: g.lon });
          return `${MEAL_LABEL[kind]} → ${q}.`;
        } catch {
          return `No pude añadir «${q}».`;
        }
      }
      case "exclude_place": {
        const item = findById(args.id, $pools.route, $pools.activities, $pools.food, $pools.lodging, $lunchOptions, $customStops);
        if (!item) return "No encontré ese lugar entre las opciones.";
        if ($selected.route.some((x) => x.id === item.id)) toggleRouteStop(item);
        if ($selected.activities.some((x) => x.id === item.id)) toggleActivity(item);
        if ($selected.lunch?.id === item.id) setLunch(null);
        if ($selected.dinner?.id === item.id) setDinner(null);
        if ($selected.hotel?.id === item.id) setHotel(null);
        excludePlace(item.id, item.name, args.reason);
        return `Excluido: ${item.name}${args.reason ? ` (${args.reason})` : ""}. No se volverá a proponer.`;
      }
      case "include_place": {
        const place = $excludedPlaces.find((x) => x.id === args.id);
        if (!place) return "Ese lugar no estaba excluido.";
        includePlace(args.id);
        return `${place.name} vuelve a estar disponible.`;
      }
      default:
        return null;
    }
  }

  // Fase 3 (borrador automático, ver doc §46.11): pide una selección completa del
  // día por el MISMO mecanismo de la Fase 2 (function calling), sin ruta de código
  // nueva. El criterio de exigencia (evitar lo turístico/genérico, priorizar lo
  // excepcional, no seleccionarlo todo) vive en `SYSTEM_INSTRUCTIONS` de
  // `lib/assistant.js`, inspirado en doc/guidepromt.txt.
  const DRAFT_PROMPT =
    "Genera un primer borrador completo y exigente para todo el día: elige las mejores paradas " +
    "en ruta, dónde comer, qué actividades hacer, dónde cenar y dónde alojarse, completando lo " +
    "que ya tenga elegido sin quitarlo. Prioriza calidad sobre cantidad.";

  function generateDraft() {
    open = true;
    send(DRAFT_PROMPT);
  }

  async function send(forcedQuestion) {
    const q = (forcedQuestion ?? text).trim();
    if (!q || $assistantBusy) return;
    error = "";
    const history = $assistantMessages.slice(-8).map(({ role, text }) => ({ role, text }));
    assistantMessages.update((m) => [...m, { role: "user", text: q }]);
    if (forcedQuestion == null) text = "";
    assistantBusy.set(true);
    try {
      const context = {
        planText: describePlan(result),
        warningsText: describeWarnings(result),
        optionsText: describeOptions({
          pools: $pools, lunchOptions: $lunchOptions, selected: $selected,
          customStops: $customStops, departureTime: $departureTime, excludedPlaces: $excludedPlaces
        })
      };
      const r = await api.assistantAsk({ question: q, context, history });
      const lines = [];
      for (const action of r.actions || []) {
        const line = await runAction(action);
        if (line) lines.push(line);
      }
      const reply = [r.answer, ...lines].filter(Boolean).join("\n");
      if (reply) assistantMessages.update((m) => [...m, { role: "assistant", text: reply }]);
      else error = r.error || "No entendí bien la petición. ¿Puedes reformularla?";
    } catch (e) {
      error = e.message || "No se pudo consultar a la IA.";
    } finally {
      assistantBusy.set(false);
    }
  }
</script>

<div class="assistant">
  <div class="assistant__bar">
    <button type="button" class="assistant__toggle" onclick={() => (open = !open)} aria-expanded={open}>
      <span>💬 Preguntar sobre este plan</span>
      <span class="assistant__chev" class:on={open}>▸</span>
    </button>
    <button type="button" class="assistant__draftbtn" onclick={generateDraft} disabled={$assistantBusy}>
      ✨ Generar un borrador
    </button>
  </div>
  {#if open}
    <div class="assistant__body">
      <p class="assistant__hint">
        Pregunta por horarios, duraciones o el orden del día, o pide cambios: "cambia la cena a…",
        "quita el museo y añade…", "sal a las 8". Si algo ya no vale (cerrado, sin reservas, no te
        convence), dilo así — "la Cueva de Nerja no tiene ya reservas, descártala" — y no se
        volverá a proponer, ni en un borrador nuevo. "✨ Generar un borrador" elige de golpe
        paradas, comida, cena, alojamiento y actividades, siendo exigente (evita lo
        turístico/genérico) y sin quitar lo que ya tengas puesto. Los cambios se aplican al
        momento (se pueden deshacer igual que cualquier selección, desde las listas o el mapa).
        No busca en internet ni inventa precios u horarios de apertura.
      </p>
      {#if $excludedPlaces.length}
        <div class="assistant__excluded">
          <span class="assistant__excluded-label">Descartados (no se proponen):</span>
          {#each $excludedPlaces as p (p.id)}
            <button
              type="button"
              class="chip"
              onclick={() => includePlace(p.id)}
              title={p.reason ? `Motivo: ${p.reason}. Pulsa para recuperarlo.` : "Pulsa para recuperarlo"}
            >
              {p.name} ✕
            </button>
          {/each}
        </div>
      {/if}
      {#if $assistantMessages.length}
        <div class="assistant__log scroll-y" bind:this={logEl}>
          {#each $assistantMessages as m, i (i)}
            <p class="msg" class:msg--user={m.role === "user"}>{m.text}</p>
          {/each}
          {#if $assistantBusy}<p class="msg msg--busy">Pensando…</p>{/if}
        </div>
      {/if}
      {#if error}<p class="assistant__err">{error}</p>{/if}
      <form class="assistant__row" onsubmit={(e) => { e.preventDefault(); send(); }}>
        <input
          type="text"
          placeholder="Pregunta o pide un cambio…"
          bind:value={text}
          disabled={$assistantBusy}
          aria-label="Pregunta sobre el itinerario"
        />
        <button type="submit" disabled={$assistantBusy || !text.trim()}>
          {$assistantBusy ? "…" : "Preguntar"}
        </button>
      </form>
    </div>
  {/if}
</div>

<style>
  .assistant {
    margin-top: var(--sp-3);
    border-top: 1px solid var(--line);
    padding-top: var(--sp-3);
  }
  .assistant__bar {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .assistant__toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: 1;
    min-width: 0;
    font-size: var(--fs-13);
    font-weight: 700;
    color: var(--text);
  }
  .assistant__draftbtn {
    flex: none;
    padding: 6px 10px;
    font-size: 11px;
    font-weight: 700;
    color: var(--accent-text);
    background: var(--accent);
    border-radius: var(--r-pill);
    white-space: nowrap;
  }
  .assistant__draftbtn:disabled { opacity: 0.5; }
  .assistant__excluded {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    font-size: 11px;
  }
  .assistant__excluded-label { color: var(--text-faint); }
  .assistant__excluded .chip {
    padding: 3px 8px;
    font-size: 11px;
    color: var(--text-soft);
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
  }
  .assistant__excluded .chip:hover { color: var(--danger); border-color: var(--danger); }
  .assistant__chev {
    color: var(--text-faint);
    font-size: 10px;
    transition: transform var(--dur-1) var(--ease-out);
  }
  .assistant__chev.on { transform: rotate(90deg); }
  .assistant__body {
    margin-top: var(--sp-2);
    display: grid;
    gap: var(--sp-2);
  }
  .assistant__hint {
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-faint);
  }
  .assistant__log {
    display: grid;
    gap: 6px;
    max-height: 220px;
    overflow-y: auto;
    padding-right: 2px;
  }
  .msg {
    justify-self: start;
    max-width: 92%;
    padding: 6px 10px;
    font-size: 12px;
    line-height: 1.45;
    border-radius: var(--r-sm);
    background: var(--surface-2);
    color: var(--text);
  }
  .msg--user {
    justify-self: end;
    background: var(--accent-tint);
    color: var(--text);
  }
  .msg--busy { color: var(--text-faint); font-style: italic; }
  .assistant__err {
    font-size: 11px;
    color: var(--danger);
  }
  .assistant__row {
    display: flex;
    gap: 6px;
  }
  .assistant__row input {
    flex: 1;
    min-width: 0;
    height: 34px;
    padding: 0 10px;
    font-size: 12px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r-xs);
  }
  .assistant__row button {
    flex: none;
    height: 34px;
    padding: 0 12px;
    font-size: 12px;
    font-weight: 700;
    color: var(--accent-text);
    background: var(--accent);
    border-radius: var(--r-xs);
  }
  .assistant__row button:disabled { opacity: 0.5; }
</style>
