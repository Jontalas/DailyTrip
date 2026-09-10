<script>
  import Progress from "./Progress.svelte";
  import { search } from "../lib/stores.js";

  let { onsearch } = $props();

  let origin = $state("Málaga");
  let target = $state("Almería");
  let toleranceKm = $state(40);

  function submit(e) {
    e.preventDefault();
    onsearch?.({
      origin: origin.trim(),
      target: target.trim(),
      toleranceKm: Number(toleranceKm)
    });
  }
</script>

<form class="search" onsubmit={submit}>
  <div class="field field--wide">
    <label for="f-origin">Salgo de</label>
    <input id="f-origin" bind:value={origin} required autocomplete="off" />
  </div>

  <div class="field field--wide">
    <label for="f-target">Dirección / destino orientativo</label>
    <input id="f-target" bind:value={target} required autocomplete="off" />
  </div>

  <div class="field field--wide">
    <label for="f-tol">Tolerancia</label>
    <div class="with-unit">
      <input id="f-tol" type="number" min="0" max="300" step="1" required bind:value={toleranceKm} aria-describedby="tolerance-help" />
      <span>km</span>
    </div>
  </div>

  <p id="tolerance-help" class="tolerance-help">Distancia máxima por carretera desde el destino orientativo hasta una localidad propuesta. Con 0 km, se busca únicamente ese destino.</p>

  <button class="go" type="submit" disabled={$search.busy}>
    {#if $search.busy}Buscando…{:else}Buscar finales de etapa{/if}
  </button>
</form>

<Progress steps={$search.steps} />

{#if $search.status}
  <p class="status" class:status--error={$search.error}>{$search.status}</p>
{/if}

<style>
  .tolerance-help {grid-column:1 / -1;font-size:var(--fs-12);color:var(--text-faint);line-height:1.5;}
  .search {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-3);
  }
  .field {
    display: grid;
    gap: var(--sp-1);
  }
  .field--wide {
    grid-column: 1 / -1;
  }
  label {
    font-size: var(--fs-12);
    font-weight: 600;
    color: var(--text-soft);
    letter-spacing: 0.01em;
  }
  input {
    width: 100%;
    height: 44px;
    padding: 0 var(--sp-3);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    transition: border-color var(--dur-2) var(--ease-out), box-shadow var(--dur-2) var(--ease-out);
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-ring);
  }
  .with-unit {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    height: 44px;
    padding: 0 var(--sp-3);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
  }
  .with-unit:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-ring);
  }
  .with-unit input {
    height: auto;
    border: 0;
    padding: 0;
    background: none;
  }
  .with-unit input:focus {
    box-shadow: none;
  }
  .with-unit span {
    font-size: var(--fs-12);
    color: var(--text-faint);
    font-weight: 600;
  }
  .go {
    grid-column: 1 / -1;
    height: 46px;
    margin-top: var(--sp-1);
    background: var(--accent);
    color: var(--accent-text);
    border-radius: var(--r-sm);
    font-weight: 700;
    font-size: var(--fs-14);
    letter-spacing: 0.01em;
    box-shadow: var(--sh-1);
    transition: transform var(--dur-1) var(--ease-out), background var(--dur-2) var(--ease-out),
      box-shadow var(--dur-2) var(--ease-out);
  }
  .go:hover:not(:disabled) {
    background: var(--accent-hover);
    box-shadow: var(--sh-2);
  }
  .go:active:not(:disabled) {
    transform: translateY(1px);
  }
  .go:disabled {
    opacity: 0.65;
    cursor: progress;
  }
  .status {
    margin-top: var(--sp-3);
    font-size: var(--fs-13);
    color: var(--text-soft);
  }
  .status--error {
    color: var(--danger);
  }
  @media (max-width: 520px) {
    .search {
      grid-template-columns: 1fr;
    }
  }
</style>
