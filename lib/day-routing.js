import {dayStops,orderDay} from '../client/src/lib/day-plan.js';
import {haversineKm} from '../client/src/lib/format.js';
import {roadMatrix} from './road-matrix.js';

export async function routeDay({origin,chosen,selected},request,osrm) {
  const original=dayStops(selected,chosen);
  const points=[origin,...original.map(s=>s.item)];
  const {durations:matrix,source:optimizationSource}=await roadMatrix(points,request,osrm);
  const stops=orderDay(original,origin,matrix);
  const ordered=[origin,...stops.map(s=>s.item)];
  const legs=[],segments=[],accessWarnings=[];
  for(let i=0;i<ordered.length-1;i+=19) {
    const batch=ordered.slice(i,i+20);
    try {
      const path=batch.map(p=>`${p.lon},${p.lat}`).join(';');
      const data=await request(`${osrm}/route/v1/driving/${path}?overview=full&geometries=geojson&steps=false`,{},15000);
      const route=data.routes?.[0];
      if(route?.legs?.length!==batch.length-1 || !route.geometry?.coordinates?.length) throw Error('Ruta incompleta');
      legs.push(...route.legs.map(l=>({durationMin:Math.round(l.duration/60),distanceKm:l.distance/1000,source:'osrm'})));
      segments.push(route.geometry.coordinates.map(([lon,lat])=>({lat,lon})));
      (data.waypoints || []).forEach((p,j)=>{
        if(p.distance>150) accessWarnings.push(`El acceso en coche a ${batch[j].name || 'este punto'} queda a unos ${Math.round(p.distance)} m. Comprueba el último tramo a pie.`);
      });
    } catch {
      legs.push(...batch.slice(1).map((p,j)=>({durationMin:Math.max(5,Math.round(haversineKm(batch[j],p)*1.25/35*60)),distanceKm:haversineKm(batch[j],p)*1.25,source:'estimated'})));
      // Never present straight lines as a computed road route.
    }
  }
  return {stops,legs,segments,optimizationSource,source:legs.every(l=>l.source==='osrm')?'osrm':'estimated',
    roadKm:legs.reduce((n,l)=>n+l.distanceKm,0),durationMin:legs.reduce((n,l)=>n+l.durationMin,0),accessWarnings:[...new Set(accessWarnings)]};
}
