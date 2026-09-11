/* Asistente conversacional de sólo lectura (Fase 1, ver doc §46.9).
   No calcula nada: convierte a texto el itinerario que YA ha construido
   `buildItinerary` (client/src/lib/itinerary.js) para que el servidor lo pase
   a Gemini como único contexto. El servidor nunca recibe `selected`/`chosen`
   en crudo: sólo este texto ya formateado, así el guardarraíl "la IA no
   decide ni inventa datos duros" (§2.4) queda igual que en el resto de la
   capa de IA (`lib/ai-curator.js`). */
import { fromMin } from "./format.js";

/** Itinerario ya calculado -> texto legible línea a línea. */
export function describePlan(result) {
  const events = result?.events || [];
  if (!events.length) return "";
  const lines = [];
  if (result.roadKm != null) lines.push(`Ruta del día: ${Math.round(result.roadKm)} km · ${Math.round(result.driveMin || 0)} min de conducción en total.`);
  for (const e of events) {
    const time = fromMin(e.time);
    if (e.phase === "travel") {
      lines.push(`${time} — Desplazamiento: ${e.name} (${Math.round(e.durationMin || 0)} min)`);
    } else {
      const mins = e.mins != null ? ` (${Math.round(e.mins)} min)` : "";
      lines.push(`${time} — ${e.label}: ${e.name}${mins}`);
    }
  }
  if (result.endTime != null) lines.push(`Fin aproximado del día: ${fromMin(result.endTime)}.`);
  return lines.join("\n");
}

/** Avisos del plan -> texto para el contexto. */
export function describeWarnings(result) {
  return (result?.warnings || []).join("\n");
}
