<script>
  /* Asistente conversacional de sólo lectura sobre el itinerario (Fase 1, ver
     doc §46.9). Sólo responde preguntas usando el plan ya calculado
     (`describePlan`/`describeWarnings`); nunca modifica `selected`, `chosen`
     ni ningún store. Vive dentro de ItineraryPanel para heredar gratis su
     colocación en escritorio (rail derecho) y en móvil (hoja "itin"). */
  import { tick } from "svelte";
  import { assistantMessages, assistantBusy } from "../lib/stores.js";
  import { describePlan, describeWarnings } from "../lib/assistant.js";
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

  async function send() {
    const q = text.trim();
    if (!q || $assistantBusy) return;
    error = "";
    const history = $assistantMessages.slice(-8).map(({ role, text }) => ({ role, text }));
    assistantMessages.update((m) => [...m, { role: "user", text: q }]);
    text = "";
    assistantBusy.set(true);
    try {
      const context = { planText: describePlan(result), warningsText: describeWarnings(result) };
      const r = await api.assistantAsk({ question: q, context, history });
      if (r.answer) assistantMessages.update((m) => [...m, { role: "assistant", text: r.answer }]);
      else error = r.error || "No se pudo obtener respuesta.";
    } catch (e) {
      error = e.message || "No se pudo consultar a la IA.";
    } finally {
      assistantBusy.set(false);
    }
  }
</script>

<div class="assistant">
  <button type="button" class="assistant__toggle" onclick={() => (open = !open)} aria-expanded={open}>
    <span>💬 Preguntar sobre este plan</span>
    <span class="assistant__chev" class:on={open}>▸</span>
  </button>
  {#if open}
    <div class="assistant__body">
      <p class="assistant__hint">
        Pregunta por horarios, duraciones o el orden del día. Responde sólo con los datos de este
        itinerario: no busca en internet ni inventa precios u horarios de apertura.
      </p>
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
          placeholder="¿A qué hora llego a…?"
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
  .assistant__toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    font-size: var(--fs-13);
    font-weight: 700;
    color: var(--text);
  }
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
