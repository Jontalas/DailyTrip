const $=s=>document.querySelector(s);
let searchContext=null,chosen=null,routeData=null;
let pools={route:[],routeLunch:[],activities:[],food:[],lodging:[]};
let selected={route:[],activities:[],lunch:null,dinner:null,hotel:null};
let customDurations=new Map();
let rebuildSeq=0;

async function loadProviders(){
  try{
    const r=await fetch("/api/providers"),d=await r.json();
    $("#providerStatus").innerHTML=Object.entries(d).map(([k,v])=>`<span class="${v.configured?"ok":"off"}">${v.configured?"✓":"○"} ${labelProvider(k)} · ${v.role}</span>`).join("");
  }catch{}
}
function labelProvider(k){return({geoapify:"Geoapify",google:"Google Places",osm:"OSM",persistentCache:"Caché local",generated:"Fallback generado"}[k]||k);}
loadProviders();

function progressBox(selector,steps){
  const box=$(selector);box.classList.remove("hidden");
  box.innerHTML=steps.map((s,i)=>`<div class="step pending" data-step="${i}"><span>○</span><b>${s}</b></div>`).join("");
}
function setStep(selector,i,state){
  const e=$(`${selector} [data-step="${i}"]`);if(!e)return;
  e.className=`step ${state}`;e.querySelector("span").textContent=state==="done"?"✓":state==="error"?"!":"⟳";
}
function hideProgress(selector){setTimeout(()=>$(selector).classList.add("hidden"),700);}

$("#searchForm").onsubmit=async e=>{
  e.preventDefault();$("#results").innerHTML="";$("#planSection").classList.add("hidden");$("#preferences").classList.add("hidden");
  progressBox("#searchProgress",["Localizando origen y dirección","Calculando ruta","Buscando localidades","Validando kilómetros"]);
  try{
    setStep("#searchProgress",0,"working");
    const r1=await fetch("/api/search/context",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({origin:$("#origin").value,target:$("#target").value,desiredKm:+$("#desiredKm").value,toleranceKm:+$("#toleranceKm").value})});
    const c=await r1.json();if(!r1.ok)throw new Error(c.error);
    searchContext=c;setStep("#searchProgress",0,"done");setStep("#searchProgress",1,"done");

    setStep("#searchProgress",2,"working");
    const r2=await fetch("/api/search/candidates",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({origin:c.origin,anchors:c.anchors,desiredKm:c.desiredKm,toleranceKm:c.toleranceKm})});
    const d=await r2.json();if(!r2.ok)throw new Error(d.error);
    setStep("#searchProgress",2,"done");setStep("#searchProgress",3,"done");
    $("#searchStatus").textContent=d.disclaimer;renderBases(d.results);hideProgress("#searchProgress");
  }catch(e){$("#searchStatus").textContent=e.message;document.querySelectorAll("#searchProgress .pending,#searchProgress .working").forEach(x=>x.className="step error");}
};

function renderBases(items){
  $("#results").innerHTML=items.map((x,i)=>{
    const summary=x.baseSummary||{};
    const interest=x.baseInterest!=null?`${x.baseInterest}/100 interés`:"Interés N/D";
    const counts=summary.activities!=null
      ? `${summary.activities} actividades · ${summary.food} opciones para comer · ${summary.lodging} alojamientos`
      : "Contenido turístico no disponible durante esta búsqueda";

    return `<article class="base-card">
      <div class="rank">${i+1}</div>
      <div>
        <h3>${esc(x.name)} <small>${esc(interest)}</small></h3>
        <p><b>${x.roadKm} km</b> · ${fmt(x.durationMin)}</p>
        <p class="base-scores">
          <span>Rango válido ✓</span>
          <span>Diferencia respecto a ${searchContext?.desiredKm??""} km: ${x.distanceFromIdealKm} km <small>(no puntúa)</small></span>
        </p>
        <p class="muted">${esc(counts)}</p>
        <button data-base="${i}" type="button">Elegir esta base</button>
      </div>
    </article>`;
  }).join("");

  document.querySelectorAll("[data-base]").forEach(b=>b.onclick=()=>{
    chosen=items[+b.dataset.base];
    $("#chosenText").textContent=`Base elegida: ${chosen.name} · ${chosen.roadKm} km`;
    $("#planSection").classList.remove("hidden");
    $("#builder").classList.add("hidden");
    $("#planSection").scrollIntoView({behavior:"smooth"});
  });
}

$("#loadPlan").onclick=async()=>{
  if(!chosen)return;
  pools={route:[],routeLunch:[],activities:[],food:[],lodging:[]};
  selected={route:[],activities:[],lunch:null,dinner:null,hotel:null};
  progressBox("#planProgress",["Ruta detallada","Paradas en ruta","Comida en ruta","Actividades","Restauración y alojamiento"]);

  try{
    const destination={name:chosen.name,lat:chosen.lat,lon:chosen.lon};
    setStep("#planProgress",0,"working");
    const rr=await fetch("/api/plan/route",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({origin:searchContext.origin,destination})});
    const rd=await rr.json();if(!rr.ok)throw new Error(rd.error);
    routeData=rd.route;setStep("#planProgress",0,"done");

    const jobs=[
      [1,"/api/options/route",{route:routeData,destination}],
      [2,"/api/options/route-lunch",{route:routeData,destination}],
      [3,"/api/options/activities",{destination}],
      [4,"/api/options/services",{destination}]
    ].map(async([i,url,payload])=>{
      setStep("#planProgress",i,"working");
      try{
        const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
        const d=await r.json();setStep("#planProgress",i,"done");return{url,d};
      }catch(e){setStep("#planProgress",i,"error");return{url,d:{}};}
    });

    const all=await Promise.all(jobs);
    for(const x of all){
      if(x.url.endsWith("/route"))pools.route=x.d.items||[];
      else if(x.url.endsWith("/route-lunch"))pools.routeLunch=x.d.items||[];
      else if(x.url.endsWith("/activities"))pools.activities=x.d.items||[];
      else{pools.food=x.d.food||[];pools.lodging=x.d.lodging||[];}
    }

    try{
      const metricResp=await fetch("/api/metrics/route-options",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({route:routeData,items:pools.route})
      });
      const metricData=await metricResp.json();
      if(metricResp.ok && metricData.items?.length)pools.route=metricData.items;
    }catch{}

    sortPools();
    renderBuilder();
    $("#preferences").classList.remove("hidden");
    $("#builder").classList.remove("hidden");
    $("#planStatus").textContent="Selecciona opciones. El horario y la viabilidad se recalculan automáticamente.";
    hideProgress("#planProgress");
  }catch(e){$("#planStatus").textContent=e.message;}
};

function sortPools(){
  const prefs=getPreferences();
  for(const k of Object.keys(pools)){
    pools[k]=[...(pools[k]||[])].map(x=>({
      ...x,
      adjustedInterest:adjustedInterest(x,prefs),
      adjustedStageValue:adjustedStageValue(x,prefs)
    })).sort((a,b)=>{
      const av=a.adjustedStageValue??a.stageValue??a.adjustedInterest??a.interestScore??0;
      const bv=b.adjustedStageValue??b.stageValue??b.adjustedInterest??b.interestScore??0;
      return bv-av;
    });
  }
}


function getPreferences(){
  return [...document.querySelectorAll('#preferences input[type="checkbox"]:checked')].map(x=>x.value);
}

function preferenceBonus(item,prefs){
  const c=String(item.category||"").toLowerCase();
  let bonus=0;

  if(prefs.includes("history")&&(c.includes("historic")||c.includes("sights")||c.includes("cultural")))bonus+=10;
  if(prefs.includes("nature")&&(c.includes("nature")||c.includes("park")||c.includes("garden")))bonus+=10;
  if(prefs.includes("walk")&&(c.includes("park")||c.includes("sights")||c.includes("walk")||c.includes("viewpoint")))bonus+=7;
  if(prefs.includes("gastronomy")&&(c.includes("restaurant")||c.includes("cafe")||c.includes("food")))bonus+=10;
  if(prefs.includes("museums")&&c.includes("museum"))bonus+=12;
  if(prefs.includes("views")&&c.includes("viewpoint"))bonus+=12;

  return bonus;
}

function adjustedInterest(item,prefs){
  return Math.max(1,Math.min(100,(item.interestScore||50)+preferenceBonus(item,prefs)));
}
function adjustedStageValue(item,prefs){
  const base=item.stageValue??item.interestScore??50;
  return Math.max(1,Math.min(100,base+preferenceBonus(item,prefs)));
}

function bindPreferenceControls(){
  document.querySelectorAll('#preferences input[type="checkbox"]').forEach(el=>{
    el.onchange=()=>{
      sortPools();
      renderBuilder();
    };
  });
}

function renderBuilder(){
  $("#routeOptions").innerHTML=multiCards(pools.route,"route");
  $("#activityOptions").innerHTML=multiCards(pools.activities,"activities");
  $("#lunchOptions").innerHTML=lunchCards();
  $("#dinnerOptions").innerHTML=singleCards(pools.food,"dinner","Sin cena fijada");
  $("#hotelOptions").innerHTML=singleCards(pools.lodging,"hotel","Sin alojamiento fijado");
  bindSelections();
  bindPreferenceControls();
  bindDurationEditors();
  syncSelectedCardState();
  rebuild();
}

function badge(x){
  const src=({geoapify:"Geoapify",google:"Google",osm:"OSM",cache:"Caché","cache-stale":"Caché antigua",generated:"Generado"}[x.source]||x.source||"");
  return `<span class="source ${x.verified===false?"generated":""}">${esc(src)}</span>`;
}
function scoreBadge(x){
  const interest=x.adjustedInterest??x.interestScore??0;
  const value=x.adjustedStageValue??x.stageValue;
  return `<span class="interest">${interest}/100 interés</span>${value!=null?` <span class="stage-value">${value}/100 etapa</span>`:""}`;
}

function linkFor(x){
  const url=x.infoUrl||x.website||x.wikipediaUrl||("https://www.google.com/search?q="+encodeURIComponent(`${x.name} ${chosen?.name||""}`));
  return `<a class="more-link" href="${escAttr(url)}" target="_blank" rel="noopener">Más información ↗</a>`;
}

function recommendedMinutes(item){
  return Math.max(1,Math.round(Number(item?.durationMin)||60));
}
function selectedDuration(item){
  if(!item)return 0;
  const v=customDurations.get(item.id);
  return v==null?recommendedMinutes(item):Math.max(1,Math.round(Number(v)||1));
}
function ensureCustomDuration(item){
  if(item&&!customDurations.has(item.id))customDurations.set(item.id,recommendedMinutes(item));
}
function findItemById(id){
  for(const arr of Object.values(pools)){
    const found=(arr||[]).find(x=>x.id===id);
    if(found)return found;
  }
  if(selected.lunch?.id===id)return selected.lunch;
  if(selected.dinner?.id===id)return selected.dinner;
  if(selected.hotel?.id===id)return selected.hotel;
  return null;
}
function durationEditor(item){
  return `<label class="duration-editor">
    <span>Tiempo que usaré</span>
    <input type="number" min="1" max="720" step="5"
      value="${selectedDuration(item)}"
      data-duration-id="${escAttr(item.id)}"
      aria-label="Tiempo en minutos para ${escAttr(item.name)}">
    <b>min</b>
    <small>Recomendado: ${item.durationRangeMin??Math.round(recommendedMinutes(item)*.7)}–${item.durationRangeMax??Math.round(recommendedMinutes(item)*1.3)} min</small>
  </label>`;
}
function syncSelectedCardState(){
  document.querySelectorAll(".option-card").forEach(card=>{
    const input=card.querySelector('input[type="checkbox"],input[type="radio"]');
    card.classList.toggle("is-selected",Boolean(input?.checked&&input.value!==""));
  });
}
function bindDurationEditors(){
  document.querySelectorAll("[data-duration-id]").forEach(input=>{
    input.addEventListener("click",e=>e.stopPropagation());
    input.addEventListener("input",()=>{
      const item=findItemById(input.dataset.durationId);
      if(!item)return;
      const n=Number(input.value);
      if(Number.isFinite(n)&&n>=1&&n<=720){
        customDurations.set(item.id,Math.round(n));
        rebuild();
      }
    });
    input.addEventListener("change",()=>{
      const item=findItemById(input.dataset.durationId);
      if(!item)return;
      const n=Math.max(1,Math.min(720,Math.round(Number(input.value)||recommendedMinutes(item))));
      customDurations.set(item.id,n);
      input.value=n;
      rebuild();
    });
  });
}
function cardBody(x){
  const bits=[];
  if(x.rating)bits.push(`★ ${x.rating}${x.userRatingCount?` · ${x.userRatingCount} reseñas`:""}`);
  if(x.routeProgressPct!=null)bits.push(`${x.routeProgressPct}% del trayecto`);
  bits.push(`Duración: ${x.durationRangeMin??Math.round((x.durationMin||60)*.7)}–${x.durationRangeMax??Math.round((x.durationMin||60)*1.3)} min`);

  const routeMetrics=x.kmFromOrigin!=null
    ? `<div class="route-metrics">
        <span>Desde salida <b>${x.kmFromOrigin} km</b></span>
        <span>Hasta destino <b>${x.kmToDestination} km</b></span>
        <span>Desvío <b>+${x.extraKm} km</b></span>
        <span>Tiempo extra <b>+${x.extraMin} min</b></span>
      </div>`
    :"";

  const b=x.interestBreakdown;
  const breakdown=b?`
    <details class="score-details">
      <summary>Por qué tiene esta puntuación</summary>
      <div>
        <span>Tipo ${b.category}</span>
        <span>Valoración ${b.rating}</span>
        <span>Popularidad ${b.popularity}</span>
        <span>Información ${b.completeness}</span>
        <span>Fiabilidad ${b.reliability}</span>
      </div>
    </details>`:"";

  return `<span class="card-main">
    <b>${esc(x.name)} ${scoreBadge(x)} ${badge(x)}</b>
    <small>${esc(x.description||"Sin descripción adicional.")}</small>
    <em>${esc(bits.join(" · "))}</em>
    <div class="selected-duration">${durationEditor(x)}</div>
    ${routeMetrics}
    ${x.openingHours?`<small class="hours">Horario informado: ${esc(x.openingHours)}</small>`:""}
    ${breakdown}
    ${linkFor(x)}
  </span>`;
}
function multiCards(items,key){
  return items.map((x,i)=>`<label class="option-card" data-option="${key}:${i}"><input type="checkbox" name="${key}" value="${i}">${cardBody(x)}</label>`).join("")||'<p class="muted">Sin opciones.</p>';
}
function singleCards(items,key,none){
  return `<label class="option-card"><input type="radio" name="${key}" value="" checked><span class="card-main"><b>${none}</b></span></label>`+
    items.map((x,i)=>`<label class="option-card" data-option="${key}:${i}"><input type="radio" name="${key}" value="${i}">${cardBody(x)}</label>`).join("");
}

function lunchCards(){
  const options=[];

  for(const x of pools.routeLunch){
    options.push({...x,lunchPhase:"route"});
  }
  for(const x of pools.food){
    options.push({...x,lunchPhase:"destination"});
  }
  options.sort((a,b)=>(b.interestScore||0)-(a.interestScore||0));

  return `<label class="option-card"><input type="radio" name="lunch" value="" checked><span class="card-main"><b>Sin restaurante concreto</b><small>Se reservará igualmente un bloque de comida de 85 min entre 12:30 y 14:30.</small></span></label>`+
    options.map((x,i)=>`<label class="option-card" data-lunch-index="${i}"><input type="radio" name="lunch" value="${i}">${cardBody(x)}<span class="phase-label">${x.lunchPhase==="route"?"EN RUTA":"EN DESTINO"}</span></label>`).join("");
}

function allLunchOptions(){
  return [
    ...pools.routeLunch.map(x=>({...x,lunchPhase:"route"})),
    ...pools.food.map(x=>({...x,lunchPhase:"destination"}))
  ].sort((a,b)=>(b.interestScore||0)-(a.interestScore||0));
}

function bindSelections(){
  document.querySelectorAll('input[name="route"]').forEach(e=>e.onchange=()=>{
    const x=pools.route[+e.value];
    if(e.checked){ensureCustomDuration(x);selected.route=[...selected.route,x];}
    else selected.route=selected.route.filter(y=>y.id!==x.id);
    syncSelectedCardState();rebuild();
  });
  document.querySelectorAll('input[name="activities"]').forEach(e=>e.onchange=()=>{
    const x=pools.activities[+e.value];
    if(e.checked){ensureCustomDuration(x);selected.activities=[...selected.activities,x];}
    else selected.activities=selected.activities.filter(y=>y.id!==x.id);
    syncSelectedCardState();rebuild();
  });
  document.querySelectorAll('input[name="lunch"]').forEach(e=>e.onchange=()=>{
    const arr=allLunchOptions();selected.lunch=e.value===""?null:arr[+e.value];
    if(selected.lunch)ensureCustomDuration(selected.lunch);
    syncSelectedCardState();rebuild();
  });
  document.querySelectorAll('input[name="dinner"]').forEach(e=>e.onchange=()=>{
    selected.dinner=e.value===""?null:pools.food[+e.value];
    if(selected.dinner)ensureCustomDuration(selected.dinner);
    syncSelectedCardState();rebuild();
  });
  document.querySelectorAll('input[name="hotel"]').forEach(e=>e.onchange=()=>{
    selected.hotel=e.value===""?null:pools.lodging[+e.value];
    if(selected.hotel)ensureCustomDuration(selected.hotel);
    syncSelectedCardState();rebuild();
  });
}

function approxLocalTravelMin(a,b){
  if(!a||!b)return 0;
  const km=haversineKmClient(a,b)*1.22;
  return Math.max(5,Math.round(km/28*60));
}
function haversineKmClient(a,b){
  const R=6371,rad=d=>d*Math.PI/180;
  const dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}

function approximateSchedule(extraActivity=null){
  let t=toMin($("#departureTime").value||"09:30");
  const routeStops=[...selected.route].sort((a,b)=>(a.routeProgressPct||0)-(b.routeProgressPct||0));
  let prev=0;

  for(const s of routeStops){
    const p=(s.routeProgressPct||50)/100;
    t+=Math.max(5,routeData.durationMin*(p-prev));
    t+=selectedDuration(s); prev=p;
  }

  const lunch=selected.lunch;
  if(lunch?.lunchPhase==="route"){
    const p=(lunch.routeProgressPct||55)/100;
    if(p>prev)t+=routeData.durationMin*(p-prev);
    if(t<12*60+30)t=12*60+30;
    t+=85; prev=Math.max(prev,p);
  }

  t+=routeData.durationMin*(1-prev);

  if(lunch?.lunchPhase==="destination"){
    if(t<12*60+30)t=12*60+30;
    if(t<=14*60+30)t+=85;
  }else if(!lunch){
    // Always reserve lunch. If destination is too late, assume route lunch at 13:00.
    if(t>14*60+30){
      // route lunch adds 85 min to total journey; place it at 13:00
      t+=85;
    }else{
      if(t<12*60+30)t=12*60+30;
      t+=85;
    }
  }

  t+=selected.hotel?25:15;
  const acts=[...selected.activities];
  if(extraActivity&&!acts.some(x=>x.id===extraActivity.id))acts.push(extraActivity);

  let current={lat:chosen.lat,lon:chosen.lon};
  for(const a of acts){
    t+=approxLocalTravelMin(current,a)+selectedDuration(a);
    current=a;
  }

  if(selected.dinner){
    t+=approxLocalTravelMin(current,selected.dinner)+selectedDuration(selected.dinner);
  }
  return t;
}

function updateViability(){
  const endLimit=22*60+30;

  document.querySelectorAll('[data-option^="activities:"]').forEach(card=>{
    const idx=+card.dataset.option.split(":")[1];
    const item=pools.activities[idx];
    const checked=card.querySelector("input").checked;
    const viable=checked||approximateSchedule(item)<=endLimit;
    card.classList.toggle("not-viable",!viable);
    card.hidden=!viable;
  });

  const lunchOptions=allLunchOptions();
  document.querySelectorAll("[data-lunch-index]").forEach(card=>{
    const idx=+card.dataset.lunchIndex;
    const item=lunchOptions[idx];
    const checked=card.querySelector("input").checked;
    const viable=checked||isLunchViable(item);
    card.classList.toggle("not-viable",!viable);
    card.hidden=!viable;
  });
}

function isLunchViable(item){
  const dep=toMin($("#departureTime").value||"09:30");
  const lunchStart=12*60+30,lunchEnd=14*60+30;

  if(item.lunchOpening===false)return false;

  if(item.lunchPhase==="route"){
    const p=(item.routeProgressPct||55)/100;
    let t=dep+routeData.durationMin*p;
    for(const s of selected.route){
      if((s.routeProgressPct||0)/100 < p)t+=selectedDuration(s);
    }
    return t<=lunchEnd;
  }

  let arrival=dep+routeData.durationMin;
  for(const s of selected.route)arrival+=selectedDuration(s);
  return arrival<=lunchEnd;
}

async function exactTravelLegs(points){
  if(points.length<2)return[];
  try{
    const r=await fetch("/api/travel/sequence",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({points})});
    const d=await r.json();
    return d.legs||[];
  }catch{return[];}
}

async function rebuild(){
  if(!routeData)return;
  const seq=++rebuildSeq;
  updateViability();

  let t=toMin($("#departureTime").value||"09:30");
  const events=[];
  const routeStops=[...selected.route].sort((a,b)=>(a.routeProgressPct||0)-(b.routeProgressPct||0));
  let prev=0;

  events.push(evt(t,"Salida",$("#origin").value,"route"));

  for(const s of routeStops){
    const p=(s.routeProgressPct||50)/100;
    const drive=Math.max(5,Math.round(routeData.durationMin*(p-prev)));
    events.push(evt(t,"Desplazamiento",`Hasta ${s.name}`,"travel",drive));
    t+=drive;
    events.push(evt(t,"Parada",`${s.name} · ${selectedDuration(s)} min`,"route"));
    t+=selectedDuration(s);prev=p;
  }

  const lunch=selected.lunch;
  if(lunch?.lunchPhase==="route"){
    const p=(lunch.routeProgressPct||55)/100;
    if(p>prev){
      const drive=Math.max(5,Math.round(routeData.durationMin*(p-prev)));
      events.push(evt(t,"Desplazamiento","Hasta comida","travel",drive));t+=drive;
    }
    if(t<12*60+30)t=12*60+30;
    events.push(evt(t,"Comida",`${lunch.name} · ${selectedDuration(lunch)} min`,"food"));t+=selectedDuration(lunch);prev=Math.max(prev,p);
  }

  if(prev<1){
    const drive=Math.max(5,Math.round(routeData.durationMin*(1-prev)));
    events.push(evt(t,"Desplazamiento",`Hasta ${chosen.name}`,"travel",drive));
    t+=drive;
  }
  events.push(evt(t,"Llegada",chosen.name,"destination"));

  if(!lunch || lunch.lunchPhase==="destination"){
    if(t<12*60+30)t=12*60+30;
    if(t<=14*60+30){
      events.push(evt(t,"Comida",`${lunch?.name||"Bloque reservado para comer"} · ${lunch?selectedDuration(lunch):85} min`,"food"));t+=lunch?selectedDuration(lunch):85;
    }else if(!lunch){
      events.push(evt(13*60,"Comida","Bloque reservado en ruta (sin restaurante concreto)","food"));
      t+=85;
    }
  }

  const destinationSequence=[];
  if(selected.hotel)destinationSequence.push({kind:"hotel",item:selected.hotel,duration:selectedDuration(selected.hotel),label:"Check-in"});
  for(const a of selected.activities)destinationSequence.push({kind:"activity",item:a,duration:selectedDuration(a),label:"Actividad"});
  if(selected.dinner)destinationSequence.push({kind:"dinner",item:selected.dinner,duration:selectedDuration(selected.dinner),label:"Cena"});

  const points=[{lat:chosen.lat,lon:chosen.lon,name:chosen.name},...destinationSequence.map(x=>x.item)];
  const legs=await exactTravelLegs(points);
  if(seq!==rebuildSeq)return;

  let currentName=chosen.name;
  destinationSequence.forEach((x,i)=>{
    const leg=legs[i];
    const travel=leg?.durationMin??approxLocalTravelMin(i===0?{lat:chosen.lat,lon:chosen.lon}:destinationSequence[i-1].item,x.item);
    if(travel>0){
      events.push(evt(t,"Desplazamiento",`${currentName} → ${x.item.name}`,"travel",travel));t+=travel;
    }

    if(x.kind==="dinner"&&t<19*60)t=19*60;
    events.push(evt(t,x.label,`${x.item.name} · ${x.duration} min`,x.kind==="dinner"?"food":"destination"));
    t+=x.duration;
    currentName=x.item.name;
  });

  if(!selected.activities.length){
    events.push(evt(t,"Tiempo libre","Paseo, descanso o decisión espontánea","destination"));t+=60;
  }

  $("#timeline").innerHTML=events.sort((a,b)=>a.time-b.time).map(e=>`
    <div class="timeline-row ${e.phase}">
      <time>${esc(leftTimelineValue(e))}</time><b>${esc(e.label)}</b><span>${esc(e.detail)}</span>
    </div>`).join("");

  const warnings=[];
  if(t>22*60+30)warnings.push(`El plan termina sobre las ${fromMin(t)}. Algunas opciones se han ocultado para evitar sobrecargar más el día.`);
  if(selected.lunch&&selected.lunch.lunchOpening==null)warnings.push("El horario de apertura del restaurante de comida no está confirmado por la fuente; conviene comprobarlo en el enlace.");
  $("#dayWarnings").innerHTML=warnings.map(w=>`<p class="warning">${esc(w)}</p>`).join("");

  updateViability();
}


function leftTimelineValue(e){
  if(e.phase!=="travel")return fromMin(e.time);
  if(Number.isFinite(e.durationMin))return `${Math.round(e.durationMin)} min`;

  const match=String(e.detail||"").match(/(\d+)\s*min/);
  return match?`${match[1]} min`:"—";
}

function evt(time,label,detail,phase,durationMin=null){
  return{time,label,detail,phase,durationMin};
}
function toMin(v){const[h,m]=v.split(":").map(Number);return h*60+m;}
function fromMin(v){const x=((Math.round(v)%1440)+1440)%1440;return`${String(Math.floor(x/60)).padStart(2,"0")}:${String(x%60).padStart(2,"0")}`;}
function fmt(m){const h=Math.floor(m/60),x=m%60;return h?`${h} h ${x} min`:`${x} min`;}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function escAttr(v){return esc(v).replace(/`/g,"&#096;");}
