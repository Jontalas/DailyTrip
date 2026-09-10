/* Motor único de itinerario y viabilidad, v1.2.11.
   Tramos por pares dirigidos: las respuestas de otra secuencia no se reutilizan
   por posición. Las duraciones del usuario se aplican también a la viabilidad. */
import { fromMin, approxLocalTravelMin } from "./format.js";
import {dayStops,orderDay} from './day-plan.js';
export const LUNCH_START = 750;
export const LUNCH_END = 870;
export const DINNER_MIN = 1140;
export const DAY_END = 1350;
export const legKey = (a,b) => `${a.lat},${a.lon}>${b.lat},${b.lon}`;

export function itineraryStops(selected,chosen=null,origin=null,orderedStops=null) {
  if(chosen && origin) {
    const stops=orderedStops || orderDay(dayStops(selected,chosen),origin);
    const base=stops.findIndex(s=>s.kind==='base');
    if(base<0)return {route:[],destination:stops,hasBase:false};
    return {route:stops.slice(0,base),destination:stops.slice(base+1),hasBase:true};
  }
  const route = selected.route.map(item => ({item,kind:"route",label:"Parada"}));
  if(selected.lunch?.lunchPhase === "route") route.push({item:selected.lunch,kind:"lunch",label:"Comida"});
  route.sort((a,b)=>(a.item.routeProgressPct ?? 50)-(b.item.routeProgressPct ?? 50));
  const destination=[];
  if(selected.lunch?.lunchPhase === "destination") destination.push({item:selected.lunch,kind:"lunch",label:"Comida"});
  if(selected.hotel) destination.push({item:selected.hotel,kind:"hotel",label:"Check-in"});
  destination.push(...selected.activities.map(item=>({item,kind:"activity",label:"Actividad"})));
  if(selected.dinner) destination.push({item:selected.dinner,kind:"dinner",label:"Cena"});
  return {route,destination,hasBase:true};
}
export function travelPoints({chosen,routeData,selected,orderedStops}) {
  if(!chosen || !routeData?.coords?.length) return [];
  const stops=orderedStops || orderDay(dayStops(selected,chosen),routeData.coords[0]);
  return [routeData.coords[0],...stops.map(s=>s.item)];
}
export function buildItinerary({originName="Origen",chosen,routeData,selected,durationOf,departureMin,legCache=new Map(),orderedStops=null}) {
  const events=[], warnings=[];
  let t=departureMin, estimated=false, lunchDone=false;
  if(!chosen || !routeData) return {events,endTime:t,warnings};
  const {route,destination,hasBase}=itineraryStops(selected,chosen,routeData.coords?.[0],orderedStops);
  let current=routeData.coords?.[0] || chosen;
  let progress=0;
  const push=(label,name,mins,kind,item=null)=>{
    events.push({time:t,label,name,detail:name,phase:kind==="travel"?"travel":kind==="lunch"||kind==="dinner"?"food":kind==="route"?"route":"destination",durationMin:kind==="travel"?mins:null,mins:kind==="travel"?undefined:mins,kind,item});
    t+=mins || 0;
  };
  const reservedLunch=()=>{
    t=Math.max(t,LUNCH_START);
    if(t>LUNCH_END) warnings.push("La salida o las visitas impiden reservar la comida antes de las 14:30.");
    push("Comida","Bloque reservado para comer",85,"lunch");
    lunchDone=true;
  };
  const drive=(to,nextProgress=null)=>{
    const known=legCache.get(legKey(current,to));
    let minutes;
    if(Number.isFinite(known?.durationMin)) {
      minutes=Math.max(0,known.durationMin);
      if(known.source!=="osrm") estimated=true;
    } else {
      estimated=true;
      // Sin paradas, se conoce el tiempo de la ruta directa. Con paradas,
      // estimación por tramo: no sumar desvíos completos que se solapan.
      minutes=nextProgress!==null
        ? Math.max(approxLocalTravelMin(current,to), routeData.durationMin*Math.max(0,nextProgress-progress))
        : approxLocalTravelMin(current,to);
      if(route.length===0 && nextProgress===1) minutes=routeData.durationMin;
    }
    minutes=Math.round(minutes);
    const totalMinutes=minutes;
    let eatOnArrival=false,split=false;
    const travel=(name,part)=>{
      push('Desplazamiento',name,part,'travel');
      if(split)Object.assign(events.at(-1),{journeyDurationMin:totalMinutes,journeyFrom:current.name || originName,journeyTo:to.name || chosen.name});
    };
    if(!selected.lunch && !lunchDone && t+minutes>=780) {
      if(t+minutes<=LUNCH_END){
        // Finish a short drive and eat at its destination, not at an
        // invented point on the road just because the clock strikes 13:00.
        eatOnArrival=true;
      }else if(t>=LUNCH_START){
        reservedLunch();
      }else{
        // A long drive starting before lunchtime still needs a break.
        // Both portions explicitly retain the full journey duration.
        split=true;
        const before=Math.max(0,Math.min(minutes,780-t));
        if(before)travel(`Hacia ${to.name || chosen.name} · antes de comer`,before);
        minutes-=before;
        reservedLunch();
      }
    }
    if(minutes>0)travel(`Hasta ${to.name || chosen.name}${split?' · después de comer':''}`,minutes);
    current=to;
    if(eatOnArrival)reservedLunch();
    if(nextProgress!==null) progress=nextProgress;
  };
  const visit=({item,kind,label})=>{
    const mins=kind==='hotelReturn'?0:durationOf(item);
    if(!selected.lunch && !lunchDone && (kind==="route" || kind==="activity") && t+mins>LUNCH_END) reservedLunch();
    if(kind==="lunch") {
      t=Math.max(t,LUNCH_START);
      if(t>LUNCH_END) warnings.push("La comida seleccionada empieza después de las 14:30. Cambia el restaurante, las paradas o la salida.");
      lunchDone=true;
    }
    if(kind==="dinner") {
      if(!selected.lunch && !lunchDone) reservedLunch();
      t=Math.max(t,DINNER_MIN);
    }
    push(label,item.name,mins,kind,item);
  };
  push("Salida",originName,0,"route");
  for(const stop of route) {
    drive(stop.item,(stop.item.routeProgressPct ?? 50)/100);
    visit(stop);
  }
  if(hasBase){
    drive(chosen,1);
    push("Llegada",chosen.name,0,"base",chosen);
  }
  for(const [index,stop] of destination.entries()) {
    drive(stop.item);
    if(!selected.lunch && !lunchDone && (stop.kind==='hotel' || stop.kind==='hotelReturn')) {
      if(index===destination.length-1 || t+durationOf(stop.item)>LUNCH_END)reservedLunch();
    }
    visit(stop);
  }
  if(!selected.hotel && !selected.activities.length && !destination.some(s=>s.kind==='route')) push("Tiempo libre","Paseo, descanso o decisión espontánea",60,"free");
  if(!selected.lunch && !lunchDone) reservedLunch();
  if(t>DAY_END) warnings.push(`El plan termina sobre las ${fromMin(t)} y supera las 22:30.`);
  if(selected.lunch?.lunchOpening == null && selected.lunch) warnings.push("El horario del restaurante no está confirmado; compruébalo en su enlace.");
  if(selected.lunch?.lunchOpening === false) warnings.push("El horario informado no cubre la ventana de comida.");
  if(estimated) warnings.push("Algunos desplazamientos son estimados; los horarios se ajustarán cuando haya datos de carretera.");
  return {events,endTime:t,warnings,estimated};
}
export function approximateSchedule(args) {
  const selected={...args.selected,activities:[...args.selected.activities]};
  if(args.extraActivity && !selected.activities.some(x=>x.id===args.extraActivity.id)) selected.activities.push(args.extraActivity);
  return buildItinerary({...args,selected}).endTime;
}
export function isLunchViable(args) {
  if(!args.item) return false;
  const selected={...(args.selected || {route:args.selectedRoute || [],activities:[],hotel:null,dinner:null}),lunch:args.item};
  const result=buildItinerary({...args,selected});
  const lunch=result.events.find(e=>e.kind==="lunch");
  return !!lunch && lunch.time<=LUNCH_END;
}
export function leftTimelineValue(e) {
  if(e.phase!=="travel") return fromMin(e.time);
  return Number.isFinite(e.durationMin)?`${Math.round(e.durationMin)} min`:"—";
}
