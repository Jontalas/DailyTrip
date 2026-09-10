<script>
  import { PREFERENCE_DEFS } from "../lib/scoring.js";
  import { preferences } from "../lib/stores.js";

  function toggle(value) {
    preferences.update((set) => {
      const next = new Set(set);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  }
</script>

<div class="prefs">
  <span class="prefs__label">Qué te apetece hoy</span>
  <div class="prefs__row">
    {#each PREFERENCE_DEFS as p (p.value)}
      <label class="pref" class:pref--on={$preferences.has(p.value)}>
        <input
          type="checkbox"
          checked={$preferences.has(p.value)}
          onchange={() => toggle(p.value)}
        />
        {p.label}
      </label>
    {/each}
  </div>
</div>

<style>
  .prefs {
    display: grid;
    gap: var(--sp-2);
  }
  .prefs__label {
    font-size: var(--fs-12);
    font-weight: 700;
    color: var(--text-soft);
  }
  .prefs__row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
  .pref {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 6px 12px;
    font-size: var(--fs-12);
    font-weight: 600;
    color: var(--text-soft);
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    cursor: pointer;
    user-select: none;
    transition: background var(--dur-2) var(--ease-out), border-color var(--dur-2) var(--ease-out),
      color var(--dur-2) var(--ease-out);
  }
  .pref:hover {
    border-color: var(--line-strong);
  }
  .pref--on {
    background: var(--accent-tint);
    border-color: var(--accent);
    color: var(--accent);
  }
  .pref input {
    width: 14px;
    height: 14px;
    accent-color: var(--accent);
  }
</style>
