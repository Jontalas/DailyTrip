// Descubrimiento de paradas: objetivo mínimo, cobertura métrica y estados honestos.
import { haversineKm } from '../client/src/lib/format.js';

export const routeStopTarget=km=>km>0?Math.max(1,Math.round(km/4)):0;

export function routeGeometryIndex(coords) {
  const cumulative = [0];
  for (let i = 1; i < coords.length; i++) cumulative.push(cumulative[i-1] + haversineKm(coords[i-1], coords[i]));
  const total = cumulative.at(-1);
  if (!Number.isFinite(total) || total <= 0) throw new Error('La ruta no tiene una geometría válida.');
  function pointAt(km) {
    km = Math.max(0, Math.min(total, km));
    let i = 1;
    while (i < coords.length-1 && cumulative[i] < km) i++;
    const fraction = (km-cumulative[i-1]) / (cumulative[i]-cumulative[i-1] || 1);
    const a=coords[i-1], b=coords[i];
    return {lat:a.lat+(b.lat-a.lat)*fraction, lon:a.lon+(b.lon-a.lon)*fraction};
  }
  function locate(p) {
    let distance = Infinity, along = 0;
    const scale = Math.cos(p.lat*Math.PI/180);
    for (let i=1; i<coords.length; i++) {
      const a=coords[i-1], b=coords[i];
      const ax=(a.lon-p.lon)*scale, ay=a.lat-p.lat;
      const dx=(b.lon-a.lon)*scale, dy=b.lat-a.lat;
      const f=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy || 1)));
      const q={lat:a.lat+(b.lat-a.lat)*f,lon:a.lon+(b.lon-a.lon)*f};
      const d=haversineKm(p,q);
      if(d<distance){distance=d;along=cumulative[i-1]+f*(cumulative[i]-cumulative[i-1]);}
    }
    return {distanceToRouteKm:distance,routeProgressPct:along/total*100};
  }
  // 10 km entre centros; círculos de 15 km cubren el corredor de ±10 km.
  const intervals=Math.max(1,Math.ceil(total/10));
  const centers=Array.from({length:intervals+1},(_,i)=>pointAt(total*i/intervals));
  return {total,pointAt,locate,centers};
}

const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
export function mergeRoutePlaces(items) {
  const priority = {wikipedia:3,geoapify:2,osm:1,google:1};
  const ordered=[...items].sort((a,b)=>(priority[b.source]||0)-(priority[a.source]||0));
  const out=[];
  for(const item of ordered) {
    const duplicate=out.find(x =>
      (item.id != null && x.id === item.id) ||
      (item.wikipediaUrl && x.wikipediaUrl === item.wikipediaUrl) ||
      (normalize(item.name) === normalize(x.name) && haversineKm(item,x) < .15));
    if(!duplicate) out.push({...item});
    else {
      for(const [key,value] of Object.entries(item)) if(duplicate[key]==null || duplicate[key]==='') duplicate[key]=value;
      if(item.categories)duplicate.categories=[...new Set([...(duplicate.categories || []),...item.categories])];
    }
  }
  return out;
}

// The score is compared globally before the minimum target is applied.
export function selectRoutePlaces(items,target,score = x => x.interestScore || 0) {
  return [...items].sort((a,b)=>score(b)-score(a) || String(a.name).localeCompare(String(b.name),'es')).slice(0,target);
}

/** Notabilidad indiscutible de una parada: artículo de Wikipedia internacional
 *  (nº de idiomas) o muy visitado (`wikiPageviews` = acumulado de ~20 días que
 *  trae wikiNearby). Un hito así se incluye siempre, aunque no entre en el
 *  objetivo de ~1 parada / 4 km. */
export function isRouteLandmark(x, { minLanglinks = 10, minPageviews = 8000 } = {}) {
  if (!x || x.verified === false) return false;
  return (Number(x.wikiLanglinks) || 0) >= minLanglinks
      || (Number(x.wikiPageviews) || 0) >= minPageviews;
}

/** Proveedor: quick(center) y async *all(center), páginas {items, complete}.
 * Solo all agotado sin fallos demuestra cobertura; quick nunca la demuestra.
 * Las páginas se evalúan inmediatamente, sin esperar a agotar una ciudad densa.
 */
export async function searchRoutePlaces({centers,providers,target,prepare,pause=async()=>{}}) {
  const collected=[], problems=[];
  let candidates=[], requests=0, phase='initial';
  const absorb=items=>{collected.push(...items);candidates=prepare(collected);};
  const quick=centers.flatMap(center=>providers.filter(p=>p.quick).map(provider=>({center,provider})));
  // Completar la primera pasada para representar todo el recorrido.
  for(let i=0;i<quick.length;i+=2) {
    const results=await Promise.all(quick.slice(i,i+2).map(async ({center,provider})=>{
      requests++;
      try{return await provider.quick(center);}catch{return [];}
    }));
    for(const items of results) absorb(items);
    if(i+2<quick.length) await pause();
  }
  if(candidates.length<target) {
    phase='expanded';
    outer: for(const center of centers) for(const provider of providers) {
      let complete=false;
      try {
        for await(const page of provider.all(center)) {
          requests++;absorb(page.items);
          if(candidates.length>=target) break outer;
          complete=page.complete === true;
          await pause();
        }
        if(!complete) problems.push({provider:provider.name,reason:'incomplete',center});
      } catch {
        problems.push({provider:provider.name,reason:'unavailable',center});
      }
    }
  }
  const outcome=candidates.length>=target?'target-reached':problems.length?'incomplete':'sources-exhausted';
  return {candidates,coverage:{target,available:candidates.length,outcome,phase,requests,problems}};
}

// Paginación sin techo interno; si el proveedor repite página no es agotamiento.
export async function* pagedPlaces(fetchPage,pageSize=100) {
  const seen=new Set();
  for(let offset=0;;) {
    const page=await fetchPage(offset,pageSize);
    if(!Number.isInteger(page.rawCount) || page.rawCount<0) throw new Error('Página incompleta');
    const signature=JSON.stringify(page.ids);
    if(page.rawCount && seen.has(signature)) throw new Error('El proveedor repitió una página');
    seen.add(signature);
    const complete=page.rawCount<pageSize;
    yield {items:page.items,complete};
    if(complete) return;
    offset+=page.rawCount;
  }
}

// GeoSearch limita resultados; subdividir la caja evita confundir límite y fin.
export async function* subdividedPlaces(bounds,fetchBox) {
  const pending=[bounds];
  while(pending.length) {
    const box=pending.shift();
    const result=await fetchBox(box);
    if(result.saturated) {
      const [north,west,south,east]=box,lat=(north+south)/2,lon=(west+east)/2;
      if(north-south<.00001 || east-west<.00001) throw new Error('Límite del proveedor en una zona densa');
      pending.push([north,west,lat,lon],[north,lon,lat,east],[lat,west,south,lon],[lat,lon,south,east]);
    }
    yield {items:result.items,complete:pending.length===0};
  }
}
