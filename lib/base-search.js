export function searchTolerance(value=40) {
  const km=Number(value);
  if(value===null || !Number.isFinite(km) || km<0 || km>300)throw Error('La tolerancia debe estar entre 0 y 300 km.');
  return km;
}

// Validate the target-to-candidate road distance before displaying rounded km.
// The origin distance only describes the trip; it never decides eligibility.
export async function nearbyBaseRoutes(origin,target,candidates,tolerance,table) {
  const accepted=[];
  for(let i=0;i<candidates.length;i+=20) {
    const batch=candidates.slice(i,i+20);
    const fromTarget=await table(target,batch);
    const eligible=fromTarget.filter(x=>Number.isFinite(x.roadKm) && x.roadKm<=tolerance)
      .map(x=>({...x,distanceToTargetKm:x.roadKm}));
    if(!eligible.length)continue;
    const fromOrigin=await table(origin,eligible);
    accepted.push(...fromOrigin.filter(x=>Number.isFinite(x.roadKm)&&Number.isFinite(x.durationMin))
      .map(x=>({...x,roadKm:Math.round(x.roadKm),durationMin:Math.round(x.durationMin),distanceToTargetKm:Math.round(x.distanceToTargetKm*10)/10})));
  }
  return accepted;
}
