// Conserva datos útiles cuando una consulta falla o devuelve respaldo degradado.
export async function loadCategory(request, previous = []) {
  try {
    const result = await request();
    let items = result.items || [];
    const coverage = result.coverage;
    const incomplete = coverage?.outcome === "incomplete";
    const degraded = incomplete || result.status === "partial" || result.status === "fallback" || (result.source === "none" && coverage?.outcome !== "sources-exhausted") || result.source === "generated" || result.source === "cache-stale" || result.degraded;
    if(result.status==='partial' && !coverage && items.length) {
      const merged=new Map(previous.filter(x=>x.verified!==false).map(x=>[x.id,x]));
      items.forEach(x=>merged.set(x.id,x));
      items=[...merged.values()].sort((a,b)=>(b.interestScore || 0)-(a.interestScore || 0)).slice(0,result.selection?.target || Infinity);
    }
    if (coverage && incomplete && result.source !== "generated") {
      const merged = new Map(previous.filter(x=>x.verified!==false).map(x=>[x.id,x]));
      items.forEach(x=>merged.set(x.id,x));
      items=[...merged.values()].sort((a,b)=>(a.routeProgressPct||0)-(b.routeProgressPct||0));
    }
    const prefix = coverage ? `${items.filter(x=>x.verified!==false).length} paradas disponibles · objetivo mínimo ${coverage.target}. ` : "";
    const selection=result.selection;
    const selectionMessage=selection ? `${items.length} opciones de mayor interés entre ${selection.available} lugares encontrados · objetivo ${selection.target}, adaptado ${selection.profile?.population ? 'a '+selection.profile.population.toLocaleString('es')+' habitantes' : 'al tipo de localidad (población no disponible)'}. ${selection.complete ? '' : 'Selección incompleta: alguna fuente no pudo terminar. Puedes reintentar.'}` : null;
    const message = selectionMessage ?? (coverage?.outcome === "incomplete"
      ? prefix + "Búsqueda incompleta: alguna fuente falló o no permitió terminar. No se ha confirmado que falten lugares. Reintenta para seguir buscando."
      : coverage?.outcome === "sources-exhausted"
        ? prefix + "Se han agotado los resultados de las fuentes consultadas en el corredor de la ruta."
        : coverage ? prefix + (result.degraded ? "Algunas métricas de desvío no están disponibles; puedes reintentarlas." : "Objetivo alcanzado.") : null);
    return {
      items: degraded && previous.length && !coverage && !(result.status==='partial' && items.length) ? previous : result.source === "generated" && previous.length ? previous : items,
      status: degraded ? "degraded" : "ok",
      coverage,
      canRetry: degraded || coverage?.outcome === "sources-exhausted",
      message: message ?? (degraded ? "No se pudo completar la consulta. Se muestra el contenido de respaldo disponible." : "")
    };
  } catch {
    return { items: previous, status: "error", message: "No se pudo consultar esta categoría. Puedes reintentarlo." };
  }
}
