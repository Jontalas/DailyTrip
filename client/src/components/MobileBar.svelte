<script>
  /* Barra flotante inferior para móvil/tablet (≤1024 px). El mapa manda; cada
     botón abre una hoja enfocada a una sola tarea. La funcionalidad completa
     de escritorio se reparte entre estas tareas. */
  import { selected, customStops, preferences, mobileTask, openOptionGroup } from "../lib/stores.js";

  let { hasBase = false, hasPlan = false, hasSearch = false, endLabel = "" } = $props();

  const OPTION_TASKS = ["route", "custom", "lunch", "act", "dinner", "hotel"];

  function open(task) {
    mobileTask.set(task);
    openOptionGroup.set(OPTION_TASKS.includes(task) ? task : null);
  }

  let routeCount = $derived($selected.route.filter((x) => !x.custom).length);

  // Config de botones según la fase.
  let buttons = $derived.by(() => {
    if (!hasBase)
      return [{ task: "search", icon: "🔎", label: hasSearch ? "Elegir final de etapa" : "Buscar etapa", badge: "", wide: true }];
    if (!hasPlan)
      return [
        { task: "search", icon: "🗺️", label: "Etapa", badge: "" },
        { task: "prep", icon: "⏳", label: "Preparando el día…", badge: "", wide: true }
      ];
    return [
      { task: "search", icon: "🗺️", label: "Etapa", badge: "" },
      { task: "tune", icon: "⚙️", label: "Ajustes", badge: $preferences.size || "" },
      { task: "route", icon: "📍", label: "Paradas", badge: routeCount || "" },
      { task: "custom", icon: "➕", label: "Añadir", badge: $customStops.length || "" },
      { task: "lunch", icon: "🍴", label: "Comida", badge: $selected.lunch ? "✓" : "" },
      { task: "dinner", icon: "🌙", label: "Cena", badge: $selected.dinner ? "✓" : "" },
      { task: "hotel", icon: "🛏️", label: "Dormir", badge: $selected.hotel ? "✓" : "" },
      { task: "act", icon: "⭐", label: "Planes", badge: $selected.activities.length || "" },
      { task: "itin", icon: "🧭", label: endLabel || "Itinerario", badge: "" }
    ];
  });
</script>

<nav class="bar" class:bar--single={buttons.length === 1} aria-label="Acciones">
  {#each buttons as b (b.task)}
    <button
      type="button"
      class="btn"
      class:btn--wide={b.wide}
      class:on={$mobileTask === b.task}
      aria-pressed={$mobileTask === b.task}
      onclick={() => open(b.task)}
    >
      <span class="ic" aria-hidden="true">{b.icon}</span>
      <span class="lb">{b.label}</span>
      {#if b.badge !== ""}<span class="bd">{b.badge}</span>{/if}
    </button>
  {/each}
</nav>

<style>
  .bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: var(--z-overlay);
    display: flex;
    gap: 6px;
    padding: 8px 10px calc(8px + env(safe-area-inset-bottom));
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    background: linear-gradient(to top, var(--bg) 55%, transparent);
  }
  .bar::-webkit-scrollbar { display: none; }
  .bar--single { justify-content: center; }

  .btn {
    flex: 0 0 auto;
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 2px;
    min-width: 60px;
    min-height: 58px;
    padding: 6px 10px;
    border-radius: var(--r-md);
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--sh-2);
    color: var(--text-soft);
    position: relative;
  }
  .btn--wide { flex: 1 1 auto; }
  .btn.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .ic { font-size: 20px; line-height: 1; }
  .lb {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.01em;
    max-width: 88px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bd {
    position: absolute;
    top: 3px;
    right: 6px;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    border-radius: var(--r-pill);
    background: var(--accent);
    color: var(--accent-text);
    font-size: 10px;
    font-weight: 800;
    line-height: 15px;
    text-align: center;
  }
  .btn.on .bd {
    background: var(--accent-text);
    color: var(--accent);
  }
</style>
