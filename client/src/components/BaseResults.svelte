<script>
  import { fmt } from "../lib/format.js";

  let { results = [], disclaimer = "", targetName = "destino orientativo", chosenId = null, onchoose } = $props();
</script>

{#if disclaimer}
  <p class="disclaimer">{disclaimer}</p>
{/if}

<ul class="bases">
  {#each results as b, i (b.name + b.roadKm)}
    {@const summary = b.baseSummary || {}}
    <li>
      <article class="base" class:base--chosen={chosenId === (b.id ?? b.name)}>
        <div class="rank">{i + 1}</div>
        <div class="body">
          <header>
            <h3>{b.name}</h3>
            <span class="interest">
              {b.baseInterest != null ? `${b.baseInterest}` : "N/D"}<small>/100 interés</small>
            </span>
          </header>

          <p class="line tnum"><strong>{b.roadKm} km desde el origen</strong> · {fmt(b.durationMin)}</p>

          <div class="chips">
            <span class="chip chip--ok">Dentro de la tolerancia ✓</span>
            <span class="chip">
              {b.distanceToTargetKm ?? 0} km de {targetName}
            </span>
          </div>

          <p class="counts">
            {#if summary.activities != null}
              {summary.activities} actividades · {summary.food} para comer · {summary.lodging} alojamientos
            {:else}
              Contenido turístico no disponible durante esta búsqueda
            {/if}
          </p>

          <button class="pick" type="button" onclick={() => onchoose?.(b)}>
            {chosenId === (b.id ?? b.name) ? "Base elegida" : "Elegir esta base"}
          </button>
        </div>
      </article>
    </li>
  {/each}
</ul>

<style>
  .disclaimer {
    margin: 0 0 var(--sp-3);
    font-size: var(--fs-12);
    line-height: var(--lh-snug);
    color: var(--text-faint);
  }
  .bases {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--sp-3);
  }
  .base {
    display: grid;
    grid-template-columns: 40px 1fr;
    gap: var(--sp-3);
    padding: var(--sp-4);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    transition: border-color var(--dur-2) var(--ease-out), box-shadow var(--dur-2) var(--ease-out),
      transform var(--dur-2) var(--ease-out);
  }
  .base:hover {
    border-color: var(--line-strong);
    box-shadow: var(--sh-2);
  }
  .base--chosen {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-ring);
  }
  .rank {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--accent-tint);
    color: var(--accent);
    font-weight: 800;
    font-size: var(--fs-15);
  }
  .body {
    min-width: 0;
    display: grid;
    gap: var(--sp-2);
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-2);
  }
  h3 {
    font-size: var(--fs-16);
    font-weight: 750;
  }
  .interest {
    font-weight: 800;
    font-size: var(--fs-15);
    color: var(--accent);
    white-space: nowrap;
  }
  .interest small {
    font-weight: 500;
    font-size: var(--fs-11);
    color: var(--text-faint);
  }
  .line {
    font-size: var(--fs-13);
    color: var(--text-soft);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
  .chip {
    font-size: var(--fs-11);
    padding: 3px 8px;
    border-radius: var(--r-pill);
    border: 1px solid var(--line);
    color: var(--text-faint);
  }

  .chip--ok {
    color: var(--positive);
    border-color: color-mix(in srgb, var(--positive) 40%, transparent);
    background: var(--positive-tint);
  }
  .counts {
    font-size: var(--fs-12);
    color: var(--text-faint);
  }
  .pick {
    justify-self: start;
    margin-top: var(--sp-1);
    padding: 8px 16px;
    border: 1px solid var(--accent);
    color: var(--accent);
    border-radius: var(--r-sm);
    font-weight: 700;
    font-size: var(--fs-13);
    transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
  }
  .pick:hover {
    background: var(--accent);
    color: var(--accent-text);
  }
</style>
