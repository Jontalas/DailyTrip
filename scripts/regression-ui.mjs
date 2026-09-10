// Flujo reproducible sin servicios externos: sirve el build y simula la API.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {dayStops,orderDay} from '../client/src/lib/day-plan.js';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=path.resolve('public');
const server=createServer(async(req,res)=>{
  const file=path.resolve(root,'.'+(req.url==='/'?'/index.html':req.url));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{
    const body=await readFile(file);
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
    res.end(body);
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const origin={name:'Málaga',lat:36.72,lon:-4.42};
  const destination={id:'base',name:'Almería',lat:36.84,lon:-2.46,roadKm:200,durationMin:120,baseInterest:90};
  const route={coords:[origin,destination],roadKm:200,durationMin:120};
  const option=(id,i=0)=>({id,name:id,lat:36.75+i*.001,lon:-4+i*.025,routeProgressPct:10+i,durationMin:10,source:'wikipedia',verified:true,category:'museum',interestScore:70});
  const stops=Array.from({length:50},(_,i)=>option(`Parada ${i+1}`,i));
  let activityCalls=0, routeCalls=0, metricsCalls=0;
  const metricSizes=[];
  const corridorRequests=[],lunchCorridorRequests=[];
  let holdCorridor=false,releaseCorridor,startedCorridor;
  await page.route('**/*',async r=>{
    const url=new URL(r.request().url());
    if(url.origin!==base){await r.fulfill({status:204});return;}
    if(!url.pathname.startsWith('/api/')) {await r.continue();return;}
    const body=r.request().postDataJSON() || {};
    let result;
    switch(url.pathname){
      case '/api/place/content':result={contentStatus:'limited'};break;
      case '/api/plan/day': {
        const sequence=orderDay(dayStops(body.selected,body.chosen),body.origin);
        result={source:'osrm',optimizationSource:'osrm',stops:sequence,legs:sequence.map(()=>({durationMin:30,distanceKm:5,source:'osrm'})),segments:[[body.origin,...sequence.map(s=>s.item)]],roadKm:body.selected.route.some(x=>x.name==='Desvío global')?280:200,durationMin:sequence.length*30};break;
      }
      case '/api/geocode':assert.equal(body.place,true);result={name:body.q,lat:body.q==='Desvío global'?38:36.846,lon:body.q==='Desvío global'?-3:-2.457};break;
      case '/api/providers':result={};break;
      case '/api/search/context':result={origin,target:destination,toleranceKm:40,referenceRoute:route};break;
      case '/api/search/candidates':assert.equal(body.target.name,destination.name);assert.equal(body.desiredKm,undefined);assert.equal(body.anchors,undefined);result={results:[{...destination,distanceToTargetKm:0}]};break;
      case '/api/plan/route':result={route};break;
      case '/api/options/route':
        routeCalls++;corridorRequests.push(body.route);
        if(holdCorridor && body.route.coords.some(p=>p.lat===38))await new Promise(resolve=>{releaseCorridor=resolve;startedCorridor();});
        result={status:'ok',source:'wikipedia',items:body.route.coords.some(p=>p.lat===38)?[{...option('Parada del nuevo trayecto'),lat:38,lon:-3.01}]:stops};break;
      case '/api/metrics/route-options':
        metricsCalls++;metricSizes.push(body.items.length);
        if(metricsCalls===2){await r.fulfill({status:503,json:{error:'Fallo simulado'}});return;}
        result={source:'osrm',items:body.items.map(x=>({...x,extraMin:5,extraKm:2}))};break;
      case '/api/options/route-lunch':lunchCorridorRequests.push(body.route);result={status:'ok',items:[]};break;
      case '/api/options/activities':
        activityCalls++;
        if(activityCalls===1){await r.fulfill({status:503,json:{error:'Fallo simulado'}});return;}
        result={status:'ok',items:[{...option('Museo'),lat:36.841,lon:-2.461}]};break;
      case '/api/options/services':result={status:'ok',food:[{...option('Restaurante'),lat:36.842,lon:-2.462,lunchOpening:false,openingHours:'18:00-23:00'},{...option('Restaurante lejano'),lat:43,lon:-2.462,lunchOpening:null}],lodging:[{...option('Hotel'),lat:36.843,lon:-2.463}],sources:{food:'geoapify',lodging:'geoapify'}};break;
      case '/api/travel/sequence':result={source:'osrm',legs:body.points.slice(1).map(()=>({durationMin:30}))};break;
      case '/api/plan/route-via':result={source:'osrm',coords:[body.origin,...body.vias,body.destination]};break;
      case '/api/metrics/route-detour':result={source:'osrm',coords:[body.origin,body.stop,body.destination]};break;
      default:throw Error('API inesperada '+url.pathname);
    }
    await r.fulfill({json:result});
  });
  await page.goto(base);
  assert.equal(await page.locator('#f-km').count(),0);
  await page.getByRole('button',{name:'Buscar finales de etapa'}).click();
  await page.getByRole('button',{name:'Elegir esta base'}).click();
  await page.getByRole('button',{name:'Cargar opciones del día'}).click();
  await page.locator('.groups').waitFor();
  const routeGroup=page.locator('.group').nth(0);
  await routeGroup.locator('summary').click();
  await page.waitForFunction(()=>document.querySelectorAll('.group[data-category="route"] .row').length===50);
  assert.equal(await routeGroup.locator('.row').count(),50);
  assert.deepEqual(metricSizes.slice(0,3),[20,20,10]);
  const customOnly=page.locator('.custom-section');
  // La sección de paradas personalizadas es un acordeón como el resto: arranca
  // colapsada y se cierra al abrir otra. Hay que desplegarla antes de usarla.
  const openCustom=async()=>{if((await customOnly.getAttribute('open'))===null)await customOnly.locator('summary').click();};
  await openCustom();
  assert.equal(await customOnly.locator('summary').count(),1,'la sección personalizada es colapsable');
  await customOnly.getByRole('textbox').fill('Visita sin cambiar destino');
  await customOnly.getByRole('button',{name:'Añadir',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.timeline')?.textContent.includes('Visita sin cambiar destino') && document.querySelector('.route-summary')?.textContent.includes('de conducción'));
  assert.ok((await page.locator('.timeline .row').allTextContents()).some(t=>t.includes('Llegada') && t.includes('Almería')));
  assert.equal(await page.locator('.map-pin--base').count(),1);
  await page.locator('.dep input').fill('12:59');
  await page.waitForFunction(()=>document.querySelector('.timeline .row--travel .left')?.textContent==='30 min');
  assert.ok(!(await page.locator('.timeline .row--travel .left').allTextContents()).includes('1 min'));
  await page.locator('.dep input').fill('09:30');
  await customOnly.getByRole('button',{name:'Quitar Visita sin cambiar destino del itinerario',exact:true}).click();
  await routeGroup.locator('summary').click();
  await routeGroup.locator('.row .face').first().click();
  await routeGroup.getByRole('button',{name:'Reintentar',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.group[data-category="route"] .load-state'));
  assert.equal(await routeGroup.locator('.row').count(),50);
  assert.equal(await routeGroup.locator('.row.is-selected').count(),1);
  const activityGroup=page.locator('.group').nth(2);
  await activityGroup.locator('summary').click();
  assert.match(await activityGroup.innerText(),/No se pudo consultar/);
  assert.equal(await activityGroup.locator('.empty').count(),0);
  await activityGroup.getByRole('button',{name:'Reintentar',exact:true}).click();
  await activityGroup.locator('.row').waitFor();
  assert.equal(routeCalls,2,'reintentar actividades no recarga paradas');
  await activityGroup.locator('.face').click();
  await activityGroup.locator('.duration input').fill('15');
  await page.waitForFunction(()=>[...document.querySelectorAll('.timeline .row')].some(e=>e.textContent.includes('Museo')&&e.textContent.includes('15 min')));
  assert.equal(await routeGroup.locator('.row.is-selected').count(),1);
  assert.equal(await activityGroup.locator('.row.is-selected').count(),1);
  await page.waitForFunction(()=>document.querySelector('.route-line') && document.querySelector('.route-summary')?.textContent.includes('de conducción'));
  assert.ok((await page.locator('.map-opt.is-selected .chip').allTextContents()).includes('Parada 1'));
  assert.ok((await page.locator('.map-opt.is-selected .chip').allTextContents()).includes('Museo'));
  assert.equal(await page.locator('.map-pin--base').count(),0,'El centro no debe figurar como parada intermedia');
  assert.ok(!(await page.locator('.timeline').innerText()).includes('Llegada'));
  await page.screenshot({path:'data/ui-day-desktop.png'});
  const dinnerGroup=page.locator('.group').nth(3),lunchGroup=page.locator('.group').nth(1),hotelGroup=page.locator('.group').nth(4);
  await dinnerGroup.locator('summary').click();
  await page.locator('.leaflet-marker-icon[title="Restaurante"]').dispatchEvent('click');
  assert.equal(await dinnerGroup.locator('.row.is-selected').count(),1);
  await lunchGroup.locator('summary').click();
  assert.equal(await lunchGroup.locator('.row').count(),2);
  assert.equal((await lunchGroup.locator('.g-count').innerText()).trim(),'2');
  assert.ok((await lunchGroup.innerText()).includes('podría estar cerrado'));
  assert.ok(!(await lunchGroup.innerText()).includes('no llegan a tiempo'));
  await page.locator('.leaflet-marker-icon[title="Restaurante"]').dispatchEvent('click');
  assert.equal(await lunchGroup.locator('.row.is-selected').count(),1);
  assert.equal(await lunchGroup.getAttribute('open'),'');
  assert.equal(await dinnerGroup.getAttribute('open'),null);
  await hotelGroup.locator('summary').click();
  await hotelGroup.locator('.face').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.timeline .row')].at(-1)?.textContent.includes('Llegada al alojamiento'));
  const customSection=page.locator('.custom-section');
  assert.equal(await page.locator('.group .custom-add').count(),0);
  assert.ok(await page.evaluate(()=>{
    const custom=document.querySelector('.custom-section');
    return !!(document.querySelector('.prefs').compareDocumentPosition(custom)&Node.DOCUMENT_POSITION_FOLLOWING) && !!(custom.compareDocumentPosition(document.querySelector('.group'))&Node.DOCUMENT_POSITION_FOLLOWING);
  }));
  await openCustom();
  await customSection.getByRole('textbox').fill('Mi visita personalizada');
  await customSection.getByRole('button',{name:'Añadir',exact:true}).click();
  await customSection.locator('.row.is-selected').waitFor();
  assert.equal(await routeGroup.locator('.row').count(),50);
  await page.waitForFunction(()=>document.querySelector('.timeline')?.textContent.includes('Mi visita personalizada'));
  await page.screenshot({path:'data/ui-custom-section.png'});
  const beforeRefresh=routeCalls;
  await customSection.getByRole('textbox').fill('Desvío global');
  await customSection.getByRole('button',{name:'Añadir',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.group')?.textContent.includes('Parada del nuevo trayecto'));
  assert.equal(routeCalls,beforeRefresh+1);
  assert.ok(corridorRequests.at(-1).coords.some(p=>p.lat===38));
  assert.ok(lunchCorridorRequests.at(-1).coords.some(p=>p.lat===38));
  assert.equal(corridorRequests.at(-1).roadKm,280);
  assert.equal(corridorRequests.at(-1).plan.chosen.name,'Almería');
  assert.equal(await routeGroup.locator('.row.is-selected').count(),1,'conserva la parada elegida aunque no la devuelva el nuevo corredor');
  assert.equal(await routeGroup.locator('.row').count(),2,'retira las propuestas de la carretera antigua');
  assert.ok((await page.locator('.trip-bar').innerText()).includes('280 km'));
  assert.ok((await page.locator('.timeline').innerText()).includes('Desvío global'));
  await customSection.getByRole('button',{name:'Quitar Desvío global del itinerario',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.group[data-category="route"] .row').length===50);
  assert.equal(routeCalls,beforeRefresh+2,'quitar la visita recupera propuestas del recorrido anterior');
  holdCorridor=true;
  const pendingCorridor=new Promise(resolve=>startedCorridor=resolve);
  await customSection.getByRole('textbox').fill('Desvío global');
  await customSection.getByRole('button',{name:'Añadir',exact:true}).click();
  await pendingCorridor;
  await customSection.getByRole('button',{name:'Quitar Desvío global del itinerario',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.group[data-category="route"] .row').length===50);
  const staleResponse=page.waitForResponse(r=>r.url().endsWith('/api/options/route'));
  releaseCorridor();await staleResponse;
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await routeGroup.locator('.row').count(),50,'la respuesta tardía del corredor descartado no sobrescribe las propuestas actuales');
  assert.ok(!(await routeGroup.innerText()).includes('Parada del nuevo trayecto'));
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('tab',{name:'Itinerario'}).click();
  await page.locator('.sheet .timeline').waitFor();
  assert.ok(await page.locator('.sheet .timeline .row').count()>5);
  await page.screenshot({path:'data/ui-day-mobile.png'});
  assert.deepEqual(errors,[]);
  console.log('OK: 50 paradas, fallo de lote, reintentos por bloque, selecciones, duración, mapa y móvil sin excepciones.');
} finally {
  await browser?.close();
  await new Promise(r=>server.close(r));
}
