// Curación por IA (Google Gemini). Rol acotado a propósito:
//   - La IA SÓLO propone NOMBRES de lugares y una nota 0-100 de interés.
//   - NUNCA se usan coordenadas, horarios ni datos "duros" que devuelva: cada
//     nombre lo geocodifica y valida el pipeline del servidor (Wikipedia /
//     Nominatim + filtro de corredor/radio). Ver doc §46.8 y §2.4.
//   - Es un proveedor ADITIVO: si la clave falta o la llamada falla, el
//     descubrimiento sigue con Wikipedia/Geoapify/OSM y el orden cae al
//     `interestScore` habitual. Nunca lanza.

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
// `*-latest` alias: no queda obsoleto y hoy es el flash más estable/rápido para
// esta tarea (listar sitios notables). Sobrescribible con GEMINI_MODEL.
const DEFAULT_MODEL = "gemini-flash-lite-latest";
const TTL = 24 * 60 * 60 * 1000;
const cache = new Map(); // hash -> { at, data }

export const AI_CATEGORIES = [
  "museum", "historic", "viewpoint", "nature", "park", "beach", "attraction", "restaurant"
];

export function aiConfigured(key = process.env.GEMINI_API_KEY) {
  return !!String(key || "").trim();
}

// Normalización de nombre para casar la nota de la IA con un item ya descubierto.
export function normName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Nota efectiva de un item: la de la IA si opinó sobre él (por nombre), si no su
// interés calculado. Ambas escalas son 0-100.
export function aiRank(item, ranking) {
  if (!ranking) return item.interestScore ?? 0;
  const s = item.aiInterest ?? ranking[normName(item.name)];
  return s != null ? Number(s) : (item.interestScore ?? 0);
}

// Reordena una lista ya enriquecida dando prioridad a la recomendación de la IA.
// Los items que la IA no menciona conservan su sitio por `interestScore` (no se
// ocultan ni se hunden arbitrariamente).
export function applyAiRanking(items, ranking) {
  if (!ranking || !Object.keys(ranking).length) return [...items];
  return items
    .map((x) => ({ ...x, aiInterest: x.aiInterest ?? ranking[normName(x.name)] ?? null }))
    .sort((a, b) => aiRank(b, ranking) - aiRank(a, ranking) || (b.interestScore ?? 0) - (a.interestScore ?? 0));
}

function buildPrompt(input) {
  const { kind, from = "", to = "", roadKm = 0, area = "", radiusKm = 0, known = [] } = input || {};
  const lines = [];
  lines.push("Eres un guía de viajes experto en España y Europa.");
  if (kind === "route") {
    lines.push(
      `Un viajero hace una ruta por carretera de ${from || "el origen"} a ${to || "el destino"}` +
      (roadKm ? ` (~${roadKm} km).` : ".")
    );
    lines.push(
      "Enumera los lugares MÁS interesantes para una parada breve (30-90 min) situados EN EL " +
      "CORREDOR de esa ruta (como mucho ~10 km de la carretera): monumentos, cascos históricos, " +
      "miradores, parajes naturales, cuevas, museos, jardines. NO incluyas la localidad de " +
      "origen ni la de destino, ni pueblos sin un atractivo concreto."
    );
  } else {
    lines.push(
      `Un viajero pasa un día en ${area || "el destino"}` +
      (radiusKm ? ` y sus alrededores (~${radiusKm} km).` : ".")
    );
    lines.push(
      "Enumera las mejores cosas que ver o hacer allí para una visita de un día: monumentos, " +
      "museos, miradores, parques, playas, cascos históricos y atractivos naturales. No incluyas " +
      "la localidad en sí como \"lugar\", ni servicios genéricos."
    );
  }
  lines.push(
    "Para cada lugar da: name (nombre exacto y reconocible, en español), locality (municipio), " +
    `category (uno de: ${AI_CATEGORIES.join(", ")}), interest (0-100: cuánto merece la visita para ` +
    "un viajero medio), reason (una sola frase). Ordena de mayor a menor interest. Entre 8 y 20 lugares."
  );
  if (known && known.length) {
    lines.push(
      "Incluye además en la respuesta, con su interest y category, estos lugares ya detectados " +
      `(usa su nombre tal cual): ${known.slice(0, 40).join("; ")}.`
    );
  }
  return lines.join("\n");
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    places: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          locality: { type: "string" },
          category: { type: "string", enum: AI_CATEGORIES },
          interest: { type: "integer" },
          reason: { type: "string" }
        },
        required: ["name", "interest"]
      }
    }
  },
  required: ["places"]
};

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(36);
}

const TRANSIENT = /high demand|overloaded|try again|temporarily|rate limit|quota/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGeminiOnce(fetchImpl, key, model, prompt, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetchImpl(
      `${ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA
          }
        })
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `Gemini HTTP ${res.status}`;
      const err = new Error(msg);
      err.transient = res.status === 429 || res.status >= 500 || TRANSIENT.test(msg);
      throw err;
    }
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    if (!text) throw new Error("Gemini sin contenido");
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

// Los modelos flash sufren picos de "high demand" transitorios: un reintento
// corto los absorbe sin colgar el descubrimiento (que ya es no bloqueante).
async function callGemini(fetchImpl, key, model, prompt, timeout) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await callGeminiOnce(fetchImpl, key, model, prompt, timeout);
    } catch (e) {
      last = e;
      const retryable = e.transient || e.name === "AbortError";
      if (attempt === 0 && retryable) { await sleep(1200); continue; }
      throw e;
    }
  }
  throw last;
}

function normalizeResult(raw) {
  const places = Array.isArray(raw?.places) ? raw.places : [];
  const suggestions = [];
  const ranking = {};
  const reasons = {};
  for (const p of places) {
    const name = String(p?.name || "").trim();
    if (!name) continue;
    const interest = Math.max(0, Math.min(100, Math.round(Number(p?.interest))));
    if (!Number.isFinite(interest)) continue;
    const category = AI_CATEGORIES.includes(p?.category) ? p.category : "attraction";
    const reason = String(p?.reason || "").trim();
    suggestions.push({ name, locality: String(p?.locality || "").trim(), category, interest, reason });
    const key = normName(name);
    if (ranking[key] == null || interest > ranking[key]) ranking[key] = interest;
    if (reason && !reasons[key]) reasons[key] = reason;
  }
  return { suggestions, ranking, reasons, source: "gemini" };
}

/**
 * @param {{kind:"route"|"activities", from?:string, to?:string, roadKm?:number,
 *          area?:string, radiusKm?:number, known?:string[]}} input
 * @param {{key?:string, model?:string, fetch?:Function, timeout?:number}} [opts]
 * @returns {Promise<{suggestions:Array, ranking:Object, source:string, error?:string}>}
 */
export async function aiCuratePlaces(input, opts = {}) {
  const key = String(opts.key ?? process.env.GEMINI_API_KEY ?? "").trim();
  if (!key) return { suggestions: [], ranking: {}, reasons: {}, source: "off" };
  const model = String(opts.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return { suggestions: [], ranking: {}, reasons: {}, source: "off" };

  const prompt = buildPrompt(input);
  const cacheKey = hash(`${model}\n${prompt}`);
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  try {
    const parsed = normalizeResult(await callGemini(fetchImpl, key, model, prompt, opts.timeout ?? 10000));
    cache.set(cacheKey, { at: Date.now(), data: parsed });
    return parsed;
  } catch (e) {
    return { suggestions: [], ranking: {}, reasons: {}, source: "error", error: e?.message || String(e) };
  }
}
