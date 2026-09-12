// Asistente conversacional (Google Gemini). Fases 1-3 (ver doc §46.9/§46.10/§46.11):
//   - Responde preguntas sobre el plan que YA ha construido el motor de itinerario
//     del cliente (horarios, duraciones, avisos, orden de visitas).
//   - Desde la Fase 2, puede además PEDIR cambios usando "tools" (function calling
//     de Gemini): elegir comida/cena/alojamiento, añadir/quitar paradas y
//     actividades, cambiar la hora de salida, o añadir un lugar nuevo por nombre.
//   - Desde la Fase 3, un botón de la UI pide un "primer borrador" completo del día
//     por el MISMO mecanismo de tools (varias llamadas a la vez), aplicando el
//     criterio de selección exigente descrito abajo (inspirado en doc/guidepromt.txt:
//     calidad sobre cantidad, "me arrepentiría de no verlo" en vez de "ya que paso
//     cerca"). No hay ruta de código nueva para esto: es el mismo prompt de siempre.
//   - Guardarraíl (igual que `lib/ai-curator.js`, §2.4): el modelo SÓLO puede
//     referenciar ids que ya existen en las listas de opciones que se le pasan en
//     el prompt, o pedir buscar un nombre nuevo (`add_place`, que geocodifica de
//     verdad — nunca inventa coordenadas). El servidor NUNCA ejecuta las acciones:
//     sólo se las devuelve al cliente, que las aplica llamando a las mismas
//     funciones que usan los botones de la UI (y por tanto son tan reversibles
//     como cualquier clic). El texto de confirmación que ve el usuario lo genera
//     el CLIENTE a partir de lo que realmente ha hecho, nunca la afirmación del
//     modelo sobre lo que "cree" haber hecho.

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-flash-lite-latest";

export function assistantConfigured(key = process.env.GEMINI_API_KEY) {
  return !!String(key || "").trim();
}

const SYSTEM_INSTRUCTIONS = `Eres el asistente de un planificador de rutas de viaje por carretera.
Se te da el ITINERARIO YA CALCULADO de un día concreto (horas, paradas, duraciones, avisos) y las
OPCIONES DISPONIBLES actualmente (paradas, actividades, restaurantes, alojamientos, cada una con
su id).

Puedes hacer dos cosas:
1. Responder preguntas sobre el itinerario (horarios, duración de trayectos, tiempo libre, avisos,
   kilómetros). Usa EXCLUSIVAMENTE los datos proporcionados; no inventes horarios de apertura,
   precios, valoraciones ni datos de lugares que no aparezcan ahí. Si algo no se puede responder
   con estos datos, dilo con claridad y sugiere comprobarlo directamente.
2. Aplicar cambios que el usuario pida, llamando a las herramientas disponibles:
   - Para elegir algo que YA aparece en las listas de opciones, usa el id EXACTO tal cual
     aparece en esa lista. No inventes ni adivines un id.
   - Si el usuario pide añadir un lugar que no está en ninguna lista (por nombre propio, p. ej.
     "añade el Caminito del Rey" o "cena en algo cerca del puerto" con un nombre concreto), usa
     la herramienta add_place con ese nombre tal cual; nunca inventes coordenadas ni datos del lugar.
   - Si la petición es ambigua (varias opciones parecidas, o no identificas con seguridad a qué
     se refiere), NO llames ninguna herramienta: pide una aclaración por texto.
   - Si sólo te preguntan algo, sin pedir un cambio, responde con texto y no llames ninguna
     herramienta.
   - Si la petición incluye varios cambios a la vez (por ejemplo "quita X y añade Y", o "cambia
     la comida y sal más tarde"), DEBES llamar a TODAS las herramientas necesarias en esta misma
     respuesta, una por cada cambio pedido. No dejes ningún cambio pedido sin su llamada.
   - Si el usuario dice que un lugar YA NO VALE por algún motivo (ha cerrado, no tiene reservas,
     no le convence, no quiere volver a verlo propuesto…), usa SIEMPRE exclude_place en vez de
     sólo remove_route_stop/remove_activity/clear_*: así no reaparecerá en un borrador futuro.
     Un simple "quítalo de esta selección" (sin más motivo) sí puede resolverse con el remove_*/
     clear_* correspondiente, sin excluirlo para siempre.

CRITERIO DE SELECCIÓN (aplícalo siempre que elijas o recomiendes entre varias opciones, y
especialmente si te piden un borrador o selección completa del día):
Sé exigente: prioriza lo excepcional, singular, histórico o memorable sobre lo simplemente
cercano o con buenas valoraciones genéricas. Para comida evita restaurantes turísticos o cadenas
si hay alternativas de cocina local o de producto de la zona. Usa el criterio "¿me arrepentiría
de pasar cerca sin verlo?" en vez de "ya que paso cerca, lo veo". Si te piden un borrador
completo del día, elige con moderación (por ejemplo hasta 3-6 paradas en ruta, 2-4 actividades en
destino, una comida, una cena y un alojamiento) en vez de seleccionarlo todo: mejor pocas cosas
extraordinarias que muchas mediocres. Respeta siempre lo que el usuario ya haya elegido:
complétalo, no lo sustituyas ni lo quites sin que te lo pidan explícitamente.

Responde siempre en español, de forma breve y directa (2-4 frases salvo que se pida una lista).`;

function formatHistory(history) {
  if (!Array.isArray(history) || !history.length) return "";
  const lines = history
    .filter((m) => m && typeof m.text === "string" && m.text.trim())
    .slice(-8)
    .map((m) => `${m.role === "assistant" ? "Asistente" : "Usuario"}: ${m.text.trim()}`);
  return lines.length ? `\nCONVERSACIÓN PREVIA:\n${lines.join("\n")}\n` : "";
}

function buildPrompt({ question, planText, warningsText, optionsText, history }) {
  return [
    SYSTEM_INSTRUCTIONS,
    "",
    "ITINERARIO ACTUAL:",
    planText || "(sin itinerario calculado todavía)",
    warningsText ? `\nAVISOS DEL PLAN:\n${warningsText}` : "",
    "\nOPCIONES DISPONIBLES:",
    optionsText || "(sin opciones cargadas todavía)",
    formatHistory(history),
    "\nPETICIÓN DEL USUARIO:",
    question
  ].join("\n");
}

const idParam = { type: "object", properties: { id: { type: "string" } }, required: ["id"] };
const TOOLS = [
  { name: "set_lunch", description: "Elige un restaurante concreto para la comida de mediodía, por su id de la lista de opciones de comida.", parameters: idParam },
  { name: "clear_lunch", description: "Quita el restaurante de comida elegido, sin dejar de reservar el bloque de 12:30 a 14:30.", parameters: { type: "object", properties: {} } },
  { name: "skip_lunch", description: "El usuario no quiere comer / no reservar ningún tiempo para comer a mediodía.", parameters: { type: "object", properties: {} } },
  { name: "set_dinner", description: "Elige un restaurante concreto para la cena, por su id de la lista de opciones de cena.", parameters: idParam },
  { name: "clear_dinner", description: "Quita el restaurante de cena elegido (no se reserva tiempo para cenar).", parameters: { type: "object", properties: {} } },
  { name: "set_hotel", description: "Elige un alojamiento concreto, por su id de la lista de opciones de alojamiento.", parameters: idParam },
  { name: "clear_hotel", description: "Quita el alojamiento elegido.", parameters: { type: "object", properties: {} } },
  { name: "add_route_stop", description: "Añade (selecciona) una parada en ruta que todavía no está seleccionada, por su id.", parameters: idParam },
  { name: "remove_route_stop", description: "Quita (deselecciona) una parada en ruta que SÍ está actualmente seleccionada, por su id.", parameters: idParam },
  { name: "add_activity", description: "Añade (selecciona) una actividad en destino que todavía no está seleccionada, por su id.", parameters: idParam },
  { name: "remove_activity", description: "Quita (deselecciona) una actividad en destino que SÍ está actualmente seleccionada, por su id.", parameters: idParam },
  { name: "remove_custom_stop", description: "Elimina definitivamente (no sólo deselecciona) una parada personalizada del usuario, por su id.", parameters: idParam },
  { name: "set_departure_time", description: "Cambia la hora de salida del día. Formato HH:MM en 24 horas.", parameters: { type: "object", properties: { time: { type: "string" } }, required: ["time"] } },
  {
    name: "add_place",
    description: "Busca por nombre y añade un lugar que NO está en ninguna de las listas de opciones ya proporcionadas: parada en ruta, comida, cena o alojamiento. Nunca inventes coordenadas: sólo da el nombre a buscar.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["route", "lunch", "dinner", "hotel"] },
        query: { type: "string" }
      },
      required: ["kind", "query"]
    }
  },
  {
    name: "exclude_place",
    description: "Descarta un lugar PARA SIEMPRE en esta sesión (no sólo lo quita de la selección actual): úsalo cuando el usuario diga que un lugar ya no está disponible, ha cerrado, no tiene reservas, o simplemente no quiere que se le vuelva a proponer. Se elimina de la selección si estaba elegido y no volverá a aparecer en las listas de opciones ni en futuros borradores.",
    parameters: { type: "object", properties: { id: { type: "string" }, reason: { type: "string" } }, required: ["id"] }
  },
  {
    name: "include_place",
    description: "Deshace una exclusión previa: el lugar vuelve a estar disponible para elegir. Úsalo sólo si el usuario pide explícitamente recuperar algo que había descartado antes.",
    parameters: idParam
  }
];

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
          tools: [{ functionDeclarations: TOOLS }],
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
          // 1024: un borrador completo del día (Fase 3) puede devolver hasta ~10
          // functionCall en una sola respuesta.
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
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
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || "").join("").trim();
    const calls = parts
      .filter((p) => p.functionCall?.name)
      .map((p) => ({ tool: p.functionCall.name, args: p.functionCall.args || {} }));
    if (!text && !calls.length) throw new Error("Gemini sin contenido");
    return { text, calls };
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
 * @param {{question:string, planText?:string, warningsText?:string, optionsText?:string,
 *           history?:Array<{role:string,text:string}>}} input
 * @param {{key?:string, model?:string, fetch?:Function, timeout?:number}} [opts]
 * @returns {Promise<{answer:string|null, actions:Array<{tool:string,args:object}>, source:string, error?:string}>}
 */
export async function askAssistant(input, opts = {}) {
  const key = String(opts.key ?? process.env.GEMINI_API_KEY ?? "").trim();
  if (!key) return { answer: null, actions: [], source: "off", error: "La IA no está configurada en este servidor (falta GEMINI_API_KEY)." };
  const model = String(opts.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return { answer: null, actions: [], source: "off", error: "Sin fetch disponible." };

  const question = String(input?.question || "").trim();
  if (!question) return { answer: null, actions: [], source: "error", error: "Falta la pregunta." };

  const prompt = buildPrompt({
    question,
    planText: String(input?.planText || ""),
    warningsText: String(input?.warningsText || ""),
    optionsText: String(input?.optionsText || ""),
    history: input?.history
  });

  try {
    const { text, calls } = await callGemini(fetchImpl, key, model, prompt, opts.timeout ?? 12000);
    return { answer: text || null, actions: calls, source: "gemini" };
  } catch (e) {
    return { answer: null, actions: [], source: "error", error: e?.message || String(e) };
  }
}
