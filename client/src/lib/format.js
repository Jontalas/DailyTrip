/* Utilidades de tiempo y geometría.
   Portadas VERBATIM desde public/app.js (v1.1.5) — mismos factores y redondeos.
   No cambiar constantes sin registrarlo en el handoff. */

export function toMin(v) {
  const [h, m] = String(v).split(":").map(Number);
  return h * 60 + m;
}

export function fromMin(v) {
  const x = ((Math.round(v) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
}

/** Duración legible: "2 h 15 min" / "45 min" */
export function fmt(m) {
  const h = Math.floor(m / 60);
  const x = Math.round(m % 60);
  return h ? `${h} h ${x} min` : `${x} min`;
}

export function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Estimación local coche entre dos puntos del destino.
    Cliente: factor 1.22, 28 km/h, mínimo 5 min (distinto del fallback del
    endpoint /api/travel/sequence, que usa 1.25 / 35 km/h). */
export function approxLocalTravelMin(a, b) {
  if (!a || !b) return 0;
  const km = haversineKm(a, b) * 1.22;
  return Math.max(5, Math.round((km / 28) * 60));
}

/** Escala de color para coste de desvío (min extra) -> token de dato. */
export function detourLevel(extraMin) {
  if (extraMin == null) return "unknown";
  if (extraMin <= 12) return "good";
  if (extraMin <= 30) return "mid";
  return "high";
}
