import "dotenv/config";
import express from "express";
import path from "node:path";
import fs from "node:fs";
import tls from "node:tls";
import { searchTolerance, nearbyBaseRoutes } from "./lib/base-search.js";
import { createHash } from "node:crypto";
import { routeOptionMetrics } from './lib/route-option-metrics.js';
import { routeDay } from "./lib/day-routing.js";
import { destinationScale, topInterest, latestPopulation } from "./lib/destination-options.js";
import { placeContent } from "./lib/place-content.js";
import { routeStopTarget, routeGeometryIndex, mergeRoutePlaces, selectRoutePlaces, searchRoutePlaces, pagedPlaces, subdividedPlaces } from "./lib/route-search.js";
import { fileURLToPath } from "node:url";

// Node puede usar un almacén distinto al de Windows. Añadir las CA del sistema
// mantiene la validación HTTPS y permite redes con certificados corporativos.
// Las versiones antiguas de Node conservan su configuración TLS habitual.
if(typeof tls.getCACertificates === "function" && typeof tls.setDefaultCACertificates === "function"){
  tls.setDefaultCACertificates([...new Set([
    ...tls.getCACertificates("default"), ...tls.getCACertificates("system")
  ])]);
}

const app=express();
const PORT=Number(process.env.PORT||3000);
const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);

const NOMINATIM=process.env.NOMINATIM_URL||"https://nominatim.openstreetmap.org";
const OSRM=process.env.OSRM_URL||"https://router.project-osrm.org";
const OVERPASS_ENDPOINTS=[
  process.env.OVERPASS_URL,
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
].filter(Boolean);

const GEOAPIFY_KEY=(process.env.GEOAPIFY_API_KEY||"").trim();
const GOOGLE_KEY=(process.env.GOOGLE_PLACES_API_KEY||"").trim();
const USER_AGENT=process.env.APP_USER_AGENT||"TravelPlannerPersonal/1.2.27 (personal-use)";
const DEBUG_EXTERNAL=process.env.DEBUG_EXTERNAL==="1";
const debug=(...a)=>{if(DEBUG_EXTERNAL)console.warn(...a);};

app.use(express.json({limit:"250kb"}));
app.use(express.static(path.join(__dirname,"public")));

const memCache=new Map();
let lastNominatimAt=0;

const persistentPath=path.join(__dirname,"data","cache.json");
let persistent={version:1,entries:{}};
try{
  persistent=JSON.parse(fs.readFileSync(persistentPath,"utf8"));
}catch{
  persistent={version:1,entries:{}};
}

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const norm=v=>String(v||"").trim().toLocaleLowerCase("es");
const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number(n)));
const DAY=24*60*60*1000;
const FRESH_TTL=14*DAY;

// Peso por tipo de localidad. Se usa tanto al recortar la lista de candidatas
// descubiertas como al priorizar cuáles se enriquecen. Una ciudad nunca debe
// quedar fuera del recorte por culpa de una avalancha de núcleos menores.
const BASE_TYPE_WEIGHT={city:4,town:3,village:2,suburb:1,place:0};

let cacheWriteTimer=null,cacheWriting=false,cacheDirty=false;
function savePersistent(){
  cacheDirty=true;
  if(cacheWriteTimer || cacheWriting)return;
  cacheWriteTimer=setTimeout(async()=>{
    cacheWriteTimer=null;cacheWriting=true;cacheDirty=false;
    try{
      // A complete replacement avoids corrupting the last usable cache on a
      // failed write; batching prevents rewriting tens of MB for every POI.
      await fs.promises.writeFile(persistentPath+'.tmp',JSON.stringify(persistent));
      await fs.promises.rename(persistentPath+'.tmp',persistentPath);
    }catch(e){debug('Cache write:',e.message);}
    finally{cacheWriting=false;if(cacheDirty)savePersistent();}
  },2000);
  cacheWriteTimer.unref();
}
function cacheGet(key,{allowStale=false}={}){
  const e=persistent.entries[key];
  if(!e)return null;
  const age=Date.now()-e.savedAt;
  if(age<=FRESH_TTL||allowStale)return{...e,stale:age>FRESH_TTL};
  return null;
}
function cacheSet(key,data){
  persistent.entries[key]={savedAt:Date.now(),data};
  savePersistent();
}

async function fetchJson(url,options={},timeout=10000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const r=await fetch(url,{...options,signal:controller.signal});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }catch(e){
    const host=new URL(url).hostname;
    const code=e.cause?.code || e.code;
    if(["UNABLE_TO_VERIFY_LEAF_SIGNATURE","SELF_SIGNED_CERT_IN_CHAIN","UNABLE_TO_GET_ISSUER_CERT_LOCALLY"].includes(code)){
      throw new Error(`No se pudo verificar el certificado HTTPS de ${host}. Revisa los certificados de confianza del sistema o utiliza una versión actual de Node.js.`,{cause:e});
    }
    if(e.message === "fetch failed")throw new Error(`No se pudo conectar con ${host}. Comprueba la conexión e inténtalo de nuevo.`,{cause:e});
    throw e;
  }finally{clearTimeout(timer);}
}

function haversineKm(a,b){
  const R=6371,rad=d=>d*Math.PI/180;
  const dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function sampleRoute(coords,n=60){
  if(coords.length<=n)return coords;
  return Array.from({length:n},(_,i)=>coords[Math.round(i*(coords.length-1)/(n-1))]);
}
function distanceToRoute(p,coords){
  return Math.min(...sampleRoute(coords).map(x=>haversineKm(p,x)));
}
function routeProgress(p,coords){
  const s=sampleRoute(coords);let best=Infinity,idx=0;
  s.forEach((x,i)=>{const d=haversineKm(p,x);if(d<best){best=d;idx=i;}});
  return idx/Math.max(1,s.length-1);
}

async function nominatimWait(){
  const wait=1050-(Date.now()-lastNominatimAt);
  if(wait>0)await sleep(wait);
}
// `addresstype` de Nominatim que representa un NÚCLEO POBLADO (no país, estado,
// región, continente…). Se prefiere para que "Granada" resuelva a la ciudad de
// Andalucía y no al país del Caribe (cuyo resultado llega 1º por "importance").
// OJO: NO incluir "administrative" — países y estados también lo son.
const PLACE_LIKE=new Set(["city","town","village","hamlet","municipality","suburb","borough","quarter","neighbourhood","locality","isolated_dwelling"]);

async function geocode(q,{place=false}={}){
  const key=`geo:${place?'poi:':''}${norm(q)}`;
  if(memCache.has(key))return memCache.get(key);

  await nominatimWait();
  const u=new URL("/search",NOMINATIM);
  u.searchParams.set("q",q);
  u.searchParams.set("format","jsonv2");
  u.searchParams.set("limit","6");
  u.searchParams.set("addressdetails","1");

  const d=await fetchJson(u,{headers:{"User-Agent":USER_AGENT,"Accept-Language":"es"}},9000);
  lastNominatimAt=Date.now();
  if(!d.length)throw new Error(`No encuentro "${q}".`);

  // Preferimos el primer resultado que sea un núcleo poblado; si no hay, el 1º.
  const x=place?d[0]:(d.find(r=>PLACE_LIKE.has(r.addresstype))||d[0]);

  const a=x.address||{};
  const type=a.city?"city":a.town?"town":a.village?"village":"place";
  const out={name:x.name||q,displayName:x.display_name,lat:Number(x.lat),lon:Number(x.lon),type,country:a.country_code||""};

  // Afinar el centro urbano con la coordenada del artículo de Wikipedia.
  if(!place && PLACE_LIKE.has(x.addresstype)){
    const better=await wikiPlaceCoord(out.name,{lat:out.lat,lon:out.lon});
    if(better){out.lat=better.lat;out.lon=better.lon;}
  }

  memCache.set(key,out);
  return out;
}
async function reverseGeocode(lat,lon){
  const key=`rev:${lat.toFixed(4)},${lon.toFixed(4)}`;
  if(memCache.has(key))return memCache.get(key);

  await nominatimWait();
  const u=new URL("/reverse",NOMINATIM);
  u.searchParams.set("lat",lat);u.searchParams.set("lon",lon);
  u.searchParams.set("format","jsonv2");u.searchParams.set("zoom","12");u.searchParams.set("addressdetails","1");

  const d=await fetchJson(u,{headers:{"User-Agent":USER_AGENT,"Accept-Language":"es"}},9000);
  lastNominatimAt=Date.now();
  const a=d.address||{};
  const name=a.city||a.town||a.village||a.municipality||a.hamlet||a.county||d.name||"Localidad";
  const type=a.city?"city":a.town?"town":a.village?"village":"place";
  const out={name,displayName:d.display_name||name,lat:Number(d.lat),lon:Number(d.lon),type};
  memCache.set(key,out);return out;
}

async function osrmRoute(origin,dest){
  const d=await fetchJson(`${OSRM}/route/v1/driving/${origin.lon},${origin.lat};${dest.lon},${dest.lat}?overview=full&geometries=geojson`,{},12000);
  if(!d.routes?.length)throw new Error("OSRM sin ruta");
  const r=d.routes[0];
  return{roadKm:r.distance/1000,durationMin:r.duration/60,coords:r.geometry.coordinates.map(([lon,lat])=>({lat,lon})),source:"osrm"};
}
async function geoapifyRoute(origin,dest){
  if(!GEOAPIFY_KEY)throw new Error("Geoapify routing no configurado");
  const u=new URL("https://api.geoapify.com/v1/routing");
  u.searchParams.set("waypoints",`${origin.lat},${origin.lon}|${dest.lat},${dest.lon}`);
  u.searchParams.set("mode","drive");u.searchParams.set("format","json");u.searchParams.set("apiKey",GEOAPIFY_KEY);
  const d=await fetchJson(u,{},12000);
  const r=d.results?.[0];
  if(!r)throw new Error("Geoapify sin ruta");
  const coords=[];
  for(const leg of r.legs||[])for(const step of leg.steps||[])for(const c of step.geometry||[])coords.push({lat:c[1],lon:c[0]});
  return{roadKm:r.distance/1000,durationMin:r.time/60,coords:coords.length?coords:[origin,dest],source:"geoapify"};
}
async function routeGeometry(origin,dest){
  try{return await osrmRoute(origin,dest);}
  catch(e){debug("OSRM:",e.message);return await geoapifyRoute(origin,dest);}
}

async function routeTable(origin,cands){
  try{
    const coords=[origin,...cands].map(p=>`${p.lon},${p.lat}`).join(";");
    const destinations=cands.map((_,i)=>i+1).join(";");
    const d=await fetchJson(`${OSRM}/table/v1/driving/${coords}?sources=0&destinations=${destinations}&annotations=distance,duration`,{},12000);
    if(d.code!=="Ok")throw new Error("OSRM table");
    return cands.map((c,i)=>({...c,roadKm:d.distances?.[0]?.[i]/1000,durationMin:d.durations?.[0]?.[i]/60}));
  }catch(e){
    debug("OSRM table:",e.message);
    const out=[];
    for(const c of cands){
      const r=await routeGeometry(origin,c);
      out.push({...c,roadKm:r.roadKm,durationMin:r.durationMin});
    }
    return out;
  }
}

function routePointAtKm(route,km){
  const ratio=Math.max(0,Math.min(1,km/Math.max(route.roadKm,1)));
  return route.coords[Math.min(route.coords.length-1,Math.round(ratio*(route.coords.length-1)))];
}

function durationFor(category=""){
  if(category.includes("museum"))return 90;
  if(category.includes("gallery"))return 75;
  if(category.includes("viewpoint"))return 35;
  if(category.includes("zoo")||category.includes("aquarium"))return 150;
  if(category.includes("theme_park")||category.includes("amusement"))return 240;
  if(category.includes("nature")||category.includes("park"))return 75;
  if(category.includes("historic")||category.includes("sights"))return 60;
  if(category.includes("restaurant")||category.includes("cafe"))return 85;
  return 60;
}


function durationRange(category="",recommended=null){
  const c=String(category||"").toLowerCase();
  let min=45,max=75;

  if(c.includes("museum"))[min,max]=[60,120];
  else if(c.includes("gallery"))[min,max]=[45,90];
  else if(c.includes("viewpoint"))[min,max]=[20,45];
  else if(c.includes("zoo")||c.includes("aquarium"))[min,max]=[120,210];
  else if(c.includes("theme_park")||c.includes("amusement"))[min,max]=[180,300];
  else if(c.includes("nature_reserve"))[min,max]=[90,180];
  else if(c.includes("park")||c.includes("garden"))[min,max]=[45,90];
  else if(c.includes("historic")||c.includes("sights")||c.includes("cultural"))[min,max]=[45,90];
  else if(c.includes("restaurant")||c.includes("cafe")||c.includes("food"))[min,max]=[70,100];
  else if(c.includes("generated.walk"))[min,max]=[60,120];
  else if(c.includes("generated.relax"))[min,max]=[45,90];

  if(recommended){
    min=Math.min(min,Math.max(20,Math.round(recommended*.7)));
    max=Math.max(max,Math.round(recommended*1.3));
  }

  return{min,max,recommended:Math.round((min+max)/2)};
}

function scoreBreakdown(item){
  const c=String(item.category||"").toLowerCase();

  let category=50;
  if(c.includes("museum"))category=88;
  else if(c.includes("historic")||c.includes("sights")||c.includes("cultural"))category=84;
  else if(c.includes("attraction"))category=80;
  else if(c.includes("viewpoint"))category=76;
  else if(c.includes("nature")||c.includes("park"))category=74;
  else if(c.includes("restaurant"))category=70;
  else if(c.includes("accommodation"))category=65;

  const rating=item.rating==null?55:Math.round(Math.max(0,Math.min(100,(Number(item.rating)-2.5)/2.5*100)));

  // Popularidad / relevancia:
  //  - Google: nº de reseñas.
  //  - Wikipedia: nº de idiomas del artículo (relevancia internacional) +
  //    tamaño del artículo (lo trabajado que está) + vistas de 20 días.
  let popularity;
  if(item.userRatingCount){
    popularity=Math.round(Math.min(100,25+Math.log10(Math.max(1,item.userRatingCount))*22));
  }else if(item.source==="wikipedia"){
    // idiomas del artículo (relevancia internacional) + tamaño (lo trabajado
    // que está) + visitas. La mayoría de POI regionales sólo tienen artículo en
    // español, así que el tamaño y las visitas llevan el peso.
    const llScore=Math.min(100,(item.wikiLanglinks||0)*7);
    const bytesScore=Math.min(100,Math.max(0,Math.log10(Math.max(500,item.wikiBytes||0))*30-55));
    const pvScore=Math.min(100,Math.log10(Math.max(1,item.wikiPageviews||0))*30);
    popularity=Math.round(llScore*0.34+bytesScore*0.40+pvScore*0.26);
  }else{
    popularity=45;
  }

  // "Información": web, horario, descripción real, imagen y ficha de Wikipedia.
  const hasRealDesc=item.description && item.source!=="generated" && !/localizado por las fuentes cartográficas|incluido por las fuentes/i.test(item.description);
  const completeness=Math.min(100,
    35+(item.website?18:0)+(item.openingHours?14:0)+(hasRealDesc?18:0)+(item.imageUrl?10:0)+(item.wikipediaUrl?12:0));
  const reliability=item.verified===false?28:item.source==="wikipedia"?90:85;

  return{category,rating,popularity,completeness,reliability};
}

function finalInterestFromBreakdown(b){
  return Math.round(
    b.category*.30+
    b.rating*.25+
    b.popularity*.20+
    b.completeness*.10+
    b.reliability*.15
  );
}

function enrichDecisionFields(item){
  const breakdown=scoreBreakdown(item);
  const range=durationRange(item.category,item.durationMin);
  return{
    ...item,
    interestBreakdown:breakdown,
    interestScore:finalInterestFromBreakdown(breakdown),
    durationMin:range.recommended,
    durationRangeMin:range.min,
    durationRangeMax:range.max
  };
}

function interestScore(item){
  let score=45;
  const c=String(item.category||"").toLowerCase();

  if(c.includes("museum"))score+=18;
  else if(c.includes("historic")||c.includes("sights")||c.includes("cultural"))score+=15;
  else if(c.includes("viewpoint"))score+=12;
  else if(c.includes("nature")||c.includes("park"))score+=11;
  else if(c.includes("attraction"))score+=13;
  else if(c.includes("restaurant"))score+=8;
  else if(c.includes("accommodation"))score+=7;

  if(item.rating!=null){
    score+=Math.max(0,(Number(item.rating)-3.5)*12);
  }
  if(item.userRatingCount){
    score+=Math.min(12,Math.log10(Math.max(1,item.userRatingCount))*3);
  }
  if(item.website)score+=4;
  if(item.openingHours)score+=3;
  if(item.verified===false)score-=22;

  return Math.max(1,Math.min(100,Math.round(score)));
}

function relatedSearchUrl(item,destinationName=""){
  if(item.website)return item.website;
  const q=encodeURIComponent(`${item.name} ${destinationName}`.trim());
  return `https://www.google.com/search?q=${q}`;
}

function enrichInterest(items,destinationName=""){
  return [...items].map(x=>{
    const enriched=enrichDecisionFields(x);
    return{
      ...enriched,
      infoUrl:enriched.infoUrl||enriched.wikipediaUrl||relatedSearchUrl(enriched,destinationName)
    };
  }).sort((a,b)=>b.interestScore-a.interestScore);
}

function parseClockToMin(v){
  const m=String(v||"").match(/(\d{1,2}):(\d{2})/);
  if(!m)return null;
  return Number(m[1])*60+Number(m[2]);
}

function likelyOpenForLunch(openingHours){
  const s=String(openingHours||"").trim();
  if(!s)return null; // unknown
  if(/24\/7/i.test(s))return true;

  // Conservative common-format check: any HH:MM-HH:MM range overlapping 12:30-14:30.
  const ranges=[...s.matchAll(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/g)];
  if(!ranges.length)return null;

  const lunchStart=12*60+30,lunchEnd=14*60+30;
  return ranges.some(r=>{
    const start=Number(r[1])*60+Number(r[2]);
    let end=Number(r[3])*60+Number(r[4]);
    if(end<start)end+=24*60;
    return start<=lunchStart && end>=lunchEnd;
  });
}

function categoryDescription(category,name,context={}){
  const c=String(category||"").toLowerCase();
  const place=name||"este lugar";
  const locality=context.city||context.locality||"";
  const address=context.formatted||context.addressLine2||"";
  const where=locality?` en ${locality}`:"";
  const located=address?` Se encuentra en ${address}.`:"";

  let text;
  if(c.includes("museum"))text=`${place} es un museo${where}, orientado a una visita cultural y al conocimiento de sus colecciones o temática.`;
  else if(c.includes("gallery"))text=`${place} es una galería o espacio expositivo${where}, apropiado para una visita cultural de duración moderada.`;
  else if(c.includes("viewpoint"))text=`${place} es un mirador${where}, pensado para disfrutar de las vistas y hacer una parada relativamente breve.`;
  else if(c.includes("historic")||c.includes("heritage")||c.includes("sights"))text=`${place} es un punto de interés histórico o patrimonial${where}, útil para conocer una parte del pasado o del paisaje cultural de la zona.`;
  else if(c.includes("nature_reserve"))text=`${place} es un espacio natural protegido${where}, apropiado para paseo, observación del entorno y una visita al aire libre.`;
  else if(c.includes("park")||c.includes("garden"))text=`${place} es un parque, jardín o espacio verde${where}, apropiado para pasear, descansar y conocer el entorno.`;
  else if(c.includes("zoo"))text=`${place} es un zoológico o recinto de fauna${where}, normalmente pensado para una visita de varias horas.`;
  else if(c.includes("aquarium"))text=`${place} es un acuario${where}, con una visita centrada en fauna y ecosistemas acuáticos.`;
  else if(c.includes("theme_park")||c.includes("amusement"))text=`${place} es un recinto de ocio o parque temático${where}, normalmente adecuado para dedicarle varias horas.`;
  else if(c.includes("attraction")||c.includes("tourism"))text=`${place} es una atracción o punto de interés turístico${where}, incluido por las fuentes cartográficas entre los lugares que pueden merecer una visita.`;
  else if(c.includes("restaurant")){
    const cui=String(context.cuisine||"").replace(/[;,].*/,"").replace(/_/g," ").trim();
    text=cui?`${place}${where}: restaurante de cocina ${cui}.`:`${place} es un restaurante${where}.`;
  }
  else if(c.includes("cafe"))text=`${place} es una cafetería${where}, para una parada corta de café o algo ligero.`;
  else if(c.includes("accommodation")||c.includes("hotel")||c.includes("hostel"))text=`${place} es un alojamiento${where}.`;
  else text=`${place} es un lugar de interés${where}, localizado por las fuentes cartográficas como una posible parada o visita.`;

  return text+located;
}
function dedupe(items){
  const out=[];
  for(const p of items){
    if(!p||!p.name)continue;
    if(out.some(x=>(p.id&&x.id===p.id)||(norm(x.name)===norm(p.name)&&haversineKm(x,p)<.8)))continue;
    out.push(p);
  }
  return out;
}

async function geoapifyPlaces(categories,center,radius=9000,limit=30,{offset=0,routeSearch=false}={}){
  if(!GEOAPIFY_KEY)throw new Error("Geoapify no configurado");
  const u=new URL("https://api.geoapify.com/v2/places");
  u.searchParams.set("categories",categories.join(","));
  u.searchParams.set("filter",`circle:${center.lon},${center.lat},${radius}`);
  u.searchParams.set("bias",`proximity:${center.lon},${center.lat}`);
  u.searchParams.set("limit",String(limit));
  if(offset)u.searchParams.set("offset",String(offset));
  u.searchParams.set("lang","es");
  u.searchParams.set("apiKey",GEOAPIFY_KEY);

  const d=await fetchJson(u,{},8000);
  if(!Array.isArray(d.features))throw new Error("Respuesta Geoapify incompleta");
  const items=d.features.map(f=>{
    const p=f.properties||{};
    const cats=p.categories||categories;
    const cat=cats[0]||categories[0]||"";
    return{
      id:p.place_id||p.datasource?.raw?.osm_id||`${p.name}:${p.lat}:${p.lon}`,
      name:p.name||p.address_line1||p.formatted,
      hasPlaceName:Boolean(p.name),
      lat:Number(p.lat),lon:Number(p.lon),
      category:cat,
      categories:cats,
      city:p.city||"",
      town:p.town||"",
      village:p.village||"",
      suburb:p.suburb||"",
      district:p.district||"",
      municipality:p.municipality||"",
      county:p.county||"",
      formatted:p.formatted||"",
      addressLine2:p.address_line2||"",
      description:p.description||categoryDescription(cat,p.name,{
        city:p.city||p.county||"",
        formatted:p.formatted||"",
        addressLine2:p.address_line2||"",
        cuisine:p.catering?.cuisine||""
      }),
      durationMin:durationFor(cat),
      website:p.website||p.contact?.website||"",
      openingHours:p.opening_hours||"",
      cuisine:p.catering?.cuisine||"",
      // Señales de calidad si la fuente OSM tras Geoapify las trae.
      stars:Number(p.datasource?.raw?.stars)||Number(p.datasource?.raw?.["stars:count"])||null,
      priceLevel:null,
      rating:null,userRatingCount:null,
      source:"geoapify",verified:true
    };
  }).filter(x=>x.name&&Number.isFinite(x.lat)&&Number.isFinite(x.lon));
  if(routeSearch){
    items.rawCount=d.features.length;
    items.rawIds=d.features.map(f=>f.properties?.place_id || JSON.stringify(f.geometry));
    return items;
  }
  return dedupe(items);
}


function wikipediaUrlFromRef(ref){
  if(!ref)return"";
  const s=String(ref);
  if(/^https?:\/\//i.test(s))return s;
  const m=s.match(/^([a-z-]+):(.+)$/i);
  if(m)return`https://${m[1]}.wikipedia.org/wiki/${encodeURIComponent(m[2].replace(/ /g,"_"))}`;
  return"";
}

async function geoapifyPlaceDetails(item){
  if(!GEOAPIFY_KEY||item?.source!=="geoapify"||!item.id)return item;

  const key=`placeDetails:${item.id}`;
  const cached=cacheGet(key,{allowStale:true});
  if(cached)return{...item,...cached.data};

  try{
    const u=new URL("https://api.geoapify.com/v2/place-details");
    u.searchParams.set("id",item.id);
    u.searchParams.set("features","details");
    u.searchParams.set("lang","es");
    u.searchParams.set("apiKey",GEOAPIFY_KEY);

    const d=await fetchJson(u,{},6500);
    const feature=(d.features||[]).find(f=>f.properties?.feature_type==="details")||d.features?.[0];
    const p=feature?.properties||{};

    const realDescription=
      p.description||
      p.description_international?.es||
      p.heritage?.description||
      "";

    const wikiRef=p.wiki_and_media?.wikipedia||p.brand_details?.wikipedia||"";
    const wikipediaUrl=wikipediaUrlFromRef(wikiRef);
    const officialWebsite=p.website||p.heritage?.website||item.website||"";
    const formatted=p.formatted||item.formatted||"";
    const city=p.city||item.city||"";

    let description=realDescription;
    if(!description){
      description=categoryDescription(item.category,item.name,{
        city,
        formatted,
        addressLine2:p.address_line2||item.addressLine2||""
      });
      if(wikipediaUrl)description+=" Dispone de una referencia en Wikipedia para ampliar información.";
      else if(p.heritage?.ref)description+=" Figura además identificado como elemento patrimonial en la fuente.";
    }

    const enriched={
      description,
      website:officialWebsite,
      openingHours:p.opening_hours||item.openingHours||"",
      wikipediaUrl,
      infoUrl:officialWebsite||wikipediaUrl||item.infoUrl||"",
      heritageDescription:p.heritage?.description||"",
      detailSource:"geoapify-details"
    };
    cacheSet(key,enriched);
    return{...item,...enriched};
  }catch(e){
    debug("Geoapify details:",item.name,e.message);
    return item;
  }
}

async function enrichGeoapifyDetails(items,maxItems=12){
  const list=[...items];
  const indices=list.map((x,i)=>x?.source==="geoapify"&&x.id?i:-1).filter(i=>i>=0).slice(0,maxItems);
  const concurrency=4;

  for(let start=0;start<indices.length;start+=concurrency){
    const batch=indices.slice(start,start+concurrency);
    const enriched=await Promise.all(batch.map(i=>geoapifyPlaceDetails(list[i])));
    batch.forEach((idx,j)=>{list[idx]=enriched[j];});
  }
  return list;
}

/* ---------------------- Wikipedia (es) — lugares NOTABLES ------------------
   Fuente gratuita y sin clave. Que un lugar tenga artículo en Wikipedia ya es
   una señal fuerte de interés. GeoSearch localiza artículos cercanos; luego se
   pide de una vez: extracto real (descripción de verdad), imagen, descripción
   corta de Wikidata y vistas de página de 20 días (señal de popularidad).
   Es aditivo: si Wikipedia falla, se sigue con Geoapify/Google/Overpass. */
const WIKI_API="https://es.wikipedia.org/w/api.php";
let wikiQueue=Promise.resolve();
const wikiResponses=new Map();
let wikiCooldownUntil=0;
function wikiJson(url,options={},timeout=10000){
  const key=String(url),cached=wikiResponses.get(key);
  if(cached && Date.now()-cached.at<10*60*1000)return cached.promise;
  const task=wikiQueue.then(async()=>{
    if(Date.now()<wikiCooldownUntil)throw Error('Wikipedia está limitando temporalmente las consultas');
    let last;
    for(let attempt=0;attempt<3;attempt++){
      try {
        const data=await fetchJson(url,{...options,headers:{...options.headers,'User-Agent':USER_AGENT,'Accept':'application/json'}},timeout);
        if(data.error)throw Error(`wiki ${data.error.code || 'error'}`);
        return data;
      }catch(e){
        last=e;
        if(e.message==='HTTP 429'){wikiCooldownUntil=Date.now()+60000;throw e;}
        if(attempt<2)await sleep(1000*(attempt+1));
      }
    }
    throw last;
  });
  wikiResponses.set(key,{at:Date.now(),promise:task});
  wikiQueue=task.catch(()=>{wikiResponses.delete(key);}).then(()=>sleep(350));
  return task;
}
const WIKI_SKIP=/\(desambiguaci[oó]n\)|^Lista de |^Anexo:|^Categor[ií]a:|^Wikiproyecto|^(archidi[oó]cesis|di[oó]cesis|provincia|comarca|partido judicial|mancomunidad|jurisdicci[oó]n|taifa|reino|condado|se[ñn]or[ií]o|marquesado|ducado|batalla|asedio|sitio|bombardeo|conquista|toma|rebeli[oó]n|sublevaci[oó]n|elecciones|club|uni[oó]n deportiva|c\.? ?d\.?|c\.? ?f\.?)\s+(de|del|d[eé])\s+/i;

// Artículos con coordenadas que NO son un sitio que se pueda visitar:
// acontecimientos históricos, entidades territoriales, clubes, medios, etc.
const WIKI_NOT_PLACE_DESC=/\b(batalla|asedio|combate|conflicto|guerra|revuelta|mot[ií]n|masacre|bombardeo|conquista|reconquista|terremoto|naufragio|acontecimiento|suceso hist[oó]rico|competici[oó]n|torneo|liga de|club de f[uú]tbol|equipo (de|ciclista)|partido pol[ií]tico|peri[oó]dico|revista|emisora|di[oó]cesis|archidi[oó]cesis|taifa|reino de|condado de|se[ñn]or[ií]o de|dinast[ií]a|tratado de|elecciones|entidad (de poblaci[oó]n|local)|comarca|mancomunidad|distrito electoral|barrio de|pedan[ií]a|estaci[oó]n de (tren|autobuses|ferrocarril|cercan[ií]as)|estaci[oó]n intermodal|estaci[oó]n ferroviaria|apeadero|aeropuerto|instituto de educaci[oó]n|colegio de educaci[oó]n|centro de salud|\bhospital\b|centro (de salud|hospitalario)|cl[ií]nica|cementerio|tanatorio|c[aá]rcel|centro penitenciario|pol[ií]gono industrial|estadio|campo de (f[uú]tbol|juego|deportes)|pabell[oó]n deportivo|polideportivo|club deportivo)\b/i;
const WIKI_EVENT_LEAD=/^(el|la|los|las)\s+[\wáéíóúñ]+\s+(de|del)\s+.+?\b(fue|tuvo lugar|se libr[oó]|se produjo|acaeci[oó]|ocurri[oó]|comenz[oó]|estall[oó]|enfrent[oó])\b/i;

function wikiIsVisitablePlace(shortDesc,extract){
  const s=`${shortDesc||""} `;
  if(WIKI_NOT_PLACE_DESC.test(s))return false;
  if(WIKI_EVENT_LEAD.test(String(extract||"").trim()))return false;
  return true;
}

function capFirst(s){s=String(s||"").trim();return s?s[0].toUpperCase()+s.slice(1):s;}

function wikiCategoryFromText(t=""){
  const s=t.toLowerCase();
  if(/\bmuseo\b|pinacoteca|casa museo/.test(s))return"museum";
  if(/galer[ií]a de arte/.test(s))return"gallery";
  if(/\bmirador\b/.test(s))return"viewpoint";
  if(/castillo|fortaleza|alcazaba|alc[aá]zar|ciudadela|muralla|torre|fuerte|bastión/.test(s))return"historic.castle";
  if(/iglesia|catedral|bas[ií]lica|ermita|monasterio|convento|mezquita|sinagoga|santuario|colegiata|capilla/.test(s))return"historic.church";
  if(/yacimiento|arqueol[oó]gic|teatro romano|villa romana|f[eé]nici|dolmen|megal[ií]t|acueducto|termas/.test(s))return"historic.archaeological_site";
  if(/palacio|casa palacio|hacienda|c[aá]rmen|casa consistorial|ayuntamiento hist/.test(s))return"historic";
  if(/monumento|estatua|escultura|obelisco|cruz de/.test(s))return"historic.monument";
  if(/parque nacional|parque natural|reserva natural|paraje natural|monumento natural|espacio protegido|zepa/.test(s))return"leisure.nature_reserve";
  if(/jard[ií]n bot[aá]nic|arboreto|parque|jard[ií]n/.test(s))return"leisure.park";
  if(/\bplaya\b|\bcala\b/.test(s))return"beach";
  if(/acantilado|sierra|\bmonte\b|\bpico\b|\bcabo\b|volc[aá]n|desierto|cascada|ca[nñ][oó]n|garganta|gruta|\bcueva\b|\blago\b|laguna|embalse|marisma|salinas|d[uú]na/.test(s))return"natural";
  if(/teatro|auditorio|palacio de congresos/.test(s))return"entertainment.culture.theatre";
  if(/plaza mayor|plaza de|casco (antiguo|hist[oó]rico)|barrio hist|juder[ií]a/.test(s))return"tourism.sights";
  if(/\bfaro\b|puente|acuario|jard[ií]n zool[oó]gico|parque tem[aá]tico/.test(s))return"tourism.attraction";
  if(/estadio|pabell[oó]n deportivo|campo de (f[uú]tbol|juego|deportes)|polideportivo|coliseum|circuito de/.test(s))return"sports.stadium";
  return"tourism.attraction";
}

async function wikiFetch(params){
  const u=new URL(WIKI_API);
  for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));
  return wikiJson(u,{},9000);
}

/* El nodo OSM `place=city` de algunas localidades está mal colocado (p.ej. el de
   Almería cae 13 km al este del centro histórico). El artículo de Wikipedia con
   el mismo nombre tiene una coordenada mucho más fiable del centro urbano. */
async function wikiPlaceCoord(name,near){
  const key=`wikiCoord:${norm(name)}`;
  const persisted=cacheGet(key);
  if(persisted && (!near || haversineKm(persisted.data,near)<=25))return persisted.data;
  if(memCache.has(key))return memCache.get(key);
  let res=null;
  try{
    const d=await wikiFetch({action:"query",format:"json",formatversion:"2",redirects:"1",titles:name,prop:"coordinates"});
    const c=d?.query?.pages?.[0]?.coordinates?.[0];
    if(c&&Number.isFinite(c.lat)){
      if(!near||haversineKm({lat:c.lat,lon:c.lon},near)<=25)res={lat:c.lat,lon:c.lon};
    }
  }catch(e){debug("wikiPlaceCoord:",e.message);}
  memCache.set(key,res);
  if(res)cacheSet(key,res);
  return res;
}

async function wikiNearby(center,radiusM=6500,limit=120,{full=false,bounds=null,detailCache=null}={}){
  // GeoSearch devuelve los N MÁS CERCANOS (no "N dentro del radio"). En cascos
  // históricos densos, un límite bajo no llega a monumentos algo más alejados
  // (p.ej. la Alcazaba de Almería queda tras decenas de iglesias y plazas). Por
  // eso pedimos bastantes y dejamos que la puntuación (idiomas/tamaño/visitas)
  // saque a flote lo importante.
  const geo=await wikiFetch({
    action:"query",format:"json",formatversion:"2",
    list:"geosearch",gsnamespace:"0",
    ...(bounds ? {gsbbox:bounds.join("|")} : {gscoord:`${center.lat}|${center.lon}`,gsradius:Math.min(10000,Math.round(radiusM))}),
    gslimit:full?500:Math.min(300,limit)
  });
  // Fuera títulos que son carreteras ("A-7", "N-340", "AP-7", "Autovía A-92").
  const ROAD_CODE=/^[A-Z]{1,3}-\d{1,4}\b|^(autov[ií]a|autopista|carretera|ronda)\b/i;
  if(!Array.isArray(geo?.query?.geosearch))throw new Error("Respuesta Wikipedia incompleta");
  const saturated=geo.query.geosearch.length >= (full?500:Math.min(300,limit));
  const hits=geo.query.geosearch.filter(h=>h.title&&!WIKI_SKIP.test(h.title)&&!ROAD_CODE.test(h.title));
  if(!hits.length){const empty=[];empty.saturated=saturated;return empty;}

  const byId=new Map(hits.map(h=>[h.pageid,h]));
  const ids=[...byId.keys()].slice(0,full?Infinity:120).filter(id=>!detailCache?.has(id));
  const out=detailCache ? hits.map(h=>detailCache.get(h.pageid)).filter(Boolean) : [];

  for(let i=0;i<ids.length;i+=20){
    const chunk=ids.slice(i,i+20);
    // Si una tanda falla (p.ej. límite de peticiones), abortamos wikiNearby
    // entero: un resultado PARCIAL no debe cachearse como definitivo.
    let d;
    try {d=await wikiFetch({
      action:"query",format:"json",formatversion:"2",redirects:"1",
      pageids:chunk.join("|"),
      prop:"extracts|pageimages|pageterms|pageviews|langlinks|info",
      exintro:"1",explaintext:"1",exsentences:"3",
      piprop:"thumbnail",pithumbsize:"640",
      pvipdays:"20",lllimit:"100",inprop:"url"
    });
    }catch(e){
      // Page-view statistics can fail even while article text is available.
      // Keep real descriptions; popularity remains unknown in this fallback.
      d=await wikiFetch({action:'query',format:'json',formatversion:'2',redirects:'1',pageids:chunk.join('|'),
        prop:'extracts|pageimages|pageterms|info',exintro:'1',explaintext:'1',exsentences:'3',piprop:'thumbnail',pithumbsize:'640',inprop:'url'});
    }

    if(!Array.isArray(d?.query?.pages))throw new Error("Fichas Wikipedia incompletas");
    for(const pg of d.query.pages){
      const h=byId.get(pg.pageid);
      if(!h||!Number.isFinite(h.lat))continue;
      const extract=String(pg.extract||"").replace(/\s+/g," ").trim();
      const shortDesc=(pg.terms?.description||[])[0]||"";
      if(!extract&&!shortDesc){detailCache?.set(pg.pageid,null);continue;}
      if(!wikiIsVisitablePlace(shortDesc,extract)){detailCache?.set(pg.pageid,null);continue;}
      const pv=pg.pageviews?Object.values(pg.pageviews).reduce((s,n)=>s+(Number(n)||0),0):0;
      const cat=wikiCategoryFromText(`${shortDesc} ${extract}`);
      out.push({
        id:`wiki:${pg.pageid}`,
        name:pg.title,
        lat:h.lat,lon:h.lon,
        category:cat,categories:[cat],
        description:extract||capFirst(shortDesc),
        shortDesc:shortDesc?capFirst(shortDesc):"",
        durationMin:durationFor(cat),
        website:"",openingHours:"",cuisine:"",
        wikipediaUrl:pg.fullurl||`https://es.wikipedia.org/?curid=${pg.pageid}`,
        infoUrl:pg.fullurl||"",
        imageUrl:pg.thumbnail?.source||"",
        imageAttribution:pg.thumbnail?"Wikipedia (CC)":"",
        wikiPageviews:pv,
        wikiLanglinks:(pg.langlinks||[]).length,
        wikiBytes:Number(pg.length)||0,
        rating:null,userRatingCount:null,
        source:"wikipedia",verified:true
      });
    }
  }
  if(detailCache)for(const item of out)detailCache.set(Number(item.id.slice(5)),item);
  out.saturated=saturated;
  return out;
}

/* Extracto real + imagen de un artículo de Wikipedia dado su título (o "es:Título").
   Se usa para rellenar descripción/imagen de POIs de OSM/Geoapify que llevan
   etiqueta `wikipedia=`. Cacheado en memoria por título. */
async function wikiExtractByTitle(ref){
  const m=String(ref||"").match(/^([a-z]{2,3}):(.+)$/i);
  const lang=m?m[1].toLowerCase():"es";
  const title=m?m[2]:String(ref||"").trim();
  if(!title)return null;
  const key=`wikiExtract:${lang}:${norm(title)}`;
  if(memCache.has(key))return memCache.get(key);
  let res=null;
  try{
    const u=new URL(`https://${lang}.wikipedia.org/w/api.php`);
    const params={
      action:"query",format:"json",formatversion:"2",redirects:"1",titles:title,
      prop:"extracts|pageimages|pageterms|info",
      exintro:"1",explaintext:"1",exsentences:"3",
      piprop:"thumbnail",pithumbsize:"640",inprop:"url"
    };
    for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));
    const d=await fetchJson(u,{headers:{"User-Agent":USER_AGENT,"Accept":"application/json"}},8000);
    const pg=d?.query?.pages?.[0];
    if(pg&&!pg.missing){
      const extract=String(pg.extract||"").replace(/\s+/g," ").trim();
      const shortDesc=(pg.terms?.description||[])[0]||"";
      if(extract||shortDesc){
        res={
          description:extract||capFirst(shortDesc),
          shortDesc:shortDesc?capFirst(shortDesc):"",
          imageUrl:pg.thumbnail?.source||"",
          wikipediaUrl:pg.fullurl||""
        };
      }
    }
  }catch(e){debug("wikiExtractByTitle:",e.message);}
  memCache.set(key,res);
  return res;
}

const ROUTE_DESC_GENERIC=/localizado por las fuentes|incluido por las fuentes|es un lugar de inter[eé]s|es una atracci[oó]n o punto de inter[eé]s tur[ií]stico/i;

/* Para paradas en ruta que vienen de OSM/Geoapify con etiqueta `wikipedia=`:
   trae su extracto e imagen reales de Wikipedia. Sólo toca las que no tienen
   descripción de verdad o no tienen imagen. */
async function attachWikiExtracts(items,max=16){
  const list=[...items];
  const idxs=list
    .map((x,i)=>{
      if(x.source==="wikipedia"||!x.wikipediaTag)return-1;
      const poorDesc=!x.description||ROUTE_DESC_GENERIC.test(x.description);
      return (poorDesc||!x.imageUrl)?i:-1;
    })
    .filter(i=>i>=0)
    .slice(0,max);
  for(let s=0;s<idxs.length;s+=4){
    const batch=idxs.slice(s,s+4);
    const got=await Promise.all(batch.map(i=>wikiExtractByTitle(list[i].wikipediaTag)));
    batch.forEach((i,j)=>{
      const g=got[j];
      if(!g)return;
      const poorDesc=!list[i].description||ROUTE_DESC_GENERIC.test(list[i].description);
      list[i]={
        ...list[i],
        description:poorDesc&&g.description?g.description:list[i].description,
        shortDesc:list[i].shortDesc||g.shortDesc,
        imageUrl:list[i].imageUrl||g.imageUrl,
        imageAttribution:list[i].imageAttribution||(g.imageUrl?"Wikipedia (CC)":""),
        wikipediaUrl:list[i].wikipediaUrl||g.wikipediaUrl,
        infoUrl:list[i].infoUrl||g.wikipediaUrl
      };
    });
  }
  return list;
}

/* Familia gruesa de contenido, para repartir variedad por tramo de ruta. */
function categoryFamily(cat=""){
  const c=String(cat).toLowerCase();
  if(/museum|gallery|museo|pinacoteca/.test(c))return"museo";
  if(/viewpoint|mirador/.test(c))return"mirador";
  if(/castle|fort|historic|heritage|ruins|archaeolog|monument|memorial|church|monaster|tower|city_gate|sights|palace/.test(c))return"historia";
  if(/beach|natural|nature_reserve|protected|park|garden|forest|water|peak|cliff|cave|spring|volcano|waterfall|geolog|cape|arch/.test(c))return"naturaleza";
  if(/theme_park|amusement|zoo|aquarium|attraction|picnic/.test(c))return"ocio";
  return"otros";
}

function routeCoordsKm(coords){
  let s=0;
  for(let i=1;i<coords.length;i++)s+=haversineKm(coords[i-1],coords[i]);
  return s;
}

/* Reparto geográfico: divide la ruta en tramos y coge lo mejor de CADA tramo,
   evitando que todo se amontone en dos o tres pueblos. Prioriza dentro de cada
   tramo por interés y variedad de familia; de-clustering de 2,5 km. */
const nameKeyOf=s=>norm(String(s||"").split(/\s+/).slice(0,2).join(" "));

function distributeAlongRoute(items,{buckets=12,perBucket=3,max=28}={}){
  const scored=items.map(x=>{
    const realDesc=x.description&&!ROUTE_DESC_GENERIC.test(x.description);
    // Sesgo suave hacia lo documentado, sin que Wikipedia arrase con la variedad.
    const bonus=(x.source==="wikipedia"?9:x.source==="geoapify"?3:0)
      +(x.imageUrl?6:0)+(realDesc?5:0)+(x.wikipediaUrl?4:0);
    return{...x,_score:interestScore(x)+bonus};
  });
  const byBucket=new Map();
  for(const it of scored){
    const b=Math.min(buckets-1,Math.max(0,Math.floor((it.routeProgressPct/100)*buckets)));
    if(!byBucket.has(b))byBucket.set(b,[]);
    byBucket.get(b).push(it);
  }
  for(const list of byBucket.values())list.sort((a,b)=>b._score-a._score);
  const order=[...byBucket.keys()].sort((a,b)=>a-b);

  const kept=[];
  const nameKeyCount={};                 // anti-repetición ("Torre de…", "Río …")
  const bucketFam={};                    // familias ya tomadas en cada tramo
  const tryTake=(cand,bkey)=>{
    const fam=categoryFamily(cand.category);
    const nk=nameKeyOf(cand.name);
    if(kept.some(t=>norm(t.name)===norm(cand.name)))return false; // nunca el mismo nombre dos veces
    if(nk&&(nameKeyCount[nk]||0)>=3)return false;                 // máx. 3 con el mismo arranque de nombre
    if(kept.some(t=>haversineKm(t,cand)<2&&categoryFamily(t.category)===fam))return false; // de-cluster 2 km
    const seen=bucketFam[bkey]||(bucketFam[bkey]=[]);
    if(seen.filter(f=>f===fam).length>=2)return false; // máx. 2 de una familia por tramo
    seen.push(fam);
    if(nk)nameKeyCount[nk]=(nameKeyCount[nk]||0)+1;
    kept.push(cand);
    return true;
  };

  // Selección EN RONDA por tramos desde el principio: primero 1 de cada tramo con
  // contenido, luego un 2º de cada uno, etc. Así ningún tramo poblado se queda
  // fuera aunque otro tramo tenga muchísimos candidatos (evita que todo se
  // amontone en la zona con más artículos).
  const cursor={};
  for(const bk of order)cursor[bk]=0;
  for(let round=0;round<perBucket&&kept.length<max;round++){
    for(const bk of order){
      if(kept.length>=max)break;
      const list=byBucket.get(bk);
      let i=cursor[bk];
      while(i<list.length){
        const ok=tryTake(list[i],bk);
        i++;
        if(ok)break;
      }
      cursor[bk]=i;
    }
  }
  // Relleno final si aún hay hueco: otra ronda sin tope por tramo.
  let progressed=true;
  while(kept.length<max&&progressed){
    progressed=false;
    for(const bk of order){
      if(kept.length>=max)break;
      const list=byBucket.get(bk);
      let i=cursor[bk];
      while(i<list.length){
        const ok=tryTake(list[i],bk);
        i++;
        if(ok){progressed=true;break;}
      }
      cursor[bk]=i;
    }
  }
  return kept
    .sort((a,b)=>a.routeProgressPct-b.routeProgressPct)
    .slice(0,max)
    .map(({_score,...rest})=>rest);
}

/** Une dos listas evitando duplicados (misma zona o mismo nombre). La primera
    lista tiene prioridad (normalmente la de Wikipedia). */
function mergeByProximity(primary,secondary,km=0.4){
  const out=[...primary];
  for(const s of secondary){
    if(!s||!Number.isFinite(s.lat))continue;
    const dup=out.some(p=>
      (norm(p.name)&&norm(p.name)===norm(s.name))||
      (norm(s.name)&&norm(p.name).includes(norm(s.name)))||
      (norm(p.name)&&norm(s.name).includes(norm(p.name)))||
      haversineKm(p,s)<km
    );
    if(!dup)out.push(s);
  }
  return out;
}

const googleTypes={
  activities:["tourist_attraction","museum","art_gallery","park","zoo","aquarium","amusement_park","historical_landmark","cultural_landmark","performing_arts_theater"],
  food:["restaurant","cafe"],
  lodging:["hotel","hostel","bed_and_breakfast","resort_hotel","campground"]
};
async function googlePlaces(kind,center,radius=9000,limit=20){
  if(!GOOGLE_KEY)throw new Error("Google Places no configurado");
  const types=googleTypes[kind]||[];
  const body={
    includedTypes:types,
    maxResultCount:Math.min(20,limit),
    rankPreference:"POPULARITY",
    locationRestriction:{circle:{center:{latitude:center.lat,longitude:center.lon},radius}}
  };
  const d=await fetchJson("https://places.googleapis.com/v1/places:searchNearby",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "X-Goog-Api-Key":GOOGLE_KEY,
      "X-Goog-FieldMask":"places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types,places.rating,places.userRatingCount,places.priceLevel,places.regularOpeningHours,places.websiteUri"
    },
    body:JSON.stringify(body)
  },9000);

  const PRICE_ENUM={PRICE_LEVEL_INEXPENSIVE:1,PRICE_LEVEL_MODERATE:2,PRICE_LEVEL_EXPENSIVE:3,PRICE_LEVEL_VERY_EXPENSIVE:4};
  const items=dedupe((d.places||[]).map(p=>{
    const cat=p.primaryType||p.types?.[0]||kind;
    return{
      id:p.id,
      name:p.displayName?.text||p.formattedAddress,
      lat:Number(p.location?.latitude),lon:Number(p.location?.longitude),
      category:cat,
      description:categoryDescription(cat,p.displayName?.text),
      durationMin:durationFor(cat),
      website:p.websiteUri||"",
      openingHours:p.regularOpeningHours?.weekdayDescriptions?.join(" · ")||"",
      cuisine:"",
      rating:p.rating??null,
      userRatingCount:p.userRatingCount??null,
      priceLevel:PRICE_ENUM[p.priceLevel]||null,
      stars:null,
      source:"google",verified:true
    };
  }).filter(x=>x.name&&Number.isFinite(x.lat)&&Number.isFinite(x.lon)));
  items.rawCount=(d.places||[]).length;
  return items;
}

async function overpassQuick(kind,center,radius=9000,{maxEndpoints=OVERPASS_ENDPOINTS.length,timeoutMs=4500,requireComplete=false}={}){
  let q;
  if(kind==="activities"){
    q=`[out:json][timeout:8];(
      nwr["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|aquarium|theme_park|artwork|picnic_site)$"]["name"](around:${radius},${center.lat},${center.lon});
      nwr["historic"]["name"](around:${radius},${center.lat},${center.lon});
      nwr["leisure"~"^(park|garden|nature_reserve|marina)$"]["name"](around:${radius},${center.lat},${center.lon});
      nwr["natural"~"^(peak|cliff|cave_entrance|volcano|hot_spring|geyser|arch|cape|beach)$"]["name"](around:${radius},${center.lat},${center.lon});
      nwr["boundary"="protected_area"]["name"](around:${radius},${center.lat},${center.lon});
      nwr["waterway"="waterfall"]["name"](around:${radius},${center.lat},${center.lon});
    );out center tags;`;
  }else if(kind==="food"){
    q=`[out:json][timeout:5];(nwr["amenity"~"^(restaurant|cafe)$"](around:${radius},${center.lat},${center.lon}););out center tags;`;
  }else{
    q=`[out:json][timeout:5];(nwr["tourism"~"^(hotel|hostel|guest_house|motel|apartment|camp_site|resort)$"](around:${radius},${center.lat},${center.lon}););out center tags;`;
  }

  let last;
  for(const endpoint of OVERPASS_ENDPOINTS.slice(0,Math.max(1,maxEndpoints))){
    try{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),timeoutMs);
      try{
        const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","User-Agent":USER_AGENT},body:new URLSearchParams({data:q}),signal:controller.signal});
        if(!r.ok)throw new Error(`Overpass ${r.status}`);
        const d=await r.json();
        if(requireComplete && (d.remark || !Array.isArray(d.elements)))throw new Error("Respuesta Overpass incompleta");
        const items=(d.elements||[]).map(el=>{
          const pos=typeof el.lat==="number"?{lat:el.lat,lon:el.lon}:el.center?{lat:el.center.lat,lon:el.center.lon}:null;
          const t=el.tags||{};
          if(!pos||!t.name)return null;
          const cat=t.tourism||t.historic||t.leisure||t.natural||(t.boundary==="protected_area"?"nature_reserve":"")||(t.waterway==="waterfall"?"waterfall":"")||t.amenity||kind;
          const wikiTag=t.wikipedia||t["wikipedia:es"]||"";
          return{
            id:`${el.type}/${el.id}`,name:t.name,...pos,category:cat,
            description:t.description||t["description:es"]||categoryDescription(cat,t.name),
            durationMin:durationFor(cat),
            website:t.website||t["contact:website"]||"",openingHours:t.opening_hours||"",cuisine:t.cuisine||"",
            stars:Number(t.stars)||Number(t["stars:count"])||null,
            priceLevel:null,
            wikipediaTag:wikiTag,
            wikipediaUrl:wikipediaUrlFromRef(wikiTag),
            imageUrl:/^https?:\/\//i.test(t.image||"")?t.image:"",
            rating:null,userRatingCount:null,source:"osm",verified:true
          };
        }).filter(Boolean);
        return requireComplete?items:dedupe(items);
      }finally{clearTimeout(timer);}
    }catch(e){last=e;debug("Overpass:",e.message);}
  }
  throw last||new Error("Overpass no disponible");
}

function generatedActivities(destination){
  return[
    {id:`generated:walk:${destination.name}`,name:`Paseo libre por ${destination.name}`,lat:destination.lat,lon:destination.lon,category:"generated.walk",description:`Recorrido sin ruta rígida por ${destination.name}, pensado para descubrir calles, plazas y ambiente local a tu ritmo.`,durationMin:75,source:"generated",verified:false},
    {id:`generated:center:${destination.name}`,name:`Explorar ${destination.name} a pie`,lat:destination.lat,lon:destination.lon,category:"generated.explore",description:"Actividad flexible para recorrer la zona central, detenerte donde te interese y adaptarla al tiempo disponible.",durationMin:90,source:"generated",verified:false},
    {id:`generated:relax:${destination.name}`,name:`Paseo y descanso sin horario`,lat:destination.lat,lon:destination.lon,category:"generated.relax",description:"Bloque deliberadamente libre para paseo, café, descanso o una visita espontánea que encuentres sobre la marcha.",durationMin:60,source:"generated",verified:false}
  ];
}
function generatedService(kind,destination){
  if(kind==="food")return[
    {id:`generated:food:${destination.name}`,name:`Elegir restaurante al llegar a ${destination.name}`,lat:destination.lat,lon:destination.lon,category:"generated.food",description:"Opción flexible: decidir el restaurante sobre la marcha según hambre, ambiente y disponibilidad real.",durationMin:85,source:"generated",verified:false}
  ];
  return[
    {id:`generated:lodging:${destination.name}`,name:`Alojamiento por reservar en ${destination.name}`,lat:destination.lat,lon:destination.lon,category:"generated.lodging",description:"Marcador de planificación: falta elegir un alojamiento concreto y comprobar disponibilidad/precio.",durationMin:0,source:"generated",verified:false}
  ];
}

const geoCats={
  activities:["tourism","entertainment","heritage","leisure","beach","maritime","natural"],
  food:["catering.restaurant","catering.cafe"],
  lodging:["accommodation"]
};


function destinationDistanceKm(item,destination){
  return haversineKm(item,destination);
}

function localityText(item){
  return [
    item.suburb,item.village,item.town,item.city,item.district,
    item.municipality,item.county,item.formatted,item.addressLine2
  ].filter(Boolean).join(" ");
}

function belongsToSelectedBase(item,destination,kind){
  const km=destinationDistanceKm(item,destination);
  const base=norm(destination.name);
  const locality=norm(localityText(item));
  const explicitMatch=base && locality.includes(base);

  if(kind==="lodging")return km<=3.8 || (explicitMatch && km<=5.0);
  if(kind==="food")return km<=4.5 || (explicitMatch && km<=5.5);
  return km<=5.5 || (explicitMatch && km<=6.5);
}

function filterDestinationItems(items,destination,kind){
  return dedupe((items||[])
    .map(x=>({...x,distanceToDestinationKm:Math.round(destinationDistanceKm(x,destination)*10)/10}))
    .filter(x=>belongsToSelectedBase(x,destination,kind)));
}

function baseContentScore(items){
  const unique=dedupe(items||[]);
  let activities=0,food=0,lodging=0;

  for(const x of unique){
    const cats=(x.categories||[x.category||""]).join(" ").toLowerCase();
    if(cats.includes("catering."))food++;
    else if(cats.includes("accommodation"))lodging++;
    else activities++;
  }

  const activityScore=Math.min(100,activities*12);
  const foodScore=Math.min(100,food*4);
  const lodgingScore=Math.min(100,lodging*9);

  return{
    activities,food,lodging,
    interestScore:Math.round(activityScore*.65+foodScore*.20+lodgingScore*.15)
  };
}


async function discoverBaseCandidates(target,toleranceKm){
  const all=[{...target,id:target.id || `target:${target.lat}:${target.lon}`}],errors=[];
  if(toleranceKm===0)return {items:all,errors};
  if(GEOAPIFY_KEY){
    try {
      for await(const page of pagedPlaces(async(offset,limit)=>{
        const items=await geoapifyPlaces(['populated_place.city','populated_place.town','populated_place.village'],target,toleranceKm*1000+25000,limit,{offset,routeSearch:true});
        return {items,rawCount:items.rawCount,ids:items.rawIds};
      }))all.push(...page.items.map(x=>({...x,type:x.categories?.some(c=>c.endsWith('.city'))?'city':x.categories?.some(c=>c.endsWith('.town'))?'town':'village'})));
    }catch{errors.push('Geoapify');}
  }else {
    let found=false;
    for(const endpoint of OVERPASS_ENDPOINTS){
      try {
        const query=`[out:json][timeout:12];nwr["place"~"^(city|town|village)$"]["name"](around:${toleranceKm*1000+25000},${target.lat},${target.lon});out center tags;`;
        const data=await fetchJson(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':USER_AGENT},body:new URLSearchParams({data:query})},15000);
        if(data.remark || !Array.isArray(data.elements))throw Error('Consulta incompleta');
        all.push(...data.elements.map(x=>({id:`osm:${x.type}:${x.id}`,name:x.tags.name,type:x.tags.place,lat:x.lat ?? x.center?.lat,lon:x.lon ?? x.center?.lon})).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon)));
        found=true;break;
      }catch{}
    }
    if(!found)errors.push('OpenStreetMap');
  }
  const unique=[];
  for(const x of all)if(!unique.some(y=>norm(x.name)===norm(y.name)&&haversineKm(x,y)<25))unique.push(x);
  return {items:unique,errors};
}

async function quickBaseSummary(destination){
  const key=`baseSummary:v2:${destination.lat.toFixed(3)}:${destination.lon.toFixed(3)}`;
  const cached=cacheGet(key);
  if(cached)return{...cached.data,source:"cache"};

  try{
    const items=await geoapifyPlaces(
      ["tourism","entertainment","heritage","leisure","beach","maritime","natural","catering.restaurant","accommodation"],
      destination,5000,70
    );
    const local=filterDestinationItems(items,destination,"activities");
    const summary=baseContentScore(local);
    cacheSet(key,summary);
    return{...summary,source:"geoapify"};
  }catch(e){
    debug("Base summary:",destination.name,e.message);
    return{activities:null,food:null,lodging:null,interestScore:null,source:"unavailable"};
  }
}

const localityRequests=new Map();
async function localityProfile(destination) {
  const key=`locality:v1:${destination.name}:${destination.lat}:${destination.lon}`;
  const cached=cacheGet(key);if(cached)return cached.data;
  if(localityRequests.has(key))return localityRequests.get(key);
  const task=(async()=>{
    let place={...destination};
    try {
      const query=async(host,params)=>{
        const u=new URL(`https://${host}/w/api.php`);
        Object.entries({action:'query',format:'json',formatversion:'2',...params}).forEach(([k,v])=>u.searchParams.set(k,v));
        return wikiJson(u,{},8000);
      };
      const data=await query('es.wikipedia.org',{titles:destination.name,redirects:'1',prop:'coordinates|pageprops'});
      const page=data.query?.pages?.[0],coord=page?.coordinates?.[0],id=page?.pageprops?.wikibase_item;
      if(coord && haversineKm(destination,{lat:coord.lat,lon:coord.lon})<15 && /^Q\d+$/.test(id || '')) {
        const wd=await query('www.wikidata.org',{action:'wbgetentities',ids:id,props:'claims'});
        const population=latestPopulation(wd.entities?.[id]?.claims?.P1082);
        if(population)place={...place,population,populationSource:'Wikidata'};
      }
    } catch(e){debug('locality profile:',e.message);}
    const profile=destinationScale(place);
    if(!profile.estimated)cacheSet(key,profile);
    return profile;
  })().finally(()=>localityRequests.delete(key));
  localityRequests.set(key,task);return task;
}

const destinationRequests=new Map();
async function robustDestinationContent(kind,destination){
  const profile=await localityProfile(destination);
  const key=`content:v8:${kind}:${destination.lat}:${destination.lon}:${profile.tier}`;
  const fresh=cacheGet(key);
  if(fresh)return fresh.data;
  if(destinationRequests.has(key))return destinationRequests.get(key);
  const task=(async()=>{
    const radius=profile.radiusKm*1000,target=profile.targets[kind],all=[],errors=[],sources=[];
    const collect=async(name,job)=>{try{all.push(...await job());sources.push(name);}catch(e){errors.push(name);debug(name,e.message);}};
    const jobs=[];
    if(kind==='activities') jobs.push(collect('wikipedia',async()=>{
      const out=[],latSpan=profile.radiusKm/111,lonSpan=latSpan/Math.cos(destination.lat*Math.PI/180),detailCache=new Map();
      const box=[destination.lat+latSpan,destination.lon-lonSpan,destination.lat-latSpan,destination.lon+lonSpan];
      for await(const page of subdividedPlaces(box,async bounds=>{
        const items=await wikiNearby(destination,radius,500,{full:true,bounds,detailCache});
        return {items,saturated:items.saturated};
      }))all.push(...page.items);
      return out;
    }));
    if(GEOAPIFY_KEY) jobs.push(collect('geoapify',async()=>{
      const out=[];
      for await(const page of pagedPlaces(async(offset,limit)=>{
        const items=await geoapifyPlaces(geoCats[kind],destination,radius,limit,{offset,routeSearch:true});
        return {items,rawCount:items.rawCount,ids:items.rawIds};
      }))all.push(...page.items);
      return out;
    }));
    jobs.push(collect('osm',()=>overpassQuick(kind,destination,radius,{requireComplete:true,maxEndpoints:2,timeoutMs:10000})));
    // Google is optional; free sources are always queried even when it is configured.
    if(GOOGLE_KEY) jobs.push(collect('google',async()=>{
      const items=await googlePlaces(kind,destination,radius,20);
      if(items.rawCount>=20)errors.push('google: resultados limitados');
      return items;
    }));
    await Promise.all(jobs);
    const eligible=all.filter(x=>Number.isFinite(x.lat) && Number.isFinite(x.lon) && x.name && x.hasPlaceName!==false
      && haversineKm(x,destination)<=profile.radiusKm && norm(x.name)!==norm(destination.name)
      && !(kind==='activities' && (ROUTE_SKIP_SETTLEMENT.test(x.shortDesc||'') || WIKI_SETTLEMENT_LEAD.test((x.description||'').slice(0,140)))));
    const ranked=enrichInterest(mergeRoutePlaces(eligible),destination.name);
    const items=topInterest(ranked,target);
    const result={status:errors.length?'partial':'ok',source:sources.join('+')||'none',items,
      selection:{target,available:ranked.length,returned:items.length,profile,ranking:'interest',complete:!errors.length,errors}};
    if(!errors.length)cacheSet(key,result);
    return result;
  })().finally(()=>destinationRequests.delete(key));
  destinationRequests.set(key,task);return task;
}

async function routeGeneratedStops(route,destination){
  // Reparto proporcional también en el último recurso: ~1 punto cada 30 km (3–12).
  const gn=Math.max(3,Math.min(12,Math.round((route.roadKm||routeCoordsKm(route.coords))/30)));
  const progress=Array.from({length:gn},(_,i)=>0.12+0.76*(gn===1?0.5:i/(gn-1)));
  const out=[];
  for(const p of progress){
    const idx=Math.round(p*(route.coords.length-1));
    const c=route.coords[idx];
    try{
      const g=await reverseGeocode(c.lat,c.lon);
      if(haversineKm(g,destination)<10)continue;
      if(out.some(x=>norm(x.name)===norm(`Parada libre en ${g.name}`)))continue;
      out.push({
        id:`generated:route:${g.name}`,name:`Parada libre en ${g.name}`,
        lat:g.lat,lon:g.lon,category:"generated.route",
        description:`Parada flexible en ${g.name} para estirar las piernas, tomar algo o dar un paseo corto sin una visita obligatoria.`,
        durationMin:45,source:"generated",verified:false,
        routeProgressPct:Math.round(p*100)
      });
    }catch(e){debug("route generated:",e.message);}
  }
  return out;
}

const ROUTE_GEO_CATS=["tourism.attraction","tourism.sights","natural","beach","leisure.park","heritage"];
// Descripción corta de Wikidata que delata que el artículo es un NÚCLEO DE
// POBLACIÓN (no una visita concreta): "Adra", "Balanegra"… no son paradas útiles.
const ROUTE_SKIP_SETTLEMENT=/^(municipio|localidad|pedan[ií]a|entidad (local|de poblaci[oó]n)|n[uú]cleo|barrio|distrito|comarca|mancomunidad|aldea|caser[ií]o|villa|ciudad|pueblo|capital|concejo|parroquia civil|asentamiento)\b/i;
// Lo mismo en la primera frase del extracto ("X es una localidad de…").
const WIKI_SETTLEMENT_LEAD=/\bes (una|un)\s+(localidad|municipio|pedan[ií]a|entidad (local|de poblaci[oó]n)|poblaci[oó]n|aldea|barrio|distrito|comarca|caser[ií]o|n[uú]cleo|villa|ciudad|pueblo|urbanizaci[oó]n|barriada)\b/i;
// Nombre de Geoapify que en realidad es una vía o dirección, no un sitio.
const ROUTE_ADDRESS_LIKE=/^(calle|avda|avenida|camino|carretera|ctra|plaza|pza|cuesta|paseo|urbanizaci[oó]n|pol[ií]gono|traves[ií]a|ronda|glorieta|v[ií]a|barriada|partida|sendero|vereda|pista|autov[ií]a|rotonda)\b/i;

// Consultas simultáneas del mismo trayecto comparten trabajo; no hay caché
// persistente de una búsqueda incompleta. La geometría identifica el corredor.
const routeSearchInFlight=new Map();
async function robustRouteStops(route,destination){
  if(route.roadKm===0)return {status:'ok',source:'local',items:[],coverage:{target:0,available:0,returned:0,outcome:'target-reached'}};
  const index=routeGeometryIndex(route.coords);
  const target=routeStopTarget(route.roadKm ?? index.total);
  const fingerprint=createHash("sha256").update(JSON.stringify({coords:route.coords,destination,target})).digest("hex").slice(0,24);
  const key=`routeStops:v10:${fingerprint}`;
  const fresh=cacheGet(key);
  // Un resultado bajo el objetivo nunca evita una nueva búsqueda.
  if(fresh?.data?.coverage?.outcome==="target-reached" && fresh.data.items.length>=target)
    return {...fresh.data,source:"cache"};
  if(routeSearchInFlight.has(key))return routeSearchInFlight.get(key);
  const work=discoverRouteStops(route,destination,index,target,key);
  routeSearchInFlight.set(key,work);
  try{return await work;}finally{routeSearchInFlight.delete(key);}
}

async function discoverRouteStops(route,destination,index,target,key){
  const origin=route.coords[0];
  const endpointMargin=Math.min(6,(route.roadKm ?? index.total)/10);
  const details=new Map();
  const locations=new Map();
  const rejected={invalid:0,nonPlace:0,outsideRoute:0,duplicates:0};
  const prepare=raw=>{
    Object.keys(rejected).forEach(k=>rejected[k]=0);
    const valid=[];
    for(const x of raw){
      if(!x?.name || !Number.isFinite(x.lat) || !Number.isFinite(x.lon) || x.verified===false){rejected.invalid++;continue;}
      const notPlace=(x.shortDesc&&ROUTE_SKIP_SETTLEMENT.test(x.shortDesc))
        ||(x.description&&WIKI_SETTLEMENT_LEAD.test(x.description.slice(0,140)))
        ||x.hasPlaceName===false;
      if(notPlace){rejected.nonPlace++;continue;}
      const coordinateKey=`${x.lat},${x.lon}`;
      if(!locations.has(coordinateKey))locations.set(coordinateKey,index.locate(x));
      const location=locations.get(coordinateKey);
      if(location.distanceToRouteKm>10 || haversineKm(x,destination)<endpointMargin || haversineKm(x,origin)<endpointMargin){rejected.outsideRoute++;continue;}
      valid.push({...x,routeProgressPct:Math.round(location.routeProgressPct*10)/10,distanceToRouteKm:Math.round(location.distanceToRouteKm*10)/10});
    }
    const unique=mergeRoutePlaces(valid);
    rejected.duplicates=valid.length-unique.length;
    return unique;
  };
  const boundsFor=center=>{
    const lat=15/111.195,lon=lat/Math.max(.01,Math.cos(center.lat*Math.PI/180));
    return [Math.min(89.99,center.lat+lat),center.lon-lon,Math.max(-89.99,center.lat-lat),center.lon+lon];
  };
  const providers=[{
    name:"wikipedia",
    quick:center=>wikiNearby(center,10000,30,{detailCache:details}),
    all:center=>subdividedPlaces(boundsFor(center),async bounds=>{
      const items=await wikiNearby(center,10000,500,{full:true,bounds,detailCache:details});
      return {items,saturated:items.saturated};
    })
  }];
  if(GEOAPIFY_KEY)providers.push({
    name:"geoapify",
    quick:center=>geoapifyPlaces(ROUTE_GEO_CATS,center,15000,40,{routeSearch:true}),
    all:center=>pagedPlaces(async(offset,limit)=>{
      const items=await geoapifyPlaces(["tourism","entertainment","heritage","leisure","natural","beach"],center,15000,limit,{offset,routeSearch:true});
      return {items,rawCount:items.rawCount,ids:items.rawIds};
    })
  });
  providers.push({
    name:"osm",
    async *all(center){
      const items=await overpassQuick("activities",center,15000,{maxEndpoints:2,timeoutMs:5000,requireComplete:true});
      yield {items,complete:true};
    }
  });
  if(GOOGLE_KEY)providers.push({
    name:"google",
    all:center=>subdividedPlaces(boundsFor(center),async bounds=>{
      const [n,w,s,e]=bounds,c={lat:(n+s)/2,lon:(w+e)/2};
      const radius=Math.ceil(haversineKm(c,{lat:n,lon:w})*1000);
      const items=await googlePlaces("activities",c,radius,20);
      return {items,saturated:items.rawCount>=20};
    })
  });
  const found=await searchRoutePlaces({centers:index.centers,providers,target,prepare,pause:()=>sleep(200)});
  let items=enrichInterest(found.candidates,destination.name);
  // El enriquecimiento mejora las fichas, no expulsa lugares reales por carecer
  // de una foto o por compartir categoría con otra parada cercana.
  // Rank all discovered candidates with the same evidence. Extended editorial
  // details load on demand, so the number of rejected candidates cannot turn
  // the initial search into hundreds of unnecessary detail requests.
  items=selectRoutePlaces(enrichInterest(items,destination.name),target);
  const coverage={...found.coverage,returned:items.length,centers:index.centers.length,rejected,providers:providers.map(p=>p.name)};
  const result={status:coverage.outcome==="incomplete"?"partial":"ok",items,coverage,source:[...new Set(items.map(x=>x.source))].join("+")||"none"};
  if(coverage.outcome==="target-reached")cacheSet(key,result);
  if(!items.length && coverage.outcome==="incomplete"){
    const stale=cacheGet(key,{allowStale:true});
    if(stale?.data?.items?.length)return {...result,items:stale.data.items,source:"cache-stale"};
    return {...result,items:enrichInterest(await routeGeneratedStops(route,destination),destination.name),source:"generated"};
  }
  return result;
}

app.get("/api/providers",(req,res)=>{
  res.json({
    wikipedia:{configured:true,role:"lugares notables + descripciones"},
    geoapify:{configured:Boolean(GEOAPIFY_KEY),role:"cobertura de lugares"},
    google:{configured:Boolean(GOOGLE_KEY),role:"respaldo opcional"},
    osm:{configured:true,role:"tercer nivel"},
    persistentCache:{configured:true,role:"respaldo local"},
    generated:{configured:true,role:"último recurso"}
  });
});

app.post("/api/search/context",async(req,res)=>{
  try{
    const {origin="",target="",toleranceKm=40}=req.body||{};
    if(!origin.trim()||!target.trim())return res.status(400).json({error:'Indica origen y destino orientativo.'});
    let tol;
    try{tol=searchTolerance(toleranceKm);}catch(e){return res.status(400).json({error:e.message});}
    const o=await geocode(origin),t=await geocode(target),route=await routeGeometry(o,t);
    res.json({origin:o,target:t,routeSource:route.source,toleranceKm:tol,referenceRoute:route});

  }catch(e){res.status(502).json({error:e.message||"No se pudo preparar la búsqueda."});}
});

app.post("/api/search/candidates",async(req,res)=>{
  try{
    const {origin,target,toleranceKm=40}=req.body||{};
    if(!Number.isFinite(origin?.lat)||!Number.isFinite(origin?.lon)||!Number.isFinite(target?.lat)||!Number.isFinite(target?.lon))return res.status(400).json({error:'Indica origen y destino orientativo válidos.'});
    let tol;
    try{tol=searchTolerance(toleranceKm);}catch(e){return res.status(400).json({error:e.message});}
    const discovered=await discoverBaseCandidates(target,tol);
    const candidates=discovered.items;
    // Refine coordinates BEFORE measuring the tolerance and the trip distance.
    for(let i=0;i<candidates.length;i+=4)await Promise.all(candidates.slice(i,i+4).map(async b=>{
      if(b.lat===target.lat && b.lon===target.lon)return;
      const better=await wikiPlaceCoord(b.name,{lat:b.lat,lon:b.lon});
      if(better){b.lat=better.lat;b.lon=better.lon;}
    }));
    const nearby=candidates.filter(x=>haversineKm(x,target)<=tol+0.001);
    let valid=await nearbyBaseRoutes(origin,target,nearby,tol,routeTable);
    if(!valid.length)return res.status(422).json({error:`No se encontraron localidades accesibles a un máximo de ${tol} km por carretera de ${target.name}.`});

    // 3. Evaluar el interés REAL de cada base.
    const summaries=[];
    for(let i=0;i<valid.length;i+=4)summaries.push(...await Promise.all(valid.slice(i,i+4).map(x=>quickBaseSummary(x))));

    valid=valid.map((x,i)=>{
      const s=summaries[i];
      return{
        ...x,
        // La nota de la base ES su interés. El ajuste de km no suma ni resta nada.
        score:Number.isFinite(s.interestScore)?s.interestScore:null,
        baseInterest:s.interestScore,
        baseSummary:{
          activities:s.activities,
          food:s.food,
          lodging:s.lodging,
          source:s.source
        }
      };
    });

    // 4. Orden EXCLUSIVAMENTE por interés de base.
    valid.sort((a,b)=>{
      if(a.baseInterest!=null&&b.baseInterest!=null)return b.baseInterest-a.baseInterest;
      if(a.baseInterest!=null)return-1;
      if(b.baseInterest!=null)return 1;
      return 0;
    });

    res.json({
      results:valid.slice(0,8),
      target,toleranceKm:tol,discoveryComplete:!discovered.errors.length,
      disclaimer:`Destinos a un máximo de ${tol} km por carretera de ${target.name}, ordenados por interés. Los kilómetros de cada tarjeta corresponden al viaje desde ${origin.name}.${discovered.errors.length?' La búsqueda de localidades está incompleta por un fallo del proveedor.':''}`
    });

  }catch(e){
    res.status(502).json({error:e.message||"No se pudieron obtener bases."});
  }
});

app.post("/api/plan/route",async(req,res)=>{
  try{
    const {origin,destination}=req.body||{};
    const route=await routeGeometry(origin,destination);
    res.json({route});
  }catch(e){res.status(502).json({error:e.message||"No se pudo calcular la ruta."});}
});

// Geocodificación puntual para paradas personalizadas: por nombre ({q}) o
// inversa por coordenadas ({lat,lon}). Reutiliza los proveedores existentes.
app.post("/api/geocode",async(req,res)=>{
  try{
    const {q,lat,lon,place}=req.body||{};
    if(q&&String(q).trim()){
      const g=await geocode(String(q).trim(),{place:!!place});
      return res.json({name:g.name,lat:g.lat,lon:g.lon,displayName:g.displayName,type:g.type});
    }
    if(Number.isFinite(lat)&&Number.isFinite(lon)){
      const g=await reverseGeocode(Number(lat),Number(lon));
      return res.json({name:g.name,lat:Number(lat),lon:Number(lon),displayName:g.displayName,type:g.type});
    }
    res.status(400).json({error:"Indica un nombre o unas coordenadas."});
  }catch(e){res.status(502).json({error:e.message||"No se pudo localizar el lugar."});}
});
app.post("/api/options/route",async(req,res)=>{
  try{
    const {route,destination}=req.body||{};
    res.json(await robustRouteStops(route,destination));
  }catch(e){res.json({status:"fallback",items:[],source:"none",message:e.message});}
});
app.post("/api/options/activities",async(req,res)=>{
  const destination=req.body.destination;
  try{
    const result=await robustDestinationContent("activities",destination);
    if(!result.items?.length && result.status!=="ok"){
      result.items=enrichInterest(generatedActivities(destination),destination.name);
      result.status="fallback";
      result.source="generated";
    }
    res.json(result);
  }catch(e){
    res.json({
      status:"fallback",
      items:enrichInterest(generatedActivities(destination),destination.name),
      source:"generated"
    });
  }
});
app.post("/api/options/services",async(req,res)=>{
  const destination=req.body.destination;

  try{
    let [food,lodging]=await Promise.all([
      robustDestinationContent("food",destination),
      robustDestinationContent("lodging",destination)
    ]);

    if(!food.items?.length && food.status!=="ok"){
      food={
        status:"fallback",
        source:"generated",
        items:enrichInterest(generatedService("food",destination),destination.name)
      };
    }

    if(!lodging.items?.length && lodging.status!=="ok"){
      lodging={
        status:"fallback",
        source:"generated",
        items:enrichInterest(generatedService("lodging",destination),destination.name)
      };
    }

    const foodItems=food.items.map(x=>({...x,lunchOpening:likelyOpenForLunch(x.openingHours)}));

    res.json({
      status:"ok",
      food:foodItems,
      lodging:lodging.items,
      sources:{food:food.source,lodging:lodging.source},
      states:{food:food.status,lodging:lodging.status},
      selections:{food:food.selection,lodging:lodging.selection}
    });
  }catch(e){
    const food=enrichInterest(generatedService("food",destination),destination.name)
      .map(x=>({...x,lunchOpening:true}));
    const lodging=enrichInterest(generatedService("lodging",destination),destination.name);

    res.json({
      status:"fallback",
      food,
      lodging,
      sources:{food:"generated",lodging:"generated"}
    });
  }
});


async function robustRouteLunch(route,destination){
  if(route.roadKm===0)return {status:'ok',source:'local',items:[]};
  const key='routeLunch:v3:'+createHash('sha256').update(JSON.stringify({coords:route.coords,destination})).digest('hex');
  const fresh=cacheGet(key);
  if(fresh)return{status:"ok",items:enrichInterest(fresh.data,destination.name),source:"cache"};

  const geometry=routeGeometryIndex(route.coords);
  const samples=[.30,.45,.60,.75].map(progress=>({point:geometry.pointAt(geometry.total*progress),progress}));
  let all=[];
  const errors=[];
  for(const sample of samples) {
    if(GEOAPIFY_KEY) {
      try {
        for await(const page of pagedPlaces(async(offset,limit)=>{
          const items=await geoapifyPlaces(geoCats.food,sample.point,7000,limit,{offset,routeSearch:true});
          return {items,rawCount:items.rawCount,ids:items.rawIds};
        }))all.push(...page.items);
      } catch(e){errors.push('geoapify');}
    }
    try{all.push(...await overpassQuick('food',sample.point,7000,{requireComplete:true,maxEndpoints:2,timeoutMs:6000}));}catch{errors.push('osm');}
    if(GOOGLE_KEY)try{
      const items=await googlePlaces('food',sample.point,7000,20);all.push(...items);
      if(items.rawCount>=20)errors.push('google: resultados limitados');
    }catch{errors.push('google');}
  }

  all=mergeRoutePlaces(all)
    .map(x=>({...x,...geometry.locate(x),
      lunchOpening:likelyOpenForLunch(x.openingHours)
    }))
    .filter(x=>x.distanceToRouteKm<=8&&x.routeProgressPct>=25&&x.routeProgressPct<=82);

  if(all.length){
    const enriched=topInterest(enrichInterest(all,destination.name),24);
    if(!errors.length)cacheSet(key,enriched);
    return{status:errors.length?"partial":"ok",items:enriched,source:enriched[0]?.source||"provider"};
  }

  const stale=cacheGet(key,{allowStale:true});
  if(stale)return{status:"ok",items:enrichInterest(stale.data,destination.name),source:"cache-stale"};

  return{
    status:"fallback",
    source:"generated",
    items:[{
      id:`generated:route-lunch:${destination.name}`,
      name:"Parada flexible para comer en ruta",
      lat:route.coords[Math.round(route.coords.length*.55)].lat,
      lon:route.coords[Math.round(route.coords.length*.55)].lon,
      category:"generated.food",
      description:"Reserva un bloque de comida entre 12:30 y 14:30 y elige un restaurante abierto en la localidad por la que estés pasando.",
      durationMin:85,source:"generated",verified:false,
      routeProgressPct:55,lunchOpening:true
    }].map(x=>({...x,interestScore:interestScore(x),infoUrl:"https://www.google.com/search?q="+encodeURIComponent("restaurantes abiertos ruta")}))
  };
}

app.post("/api/options/route-lunch",async(req,res)=>{
  try{res.json(await robustRouteLunch(req.body.route,req.body.destination));}
  catch(e){res.json({status:"fallback",source:"generated",items:[]});}
});

const dayRequests=new Map();
const contentRequests=new Map();
app.post('/api/place/content',async(req,res)=>{
  const item=req.body.item;
  if(!item?.name || !Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return res.status(400).json({error:'Lugar sin coordenadas'});
  const key='placeContent:v1:'+createHash('sha256').update(JSON.stringify([item.id,item.name,item.lat,item.lon,item.wikipediaTag,item.wikipediaUrl])).digest('hex');
  const cached=cacheGet(key);
  if(cached) return res.json(cached.data);
  try {
    if(!contentRequests.has(key)) contentRequests.set(key,(async()=>{
      const enriched=item.source==='geoapify'?await geoapifyPlaceDetails(item):item;
      const content=await placeContent(enriched,wikiJson);
      return {...(enriched!==item?{description:enriched.description,website:enriched.website,openingHours:enriched.openingHours,wikipediaUrl:enriched.wikipediaUrl}:{}),...content};
    })().finally(()=>contentRequests.delete(key)));
    const result=await contentRequests.get(key);
    if(result.contentStatus!=='partial') cacheSet(key,result);
    res.json(result);
  }catch{res.json({contentStatus:'partial',contentError:'No se pudo ampliar la información. Puedes reintentarlo.'});}
});
app.post('/api/plan/day',async(req,res)=>{
  const body=req.body;
  const valid=p=>p && Number.isFinite(p.lat) && Math.abs(p.lat)<=90 && Number.isFinite(p.lon) && Math.abs(p.lon)<=180;
  if(!valid(body?.origin)||!valid(body?.chosen)||!Array.isArray(body?.selected?.route)||!Array.isArray(body?.selected?.activities)) return res.status(400).json({error:'Plan incompleto'});
  const items=[...body.selected.route,...body.selected.activities,body.selected.lunch,body.selected.hotel,body.selected.dinner].filter(Boolean);
  if(!items.every(valid)) return res.status(400).json({error:'Hay lugares sin coordenadas válidas'});
  const key='day:v7:'+createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const cached=cacheGet(key);
  if(cached) return res.json(cached.data);
  try {
    if(!dayRequests.has(key)) dayRequests.set(key,routeDay(body,fetchJson,OSRM).finally(()=>dayRequests.delete(key)));
    const result=await dayRequests.get(key);
    if(result.source==='osrm' && result.optimizationSource==='osrm') cacheSet(key,result);
    res.json(result);
  }catch(e){res.status(502).json({error:'No se pudo calcular el recorrido del día'});}
});

app.post("/api/travel/sequence",async(req,res)=>{
  try{
    const points=(req.body.points||[]).slice(0,20);
    if(points.length<2)return res.json({source:"none",legs:[]});

    const coords=points.map(p=>`${p.lon},${p.lat}`).join(";");
    try{
      const d=await fetchJson(`${OSRM}/route/v1/driving/${coords}?overview=false&steps=false`,{},12000);
      if(!d.routes?.[0]?.legs)throw new Error("Sin legs");
      return res.json({
        source:"osrm",
        legs:d.routes[0].legs.map(l=>({
          durationMin:Math.max(0,Math.round(l.duration/60)),
          distanceKm:Math.round(l.distance/100)/10
        }))
      });
    }catch(e){
      // Geometry fallback: conservative road-ish estimate instead of failing.
      const legs=[];
      for(let i=1;i<points.length;i++){
        const km=haversineKm(points[i-1],points[i])*1.25;
        legs.push({durationMin:Math.max(5,Math.round(km/35*60)),distanceKm:Math.round(km*10)/10});
      }
      return res.json({source:"estimated",legs});
    }
  }catch(e){
    res.status(502).json({error:e.message||"No se pudieron calcular desplazamientos."});
  }
});


app.post("/api/metrics/route-options",async(req,res)=>{
  try{
    const {route,items=[]}=req.body||{};
    if(!route?.coords?.length || !items.length){
      return res.json({source:"none",items:[]});
    }

    res.json(await routeOptionMetrics({route,items:items.slice(0,20)},fetchJson,OSRM));
  }catch(e){
    res.status(502).json({error:e.message||"No se pudieron calcular métricas de parada."});
  }
});

// Geometría REAL del desvío: polilínea origen -> parada -> base por carretera.
// Se usa para dibujar en el mapa "cómo queda la ruta si incluyes esta parada".
// Si OSRM falla, devuelve un trazo recto entre los tres puntos.
app.post("/api/metrics/route-detour",async(req,res)=>{
  try{
    const {origin,stop,destination}=req.body||{};
    if(!origin||!stop||!destination||!Number.isFinite(stop.lat)){
      return res.json({source:"none",coords:[]});
    }
    const key=`detour:v1:${origin.lat.toFixed(3)},${origin.lon.toFixed(3)}:${stop.lat.toFixed(3)},${stop.lon.toFixed(3)}:${destination.lat.toFixed(3)},${destination.lon.toFixed(3)}`;
    const cached=cacheGet(key,{allowStale:true});
    if(cached)return res.json(cached.data);

    try{
      const path=`${origin.lon},${origin.lat};${stop.lon},${stop.lat};${destination.lon},${destination.lat}`;
      const d=await fetchJson(`${OSRM}/route/v1/driving/${path}?overview=full&geometries=geojson`,{},12000);
      const r=d.routes?.[0];
      if(!r)throw new Error("OSRM sin ruta de desvío");
      const out={
        source:"osrm",
        coords:r.geometry.coordinates.map(([lon,lat])=>({lat,lon})),
        roadKm:Math.round(r.distance/100)/10,
        durationMin:Math.round(r.duration/60)
      };
      cacheSet(key,out);
      return res.json(out);
    }catch(e){
      debug("route-detour:",e.message);
      return res.json({source:"straight",coords:[origin,stop,destination]});
    }
  }catch(e){
    res.status(502).json({error:e.message||"No se pudo calcular el desvío."});
  }
});

// Polilínea REAL por carretera origen -> [vías...] -> destino. Se usa para
// pintar en el mapa la ruta del día CON las paradas seleccionadas incluidas
// (los desvíos se ven en todo momento, no sólo en hover).
app.post("/api/plan/route-via",async(req,res)=>{
  try{
    const {origin,vias=[],destination}=req.body||{};
    if(!origin||!destination||!Number.isFinite(origin.lat)||!Number.isFinite(destination.lat)){
      return res.json({source:"none",coords:[]});
    }
    const pts=[origin,...vias.filter(v=>Number.isFinite(v?.lat)),destination];
    const keyPts=pts.map(p=>`${p.lat.toFixed(3)},${p.lon.toFixed(3)}`).join("|");
    const key=`routeVia:v1:${keyPts}`;
    const cached=cacheGet(key,{allowStale:true});
    if(cached)return res.json(cached.data);

    try{
      const path=pts.map(p=>`${p.lon},${p.lat}`).join(";");
      const d=await fetchJson(`${OSRM}/route/v1/driving/${path}?overview=full&geometries=geojson`,{},12000);
      const r=d.routes?.[0];
      if(!r)throw new Error("OSRM sin ruta con vías");
      const out={
        source:"osrm",
        coords:r.geometry.coordinates.map(([lon,lat])=>({lat,lon})),
        roadKm:Math.round(r.distance/100)/10,
        durationMin:Math.round(r.duration/60)
      };
      cacheSet(key,out);
      return res.json(out);
    }catch(e){
      debug("route-via:",e.message);
      return res.json({source:"straight",coords:pts.map(p=>({lat:p.lat,lon:p.lon}))});
    }
  }catch(e){
    res.status(502).json({error:e.message||"No se pudo calcular la ruta con paradas."});
  }
});

app.listen(PORT,()=>console.log(`Travel Planner 1.2.27 en http://localhost:${PORT}`));
