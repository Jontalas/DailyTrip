/* Respeto de prefers-reduced-motion para las transiciones de Svelte.
   Envolver toda `duration` de transición con dur(). */

const mq =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

export function reducedMotion() {
  return !!mq?.matches;
}

/** Devuelve 0 si el usuario pide menos movimiento; si no, ms. */
export function dur(ms) {
  return reducedMotion() ? 0 : ms;
}
