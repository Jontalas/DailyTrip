<script>
  import { fly } from "svelte/transition";
  import TimelineRow from "./TimelineRow.svelte";
  import { departureTime } from "../lib/stores.js";
  import { fromMin } from "../lib/format.js";
  import { dur } from "../lib/motion.js";

  let { result = { events: [], endTime: 0, warnings: [] }, hasPlan = false, onretry, onsave, mapsExport = null } = $props();

  function downloadPlan() {
    const lines=['Itinerario del día',...result.events.map(e=>`${fromMin(e.time)} · ${e.label}: ${e.name}${e.phase==='travel' ? ` (${e.durationMin} min${e.journeyDurationMin!=null?`; ${e.journeyDurationMin} min de conducción en total, pausa aparte`:''})` : e.mins ? ` (${e.mins} min)` : ''}`),'',...(result.warnings || [])];
    const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='mi-itinerario.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  let endLabel = $derived(result.endTime ? fromMin(result.endTime) : null);
</script>

<section class="itin">
  <header class="itin__head">
    <div>
      <h3>Itinerario del día</h3>
      {#if hasPlan && endLabel}
        <p class="sub tnum">Termina ~{endLabel}</p>
      {/if}
    </div>
    <label class="dep">
      <span>Salida</span>
      <input type="time" bind:value={$departureTime} />
    </label>
  </header>

  <div class="itin__body scroll-y">
    {#if hasPlan}
      <div class="route-summary" aria-live="polite">
        {#if result.routingBusy}<p>Calculando recorrido y orden de las visitas…</p>
        {:else if result.routingError}<p>{result.routingError}</p>
        {:else if result.roadKm != null}<p><b>{Math.round(result.roadKm)} km · {result.driveMin} min</b> de conducción en el día{result.routingEstimated ? ' (estimados)' : ''}</p>{/if}
        <small>Ruta en coche. Las visitas pueden requerir acceso a pie. Tiempos sin tráfico en directo.</small>
        <div class="route-actions">
          {#if !result.routingBusy && (result.routingError || result.routingEstimated)}<button type="button" onclick={onretry}>Reintentar ruta</button>{/if}
          <button type="button" onclick={downloadPlan}>Descargar itinerario</button>
          {#if onsave}<button type="button" onclick={onsave}>Guardar viaje</button>{/if}
          {#if mapsExport?.url}
            <a class="gmaps" href={mapsExport.url} target="_blank" rel="noopener">Abrir en Google Maps ↗</a>
          {/if}
        </div>
        {#if mapsExport?.truncated}
          <small class="gmaps-note">Google Maps admite 9 paradas intermedias: se han incluido las 9 primeras del itinerario (de {mapsExport.total}).</small>
        {/if}
      </div>
    {/if}
    {#if !hasPlan}
      <p class="placeholder">
        Elige una base y carga las opciones del día. El itinerario se recalcula solo con cada cambio.
      </p>
    {:else if result.events.length}
      <div class="timeline" role="list" aria-label="Eventos del itinerario">
        {#each result.events as e, i (e.label + ":" + e.time + ":" + i)}
          <div role="presentation" in:fly={{ y: 8, duration: dur(180) }}>
            <TimelineRow event={e} />
          </div>
        {/each}
      </div>
    {:else}
      <p class="placeholder">Sin eventos todavía.</p>
    {/if}

    {#if result.warnings?.length}
      <div class="warnings">
        {#each result.warnings as w}
          <p class="warn">{w}</p>
        {/each}
      </div>
    {/if}
  </div>
</section>

<style>
  .route-summary {padding:10px; margin-bottom:12px; background:var(--surface-sunk);border:1px solid var(--line);border-radius:var(--r-sm);font-size:12px;}
  .route-summary small {display:block;color:var(--text-faint);margin-top:4px;line-height:1.5;}
  .route-actions {display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;align-items:center;}
  .route-actions button,
  .route-actions .gmaps {font-size:11px;color:var(--accent);text-decoration:underline;}
  .route-actions .gmaps {font-weight:700;}
  .gmaps-note {display:block;margin-top:6px;color:var(--text-faint);line-height:1.5;}
  .itin {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: auto;
    max-height: 100%;
  }
  .itin__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--sp-3);
    padding-bottom: var(--sp-3);
    border-bottom: 1px solid var(--line);
  }
  h3 {
    font-size: var(--fs-16);
    font-weight: 750;
  }
  .sub {
    font-size: var(--fs-12);
    color: var(--text-faint);
    margin-top: 2px;
  }
  .dep {
    display: grid;
    gap: 3px;
    font-size: var(--fs-11);
    font-weight: 700;
    color: var(--text-soft);
    text-align: right;
  }
  .dep input {
    height: 34px;
    padding: 0 var(--sp-2);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-xs);
  }
  .itin__body {
    flex: 0 1 auto;
    min-height: 0;
    padding-top: var(--sp-3);
  }
  .placeholder {
    font-size: var(--fs-13);
    color: var(--text-faint);
    line-height: var(--lh-body);
  }
  .timeline {
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    overflow: hidden;
    background: var(--surface);
  }
  .warnings {
    margin-top: var(--sp-3);
    display: grid;
    gap: var(--sp-2);
  }
  .warn {
    font-size: var(--fs-12);
    line-height: var(--lh-snug);
    padding: var(--sp-2) var(--sp-3);
    border-radius: var(--r-sm);
    background: var(--warning-tint);
    color: var(--warning);
  }
</style>
