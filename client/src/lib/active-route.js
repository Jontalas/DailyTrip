import {routeGeometryIndex, routeStopTarget} from '../../../lib/route-search.js';

// Only routing fields travel with a corridor; descriptions/photos stay in pools.
const point = x => x && Object.fromEntries(['id','name','lat','lon','custom','routeProgressPct','lunchPhase'].filter(k=>x[k]!=null).map(k=>[k,x[k]]));
export function routingSelection(selected) {
  return {route:selected.route.map(point),activities:selected.activities.map(point),
    lunch:point(selected.lunch),dinner:point(selected.dinner),hotel:point(selected.hotel)};
}

export function activeDayRoute(day, origin, chosen, selected) {
  if(day?.source!=='osrm' || !day.segments?.length) return null;
  const coords=day.segments.flatMap((segment,i)=>i?segment.slice(1):segment);
  if(coords.length<2)return null;
  return {coords,roadKm:day.roadKm,durationMin:day.durationMin,source:'osrm',
    plan:{origin:point(origin),chosen:point(chosen),selected:routingSelection(selected)}};
}

// Compare against the last searched corridor, not the last tiny route change.
// Symmetric comparison also detects roads that have disappeared from the trip.
export function corridorChanged(previous,next) {
  if(!previous?.coords?.length)return true;
  if(routeStopTarget(previous.roadKm)!==routeStopTarget(next.roadKm))return true;
  try {
    const a=routeGeometryIndex(previous.coords),b=routeGeometryIndex(next.coords);
    const outside=(from,to)=>{
      const steps=Math.max(1,Math.ceil(from.total/2));
      for(let i=0;i<=steps;i++)if(to.locate(from.pointAt(from.total*i/steps)).distanceToRouteKm>2)return true;
      return false;
    };
    return outside(a,b)||outside(b,a);
  }catch{return true;}
}
