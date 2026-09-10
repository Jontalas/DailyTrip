import { haversineKm } from './format.js';
import {optimalOrder} from './optimal-order.js';

export function dayStops(selected, chosen) {
  const route = selected.route.map(item => ({item,kind:'route',label:'Parada'}));
  if(selected.lunch?.lunchPhase === 'route') route.push({item:selected.lunch,kind:'lunch',label:'Comida'});
  route.sort((a,b)=>(a.item.routeProgressPct ?? 50)-(b.item.routeProgressPct ?? 50));
  return [...route, {item:chosen,kind:'base',label:'Llegada'},
    ...(selected.lunch?.lunchPhase === 'destination' ? [{item:selected.lunch,kind:'lunch',label:'Comida'}] : []),
    ...(selected.hotel ? [{item:selected.hotel,kind:'hotel',label:'Check-in'}] : []),
    ...selected.activities.map(item=>({item,kind:'activity',label:'Actividad'})),
    ...(selected.dinner ? [{item:selected.dinner,kind:'dinner',label:'Cena'}] : []),
    ...(selected.hotel ? [{item:selected.hotel,kind:'hotelReturn',label:'Llegada al alojamiento'}] : [])];
}

// Directed costs matter: one-way streets make reversing a leg non-equivalent.
// Relocate visits while retaining meal/check-in anchors and destination boundaries.
// Strictly decreasing cost guarantees termination and never worsens the initial plan.
export function orderDay(stops, origin, costs=null) {
  const points=[origin,...stops.map(s=>s.item)];
  const matrix=costs || points.map(a=>points.map(b=>haversineKm(a,b)));
  let order=stops.map((_,i)=>i+1);
  // A custom visit cannot remove the chosen destination by crossing an
  // otherwise terminal base. Destination activities/meals/lodging still
  // replace the town-centre waypoint when they already follow that base.
  const terminalBase=stops.at(-1)?.kind==='base';
  // The base remains a virtual phase boundary during ordering, but only a
  // terminal base is a real waypoint. Never optimize through the town centre
  // when the day continues to a useful destination visit.
  const real=seq=>seq.filter((id,i)=>stops[id-1].kind!=='base' || i===seq.length-1);
  const cost=seq=>real(seq).reduce((sum,id,i,ids)=>sum+matrix[i ? ids[i-1] : 0][id],0);
  const valid=seq=>{
    const base=seq.findIndex(id=>stops[id-1].kind==='base');
    if(terminalBase && base!==seq.length-1)return false;
    const dinner=seq.findIndex(id=>stops[id-1].kind==='dinner');
    return seq.every((id,i)=>{
      const s=stops[id-1];
      if(s.kind==='hotelReturn')return i===seq.length-1;
      if(dinner>=0 && i>dinner) return false;
      if(seq.some((other,j)=>stops[other-1].kind==='hotelReturn' && j<i))return false;
      if(s.kind==='activity') return i>base;
      return true;
    });
  };
  const exact=optimalOrder(stops,matrix);
  if(exact && cost(exact)<cost(order)-0.001)order=exact;
  let total=cost(order), improved=!exact;
  while(improved) {
    improved=false;
    for(const id of [...order]) {
      const s=stops[id-1];
      if(!['route','activity'].includes(s.kind)) continue;
      const rest=order.filter(x=>x!==id);
      let best=order, bestCost=total;
      for(let i=0;i<=rest.length;i++) {
        const candidate=[...rest.slice(0,i),id,...rest.slice(i)];
        if(!valid(candidate)) continue;
        const value=cost(candidate);
        if(value<bestCost-0.001) {best=candidate;bestCost=value;}
      }
      if(best!==order) {order=best;total=bestCost;improved=true;}
    }
  }
  const result=real(order).map(id=>stops[id-1]);
  // If nothing follows check-in, that arrival already ends the day.
  if(result.at(-1)?.kind==='hotelReturn' && result.at(-2)?.kind==='hotel')result.pop();
  return result;
}

export function daySignature({selected,chosen,routeData}) {
  if(!chosen || !routeData?.coords?.length) return '';
  return JSON.stringify([routeData.coords[0], ...dayStops(selected,chosen).map(s=>[
    s.kind,s.item.id,s.item.lat,s.item.lon,!!s.item.custom,s.item.routeProgressPct])]);
}
