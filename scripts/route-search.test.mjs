import test from 'node:test';
import assert from 'node:assert/strict';
import {routeGeometryIndex,mergeRoutePlaces,selectRoutePlaces,searchRoutePlaces,pagedPlaces,subdividedPlaces} from '../lib/route-search.js';
import {loadCategory} from '../client/src/lib/loading.js';
const place=(id,extra={})=>({id,name:`Torre de ${id}`,lat:36,lon:-4+Number(id)*.0001,routeProgressPct:Number(id)%100,verified:true,source:'wikipedia',...extra});
test('la variedad y proximidad no impiden alcanzar 50 lugares distintos',()=>{
  const items=Array.from({length:70},(_,i)=>place(i,{category:'historic',routeProgressPct:50}));
  assert.equal(mergeRoutePlaces(items).length,70);
  assert.equal(selectRoutePlaces(items,50).length,50);
  assert.equal(selectRoutePlaces(items,100).length,70);
  assert.equal(mergeRoutePlaces([items[0],{...items[0],source:'geoapify'}]).length,1);
});
test('muestreo por distancia independiente de la densidad de vértices y distancia al segmento',()=>{
  const coords=[...Array.from({length:100},(_,i)=>({lat:36,lon:-4+i*.00001})),{lat:36,lon:-2}];
  const index=routeGeometryIndex(coords);
  const halfway=index.pointAt(index.total/2);
  assert.ok(Math.abs(halfway.lon+3)<.01);
  assert.ok(index.centers.length>=18);
  const location=index.locate({lat:36,lon:-3});
  assert.ok(location.distanceToRouteKm<.01);
  assert.ok(Math.abs(location.routeProgressPct-50)<.1);
});
test('si la primera pasada da 11, amplía y pagina hasta el objetivo',async()=>{
  let pages=0;
  const provider={name:'test',quick:async()=>Array.from({length:11},(_,i)=>place(i)),
    async *all(){
      pages++;yield {items:Array.from({length:30},(_,i)=>place(i)),complete:false};
      pages++;yield {items:Array.from({length:30},(_,i)=>place(i+30)),complete:false};
      throw Error('No debe pedir más páginas si ya tiene el objetivo');
    }};
  const found=await searchRoutePlaces({centers:[{}],providers:[provider],target:50,prepare:mergeRoutePlaces});
  assert.equal(found.coverage.outcome,'target-reached');assert.equal(pages,2);
  assert.equal(selectRoutePlaces(found.candidates,50).length,50);
});
test('resultado escaso sólo es agotado si termina todas las fuentes y zonas sin fallos',async()=>{
  let calls=0;
  const provider={name:'test',quick:async()=>[place(1)],async *all(){calls++;yield {items:[place(2)],complete:true};}};
  const args={centers:[{},{}],providers:[provider],target:50,prepare:mergeRoutePlaces};
  const found=await searchRoutePlaces(args);
  assert.equal(found.coverage.outcome,'sources-exhausted');assert.equal(calls,2);
  const failed={name:'offline',async *all(){throw Error('timeout');}};
  const partial=await searchRoutePlaces({...args,providers:[provider,failed]});
  assert.equal(partial.coverage.outcome,'incomplete');
  assert.equal(partial.coverage.problems.length,2);
  const truncated={name:'truncated',async *all(){yield {items:[],complete:false};}};
  assert.equal((await searchRoutePlaces({...args,providers:[truncated]})).coverage.outcome,'incomplete');
});
test('paginación usa el recuento bruto y no se detiene por descartes o páginas llenas',async()=>{
  const offsets=[];const pages=[];
  for await(const page of pagedPlaces(async(offset,size)=>{
    offsets.push(offset);return {rawCount:offset<200?100:0,ids:[offset],items:offset===100?[place(1)]:[]};
  }))pages.push(page);
  assert.deepEqual(offsets,[0,100,200]);assert.equal(pages.at(-1).complete,true);
  await assert.rejects(async()=>{
    for await(const _ of pagedPlaces(async()=>({rawCount:100,ids:['same'],items:[]}))){}
  },/repitió/);
});
test('una caja saturada se subdivide; no se presenta el límite de Wikipedia como agotamiento',async()=>{
  let calls=0;const pages=[];
  for await(const page of subdividedPlaces([1,0,0,1],async()=>({items:[place(++calls)],saturated:calls===1})))pages.push(page);
  assert.equal(calls,5);assert.equal(pages[0].complete,false);assert.equal(pages.at(-1).complete,true);
});
test('la interfaz diferencia mínimo alcanzado, fuentes agotadas y fallo; conserva el avance',async()=>{
  const coverage={target:50,outcome:'incomplete'};
  const partial=await loadCategory(async()=>({status:'partial',items:[place(2)],coverage}),[place(1)]);
  assert.equal(partial.items.length,2);assert.equal(partial.status,'degraded');assert.match(partial.message,/Búsqueda incompleta/);
  const exhausted=await loadCategory(async()=>({status:'ok',source:'none',items:[],coverage:{...coverage,outcome:'sources-exhausted'}}));
  assert.equal(exhausted.status,'ok');assert.match(exhausted.message,/agotado/);assert.equal(exhausted.canRetry,true);
  const reached=await loadCategory(async()=>({status:'ok',items:Array.from({length:50},(_,i)=>place(i)),coverage:{...coverage,outcome:'target-reached'}}));
  assert.equal(reached.status,'ok');assert.match(reached.message,/Objetivo alcanzado/);
});
