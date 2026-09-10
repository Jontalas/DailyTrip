export function destinationScale(destination) {
  const population=Number(destination.population);
  const known=Number.isFinite(population) && population>0;
  const estimate=known?population:({city:200000,town:20000,village:3000,hamlet:500}[destination.type] || 10000);
  const tier=estimate<=2000?0:estimate<=10000?1:estimate<=50000?2:estimate<=250000?3:estimate<=1000000?4:5;
  const activities=[12,20,35,65,110,180][tier];
  return {population:known?population:null,populationSource:destination.populationSource || (known?'proveedor':'tipo de localidad'),
    estimated:!known,tier,radiusKm:[1.5,2.5,4,7,10,16][tier],targets:{activities,food:Math.max(10,Math.round(activities*.8)),lodging:Math.max(6,Math.round(activities*.5))}};
}

export function topInterest(items,target) {
  return [...items].sort((a,b)=>(b.interestScore ?? 0)-(a.interestScore ?? 0) || String(a.name).localeCompare(String(b.name),'es') || String(a.id).localeCompare(String(b.id))).slice(0,target);
}

// Keep the newest population observation, not the largest historical value.
export function latestPopulation(claims=[]) {
  return claims.filter(c=>c.rank!=='deprecated' && Number(c.mainsnak?.datavalue?.value?.amount)>0)
    .map(c=>({value:Number(c.mainsnak.datavalue.value.amount),date:c.qualifiers?.P585?.[0]?.datavalue?.value?.time || '',rank:c.rank==='preferred'?1:0}))
    .sort((a,b)=>b.date.localeCompare(a.date)||b.rank-a.rank)[0]?.value || null;
}
