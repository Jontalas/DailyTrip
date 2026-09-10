/* Smoke test end-to-end del frontend (Playwright + Chrome del sistema).
   Levanta un navegador headless contra un server ya en marcha (por defecto :3000),
   recorre el flujo Málaga -> Almería y falla si hay errores de consola/JS.

   Uso:  node scripts/smoke.mjs [baseUrl]
   Requiere: npm i -D playwright  +  Chrome o Edge instalados. */

import assert from "node:assert/strict";
import { chromium } from "playwright";
import os from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:3000";
const OUT = os.tmpdir();
const errors = [];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

const step = (m) => console.log(`\n=== ${m}`);

try {
  step("load app");
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Buscar final de etapa", { timeout: 10000 });
  console.log("app montada OK");

  step("buscar (Malaga -> Almeria, tolerancia 40 km desde Almeria)");
  await page.click('button:has-text("Buscar finales de etapa")');
  await page.waitForSelector(".bases article.base", { timeout: 120000 });
  const baseNames = await page.$$eval(".bases article.base h3", (els) => els.map((e) => e.textContent.trim()));
  console.log("bases:", baseNames.join(" | "));
  assert.ok(baseNames.some((n) => /almer/i.test(n)), "Almería debe estar entre las bases");

  step("elegir primera base");
  await page.click(".bases article.base:first-child button.pick");
  await page.waitForSelector('button:has-text("Cargar opciones del día")', { timeout: 10000 });

  step("cargar opciones del dia");
  const routeReply = page.waitForResponse(r => r.url().endsWith('/api/options/route'), { timeout: 180000 });
  await page.click('button:has-text("Cargar opciones del día")');
  await page.waitForSelector(".groups .group", { timeout: 180000 });
  const routePayload = await (await routeReply).json();
  await page.waitForFunction(count=>document.querySelectorAll('.groups .group:nth-of-type(1) .row').length===count,routePayload.items.length,{timeout:90000});
  const displayedStops = await page.locator('.groups .group:nth-of-type(1) .row').count();
  assert.equal(displayedStops, routePayload.items.length, 'La interfaz debe conservar todas las paradas');
  if (routePayload.coverage?.outcome === 'target-reached') assert.ok(displayedStops >= routePayload.coverage.target);
  console.log('paradas visibles:', displayedStops, 'objetivo:', routePayload.coverage?.target, 'estado:', routePayload.coverage?.outcome);
  await page.waitForTimeout(2500);

  step("acordeon: arranca colapsado; abrir uno cierra los demas");
  console.log("abiertos al inicio:", await page.$$eval(".groups details[open]", (e) => e.length));
  await page.click(".groups .group:nth-of-type(1) summary");
  await page.waitForSelector(".groups .group:nth-of-type(1) .row", { timeout: 20000 });
  await page.click(".groups .group:nth-of-type(3) summary");
  await page.waitForTimeout(400);
  console.log("tras abrir 1 y luego 3, abiertos:", await page.$$eval(".groups details[open] .g-title", (e) => e.map((x) => x.textContent.trim())));

  await page.waitForSelector(".groups .group:nth-of-type(3) .row", {timeout:180000});
  const counts = await page.evaluate(() => ({
    groups: document.querySelectorAll(".groups .group").length,
    tripBar: document.querySelectorAll(".trip-bar").length,
    timelineRows: document.querySelectorAll(".timeline .row").length
  }));
  assert.equal(counts.groups, 5);
  assert.equal(counts.tripBar, 1);
  console.log("counts:", JSON.stringify(counts));

  step("seleccionar 1 parada + 1 actividad");
  await page.click(".groups .group:nth-of-type(1) summary");
  await page.waitForSelector(".groups .group:nth-of-type(1) .row", { timeout: 20000 });
  await page.locator(".groups .group:nth-of-type(1) .row .face").first().click(); // primera parada
  await page.waitForTimeout(500);
  await page.click(".groups .group:nth-of-type(3) summary");
  await page.waitForTimeout(300);
  const acts = await page.$$(".groups .group:nth-of-type(3) .row");
  if (acts[0]) { await acts[0].click(); await page.waitForTimeout(1800); }
  console.log("timeline rows:", await page.$$eval(".timeline .row", (e) => e.length));
  console.log("marcadores seleccionados:", await page.$$eval(".map-opt.is-selected", (e) => e.length));

  step("editar duracion");
  const durInput = await page.$(".groups .group:nth-of-type(3) .row.is-selected .duration input");
  if (durInput) {
    await durInput.fill("15");
    await durInput.dispatchEvent("input");
    await page.waitForTimeout(1200);
    console.log("duracion editada sin crash");
  } else throw new Error("Falta el editor de duración de la actividad seleccionada");

  step("hover parada -> spur");
  await page.click(".groups .group:nth-of-type(1) summary");
  await page.waitForSelector(".groups .group:nth-of-type(1) .row", { state: "visible", timeout: 20000 });
  await page.waitForTimeout(500);
  await page.locator(".groups .group:nth-of-type(1) .row").first().hover();
  await page.waitForTimeout(1600);
  console.log("spur chips:", await page.$$eval(".spur-chip", (e) => e.length));

  step("toggle preferencia Museos");
  const pref = await page.$('.prefs .pref:has-text("Museos") input');
  if (pref) { await pref.click(); await page.waitForTimeout(600); }

  step("editar viaje (trip-bar)");
  const edit = await page.$('.trip-edit');
  if (edit) {
    await edit.click();
    await page.waitForTimeout(400);
    const reopened = !!(await page.$('#f-origin')) && !(await page.$('.groups'));
    console.log("busqueda reabierta (form visible, opciones ocultas):", reopened);
  }

  step("mapa");
  const mapOk = await page.evaluate(() => {
    const m = document.querySelector(".leaflet-container");
    return !!m && m.querySelectorAll(".leaflet-tile").length > 0;
  });
  assert.ok(mapOk, "Leaflet debe cargar teselas");

  const shot = path.join(OUT, "travelplanner-smoke.png");
  await page.screenshot({ path: shot });
  console.log("captura:", shot);
} catch (e) {
  errors.push(`SCRIPT: ${e.message}`);
} finally {
  await browser.close();
}

console.log("\n================ RESULTADO ================");
if (errors.length) {
  console.log("ERRORES:");
  errors.forEach((e) => console.log("  - " + e));
  process.exitCode = 1;
} else {
  console.log("sin errores de consola ni excepciones");
}
