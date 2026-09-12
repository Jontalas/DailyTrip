<script>
  import { onMount, untrack } from "svelte";
  import { fly } from "svelte/transition";

  import {daySignature} from "./lib/day-plan.js";
  import {activeDayRoute,corridorChanged} from "./lib/active-route.js";
  import MapCanvas from "./components/MapCanvas.svelte";
  import SearchPanel from "./components/SearchPanel.svelte";
  import BaseResults from "./components/BaseResults.svelte";
  import PreferencesBar from "./components/PreferencesBar.svelte";
  import OptionsPanel from "./components/OptionsPanel.svelte";
  import ItineraryPanel from "./components/ItineraryPanel.svelte";
  import Progress from "./components/Progress.svelte";
  import MobileBar from "./components/MobileBar.svelte";

  import { api } from "./lib/api.js";
  import { loadCategory } from "./lib/loading.js";
  import { applyPreferences, applyAiToPool } from "./lib/scoring.js";
  import { toMin, fromMin } from "./lib/format.js";
  import { dur } from "./lib/motion.js";
  import { approximateSchedule, isLunchViable, buildItinerary, legKey, DAY_END } from "./lib/itinerary.js";
  import { buildSnapshot, applySnapshot, isSnapshot, snapshotFilename } from "./lib/trip-state.js";
  import {
    providers,
    searchContext,
    baseResults,
    chosen,
    routeData,
    activeRoute,
    pools,
    selected,
    customDurations,
    preferences,
    departureTime,
    theme,
    search,
    planning,
    resetPlan,
    selectedDuration,
    lunchOptions,
    openOptionGroup,
    customStops,
    mobileTask,
    mapPickMode,
    aiCuration
  } from "./lib/stores.js";

  /* ---- Tema ------------------------------------------------------------- */
  onMount(() => {
    try {
      const saved = localStorage.getItem("tp-theme");
      if (saved) theme.set(saved);
    } catch {}
    api.providers().then((p) => providers.set(p)).catch(() => {});

    try {
      const raw = localStorage.getItem("dailytrip:trip");
      if (raw) { const s = JSON.parse(raw); if (isSnapshot(s) && s.chosen) resumeSnap = s; }
    } catch {}

    const mq = window.matchMedia("(max-width: 1024px)");
    const apply = () => (narrow = mq.matches);
    apply();
    mq.addEventListener("change", apply);
    const onResize = () => (winH = window.innerHeight);
    onResize();
    window.addEventListener("resize", onResize);
    return () => {
      mq.removeEventListener("change", apply);
      window.removeEventListener("resize", onResize);
    };
  });

  $effect(() => {
    const t = $theme;
    const root = document.documentElement;
    if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
    else root.removeAttribute("data-theme");
    try {
      localStorage.setItem("tp-theme", t);
    } catch {}
  });

  function cycleTheme() {
    theme.update((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system"));
  }
  let themeLabel = $derived($theme === "system" ? "Auto" : $theme === "light" ? "Claro" : "Oscuro");

  /* ---- Estado local --------------------------------------------------- */
  let originText = $state("Málaga");
  let planLoaded = $state(false);
  let narrow = $state(false);
  let winH = $state(800);
  let editingSearch = $state(false); // reabrir búsqueda con el plan ya cargado
  // Alto reservado abajo a la derecha para que el itinerario NO tape la leyenda:
  // se mide la leyenda real y el rail derecho se expande justo hasta ella.
  let legendClear = $state(210);

  $effect(() => {
    // Deps: re-medir cuando aparece/desaparece la leyenda o cambia el viewport.
    planLoaded; narrow; winH; $chosen;
    if (narrow) { legendClear = 0; return; }
    const measure = () => {
      const lg = document.querySelector(".legend");
      const app = lg?.closest(".app");
      const rail = app?.querySelector(".rail--right");
      if (!lg || !app || !rail) { legendClear = 0; return; }
      const a = app.getBoundingClientRect(), r = lg.getBoundingClientRect();
      const railPad = parseFloat(getComputedStyle(rail).paddingTop) || 20;
      // El itinerario acaba ~10 px por encima del borde superior de la leyenda.
      const want = Math.round(a.bottom - r.top) - railPad + 10;
      legendClear = Math.min(Math.round(winH * 0.55), Math.max(0, want));
    };
    measure();
    requestAnimationFrame(measure);
    const lg = document.querySelector(".legend");
    if (!lg || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(lg);
    return () => ro.disconnect();
  });

  /* ---- Hoja enfocada de móvil ---------------------------------------- */
  // La hoja de opciones (paradas/comida/cena/dormir/planes) NO tapa el mapa:
  // sin scrim, por encima de la barra y a media altura ("peek"), ampliable con
  // el asa. Sólo búsqueda e itinerario ocupan pantalla completa con scrim.
  let sheetExpanded = $state(false);
  const SCRIM_TASKS = ["search", "itin"];
  let sheetScrim = $derived(SCRIM_TASKS.includes($mobileTask));
  let sheetTall = $derived(sheetScrim || sheetExpanded);
  $effect(() => { $mobileTask; sheetExpanded = false; }); // cada tarea arranca en peek
  // Empujar el encuadre del mapa hacia arriba lo que ocupa la hoja de opciones,
  // para que la ruta y los pines queden en la mitad visible.
  let mapBottomInset = $derived(
    narrow && $mobileTask && !sheetScrim && !$mapPickMode
      ? Math.round(winH * (sheetTall ? 0.8 : 0.44)) + 82
      : 0
  );

  function closeSheet() {
    mobileTask.set(null);
    openOptionGroup.set(null);
  }
  const SHEET_TITLES = {
    search: "Etapa: origen y destino", prep: "Preparar el día", tune: "Ajustes del día",
    route: "Paradas en ruta", custom: "Añadir parada propia", lunch: "Comida",
    dinner: "Cena", hotel: "Alojamiento", act: "Actividades en destino", itin: "Itinerario del día"
  };
  const OPTION_TASKS = ["route", "custom", "lunch", "act", "dinner", "hotel"];
  // Un toque en un pin del mapa abre su grupo; en móvil eso abre la hoja.
  $effect(() => {
    const g = $openOptionGroup;
    if (!narrow || !g || !OPTION_TASKS.includes(g)) return;
    if (untrack(() => $mobileTask) !== g) mobileTask.set(g);
  });
  // Al entrar en móvil sin base elegida, abrir la búsqueda directamente (una vez).
  let mobileInit = false;
  $effect(() => {
    if (mobileInit || !narrow) return;
    mobileInit = true;
    if (!untrack(() => $chosen)) mobileTask.set("search");
  });
  let mapFocus = $state(false); // adelgazar ambos rails
  let itin = $state({ events: [], endTime: 0, warnings: [] });

  /* ---- Guardar / cargar el viaje ------------------------------------ */
  let tripMsg = $state("");
  let resumeSnap = $state(null); // instantánea de localStorage pendiente de retomar
  let fileInput;                 // <input type=file> oculto
  let autosaveTimer;

  function saveTrip() {
    const snap = buildSnapshot({ planLoaded, originText });
    const url = URL.createObjectURL(new Blob([JSON.stringify(snap)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = snapshotFilename(snap);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function applyTrip(snap) {
    planSeq++; daySeq++; routeSeq++;
    catalogRoute = null;
    legCache = new Map();
    categoryState = ["route", "routeLunch", "activities", "food", "lodging"]
      .reduce((m, k) => ((m[k] = { status: "ok" }), m), {});
    applySnapshot(snap);
    catalogRoute = $routeData; // evita un refresco de corredor innecesario
    originText = snap.originText || snap.searchContext?.origin?.name || "";
    editingSearch = false;
    planLoaded = !!snap.planLoaded && !!snap.chosen;
    planning.set({ busy: false, steps: [], status: "" });
    if (narrow) mobileTask.set(null);
    resumeSnap = null;
    tripMsg = "";
    stopAiPolls();
    if (planLoaded) {
      const gen = planSeq;
      const hasRouteAi = ($pools.route || []).some((x) => x.aiInterest != null);
      const hasActAi = ($pools.activities || []).some((x) => x.aiInterest != null);
      ensureAiCuration("route", hasRouteAi, gen);
      ensureAiCuration("activities", hasActAi, gen);
    }
  }

  async function loadTripFile(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    try {
      const snap = JSON.parse(await file.text());
      if (!isSnapshot(snap)) { tripMsg = "Ese archivo no es un viaje de DailyTrip compatible."; return; }
      applyTrip(snap);
    } catch {
      tripMsg = "No se pudo leer el archivo.";
    }
  }

  function forgetSavedTrip() {
    try { localStorage.removeItem("dailytrip:trip"); } catch {}
    resumeSnap = null;
  }

  // Autoguardado en localStorage (con retardo): un refresco o un cierre nunca
  // pierde el trabajo. Sólo mientras haya una base elegida.
  $effect(() => {
    $searchContext; $chosen; $routeData; $pools; $selected; $customStops;
    $customDurations; $preferences; $departureTime; planLoaded;
    clearTimeout(autosaveTimer);
    if (!untrack(() => $chosen)) return;
    autosaveTimer = setTimeout(() => {
      try { localStorage.setItem("dailytrip:trip", JSON.stringify(buildSnapshot({ planLoaded, originText }))); } catch {}
    }, 1500);
  });
  let planSeq = 0;
  let legCache = $state(new Map());
  let dayResult = $state(null);
  let dayBusy = $state(false);
  let dayError = $state('');
  let dayRetry = $state(0);
  let daySeq = 0;
  // Hora de salida y duraciones efectivas: entran en la firma del día porque la
  // ordenación se hace consciente de la hora cuando hay comida/cena elegida.
  let depMin = $derived(toMin($departureTime || "09:30"));
  let durationsMap = $derived.by(() => {
    const m = {};
    for (const it of [...$selected.route, ...$selected.activities, $selected.lunch, $selected.hotel, $selected.dinner].filter(Boolean))
      m[it.id] = selectedDuration(it, $customDurations);
    return m;
  });
  let dayKey = $derived(daySignature({selected:$selected,chosen:$chosen,routeData:$routeData,departureMin:depMin,durations:durationsMap}));
  let currentDay = $derived(dayResult?.key === dayKey ? dayResult : null);
  let categoryState = $state({});
  let catalogRoute = null;
  let corridorEpoch = 0;
  let catalogTimer;
  // Consulta a la IA en segundo plano: un contador por sección invalida los
  // sondeos en curso cuando cambia la base/el corredor.
  let aiPollSeq = { route: 0, activities: 0 };
  let metricSeq = 0;

  let hasPlan = $derived(planLoaded);
  let viewPools = $derived(applyPreferences($pools, [...$preferences]));
  // Las paradas personalizadas se suman al pool de ruta (no las filtran las
  // preferencias): las ve la lista, el mapa y el constructor del itinerario.
  let planPools = $derived({
    ...viewPools,
    food: [...(viewPools.food || []), ...($selected.dinner && !(viewPools.food || []).some(x=>x.id===$selected.dinner.id) ? [$selected.dinner] : [])],
    route: [...(viewPools.route || []), ...$customStops]
  });
  let results = $derived($baseResults.results || []);

  // Barra de viaje: antes de elegir base muestra "Zona de <destino orientativo>"
  // y la distancia por carretera hasta ese punto (searchContext.referenceRoute).
  let tripDest = $derived(
    $chosen ? $chosen.name
    : $searchContext?.target?.name ? `Zona de ${$searchContext.target.name}`
    : ""
  );
  let tripKm = $derived(Math.round(
    ($chosen ? (currentDay?.roadKm ?? $chosen.roadKm) : $searchContext?.referenceRoute?.roadKm) || 0
  ));
  // "Colapsar" el formulario a la barra de resumen sólo cuando la búsqueda ha
  // TERMINADO y hay algo que mostrar: mientras se buscan los finales de etapa el
  // formulario sigue visible con su progreso; si falla o no hay resultados,
  // también (para ver el error / el mensaje y poder ajustar).
  let searchDone = $derived(
    !editingSearch && !$search.busy && !$search.error && (!!$chosen || results.length > 0)
  );

  /* ---- Búsqueda ------------------------------------------------------- */
  async function runSearch(q) {
    planSeq++;
    daySeq++;
    categoryState = {};
    stopAiPolls();
    legCache = new Map();
    planning.set({busy:false,steps:[],status:""});
    originText = q.origin;
    baseResults.set([]);
    chosen.set(null);
    routeData.set(null);
    resetPlan();
    planLoaded = false;
    editingSearch = false;
    search.set({
      busy: true,
      status: "",
      error: false,
      steps: [
        { label: "Localizar origen y dirección", state: "working" },
        { label: "Calcular ruta", state: "pending" },
        { label: "Buscar localidades", state: "pending" },
        { label: "Comprobar cercanía al destino", state: "pending" }
      ]
    });

    try {
      const ctx = await api.searchContext(q);
      searchContext.set(ctx);
      bumpSteps(search, [1, 0], "done");
      bumpSteps(search, [2], "working");

      const cand = await api.searchCandidates({
        origin: ctx.origin,
        target: ctx.target,
        toleranceKm: ctx.toleranceKm
      });
      bumpSteps(search, [2, 3], "done");
      baseResults.set({ results: cand.results || [], disclaimer: cand.disclaimer || "" });
      search.update((s) => ({ ...s, busy: false, status: `${(cand.results || []).length} finales de etapa válidos.` }));
    } catch (e) {
      search.update((s) => ({
        ...s,
        busy: false,
        error: true,
        status: e.message || "No se pudo completar la búsqueda.",
        steps: s.steps.map((st) => (st.state === "working" || st.state === "pending" ? { ...st, state: "error" } : st))
      }));
    }
  }

  function bumpSteps(store, idxs, state) {
    store.update((s) => ({ ...s, steps: s.steps.map((st, i) => (idxs.includes(i) ? { ...st, state } : st)) }));
  }

  /* ---- Elegir base -------------------------------------------------- */
  let routeSeq = 0;
  async function chooseBase(b) {
    planSeq++;
    daySeq++;
    categoryState = {};
    legCache = new Map();
    planning.set({busy:false,steps:[],status:""});
    chosen.set(b);
    routeData.set(null);
    resetPlan();
    planLoaded = false;
    editingSearch = false;
    itin = { events: [], endTime: 0, warnings: [] };

    // Dibuja la ruta origen -> base y carga las opciones del día directamente:
    // elegir base no dejaba ninguna decisión más al usuario (la hora de salida se
    // puede ajustar luego), así que el paso "Cargar opciones del día" sobra.
    const ctx = $searchContext;
    if (!ctx) return;
    const mine = ++routeSeq;
    try {
      const rd = await api.planRoute({ origin: ctx.origin, destination: { name: b.name, lat: b.lat, lon: b.lon } });
      if (mine === routeSeq && $chosen === b) routeData.set(rd.route);
    } catch {
      /* si falla, loadPlan lo recalcula */
    }
    if ($chosen === b) void loadPlan();
  }

  /* ---- Cargar plan del día --------------------------------------------- */
  async function loadPlan() {
    const ch = $chosen;
    const ctx = $searchContext;
    if (!ch || !ctx) return;
    const destination = { name: ch.name, lat: ch.lat, lon: ch.lon };
    const mine = ++planSeq;
    categoryState = {};
    stopAiPolls();

    resetPlan();
    planLoaded = false;
    planning.set({
      busy: true,
      status: "",
      error: false,
      steps: [
        { label: "Ruta detallada", state: "working" },
        { label: "Paradas en ruta", state: "pending" },
        { label: "Comida en ruta", state: "pending" },
        { label: "Actividades", state: "pending" },
        { label: "Restauración y alojamiento", state: "pending" }
      ]
    });

    try {
      // La ruta ya suele estar dibujada desde chooseBase; reutilizarla.
      const rd = $routeData ? { route: $routeData } : await api.planRoute({ origin: ctx.origin, destination });
      if (mine !== planSeq) return;
      routeData.set(rd.route);
      catalogRoute = rd.route;
      planLoaded = true;
      editingSearch = false;
      bumpSteps(planning, [0], "done");
      bumpSteps(planning, [1, 2, 3, 4], "working");

      await Promise.all(["route", "routeLunch", "activities", "services"].map(key => retryCategory(key, mine)));
      if (mine !== planSeq) return;
      planning.update(s => ({...s, steps:s.steps.map((step,i) => i === 0 ? step : {
        ...step, state:categoryState[["route","routeLunch","activities","services"][i-1]]?.status === "ok" ? "done" : "error"
      })}));
      planning.update((s) => ({ ...s, busy: false, status: "" }));
      planLoaded = true;
      editingSearch = false;
    } catch (e) {
      if (mine !== planSeq) return;
      planning.update((s) => ({
        ...s,
        busy: false,
        error: true,
        status: e.message || "No se pudo preparar el día.",
        steps: s.steps.map((st) => (st.state !== "done" ? { ...st, state: "error" } : st))
      }));
    }
  }

  async function retryCategory(key, generation = planSeq) {
    const ch = $chosen, rd = $activeRoute || $routeData;
    if (!ch || !rd || categoryState[key]?.status === "loading") return;
    const epoch = corridorEpoch;
    const destination = {name:ch.name,lat:ch.lat,lon:ch.lon,type:ch.type,population:ch.population};
    const previous = $pools;
    categoryState = {...categoryState, [key]:{status:"loading",message:"Buscando y comparando lugares por interés…"}};
    const requests = {
      route: async () => {
        const result = await api.optionsRoute({route:rd,destination});
        const metrics = await api.metricsRouteOptions({route:rd,items:result.items || []});
        return {...result, items:metrics.items, degraded:metrics.degraded};
      },
      routeLunch: () => api.optionsRouteLunch({route:rd,destination}),
      activities: () => api.optionsActivities({destination})
    };
    let updates = {}, states = [];
    if (key === "services") {
      // Una petición compartida conserva estados independientes de comida/hotel.
      const response = api.optionsServices({destination});
      const results = await Promise.all(["food","lodging"].map(kind => loadCategory(async () => {
        const r = await response;
        return {items:r[kind],source:r.sources?.[kind],status:r.states?.[kind] || r.status,selection:r.selections?.[kind]};
      }, previous[kind])));
      ["food","lodging"].forEach((kind,i) => {updates[kind]=results[i].items;});
      states = results;
    } else {
      const result = await loadCategory(requests[key], previous[key]);
      updates[key] = result.items;
      states = [result];
    }
    if (generation !== planSeq || (["route","routeLunch"].includes(key) && epoch!==corridorEpoch)) return;
    // Un reintento no elimina selecciones ya hechas.
    const sel = $selected;
    const keep = {route:sel.route.filter(x=>!x.custom), activities:sel.activities,
      routeLunch:sel.lunch?.lunchPhase==="route"?[sel.lunch]:[],
      food:[sel.lunch?.lunchPhase==="destination"?sel.lunch:null,sel.dinner].filter(Boolean),
      lodging:sel.hotel?[sel.hotel]:[]};
    for (const kind of Object.keys(updates)) for (const item of keep[kind])
      if (!updates[kind].some(x=>x.id===item.id)) updates[kind]=[...updates[kind],item];
    pools.update(p=>({...p,...updates}));
    if(key === "services") categoryState={...categoryState,food:states[0],lodging:states[1]};
    const issue = states.find(x=>x.status!=="ok");
    categoryState = {...categoryState,[key]:issue || states[0] || {status:"ok",message:""}};
    if(key==='route' && $activeRoute && rd!==$activeRoute)refreshRouteMetrics($activeRoute,generation);
    if(key==='route') ensureAiCuration('route', states[0]?.coverage?.ai?.ok===true, generation);
    if(key==='activities') ensureAiCuration('activities', states[0]?.selection?.aiOk===true, generation);
  }

  async function refreshRouteMetrics(rd,generation=planSeq) {
    const mine=++metricSeq;
    const result=await api.metricsRouteOptions({route:rd,items:$pools.route});
    if(mine!==metricSeq || generation!==planSeq || rd!==$activeRoute)return;
    const byId=new Map(result.items.map(x=>[x.id,x]));
    pools.update(p=>({...p,route:p.route.map(x=>byId.get(x.id)||x)}));
    if(result.degraded && categoryState.route?.status!=='loading')categoryState={...categoryState,
      route:{...categoryState.route,status:'degraded',canRetry:true,message:'Algunas métricas del nuevo recorrido son estimadas. Puedes reintentarlas.'}};
  }

  /* ---- Curación por IA en segundo plano ------------------------------------
     Tras cargar las opciones, si la IA no llegó en línea (Gemini lento), se
     sondea `/api/ai/curate` hasta que responde; al llegar se fusiona en el pool
     y `applyPreferences` reordena solo. `aiCuration` alimenta el indicador. */
  function stopAiPolls() {
    aiPollSeq.route++;
    aiPollSeq.activities++;
    aiCuration.set({ route: "idle", activities: "idle" });
  }

  async function mergeAiResult(kind, result, generation) {
    if (generation !== planSeq) return;
    const poolKey = kind === "route" ? "route" : "activities";
    pools.update((p) => ({ ...p, [poolKey]: applyAiToPool(p[poolKey], result) }));
    if (kind !== "route" || !(result.items || []).length) return;
    const rd = $activeRoute || $routeData;
    if (!rd) return;
    try {
      const m = await api.metricsRouteOptions({ route: rd, items: $pools.route });
      if (generation !== planSeq) return;
      const byId = new Map(m.items.map((x) => [x.id, x]));
      pools.update((p) => ({ ...p, route: p.route.map((x) => byId.get(x.id) || x) }));
    } catch {}
  }

  async function pollAiCuration(kind, generation = planSeq) {
    const ch = $chosen;
    if (!ch) return;
    const rd = kind === "route" ? ($activeRoute || $routeData) : null;
    if (kind === "route" && !rd?.coords?.length) return;
    const mySeq = ++aiPollSeq[kind];
    const destination = { name: ch.name, lat: ch.lat, lon: ch.lon, type: ch.type, population: ch.population };
    aiCuration.update((s) => ({ ...s, [kind]: "working" }));
    const until = Date.now() + 5 * 60 * 1000;
    let delay = 3500;
    while (Date.now() < until) {
      if (mySeq !== aiPollSeq[kind] || generation !== planSeq) return;
      let r;
      try {
        r = await api.aiCurate({
          kind,
          route: kind === "route" ? { coords: rd.coords, roadKm: rd.roadKm } : undefined,
          destination
        });
      } catch {
        r = { status: "error" };
      }
      if (mySeq !== aiPollSeq[kind] || generation !== planSeq) return;
      if (r.status === "off") { aiCuration.update((s) => ({ ...s, [kind]: "idle" })); return; }
      if (r.status === "ready") {
        await mergeAiResult(kind, r, generation);
        if (mySeq === aiPollSeq[kind] && generation === planSeq)
          aiCuration.update((s) => ({ ...s, [kind]: "ready" }));
        return;
      }
      await new Promise((res) => setTimeout(res, delay));
      delay = Math.min(Math.round(delay * 1.4), 15000);
    }
    aiCuration.update((s) => ({ ...s, [kind]: s[kind] === "ready" ? "ready" : "idle" }));
  }

  // Arranca (o no) el sondeo de una sección según si la IA ya llegó en línea.
  function ensureAiCuration(kind, inlineOk, generation = planSeq) {
    if (generation !== planSeq) return;
    if (inlineOk) { aiCuration.update((s) => ({ ...s, [kind]: "ready" })); return; }
    void pollAiCuration(kind, generation);
  }

  function refreshCorridor(rd,generation) {
    if(generation!==planSeq || rd!==$activeRoute)return;
    catalogRoute=rd;
    corridorEpoch++;
    metricSeq++;
    // Proposals from the old road are not a fallback for a different corridor.
    // Selected places remain mandatory, including places no longer returned.
    const sel=$selected;
    pools.update(p=>({...p,route:sel.route.filter(x=>!x.custom),
      routeLunch:sel.lunch?.lunchPhase==='route'?[sel.lunch]:[]}));
    categoryState={...categoryState,route:null,routeLunch:null};
    void Promise.all(['route','routeLunch'].map(key=>retryCategory(key,generation)));
  }

  /* ---- Viabilidad temporal (SÓLO informar: nunca se ocultan) --------- */
  let lateActivityIds = $derived.by(() => {
    const set = new Set();
    const rd = $routeData;
    const ch = $chosen;
    if (!rd || !ch) return set;
    const dm = $customDurations;
    const sel = $selected;
    for (const item of $pools.activities || []) {
      if (sel.activities.some((a) => a.id === item.id)) continue;
      const end = approximateSchedule({
        departureMin: depMin,
        chosen: ch,
        routeData: rd,
        selected: sel,
        durationOf: (x) => selectedDuration(x, dm),
        legCache,
        extraActivity: item
      });
      if (end > DAY_END) set.add(item.id);
    }
    return set;
  });

  let lateLunchKeys = $derived.by(() => {
    const set = new Set();
    const rd = $routeData;
    if (!rd) return set;
    const dm = $customDurations;
    const sel = $selected;
    for (const item of $lunchOptions) {
      const key = `${item.lunchPhase}:${item.id}`;
      if (sel.lunch?.id === item.id && sel.lunch?.lunchPhase === item.lunchPhase) continue;
      const ok = isLunchViable({
        item,
        departureMin: depMin,
        routeData: rd,
        selected: sel,
        chosen: $chosen,
        legCache,
        durationOf: (x) => selectedDuration(x, dm)
      });
      if (!ok) set.add(key);
    }
    return set;
  });

  // One response supplies the ordering, road geometry and every travel time.
  $effect(() => {
    const key=dayKey, retry=dayRetry;
    const {sel,ch,rd,dep,durs}=untrack(()=>({sel:$selected,ch:$chosen,rd:$routeData,dep:depMin,durs:durationsMap}));
    const mine=++daySeq;
    const generation=planSeq;
    clearTimeout(catalogTimer);
    dayError='';
    if(!key || !planLoaded) {dayResult=null;dayBusy=false;return;}
    dayBusy=true;
    const timer=setTimeout(async()=>{
      try {
        const response=await api.planDay({origin:rd.coords[0],chosen:ch,selected:sel,departureMin:dep,durations:durs});
        if(mine!==daySeq) return;
        dayResult={...response,key};
        const points=[rd.coords[0],...response.stops.map(s=>s.item)];
        const next=new Map();
        response.legs.forEach((leg,i)=>next.set(legKey(points[i],points[i+1]),leg));
        legCache=next;
        const updated=activeDayRoute(response,rd.coords[0],ch,sel);
        if(updated){
          activeRoute.set(updated);
          if(corridorChanged(catalogRoute,updated))catalogTimer=setTimeout(()=>refreshCorridor(updated,generation),600);
          else if(categoryState.route?.status!=='loading')void refreshRouteMetrics(updated,generation);
        }
      } catch {if(mine===daySeq) dayError='No se pudo calcular la ruta. Los horarios son provisionales.';}
      finally {if(mine===daySeq) dayBusy=false;}
    },250);
    return ()=>clearTimeout(timer);
  });
  $effect(() => {
    const rd=$routeData,ch=$chosen,sel=$selected,dm=$customDurations;
    if(!rd || !ch || !planLoaded) {itin={events:[],endTime:depMin,warnings:[]};return;}
    const result=buildItinerary({originName:originText || 'Origen',chosen:ch,routeData:rd,selected:sel,
      durationOf:item=>selectedDuration(item,dm),departureMin:depMin,legCache:currentDay?legCache:new Map(),orderedStops:currentDay?.stops});
    result.routingBusy=dayBusy;
    result.routingError=dayError;
    result.roadKm=currentDay?.roadKm;
    result.driveMin=currentDay?.durationMin;
    result.routingEstimated=currentDay?.source!=='osrm';
    result.warnings.push(...(currentDay?.accessWarnings || []));
    if(currentDay?.optimizationSource==='estimated') result.warnings.push('Orden provisional por proximidad: no se pudo consultar la matriz de carreteras.');
    itin=result;
  });

  /* ---- Exportar la ruta del día a Google Maps ---------------------------
     origen → paradas del día (en el orden del itinerario) → base final.
     Google Maps admite 9 paradas intermedias; si hay más se avisa. */
  const GMAPS_MAX_WAYPOINTS = 9;
  let mapsExport = $derived.by(() => {
    const origin = $searchContext?.origin, base = $chosen;
    if (!origin || !base || !Number.isFinite(origin.lat) || !Number.isFinite(base.lat)) return null;
    const seen = new Set();
    const key = (p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
    const stops = [];
    const add = (p) => {
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return;
      const k = key(p);
      if (k === key(base) || seen.has(k)) return;
      seen.add(k); stops.push(p);
    };
    const evs = (itin?.events || []).filter((e) => e.item && e.kind !== "travel");
    if (evs.length) evs.forEach((e) => add(e.item));
    else {
      [...$selected.route].sort((a, b) => (a.routeProgressPct ?? 50) - (b.routeProgressPct ?? 50)).forEach(add);
      if ($selected.lunch) add($selected.lunch);
      if ($selected.hotel) add($selected.hotel);
      $selected.activities.forEach(add);
      if ($selected.dinner) add($selected.dinner);
    }
    if (!stops.length && !base) return null;
    const shown = stops.slice(0, GMAPS_MAX_WAYPOINTS);
    const ll = (p) => `${p.lat},${p.lon}`;
    const u = new URL("https://www.google.com/maps/dir/");
    u.searchParams.set("api", "1");
    u.searchParams.set("travelmode", "driving");
    u.searchParams.set("origin", ll(origin));
    u.searchParams.set("destination", ll(base));
    if (shown.length) u.searchParams.set("waypoints", shown.map(ll).join("|"));
    return { url: u.toString(), count: shown.length, truncated: stops.length > shown.length, total: stops.length };
  });

</script>

{#snippet planContent()}
  {#if searchDone}
    <!-- Barra de viaje: ya visible al listar finales de etapa (destino = "Zona
         de …" con la distancia al orientativo); pasa al nombre de la base al elegirla. -->
    <div class="trip-bar">
      <span class="trip-route tnum">
        <strong>{originText}</strong> → <strong>{tripDest}</strong>
        {#if tripKm}<span class="trip-km">{tripKm} km</span>{/if}
      </span>
      <button class="trip-edit" type="button" onclick={() => (editingSearch = true)}>cambiar</button>
    </div>

    {#if !$chosen}
      {#if results.length}
        <section class="card" in:fly={{ y: 12, duration: dur(240) }}>
          <h2>Finales de etapa</h2>
          <BaseResults
            {results}
            disclaimer={$baseResults.disclaimer}
            targetName={$searchContext?.target?.name}
            chosenId={null}
            onchoose={chooseBase}
          />
        </section>
      {/if}
    {:else if !hasPlan}
      <section class="card" in:fly={{ y: 10, duration: dur(220) }}>
        <h2>Preparando el día…</h2>
        <Progress steps={$planning.steps} />
        {#if $planning.status}<p class="status" class:status--error={$planning.error}>{$planning.status}</p>{/if}
        {#if $planning.error && !$planning.busy}
          <button class="go" type="button" onclick={loadPlan}>Reintentar</button>
        {/if}
      </section>
    {:else}
      <section class="card card--flush" in:fly={{ y: 10, duration: dur(220) }}>
        <PreferencesBar />
        <OptionsPanel
          pools={planPools}
          lunchOptions={$lunchOptions}
          {lateActivityIds}
          {lateLunchKeys}
          {categoryState}
          aiState={$aiCuration}
          nearPoint={$chosen ? { lat: $chosen.lat, lon: $chosen.lon } : null}
          onretry={(key) => retryCategory(key)}
        />
      </section>
    {/if}
  {:else}
    <!-- Búsqueda / edición de la etapa -->
    <section class="card">
      <div class="card-head">
        <h2>Buscar final de etapa</h2>
        <div class="card-head__actions">
          <button class="link-btn" type="button" onclick={() => fileInput?.click()}>Cargar viaje</button>
          {#if $searchContext}
            <button class="link-btn" type="button" onclick={() => (editingSearch = false)}>volver</button>
          {/if}
        </div>
      </div>
      {#if tripMsg}<p class="status status--error">{tripMsg}</p>{/if}
      <SearchPanel onsearch={runSearch} />
    </section>
  {/if}
{/snippet}

{#snippet itinContent()}
  <div class="card card--fill">
    <ItineraryPanel onretry={() => dayRetry++} onsave={saveTrip} {mapsExport} result={itin} {hasPlan} />
  </div>
{/snippet}

{#snippet mobileTaskView(task)}
  {#if task === "search"}
    {#if searchDone && results.length}
      <div class="m-editbar">
        <span class="tnum">{originText} → {tripDest}{#if tripKm} · {tripKm} km{/if}</span>
        <button class="link-btn" type="button" onclick={() => (editingSearch = true)}>cambiar</button>
      </div>
      <BaseResults
        {results}
        disclaimer={$baseResults.disclaimer}
        targetName={$searchContext?.target?.name}
        chosenId={null}
        onchoose={(b) => { chooseBase(b); editingSearch = false; mobileTask.set(null); }}
      />
    {:else}
      <button class="m-load" type="button" onclick={() => fileInput?.click()}>📂 Cargar viaje guardado</button>
      {#if tripMsg}<p class="status status--error">{tripMsg}</p>{/if}
      <SearchPanel onsearch={runSearch} />
    {/if}
  {:else if task === "prep"}
    <Progress steps={$planning.steps} />
    {#if $planning.status}<p class="status" class:status--error={$planning.error}>{$planning.status}</p>{/if}
    {#if $planning.error && !$planning.busy}
      <button class="go" type="button" onclick={loadPlan}>Reintentar</button>
    {/if}
  {:else if task === "tune"}
    <label class="m-time"><span>Hora de salida</span><input type="time" bind:value={$departureTime} /></label>
    <PreferencesBar />
  {:else if task === "itin"}
    <ItineraryPanel onretry={() => dayRetry++} onsave={saveTrip} {mapsExport} result={itin} {hasPlan} />
  {:else}
    <OptionsPanel
      mobile
      pools={planPools}
      lunchOptions={$lunchOptions}
      {lateActivityIds}
      {lateLunchKeys}
      {categoryState}
      aiState={$aiCuration}
      nearPoint={$chosen ? { lat: $chosen.lat, lon: $chosen.lon } : null}
      onretry={(key) => retryCategory(key)}
    />
  {/if}
{/snippet}

<div class="app" class:app--narrow={narrow} class:app--focus={mapFocus && !narrow}>
  <MapCanvas
    dayPlan={currentDay}
    routeData={$activeRoute || $routeData || $searchContext?.referenceRoute}
    origin={$searchContext?.origin}
    chosen={$chosen || $searchContext?.target}
    theme={$theme}
    pools={hasPlan ? planPools : null}
    selected={$selected}
    openGroup={$openOptionGroup}
    departureMin={depMin}
    durations={durationsMap}
    bottomInset={mapBottomInset}
  />

  <header class="brand">
    <div class="brand__mark">
      <span class="dot"></span>
      Travel Planner <small>v1.2.47</small>
    </div>
    {#if !narrow && hasPlan}
      <button
        class="ghost-btn"
        type="button"
        onclick={() => (mapFocus = !mapFocus)}
        aria-pressed={mapFocus}
      >
        {mapFocus ? "Mostrar paneles" : "Enfocar mapa"}
      </button>
    {/if}
    <button
      class="theme"
      type="button"
      onclick={cycleTheme}
      aria-label={`Tema actual: ${themeLabel}. Pulsa para cambiar.`}
    >
      {themeLabel}
    </button>
  </header>

  <input
    type="file"
    accept="application/json,.json"
    bind:this={fileInput}
    onchange={loadTripFile}
    hidden
  />

  {#if resumeSnap && !$chosen}
    <div class="resume" in:fly={{ y: -8, duration: dur(200) }}>
      <span class="resume__t">
        Viaje guardado:
        <strong>{resumeSnap.searchContext?.origin?.name} → {resumeSnap.chosen?.name}</strong>
      </span>
      <button class="resume__go" type="button" onclick={() => applyTrip(resumeSnap)}>Continuar</button>
      <button class="resume__x" type="button" onclick={forgetSavedTrip}>Empezar de cero</button>
    </div>
  {/if}

  {#if narrow}
    <!-- Móvil / tablet: mapa a pantalla completa + barra de tareas + hoja enfocada -->
    {#if searchDone}
      <div class="m-trip">
        <span class="m-trip__r tnum">
          <strong>{originText}</strong> → <strong>{tripDest}</strong>
          {#if tripKm}<span class="m-trip__km">{tripKm} km</span>{/if}
        </span>
        <button class="m-trip__edit" type="button" onclick={() => { editingSearch = true; mobileTask.set("search"); }}>cambiar</button>
      </div>
    {/if}

    <MobileBar
      hasBase={!!$chosen && !editingSearch}
      hasPlan={hasPlan}
      hasSearch={searchDone}
      endLabel={hasPlan && itin.endTime ? `~${fromMin(itin.endTime)}` : ""}
    />

    {#if $mobileTask}
      {#if sheetScrim}
        <div class="m-scrim" role="presentation" onclick={closeSheet}></div>
      {/if}
      <section
        class="m-sheet"
        class:is-scrim={sheetScrim}
        class:is-tall={sheetTall}
        class:is-ducked={$mapPickMode && !sheetScrim && !sheetExpanded}
        aria-label={SHEET_TITLES[$mobileTask] || "Panel"}
      >
        <header class="m-sheet__head">
          {#if !sheetScrim}
            <button
              class="m-sheet__grab"
              type="button"
              aria-label={sheetExpanded ? "Contraer panel" : "Ampliar panel"}
              aria-expanded={sheetExpanded}
              onclick={() => (sheetExpanded = !sheetExpanded)}
            ></button>
          {/if}
          <h2>{SHEET_TITLES[$mobileTask] || ""}</h2>
          <button class="m-sheet__x" type="button" onclick={closeSheet} aria-label="Cerrar">✕</button>
        </header>
        <div class="m-sheet__body scroll-y">
          {@render mobileTaskView($mobileTask)}
        </div>
      </section>
    {/if}
  {:else}
    <!-- Escritorio: dos rails flotantes (los huecos dejan pasar el ratón al mapa) -->
    <aside class="rail rail--left">
      <div class="rail__scroll scroll-y">
        {@render planContent()}
      </div>
    </aside>

    {#if $chosen}
      <aside class="rail rail--right" style="--legend-clear: {legendClear}px" in:fly={{ x: 20, duration: dur(260) }}>
        <div class="rail__scroll">
          {@render itinContent()}
        </div>
      </aside>
    {/if}
  {/if}
</div>

<style>
  .app {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .brand {
    position: absolute;
    top: var(--sp-4);
    left: 50%;
    transform: translateX(-50%);
    z-index: var(--z-overlay);
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-4);
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-pill);
    backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--sh-2);
  }
  .brand__mark {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    font-weight: 800;
    font-size: var(--fs-13);
    letter-spacing: 0.01em;
    white-space: nowrap;
  }
  .app--narrow .brand {
    top: var(--sp-3);
    padding: var(--sp-1) var(--sp-1) var(--sp-1) var(--sp-3);
    gap: var(--sp-2);
  }
  .app--narrow .brand__mark {
    font-size: var(--fs-12);
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-tint);
  }
  .theme,
  .ghost-btn {
    padding: 5px 12px;
    font-size: var(--fs-12);
    font-weight: 700;
    color: var(--text-soft);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
  }
  .theme:hover,
  .ghost-btn:hover {
    color: var(--text);
  }
  .ghost-btn[aria-pressed="true"] {
    background: var(--accent-tint);
    border-color: var(--accent);
    color: var(--accent);
  }

  /* ---- rails de escritorio ----
     El contenedor del rail NO captura el ratón: sólo lo hacen las tarjetas.
     Así los huecos entre/bajo tarjetas son mapa útil (pan, zoom, selección). */
  .rail {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: var(--z-panel);
    width: var(--rail-w);
    display: flex;
    padding: var(--sp-4);
    transition: transform var(--dur-3) var(--ease-out);
    pointer-events: none;
  }
  .rail--left {
    left: 0;
  }
  .rail--right {
    right: 0;
    justify-content: flex-end;
    width: var(--rail-w-wide);
  }
  .app--focus .rail--left {
    transform: translateX(calc(-1 * var(--rail-w) + 4px));
  }
  .app--focus .rail--right {
    transform: translateX(calc(var(--rail-w-wide) - 4px));
  }
  .rail__scroll {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 2px;
    pointer-events: none;
    /* Reservar el canal de la barra de scroll: con scrollbar fina (overlay) las
       tarjetas hijas (pointer-events:auto) llegaban hasta el borde y tapaban el
       pulgar de la barra, así que no se podía arrastrar el scroll general. */
    scrollbar-gutter: stable;
  }
  .rail__scroll > :global(*) {
    max-width: 100%;
  }
  .rail--left .rail__scroll {
    pointer-events: auto;
  }
  /* las tarjetas sí reciben el ratón */
  .rail__scroll > :global(*) {
    pointer-events: auto;
  }
  .rail--right .rail__scroll {
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    /* Reservar la esquina inferior derecha para la leyenda: el itinerario se
       expande justo hasta antes de ella (alto medido en vivo) y hace scroll
       interno si no cabe. Fallback 210px antes de la primera medición. */
    padding-bottom: var(--legend-clear, 210px);
  }
  .rail--right .card--fill {
    flex: 0 1 auto;
  }

  /* ---- móvil / tablet: mapa a pantalla completa + barra + hoja enfocada ---- */
  .m-trip {
    position: absolute;
    left: 10px;
    right: 10px;
    top: calc(var(--sp-3) + 42px);
    z-index: var(--z-overlay);
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 6px 6px 6px 12px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-pill);
    backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--sh-2);
    font-size: var(--fs-12);
  }
  .m-trip__r {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-soft);
  }
  .m-trip__r strong { color: var(--text); }
  .m-trip__km { color: var(--text-faint); font-weight: 700; margin-left: 6px; }
  .m-trip__edit {
    flex: none;
    font-size: 11px;
    font-weight: 700;
    color: var(--accent);
    padding: 4px 10px;
    border-radius: var(--r-pill);
  }

  .m-scrim {
    position: absolute;
    inset: 0;
    z-index: var(--z-panel);
    background: var(--scrim);
  }
  .m-sheet {
    position: absolute;
    left: 0;
    right: 0;
    /* Por defecto (opciones): por encima de la barra, sin tapar el mapa. */
    bottom: calc(78px + env(safe-area-inset-bottom));
    z-index: var(--z-overlay);
    display: flex;
    flex-direction: column;
    height: 44vh;
    background: var(--bg-elev);
    border: 1px solid var(--glass-border);
    border-bottom: 0;
    border-radius: var(--r-xl) var(--r-xl) 0 0;
    box-shadow: var(--sh-4);
    transition: height var(--dur-3) var(--ease-out), transform var(--dur-3) var(--ease-out);
  }
  .m-sheet.is-tall { height: 80vh; }
  .m-sheet.is-scrim {
    /* Búsqueda / itinerario: pantalla completa, tapa la barra. */
    bottom: 0;
    height: 88vh;
  }
  .m-sheet.is-ducked {
    /* "Marcar en el mapa": la hoja se retira dejando sólo el asa. */
    transform: translateY(calc(100% - 42px));
  }
  .m-sheet__head {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    padding: 16px 14px 10px;
    border-bottom: 1px solid var(--line);
  }
  .m-sheet__grab {
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    width: 44px;
    height: 5px;
    padding: 0;
    border-radius: var(--r-pill);
    background: var(--line-strong);
  }
  .m-sheet__grab::after {
    content: "";
    position: absolute;
    inset: -14px -40px;
  }
  .m-sheet__head h2 {
    margin: 0;
    font-size: var(--fs-15);
    font-weight: 800;
  }
  .m-sheet__x {
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--text-soft);
    font-size: 15px;
    font-weight: 700;
  }
  .m-sheet__body {
    flex: 1;
    min-height: 0;
    padding: 12px 14px calc(16px + env(safe-area-inset-bottom));
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .m-time {
    display: grid;
    gap: 4px;
    margin-bottom: 12px;
    font-size: var(--fs-12);
    font-weight: 700;
    color: var(--text-soft);
  }
  .m-time input {
    height: 44px;
    padding: 0 var(--sp-3);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    font-size: var(--fs-14);
  }

  /* ---- tarjetas (compartidas) ---- */
  .card {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-md);
    padding: var(--sp-3) var(--sp-3) var(--sp-4);
    backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--sh-3);
  }
  .card--flush {
    padding: 8px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-md);
    backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--sh-3);
  }
  .card--flush :global(.prefs) {
    padding: 4px 6px 9px;
    margin-bottom: 7px;
    border-bottom: 1px solid var(--line);
  }
  .card--fill {
    height: auto;
    max-height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: var(--sp-3);
  }

  .card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-2);
  }
  .card-head__actions {
    display: flex;
    gap: var(--sp-3);
    flex: none;
  }

  /* ---- guardar / cargar viaje ---- */
  .resume {
    position: absolute;
    top: calc(var(--sp-4) + 52px);
    left: 50%;
    transform: translateX(-50%);
    z-index: var(--z-overlay);
    max-width: min(92vw, 520px);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2) var(--sp-3);
    padding: 8px 14px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-pill);
    backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--sh-2);
    font-size: var(--fs-12);
    color: var(--text-soft);
  }
  .resume__t { flex: 1; min-width: 160px; }
  .resume__t strong { color: var(--text); }
  .resume__go {
    flex: none;
    padding: 5px 12px;
    border-radius: var(--r-pill);
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 700;
    font-size: 11px;
  }
  .resume__x {
    flex: none;
    font-size: 11px;
    font-weight: 700;
    color: var(--text-faint);
  }
  .resume__x:hover { color: var(--text); }
  .m-editbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line);
    font-size: var(--fs-12);
    color: var(--text-soft);
  }
  .m-load {
    width: 100%;
    margin-bottom: 12px;
    padding: 11px;
    border: 1px dashed var(--line-strong);
    border-radius: var(--r-sm);
    font-size: var(--fs-13);
    font-weight: 700;
    color: var(--text-soft);
    background: var(--surface);
  }
  h2 {
    font-size: var(--fs-14);
    font-weight: 800;
    margin-bottom: var(--sp-3);
    letter-spacing: 0.01em;
  }
  .card-head h2 {
    margin-bottom: var(--sp-3);
  }
  .link-btn {
    font-size: 11px;
    font-weight: 700;
    color: var(--accent);
  }
  .link-btn:hover {
    text-decoration: underline;
  }

  /* ---- barra de viaje (plan cargado) ---- */
  .trip-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 7px 12px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-pill);
    backdrop-filter: blur(var(--glass-blur));
    box-shadow: var(--sh-2);
    font-size: var(--fs-12);
  }
  .trip-route {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-soft);
  }
  .trip-route strong {
    color: var(--text);
  }
  .trip-km {
    color: var(--text-faint);
    font-weight: 700;
    margin-left: 6px;
  }
  .trip-edit {
    flex: none;
    font-size: 11px;
    font-weight: 700;
    color: var(--accent);
    padding: 3px 9px;
    border-radius: var(--r-pill);
  }
  .trip-edit:hover {
    background: var(--accent-tint);
  }

  .go {
    height: 42px;
    padding: 0 var(--sp-4);
    background: var(--accent);
    color: var(--accent-text);
    border-radius: var(--r-sm);
    font-weight: 700;
    box-shadow: var(--sh-1);
  }
  .go:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .go:disabled {
    opacity: 0.65;
  }
  .status {
    margin-top: var(--sp-3);
    font-size: var(--fs-13);
    color: var(--text-soft);
  }
  .status--error {
    color: var(--danger);
  }

  @media (max-width: 1180px) {
    :root {
      --rail-w: 360px;
    }
  }
</style>
