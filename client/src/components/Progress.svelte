<script>
  // Pasos de una operación larga (§30): pendiente / trabajando / terminado / error.
  // Nada de barra porcentual falsa.
  let { steps = [] } = $props();

  const glyph = { pending: "○", working: "◐", done: "✓", error: "!" };
</script>

{#if steps.length}
  <ul class="progress" aria-live="polite">
    {#each steps as s (s.label)}
      <li class="step step--{s.state}">
        <span class="glyph" aria-hidden="true">{glyph[s.state] || "○"}</span>
        <span class="label">{s.label}</span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .progress {
    list-style: none;
    margin: var(--sp-3) 0 0;
    padding: var(--sp-3);
    display: grid;
    gap: var(--sp-1);
    background: var(--surface-sunk);
    border-radius: var(--r-md);
    font-size: var(--fs-13);
  }
  .step {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    color: var(--text-faint);
    transition: color var(--dur-2) var(--ease-out);
  }
  .glyph {
    width: 1.1em;
    text-align: center;
    font-weight: 700;
  }
  .step--working {
    color: var(--text);
  }
  .step--working .glyph {
    animation: spin 1s linear infinite;
    color: var(--accent);
  }
  .step--done {
    color: var(--positive);
  }
  .step--error {
    color: var(--danger);
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
