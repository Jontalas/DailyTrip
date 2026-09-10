import {dayStops,orderDay} from '../client/src/lib/day-plan.js';
import {roadMatrix} from './road-matrix.js';

// Compare whole itineraries, keeping every selected visit in both alternatives.
export async function routeOptionMetrics({route,items},request,osrm) {
  const {origin,chosen,selected}=route.plan || {origin:route.coords[0],chosen:route.coords.at(-1),
    selected:{route:[],activities:[],lunch:null,dinner:null,hotel:null}};
  const base=dayStops(selected,chosen);
  const key=p=>`${p.lat},${p.lon}`;
  const points=[...new Map([origin,...base.map(s=>s.item),...items].map(p=>[key(p),p])).values()];
  const indices=new Map(points.map((p,i)=>[key(p),i]));
  const {durations,distances,source}=await roadMatrix(points,request,osrm,true);
  const index=p=>indices.get(key(p));
  const evaluate=stops=>{
    const local=[origin,...stops.map(s=>s.item)];
    const matrix=local.map(a=>local.map(b=>durations[index(a)][index(b)]));
    const order=orderDay(stops,origin,matrix),path=[origin,...order.map(s=>s.item)];
    const legs=path.slice(1).map((p,i)=>({km:distances[index(path[i])][index(p)]/1000,min:durations[index(path[i])][index(p)]/60}));
    return {order,legs,km:legs.reduce((n,l)=>n+l.km,0),min:legs.reduce((n,l)=>n+l.min,0)};
  };
  const baseline=evaluate(base);
  return {source,items:items.map(item=>{
    const present=base.some(s=>s.item.id===item.id);
    const via=present?baseline:evaluate(dayStops({...selected,route:[...selected.route,item]},chosen));
    const position=via.order.findIndex(s=>s.item.id===item.id);
    const kmFromOrigin=via.legs.slice(0,position+1).reduce((n,l)=>n+l.km,0);
    const extraMin=Math.max(0,via.min-baseline.min),extraKm=Math.max(0,via.km-baseline.km);
    const timeCost=(item.durationMin||60)+extraMin;
    return {...item,kmFromOrigin:Math.round(kmFromOrigin*10)/10,kmToDestination:Math.round((via.km-kmFromOrigin)*10)/10,
      extraKm:Math.round(extraKm*10)/10,extraMin:Math.round(extraMin),
      stageValue:Math.round(Math.max(1,Math.min(100,(item.interestScore||60)*.72+Math.max(0,100-timeCost*.55)*.18+Math.max(0,100-extraMin*2.4)*.10)))};
  })};
}
