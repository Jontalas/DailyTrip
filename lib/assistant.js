// Asistente conversacional de SOLO LECTURA sobre el itinerario ya calculado
// (Google Gemini). Fase 1 del asistente conversacional (ver doc §46.9):
//   - Responde preguntas sobre el plan que YA ha construido el motor de
//     itinerario del cliente (horarios, duraciones, avisos, orden de visitas).
//   - NUNCA decide ni modifica nada: no hay tools, no toca `selected` ni ningún
//     store. Es aditivo, igual que `lib/ai-curator.js`.
//   - Guardarraíl igual que el resto de la capa de IA (§2.4): sólo puede usar
//     los datos de itinerario que se le pasan en el prompt; se le instruye
//     explícitamente a no inventar horarios/precios/lugares que no aparezcan
//     ahí, y a decir "no lo sé con estos datos" cuando corresponda.

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-flash-lite-latest";

export function assistantConfigured(key = process.env.GEMINI_API_KEY) {
  return !!String(key || "").trim();
}

const SYSTEM_INSTRUCTIONS = `Eres el asistente de un planificador de rutas de viaje por carretera.
Se te da el ITINERARIO YA CALCULADO de un día concreto: horas, paradas, duraciones y avisos.
Responde SOLO preguntas sobre ese itinerario (horarios, duración de trayectos, orden de las
visitas, tiempo libre, avisos, kilómetros).
Usa EXCLUSIVAMENTE los datos del itinerario que se te dan abajo. No inventes horarios de
apertura, precios, valoraciones ni datos de lugares que no aparezcan en ese itinerario.
Si te preguntan algo que esos datos no permiten responder (por ejemplo si un restaurante
concreto estará abierto un día futuro, o el precio de una entrada), dilo con claridad y sugiere
comprobarlo directamente, en vez de inventar una respuesta.
Responde en español, de forma breve y directa (2-4 frases salvo que se pida una lista).`;

function formatHistory(history) {
  if (!Array.isArray(history) || !history.length) return "";
  const lines = history
    .filter((m) => m && typeof m.text === "string" && m.text.trim())
    .slice(-8)
    .map((m) => `${m.role === "assistant" ? "Asistente" : "Usuario"}: ${m.text.trim()}`);
  return lines.length ? `\nCONVERSACIÓN PREVIA:\n${lines.join("\n")}\n` : "";
}

function buildPrompt({ question, planText, warningsText, history }) {
  return [
    SYSTEM_INSTRUCTIONS,
    "",
    "ITINERARIO ACTUAL:",
    planText || "(sin itinerario calculado todavía)",
    warningsText ? `\nAVISOS DEL PLAN:\n${warningsText}` : "",
    formatHistory(history),
    "\nPREGUNTA DEL USUARIO:",
    question
  ].join("\n");
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
          generationConfig: { temperature: 0.3, maxOutputTokens: 500 }
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
    if (!text.trim()) throw new Error("Gemini sin contenido");
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

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

/**
 * @param {{question:string, planText?:string, warningsText?:string, history?:Array<{role:string,text:string}>}} input
 * @param {{key?:string, model?:string, fetch?:Function, timeout?:number}} [opts]
 * @returns {Promise<{answer:string|null, source:string, error?:string}>}
 */
export async function askAssistant(input, opts = {}) {
  const key = String(opts.key ?? process.env.GEMINI_API_KEY ?? "").trim();
  if (!key) return { answer: null, source: "off", error: "La IA no está configurada en este servidor (falta GEMINI_API_KEY)." };
  const model = String(opts.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return { answer: null, source: "off", error: "Sin fetch disponible." };

  const question = String(input?.question || "").trim();
  if (!question) return { answer: null, source: "error", error: "Falta la pregunta." };

  const prompt = buildPrompt({
    question,
    planText: String(input?.planText || ""),
    warningsText: String(input?.warningsText || ""),
    history: input?.history
  });

  try {
    const answer = await callGemini(fetchImpl, key, model, prompt, opts.timeout ?? 12000);
    return { answer, source: "gemini" };
  } catch (e) {
    return { answer: null, source: "error", error: e?.message || String(e) };
  }
}
