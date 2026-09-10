import test from 'node:test';
import assert from 'node:assert/strict';
import {dayStops,orderDay} from '../client/src/lib/day-plan.js';
import {routeDay} from '../lib/day-routing.js';
import {buildItinerary,legKey,isLunchViable,travelPoints} from '../client/src/lib/itinerary.js';
import {get} from 'svelte/store';
import {pools,selected as selectionStore,emptySelected,emptyPools,openOptionGroup,groupOfOptionId,selectFoodFromMap} from '../client/src/lib/stores.js';
import {matchesPlace,placeContent} from '../lib/place-content.js';
import {destinationScale,topInterest,latestPopulation} from '../lib/destination-options.js';
import {applyPreferences} from '../client/src/lib/scoring.js';
import {loadCategory} from '../client/src/lib/loading.js';
import {searchTolerance,nearbyBaseRoutes} from '../lib/base-search.js';
import {routeStopTarget} from '../lib/route-search.js';
import {activeDayRoute,corridorChanged} from '../client/src/lib/active-route.js';
import {routeOptionMetrics} from '../lib/route-option-metrics.js';
const p=(name,x)=>({id:name,name,lat:36,lon:x,durationMin:10});
const origin=p('Origen',0),chosen=p('Base',2);
const selected={route:[{...p('Después',4),custom:true,routeProgressPct:100},p('Parada',1)],activities:[p('Lejos',3),p('Cerca',2.5)],lunch:null,hotel:null,dinner:null};

test('Cerámica a Castalia conserva sus 11 minutos al cruzar las 13:00, con paradas custom o propuestas',()=>{
  const ceramica={id:'ceramica',name:'Estadio de la Cerámica',lat:39.9442083,lon:-.1034046,durationMin:45};
  const castalia={id:'castalia',name:'Estadio Castalia',lat:39.9961404,lon:-.0386377,durationMin:45};
  const destination={id:'benicasim',name:'Benicàssim',lat:40.05527778,lon:.06416667};
  for(const custom of [false,true]){
    const selection={...emptySelected(),route:[{...ceramica,custom},{...castalia,custom}]};
    const points=[origin,ceramica,castalia,destination];
    const legs=[164,11,13].map(durationMin=>({durationMin,source:'osrm'}));
    const events=buildItinerary({chosen:destination,selected:selection,routeData:{coords:[origin,destination],durationMin:180},
      orderedStops:dayStops(selection,destination),departureMin:570,durationOf:x=>x.durationMin,
      legCache:new Map(legs.map((leg,i)=>[legKey(points[i],points[i+1]),leg]))}).events;
    const drive=events.filter(e=>e.kind==='travel' && e.name.includes('Castalia'));
    assert.equal(drive.length,1);assert.equal(drive[0].durationMin,11);assert.equal(drive[0].time,779);
    assert.equal(events.find(e=>e.kind==='lunch').time,790);
    assert.equal(events.filter(e=>e.kind==='travel').reduce((n,e)=>n+e.durationMin,0),188);
    assert.equal(events.find(e=>e.item?.id===castalia.id).time,875);
  }
});

test('un viaje largo iniciado en la ventana de comida se hace entero después de comer',()=>{
  const result=buildItinerary({chosen,selected:emptySelected(),routeData:{coords:[origin,chosen],durationMin:180},
    departureMin:779,durationOf:()=>45,legCache:new Map([[legKey(origin,chosen),{durationMin:180,source:'osrm'}]])});
  const travels=result.events.filter(e=>e.kind==='travel');
  assert.equal(travels.length,1);assert.equal(travels[0].durationMin,180);assert.equal(travels[0].time,864);
  assert.equal(result.events.find(e=>e.kind==='lunch').time,779);
});

test('el corredor sigue la geometría completa; detecta cambios de ida y vuelta sin reaccionar a cambios pequeños',()=>{
  const straight={coords:[origin,chosen],roadKm:200};
  const far={...p('Lejos',1),lat:38};
  const day={source:'osrm',segments:[[origin,far],[far,chosen]],roadKm:300,durationMin:200};
  const active=activeDayRoute(day,origin,chosen,{...emptySelected(),route:[{...far,custom:true}]});
  assert.deepEqual(active.coords,[origin,far,chosen]);
  assert.equal(active.plan.chosen.id,chosen.id);
  assert.equal(active.roadKm,300);
  assert.equal(corridorChanged(straight,active),true);
  assert.equal(corridorChanged(active,straight),true);
  assert.equal(corridorChanged(straight,{coords:[origin,{...p('Pequeño',1),lat:36.001},chosen],roadKm:200.1}),false);
  assert.equal(corridorChanged(straight,{coords:straight.coords,roadKm:220}),true);
  assert.equal(activeDayRoute({...day,source:'estimated'},origin,chosen,emptySelected()),null);
});

test('métricas comparan el viaje completo conservando visitas obligatorias y sentidos de circulación',async()=>{
  const mandatory=p('Obligatoria',3),candidate=p('Nueva',1);
  // 0 -> 3 -> 2 costs 20 min. Visiting 1 preserves 3 and adds 3 min.
  // Comparing only 0 -> 1 -> 2 would falsely report zero extra time.
  const costs=[[0,5,5,10],[5,0,5,8],[5,5,0,5],[10,8,10,0]];
  const request=async url=>{
    const u=new URL(url),coords=u.pathname.split('/').at(-1).split(';').map(s=>Number(s.split(',')[0]));
    const src=u.searchParams.get('sources').split(';').map(Number),dst=u.searchParams.get('destinations').split(';').map(Number);
    const matrix=src.map(i=>dst.map(j=>costs[coords[i]][coords[j]]));
    return {durations:matrix.map(row=>row.map(x=>x*60)),distances:matrix.map(row=>row.map(x=>x*1000))};
  };
  for(const custom of [false,true]) {
    const route={coords:[origin,mandatory,chosen],roadKm:20,durationMin:20,
      plan:{origin,chosen,selected:{...emptySelected(),route:[{...mandatory,custom}]}}};
    const result=await routeOptionMetrics({route,items:[candidate,mandatory]},request,'https://osrm.test');
    assert.equal(result.source,'osrm');
    assert.equal(result.items[0].extraMin,3);
    assert.equal(result.items[0].extraKm,3);
    assert.equal(result.items[1].extraMin,0);
  }
});

test('carretera global usa sólo origen, visitas y destino, sin puntos de retorno a la ruta inicial',async()=>{
  const visits=[p('B',3),p('A',1)];
  for(const custom of [false,true]) {
    const requests=[];
    const result=await routeDay({origin,chosen,selected:{...emptySelected(),route:visits.map(x=>({...x,custom}))}},async url=>{
      const u=new URL(url),points=u.pathname.split('/').at(-1).split(';').map(x=>x.split(',').map(Number));
      if(url.includes('/table/')){
        const src=u.searchParams.get('sources').split(';').map(Number),dst=u.searchParams.get('destinations').split(';').map(Number);
        return {durations:src.map(i=>dst.map(j=>Math.abs(points[i][0]-points[j][0])*60))};
      }
      requests.push(points);
      return {routes:[{legs:points.slice(1).map(()=>({duration:60,distance:1000})),geometry:{coordinates:points}}]};
    },'https://osrm.test');
    assert.deepEqual(result.stops.map(s=>s.item.id),['A','B','Base']);
    assert.deepEqual(requests[0].map(p=>p[0]),[0,1,3,2]);
  }
});

test('la ordenación global coincide con todas las permutaciones de visitas en costes dirigidos',()=>{
  const visits=Array.from({length:5},(_,i)=>p(String(i+1),i+1));
  const destination=p('Final',6);
  const permutations=items=>items.length?items.flatMap((x,i)=>permutations(items.filter((_,j)=>j!==i)).map(t=>[x,...t])):[[]];
  let seed=731;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return 1+seed%100;};
  for(let run=0;run<12;run++){
    const matrix=Array.from({length:7},(_,i)=>Array.from({length:7},(_,j)=>i===j?0:random()));
    // Shortest road costs obey the triangle inequality, including one-way roads.
    for(let k=0;k<7;k++)for(let i=0;i<7;i++)for(let j=0;j<7;j++)matrix[i][j]=Math.min(matrix[i][j],matrix[i][k]+matrix[k][j]);
    const cost=order=>[...order,6].reduce((sum,id,i,ids)=>sum+matrix[i?ids[i-1]:0][id],0);
    const expected=Math.min(...permutations([1,2,3,4,5]).map(cost));
    const ordered=orderDay(dayStops({...emptySelected(),route:visits},destination),origin,matrix);
    assert.equal(cost(ordered.slice(0,-1).map(s=>Number(s.item.id))),expected);
  }
});

test('una propuesta de ruta se intercala con actividades igual que una personalizada',()=>{
  const near=p('Actividad cercana',1),far=p('Visita lejana',4);
  for(const custom of [false,true]){
    const stops=orderDay(dayStops({...emptySelected(),route:[{...far,custom}],activities:[near]},chosen),origin);
    assert.deepEqual(stops.map(s=>s.item.id),[near.id,far.id]);
  }
});

test('el horario de apertura nunca invalida una comida; sólo genera aviso',()=>{
  const lunch={...p('Restaurante',.01),lunchPhase:'destination',lunchOpening:false,openingHours:'18:00-23:00'};
  const args={chosen,routeData:{coords:[origin,chosen],durationMin:10},selected:emptySelected(),departureMin:570,durationOf:x=>x.durationMin};
  assert.equal(isLunchViable({...args,item:lunch}),true);
  const result=buildItinerary({...args,selected:{...args.selected,lunch}});
  assert.ok(result.events.some(e=>e.item?.id===lunch.id));
  assert.ok(result.warnings.some(w=>w.includes('horario informado')));
});

test('tolerancia desde el destino, sin rango ideal desde el origen ni redondeo permisivo',async()=>{
  const target={id:'target'},origin={id:'origin'};
  const candidates=[{id:'cercana',distance:12,trip:900},{id:'fuera',distance:40.01,trip:200},{id:'borde',distance:40,trip:15}];
  const result=await nearbyBaseRoutes(origin,target,candidates,40,async(from,list)=>list.map(x=>({...x,roadKm:from===target?x.distance:x.trip,durationMin:10})));
  assert.deepEqual(result.map(x=>x.id),['cercana','borde']);
  assert.equal(result[0].roadKm,900);assert.equal(result[0].distanceToTargetKm,12);
});

test('tolerancia cero, validación y lotes no truncados',async()=>{
  assert.equal(searchTolerance(0),0);assert.equal(searchTolerance(),40);
  for(const value of [-1,301,NaN,Infinity,'abc',null])assert.throws(()=>searchTolerance(value));
  const candidates=Array.from({length:45},(_,id)=>({id,roadKm:0,durationMin:0}));
  const calls=[];
  const result=await nearbyBaseRoutes({}, {}, candidates,0,async(_,items)=>{calls.push(items.length);return items;});
  assert.equal(result.length,45);assert.ok(calls.every(n=>n<=20));
  assert.equal(routeStopTarget(200),50);assert.equal(routeStopTarget(10),3);assert.equal(routeStopTarget(0),0);
});

test('check-in temprano permitido; check-in largo se retrasa y no elimina comidas viables',()=>{
  const hotel={...p('Hotel',.01),durationMin:10},activity=p('Paseo',.02),lunch={...p('Comer',.005),lunchPhase:'destination'};
  const args={originName:'Origen',chosen,routeData:{coords:[origin,chosen],durationMin:10},selected:{...emptySelected(),hotel,activities:[activity]},departureMin:570,durationOf:x=>x.durationMin};
  let events=buildItinerary(args).events;
  assert.ok(events.find(e=>e.kind==='hotel').time<events.find(e=>e.kind==='lunch').time);
  hotel.durationMin=180;args.departureMin=750;
  events=buildItinerary(args).events;
  assert.ok(events.find(e=>e.kind==='hotel').time>events.find(e=>e.kind==='lunch').time);
  hotel.durationMin=600;args.departureMin=800;
  assert.equal(isLunchViable({...args,item:lunch}),true);
  const withLunch={...args,selected:{...args.selected,lunch}};
  events=buildItinerary(withLunch).events;
  assert.ok(events.find(e=>e.kind==='lunch').time<=870);
  assert.ok(events.find(e=>e.kind==='hotel').time>events.find(e=>e.kind==='lunch').time);
});

test('después de cenar se vuelve al hotel por carretera sin repetir check-in',()=>{
  const hotel=p('Hotel',.01),dinner=p('Cena',.02);
  const args={chosen,routeData:{coords:[origin,chosen],durationMin:10},selected:{...emptySelected(),hotel,dinner},departureMin:570,durationOf:x=>x.durationMin};
  const points=travelPoints(args);
  assert.equal(points.at(-1).id,hotel.id);
  args.legCache=new Map(points.slice(1).map((x,i)=>[legKey(points[i],x),{durationMin:7,source:'osrm'}]));
  const result=buildItinerary(args);
  assert.equal(result.events.at(-1).kind,'hotelReturn');
  assert.equal(result.events.at(-1).mins,0);
  assert.equal(result.events.at(-2).durationMin,7);
  assert.equal(result.events.filter(e=>e.kind==='hotel').length,1);
  assert.equal(orderDay(dayStops({...emptySelected(),hotel},chosen),origin).length,1);
});

test('restaurante del mapa se asigna a la sección abierta, aunque ya sea la otra comida',()=>{
  const item=p('Restaurante',.01);
  pools.set({...emptyPools(),food:[item]});selectionStore.set({...emptySelected(),dinner:item});
  openOptionGroup.set('lunch');
  assert.equal(groupOfOptionId(item.id),'lunch');selectFoodFromMap(item.id);
  assert.equal(get(selectionStore).lunch.id,item.id);
  assert.equal(get(selectionStore).lunch.lunchPhase,'destination');
  openOptionGroup.set('dinner');
  assert.equal(groupOfOptionId(item.id),'dinner');selectFoodFromMap(item.id);
  assert.equal(get(selectionStore).dinner.id,item.id);
  assert.equal(get(openOptionGroup),'dinner');
  pools.set(emptyPools());selectionStore.set(emptySelected());openOptionGroup.set(null);
});

test('la base sólo permanece si es la última parada real',()=>{
  const empty={route:[],activities:[],lunch:null,hotel:null,dinner:null};
  assert.deepEqual(orderDay(dayStops(empty,chosen),origin).map(s=>s.kind),['base']);
  for(const extra of [{activities:[p('Museo',3)]},{hotel:p('Hotel',3)},{dinner:p('Cena',3)},
    {lunch:{...p('Comida',3),lunchPhase:'destination'}}]) {
    const stops=orderDay(dayStops({...empty,...extra},chosen),origin);
    assert.ok(stops.length>0);
    assert.ok(stops.every(s=>s.kind!=='base'));
  }
  assert.deepEqual(orderDay(dayStops({...empty,route:[p('Parada',1)]},chosen),origin).map(s=>s.kind),['route','base']);
});

test('una parada personalizada no sustituye la llegada a la localidad elegida',()=>{
  for(const lon of [1, 2, 4, -1]) {
    const custom={...p('Manual',lon),custom:true};
    const selection={...emptySelected(),route:[custom]};
    const stops=orderDay(dayStops(selection,chosen),origin);
    assert.deepEqual(stops.map(s=>s.kind),['route','base']);
    assert.equal(stops.at(-1).item.id,chosen.id);
    const points=travelPoints({chosen,selected:selection,routeData:{coords:[origin,chosen]}});
    assert.equal(points.at(-1).id,chosen.id);
  }
});

test('el centro intermedio no influye en el coste ni aparece en la petición de ruta',async()=>{
  const farBase=p('Centro sin utilidad',-20),near=p('Visita cercana',1),far=p('Visita lejana',3);
  const requests=[];
  const result=await routeDay({origin,chosen:farBase,selected:{route:[],activities:[far,near],lunch:null,hotel:null,dinner:null}},async url=>{
    if(url.includes('/table/'))throw Error('Usar costes geográficos');
    requests.push(url);
    return {routes:[{legs:[{duration:60,distance:1000},{duration:120,distance:2000}],geometry:{coordinates:[[0,36],[1,36],[3,36]]}}]};
  },'https://osrm.test');
  assert.deepEqual(result.stops.map(s=>s.item.name),[near.name,far.name]);
  assert.ok(!requests[0].includes('-20,36'));
  assert.equal(result.durationMin,3);
});

test('la oferta crece con población en actividades, comida y alojamiento',()=>{
  const profiles=[800,8000,40000,200000,700000,3000000].map(population=>destinationScale({population}));
  for(let i=1;i<profiles.length;i++) for(const kind of ['activities','food','lodging']) assert.ok(profiles[i].targets[kind]>profiles[i-1].targets[kind]);
  assert.equal(destinationScale({type:'city'}).estimated,true);
  assert.ok(destinationScale({type:'city'}).targets.activities>destinationScale({type:'village'}).targets.activities);
});

test('recorte conserva interés máximo y preferencias no ordenan por desvío',()=>{
  const items=Array.from({length:100},(_,i)=>({...p(`Lugar ${i}`,i),interestScore:i,stageValue:100-i}));
  assert.deepEqual(topInterest(items,3).map(x=>x.interestScore),[99,98,97]);
  const result=applyPreferences({route:items},[]).route;
  assert.equal(result[0].interestScore,99);
  assert.ok(Math.min(...topInterest(items,20).map(x=>x.interestScore))>=Math.max(...items.filter(x=>!topInterest(items,20).includes(x)).map(x=>x.interestScore)));
});

test('applyPreferences ordena por la nota de la IA cuando existe, sin ocultar lo que no puntúa',()=>{
  const items=[
    {...p('Bajo interés propio',10),interestScore:20,aiInterest:95},   // la IA la sube a lo más alto
    {...p('Alto interés propio',20),interestScore:90},                  // sin nota de IA: se ordena por interestScore
    {...p('Medio con IA',30),interestScore:50,aiInterest:60}
  ];
  const order=applyPreferences({route:items},[]).route.map(x=>x.name);
  assert.deepEqual(order,['Bajo interés propio','Alto interés propio','Medio con IA']);
});

test('población usa observación reciente aunque antes fuera mayor',()=>{
  const claim=(amount,time)=>({mainsnak:{datavalue:{value:{amount}}},qualifiers:{P585:[{datavalue:{value:{time}}}]}});
  assert.equal(latestPopulation([claim('+5000','+2000'),claim('+3000','+2024')]),3000);
});

test('ordenación obedece costes dirigidos de carretera, no la proximidad',()=>{
  const stops=dayStops({route:[],activities:[p('A',2.1),p('B',2.2)],lunch:null,hotel:null,dinner:null},chosen);
  const matrix=[[0,1,50,50],[1,0,20,1],[50,20,0,30],[50,1,1,0]];
  assert.deepEqual(orderDay(stops,origin,matrix).map(s=>s.item.name),['B','A']);
});

const MEALS={lunch:{target:840,limit:900},dinner:{target:1200,limit:1260}};

test('con opts, orderDay reordena la ruta para colgar la comida antes de las 15:00',()=>{
  const O={id:'O',name:'O',lat:36,lon:0};
  const r1={id:'r1',name:'r1',lat:36,lon:1,routeProgressPct:20};
  const lu={id:'lu',name:'lu',lat:36,lon:1.5,routeProgressPct:30,lunchPhase:'route'};
  const r2={id:'r2',name:'r2',lat:36,lon:2,routeProgressPct:40};
  const B={id:'B',name:'B',lat:36,lon:5};
  const stops=dayStops({...emptySelected(),route:[r1,r2],lunch:lu},B); // [r1, lu, r2, base] por progreso
  // Matriz en segundos, orden de índices [O, r1, lu, r2, B].
  const S=[
    [   0, 600, 900,1200,3000],
    [ 600,   0, 300, 600,2400],
    [ 900, 300,   0, 300,2100],
    [1200, 600, 300,   0,1800],
    [3000,2400,2100,1800,   0]
  ];
  // r1 dura 320 min: en el orden de mínima conducción la comida caería > 15:00.
  const opts={departureMin:570,durationOf:x=>({r1:320,lu:60,r2:30}[x.id]??0),meals:MEALS};
  assert.deepEqual(orderDay(stops,O,S).map(s=>s.item.id),['r1','lu','r2','B']);      // sin opts: mínima conducción
  assert.deepEqual(orderDay(stops,O,S,opts).map(s=>s.item.id),['lu','r1','r2','B']); // con opts: comida adelantada
});

test('con opts pero sin comida ni cena, orderDay ordena igual que sin opts',()=>{
  const stops=dayStops({route:[],activities:[p('A',2.1),p('B',2.2)],lunch:null,hotel:null,dinner:null},chosen);
  const matrix=[[0,1,50,50],[1,0,20,1],[50,20,0,30],[50,1,1,0]];
  const opts={departureMin:570,durationOf:x=>x.durationMin,meals:MEALS};
  assert.deepEqual(orderDay(stops,origin,matrix,opts).map(s=>s.item.name),
                   orderDay(stops,origin,matrix).map(s=>s.item.name));
});

test('routeDay sólo activa la ordenación por hora cuando hay restaurante elegido',async()=>{
  const req=async url=>{
    const u=new URL(url),pts=u.pathname.split('/').at(-1).split(';').map(x=>Number(x.split(',')[0]));
    if(u.pathname.includes('/table/')){
      const a=u.searchParams.get('sources').split(';').map(Number),b=u.searchParams.get('destinations').split(';').map(Number);
      return {durations:a.map(i=>b.map(j=>Math.abs(pts[i]-pts[j])*600))};
    }
    return {routes:[{legs:pts.slice(1).map((x,i)=>({duration:Math.abs(x-pts[i])*600,distance:1000})),geometry:{coordinates:pts.map(x=>[x,36])}}]};
  };
  const base={...emptySelected(),route:[p('R',1)],activities:[p('Act',3)]};
  const noMeal=await routeDay({origin,chosen,selected:base},req,'https://osrm.test');
  const noMealDep=await routeDay({origin,chosen,selected:base,departureMin:570,durations:{}},req,'https://osrm.test');
  // Sin comida/cena, la hora de salida no cambia el orden.
  assert.deepEqual(noMeal.stops.map(s=>s.item.id),noMealDep.stops.map(s=>s.item.id));
});

test('una comida elegida puede caer antes de las 12:30 (sin suelo) y una cena antes de las 19:00',()=>{
  const near={id:'b',name:'Base',lat:36,lon:.01};
  const lunch={id:'r',name:'Rest',lat:36,lon:.02,lunchPhase:'destination'};
  const rLunch=buildItinerary({chosen:near,routeData:{coords:[origin,near],durationMin:10},
    selected:{...emptySelected(),lunch},departureMin:570,durationOf:()=>15});
  assert.ok(rLunch.events.find(e=>e.kind==='lunch').time<750);
  assert.ok(!rLunch.warnings.some(w=>w.includes('15:00')));

  const dinner={id:'d',name:'Cena',lat:36,lon:.02};
  const rDinner=buildItinerary({chosen:near,routeData:{coords:[origin,near],durationMin:10},
    selected:{...emptySelected(),dinner},departureMin:600,durationOf:()=>15});
  assert.ok(rDinner.events.find(e=>e.kind==='dinner').time<1140);
});

test('aviso cuando ni reordenando cabe la comida antes de las 15:00 o la cena antes de las 21:00',()=>{
  const near={id:'b',name:'Base',lat:36,lon:.01};
  const lunch={id:'r',name:'Rest',lat:36,lon:.02,lunchPhase:'destination'};
  const rLunch=buildItinerary({chosen:near,routeData:{coords:[origin,near],durationMin:10},
    selected:{...emptySelected(),lunch},departureMin:920,durationOf:()=>20});
  assert.ok(rLunch.events.find(e=>e.kind==='lunch').time>900);
  assert.ok(rLunch.warnings.some(w=>w.includes('15:00')));

  const dinner={id:'d',name:'Cena',lat:36,lon:.02};
  const rDinner=buildItinerary({chosen:near,routeData:{coords:[origin,near],durationMin:10},
    selected:{...emptySelected(),dinner},departureMin:1280,durationOf:()=>15});
  assert.ok(rDinner.warnings.some(w=>w.includes('21:00')));
});

test('reintento parcial incorpora mejores opciones y elimina sólo las de menor interés',async()=>{
  const result=await loadCategory(async()=>({status:'partial',source:'wikipedia',items:[{id:'nuevo',interestScore:90}],selection:{target:1,available:2,complete:false}}),[{id:'anterior',interestScore:20}]);
  assert.equal(result.items[0].id,'nuevo');assert.equal(result.items.length,1);assert.equal(result.status,'degraded');
});

test('manual después de las actividades, visitas eficientes y carretera en horario',async()=>{
  const request=async(url)=>{
    const u=new URL(url),points=u.pathname.split('/').at(-1).split(';').map(x=>Number(x.split(',')[0]));
    if(u.pathname.includes('/table/')) {
      const a=u.searchParams.get('sources').split(';').map(Number),b=u.searchParams.get('destinations').split(';').map(Number);
      return {durations:a.map(i=>b.map(j=>Math.abs(points[i]-points[j])*600))};
    }
    return {routes:[{legs:points.slice(1).map((x,i)=>({duration:Math.abs(x-points[i])*600,distance:1000})),geometry:{coordinates:points.map(x=>[x,36])}}]};
  };
  const result=await routeDay({origin,chosen,selected},request,'https://osrm.test');
  assert.deepEqual(result.stops.map(s=>s.item.name),['Parada','Cerca','Lejos','Después']);
  assert.equal(result.legs.length,4);
  assert.equal(result.source,'osrm');
  const points=[origin,...result.stops.map(s=>s.item)];
  const legCache=new Map(result.legs.map((l,i)=>[legKey(points[i],points[i+1]),l]));
  const itin=buildItinerary({chosen,selected,routeData:{coords:[origin,chosen],durationMin:20},orderedStops:result.stops,legCache,departureMin:570,durationOf:x=>x.durationMin});
  assert.deepEqual(itin.events.filter(e=>e.item).map(e=>e.item.name),result.stops.map(s=>s.item.name));
  assert.equal(itin.events.filter(e=>e.kind==='travel').reduce((n,e)=>n+e.durationMin,0),40);
});

test('las comidas y check-in conservan su orden, sin visitas tras la cena',()=>{
  const sel={...selected,lunch:{...p('Comer',2),lunchPhase:'destination'},hotel:p('Hotel',2.1),dinner:p('Cenar',2)};
  const stops=orderDay(dayStops(sel,chosen),origin);
  assert.deepEqual(stops.filter(s=>!['activity','route'].includes(s.kind)).map(s=>s.kind),['lunch','hotel','dinner','hotelReturn']);
  assert.equal(stops.at(-1).kind,'hotelReturn');
});

test('fallo de carreteras conserva todas las visitas y no inventa geometría',async()=>{
  const result=await routeDay({origin,chosen,selected},async()=>{throw Error('offline');},'https://osrm.test');
  assert.equal(result.stops.length,4);
  assert.equal(result.legs.length,4);
  assert.deepEqual(result.segments,[]);
  assert.equal(result.source,'estimated');
  assert.equal(result.optimizationSource,'estimated');
});

test('más de 20 puntos conservan tramos entre lotes',async()=>{
  let calls=0;
  const result=await routeDay({origin,chosen,selected:{...selected,route:[],activities:Array.from({length:24},(_,i)=>p(`Visita ${i}`,2+i*.001))}},async url=>{
    if(url.includes('/table/')) throw Error('sin matriz');
    calls++;
    const points=new URL(url).pathname.split('/').at(-1).split(';');
    return {routes:[{legs:points.slice(1).map(()=>({duration:60,distance:100})),geometry:{coordinates:points.map(x=>x.split(',').map(Number))}}]};
  },'https://osrm.test');
  assert.equal(calls,2);assert.equal(result.legs.length,24);assert.equal(result.segments.length,2);
});

test('enriquecimiento rechaza homónimos lejanos y lugares cercanos distintos',()=>{
  const item=p('Castillo de San Miguel',-3);
  assert.ok(matchesPlace(item,{title:item.name,coordinates:[{lat:36,lon:-3.001}]}));
  assert.ok(!matchesPlace(item,{title:item.name,coordinates:[{lat:40,lon:-3}]}));
  assert.ok(!matchesPlace(item,{title:'Museo de la ciudad',coordinates:[item]}));
});

test('contenido conserva procedencia y licencia, sin HTML de la fuente',async()=>{
  const result=await placeContent({...p('Castillo',-3),wikipediaTag:'es:Castillo'},async url=>{
    if(url.hostname==='es.wikipedia.org') return {query:{pages:[{title:'Castillo',extract:'Historia del castillo.',fullurl:'https://es.wikipedia.org/wiki/Castillo',pageimage:'Castillo.jpg'}]}};
    return {query:{pages:[{title:'File:Castillo.jpg',imageinfo:[{thumburl:'https://upload.wikimedia.org/test.jpg',descriptionurl:'https://commons.wikimedia.org/wiki/File:Castillo.jpg',extmetadata:{Artist:{value:'<a>Autor</a>'},LicenseShortName:{value:'CC BY-SA 4.0'}}}]}]}};
  });
  assert.equal(result.images[0].author,'Autor');assert.equal(result.images[0].license,'CC BY-SA 4.0');assert.equal(result.descriptionSource,'Wikipedia (es)');
});
