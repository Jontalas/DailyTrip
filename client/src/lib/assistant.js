/* Asistente conversacional (Fases 1-3.1, ver doc §46.9-§46.12).
   No calcula nada: convierte a texto el itinerario que YA ha construido
   `buildItinerary` (client/src/lib/itinerary.js) y el estado de selección/pools
   para que el servidor los pase a Gemini como único contexto. El servidor nunca
   recibe `selected`/`chosen`/`pools` en crudo: sólo este texto ya derivado, así
   el guardarraíl "la IA no decide ni inventa datos duros" (§2.4) queda igual que
   en el resto de la capa de IA (`lib/ai-curator.js`). */
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

/* ---- Fase 2: contexto de "qué se puede cambiar" (ver doc §46.10) ----------
   El servidor nunca decide un id por su cuenta: sólo puede elegir uno que
   aparezca aquí, tal cual lo lista esta función. Cualquier id que el modelo
   invente o cite mal simplemente no se encuentra al aplicar la acción (ver
   `findById` en AssistantPanel.svelte) y no tiene ningún efecto. */
function fmtOptionList(items, selectedIds) {
  if (!items?.length) return "(ninguna)";
  return items.map((x) => `id=${x.id} · ${x.name}${selectedIds?.has(x.id) ? " (seleccionada)" : ""}`).join("\n");
}

/** Estado actual + listas de opciones disponibles -> texto para el contexto
    del asistente. Topes por lista para no disparar el tamaño del prompt;
    las listas ya vienen ordenadas por interés, así que el recorte no oculta
    lo más relevante.

    `excludedPlaces` (Fase 3.1, ver doc §46.12): lugares que el usuario ha
    descartado por chat ("ya no tiene reservas", "no me interesa"…). Se QUITAN
    por completo de las listas de abajo — el modelo no puede volver a elegirlos
    ni por error, no basta con "decirle que no los proponga" — y se listan aparte
    para que un futuro borrador o una regeneración los siga respetando, sin
    depender de que el historial de la conversación llegue tan lejos. */
export function describeOptions({ pools, lunchOptions, selected, customStops, departureTime, excludedPlaces }) {
  const routeSel = new Set((selected?.route || []).map((x) => x.id));
  const actSel = new Set((selected?.activities || []).map((x) => x.id));
  const lunchSel = selected?.lunch ? new Set([selected.lunch.id]) : null;
  const dinnerSel = selected?.dinner ? new Set([selected.dinner.id]) : null;
  const hotelSel = selected?.hotel ? new Set([selected.hotel.id]) : null;
  const excluded = new Set((excludedPlaces || []).map((x) => x.id));
  const keep = (arr) => (arr || []).filter((x) => !excluded.has(x.id));

  const lines = [];
  lines.push(`Hora de salida actual: ${departureTime || "09:30"}.`);
  lines.push(
    selected?.skipLunch
      ? "Comida: el usuario ha pedido NO reservar tiempo para comer a mediodía."
      : selected?.lunch
        ? `Comida elegida: ${selected.lunch.name}.`
        : "Comida: sin restaurante elegido (se sigue reservando el bloque 12:30-14:30)."
  );
  lines.push(selected?.dinner ? `Cena elegida: ${selected.dinner.name}.` : "Cena: sin restaurante elegido (no se reserva tiempo).");
  lines.push(selected?.hotel ? `Alojamiento elegido: ${selected.hotel.name}.` : "Alojamiento: sin elegir (no se reserva tiempo).");

  lines.push("\nPARADAS EN RUTA DISPONIBLES (tools add_route_stop / remove_route_stop):");
  lines.push(fmtOptionList(keep(pools?.route).slice(0, 30), routeSel));
  lines.push("\nPARADAS PERSONALIZADAS DEL USUARIO (tools add_route_stop / remove_route_stop / remove_custom_stop):");
  lines.push(fmtOptionList(keep(customStops), routeSel));
  lines.push("\nACTIVIDADES EN DESTINO DISPONIBLES (tools add_activity / remove_activity):");
  lines.push(fmtOptionList(keep(pools?.activities).slice(0, 30), actSel));
  lines.push("\nOPCIONES DE COMIDA (tool set_lunch):");
  lines.push(fmtOptionList(keep(lunchOptions).slice(0, 20), lunchSel));
  lines.push("\nOPCIONES DE CENA (tool set_dinner):");
  lines.push(fmtOptionList(keep(pools?.food).slice(0, 20), dinnerSel));
  lines.push("\nOPCIONES DE ALOJAMIENTO (tool set_hotel):");
  lines.push(fmtOptionList(keep(pools?.lodging).slice(0, 20), hotelSel));

  lines.push("\nLUGARES EXCLUIDOS POR EL USUARIO (tool include_place para deshacerlo; ya NO aparecen arriba — no los propongas bajo ningún concepto):");
  lines.push(
    excludedPlaces?.length
      ? excludedPlaces.map((x) => `id=${x.id} · ${x.name}${x.reason ? ` — motivo: ${x.reason}` : ""}`).join("\n")
      : "(ninguno)"
  );
  return lines.join("\n");
}
