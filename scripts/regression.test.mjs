import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../client/src/lib/api.js';
import {loadCategory} from '../client/src/lib/loading.js';
import {buildItinerary,approximateSchedule,isLunchViable,travelPoints,legKey} from '../client/src/lib/itinerary.js';

const point=(id,progress=50)=>({id,name:id,lat:36+progress/100,lon:-4,routeProgressPct:progress,durationMin:30});
function fixture(selected={}) {
  return {originName:'Origen',chosen:point('Base',100),routeData:{durationMin:240,coords:[point('Origen',0),point('Base',100)]},
    selected:{route:[],activities:[],lunch:null,dinner:null,hotel:null,...selected},departureMin:570,durationOf:x=>x.durationMin};
}
function exact(args,minutes) {
  const points=travelPoints(args);
  return new Map(points.slice(1).map((p,i)=>[legKey(points[i],p),{durationMin:minutes[i],source:'osrm'}]));
}
test('50 paradas sobreviven a un lote de métricas fallido y respuestas reordenadas',async()=>{
  const old=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(url,req)=>{
    const body=JSON.parse(req.body);calls.push(body.items.length);
    if(calls.length===2) throw Error('sin conexión');
    return {ok:true,json:async()=>({source:'osrm',items:body.items.toReversed().map(x=>({...x,extraMin:7}))})};
  };
  try {
    const items=Array.from({length:50},(_,i)=>point(String(i)));
    const result=await api.metricsRouteOptions({route:{},items});
    assert.deepEqual(calls,[20,20,10]);
    assert.deepEqual(result.items.map(x=>x.id),items.map(x=>x.id));
    assert.equal(result.items[25].extraMin,undefined);
    assert.equal(result.items[49].extraMin,7);
    assert.equal(result.degraded,true);
  } finally {globalThis.fetch=old;}
});
test('secuencias largas conservan los tramos entre lotes',async()=>{
  const old=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,req)=>{
    const {points}=JSON.parse(req.body);calls.push(points.map(p=>p.id));
    return {ok:true,json:async()=>({source:'osrm',legs:points.slice(1).map(p=>({durationMin:Number(p.id)}))})};
  };
  try {
    const result=await api.travelSequence({points:Array.from({length:45},(_,i)=>point(String(i)))});
    assert.equal(result.legs.length,44);
    assert.equal(calls[1][0],calls[0].at(-1));
    assert.deepEqual(result.legs.map(x=>x.durationMin),Array.from({length:44},(_,i)=>i+1));
  }finally{globalThis.fetch=old;}
});
test('comida intercalada entre paradas y tiempos reales de la secuencia',()=>{
  const lunch={...point('Comida',50),lunchPhase:'route',durationMin:10};
  const args=fixture({route:[{...point('Final',80),extraMin:100},point('Inicial',20)],lunch,activities:[point('Museo')]});
  args.legCache=exact(args,[90,50,60,40,5]);
  const result=buildItinerary(args);
  assert.deepEqual(result.events.filter(e=>['route','lunch','base','activity'].includes(e.kind)).map(e=>e.name),['Origen','Inicial','Comida','Museo','Final']);
  assert.equal(result.events.filter(e=>e.phase==='travel').reduce((n,e)=>n+e.durationMin,0),240);
  assert.equal(result.endTime,920);
  assert.equal(approximateSchedule(args),result.endTime);
  assert.equal(isLunchViable({...args,item:lunch}),true);
});
test('viabilidad respeta duraciones personalizadas, desplazamiento al restaurante y cena mínima',()=>{
  const args=fixture({lunch:{...point('Comida'),lunchPhase:'destination',durationMin:10},hotel:{...point('Hotel'),durationMin:10},activities:[point('Museo')],dinner:{...point('Cena'),durationMin:15}});
  args.legCache=exact(args,[240,10,5,5,5]);
  assert.equal(buildItinerary(args).endTime,1160);
  assert.equal(approximateSchedule(args),1160);
  args.selected.hotel.durationMin=600;
  assert.equal(approximateSchedule(args),buildItinerary(args).endTime);
  assert.ok(approximateSchedule(args)>1350);
  assert.equal(isLunchViable({...args,departureMin:700,item:args.selected.lunch}),false);
  assert.ok(buildItinerary({...args,departureMin:700}).events.some(e=>e.kind==='lunch'));
});
test('comida reservada parte la conducción sin solapamientos ni tiempo perdido',()=>{
  const args=fixture();args.routeData.durationMin=400;
  args.legCache=exact(args,[400]);
  const result=buildItinerary(args);
  const lunch=result.events.find(e=>e.kind==='lunch');
  assert.equal(lunch.time,780);
  assert.equal(lunch.mins,85);
  assert.equal(result.events.filter(e=>e.phase==='travel').reduce((n,e)=>n+e.durationMin,0),400);
  const portions=result.events.filter(e=>e.phase==='travel');
  assert.equal(portions.length,2);
  assert.ok(portions.every(e=>e.journeyDurationMin===400));
  assert.ok(portions[0].name.includes('antes de comer'));
  assert.ok(portions[1].name.includes('después de comer'));
  for(let i=1;i<result.events.length;i++){
    const prev=result.events[i-1];
    assert.ok(result.events[i].time>=prev.time+(prev.durationMin??prev.mins??0));
  }
});
test('datos reales, vacío real, respaldo y error se distinguen; reintento conserva contenido',async()=>{
  const items=[point('Anterior')];
  const error=await loadCategory(async()=>{throw Error('offline');},items);
  assert.equal(error.status,'error');assert.deepEqual(error.items,items);
  const empty=await loadCategory(async()=>({status:'ok',items:[]}));
  assert.equal(empty.status,'ok');assert.deepEqual(empty.items,[]);
  const fallback=await loadCategory(async()=>({status:'fallback',source:'generated',items:[point('Generada')]}),items);
  assert.equal(fallback.status,'degraded');assert.deepEqual(fallback.items,items);
  const recovered=await loadCategory(async()=>({status:'ok',items:[point('Nueva')]}),items);
  assert.equal(recovered.status,'ok');assert.equal(recovered.items[0].id,'Nueva');
});
