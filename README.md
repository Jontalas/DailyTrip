# Travel Planner

Planificador de **etapas diarias de un viaje por carretera**. Indicas origen, una
dirección orientativa y cuántos km quieres conducir; la app propone **bases
finales válidas** dentro de ese rango, ordenadas por **interés** (no por cercanía
al kilometraje ideal), y te deja construir el día seleccionando paradas,
actividades, comida, cena y alojamiento, con un itinerario que se recalcula solo.

La fuente de verdad para el desarrollo es **`doc/APPLICATION_HANDOFF.md`**. Léelo
antes de tocar nada.

## Requisitos

- Node.js ≥ 18 (probado con Node 24)
- Una clave de Geoapify en `.env` (`GEOAPIFY_API_KEY`). Copia `.env.example` a
  `.env` y rellénala. Google Places es opcional.
- Para `npm run dev` y el smoke test: un Chrome o Edge instalado.

## Puesta en marcha

```bash
npm install        # una vez
npm run build      # compila el frontend (client/ -> public/)
npm start          # sirve la app en http://localhost:3000
```

## Desarrollo

```bash
npm run dev        # backend :3000 + Vite :5173 con proxy /api  ->  abrir http://localhost:5173
node scripts/smoke.mjs      # test e2e del flujo principal (Playwright)
node --check server.js      # validación de sintaxis del backend
```

## Arquitectura (resumen)

- **Backend**: Node + Express 5 (`server.js`), ES modules. Sin base de datos;
  caché en `data/cache.json`. Proveedores: Nominatim (geocoding), OSRM (rutas),
  Geoapify (lugares, principal), Google Places (respaldo), Overpass (tercer
  nivel).
- **Frontend** (desde v1.2.0): Vite + Svelte + Leaflet, interfaz *map-forward*.
  Fuente en `client/`, build a `public/`. La UI vanilla anterior está en
  `doc/legacy-ui/` como referencia.

## Reglas de producto que no se negocian

- **La distancia es un filtro, no una puntuación.** Dentro del rango
  `deseado ± tolerancia`, todas las bases son igual de válidas; ordenan por
  interés. Nunca reintroducir la distancia en el ranking.
- **El destino orientativo indica dirección, no obligación.**
- **Mejor no mostrar algo que mostrar algo geográficamente falso.**
- **"No pude consultar los datos" no es lo mismo que "hay 0 opciones".**
- **Comida protegida 12:30–14:30** y límite del día **22:30**.

Detalle completo, invariantes, regresiones históricas y changelog: `doc/APPLICATION_HANDOFF.md`.
