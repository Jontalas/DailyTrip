import {haversineKm} from '../client/src/lib/format.js';

export async function roadMatrix(points,request,osrm,withDistance=false) {
  const durations=points.map(a=>points.map(b=>haversineKm(a,b)*120));
  const distances=points.map(a=>points.map(b=>haversineKm(a,b)*1250));
  try {
    for(let a=0;a<points.length;a+=20)for(let b=0;b<points.length;b+=20){
      const src=points.slice(a,a+20),dst=points.slice(b,b+20);
      const path=[...src,...dst].map(p=>`${p.lon},${p.lat}`).join(';');
      const sources=src.map((_,i)=>i).join(';'),destinations=dst.map((_,i)=>i+src.length).join(';');
      const data=await request(`${osrm}/table/v1/driving/${path}?sources=${sources}&destinations=${destinations}${withDistance?'&annotations=duration,distance':''}`,{},12000);
      for(const name of withDistance?['durations','distances']:['durations']){
        if(data[name]?.length!==src.length || data[name].some(row=>row.length!==dst.length || row.some(x=>!Number.isFinite(x))))throw Error('Matriz incompleta');
        const target=name==='durations'?durations:distances;
        data[name].forEach((row,i)=>row.forEach((value,j)=>target[a+i][b+j]=value));
      }
    }
    return {durations,distances,source:'osrm'};
  }catch{
    return {durations:points.map(a=>points.map(b=>haversineKm(a,b)*120)),
      distances:points.map(a=>points.map(b=>haversineKm(a,b)*1250)),source:'estimated'};
  }
}
