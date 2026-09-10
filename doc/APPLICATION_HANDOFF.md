# Travel Planner — Documento maestro de continuidad de desarrollo

**Versión de aplicación documentada:** 1.2.23  
**Estado del documento:** fuente de verdad para continuar el desarrollo  
**Objetivo del documento:** permitir que una IA de desarrollo, sin contexto previo de la conversación, pueda comprender con precisión qué hace la aplicación, por qué está diseñada así, qué decisiones son obligatorias, qué problemas ya aparecieron y cuál es exactamente el punto actual del proyecto.

---

# 0. NORMA OBLIGATORIA DE MANTENIMIENTO DE ESTE DOCUMENTO

## 0.1. Este documento forma parte del producto

Este archivo **no es una explicación auxiliar** ni un README opcional.

Debe considerarse parte obligatoria del código fuente de Travel Planner.

A partir de esta versión:

> **Cualquier cambio realizado en la aplicación debe quedar documentado en este mismo archivo con el mismo nivel de claridad, precisión y orientación técnica que el propio cambio de código.**

No debe entregarse una nueva versión de la aplicación sin actualizar este documento.

## 0.2. Qué debe documentarse con cada cambio

Cada cambio futuro debe registrar, como mínimo:

1. **Número de versión nuevo.**
2. **Motivo del cambio.**
3. **Problema que se intenta resolver.**
4. **Comportamiento anterior.**
5. **Comportamiento nuevo.**
6. **Archivos y funciones afectadas.**
7. **Algoritmos, fórmulas, límites o constantes modificados.**
8. **Nuevos invariantes funcionales.**
9. **Qué comportamiento anterior debe conservarse.**
10. **Fallbacks y tratamiento de errores.**
11. **Impacto en UI y experiencia del usuario.**
12. **Impacto en APIs/proveedores externos.**
13. **Compatibilidad con datos/caché/versiones anteriores.**
14. **Pruebas o validaciones realizadas.**
15. **Limitaciones conocidas que permanecen.**

No son suficientes anotaciones como:

- “mejorada búsqueda”;
- “corregido bug”;
- “cambiado ranking”;
- “añadido fallback”.

La descripción debe permitir reconstruir mentalmente la modificación.

## 0.3. Antes de modificar código

La IA/desarrollador que continúe este proyecto debe:

1. leer este documento completo;
2. identificar qué invariantes toca el cambio;
3. evitar modificar subsistemas no relacionados salvo necesidad real;
4. revisar especialmente la sección de **regresiones históricas**;
5. preferir cambios pequeños sobre reescrituras amplias cuando una parte ya funciona.

## 0.4. Después de modificar código

Antes de considerar terminada una versión:

- actualizar este documento;
- actualizar la versión de `package.json`;
- actualizar la versión visible de la UI;
- actualizar el identificador de versión del servidor/User-Agent cuando proceda;
- ejecutar al menos:
  - `node --check server.js`
  - `node --check public/app.js`
- comprobar que no se ha reintroducido ninguna regresión documentada.

## 0.5. Regla de oro del proyecto

> **No arreglar una parte estable reescribiéndola innecesariamente.**

En varias iteraciones anteriores se produjeron regresiones precisamente por sustituir lógica que ya funcionaba por cadenas de fallback cada vez más complejas.

Cuando una versión anterior funcionaba correctamente para un subsistema, debe preferirse recuperar o preservar esa lógica antes que inventar otra arquitectura sin necesidad.

---

# 1. VISIÓN DEL PRODUCTO

Travel Planner es una aplicación web personal para planificar **etapas diarias de un viaje por carretera**.

No pretende crear un itinerario turístico rígido desde el principio.

El flujo de uso deseado es:

1. el usuario está en una localidad;
2. indica una **dirección o destino orientativo**;
3. indica aproximadamente cuántos kilómetros quiere conducir ese día;
4. establece una tolerancia;
5. la aplicación identifica **bases finales válidas** dentro de ese rango;
6. las ordena por **interés de la base**, no por cercanía al kilometraje ideal;
7. el usuario elige dónde terminar el día;
8. la aplicación obtiene muchas opciones:
   - paradas en ruta;
   - lugar para comer;
   - actividades en el destino;
   - cena;
   - alojamiento;
9. el usuario selecciona libremente varias;
10. el itinerario se recalcula dinámicamente;
11. se incluyen los desplazamientos entre lugares;
12. las opciones temporalmente inviables dejan de ofrecerse.

La herramienta está pensada para preparar cada jornada aproximadamente el día anterior o la tarde anterior.

---

# 2. PRINCIPIOS DE PRODUCTO NO NEGOCIABLES

## 2.1. La distancia es un filtro, no una puntuación

Este es uno de los requisitos más recientes y más importantes.

Ejemplo:

- distancia deseada: 200 km;
- tolerancia: ±40 km;
- rango válido: 160–240 km.

Cualquier destino cuya distancia real por carretera desde el origen esté dentro de 160–240 km es válido.

Una vez dentro del rango:

- 160 km **no es peor** que 200 km;
- 240 km **no es peor** que 200 km;
- 200 km **no recibe bonificación**.

La distancia sólo responde:

> ¿Es válida esta base para la etapa?

El ranking posterior responde:

> ¿Cuál de las bases válidas es más interesante?

Ese ranking debe depender del **interés de la base**.

## 2.2. El destino orientativo indica dirección, no obligación

Si el usuario escribe “Almería” como destino orientativo pero quiere conducir unos 200 km, Almería no se selecciona automáticamente.

La aplicación usa esa dirección para construir el corredor de viaje.

Puede proponer otra localidad que:

- esté dentro del rango diario;
- esté razonablemente en la dirección de viaje;
- tenga más interés como base.

## 2.3. Es preferible no mostrar una propuesta a mostrar una geográficamente falsa

Este principio surgió tras una regresión grave en versiones antiguas, donde el mismo Museo de Historia de Motril apareció:

- como parada en ruta;
- y después otra vez como actividad “en destino”, aunque el destino ya estaba en otra localidad.

Por tanto:

- nunca duplicar una misma opción en fases incompatibles;
- nunca mostrar como actividad del destino algo localizado claramente fuera del destino;
- nunca mostrar como hotel de la base un alojamiento de una localidad vecina;
- nunca colocar una parada de ruta después de haber llegado al destino.

## 2.4. El contenido no debería quedar vacío salvo fallo extraordinario

Objetivo de fiabilidad:

> salvo falta de conexión o fallo catastrófico de servicios/datos, la aplicación debe proporcionar contenido utilizable.

Cuando una fuente falla:

- intentar otra;
- usar caché;
- como último recurso, ofrecer una actividad genérica veraz.

Nunca convertir:

> “no pude consultar los datos”

en:

> “hay 0 actividades”.

Son estados semánticamente distintos.

## 2.5. No inventar lugares concretos

Los fallbacks generados pueden ser:

- “Paseo libre por Aguadulce”;
- “Explorar Aguadulce a pie”;
- “Elegir restaurante al llegar”;
- “Alojamiento por reservar”.

No deben inventarse nombres de museos, restaurantes, hoteles o monumentos.

Los fallbacks generados deben marcarse como:

- `source: "generated"`
- `verified: false`

y la UI debe mostrarlos como **Generado**.

## 2.6. Múltiples paradas y actividades

Las siguientes categorías son de selección múltiple:

- paradas en ruta;
- actividades en destino.

No convertirlas a selección exclusiva.

## 2.7. Duración editable por el usuario

Cada opción seleccionada tiene una duración recomendada, pero **el usuario manda**.

Ejemplo:

- recomendación: 60–120 min;
- valor interno recomendado: 90 min;
- usuario decide: 10 min.

El itinerario debe usar 10 min.

Ese valor personalizado debe afectar inmediatamente a:

- horario;
- hora final;
- viabilidad;
- ocultación/reaparición de otras opciones.

## 2.8. Comida protegida

Debe reservarse tiempo para comer entre:

- 12:30
- 14:30

La comida puede ocurrir:

- en ruta;
- en destino.

Las opciones propuestas deben ser compatibles con esa ventana siempre que se disponga de información suficiente.

Si no se elige restaurante concreto, sigue existiendo un bloque de comida.

## 2.9. El itinerario debe estar siempre visible

En escritorio:

- opciones a la izquierda;
- itinerario a la derecha;
- columna de itinerario `sticky`;
- si el itinerario supera la altura disponible, scroll interno.

En pantallas estrechas se vuelve al flujo normal.

## 2.10. Viabilidad dinámica (sólo informativa)

Cuando se selecciona o modifica una opción:

- recalcular el día;
- **nunca ocultar opciones**: en ninguna sección se retira una opción de la
  lista por horario, apertura o llegada/fin tardío;
- cuando una opción no seleccionada rompería un límite del día, marcar su ficha
  con un aviso informativo, sin bloquear la selección;
- el usuario siempre puede elegir cualquier opción y ajustar el itinerario.

Actualmente el límite aproximado del día usado por el frontend es **22:30**, y la
ventana de comida protegida es **12:30–14:30**. Ambos generan avisos, no filtros.

---

# 3. STACK ACTUAL

## Backend

- Node.js >= 18
- Express 5
- ES modules (`"type": "module"`)
- `dotenv`

## Frontend

**Hasta v1.1.5:** HTML + CSS + JavaScript vanilla, sin framework, sin build step.
Esa UD vive ahora sólo como referencia en `doc/legacy-ui/` (index.html, app.js,
styles.css).

**Desde v1.2.0 (rework map-forward, completado en 3 fases):**

- Vite 6 + Svelte 5 (runas) — **hay build step** (decisión explícita del usuario;
  ver §46 y el changelog de v1.2.0-alpha.1 para la justificación y el cómo).
- Leaflet 1.9 + teselas Esri "Gray Canvas" (claro/oscuro, sin clave API).
- Código fuente en `client/`; `vite build` compila a `public/`, que es lo que
  `server.js` sigue sirviendo como estático. El backend NO cambia.
- Sistema de diseño "Travel cálido" en `client/src/app.css` (tokens de color
  claro/oscuro, tipografía, espaciado, sombras, superficies glass, motion).
- La lógica de negocio del cliente (itinerario, viabilidad, preferencias,
  duraciones) se portó VERBATIM desde `public/app.js` a
  `client/src/lib/{itinerary,scoring,format,stores}.js`. Mismos límites y
  fórmulas; ver §46.

## Persistencia

Archivo JSON:

`data/cache.json`

No existe base de datos SQL actualmente.

---

# 4. ESTRUCTURA ACTUAL DEL PROYECTO

```text
DailyTrip/
│
├─ package.json              # scripts dev/build/start; deps runtime + devDeps de build
├─ server.js                 # backend Express (lógica intacta desde v1.1.5)
├─ vite.config.js            # root: client/  ·  build.outDir: ../public  ·  proxy /api -> :3000
├─ .env / .env.example
├─ data/
│  └─ cache.json
├─ doc/
│  ├─ APPLICATION_HANDOFF.md
│  └─ legacy-ui/             # UI vanilla hasta v1.1.5, sólo referencia
├─ scripts/
│  └─ smoke.mjs              # test e2e Playwright del flujo principal
├─ client/                   # FUENTE del frontend (Vite + Svelte), desde v1.2.0
│  ├─ index.html
│  └─ src/
│     ├─ main.js
│     ├─ app.css             # sistema de diseño (tokens)
│     ├─ App.svelte          # orquestador + layout map-forward
│     ├─ lib/
│     │  ├─ api.js           # un método por endpoint del backend
│     │  ├─ stores.js        # estado global (espejo de las variables de app.js)
│     │  ├─ itinerary.js     # buildItinerary / approximateSchedule / isLunchViable (PORT VERBATIM)
│     │  ├─ scoring.js       # preferencias e interés ajustado (PORT VERBATIM)
│     │  ├─ format.js        # toMin/fromMin/fmt/haversine/approxLocalTravelMin
│     │  └─ map.js           # controlador Leaflet (teselas, ruta, marcadores)
│     └─ components/
│        ├─ MapCanvas.svelte      SearchPanel.svelte     BaseResults.svelte
│        ├─ PreferencesBar.svelte OptionsPanel.svelte    OptionCard.svelte
│        ├─ ItineraryPanel.svelte TimelineRow.svelte     Progress.svelte
└─ public/                   # SALIDA de `vite build` (index.html + assets/). Servido por server.js.
```

`vite build` hace `emptyOutDir` sobre `public/`: no editar `public/` a mano, se
regenera. La carpeta `node_modules` incluye ahora devDeps de build (vite, svelte,
plugin) y Playwright para el smoke test.

---

# 5. CONFIGURACIÓN Y SECRETOS

La aplicación utiliza `.env`.

Variables actuales:

```text
PORT
GEOAPIFY_API_KEY
GOOGLE_PLACES_API_KEY
NOMINATIM_URL
OSRM_URL
OVERPASS_URL
APP_USER_AGENT
DEBUG_EXTERNAL
```

## Geoapify

Actualmente el proyecto está preparado para usar Geoapify como proveedor principal de lugares.

La clave está configurada en el `.env` de la versión entregada al usuario.

**No copiar el valor de la clave a documentación, logs, UI, repositorios públicos o respuestas.**

Debe tratarse como secreto.

## Google Places

Implementado como proveedor opcional de respaldo.

Puede estar sin configurar.

## DEBUG_EXTERNAL

Si:

```text
DEBUG_EXTERNAL=1
```

se muestran mensajes de diagnóstico de proveedores externos.

Por defecto:

```text
DEBUG_EXTERNAL=0
```

para evitar llenar la consola con errores transitorios de Overpass/servicios públicos.

---

# 6. PROVEEDORES EXTERNOS Y FUNCIÓN DE CADA UNO

## 6.0. Wikipedia en español (desde v1.2.4)

`https://es.wikipedia.org/w/api.php` — gratis, sin clave, sólo atribución.

Usos:

- **fuente principal de actividades** y de paradas notables en ruta: `list=geosearch`
  para localizar artículos cercanos + `prop=extracts|pageimages|pageterms|pageviews|langlinks|info`
  para descripción real, imagen, descripción corta de Wikidata y señales de
  relevancia (idiomas del artículo, tamaño, visitas de 20 días);
- **afinar el centro urbano** de una localidad (`wikiPlaceCoord`) cuando el nodo
  OSM está descolocado.

Funciones: `wikiFetch`, `wikiNearby`, `wikiPlaceCoord`, `wikiCategoryFromText`,
`wikiIsVisitablePlace`, `mergeByProximity`.

Es aditivo (si falla se sigue con Geoapify). No cachea resultados parciales ni
sólo-Geoapify en actividades, para reintentar Wikipedia después. En ráfagas de
peticiones responde "too many requests" (transitorio).

**Desde v1.2.6 — actividades en destino, política "sólo Wikipedia":**
Wikipedia es la fuente **primaria única** de `robustDestinationContent("activities")`.
Geoapify sólo **rellena** cuando el resultado de Wikipedia es escaso (`< 8`
actividades) y sólo se añaden ítems de Geoapify que traigan descripción real o
imagen. El objetivo es que **toda** actividad tenga imagen y descripción reales, no
una mezcla de fichas ricas (Wikipedia) y genéricas. Si Wikipedia no respondió
(`wikiOk` falso) el resultado de actividades **no se cachea** (clave `content:v7:`),
para que un fallo transitorio no fije contenido pobre 14 días.

**Desde v1.2.7 — paradas en ruta, TRES fuentes siempre + reparto geográfico:**
`robustRouteStops` dejó de ser "sólo Wikipedia": la cobertura de Wikipedia por el
corredor es irregular (se amontona en dos o tres pueblos y deja tramos enteros
vacíos). Ahora consulta **Wikipedia + Geoapify + OSM/Overpass a la vez** en 4–9
puntos de muestreo repartidos por TODO el trazado (uno cada ~25 km), fusiona con
prioridad Wikipedia > Geoapify > OSM, y aplica un **reparto por tramos**
(`distributeAlongRoute`: ~10 buckets de progreso, hasta 3–4 por bucket, relleno en
ronda, tope 26–30) para que las paradas no se agrupen. Filtros de calidad: fuera
núcleos de población (`ROUTE_SKIP_SETTLEMENT` / `WIKI_SETTLEMENT_LEAD`), códigos de
carretera (`ROAD_CODE` en `wikiNearby`), nombres que son direcciones
(`ROUTE_ADDRESS_LIKE`), y toda parada no-Wikipedia debe aportar imagen / descripción
real / web / ficha wiki o pertenecer a una categoría auto-explicativa
(`SELF_EXPLANATORY`: playa, mirador, castillo, parque natural…). `attachWikiExtracts`
trae extracto e imagen reales de Wikipedia para POIs de OSM con etiqueta
`wikipedia=`. Clave de caché `routeStops:v5:`; sólo se cachea si Wikipedia respondió
o hay ≥12 paradas. `wikiNearby` sigue abortando (lanza) si falla una tanda, pero en
paradas en ruta se llama por punto de muestreo dentro de `.catch`, así que un punto
que falle no tumba el resto.

## 6.1. Nominatim / OpenStreetMap

Usos:

- geocodificación de origen/destino;
- reverse geocoding;
- fallback de localidades.

Existe throttling manual para respetar aproximadamente 1 solicitud/segundo.

Funciones:

- `geocode(q)`
- `reverseGeocode(lat, lon)`
- `nominatimWait()`

## 6.2. OSRM

Proveedor principal de rutas.

Usos:

- geometría de ruta;
- tiempo/distance total;
- table routing;
- desplazamientos entre opciones;
- cálculo de desvíos.

Funciones:

- `osrmRoute()`
- `routeGeometry()`
- `routeTable()`

Endpoint cliente adicional:

`POST /api/travel/sequence`

## 6.3. Geoapify

Proveedor principal actual para:

- localidades candidatas;
- actividades;
- restaurantes;
- alojamientos;
- enriquecimiento detallado;
- fallback de routing si OSRM falla.

Funciones principales:

- `geoapifyRoute()`
- `geoapifyPlaces()`
- `geoapifyPlaceDetails()`
- `enrichGeoapifyDetails()`
- `geoapifyPopulatedPlaces()`

## 6.4. Google Places

Proveedor secundario opcional.

Funciones:

- `googlePlaces(kind, center, radius, limit)`

Tipos configurados:

### activities

- tourist_attraction
- museum
- art_gallery
- park
- zoo
- aquarium
- amusement_park
- historical_landmark
- cultural_landmark
- performing_arts_theater

### food

- restaurant
- cafe

### lodging

- hotel
- hostel
- bed_and_breakfast
- resort_hotel
- campground

## 6.5. Overpass / OSM

Debe considerarse **tercer nivel**, no infraestructura crítica.

Su uso intensivo causó:

- HTTP 504;
- `fetch failed`;
- esperas muy largas;
- bloqueos aparentes;
- resultados parciales.

Función:

- `overpassQuick()`

No volver a construir cadenas largas de múltiples servidores × múltiples intentos × múltiples puntos secuenciales.

---

# 7. CACHÉ

Archivo:

`data/cache.json`

Estructura base:

```json
{
  "version": 1,
  "entries": {}
}
```

Funciones:

- `savePersistent()`
- `cacheGet()`
- `cacheSet()`

TTL fresco actual:

```text
14 días
```

constante:

```js
const FRESH_TTL = 14 * DAY;
```

La caché puede usarse incluso estando antigua cuando todos los proveedores fallan.

Las claves actuales incluyen versiones semánticas internas como:

- `content:v3:...`
- `baseSummary:v2:...`

Esto permite invalidar lógicamente resultados antiguos cambiando el prefijo.

---

# 8. FLUJO COMPLETO DE USUARIO

## Paso 1 — Buscar final de etapa

Inputs:

- origen;
- dirección/destino orientativo;
- distancia ideal;
- tolerancia.

Endpoint inicial:

`POST /api/search/context`

Hace:

1. geocodificar origen;
2. geocodificar destino orientativo;
3. calcular ruta completa;
4. comprobar que el destino está suficientemente lejos;
5. determinar rango válido;
6. generar anchors de ruta.

El rango:

```js
min = desired - tolerance
max = desired + tolerance
```

La distancia ideal sólo define el centro de la ventana.

## Paso 2 — Descubrir bases candidatas

Endpoint:

`POST /api/search/candidates`

La versión 1.1.4 introduce la lógica actual.

### Descubrimiento

Función:

`discoverBaseCandidates(anchors)`

Primero usa Geoapify:

`geoapifyPopulatedPlaces()`

Consulta categoría (desde v1.1.5):

```text
populated_place.city,populated_place.town,populated_place.village
```

Antes (v1.1.4) consultaba el genérico `populated_place`, que además de
ciudades/pueblos/villas devolvía cortijos, diseminados, aldeas mínimas y barrios
sueltos. En corredores con mucho topónimo rural (p. ej. Málaga→Almería) esos
núcleos minúsculos saturaban el `limit` de 24 por anchor y, al concatenarse por
orden de anchor, empujaban a ciudades legítimas más allá del recorte de 40 (y del
recorte de 36 previo al enrutado). Resultado: Almería (~221 km, dentro del rango
válido) nunca llegaba siquiera a la validación de kilometraje.

Parámetros actuales aproximados:

- radio: 28 km alrededor de cada anchor;
- límite: 24 resultados por anchor;
- máximo tras deduplicación: 40 candidatos.

Desde v1.1.5, tras deduplicar y **antes** de recortar a 40, la lista se ordena de
forma estable por `BASE_TYPE_WEIGHT` (`city:4, town:3, village:2, suburb:1,
place:0`). Así una ciudad nunca cae del recorte por volumen de núcleos menores.
El mismo orden por tipo se aplica luego en `/api/search/candidates` antes del
`slice(0,18)` (usa la misma constante de módulo, ya no una copia local).

`BASE_TYPE_WEIGHT` es constante de módulo en `server.js`, junto a `FRESH_TTL`.

Después añade reverse geocoding de cada anchor como fallback.

### Validación de kilometraje

Se calcula distancia real por carretera con `routeTable()`.

Una localidad sólo sigue si:

```text
desiredKm - toleranceKm <= roadKm <= desiredKm + toleranceKm
```

### IMPORTANTE — ranking actual

En v1.1.4 el kilometraje **no participa en la puntuación**.

Se conserva:

`distanceFromIdealKm`

sólo para mostrar información en UI.

### Evaluación del interés

Para cada base válida:

`quickBaseSummary(destination)`

Geoapify busca, dentro de 5 km y hasta 70 elementos:

```text
tourism
entertainment
heritage
leisure
beach
maritime
natural
catering.restaurant
accommodation
```

Después:

`baseContentScore(items)`

cuenta:

- actividades;
- food;
- lodging.

Fórmulas:

```js
activityScore = min(100, activities * 12)
foodScore     = min(100, food * 4)
lodgingScore  = min(100, lodging * 9)

interestScore =
    activityScore * 0.65 +
    foodScore     * 0.20 +
    lodgingScore  * 0.15
```

Se redondea.

### Orden final

Exclusivamente:

```js
b.baseInterest - a.baseInterest
```

Las bases sin interés calculable quedan detrás de las que sí lo tienen.

La respuesta devuelve actualmente hasta:

```text
8 bases
```

---

# 9. NOTA IMPORTANTE SOBRE EL INTERÉS DE BASE

La puntuación actual es todavía una heurística basada principalmente en **cantidad y variedad aproximada**, no en calidad turística profunda.

Ejemplo de saturación:

- 9 actividades ≈ actividadScore 100;
- 25 restaurantes ≈ foodScore 100;
- 12 alojamientos ≈ lodgingScore 100.

Esto significa que una localidad grande puede saturar fácilmente los contadores.

Futuras mejoras pueden incluir:

- ratings;
- reseñas;
- singularidad;
- patrimonio;
- importancia relativa;
- popularidad;
- variedad;
- calidad de descripciones;
- atracciones “must see”.

Pero **nunca volver a introducir distancia al kilometraje ideal como factor del ranking**.

---

# 10. ELECCIÓN DE BASE Y CARGA DEL DÍA

Al pulsar “Elegir esta base”:

- se guarda `chosen`;
- se muestra la sección de planificación;
- se puede indicar hora de salida;
- se pulsa “Cargar opciones del día”.

El frontend carga:

1. ruta detallada;
2. paradas en ruta;
3. comida en ruta;
4. actividades;
5. restauración + alojamiento.

Los bloques se lanzan en paralelo tras obtener la ruta.

---

# 11. PARADAS EN RUTA — ESTADO ACTUAL v1.2.13

`robustRouteStops` / `discoverRouteStops` en `server.js` y el motor testeable
`lib/route-search.js` buscan un **mínimo objetivo** `max(12, round(roadKm/4))`.
La explicación completa, algoritmos, invariantes, pruebas y compatibilidad
están en la entrada v1.2.13 de §43, que sustituye las reglas anteriores.

- Muestreo cada ≤10 km por longitud acumulada, sin tope de centros; distancia
  al segmento real, no a sólo 60 muestras. Corredor ±10 km y separación mínima
  de 6 km respecto al origen y al destino.
- Primera pasada Wikipedia + Geoapify repartida por todo el corredor. Si falta
  el mínimo: ampliar fuentes/categorías, paginar Geoapify, subdividir cajas
  Wikipedia/Google saturadas y consultar Overpass en las zonas pendientes.
- La variedad se usa para ordenar/repartir, no para expulsar lugares reales.
  Ya no hay tope por familia, por arranque de nombre, por número de playas ni
  distancia mínima entre dos visitas distintas.
- **Garantía de hitos (v1.2.28).** El corredor Málaga→Almería produjo 389
  candidatos válidos para ~50 plazas: el recorte por interés dejaba fuera hitos
  como la Cueva de Nerja (agravado por el bug de categoría `"natural"`→50).
  Ahora, además de las ~`roadKm/4` mejores por interés, se incluye cualquier
  candidato **ya descubierto** del corredor que sea un hito indiscutible
  (`isRouteLandmark`: artículo de Wikipedia en ≥10 idiomas o ≥8 000 visitas/20
  días). Sin tope. `coverage.landmarks` los cuenta.
- **`corridorLandmarks` (v1.2.28).** Pasada dedicada a mejor esfuerzo: geosearch
  por círculo a lo largo de la ruta → recuento de idiomas/visitas → sólo los
  hitos → fichas completas → al pool de candidatos. Se ejecuta antes de la
  búsqueda general. **No es garantía absoluta**: si Wikipedia está limitando el
  ritmo (429 → cooldown 60 s), se salta. El resultado se cachea al alcanzar el
  objetivo, así que a partir de la primera búsqueda satisfactoria el hito queda
  fijado. El proveedor `all` de Wikipedia dejó de usar `gsbbox` (fallaba
  "toobig") y ahora usa círculo `gscoord`+`gsradius=10 km`. Pasada rápida 30 → 45.
- El enriquecimiento añade información; no elimina POI reales por carecer de foto.
- `coverage.outcome`: `target-reached` / `sources-exhausted` / `incomplete`.
  Sólo el segundo significa que se han agotado sin error las fuentes disponibles
  consultadas dentro del corredor. Fallos de API, cuotas y truncamientos son
  incompletitud y permiten reintentar; nunca demuestran ausencia de más lugares.
- Caché `routeStops:v8:` basada en geometría/destino/objetivo. Sólo resultados
  que alcanzan el objetivo se fijan 14 días. Peticiones simultáneas comparten
  trabajo. No borrar cachés de actividades, servicios o búsqueda de bases.
- Un resultado sin lugares por fallo puede usar caché antigua o propuestas
  genéricas marcadas como tales; éstas NO cuentan para el objetivo de POI reales.

**Verificación real:** Málaga→Almería, 201,8561 km: 50 paradas, objetivo 50,
389 candidatos válidos, 22 centros, 44 consultas iniciales (Wikipedia/Geoapify),
primera carga ~66 s. Se alcanzó el mínimo antes de necesitar la fase ampliada.

---

# 12. POSICIÓN DE UNA PARADA EN LA RUTA

Funciones:

- `sampleRoute()`
- `distanceToRoute()`
- `routeProgress()`

La geometría de ruta se reduce aproximadamente a 60 muestras.

Para una opción:

1. se busca el punto de ruta más cercano;
2. se obtiene el índice;
3. se divide por el número de muestras.

Ejemplo:

```text
51 % del trayecto
```

significa aproximadamente mitad de la ruta.

No representa precisión métrica exacta.

---

# 13. MÉTRICAS DE DESVÍO DE PARADAS

Endpoint:

`POST /api/metrics/route-options`

Para las paradas seleccionables intenta calcular:

- km desde origen;
- km hasta destino;
- km extra;
- minutos extra.

Con OSRM Table compara:

```text
origen → parada
+
parada → destino
```

contra:

```text
origen → destino
```

Valores:

- `kmFromOrigin`
- `kmToDestination`
- `extraKm`
- `extraMin`

Si OSRM falla, usa estimación basada en:

- progreso de ruta;
- distancia a la ruta.

---

# 14. INTERÉS DE UNA OPCIÓN INDIVIDUAL

Esta nota es distinta del interés de la base.

Funciones:

- `scoreBreakdown()`
- `finalInterestFromBreakdown()`
- `enrichDecisionFields()`

## Subpuntuaciones

### Tipo/category

Por defecto:

```text
50
```

Valores relevantes:

```text
museum                        88
historic / sights / cultural  84
attraction                    80
viewpoint                     76
natural* / park / garden /    74   (* "natural", cave/cueva/gruta — regex /natur|park|garden|cave|cueva|gruta/)
restaurant                    70
accommodation                 65
```

**Ojo (arreglado en v1.2.28):** la rama de naturaleza probaba `includes("nature")`,
pero la categoría real es **`"natural"`** (y `natural.cave`, `natural.mountain`…).
Cuevas, sierras, cabos y cascadas caían al 50 por defecto y quedaban fuera del top
de paradas en ruta. Ahora se detectan con regex. Mismo arreglo en `interestScore()`
y `durationRange()`.

### Valoración

Si no existe rating:

```text
55
```

Si existe:

```js
ratingScore =
  clamp(
    ((rating - 2.5) / 2.5) * 100,
    0,
    100
  )
```

### Popularidad

Si no existen reseñas:

```text
45
```

Si existen:

```js
min(
  100,
  25 + log10(userRatingCount) * 22
)
```

### Información/completeness

Base:

```text
40
```

Suma:

```text
+25 website
+20 openingHours
+15 description
```

Máximo 100.

### Fiabilidad

```text
verified real source = 85
generated fallback   = 28
```

## Interés final

```text
category     30 %
rating       25 %
popularity   20 %
completeness 10 %
reliability  15 %
```

Fórmula:

```js
interest =
    category     * 0.30 +
    rating       * 0.25 +
    popularity   * 0.20 +
    completeness * 0.10 +
    reliability  * 0.15
```

### Importante

Una puntuación neutral puede reflejar **ausencia de datos**, no mediocridad real.

Ejemplo:

- Tipo 50;
- Valoración 55;
- Popularidad 45;

puede significar que Geoapify no proporcionó suficiente metadata.

---

# 15. “VALOR PARA LA ETAPA”

Para paradas en ruta existe también `stageValue`.

No confundir con el interés de base.

Combina aproximadamente:

- 72 % interés;
- 18 % coste temporal;
- 10 % penalización de desvío.

Actualmente se calcula en `/api/metrics/route-options`.

Conceptualmente:

```text
lugar muy interesante + desvío enorme
→ interés alto
→ valor de etapa menor

lugar algo menos importante + casi en ruta
→ interés menor
→ valor de etapa potencialmente mayor
```

---

# 16. DURACIONES RECOMENDADAS

## Función histórica

`durationFor(category)`

Valores aproximados:

```text
museum          90
gallery         75
viewpoint       35
zoo/aquarium   150
theme park     240
nature/park     75
historic        60
restaurant      85
default         60
```

## Rangos actuales

Función:

`durationRange(category, recommended)`

Ejemplos:

```text
museum             60–120
gallery            45–90
viewpoint           20–45
zoo/aquarium       120–210
theme/amusement    180–300
nature reserve      90–180
park/garden         45–90
historic/cultural   45–90
restaurant/food     70–100
```

El frontend muestra el rango.

Internamente se usa una duración recomendada media.

---

# 17. DURACIÓN PERSONALIZADA POR EL USUARIO

Estado frontend:

```js
let customDurations = new Map();
```

Funciones:

- `recommendedMinutes()`
- `selectedDuration()`
- `ensureCustomDuration()`
- `durationEditor()`
- `bindDurationEditors()`

Cuando una tarjeta se selecciona aparece un input:

```text
Tiempo que usaré [ N ] min
```

Rango permitido actual:

```text
1–720 min
```

step:

```text
5 min
```

El valor personalizado debe utilizarse en:

- paradas;
- actividades;
- comida seleccionada;
- cena;
- check-in/alojamiento.

## REGRESIÓN HISTÓRICA CRÍTICA

En varias versiones se introdujo accidentalmente:

```js
customDurations = new Map();
```

antes de:

```js
let customDurations = new Map();
```

provocando:

```text
Cannot access 'customDurations' before initialization
```

La cabecera correcta debe mantener este orden:

```js
const $=s=>document.querySelector(s);
let searchContext=null,chosen=null,routeData=null;
let pools={route:[],routeLunch:[],activities:[],food:[],lodging:[]};
let selected={route:[],activities:[],lunch:null,dinner:null,hotel:null};
let customDurations=new Map();
let rebuildSeq=0;
```

**Nunca insertar un reset de `customDurations` en la declaración de `pools`.**

Los resets posteriores deben ser asignaciones, nunca redeclaraciones.

---

# 18. ACTIVIDADES EN DESTINO

Endpoint:

`POST /api/options/activities`

Núcleo:

`robustDestinationContent("activities", destination)`

## Cadena actual

1. caché fresca;
2. Geoapify;
3. Google;
4. Overpass;
5. caché antigua;
6. fallback generado.

## Categorías Geoapify actuales

```text
tourism
entertainment
heritage
leisure
beach
maritime
natural
```

Esto se amplió porque búsquedas más estrechas estaban produciendo muy pocas opciones en localidades costeras.

## Radio

Actividades:

```text
6.5 km
```

Límite Geoapify:

```text
45
```

## Filtro de localidad

Función:

`belongsToSelectedBase(item, destination, kind)`

Para actividad:

```text
<= 5.5 km
```

o:

```text
<= 6.5 km
```

si la metadata de localidad coincide explícitamente con el nombre de la base.

---

# 19. DESCRIPCIONES DE LUGARES

Problema detectado:

las tarjetas mostraban frases prácticamente inútiles como:

> Lugar de interés localizado en la zona.

Se introdujo:

- `categoryDescription()`
- `geoapifyPlaceDetails()`
- `enrichGeoapifyDetails()`

## Prioridad deseada para una descripción

1. descripción real del proveedor;
2. descripción patrimonial;
3. metadata detallada del lugar;
4. información de Wikipedia;
5. web oficial;
6. categoría + localidad + dirección;
7. descripción generada contextual.

## Place Details

Para las opciones Geoapify más relevantes se consulta información adicional.

Máximo actual aproximado:

```text
12–14 opciones por bloque
```

con concurrencia limitada.

No enriquecer indiscriminadamente todos los resultados porque puede ralentizar la carga.

## Enlaces

Función frontend:

`linkFor(x)`

Prioridad:

1. `infoUrl`;
2. `website`;
3. `wikipediaUrl`;
4. búsqueda Google por nombre + base.

Las tarjetas muestran:

```text
Más información ↗
```

---

# 20. COMIDA

**Bloque reservado (sin restaurante elegido).** Ventana obligatoria:

```text
12:30–14:30
```

**Restaurante elegido a mano (desde v1.2.25).** No hay ventana ni suelo: la
parada se coloca **lo más cerca de las 14:00 posible y siempre antes de las
15:00** cuando algún orden válido lo permite; puede caer a cualquier hora antes
de ese tope. El servidor reordena ruta y paradas para conseguirlo
(`orderDay(..., opts)`, ver §29). Si ni reordenando cabe antes de las 15:00, se
mantiene el mejor plan y el itinerario añade un aviso; nunca se bloquea.
Constantes: `LUNCH_TARGET=840` (14:00), `LUNCH_LIMIT=900` (15:00) en
`day-plan.js`.

## Opciones

Se combinan:

- comida en ruta;
- comida en destino.

Cada opción se marca:

```text
EN RUTA
```

o:

```text
EN DESTINO
```

## Horarios

Función servidor:

`likelyOpenForLunch(openingHours)`

Puede devolver:

- `true`
- `false`
- `null` = desconocido

Un horario desconocido no implica restaurante cerrado.

El frontend debe avisar cuando no puede confirmarse.

---

# 21. COMIDA EN RUTA

Función:

`robustRouteLunch()`

Puntos actuales:

```text
38 %
50 %
62 %
74 %
```

Radio:

```text
7 km
```

Categorías:

```text
catering.restaurant
catering.cafe
```

Filtro:

```text
distanceToRoute <= 8 km
routeProgress 25–82 %
```

Máximo:

```text
24
```

Fallback:

```text
Parada flexible para comer en ruta
```

---

# 22. RESTAURANTES EN DESTINO

`robustDestinationContent("food")`

Radio actual:

```text
5.2 km
```

Filtro de localidad:

```text
<= 4.5 km
```

o hasta:

```text
5.5 km
```

si hay coincidencia explícita con la localidad.

---

# 23. ALOJAMIENTOS

Este subsistema tiene una regla geográfica fuerte.

## Requisito

> El alojamiento propuesto debe estar en la localidad seleccionada como base final.

Se detectó una regresión donde:

- base: Aguadulce;
- hotel propuesto: Almería.

Por ello la búsqueda se hizo más estricta.

## Radio de búsqueda

Actualmente:

```text
4.5 km
```

## Filtro posterior

`belongsToSelectedBase(..., "lodging")`

Acepta:

```text
<= 3.8 km
```

o:

```text
<= 5 km
```

sólo cuando la metadata de localidad contiene explícitamente el nombre de la base.

No ampliar este radio sin considerar de nuevo el riesgo de mezclar ciudades contiguas.

---

# 24. PREFERENCIAS DEL DÍA

UI actual:

- Historia
- Naturaleza
- Pasear
- Gastronomía
- Museos
- Miradores

Funciones:

- `getPreferences()`
- `preferenceBonus()`
- `adjustedInterest()`
- `adjustedStageValue()`
- `sortPools()`

Bonificaciones actuales:

```text
Historia      +10
Naturaleza    +10
Pasear         +7
Gastronomía   +10
Museos        +12
Miradores     +12
```

**Aplican a TODAS las listas, ruta incluida (v1.2.30).** `applyPreferences`
(`scoring.js`) reordena todos los pools por interés ajustado, `route` incluido.
Antes el matching (`preferenceBonus`) usaba `category.includes("nature")` y
similares, que fallaba justo para las categorías de ruta (`"natural"`,
`"natural.cave"`, `"heritage"`, `"historic.castle"`…): «Naturaleza` apenas movía
la lista de paradas en ruta. Ahora se detecta por **familia con regex**
(`PREF_MATCH` en `scoring.js`), así que las preferencias valen igual en ruta y en
destino.

**Recálculo con toda la reserva (v1.2.30).** El servidor devuelve muchas más
paradas de ruta que el objetivo (`selectRoutePlaces(ranked, max(90, target*3))`);
el cliente muestra las **55 de mayor interés ajustado** (`ROUTE_CAP` en
`OptionsPanel`) y, al activar una preferencia, reordena TODA la reserva y cambian
cuáles se ven — puede sacar a flote una parada que estaba justo por debajo del
corte de interés bruto. Las seleccionadas se muestran siempre. Es un límite de
**relevancia** (ajustable con las preferencias), no un filtro de viabilidad
(esos se quitaron en v1.2.24).

## Limitación conocida

El matching sigue basándose en la categoría (ahora por regex de familia), no en
nombre/descripción/tags. La influencia visual con listas cortas sigue siendo
sutil salvo que la preferencia cambie el corte de las 55 visibles.

Mejora futura recomendada:

- usar `item.categories` además de `item.category`;
- nombre;
- descripción;
- tags relacionados;
- mostrar explícitamente:
  - interés base;
  - bonus por preferencias;
  - interés ajustado;
  - coincidencias (“Museos”, “Historia”, etc.).

---

# 25. ITINERARIO

> **v1.2.0:** las secciones §25–§30 describen la implementación vanilla hasta
> v1.1.5. La lógica (orden de eventos, ventana de comida, límite 22:30,
> `leftTimelineValue`, `approximateSchedule`, `isLunchViable`, viabilidad,
> pasos de progreso) se portó **literal** a `client/src/lib/{itinerary,scoring}.js`
> y componentes Svelte; los invariantes se mantienen. Detalle y equivalencias
> en §46. El "itinerario sticky" (§27) pasa a ser un rail flotante fijo en
> escritorio y una pestaña de la hoja inferior en móvil/tablet — el requisito
> "itinerario siempre visible" se conserva.

Estado:

```js
selected = {
  route: [],
  activities: [],
  lunch: null,
  dinner: null,
  hotel: null
}
```

Función principal:

`rebuild()`

## Orden conceptual

1. salida;
2. desplazamiento;
3. paradas en ruta;
4. comida en ruta si seleccionada;
5. desplazamiento final;
6. llegada a base;
7. comida en destino si corresponde;
8. check-in;
9. actividades;
10. cena.

## Viajes locales entre actividades

Endpoint:

`POST /api/travel/sequence`

Primero intenta OSRM.

Si falla:

- usa distancia Haversine;
- factor de carretera aproximado 1.25;
- velocidad aproximada 35 km/h;
- mínimo 5 min.

---

# 26. PRESENTACIÓN DE DESPLAZAMIENTOS

Requisito explícito del usuario:

- eventos normales → columna izquierda = **hora de inicio**;
- desplazamientos → columna izquierda = **duración del desplazamiento**.

Ejemplo correcto:

```text
09:30   Salida
43 min  Desplazamiento
10:13   Parada
20 min  Desplazamiento
10:33   Parada
```

Funciones:

- `evt(...)`
- `leftTimelineValue(e)`

Desde v1.1.3 cada evento travel debe llevar:

```js
durationMin
```

de forma explícita.

No depender exclusivamente de analizar el texto del detalle.

---

# 27. ITINERARIO STICKY

En desktop:

```css
.itinerary-column {
  position: sticky;
  top: 14px;
}
```

La tarjeta usa altura máxima de viewport y scroll interno.

En pantallas <= ~900 px:

- se desactiva sticky;
- vuelve a flujo normal.

Este comportamiento fue solicitado explícitamente y debe conservarse.

---

# 28. SECCIONES COLAPSABLES

Las categorías usan `<details>` dentro de `.groups` (`OptionsPanel.svelte`).

Secciones actuales, en orden:

- Paradas personalizadas (`.custom-section`, grupo `custom`)
- Paradas en ruta
- Comida
- Actividades en destino
- Cena
- Alojamiento

Es un **acordeón de apertura única**: el grupo abierto vive en el store
`openOptionGroup`; abrir uno cierra los demás (`toggle()` hace
`openOptionGroup.update(k => k === key ? null : key)`). Arrancan todos colapsados.
El mapa usa `openOptionGroup` para pintar sólo las opciones no seleccionadas del
grupo abierto.

Desde v1.2.23 «Paradas personalizadas» se comporta igual que el resto: era una
sección siempre visible (v1.2.19) y ahora es un `<details>` más del acordeón
(misma flecha que rota, mismo borde inferior al abrir, misma exclusión mutua).

**Móvil (≤1024 px, desde v1.2.26).** `OptionsPanel` recibe `mobile` y sólo se
usa dentro de la hoja enfocada: el CSS oculta todos los `<details>` salvo el
abierto (`openOptionGroup`), esconde los `summary` (el título va en la cabecera
de la hoja) y quita el scroll propio de `.list` (la hoja ya hace scroll). El
acordeón deja de verse como tal: cada categoría es una hoja de una sola tarea
(ver §46, sección móvil).

---

# 29. VIABILIDAD TEMPORAL

Funciones:

- `approximateSchedule()`
- `updateViability()`
- `isLunchViable()`

## Límite del día

Actual:

```text
22:30
```

Las actividades no seleccionadas que harían superar aproximadamente esa hora
**no se ocultan**: se muestran todas y las que romperían el límite llevan un
aviso en la ficha («elegirla haría terminar el día después de las 22:30. Puedes
seleccionarla y ajustar el itinerario»). El conjunto `lateActivityIds`
(`App.svelte`) alimenta ese aviso vía la prop `lateFinish` de `OptionCard`;
antes alimentaba un filtro `visibleActivities` que se ha eliminado.

Las ya seleccionadas permanecen visibles igualmente.

## Ordenación consciente de la hora (comida y cena elegidas) — desde v1.2.25

Cuando hay un restaurante de **comida** y/o **cena** seleccionado, la ordenación
del día deja de mirar sólo la conducción:

- `orderDay(stops, origin, matrix, opts)` recibe `opts = {departureMin,
  durationOf, meals}`. El coste de una secuencia pasa a ser
  `conducciónMin + Σ mealTimePenalty(horaLlegada)`.
- `mealTimePenalty(a, target, limit)` (en `day-plan.js`): tirón suave hacia el
  objetivo si se llega antes (`×0.2`), coste lineal al pasarlo (`×1`), y un salto
  de `+10000` al pasar del límite para que reordenar gane a cualquier ahorro de
  conducción realista.
- Objetivos/límites: **comida 14:00 / 15:00**, **cena 20:00 / 21:00**
  (`LUNCH_TARGET/LUNCH_LIMIT`, `DINNER_TARGET/DINNER_LIMIT`). Sin límite inferior:
  la parada puede caer a cualquier hora antes del tope.
- Se reordenan sólo paradas `route`/`activity` (el ajuste fino del hill-climb),
  conservando todas las restricciones de `valid()` (frontera de base, actividades
  tras la base, nada tras la cena, `hotelReturn` al final).
- El hill-climb corre siempre que hay `opts`, aunque `optimalOrder` (que sólo
  minimiza conducción) haya dado una solución exacta.
- **Mejor esfuerzo:** si ningún orden válido coloca la comida antes de las 15:00
  (o la cena antes de las 21:00), se conserva el mejor plan y `buildItinerary`
  añade un aviso («Ni reordenando cabe la comida antes de las 15:00…»). Nunca se
  bloquea la selección.

Ruta de datos: `App.svelte` manda `departureMin` y `durations` (mapa
`id → minutos efectivos`, de `customDurations` + `recommendedMinutes`) en
`POST /api/plan/day`; `daySignature` los incluye **sólo si hay comida/cena
elegida** (firma byte a byte igual en el resto de casos); `routeDay` construye
`opts` sólo en ese caso. Cache key `day:v6:` → `day:v7:`.

## Lunch viability

- Comida en ruta: estima la hora por progreso de ruta + duración de las paradas
  anteriores; `isLunchViable` comprueba `arrival <= 15:00` (`LUNCH_LIMIT`).
- Comida en destino: estima llegada + paradas; misma comprobación.
- `updateViability`/`lateLunchKeys` alimentan el aviso `lateArrival` de
  `OptionCard`, nunca un filtro (las opciones no se ocultan, ver arriba).

---

# 30. PROGRESO DE OPERACIONES LARGAS

La UI no usa ya una barra porcentual falsa.

Utiliza pasos:

- pendiente;
- trabajando;
- terminado;
- error.

Funciones:

- `progressBox()`
- `setStep()`
- `hideProgress()`

Ejemplo búsqueda:

1. localizar origen;
2. calcular ruta;
3. buscar localidades;
4. validar kilómetros.

Generación de plan:

1. ruta detallada;
2. paradas;
3. comida en ruta;
4. actividades;
5. restauración/alojamiento.

---

# 31. ENDPOINTS ACTUALES

## `GET /api/providers`

Devuelve estado/configuración de proveedores.

## `POST /api/search/context`

Entrada típica:

```json
{
  "origin": "Málaga",
  "target": "Almería",
  "desiredKm": 200,
  "toleranceKm": 40
}
```

Devuelve:

- origin geocodificado;
- target;
- fuente de ruta;
- rango;
- anchors.

## `POST /api/search/candidates`

Descubre bases, valida kilometraje y las ordena por interés.

## `POST /api/plan/route`

Obtiene geometría detallada hacia la base.

## `POST /api/options/route`

Paradas en ruta.

## `POST /api/options/activities`

Actividades de destino.

## `POST /api/options/services`

Restaurantes y alojamientos.

## `POST /api/options/route-lunch`

Comida en ruta.

## `POST /api/travel/sequence`

Desplazamientos entre puntos seleccionados.

## `POST /api/metrics/route-options`

Métricas de desvío/valor de etapa de paradas.

## `POST /api/metrics/route-detour`  (desde v1.2.1)

Entrada: `{origin:{lat,lon}, stop:{lat,lon}, destination:{lat,lon}}`.
Devuelve la polilínea REAL por carretera `origen → parada → base`
(`{source:"osrm", coords:[{lat,lon}], roadKm, durationMin}`), cacheada con
prefijo `detour:v1:`. Si OSRM falla: `{source:"straight", coords:[origin,stop,destination]}`.
Lo usa el mapa para el **preview** del ramal de desvío al pasar el ratón sobre
una parada NO seleccionada.

## `POST /api/plan/route-via`  (desde v1.2.3)

Entrada: `{origin:{lat,lon}, vias:[{lat,lon}], destination:{lat,lon}}`.
Devuelve la polilínea REAL por carretera `origen → vias… → destino`
(`{source:"osrm", coords:[{lat,lon}], roadKm, durationMin}`), cacheada con
prefijo `routeVia:v1:`. Si OSRM falla: `{source:"straight", coords:[...]}`.
El mapa la usa para dibujar la ruta del día CON las paradas seleccionadas
(capa `itinRoute`), de modo que los desvíos se ven en todo momento.

---

# 32. DATOS DE UNA OPCIÓN

Una opción puede contener, según proveedor/fase:

```js
{
  id,
  name,
  lat,
  lon,

  category,
  categories,

  description,

  durationMin,
  durationRangeMin,
  durationRangeMax,

  openingHours,
  website,
  wikipediaUrl,
  infoUrl,

  rating,
  userRatingCount,

  source,
  verified,

  interestScore,
  interestBreakdown,

  stageValue,

  routeProgressPct,
  distanceToRouteKm,

  kmFromOrigin,
  kmToDestination,
  extraKm,
  extraMin,

  city,
  town,
  village,
  suburb,
  municipality,
  county,
  formatted
}
```

No asumir que todos los campos existen.

El frontend debe tratar metadata ausente como desconocida, no como cero.

---

# 33. ESTADOS DE FUENTE

Valores habituales:

```text
geoapify
google
osm
cache
cache-stale
generated
```

La UI usa badges.

---

# 34. DEDUPLICACIÓN

Función:

`dedupe(items)`

Considera duplicado si:

1. mismo `id`; o
2. mismo nombre normalizado y distancia < 0.8 km.

No eliminar elementos sólo por nombre si pueden ser negocios distintos en lugares distintos.

---

# 35. NORMALIZACIÓN

Función:

`norm(v)`

Actualmente:

```js
String(v || "")
  .trim()
  .toLocaleLowerCase("es")
```

No elimina tildes.

Esto puede ser relevante para futuros matching de localidades.

---

# 36. GEOMETRÍA Y DISTANCIAS

## Haversine

Función:

`haversineKm(a,b)`

Usada para:

- proximidad;
- dedupe;
- distancia a destino;
- filtros;
- fallback.

## Route sampling

Máximo típico:

```text
60 muestras
```

---

# 37. MANEJO DE ERRORES

Filosofía:

- los proveedores externos pueden fallar;
- una fuente no debe hundir toda la planificación;
- fallo parcial != 0 resultados reales;
- fallback y caché antes de vaciar la UI.

## Error catastrófico aceptable

Por ejemplo:

- sin Internet;
- no puede resolverse origen;
- ninguna fuente de ruta disponible;
- datos de entrada inválidos;
- estructura interna corrupta.

---

# 38. REGRESIONES HISTÓRICAS QUE NO DEBEN REPETIRSE

## 38.1. Parada duplicada como actividad de destino

Motril/Museo apareció en dos fases incompatibles.

Lección:

- separación ROUTE / DESTINATION;
- dedupe;
- filtros geográficos.

## 38.2. Destino a 715 km cuando se pidieron 200 km

La aplicación buscaba alrededor del destino orientativo en vez de alrededor de la etapa.

Lección:

- dirección != final obligatorio;
- rango de km debe validarse por carretera.

## 38.3. Overpass 504 y esperas enormes

Se construyeron demasiados reintentos/servidores.

Lección:

- Overpass no crítico;
- timeout corto;
- provider principal fiable;
- caché/fallback.

## 38.4. “0 visitas” cuando realmente falló la API

Lección:

- distinguir cero real de dato no disponible.

## 38.5. `uniqueByNameAndPlace is not defined`

Ocurrió tras mezclar versiones.

Lección:

- comprobar helpers referenciados;
- no limitar validación a sintaxis.

## 38.6. `linkFor is not defined`

Mismo tipo de regresión.

Lección:

- auditoría de referencias cliente.

## 38.7. `customDurations before initialization`

Apareció repetidamente al insertar resets automáticos.

Lección:

- preservar cabecera;
- declaración única;
- resets posteriores = asignación.

## 38.8. Paradas en ruta dejaron de aparecer tras reescribir fallbacks

Lección:

- la lógica anterior funcionaba;
- no reescribirla innecesariamente;
- cambios de duración no deben tocar búsqueda de paradas.

## 38.9. Hoteles de otra localidad

Base Aguadulce, hotel en Almería.

Lección:

- filtros estrictos de localidad para lodging.

## 38.10. Base 97/100 pero sin actividades

Ese 97 era ajuste de kilometraje, no interés real.

Lección definitiva:

- distancia = filtro;
- ranking = interés de base.

## 38.11. Una ciudad válida no aparecía por saturación del descubrimiento (v1.1.5)

Málaga → Almería, 200 ±40: Almería (~221 km, dentro de rango) no salía nunca.

Causa: la categoría genérica `populated_place` de Geoapify devolvía una avalancha
de cortijos/diseminados/barrios; con `limit:24` por anchor y recortes de 40 y 36,
la ciudad quedaba fuera antes de que se le midiera el kilometraje.

Lección:

- un recorte por tamaño de lista sobre datos concatenados por origen puede
  descartar candidatas válidas sin que ningún filtro "falle";
- al descubrir localidades, restringir a `city`/`town`/`village` y ordenar por
  tipo **antes** de recortar;
- si vuelve a aparecer un síntoma de "falta una base obvia", revisar primero el
  descubrimiento y los `slice()`, no el filtro de kilometraje.

---

# 39. LIMITACIONES ACTUALES CONOCIDAS

## 39.1. Interés de base todavía simple

Se basa principalmente en recuentos, no en calidad profunda.

## 39.2. Preferencias frágiles

Se apoyan demasiado en una sola categoría.

## 39.3. Place Details puede no tener descripción

Se usa descripción contextual generada.

## 39.4. Horarios

`opening_hours` puede:

- faltar;
- tener formatos complejos;
- ser difícil de interpretar.

No afirmar que está abierto si el estado es desconocido.

## 39.5. Disponibilidad real de hotel

La aplicación obtiene lugares, no inventario/precio/fecha real.

“Alojamiento” no equivale todavía a “habitación disponible esta noche”.

## 39.6. Reservas

No se realizan reservas automáticamente.

## 39.7. Orden de actividades en destino

Actualmente conserva esencialmente el orden de selección.

No existe todavía optimización tipo TSP para minimizar trayectos.

## 39.8. Transporte local

Se modela principalmente como conducción.

No decide todavía automáticamente:

- caminar;
- transporte público;
- coche.

## 39.9. Base summary limitada

Geoapify devuelve un número máximo de resultados.

Los contadores no deben interpretarse como censo exhaustivo.

## 39.10. Objetivo de paradas y límites de cobertura

Desde v1.2.13 sólo se declara agotamiento bajo el objetivo si todas las consultas
ampliadas y sus páginas/subzonas terminan sin errores. Una fuente fallida produce
`incomplete`, no «no hay más». El alcance es el corredor y las fuentes configuradas;
no existe una prueba universal de que ningún otro lugar real pueda existir.

## 39.11. Muchos marcadores de parada en el mapa

Con la sección "Paradas en ruta" abierta en una etapa larga, el mapa puede
dibujar 30–100+ marcadores. Hoy no hay clustering (pendiente opcional en §46.5);
si molesta, agrupar por zoom.

## 39.12. Primera carga de paradas

La búsqueda completa puede ser lenta: Málaga→Almería tardó ~66 s en la prueba
v1.2.13. Los centros ya no tienen el techo de 16 y la ampliación puede requerir
muchas páginas. Alcanzado el objetivo, la caché v8 acelera las cargas siguientes.
Resultados escasos o incompletos no se fijan durante 14 días.

---

# 40. PRIORIDADES NATURALES DE DESARROLLO

Las próximas mejoras deberían priorizar calidad antes que añadir muchas funciones nuevas.

## Prioridad 1 — validar v1.1.4 en escenarios reales

Casos recomendados:

- Málaga → Almería, 200 ±40;
- Málaga → Cádiz;
- localidades urbanas;
- localidades costeras;
- base cercana a otra ciudad grande.

Comprobar:

- ranking;
- recuentos;
- hoteles;
- actividades;
- route stops;
- tiempos.

## Prioridad 2 — mejorar interés de base

Sin usar distancia como peso.

Posibles señales:

- rating;
- número de reseñas;
- atracciones de alta relevancia;
- patrimonio;
- variedad;
- cantidad de POI únicos;
- concentración;
- opciones de paseo;
- costa/naturaleza;
- vida urbana;
- calidad de lodging/food.

## Prioridad 3 — preferencias

Hacer la afinidad robusta y explicable.

## Prioridad 4 — horarios

Motor real de apertura/cierre y viabilidad.

## Prioridad 5 — reordenación de actividades

Minimizar desplazamientos entre selecciones.

---

# 41. CRITERIOS DE CALIDAD ANTES DE ENTREGAR UNA NUEVA VERSIÓN

Una nueva versión no debería entregarse sin comprobar:

### Arranque

- servidor inicia;
- frontend carga;
- sin `ReferenceError`.

### Buscar base

- botón funciona;
- progreso termina;
- resultados dentro del rango;
- orden por interés, no km.

### Elegir base

- plan carga;
- paradas en ruta aparecen;
- actividades destino aparecen o fallback;
- restaurantes aparecen o fallback;
- lodging local.

### Selecciones

- múltiples route stops;
- múltiples activities;
- duración editable;
- recalculo inmediato.

### Itinerario

- desplazamientos con minutos a izquierda;
- resto con hora;
- comida protegida;
- tiempos coherentes;
- sticky visible.

### Datos

- descripciones útiles;
- links funcionales;
- sin duplicados obvios;
- sin lugares de otra localidad en lodging.

### Documentación

- este archivo actualizado.

---

# 42. PROTOCOLO DE VERSIONADO FUTURO

Ejemplo:

```text
v1.1.5
```

Al crearla:

1. copiar la versión estable anterior;
2. modificar sólo lo necesario;
3. actualizar:
   - `package.json`
   - etiqueta UI
   - User-Agent/version servidor;
4. actualizar este documento;
5. añadir entrada al changelog inferior;
6. validar sintaxis;
7. probar el flujo principal;
8. empaquetar ZIP.

---

# 43. CHANGELOG DE CONTINUIDAD

## v1.2.30 — Preferencias en ruta, más reserva de paradas, carga automática y barra de viaje temprana

- **1. «Qué te apetece hoy» ahora afecta también a las paradas EN RUTA.**
  `preferenceBonus` (`client/src/lib/scoring.js`) comprobaba
  `category.includes("nature")` etc.; las categorías de ruta son `"natural"`,
  `"heritage"`, `"historic.castle"`… → no casaban. Reescrito con `PREF_MATCH`
  (regex por familia) + `PREF_WEIGHT`. `applyPreferences` ya reordenaba todos los
  pools; ahora el bonus se aplica de verdad en ruta.
- **2. Se conserva toda la reserva de paradas y se recalcula al cambiar
  preferencia.** `server.js` `discoverRouteStops`:
  `selectRoutePlaces(ranked, Math.max(90, target*3))` (antes `target` ≈ `roadKm/4`).
  `OptionsPanel` muestra las **55 mejores por interés ajustado** (`ROUTE_CAP`);
  cambiar una preferencia reordena toda la reserva y cambia cuáles se ven. Las
  seleccionadas siempre visibles. Caché `routeStops:v25:` → **`v26:`**.
- **3. Elegir base carga el plan automáticamente.** `chooseBase` (`App.svelte`)
  llama a `loadPlan()` al terminar de trazar la ruta; ya no había ninguna
  decisión que tomar en «Cargar opciones del día». Ese botón desaparece; la
  tarjeta pasa a un estado «Preparando el día…» con el progreso (y «Reintentar`
  si falla). En móvil, elegir base cierra la hoja y vuelve al mapa; el botón de
  la barra pasa a «Preparando el día…».
- **4. Barra de viaje visible ya al listar finales de etapa.** Antes sólo salía
  tras elegir base. Ahora, con `searchContext` y sin base, muestra
  `<origen> → Zona de <destino orientativo>` y la **distancia por carretera al
  orientativo** (`searchContext.referenceRoute.roadKm`), con «cambiar». Al elegir
  base pasa a `<origen> → <base>`. Derivados `tripDest`/`tripKm` en `App.svelte`;
  aplica a la barra de escritorio y a `.m-trip`. El formulario de búsqueda se
  colapsa tras buscar y reaparece con «cambiar` / «volver` (condición pasó de
  `$chosen` a `$searchContext`).
- **Archivos.** `client/src/lib/scoring.js`, `client/src/components/OptionsPanel.svelte`
  (`ROUTE_CAP`, `allRoute`/`routeOptions`, línea de recuento), `client/src/App.svelte`
  (`chooseBase`, `planContent`, `mobileTaskView`, `tripDest`/`tripKm`, CSS),
  `client/src/components/MobileBar.svelte` (`hasSearch`, etiquetas), `server.js`
  (`selectRoutePlaces`, cache key). Versión 1.2.30.
- **Nuevos invariantes.**
  - Las preferencias reordenan las paradas en ruta, no sólo las de destino.
  - Elegir un final de etapa carga las opciones sin un clic extra.
  - La barra de viaje está presente desde que hay una búsqueda; antes de elegir
    base el destino es «Zona de <orientativo>».
- **Validación.** `npm test` 47/47; `npm run build` sin warnings; captura
  desktop: barra «Malaga → Zona de Almería 202 km`, formulario colapsado tras
  buscar, plan cargado sin pulsar nada, sin errores de consola.

## v1.2.29 — Guardar y cargar el viaje completo

- **Motivo.** Poder salvar el estado de trabajo (ruta, opciones, selecciones,
  itinerario…) y volver a cargarlo, de la forma más eficiente posible.
- **Cambios.**
  - Nuevo `client/src/lib/trip-state.js`: `buildSnapshot`/`applySnapshot`/
    `isSnapshot`/`snapshotFilename`, `TRIP_VERSION=1`. Serializa **sólo lo no
    recomputable**; el itinerario/ruta del día/`legCache`/`activeRoute` se
    reconstruyen solos al cargar (una llamada a `/api/plan/day`, casi siempre en
    caché). Coordenadas de ruta empaquetadas como array plano `[lat,lon,…]`
    (~45 % menos); no se guarda `searchContext.referenceRoute`.
  - `App.svelte`: **autoguardado** en `localStorage["dailytrip:trip"]` (retardo
    1,5 s, sólo con base elegida); barra **«Continuar / Empezar de cero»** al
    montar si hay instantánea; botón **«Cargar viaje»** (tarjeta de búsqueda y
    hoja móvil) con `<input type=file>` oculto.
  - `ItineraryPanel.svelte`: prop `onsave` → botón **«Guardar viaje»** que
    descarga `dailytrip-<origen>-<destino>-<fecha>.json`.
  - **Bugfix (regresión de v1.2.26):** `chooseBase` seguía asignando
    `sheetOpen`/`sheetTab`, variables eliminadas en el rediseño móvil →
    `ReferenceError` que abortaba la función a mitad (la ruta detallada
    origen→base no se dibujaba hasta cargar opciones). Eliminadas esas dos líneas.
  - Versión 1.2.29 en los 6 sitios habituales.
- **Nuevos invariantes.**
  - Un refresco o cierre del navegador no pierde el trabajo (autoguardado).
  - La instantánea contiene todo lo necesario para restaurar el estado sin
    re-buscar opciones ni re-geocodificar; sólo se recalcula el itinerario.
- **Compatibilidad.** `TRIP_VERSION` en la instantánea; un archivo de versión
  distinta se rechaza con aviso. `localStorage` keys: `dailytrip:trip` (nueva),
  `tp-theme` (sin cambios).
- **Validación.** `npm test` 47/47 (nueva: round-trip snapshot/restore + tamaño
  del empaquetado); `node --check server.js`; `npm run build`; captura desktop y
  móvil con el botón «Cargar viaje` y sin errores de consola.

## v1.2.28 — Hitos de alto interés en las paradas en ruta

- **Motivo.** En Málaga→Almería no se ofrecía la Cueva de Nerja. El corredor da
  ~389 candidatos válidos para ~50 plazas y el recorte por interés dejaba fuera
  hitos de primer nivel.
- **Causas.**
  1. **Fallo de puntuación.** `scoreBreakdown()`/`interestScore()`/`durationRange()`
     probaban `includes("nature")`, pero la categoría real de cuevas, sierras,
     cabos y cascadas es `"natural"` (y `natural.cave`, `natural.mountain`…): caían
     al valor de categoría por defecto (50) en vez de 74.
  2. **Recorte duro top-N.** `selectRoutePlaces(items, roadKm/4)` se queda con las
     ~50 mejores por interés, sin excepción para hitos indiscutibles.
  3. **Descubrimiento poco fiable.** La pasada profunda de Wikipedia usaba
     `gsbbox` con una caja de ±15 km → MediaWiki responde `"toobig"` y esa
     aportación quedaba en nada. Y Wikipedia limita el ritmo (429) al servidor
     durante la búsqueda, que entonces congela sus consultas 60 s.
- **Cambios.**
  - `server.js`: las tres funciones de puntuación detectan naturaleza con regex
    `/natur|park|garden|cave|cueva|gruta/` (una cueva famosa pasa de 50 a 74).
    Pasada rápida de Wikipedia 30 → **45** artículos. Proveedor `all` de
    Wikipedia: `gsbbox` (roto) → círculo `gscoord`+`gsradius=10000`.
  - `lib/route-search.js`: nueva `isRouteLandmark(x, {minLanglinks:10,
    minPageviews:8000})` — notabilidad indiscutible por señales de Wikipedia.
  - **Garantía de hitos** en `discoverRouteStops`: tras `selectRoutePlaces(ranked,
    target)` se añaden los candidatos que pasan `isRouteLandmark` y no estaban ya
    incluidos, ordenando por interés. **Sin tope**: la barra de notabilidad es el
    límite. `coverage.landmarks` los cuenta. Coste cero (opera sobre lo ya hallado).
  - **`corridorLandmarks(index)`** (nueva, `server.js`): pasada dedicada y a
    **mejor esfuerzo** que recorre la ruta con geosearch por círculo, cuenta
    idiomas/visitas en lote, filtra por `isRouteLandmark` y trae fichas sólo de
    los pocos hitos. Se ejecuta antes de la búsqueda general para tener prioridad
    en la cola de Wikipedia; si hay cooldown activo espera como mucho ~40 s y si
    no, se salta (los hitos son un extra, no cuelgan la búsqueda). Sus resultados
    entran en el pool de candidatos.
  - Caché `routeStops:v10:` → **`v25:`**.
- **Nuevos invariantes.**
  - Las categorías de naturaleza (`natural*`, cueva, cabo, sierra, cascada)
    puntúan como naturaleza (74), no como el 50 por defecto.
  - Un candidato **ya descubierto** dentro del corredor con `wikiLanglinks ≥ 10`
    o `wikiPageviews ≥ 8000` aparece siempre entre las paradas en ruta (garantía).
- **Limitación conocida (no es un "siempre" absoluto).** El descubrimiento de un
  hito nuevo depende de que Wikipedia no esté limitando el ritmo en ese momento.
  Cuando lo hace, `corridorLandmarks` se salta y sólo actúan el arreglo de
  puntuación y la garantía sobre lo ya hallado. El resultado se **cachea** al
  alcanzar el objetivo, así que a partir de la primera búsqueda satisfactoria de
  una ruta el hito queda fijado. Para un "siempre" real haría falta una lista
  curada de hitos por zona (pendiente).
- **Qué se conserva.** Objetivo `roadKm/4`, filtro de corredor ±10 km, márgenes de
  origen/destino, honestidad de `coverage.outcome`, resto de la búsqueda.
- **Impacto.** La primera búsqueda de cada ruta nueva puede tardar hasta ~40 s más
  si Wikipedia está en cooldown; luego va a caché. Sin proveedores nuevos. Caché
  `routeStops` invalidada.
- **Validación.** `npm test` 46/46 (nueva: `isRouteLandmark`); `node --check
  server.js`; `npm run build`. Verificado contra servidor local que, sin
  rate-limit, `corridorLandmarks` recupera la Cueva de Nerja y ~60 hitos más del
  corredor; con rate-limit el arreglo de puntuación por sí solo ya la sube mucho.

## v1.2.27 — Móvil: la hoja de opciones no tapa el mapa

- **Motivo.** En v1.2.26 las hojas que añaden puntos (Añadir, Comida, Cena,
  Dormir, Planes) ocupaban hasta 86vh con scrim y tapaban el mapa: justo el
  problema que hacía la app poco usable en móvil. Hay que ver el mapa mientras se
  eligen esas opciones.
- **Comportamiento anterior.** `.m-sheet`: `bottom: 0`, `max-height: 86vh`,
  siempre con `.m-scrim` (mapa oscurecido y no interactivo). La barra quedaba
  tapada por la hoja.
- **Comportamiento nuevo.**
  - Las hojas de opción (`route`/`custom`/`lunch`/`act`/`dinner`/`hotel`) van
    **sin scrim**, **por encima de la barra** (`bottom: 78px`, la barra sigue
    visible y permite cambiar de categoría sin cerrar) y a **media altura**
    (`44vh`, «peek»). El asa (`.m-sheet__grab` → `sheetExpanded`) las amplía a
    `80vh` y las vuelve a bajar. Cambiar de tarea reinicia a peek.
  - Sólo `search` e `itin` (`SCRIM_TASKS`) siguen a pantalla completa (`88vh`,
    `bottom: 0`) con scrim — son entrada de formulario / lectura, no exploración
    del mapa.
  - Nuevo `mapBottomInset` (`App.svelte`, px según `winH` y peek/tall) → prop
    `bottomInset` de `MapCanvas` → `map.js` `setBottomInset()` añade ese relleno
    inferior a `fitToRoute()`, de modo que la ruta y los pines quedan en la mitad
    visible del mapa.
  - Con «marcar en el mapa» (`mapPickMode`) la hoja se repliega (`.is-ducked`)
    dejando sólo el asa, para tocar el mapa; se restaura al terminar.
- **Archivos.** `client/src/App.svelte` (estado `sheetExpanded`/`winH`, derivados
  `sheetScrim`/`sheetTall`/`mapBottomInset`, markup del asa y clases
  `is-scrim`/`is-tall`/`is-ducked`, estilos `.m-sheet*`), `MobileBar` sin cambios,
  `client/src/components/MapCanvas.svelte` (prop `bottomInset` + `$effect`),
  `client/src/lib/map.js` (`setBottomInset`, `fitToRoute` con el inset).
  Versión 1.2.27 en los 5 sitios + `App.svelte`.
- **Nuevos invariantes.** En ≤1024 px, elegir paradas/comida/cena/alojamiento/
  actividades no oculta el mapa: la hoja ocupa como mucho media pantalla salvo
  que el usuario la amplíe con el asa; el mapa se reencuadra para no quedar
  detrás de la hoja.
- **Qué se conserva.** Toda la lógica de v1.2.26; escritorio intacto.
- **Validación.** `npm run build` limpio; `npm test` 45/45; `node --check`. La
  carga de opciones no completó en el sandbox (fetch lento de proveedores); el
  cambio es CSS + un derivado y queda pendiente de confirmación en móvil real.

## v1.2.26 — Rediseño móvil map-primary: mapa a pantalla completa + barra + hoja enfocada

- **Motivo.** La versión ≤1024 px (hoja inferior con pestañas Opciones/Itinerario
  que contenía los mismos componentes densos de escritorio) era poco usable: los
  formularios ocupaban casi toda la pantalla y tapaban el mapa. Pedido: rediseño
  completo, muy gráfico, misma funcionalidad, fácil en móvil. Modelo elegido:
  mapa a pantalla completa + botones flotantes por tarea + hoja enfocada a una
  sola categoría.
- **Problema.** Densidad y todo a la vez; el mapa (la superficie principal de la
  app) quedaba relegado en móvil.
- **Comportamiento anterior.** `App.svelte` rama `narrow`: `<section class="sheet">`
  con asa, pestañas **Opciones / Itinerario** y `{@render planContent()}` /
  `{@render itinContent()}` completos dentro. Estado `sheetTab`, `sheetOpen`.
- **Comportamiento nuevo.**
  - Mapa `inset:0` de fondo. Barra flotante inferior `MobileBar.svelte`
    (scroll horizontal, iconos + badges) con las tareas según fase.
  - Store `mobileTask` (`stores.js`): hoja activa; `null` = sólo mapa + barra.
  - Una sola hoja `.m-sheet` (en `App.svelte`) con cabecera (título + ✕), cuerpo
    con scroll y scrim que la cierra. `{#snippet mobileTaskView(task)}` reparte
    el contenido **reutilizando los componentes de escritorio**: `SearchPanel` +
    `BaseResults`, la mini-tarjeta salida+`loadPlan`, hora+`PreferencesBar`,
    `ItineraryPanel`, y `OptionsPanel` con nueva prop `mobile`.
  - `OptionsPanel mobile`: CSS oculta todos los `<details>` salvo el de
    `openOptionGroup`, esconde los `summary` y quita el scroll propio de `.list`.
    El acordeón deja de verse como tal en móvil.
  - Al entrar en móvil sin base, se abre la búsqueda automáticamente (una vez).
  - Un `$effect` en `App.svelte` abre la hoja de la categoría cuyo pin se toca en
    el mapa (`openOptionGroup` → `mobileTask`).
  - Barra de viaje compacta `.m-trip` sobre el mapa cuando hay base.
- **Archivos y funciones.**
  - `client/src/components/MobileBar.svelte` (nuevo).
  - `client/src/lib/stores.js`: store `mobileTask`.
  - `client/src/App.svelte`: rama `narrow` reescrita; snippet `mobileTaskView`;
    `closeSheet`, `SHEET_TITLES`, `$effect` de sync y de auto-apertura; se
    eliminan `sheetTab`/`sheetOpen` y estilos `.sheet*`/`.tabs`/`.handle`; nuevos
    estilos `.m-*`. Import de `fromMin`. Versión visible v1.2.26.
  - `client/src/components/OptionsPanel.svelte`: prop `mobile`, clase `mobile` en
    `.groups`, bloque de estilos móvil.
  - `package.json`, `client/index.html`, `server.js`, `.env.example`,
    `render.yaml`: versión 1.2.26.
- **Nuevos invariantes.**
  - En ≤1024 px el mapa es la superficie principal y siempre visible; la entrada
    de datos vive en hojas de una sola tarea invocadas desde la barra.
  - La funcionalidad es la misma que en escritorio (búsqueda, base, preferencias,
    hora de salida, paradas propuestas y propias, comida/cena/alojamiento,
    actividades, itinerario descargable).
  - La rama de escritorio (>1024 px) no cambia. `narrow` sigue en 1024 px.
- **Qué se conserva.** Motor de plan/itinerario, stores de datos, `selected`/
  `pools`, `MapCanvas`/`map.js`, todos los componentes de contenido (se
  reutilizan). El sync pin↔lista sigue por `groupOfOptionId`/`revealOptionId`.
- **Fallbacks/errores.** Sin geolocalización, «Salgo de» vacío con aviso (igual
  que escritorio). Si `localStorage` no está, tema oscuro.
- **Impacto UI.** Sólo móvil/tablet (≤1024 px): navegación completamente nueva.
- **Impacto APIs.** Ninguno.
- **Compatibilidad.** Sin cambios de datos/caché.
- **Validación.** `npm run build` limpio; `npm test` 45/45; `node --check
  server.js`; captura a 390 px de la pantalla inicial y de la hoja de búsqueda.
- **Limitaciones que permanecen.** La hoja tiene dos alturas fijas, sin arrastre
  libre a media altura. La leyenda del mapa sigue oculta en ≤1024 px.

## v1.2.25 — Comida cerca de las 14:00 y cena cerca de las 20:00, reordenando si hace falta

- **Motivo.** Pedido del propietario: si hay restaurante de comida elegido, la
  parada debe quedar lo más cerca de las 14:00 posible y **siempre antes de las
  15:00** cuando sea alcanzable, aunque haya que cambiar la ruta y el orden de
  las paradas. Igual para la cena con las 20:00 / 21:00. Sin límite inferior.
- **Problema.** La ordenación del día (`orderDay`) sólo minimizaba conducción y
  no tenía noción de la hora. Además el itinerario **forzaba** la comida a no
  empezar antes de las 12:30 (`LUNCH_START`) y la cena antes de las 19:00
  (`DINNER_MIN`), lo que impedía que un restaurante elegido cayera antes.
- **Comportamiento anterior.**
  - `visit()` en `itinerary.js`: `t = Math.max(t, LUNCH_START)` para la comida
    elegida y `t = Math.max(t, DINNER_MIN)` para la cena.
  - `isLunchViable` comparaba contra `LUNCH_END` (14:30).
  - `orderDay(stops, origin, costs)` — coste = sólo conducción.
  - `POST /api/plan/day` no recibía hora de salida ni duraciones.
- **Comportamiento nuevo.**
  - Constantes nuevas en `day-plan.js`: `LUNCH_TARGET=840`, `LUNCH_LIMIT=900`,
    `DINNER_TARGET=1200`, `DINNER_LIMIT=1260` (re-exportadas por `itinerary.js`).
  - `mealTimePenalty(a, target, limit)` en `day-plan.js`: `×0.2` antes del
    objetivo, `×1` entre objetivo y límite, `+10000` pasado el límite.
  - `orderDay(stops, origin, costs, opts)` — 4º argumento opcional. Con `opts`,
    `cost(seq) = conducciónMin + Σ mealTimePenalty(horaLlegadaComida/Cena)`,
    simulando el reloj con `departureMin`, `durationOf` y la matriz (segundos).
    El hill-climb corre siempre que hay `opts`. Sin `opts`: idéntico a antes.
  - `visit()` comida/cena elegidas: se quitan los `Math.max` (sin suelo); aviso
    si `t > LUNCH_LIMIT` / `t > DINNER_LIMIT`. El **bloque reservado** sin
    restaurante mantiene su ventana 12:30–14:30 intacta.
  - `isLunchViable` compara contra `LUNCH_LIMIT` (15:00).
  - `routeDay({..., departureMin, durations})` construye `opts` **sólo si hay
    comida o cena elegida** y lo pasa a `orderDay`. `daySignature` incluye
    `departureMin`/`durations` sólo en ese caso (firma igual byte a byte si no).
    `App.svelte` y `MapCanvas.svelte` mandan ambos en `POST /api/plan/day`.
    Cache key `day:v6:` → `day:v7:`.
- **Archivos y funciones.**
  - `client/src/lib/day-plan.js`: constantes, `mealTimePenalty`, `orderDay(...,opts)`,
    `daySignature({...,departureMin,durations})`.
  - `client/src/lib/itinerary.js`: re-export de constantes; `visit()` comida/cena;
    `isLunchViable`.
  - `lib/day-routing.js`: `routeDay` construye `opts`.
  - `server.js`: cache key `day:v7:`.
  - `client/src/App.svelte`: `durationsMap`, `depMin` en la firma y en `planDay`,
    props a `MapCanvas`.
  - `client/src/components/MapCanvas.svelte`: props `departureMin`/`durations`,
    los pasa al `planDay` del spur.
  - `client/src/components/OptionCard.svelte`: texto del aviso `lateArrival` (15:00).
- **Constantes/límites.** `LUNCH_START` (12:30) y `LUNCH_END` (14:30) sólo para el
  bloque reservado. `DINNER_MIN` (19:00) se conserva exportado pero **ya no se
  aplica**. `DAY_END` (22:30) sin cambios.
- **Nuevos invariantes.**
  - Un restaurante de comida elegido se coloca antes de las 15:00 (objetivo
    14:00) si algún orden válido lo permite; si no, aviso, nunca bloqueo.
  - Un restaurante de cena elegido se coloca antes de las 21:00 (objetivo 20:00)
    con la misma regla.
  - Una comida/cena elegida no tiene hora mínima.
  - Sin `opts`, `orderDay` produce exactamente el mismo orden que antes.
- **Qué se conserva.** Bloque reservado 12:30–14:30 sin restaurante; restricciones
  de `valid()`; DP `optimalOrder` sin tocar; avisos del itinerario; no ocultar
  opciones (v1.2.24).
- **Fallbacks/errores.** Sin `departureMin` en el body → 570 (09:30). Sin duración
  para un id → `item.durationMin` o 60. Matriz `estimated` (OSRM table caído) →
  la simulación horaria usa esa estimación y el día no se cachea.
- **Impacto UI.** Con comida/cena elegida, el orden de las visitas puede cambiar
  respecto al de mínima conducción para cuadrar la hora; cambiar la hora de
  salida recalcula el día (antes sólo recalculaba el itinerario en cliente).
- **Impacto APIs.** El body de `POST /api/plan/day` gana `departureMin` y
  `durations`. Sin proveedores nuevos.
- **Compatibilidad.** Cache `day:` invalidada por el cambio de clave (`v6`→`v7`).
  Sin cambios de formato de datos ni de `selected`/`pools`.
- **Validación.** `npm run build` OK; `npm test` 45/45 (2 regresiones de horario
  actualizadas a los valores nuevos + 5 pruebas nuevas de reordenación, avisos y
  ausencia de suelo); `node --check server.js`.
- **Limitaciones que permanecen.** Para una comida en ruta cuya posición viene
  fijada por el progreso del corredor, si el propio corredor es demasiado largo
  ningún reorden la adelanta: se emite el aviso. El reordenado mueve paradas
  `route`/`activity`, no el propio punto de comida entre hotel y actividades.

## v1.2.24 — Modo oscuro por defecto, origen por geolocalización y ninguna opción oculta

- **Motivo.** Puesta en producción (Render, `dailytrip.onrender.com`) y tres
  ajustes de arranque pedidos por el propietario del producto.
- **Problema.** (1) La app arrancaba en tema del sistema; se quiere oscuro por
  defecto. (2) «Salgo de» venía con un valor fijo («Málaga»); se quiere la
  localidad real del usuario. (3) «Destino orientativo» venía con «Almería».
  (4) La sección «Actividades en destino» ocultaba las opciones que harían
  terminar el día después de las 22:30 y mostraba «N harían terminar después de
  las 22:30»; se quiere que **nunca** se oculte ninguna opción en ninguna
  sección, sólo avisos.
- **Comportamiento anterior.**
  - `theme` por defecto `"system"` (`stores.js`).
  - `SearchPanel.svelte`: `origin = "Málaga"`, `target = "Almería"`.
  - `OptionsPanel.svelte`: `visibleActivities` filtraba `pools.activities` con
    `hiddenActivityIds` (salvo las ya seleccionadas) y pintaba un contador de
    ocultas. `App.svelte` calculaba `hiddenActivityIds`.
- **Comportamiento nuevo.**
  - `theme` por defecto `"dark"`. `client/index.html` incluye un script en
    `<head>` que fija `data-theme` antes de pintar (evita el flash claro) según
    `localStorage["tp-theme"]`, con `"dark"` como valor por defecto. Se sigue
    respetando la elección previa guardada; el botón sigue ciclando
    Oscuro → Auto → Claro.
  - `SearchPanel.svelte`: `origin` y `target` arrancan vacíos. En `onMount`, si
    `navigator.geolocation` está disponible, se pide la posición y se convierte
    a nombre de localidad con `POST /api/geocode {lat,lon}` (reverse geocode ya
    existente). Nunca sobrescribe lo que el usuario haya escrito
    (`originTouched`); si falla o se deniega, el campo queda vacío con un aviso.
  - `OptionsPanel.svelte`: se elimina `visibleActivities` y el contador de
    ocultas. Las actividades se listan todas; `App.svelte` renombra
    `hiddenActivityIds` → `lateActivityIds` (misma fórmula, `end > DAY_END`) y se
    pasa como `lateFinish` a `OptionCard`, que muestra un aviso análogo al de
    `lateArrival` de comida.
- **Archivos y funciones afectadas.**
  - `client/src/lib/stores.js`: valor inicial de `theme`.
  - `client/index.html`: script anti-flash de tema; `<title>` a 1.2.24.
  - `client/src/components/SearchPanel.svelte`: estado inicial, `onMount` con
    geolocalización, placeholders, aviso de fallo.
  - `client/src/App.svelte`: `hiddenActivityIds` → `lateActivityIds`; prop a
    `OptionsPanel`.
  - `client/src/components/OptionsPanel.svelte`: sin `visibleActivities` ni
    contador; `{#each pools.activities}` con `lateFinish`; CSS `.hint` retirado.
  - `client/src/components/OptionCard.svelte`: prop `lateFinish` + aviso.
  - `server.js`, `package.json`, `.env(.example)`, `render.yaml`: versión 1.2.24.
- **Constantes/límites.** Sin cambios. `DAY_END = 1350` (22:30) y la ventana de
  comida 12:30–14:30 siguen igual; sólo dejan de filtrar y pasan a avisar.
- **Nuevos invariantes.**
  - Ninguna sección de opciones (paradas personalizadas, paradas en ruta,
    comida, actividades, cena, alojamiento) oculta una opción por horario,
    apertura o llegada/fin tardío. Todas son siempre seleccionables.
  - El tema por defecto es oscuro salvo elección explícita guardada.
- **Qué se conserva.** Cálculo de viabilidad (`approximateSchedule`,
  `isLunchViable`), avisos del itinerario, botón de tema y su persistencia,
  sección de comida ya no-filtrante desde v1.2.18.
- **Fallbacks/errores.** Sin geolocalización disponible, permiso denegado o
  reverse geocode fallido: «Salgo de» queda vacío + aviso; el usuario escribe la
  ciudad. Si `localStorage` no es accesible, el script de tema aplica `"dark"`.
- **Impacto UI.** Arranque en oscuro; «Salgo de» puede pedir permiso de
  ubicación y autocompletarse; ambos campos de búsqueda vacíos al inicio; la
  lista de actividades ya no encoge y las inviables llevan aviso en la ficha.
- **Impacto APIs.** Una llamada extra a `POST /api/geocode` (reverse, Nominatim)
  por carga inicial cuando hay geolocalización. Sujeta al rate-limit de
  Nominatim ya existente.
- **Compatibilidad.** `localStorage["tp-theme"]` previo se respeta. Sin cambios
  de caché ni de formato de datos.
- **Validación.** `npm run build` OK; `npm test` 40/40; `node --check server.js`.
- **Limitaciones que permanecen.** La geolocalización exige HTTPS (cumplido en
  Render y localhost). El reverse geocode devuelve el núcleo poblado más
  cercano, que puede no ser exactamente donde está el usuario.

## v1.2.23 — Paradas personalizadas colapsables y scroll general del rail izquierdo

- **Paradas personalizadas dentro del acordeón.** Desde v1.2.19 era una sección
  siempre abierta entre las preferencias y «Paradas en ruta». Ahora es un
  `<details class="custom-section">` más del acordeón `.groups`
  (`OptionsPanel.svelte`): arranca colapsada, comparte el store `openOptionGroup`
  con el resto (abrir cualquier otra la cierra y viceversa) y usa el mismo
  `toggle()`. Paridad visual: la flecha `▸` rota 90° al abrir y el `summary`
  abierto lleva borde inferior — las reglas `.group[open] summary::before` y
  `.group[open] summary` se ampliaron con el selector `.custom-section[open]`.
  Sigue siendo la primera sección de `.groups`, antes de «Paradas en ruta»; el
  grupo de navegación/mapa sigue siendo `custom`. No cambia el alta por
  nombre/mapa, la selección, la duración editable, el borrado ni el motor de
  ruta/horario.
- **Scroll general del rail izquierdo (escritorio).** La barra de scroll del
  contenedor que abarca todas las secciones (`.rail--left .rail__scroll`) no se
  podía arrastrar: con `scrollbar-width: thin` el navegador usa una barra fina
  sin canal reservado, y las tarjetas hijas (`pointer-events: auto`, necesario
  para que los huecos dejen pasar el ratón al mapa) llegaban hasta el borde y
  tapaban el pulgar de la barra. `document.elementFromPoint` sobre la franja de
  la barra devolvía la tarjeta, no el contenedor. La rueda del ratón sí
  funcionaba; los scrolls internos de cada sección (`.list`, `max-height: 58vh`)
  también. Arreglo puramente CSS: `scrollbar-gutter: stable` en `.rail__scroll` y
  en `.sheet__body` (hoja móvil, por paridad). Reserva 10 px de canal que las
  tarjetas ya no invaden (borde derecho del hijo más ancho x=368 vs interior
  x=370); la franja de la barra vuelve a pertenecer al contenedor y se puede
  arrastrar.
- **Archivos.** `client/src/App.svelte` (`.rail__scroll`, `.sheet__body`,
  etiqueta de versión), `client/src/components/OptionsPanel.svelte` (dos
  selectores CSS ampliados a `.custom-section[open]`),
  `scripts/regression-ui.mjs` (la sección personalizada ya no está siempre
  abierta: helper `openCustom()` que la despliega antes de usarla; selector
  `.group:first-of-type` → `.group[data-category="route"]` porque
  `.custom-section` es ahora el primer `<details>` de `.groups`).
- **Compatibilidad.** Sólo CSS y selectores de prueba. Sin cambios de backend,
  proveedores, cachés, contratos de API ni motor de itinerario. Sin nuevas
  dependencias.
- **Validación.** `node --check server.js` OK. `npx vite build` limpio.
  `npm test` 40/40. `npm run test:ui` OK (incluye que la sección personalizada
  es colapsable y su alta/selección/timeline siguen bien). Diagnóstico de
  navegador: `elementFromPoint` sobre la franja de la barra devuelve
  `.rail__scroll` (antes `.card--flush`); rueda y scrolls internos intactos;
  acordeón de `custom` abre/cierra en exclusión mutua con el resto y la flecha
  rota.

## v1.2.22 — Tiempos completos entre visitas alrededor de la comida

- **Causa reproducida con datos del caso del usuario.** Las coordenadas de los estadios de la Cerámica (39.9442083, -0.1034046) y Castalia (39.9961404, -0.0386377) eran correctas. OSRM y la caché del plan devolvían 11 min y 9,6571 km entre ambos. La salida a las 09:30, 164 min hasta Cerámica y 45 min de visita colocaban el siguiente desplazamiento a las 12:59. `buildItinerary.drive` lo partía al llegar a las 13:00: 1 min de conducción, 85 min de comida reservada y otros 10 min. No era un error de geocodificación ni una conversión de unidades; se presentaba un fragmento como desplazamiento sin explicar el total.
- **Nuevo comportamiento común a todas las visitas.** Sin restaurante elegido, si un desplazamiento que cruza las 13:00 termina antes de las 14:30 inclusive, se realiza entero y se reserva la comida al llegar, antes de la visita. Si termina más tarde y ya son las 12:30 o más, se reserva la comida antes de salir y se realiza entero después. Se conservan las ventanas existentes (12:30–14:30), la duración de comida de 85 min y los tiempos de carretera.
- **Viajes largos.** Sólo se mantiene la partición para viajes iniciados antes de las 12:30 que no pueden terminar antes de las 14:30. Cada fragmento lleva `journeyDurationMin`, origen y destino, etiqueta antes/después de comer y muestra el total de conducción con la pausa aparte. No se inventa un restaurante ni un punto geográfico para esa reserva temporal; sigue siendo un bloque a concretar por el usuario.
- **Interfaz y exportación.** TimelineRow muestra el total del viaje cuando está partido. La descarga del itinerario incorpora minutos de cada desplazamiento y el total cuando corresponde. No cambia el recorrido, la selección de localidad, la ordenación, el hotel final ni la comida explícitamente seleccionada.
- **Archivos/compatibilidad.** `client/src/lib/itinerary.js`, `TimelineRow.svelte`, `ItineraryPanel.svelte`, pruebas de día, regresión y navegador. Campos de evento adicionales compatibles; sin nuevos proveedores, constantes de velocidad, dependencias o invalidación de caché de carreteras (los datos eran correctos).
- **Validación.** 40 pruebas: reproducción exacta Cerámica→Castalia con 11 min en una sola fila, tanto custom como propuesta, comida a las 13:10 y conducción total conservada; salida de viaje largo durante la ventana de comida; partición de 400 min con total explícito y sin solapamientos. Navegador: salida a las 12:59 conserva un desplazamiento completo, sin fragmento artificial de 1 min, y pasan los flujos existentes. Consulta real de geocodificación y OSRM confirma los dos estadios y sus 11 min/9,6571 km. Compilación de producción.

## v1.2.21 — Recorrido global y propuestas adaptadas al nuevo camino

- **Problema y causa.** La geometría del día ya enlazaba visitas reales por carretera, pero las búsquedas de paradas/comida, los kilómetros de la cabecera y el hover seguían vinculados a la ruta directa original. Las métricas comparaban origen→opción→destino omitiendo las demás visitas. La caché de comida en ruta sólo distinguía extremos y podía recuperar restaurantes del camino anterior.
- **Ruta activa.** Nuevo store `activeRoute` y módulo `client/src/lib/active-route.js`: una respuesta completa de carretera alimenta geometría, kilómetros y duración del recorrido activo y un contexto de selección reducido a campos de cálculo. `routeData` conserva la referencia original/origen; `chosen` conserva siempre la localidad elegida. Se mantienen el centro virtual cuando hay visitas de destino y el alojamiento como cierre del día.
- **Optimización.** `optimal-order.js` resuelve exactamente el orden de menor coste dirigido hasta 12 nodos (incluidos base virtual y regreso al hotel), mediante programación dinámica por subconjuntos, último punto físico y precedencias. El centro virtual no añade coste ni desplaza el último punto físico. Se preservan orden de comidas/check-in, actividades después de la base virtual y visitas de ruta intercalables (personalizadas o propuestas, sin obligarlas a preceder a las actividades), destino terminal cuando procede y alojamiento final. Con más de 12 nodos se conserva la mejora iterativa por reinserciones, sin garantía de óptimo matemático. Empates mantienen el orden inicial. El objetivo es tiempo de conducción, no tráfico en directo ni ventanas horarias dinámicas de proveedores.
- **Carreteras y métricas.** `lib/road-matrix.js` comparte matrices dirigidas por bloques de 20, con validación y respaldo íntegro estimado si falla alguna celda. `lib/route-option-metrics.js` compara el plan completo con y sin cada propuesta y conserva todas las visitas elegidas; calcula distancia/tiempo extra y distancias acumuladas a la visita. Las opciones ya seleccionadas no añaden un segundo ejemplar. `/api/metrics/route-options` conserva su contrato y recibe opcionalmente `route.plan`. No se añaden puntos de retorno a la carretera inicial a las peticiones de ruta.
- **Renovación del catálogo.** Cada resultado válido actualiza la ruta mostrada y sus métricas. Se renuevan paradas y comida en ruta si cambia el objetivo mínimo derivado de km/4 o si la geometría se aleja más de 2 km del último corredor consultado, comprobando ambos sentidos con muestras cada 2 km. Comparar con el último catálogo acumula cambios pequeños. La búsqueda espera 600 ms; el cálculo del día espera 250 ms. Se conserva lo seleccionado, se retiran propuestas del corredor anterior y se vuelve a buscar/rankear con los proveedores existentes. Actividades, comida y alojamiento de la localidad no se recargan por cambiar la carretera.
- **Concurrencia y errores.** Generación del plan, época de corredor y secuencia de métricas impiden sobrescrituras de respuestas antiguas. Un fallo del nuevo corredor conserva las selecciones y ofrece reintento, sin presentar candidatos del camino abandonado como resultados actuales. Una ruta estimada/incompleta no dispara descubrimiento sobre líneas inventadas. Cambios de duración o enriquecimiento editorial no generan otro cálculo de carretera si la firma de visitas permanece igual.
- **Mapa/UI.** Cabecera con km del día, corredor activo y marcadores conservados al redibujar; se elimina la superposición del corredor anterior cuando hay geometría del día. La previsualización de una propuesta usa el plan completo más esa visita, con espera de 400 ms y sin fallback rectilíneo. Altas custom usan la ruta activa para sus métricas iniciales.
- **Compatibilidad/caché.** Día `day:v6`; comida en ruta `routeLunch:v3` con hash de toda la geometría y destino. Se conservan cachés previas sin reutilizarlas para estos contratos. No se añaden proveedores, claves o dependencias. Archivos principales: App, MapCanvas, OptionsPanel, stores, map, day-plan, los cuatro módulos nuevos y server.
- **Validación.** 38 pruebas: corredor nuevo y reversión, cambios irrelevantes, métricas con visitas obligatorias/sentidos de circulación, peticiones de carretera sin retornos artificiales, comparación del óptimo contra todas las permutaciones de cinco visitas en 12 matrices dirigidas, regresiones de destino/hotel/comidas y propuestas normales intercaladas con actividades igual que las custom. Navegador: alta normal/custom, ruta con punto lejano, km actualizados, renovación de ambos catálogos, selección conservada, quitar la visita y recuperar las propuestas, respuesta retrasada descartada y flujo móvil. Compilación de producción sin avisos. Integración real con OSRM: Málaga→Granada→Almería, 285 km y 5049 puntos de geometría, destino conservado; la visita ya elegida añade cero y un punto cercano a Granada añade 2 minutos/0,9 km manteniendo todo el recorrido.

## v1.2.20 — La parada personalizada no sustituye el destino

- Causa reproducida: `orderDay` podía mover una visita custom después de una base inicialmente terminal. Al quedar intermedia, `real()` eliminaba la base y el coste bajaba artificialmente por omitir el desplazamiento a la localidad elegida. El estado `chosen` no cambiaba, pero sí desaparecía la llegada del recorrido, mapa y horario.
- Nuevo invariante: si la base es terminal en `dayStops`, permanece terminal durante toda la optimización; las paradas personalizadas se ordenan antes de ella. Se aplica tanto a costes de carretera como al respaldo geográfico, en cliente y servidor.
- Se conserva la eliminación del centro intermedio cuando existen actividades, comida en destino, cena o alojamiento; las visitas manuales siguen pudiendo intercalarse entre esas visitas y el alojamiento sigue cerrando el día. No cambia la selección de localidad ni las APIs externas.
- Archivos: `client/src/lib/day-plan.js`, pruebas `scripts/day-plan.test.mjs` y `scripts/regression-ui.mjs`. Caché del día `day:v4` para evitar recuperar secuencias antiguas. Sin cambios en otras cachés ni en el tratamiento de errores.
- Validación: caso reproducido fallando antes del arreglo; 33 pruebas de regresión, incluyendo visitas antes, después, coincidentes y en dirección opuesta al destino. Prueba de navegador de alta personalizada sin actividades y conservación de la llegada a Almería y su marcador. Compilación y flujo de interfaz completo.

## v1.2.19 — Sección independiente de paradas personalizadas

- La búsqueda por nombre y el modo de marcar puntos en el mapa se trasladan a «Paradas personalizadas», sección siempre visible entre las preferencias «Qué te apetece hoy» y el acordeón «Paradas en ruta».
- Las fichas personalizadas también se muestran en esa sección, con selección, duración editable y eliminación. Dejan de duplicarse y contarse entre las propuestas de ruta.
- El grupo de navegación/revelado desde el mapa es `custom`. Se conserva el estado interno compatible con el motor de ordenación: el carácter `custom` permite situar el lugar antes o después del destino y entre las visitas. El hotel sigue cerrando el día cuando se selecciona.
- No se modifica el motor de ruta/horario. Validación: 32 pruebas existentes y prueba de navegador que comprueba posición de la sección, ausencia de formulario dentro del acordeón, alta por nombre, selección automática, aparición en el horario y mantenimiento del recuento de propuestas en ruta.

## v1.2.18 — Restaurantes visibles y seleccionables, horarios sólo informativos

- La sección Comida mostraba el total del catálogo en el título pero filtraba filas mediante `isLunchViable`. Ese filtro mezclaba `lunchOpening=false` (horario publicado) con llegar después de las 14:30 (estimación del itinerario); de ahí el mensaje engañoso «no llegan a tiempo».
- Se muestran todas las opciones contadas en el título. No se ocultan ni se impide seleccionarlas por apertura ni por llegada tardía. Desaparece el recuento de opciones ocultas.
- `isLunchViable` sólo evalúa la hora estimada del viaje; ya no rechaza por `lunchOpening=false`. Su resultado alimenta un aviso en la ficha, nunca un filtro de comida. La llegada tardía seleccionada sigue teniendo aviso en el itinerario.
- Las fichas de comida/cena muestran que el local podría estar cerrado y recomiendan confirmar el horario. Cuando el horario publicado no cubre la comida se indica expresamente, sin bloqueo. Los horarios detallados siguen disponibles.
- Validación: 32 pruebas de regresión, incluida selección de un restaurante con horario exclusivamente nocturno. Prueba de navegador: restaurante posiblemente cerrado y otro lejano permanecen visibles, el contador coincide y el restaurante cerrado se selecciona desde el mapa.

## v1.2.17 — Ruta de referencia y tolerancia respecto al destino

Esta versión sustituye el antiguo modelo de distancia ideal ± tolerancia.

- El formulario sólo pide origen, destino orientativo y tolerancia (0–300 km). Se elimina `desiredKm`, el campo de distancia ideal, el símbolo ± y las diferencias respecto a un kilometraje ideal.
- `/api/search/context` calcula la ruta completa origen → destino orientativo y devuelve `referenceRoute`. Esa ruta aparece en el mapa durante la búsqueda. No rechaza trayectos por estar por debajo o por encima de un kilometraje solicitado.
- La tolerancia se interpreta como distancia máxima **por carretera desde el destino orientativo hasta cada candidato**, no como distancia desde el origen ni como radio en línea recta. Se indica expresamente en el formulario y en los resultados. Cero propone únicamente el destino orientativo.
- `/api/search/candidates` recibe `origin`, `target`, `toleranceKm`. Descubre localidades alrededor del destino, pagina Geoapify y utiliza OSM si no está configurado. Incluye siempre el destino orientativo. Refina coordenadas antes de medir distancias. Se usan lotes de 20 sin truncar la lista antes de validar y puntuar.
- `lib/base-search.js` valida el límite con la distancia sin redondear y calcula por separado el viaje desde el origen. Las tarjetas muestran ambos valores: kilómetros del viaje y distancia al destino orientativo. Se mantiene el ranking por interés y se informa si la búsqueda del proveedor fue incompleta.
- Al elegir una localidad, las opciones del día siguen la ruta real origen → localidad elegida; desvíos, horarios y km totales no dependen de ningún valor ideal. El objetivo de paradas es aproximadamente una cada 4 km reales, con al menos una para un trayecto positivo, en vez del antiguo mínimo fijo de 12. En trayectos cortos el margen de exclusión de los extremos se reduce proporcionalmente. Sin desplazamiento, paradas y comida en ruta devuelven listas vacías válidas.
- Caché de paradas: `routeStops:v10`, para aplicar los objetivos y márgenes nuevos. La tolerancia sólo selecciona localidades; no se utiliza como longitud del viaje ni como radio de búsqueda de sus actividades.
- Validación: 31 pruebas unitarias/regresión; tolerancia desde destino independiente de 15/900 km desde origen, límite exacto antes del redondeo, tolerancia cero, valores inválidos, lotes de 45 localidades y objetivos para rutas cortas. Navegador: ausencia del campo ideal, contrato API nuevo y flujo completo con mapa/selecciones/alojamiento. Compilación sin advertencias.
- Prueba real: ruta de referencia Málaga → Almería de 201,8561 km; tolerancia 0 devuelve Almería, a 0 km del destino orientativo, con viaje de 202 km desde origen. Con tolerancia 40 se obtienen ocho propuestas válidas; por ejemplo Roquetas de Mar a 21,3 km de Almería (186 km desde Málaga) y Viator a 8,2 km de Almería (209 km desde Málaga). Consulta completa en 53,3 s.

## v1.2.16 — Comida protegida, regreso al hotel y selección contextual en mapa

- Con comida elegida (o al evaluar un candidato de comida), el check-in se sitúa después de comer. Una duración larga del check-in no invalida por sí sola un restaurante al que se puede llegar a tiempo antes del hotel. Sin restaurante elegido, se admite check-in temprano; si supera la ventana de comida, se reserva primero el bloque de comida y se demora el check-in.
- El alojamiento seleccionado cierra siempre la secuencia física. Se añade `hotelReturn` tras actividades/cena, con ruta y tiempo de conducción, pero duración de visita cero: no repite check-in. Si el check-in ya es la última parada, no se duplica la llegada.
- El optimizador permite el regreso al alojamiento después de cenar y prohíbe insertar visitas después de ese regreso. La caché de rutas del día pasa a `day:v3`.
- Al pulsar un restaurante en el mapa, se asigna a la sección de comida/cena que esté desplegada y se mantiene esa sección abierta. La selección anterior para la otra comida no cambia el contexto. Se conserva el carácter en ruta/destino al seleccionar comida.
- Validación: 29 pruebas, incluidas check-in temprano/tardío, viabilidad con check-in de 600 minutos, retorno real con tiempo de conducción sin repetir estancia y selección contextual. Prueba de navegador pulsa el mismo restaurante para cena y comida y comprueba llegada final al hotel.

## v1.2.15 — El destino sólo es parada si termina el recorrido

- La llegada genérica al centro de la localidad desaparece cuando hay cualquier parada posterior: actividad, comida en destino, cena, alojamiento o parada manual. Si queda al final, se conserva.
- La base se usa únicamente como frontera lógica de ordenación. El coste del optimizador omite su paso cuando no es terminal; por tanto no altera ni el orden eficiente ni la geometría ni los tiempos. OSRM recibe directamente los lugares útiles.
- Horario, estimación provisional, viabilidad, exportación y mapa usan la misma secuencia sin reinsertar la llegada. Se ocultan el marcador de base y el corredor directo al centro cuando la base no pertenece al recorrido real.
- La caché de rutas del día pasa a `day:v2` para no recuperar trayectos antiguos.
- Validación: 26 pruebas unitarias/regresión, incluyendo destino terminal, cada categoría posterior, parada manual, centro alejado sin influencia en el coste y petición de carretera sin ese centro. Prueba de navegador comprueba ausencia de marcador y fila de llegada; compilación sin advertencias. Versión disponible en localhost:3000.

## v1.2.14 — Ruta completa, fichas documentadas y selección por interés y tamaño

Esta entrada sustituye las reglas históricas incompatibles de mapa, orden, cupos y fuentes de destino. Fecha: 2026-09-09.

- **Mapa y horario unificados.** `/api/plan/day` proporciona una sola secuencia de visitas, tramos, geometrías y tiempos. Incluye origen, paradas, llegada, actividades, comida, hotel y cena. Desaparecen las líneas rectas de destino. Todos los marcadores de opciones muestran el nombre al señalar o seleccionar; origen y base tienen etiqueta permanente.
- **Orden eficiente.** `client/src/lib/day-plan.js` aplica mejora por reinserción con costes dirigidos de la matriz OSRM: nunca empeora la secuencia inicial; es una heurística, no una garantía de óptimo global. Las visitas ordinarias en ruta quedan antes de la base; las actividades, después; las paradas manuales pueden insertarse en cualquier posición, incluso después de las actividades. Comida, llegada, check-in y cena mantienen su orden relativo y no se colocan visitas después de la cena. El nombre buscado manualmente ya no se sustituye por una localidad preferente ni se desplaza al centro urbano.
- **Carreteras reales y fallos explícitos.** `lib/day-routing.js` consulta matrices en bloques y rutas en lotes de 20 puntos con solape. No trunca selecciones largas. Si falla un lote, sus tiempos son estimados y su geometría no se dibuja como una carretera. La interfaz muestra cálculo, error y reintento, km y minutos totales, avisos de accesos alejados de la carretera y descarga TXT del itinerario. Los tiempos son de conducción sin tráfico en directo; el último acceso a pie no está enrutado. La duración de visita es editable. Las visitas tempranas ya pueden realizarse antes del bloque de comida reservado.
- **Información bajo demanda.** `/api/place/content` amplía al abrir/seleccionar una ficha, con cola de dos peticiones desde el cliente. Consulta Wikipedia en español/inglés, Wikidata (imágenes P18, web P856, galería P373) y Wikimedia Commons (autor/licencia/enlace de cada foto). Puede mostrar varias fotografías y una introducción más completa. Primero aprovecha Place Details para objetos Geoapify. Sin referencia explícita se exige coincidencia de nombre y proximidad; no se atribuye al lugar el artículo de cualquier sitio cercano. Las fuentes no disponibles se reintentan; la ausencia de coincidencia se indica como información limitada. Las imágenes rotas dejan de mostrarse. Enlaces a web, galería y cómo llegar.
- **Escala de destino.** `lib/destination-options.js` obtiene objetivos por población municipal de Wikidata, usando la observación temporal más reciente. Si falta, usa el tipo de localidad y lo declara estimado. Radio y cupos:

  | Habitantes | Radio km | Actividades | Comida/cena | Alojamiento |
  | --- | ---: | ---: | ---: | ---: |
  | Hasta 2.000 | 1,5 | 12 | 10 | 6 |
  | Hasta 10.000 | 2,5 | 20 | 16 | 10 |
  | Hasta 50.000 | 4 | 35 | 28 | 18 |
  | Hasta 250.000 | 7 | 65 | 52 | 33 |
  | Hasta 1.000.000 | 10 | 110 | 88 | 55 |
  | Más de 1.000.000 | 16 | 180 | 144 | 90 |

  Los radios son aproximaciones al entorno de la localidad, no polígonos administrativos. Son objetivos de oferta; no se inventan lugares para llenarlos.
- **Puntuar antes de recortar.** Destino consulta Wikipedia, Geoapify y OSM; Google es opcional si está configurado. Geoapify se pagina; Wikipedia subdivide cajas saturadas. Se deduplica y puntúan todos los candidatos obtenidos antes del cupo. Ruta ya no usa cuotas geográficas que expulsen lugares más interesantes: conserva los mejores por el mismo `interestScore` que muestra la interfaz. La comida en ruta también pagina y recorta después de puntuar. Las preferencias ordenan por interés ajustado, no por el menor desvío. Los datos complementarios de duplicados se conservan. Se mantienen opciones ya elegidas aunque un reintento cambie el ranking.
- **Alcance del ranking.** “Mayor interés” significa mayor puntuación entre los lugares obtenidos y elegibles, con las señales disponibles (tipo, relevancia, documentación, fiabilidad y preferencias en pantalla); no es una valoración objetiva de todos los lugares existentes. La búsqueda de ruta sigue ampliando hasta su mínimo o agotamiento comprobado (v1.2.13). En destino se informa objetivo, candidatos y población. Un fallo de fuente implica selección incompleta; nunca equivale a ausencia real de lugares. El reintento parcial conserva e incorpora los mejores resultados disponibles.
- **Rendimiento y continuidad.** Las categorías aparecen progresivamente. La ampliación editorial no bloquea cientos de candidatos antes de ofrecer las paradas. Peticiones simultáneas idénticas de día, destino y contenido se agrupan; Wikimedia usa cola, reintentos espaciados y una pausa de consultas al recibir HTTP 429, para no multiplicar los fallos ni bloquear todas las búsquedas. La caché deja de reescribir decenas de MB por cada ficha: agrupa escrituras y sustituye el archivo de forma atómica. Cachés nuevas: `day:v1`, `placeContent:v1`, `locality:v1`, `content:v8`, `routeStops:v9`, `routeLunch:v2`; no se borran los datos anteriores.
- **Diseño.** Usuario: viajero que necesita elegir visitas viables y reconocerlas en el mapa. Dominio: carretera, parada, visita, comida, alojamiento, tiempo. Paleta existente: arena, terracota, ámbar, verde y tinta. Firma: recorrido sobre mapa con itinerario temporal enlazado. Se mantienen tokens y paneles cálidos; se sustituye el dashboard de métricas por un resumen del viaje, los detalles técnicos por estados comprensibles y las fotos decorativas por imágenes documentadas. Verificación visual de escritorio y móvil.
- **Validación.** `npm test` incorpora pruebas de orden dirigido, manuales tras el destino, comidas/check-in, secuencias largas y fallos, identidad/atribución de contenido, escala de población, recorte por máximo interés y recuperación parcial. `npm run test:ui` comprueba 50 paradas, reintentos, selección, duraciones, etiquetas de nombres, ruta y móvil. `scripts/smoke.mjs` comprueba el flujo real Málaga–Almería. Compilación sin advertencias.
- **Comprobaciones externas.** Wikidata: Frigiliana 3.383 habitantes → objetivo 20; Almería 205.468 → 65. En una consulta parcial Frigiliana aportó 11 lugares y Almería 49; se indicaron los fallos de proveedor. Alcazaba de Almería: introducción de 1.967 caracteres y dos fotos con metadatos de Commons. No confundir estos resultados puntuales con inventarios completos.
- **Fuentes técnicas verificadas.** [OSRM](https://project-osrm.org/docs/v26.6.1/http), [GeoSearch](https://www.mediawiki.org/wiki/API:Geosearch), [TextExtracts](https://www.mediawiki.org/wiki/Extension:TextExtracts), [Wikibase](https://www.mediawiki.org/wiki/Wikibase/API), [Imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo). Las integraciones Wikimedia no requieren una clave de pago.

## v1.2.13 — Objetivo mínimo efectivo de paradas y agotamiento comprobado

1. **Versión/motivo.** 1.2.13. El usuario exige que la oferta sólo quede por
   debajo del mínimo cuando no se puedan obtener más opciones reales. La entrada
   de caché Málaga→Almería contenía 11 paradas (5 Wikipedia + 6 Geoapify), mientras
   que el objetivo rondaba 50. No era un recorte de la interfaz.
2. **Causas anteriores.** `targetStops` era únicamente un máximo de una pasada.
   Las cuotas por familia, arranque de nombre y distancia entre lugares podían
   descartar visitas distintas. El muestreo por índice de vértice no equivalía
   a kilómetros. La caché de 14 días aceptaba 6 ítems con cualquier éxito Wikipedia.
3. **Nuevo contrato.** Se mantiene `max(12, round(roadKm/4))`, sin máximo global.
   `coverage.outcome` distingue `target-reached`, `sources-exhausted` e
   `incomplete`. Una búsqueda bajo el objetivo sólo es completa si se han agotado
   todas las zonas y fuentes configuradas, sin errores ni truncamientos.
   Un fallo de conexión, cuota o límite irresoluble es búsqueda incompleta;
   nunca prueba de que no existan más sitios. «Agotado» se refiere a las fuentes
   consultadas y al corredor definido, no a demostrar ausencia universal de POI.
4. **Cobertura geográfica.** Nuevo `lib/route-search.js`: longitudes acumuladas
   con Haversine, interpolación por distancia y centros cada ≤10 km a lo largo
   de todo el trazado, sin techo de 16 centros. Proyección al segmento más
   cercano, usando todos los segmentos, para progreso y distancia al corredor.
   Círculos de 15 km alrededor de esos centros cubren el corredor de ±10 km.
   Wikipedia ampliada usa cajas que contienen esos círculos. Se conserva la
   exclusión de los primeros/últimos 6 km en distancia al origen/base; desaparece
   el corte adicional por porcentaje 6–93 que quitaba lugares válidos.
5. **Ampliación automática.** Primera pasada Wikipedia (30 artículos por centro,
   radio 10 km) + Geoapify (40 por centro, 15 km), de dos consultas en paralelo,
   con pausas. Se completa esa pasada para repartir geográficamente. Si faltan
   opciones, continúa por zonas con Wikipedia completa, Geoapify paginado,
   Overpass y Google si está configurado. Tras cada página se comprueba el mínimo;
   se deja de ampliar cuando se alcanza. Las consultas no se paran por una cuota
   arbitraria de páginas o lugares recolectados.
6. **Paginación/límites externos.** Geoapify ampliado consulta categorías
   `tourism, entertainment, heritage, leisure, natural, beach`, páginas de 100
   con `offset` hasta una página bruta menor de 100. El fin se calcula ANTES de
   filtrar; una página repetida es error, no fin. Wikipedia permite 500 por caja:
   una caja saturada se divide en cuatro y se siguen todas las subcajas, sin el
   anterior corte de 120 fichas para esta vía. Hay caché de fichas por artículo
   durante la búsqueda para evitar repetir enriquecimientos. Google se subdivide
   al saturar sus 20 resultados. Si se llega a precisión espacial <0,00001 grados
   aún saturado, se marca incompleto. Overpass usa 15 km, hasta 2 endpoints y 5 s
   por endpoint, sólo en la ampliación; `remark` o respuesta sin `elements` no
   se acepta como consulta completa.
7. **Selección/deduplicación.** Fuera coordenadas inválidas, resultados generados,
   entidades de población y resultados Geoapify sin nombre propio de lugar.
   Fuera del corredor no se añaden visitas para rellenar. Sólo se fusionan mismo
   ID, misma URL Wikipedia o mismo nombre normalizado a menos de 150 m. La mera
   proximidad de nombres distintos ya NO fusiona. La ronda por tramos de 5 % y
   el interés determinan orden/preferencia, pero no hay cupos de familia, límites
   de playas ni descartes por compartir las dos primeras palabras del nombre.
   Ausencia de imagen o descripción no elimina un POI real de categoría turística;
   se intenta enriquecer todas las opciones elegidas, en lotes de 4 como antes.
8. **Caché.** Clave `routeStops:v8:` + hash SHA-256 abreviado de geometría completa,
   destino y objetivo. Evita confundir rutas alternativas de los mismos extremos.
   Sólo se persisten resultados que alcanzan el objetivo, con `coverage` completo.
   Los resultados escasos, aunque agotados, no se guardan 14 días: volver a buscar
   vuelve a consultar. Peticiones concurrentes del mismo recorrido comparten la
   búsqueda en curso. Entradas v7 se ignoran sin borrar otras cachés.
9. **Fallos/respaldo.** Se registra qué fuente y zona no pudo completarse.
   Se conservan lugares reales obtenidos aunque falle otra consulta. Si no hay
   ninguno y la búsqueda es incompleta, se intenta caché v8 antigua y luego
   paradas libres generadas; estas últimas no cuentan para alcanzar el objetivo.
   Cero real tras agotamiento no se rellena con lugares inventados.
10. **Interfaz.** El bloque de paradas muestra cantidad/objetivo y si se ha
    alcanzado, agotado fuentes o quedado incompleto. En los dos últimos casos
    permite reintentar; un fallo no se muestra como falta real de lugares.
    En reintentos parciales conserva y combina por ID el avance anterior.
    Los fallos de métricas de desvío se distinguen del objetivo de descubrimiento.
11. **Archivos.** Nuevo `lib/route-search.js`; `server.js` adapta las consultas
    y orquesta el descubrimiento; `client/src/lib/loading.js`, `App.svelte`,
    `OptionsPanel.svelte` propagan y muestran cobertura. Nuevas pruebas en
    `scripts/route-search.test.mjs`, añadidas a `npm test`. Versiones en package,
    lockfile, servidor/User-Agent, entorno, título y marca UI; build en `public/`.
12. **Qué se conserva.** Kilómetros como filtro de bases, ranking por interés,
    motor del itinerario de v1.2.11, selección múltiple, duraciones, comida
    protegida, métricas por lotes de 20 y certificados del sistema. APIs anteriores
    compatibles; `coverage` y `status:partial` son aditivos. Actividades en destino
    mantienen su comportamiento; los nuevos modos de proveedor son opcionales.
13. **Impacto externo.** La primera carga puede pedir más datos y tardar más;
    no se cambia de proveedor ni se configuran claves nuevas. Sólo se amplía si
    falta el objetivo. Se conservan pausas, concurrencia limitada y timeouts;
    Wikipedia y Geoapify se apoyan en mecanismos documentados:
    [GeoSearch](https://en.wikipedia.org/w/api.php?action=help&modules=query%2Bgeosearch)
    y [paginación Geoapify](https://apidocs.geoapify.com/docs/places/).
14. **Validación.** Trece pruebas de lógica pasan: incluye ampliación desde 11,
    50 lugares próximos de la misma familia, muestreo métrico, página llena sin
    candidatos aceptados, páginas repetidas, subdivisión por saturación y fallos
    que impiden declarar agotamiento. Build correcto salvo aviso preexistente
    `.chosen`; flujo de navegador simulado de escritorio/móvil correcto.
    Prueba real Málaga→Almería (201,8561 km): objetivo 50, respuesta 50, 389
    candidatos válidos tras filtros, 22 centros y 44 consultas de primera pasada;
    duración ~66 s. La oferta ya supera el mínimo sin necesitar ampliar.
    Smoke real del flujo completo contra localhost:3000 correcto; la nueva caché
    contiene las 50 paradas con `target-reached`. El smoke comprueba también
    que el número de filas coincide con la respuesta y alcanza el objetivo
    cuando el backend informa de que se ha conseguido.
15. **Límites reales.** No puede probarse que no exista ningún sitio en el mundo
    fuera de las fuentes consultadas. La app garantiza intentar completar esas
    fuentes dentro del corredor y no confundir fallos con agotamiento. No elimina
    filtros de identidad, coordenadas o pertenencia a la ruta para rellenar.
    Si todas las fuentes están caídas, ofrece respaldo y reintento con estado
    incompleto; no promete haber alcanzado ni agotado el objetivo.

## v1.2.12 — Certificados del sistema para consultas HTTPS

- **Motivo y reproducción:** buscar finales de etapa devolvía HTTP 502 con
  `fetch failed`. Una consulta directa a Nominatim desde Node 24.13.0 fallaba
  con `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, tanto dentro como fuera del sandbox.
  La misma consulta usando `--use-system-ca` devolvió HTTP 200: el problema
  era el almacén de confianza usado por Node, no la búsqueda ni el proveedor.
- **Antes/después:** `server.js` ahora añade los certificados de confianza del
  sistema a los certificados predeterminados de Node antes de realizar ninguna
  consulta. Usa `tls.getCACertificates` y `tls.setDefaultCACertificates`, con
  detección de disponibilidad. Se deduplican los certificados. No se desactiva
  la validación TLS ni se sustituye la confianza predeterminada.
- **Compatibilidad y fallback:** en versiones antiguas de Node sin estas APIs
  se mantiene la configuración TLS existente. Para resolver este caso en esas
  versiones debe actualizarse Node o configurar correctamente sus CA. No hay
  nuevas dependencias, cambios de endpoints, caché, ranking, fórmulas o límites.
- **Errores útiles:** `fetchJson` identifica tres errores habituales de cadena
  de certificados e informa del hostname y del problema de confianza. Un error
  genérico de conexión informa del hostname y permite reintentar. Se conserva
  la causa original. Nunca se muestra la URL completa ni su clave API.
- **Archivos/versionado:** `server.js`, `package.json`, `package-lock.json`,
  `.env`, `.env.example`, título HTML y marca de versión de `App.svelte`; build
  regenerado en `public/`. Versión visible y User-Agent: 1.2.12.
- **Validación:** fallo TLS reproducido; consulta HTTPS con CA del sistema y
  prueba de configuración TLS programática devuelven 200. Sintaxis de servidor,
  seis pruebas de regresión y build correctos (aviso `.chosen` preexistente).
  Se reinicia el servidor local para aplicar la confianza desde el arranque.
  Búsqueda real tras reiniciar: Málaga → Almería, 200 ±40 km, contexto correcto
  y ocho bases válidas; Almería primera (203 km), resto entre 165 y 191 km.
- **Limitaciones:** la confianza depende del almacén instalado en el equipo.
  Una caída real del proveedor, problemas de red u otros fallos TLS continúan
  usando los fallbacks y mensajes existentes. Ninguna CA se descarga ni instala.

## v1.2.11 — Paradas completas, tiempos compartidos y recuperación por bloque

Esta entrada prevalece sobre las descripciones históricas de §13, §25–29 y
§46.3 que hablan del motor portado literalmente de la UI antigua.

1. **Versión y motivo.** 1.2.11. Revisión del código tras la puesta al día:
   corregir el recorte posterior de paradas, la divergencia entre horarios y
   viabilidad y la presentación de fallos como resultados vacíos.
2. **Problemas reproducidos.** `/api/metrics/route-options` devuelve como máximo
   20 ítems; el cliente sustituía el pool completo por ellos, anulando el
   objetivo proporcional de v1.2.10. El motor colocaba todas las paradas antes
   de comer aunque la comida estuviera antes en la ruta. La viabilidad usaba
   85 minutos de comida y 25/15 de check-in; podía discrepar del itinerario.
   Los desvíos reales dibujados no alimentaban los tiempos de conducción.
3. **Comportamiento anterior.** Métricas en una llamada; desplazamientos de
   ruta proporcionales al progreso; secuencia real sólo en destino, sin comida;
   errores de bloques convertidos en `[]`, todos los pasos marcados terminados.
4. **Paradas completas.** `api.metricsRouteOptions` divide en lotes secuenciales
   de 20, fusiona respuestas por ID y conserva orden y todos los ítems originales.
   Un lote fallido no elimina sus opciones; quedan sin métricas nuevas. Devuelve
   `degraded` si hay fallo, respuesta incompleta o estimación. El endpoint mantiene
   su contrato de máximo 20 por petición. No cambia `robustRouteStops` ni su ranking.
5. **Motor único.** `itineraryStops` intercala comida en ruta por progreso junto
   con paradas; en destino recorre comida → hotel → actividades → cena.
   `travelPoints` construye la secuencia completa. `buildItinerary` consume un
   mapa de tramos dirigidos por coordenadas (`legKey`), con tiempos de OSRM.
   No suma `extraMin` individuales: podrían contar dos veces un desvío compartido.
   `approximateSchedule` e `isLunchViable` llaman al mismo motor. Todos los tiempos
   personalizados se aplican; cena no empieza antes de las 19:00 y se mantiene
   el límite 22:30 y la visibilidad de selecciones ya hechas.
6. **Comida protegida.** Sin restaurante, se reservan 85 minutos: si la conducción
   atraviesa las 13:00, se divide ese desplazamiento conservando sus minutos y
   retrasando lo que viene después. Antes de una visita en ruta que impediría
   comer antes de las 14:30 se reserva el bloque. Llegando temprano, se espera a
   las 12:30. Una comida seleccionada que pasa a ser tardía se conserva y avisa;
   nunca desaparece silenciosamente. Si se sale demasiado tarde se avisa de la
   imposibilidad de respetar la ventana.
7. **Estimaciones.** Antes de resolver tramos, la UI recalcula inmediatamente.
   En ruta estima cada tramo usando el máximo entre la proporción del tiempo
   directo y la estimación local; sin paradas usa el tiempo directo conocido.
   En destino conserva `approxLocalTravelMin` (1,22 / 28 km/h / mínimo 5).
   OSRM fallido conserva el fallback del servidor (1,25 / 35 km/h / mínimo 5).
   Se muestran avisos de estimación. Para opciones aún no elegidas se reutilizan
   tramos conocidos y se estiman los nuevos; no se consulta OSRM por cada ficha.
8. **Tramos largos y asincronía.** `api.travelSequence` trocea en 20 puntos con
   solapamiento de un punto (19 tramos); comprueba que no falten tramos. Caché de
   tramos en memoria del cliente por par dirigido, reiniciada al cambiar búsqueda
   o base. Guardas de generación impiden aplicar cargas/horarios antiguos a otro
   plan. Cambiar sólo duración reutiliza tramos. La ruta del mapa incluye comida
   en ruta; los saltos de destino incluyen el restaurante. Se invalida una
   respuesta pendiente de ruta del mapa al deseleccionar la última parada.
9. **Carga y reintento.** Nuevo `lib/loading.js`: distingue `ok` (incluido vacío
   real), `degraded` (generado, caché antigua, métricas estimadas/fallidas) y
   `error` (petición fallida). Conserva contenido previo ante fallo o degradación;
   sin previo muestra el respaldo recibido. `App.retryCategory` actualiza sólo
   el bloque solicitado y conserva selecciones. `OptionsPanel` muestra aviso y
   botón Reintentar dentro del bloque. Comida/cena/alojamiento comparten la
   petición de servicios; ésta conserva estados independientes por origen y el
   aviso agregado permite reintentar ese bloque. No se etiqueta fallo como
   «sin actividades/paradas». No se inventan lugares concretos.
10. **Archivos afectados.** `client/src/lib/{api,itinerary,loading,map}.js`,
    `App.svelte`, `components/{OptionsPanel,MapCanvas}.svelte`; `server.js`
    añade `states:{food,lodging}` a servicios. `package.json`, lockfile, título
    HTML y marca UI, User-Agent y arranque del servidor, `.env`/`.env.example`.
    `public/` se regenera exclusivamente con Vite.
11. **Compatibilidad y proveedores.** Endpoints existentes y cuerpos compatibles;
    campo `states` aditivo. Ninguna clave de caché persistente cambia; no se
    vacía `data/cache.json`. Más llamadas de métricas sólo cuando hay >20 paradas;
    tramos de carretera para toda la selección, en lotes acotados. Se mantienen
    los proveedores y las políticas de búsqueda de v1.2.10.
12. **Invariantes conservados.** Distancia como filtro, interés como ranking,
    selección múltiple, duraciones editables, honestidad geográfica y fallbacks
    marcados. El mapa sigue siendo vista del estado, no un segundo planificador.
13. **Pruebas automatizadas.** `npm test` ejecuta `scripts/regression.test.mjs`:
    50 paradas y lote fallido, respuestas reordenadas, secuencia de 45 puntos,
    comida entre paradas, tiempos reales sin sumar desvíos, duraciones editables,
    cena mínima, comida reservada sin solapamientos y estados de recuperación.
    `npm run test:ui` ejecuta `scripts/regression-ui.mjs`: sirve el build y simula
    respuestas de API en Chrome, sin consumir proveedores externos. El smoke
    real existente incorpora aserciones sobre bases, grupos, editor y mapa.
14. **Validación.** Las seis pruebas de lógica pasan; Vite compila la versión
    1.2.11. Permanece el aviso CSS preexistente `.chosen` sin uso. El flujo de
    navegador con API simulada pasa: 50 paradas, fallo del segundo lote,
    reintentos sin pérdida de selecciones, recuperación de actividades,
    duración editable, mapa y pestaña móvil a 390 px, sin excepciones JS.
    También pasa `node scripts/smoke.mjs` contra el backend local y los datos
    disponibles de proveedores/caché: Almería aparece entre las bases, cinco
    grupos, selección de parada y actividad (9 filas de itinerario, 2 marcadores),
    edición de duración, preferencias, reapertura de búsqueda y teselas;
    sin errores de consola ni excepciones. Sintaxis del backend y módulos
    modificados validada. No se vació la caché para forzar consultas externas.
15. **Limitaciones.** La viabilidad de opciones no seleccionadas incluye tramos
    estimados; se ajusta al seleccionarlas. Progreso de ruta sigue siendo
    aproximado, sin optimización TSP. La pausa genérica para comer no identifica
    un restaurante o área de descanso concreta. No hay inventario de hoteles,
    persistencia del plan ni clustering nuevos. Las estimaciones almacenadas se
    conservan durante el plan; no hay reintentos automáticos continuos de OSRM.

## v1.2.10 — Paradas en ruta: cantidad proporcional a la distancia (~1 cada 4 km)

1. **Número de versión nuevo.** 1.2.10. `package.json`, `server.js` (`USER_AGENT`
   por defecto → `TravelPlannerPersonal/1.2.10`, log de arranque), `.env`,
   `.env.example`, cabecera de este documento, §11 reescrita.

2. **Motivo del cambio.** El usuario pidió que el número de paradas en ruta
   ofrecidas escale con la etapa: **~1 opción cada 4 km** (200 km → ~50 paradas),
   sin techo. Aceptó latencia agresiva en la primera carga de un corredor nuevo
   (se cachea 14 días después).

3. **Problema que se intenta resolver.** `robustRouteStops` daba un número
   prácticamente **fijo**: tope real `max: 30` en `distributeAlongRoute`,
   alimentado por sólo 4–9 puntos de muestreo (`round(km/25)`) y enriquecido sólo
   en las primeras 16/20 fichas. Para 200 km salían ~20 paradas y nunca más de
   30, aunque el corredor diera para el doble.

4. **Comportamiento anterior (v1.2.9).**
   - `n = clamp(round(km/25), 4, 9)` puntos de muestreo; lotes de 2 con
     `sleep(400)`.
   - Por punto: `wikiNearby(c, 10000, 24)`, `geoapifyPlaces(…, 14000, 25)`,
     `overpassQuick("activities", c, 11000)`.
   - "Playas a secas": `slice(0, 5)`.
   - `distributeAlongRoute(merged, { buckets: 10, perBucket: 4, max: 30 })`.
   - Anti-repetición por arranque de nombre: máx. **2**.
   - Enriquecido: `attachWikiExtracts(collected, 16)`,
     `enrichGeoapifyDetails(collected, 20)`.
   - Clave de caché `routeStops:v5:`.
   - `routeGeneratedStops`: progreso fijo `[.28, .5, .7]`.

5. **Comportamiento nuevo (v1.2.10).**
   - `targetStops = Math.max(12, Math.round(km / 4))` — objetivo de cantidad, sin
     tope superior. Es el `max` de `distributeAlongRoute`.
   - `n = Math.max(4, Math.min(16, Math.round(km / 13)))` — ~1 punto de muestreo
     cada 13 km (200 km → 15). Lotes de **2** con `sleep(400)` (mismo ritmo que
     v1.2.9, más puntos).
   - En **todos** los puntos: `wikiNearby(c, 11000, 30)`,
     `geoapifyPlaces(…, 15000, 40)` (con 1 reintento tras pausa).
   - Overpass **sólo en ~3 puntos** (`idx % ceil(n/3) === 0`) y en **modo
     rápido**: nuevo parámetro opcional
     `overpassQuick(kind, center, radius, { maxEndpoints: 1, timeoutMs: 3500 })`.
     Consultarlo en los 15 puntos con Overpass caído llevaba la primera carga a
     ~110 s (regresión §38.3). Aporta 0 ítems al resultado casi siempre.
   - "Playas a secas": `slice(0, Math.max(5, Math.round(km / 40)))`.
   - `buckets = Math.max(8, Math.min(28, Math.round(km / 8)))` (~1 tramo cada
     8 km); `distributeAlongRoute(merged, { buckets, perBucket: 5, max: targetStops })`.
   - Anti-repetición por arranque de nombre: máx. **3**. Se conservan sin cambio:
     "nunca el mismo nombre", de-cluster 2 km misma familia, máx. 2 de una
     familia por tramo (ahora hay muchos más tramos, ese límite ya no ahoga el
     total).
   - Enriquecido: `attachWikiExtracts(collected, Math.min(collected.length, 36))`
     y `enrichGeoapifyDetails(collected, Math.min(collected.length, 36))`.
   - Clave de caché `routeStops:v7:`.
   - `routeGeneratedStops`: progreso proporcional, ~1 punto cada 30 km (3–12).

6. **Archivos y funciones afectadas.** Sólo `server.js`:
   - `robustRouteStops` (constante `targetStops`, `n`, `buckets`, radios/límites
     de `wikiNearby`/`geoAt`, `osmEvery` + `gatherAt(c, idx)`, troceado de lotes,
     tope de playas, límites de `attachWikiExtracts`/`enrichGeoapifyDetails`,
     clave de caché).
   - `overpassQuick` (nuevo 4º parámetro opcional `{ maxEndpoints, timeoutMs }`,
     retrocompatible: por defecto todos los endpoints y 4,5 s como antes).
   - `distributeAlongRoute` (`nameKeyCount` ≥ 3 en vez de ≥ 2).
   - `routeGeneratedStops` (muestreo de `progress` proporcional a `route.roadKm`).
   - `USER_AGENT` y log de `app.listen`.
   Frontend: **sin cambios** (`OptionsPanel` ya pinta toda la lista; las
   preferencias sólo reordenan).

7. **Algoritmos, fórmulas, límites o constantes modificados.**
   - `targetStops = max(12, round(km/4))` (nuevo, reemplaza `max: 30` fijo).
   - `n` puntos: `round(km/25)∈[4,9]` → `round(km/13)∈[4,16]`.
   - `buckets`: `10` fijo → `round(km/8)∈[8,28]`.
   - `perBucket`: `4` → `5`.
   - Radio/límite Wikipedia por punto: `10 km / 24` → `11 km / 30`.
   - Radio/límite Geoapify por punto: `14 km / 25` → `15 km / 40`.
   - Overpass: en **todos** los puntos, todos los endpoints, timeout 4,5 s →
     **sólo ~3 puntos**, 1 endpoint, timeout 3,5 s.
   - Tope playas sin ficha: `5` → `max(5, round(km/40))`.
   - Enriquecido: `16` / `20` → `min(len, 36)` / `min(len, 36)`.
   - `nameKeyCount` corte: `2` → `3`.
   - `routeGeneratedStops`: 3 puntos fijos → `round(roadKm/30)∈[3,12]`.

8. **Nuevos invariantes funcionales.**
   - El número de paradas en ruta ofrecidas es aproximadamente `distancia / 4`
     (mín. 12, sin máximo), sujeto a los filtros de calidad y de-clustering.
   - La cantidad ya **no** está acotada por una constante fija.
   - La distancia sigue **sin** entrar en ningún ranking (§2.1): aquí sólo fija
     cuántas paradas se piden, no cómo se ordenan.

9. **Qué comportamiento anterior debe conservarse.**
   - Arquitectura de `robustRouteStops`: fusión Wikipedia > Geoapify > OSM,
     `distributeAlongRoute` con reparto en ronda, enriquecido sólo de
     supervivientes, `.catch` por punto, caché 14 días.
   - Overpass como tercer nivel (§6.5); v1.2.10 lo consulta en **menos** puntos y
     más rápido, nunca en más ni con más reintentos.
   - `overpassQuick` sin el 4º parámetro se comporta EXACTAMENTE como antes
     (actividades/comida/alojamiento del destino no cambian).
   - Filtros geográficos y de calidad (§2.3): núcleos de población fuera,
     direcciones fuera, no-Wikipedia debe aportar señal real o categoría
     autoexplicativa.
   - "No pude consultar" ≠ "0 resultados" (§2.4).

10. **Fallbacks y tratamiento de errores.** Igual que antes: cada punto de
    muestreo que falla devuelve `[]` sin romper el resto; si `collected` queda
    vacío se usa caché stale y, en último recurso, `routeGeneratedStops` (ahora
    con reparto proporcional). No se cachea un resultado pobre sin ninguna fuente
    rica (`wikiOkAny || enriched.length >= 12`, y siempre `>= 6`).

11. **Impacto en UI y experiencia del usuario.** La sección "Paradas en ruta"
    pide muchas más opciones y mejor repartidas por el corredor **donde las hay**
    (ver punto 15). La primera carga de un corredor nuevo tarda ~15–30 s en
    etapas largas (la barra de progreso de §30 lo cubre); las siguientes son
    instantáneas por caché. Con la sección abierta el mapa puede dibujar 30–100+
    marcadores de parada (ver §39.11).

12. **Impacto en APIs/proveedores externos.** Más llamadas a Wikipedia y
    Geoapify por búsqueda (más puntos de muestreo), dentro del mismo patrón de
    lotes de 2 con `sleep(400)`. Geoapify: 40 por punto (antes 25) + Place
    Details hasta 36 fichas (antes 20) — dentro del plan gratuito para uso
    personal. Wikipedia: `geosearch` + `extracts` en más puntos; el mismo ritmo
    de v1.2.9 evita el "too many requests" (que si aparece cobra backoff de
    reintentos y dispara la latencia). **Overpass: se consulta MENOS** (~3 puntos
    en vez de 15, 1 endpoint en vez de 3, 3,5 s en vez de 4,5 s).

13. **Compatibilidad con datos/caché/versiones anteriores.** Clave de caché
    `routeStops:v5:` → `routeStops:v7:`: las entradas antiguas quedan huérfanas
    (se ignoran; `savePersistent` las purga por TTL). No cambia la forma de los
    ítems persistidos. Ninguna otra clave de caché se toca. `overpassQuick` es
    retrocompatible (4º parámetro opcional). `data/cache.json` no requiere
    edición manual.

14. **Pruebas o validaciones realizadas.**
    - `node --check server.js` OK.
    - `npx vite build` limpio (sólo el aviso preexistente de `.chosen`).
    - Script de flujo real contra `:3000` (Málaga→Almería ~202 km por A-92 y
      Málaga→Granada ~135 km): la 1ª carga tardó ~17–30 s; la 2ª, instantánea
      (caché `v7:`). El nº de paradas depende de la cobertura real del corredor
      (ver punto 15): en la primera aproximación se observaron ~20–46 según el
      estado de Wikipedia en el momento; nunca el tope fijo de 30 anterior.
    - `overpassQuick` con Overpass caído: la 1ª carga bajó de ~110 s (todos los
      puntos) a ~20–30 s (3 puntos, modo rápido).
    - Pendiente al cerrar: una pasada limpia de `scripts/smoke.mjs` y una
      revisión visual del mapa con la sección abierta cuando es.wikipedia.org
      deje de limitar el ritmo tras las pruebas repetidas.

15. **Limitaciones conocidas que permanecen.**
    - **`targetStops` es un objetivo, no un suelo.** El número real de paradas lo
      marca la cobertura de POI de calidad del corredor. En rutas con tramos
      largos deshabitados (Málaga→Almería por la A-92 cruza el desierto de
      Tabernas) el total queda claramente por debajo de `km/4` y las paradas se
      agrupan donde de verdad hay pueblos. Es intencionado (§2.3, §39.10); no
      "rellenar" con lugares dudosos para cuadrar el número.
    - Con 30–100+ marcadores de parada el mapa puede pedir clustering (pendiente
      opcional ya anotado en §46.5).
    - La primera carga de una etapa larga es más lenta que en v1.2.9 (compensada
      por la caché de 14 días).
    - Bajo ráfagas de pruebas, es.wikipedia.org limita el ritmo y devuelve "too
      many requests"; el resultado entonces cae a sólo-Geoapify y **no se
      cachea** (correcto, §2.6), pero da cantidades más bajas hasta que se
      recupera.

## v1.2.9 — Fix: la etiqueta de un marcador del mapa se recortaba a una letra

1. **Versión.** 1.2.9 (`package.json`, `server.js`, `.env`, `.env.example`, cabecera).

2. **Motivo.** La etiqueta (chip con el nombre o el `+min·+km`) que aparece al
   pasar el ratón / al seleccionar un punto sólo mostraba la primera letra a
   medias.

3. **Problema.** El contenedor del `divIcon` de Leaflet mide exactamente
   `iconSize` (18×18 px). `.map-opt` era un `flex` dentro de esa caja y el `.chip`
   (con `overflow:hidden; text-overflow:ellipsis; max-width:150px`) se encogía
   hasta ~0 px porque `overflow:hidden` lleva su `min-width` a 0: quedaba el ancho
   de un carácter recortado.

4. **Comportamiento anterior.** `.map-opt { display:flex }` + `.chip` como ítem
   flex con recorte.

5. **Comportamiento nuevo.** `.map-opt { display:grid; place-items:center;
   width:18px; height:18px }` (sólo el punto). El `.chip` pasa a
   `position:absolute; left:calc(100% + 6px); white-space:nowrap` (sin
   `max-width`/`overflow`): se dibuja fuera de la caja del icono y no se recorta.
   Cerca del borde derecho (`shouldFlip`: x > 72 % del ancho del mapa) se coloca a
   la izquierda del punto (`.map-opt.chip-left .chip { right:calc(100% + 6px) }`).
   El nombre del chip se escapa con `esc()` (defensa ante nombres de paradas
   personalizadas).

6. **Archivos.** `client/src/lib/map.js` (`optionIcon` acepta `flip`, helper
   `esc`, helper `shouldFlip`; `makeMarker` y `setHovered` pasan `flip`);
   `client/src/components/MapCanvas.svelte` (CSS `.map-opt` y `.map-opt .chip`).

7. **Algoritmos/constantes.** `shouldFlip` = punto a la derecha del 72 % del
   ancho del contenedor del mapa. Sin más cambios.

8. **Invariantes nuevos.** El chip de un marcador se ve completo siempre que el
   marcador esté en hover o seleccionado.

9. **Conservar.** `iconSize:[18,18]`/`iconAnchor:[9,9]` (el punto sigue anclado a
   la coordenada). `show = selected || hovered` (cuándo aparece el chip). Colores
   `det-good/mid/high` del chip.

10. **Fallbacks.** `shouldFlip` con `try/catch` (si el mapa aún no tiene tamaño,
    no voltea).

11. **Impacto UI.** Al pasar el ratón por un punto (o al seleccionarlo) se lee su
    nombre / su coste de desvío; antes no.

12. **Impacto APIs.** Ninguno (sólo cliente).

13. **Compatibilidad.** Sólo CSS/JS de cliente; sin claves de caché ni formas de
    datos afectadas. No requiere reiniciar el servidor (se sirve `public/`).

14. **Pruebas.** `vite build` limpio. Playwright: hover sobre una fila →
    `.map-opt.is-hover .chip` mide 94×16 px, `position:absolute`,
    `overflow:visible`, texto "+4 min · +1.1 km" completo. Captura
    `doc/screenshots/v1.2.9-chip-hover.png`.

15. **Limitaciones.** Si dos puntos quedan casi superpuestos, sus chips en hover
    pueden solaparse un instante; el marcador en hover sube a `zIndex 900` y el
    chip a `z-index:3`, así que el activo queda por encima.

---

## v1.2.8 — Mapa: selección más clara, marcadores por sección, clic→lista, deseleccionar comida/cena/alojamiento, calidad de servicios y paradas personalizadas

1. **Número de versión nuevo.** 1.2.8. `package.json`, `server.js` (log +
   `USER_AGENT` → `TravelPlannerPersonal/1.2.8`), `.env`, `.env.example`, cabecera.

2. **Motivo del cambio.** Lote de 7 peticiones del usuario sobre el mapa y las
   opciones: (1) que las seleccionadas se vean claramente elegidas en el mapa;
   (2) que las NO seleccionadas sólo aparezcan si su sección está desplegada;
   (3) colores según la leyenda y que los puntos de destino (actividades) se vean
   al desplegar, no sólo en hover; (4) clic en un punto del mapa → scroll hasta
   esa opción en la lista; (5) volver a pulsar la comida/cena/alojamiento elegida
   la deselecciona; (6) mostrar calidad de comer/cenar/dormir (estrellas,
   precio…) si la fuente la trae; (7) poder añadir paradas personalizadas (por
   nombre o pin en el mapa), insertándolas de forma óptima en la ruta, y poder
   borrarlas sin dejar rastro.

3. **Problema que se intenta resolver.** El mapa pintaba SIEMPRE las paradas en
   ruta y NUNCA las opciones de destino no seleccionadas (sólo una transitoria en
   hover), así que las actividades "no salían". Las seleccionadas se repintaban
   con el color de acento y perdían su color de categoría. No había forma de ir
   del mapa a la lista, ni de quitar una opción de selección única salvo el botón
   "Sin …", ni de añadir un lugar propio a la ruta.

4. **Comportamiento anterior (v1.2.7).** `renderMarkers`: `if (kind==="route" ||
   isSel)`. Selección en `OptionCard` de modo `single`: `onselect(item)` siempre
   (nunca `null` desde la tarjeta). Sin `customStops`. Marcador seleccionado =
   punto de color `--accent`.

5. **Comportamiento nuevo.**
   - **Selección clara en el mapa.** El punto seleccionado **mantiene** su color
     de categoría/desvío (código de la leyenda) y añade borde blanco de 3 px,
     halo de acento, tamaño mayor y una marca `✓`. Las personalizadas llevan `★`
     y forma cuadrada.
   - **Marcadores por sección.** Una opción no seleccionada sólo se dibuja si su
     grupo del acordeón está abierto (`openOptionGroup`, ahora un store).
     Correspondencias: `route`→paradas · `act`→actividades ·
     `lunch`→comida en ruta + en destino · `dinner`→comida en destino ·
     `hotel`→alojamiento. Las seleccionadas se ven siempre.
   - **Colores.** Ya cuadran con la leyenda (`--data-good/mid/high` para el
     desvío de paradas; morado/ámbar/verde para actividad/comida/alojamiento).
     Leyenda ampliada con "seleccionada" y "personalizada".
   - **Clic en el mapa → lista.** Al pulsar un marcador, `setActivateCallback`
     abre su grupo (`groupOfOptionId`) y fija `revealOptionId`; `OptionsPanel`
     hace `scrollIntoView` de la fila (`[data-opt-id]`).
   - **Deseleccionar servicios.** En `OptionCard` modo `single`, volver a pulsar
     la opción ya elegida llama `onselect(null)` → sin comida / sin cena / sin
     alojamiento. Para que el 2º clic no caiga en el cajón abierto, la zona
     interactiva se separó (`.face`) del `.drawer`.
   - **Calidad de servicios.** `OptionCard` con `quality` muestra, si la fuente
     lo trae: estrellas de hotel (`item.stars`), valoración `★ x.x (n)`
     (`rating`/`userRatingCount`), precio `€…€€€€` (`priceLevel`) y tipo de
     cocina (`cuisine`). Backend: Google añade `places.priceLevel` al fieldmask
     (enum → 1-4); Overpass captura `stars`/`stars:count` (alojamiento) y
     mantiene `cuisine`; Geoapify lee `datasource.raw.stars`.
   - **Paradas personalizadas.** Nuevo bloque en "Paradas en ruta": input
     "Añadir por nombre" + botón "＋ Marcar en el mapa" (activa `mapPickMode`;
     el siguiente clic en el mapa crea la parada). Endpoint nuevo
     `POST /api/geocode` (`{q}` directa o `{lat,lon}` inversa, reutiliza
     `geocode`/`reverseGeocode`). `addCustomStopEnriched` calcula el progreso en
     la ruta (punto más cercano) y pide `/api/metrics/route-options` para
     `extraKm`/`extraMin`. La parada va SIEMPRE en `selected.route`, así que la
     ruta del día (`planRouteVia`, que ordena por progreso) la inserta en su
     sitio y `buildItinerary` la coloca en el timeline. Se puede quitar con la
     `×` de la tarjeta (`removeCustomStop`): desaparece de `customStops`,
     `selected.route` y `customDurations`; no es recuperable.

6. **Archivos y funciones afectadas.**
   - `client/src/lib/stores.js`: nuevos stores `openOptionGroup`, `revealOptionId`,
     `customStops`, `mapPickMode`; helpers `addCustomStop`,
     `addCustomStopEnriched`, `removeCustomStop`, `groupOfOptionId`,
     `progressAlongRoute`; `resetPlan` limpia los nuevos stores. Importa
     `haversineKm` de `format.js` y `api` de `api.js`.
   - `client/src/lib/map.js`: `optionIcon` (glifo ✓/★, clase `is-custom`, la
     seleccionada conserva color); `renderMarkers`/`showOptions` con `openGroup`
     y reglas de revelado por grupo; `setActivateCallback` + clic de marcador que
     también activa.
   - `client/src/components/MapCanvas.svelte`: props `openGroup`; `onMapClick`
     para `mapPickMode`; cursor `map--picking`; leyenda ampliada; estilos de
     marcador seleccionado/custom.
   - `client/src/components/OptionsPanel.svelte`: acordeón contra
     `openOptionGroup`; alta de paradas personalizadas; `revealOptionId` →
     scroll; pasa `quality`/`custom`/`onremove` a `OptionCard`.
   - `client/src/components/OptionCard.svelte`: zona `.face` separada del
     `.drawer`; `data-opt-id`; deseleccionar en `single`; línea `.quality`;
     etiqueta "personalizada" + botón `×`.
   - `client/src/App.svelte`: `planPools` fusiona `customStops` en `route`; pasa
     `openGroup` a `MapCanvas`.
   - `client/src/lib/api.js`: método `geocode`.
   - `server.js`: endpoint `POST /api/geocode`; `googlePlaces` (+`priceLevel`);
     `overpassQuick` (+`stars`); `geoapifyPlaces` (+`stars`/`priceLevel`);
     `metrics/route-options` tolera `interestScore` ausente (`||60`).

7. **Algoritmos, fórmulas, límites o constantes.** Sin cambios en el motor del
   itinerario ni en el descubrimiento de bases/paradas. Nuevo: progreso de una
   parada personalizada = índice del vértice de ruta más cercano / nº de
   vértices. Mapa enum precio Google → 1-4.

8. **Nuevos invariantes funcionales.**
   - Marcador seleccionado ⇒ visible siempre y con su color de categoría/desvío
     (no el de acento).
   - Marcador NO seleccionado ⇒ visible sólo si su grupo del acordeón está
     abierto.
   - Comida/cena/alojamiento: pulsar la opción ya elegida la deselecciona.
   - Parada personalizada ⇒ siempre seleccionada mientras exista; su `×` la
     elimina por completo.

9. **Qué comportamiento anterior debe conservarse.**
   - El acordeón sigue abriendo un solo grupo a la vez (ahora vía store).
   - Selección múltiple de paradas/actividades por clic en la tarjeta.
   - Corredor base, spur de desvío en hover, línea del día, hover-centrado,
     leyenda fija abajo-derecha: intactos.
   - Distancia = filtro, ranking = interés (§2.1). Comida 12:30–14:30 y límite
     22:30 (§2.8/§2.10). "No pude consultar" ≠ "0 resultados" (§2.4).

10. **Fallbacks y tratamiento de errores.** `api.geocode` que falla → mensaje en
    el bloque de alta, no se añade nada. `metrics/route-options` que falla para
    una parada personalizada → la parada se añade igual, sin métricas de desvío
    (se muestran cuando lleguen). Campos de calidad ausentes → no se pinta la
    línea `.quality`. Con Google sin configurar no hay `rating`/`priceLevel`;
    quedan `stars`/`cuisine` de OSM/Geoapify si existen.

11. **Impacto en UI y experiencia del usuario.** El mapa deja de estar saturado:
    al cargar el plan sólo se ve el corredor; cada sección que se abre "enciende"
    sus puntos y los apaga al cerrarse; las elegidas destacan con ✓. Del mapa se
    salta a la ficha. Se puede quitar un restaurante/hotel con un 2º clic. Las
    fichas de comer/dormir muestran calidad cuando la hay. El usuario puede
    meter en la ruta cualquier lugar (búsqueda o pin) y quitarlo.

12. **Impacto en APIs/proveedores externos.** Nuevo `POST /api/geocode`
    (Nominatim, con su rate-limit de ~1 req/s ya existente). `googlePlaces` pide
    un campo más (`priceLevel`) — sin coste extra de cuota. Sin cambios en
    Wikipedia/Overpass/Geoapify más allá de leer etiquetas que ya venían.

13. **Compatibilidad con datos/caché/versiones anteriores.** No cambia ninguna
    clave de caché ni forma de ítem persistida. Las paradas personalizadas y el
    grupo abierto son estado de sesión (no se guardan, no hay reload esperado).
    `data/cache.json` intacto.

14. **Pruebas o validaciones realizadas.**
    - `node --check server.js` OK; `npx vite build` limpio (sólo el aviso
      preexistente de `.chosen` sin usar).
    - `POST /api/geocode` con `{q:"Nerja"}` y con `{lat,lon}` → devuelve el
      núcleo correcto.
    - Playwright: al cargar el plan, 0 marcadores; abrir "Paradas en ruta" → 20
      marcadores; seleccionar una → 1 `is-selected`; cerrar la sección → sólo
      queda la seleccionada; abrir "Actividades" → 79 marcadores `map-opt--act`;
      clic en un marcador de ruta → abre "Paradas en ruta"; añadir "Motril"/
      "Nerja" por nombre → fila `is-custom` + marcador `is-custom` + aparece en
      el timeline y la ruta del día pasa por ahí; `×` → desaparece de lista y
      mapa; cena y alojamiento: 1er clic selecciona, 2º deselecciona; líneas de
      calidad visibles (cocina) en servicios. Smoke general sin errores de
      consola.

15. **Limitaciones conocidas que permanecen.**
    - Sin Google Places configurado, la "calidad" se limita a `stars`/`cuisine`
      de OSM/Geoapify, que son irregulares (p. ej. `cuisine=fish`).
    - El pin en el mapa reverse-geocodea al núcleo de población más cercano, no a
      un POI concreto; para un sitio exacto conviene la búsqueda por nombre.
    - Las paradas personalizadas no se guardan entre recargas (igual que el resto
      del estado de la app).
    - Con la sección cerrada, pasar el ratón por una fila de esa sección centra
      el mapa pero no crea marcador para las paradas en ruta (sí para destino);
      es intencionado para no recargar el mapa.

---

## v1.2.7 — Paradas en ruta: oferta amplia (tres fuentes) y bien repartida por todo el corredor

1. **Número de versión nuevo.** 1.2.7. `package.json`, `server.js` (startup log +
   `USER_AGENT` por defecto → `TravelPlannerPersonal/1.2.7`), `.env`,
   `.env.example`, cabecera de este documento.

2. **Motivo del cambio.** Con la política "sólo Wikipedia" de v1.2.6, en
   Málaga→Almería sólo salían **2 paradas en ruta**; y cuando salían más, se
   **amontonaban en dos o tres puntos** (los pueblos con muchos artículos). El
   usuario pidió que la oferta sea "mucho más amplia en tipo de contenido,
   distribución geográfica y cantidad", añadiendo fuentes si hace falta.

3. **Problema que se intenta resolver.** `robustRouteStops` muestreaba sólo 3
   puntos fijos (30/50/70 %), consultaba **sólo Wikipedia** (`wikiNearby` con
   radio y límite pequeños), y sólo rellenaba con Geoapify si había `< 6`
   resultados; Overpass no se usaba nunca para paradas. Wikipedia, además, tiene
   cobertura muy desigual a lo largo de una autovía: densa en cascos urbanos,
   nula en tramos interurbanos. Resultado: pocas paradas y agrupadas.

4. **Comportamiento anterior (v1.2.6).** 3 muestras fijas · sólo Wikipedia ·
   relleno Geoapify condicionado a `< 6` · sin Overpass · filtro `distanceToRoute
   ≤ 8 km`, progreso 15–82 % · orden por interés · tope 16 · clave `routeStops:v3:`.

5. **Comportamiento nuevo.**
   - **Muestreo denso de todo el corredor.** `n = clamp(round(roadKm/25), 4, 9)`
     puntos entre el 8 % y el 92 % del trazado.
   - **Tres fuentes SIEMPRE, en paralelo por punto** (lotes de 2 con pausa de
     400 ms para no saturar Wikipedia):
     - **Wikipedia** `wikiNearby(c, 10 km, 24)` — lugares notables con extracto e
       imagen; ahora descarta títulos que son códigos de carretera (`ROAD_CODE`:
       `A-7`, `N-340`, `Autovía A-92`…).
     - **Geoapify** `geoapifyPlaces(ROUTE_GEO_CATS, c, 12 km, 20)` con
       `ROUTE_GEO_CATS = tourism.attraction, tourism.sights, natural, beach,
       leisure.park, heritage`.
     - **OSM / Overpass** `overpassQuick("activities", c, 11 km)` — consulta
       ampliada con `natural~peak|cliff|cave_entrance|volcano|arch|cape|beach`,
       `boundary=protected_area`, `waterway=waterfall`, y ahora captura las
       etiquetas `wikipedia` / `image` de cada elemento.
   - **Fusión** con prioridad Wikipedia > Geoapify > OSM (`mergeByProximity`
     encadenado, 0,35 km).
   - **Limpieza de calidad antes de repartir:** fuera núcleos de población
     (`ROUTE_SKIP_SETTLEMENT` sobre la descripción corta de Wikidata +
     `WIKI_SETTLEMENT_LEAD` sobre la primera frase del extracto — "X es una
     localidad de…"); fuera nombres que son vías (`ROUTE_ADDRESS_LIKE`: "Calle…",
     "Camino…"); todo ítem **no** de Wikipedia debe aportar imagen, o descripción
     real (> 60 car., no plantilla), o web, o ficha wiki, o pertenecer a una
     categoría auto-explicativa (`SELF_EXPLANATORY`: playa, mirador, castillo,
     parque natural, cascada…). Las "playas a secas" (sin imagen ni descripción)
     se limitan a 5.
   - **Reparto geográfico** (`distributeAlongRoute`): 10 tramos por progreso;
     fase 1 coge hasta 4 de cada tramo (máx. 2 de una misma familia por tramo,
     de-clustering de 2 km, máx. 2 con el mismo arranque de nombre, nunca dos
     veces el mismo nombre); fase 2 rellena **en ronda por tramos** hasta el tope
     (30) para no volcar el relleno en una sola familia.
   - **Enriquecimiento sólo de las supervivientes:** `attachWikiExtracts` trae
     extracto + imagen reales de Wikipedia para POIs de OSM con etiqueta
     `wikipedia=`; `enrichGeoapifyDetails` para el resto. Puerta final: si tras
     enriquecer un ítem sigue sin imagen, sin descripción real y sin categoría
     auto-explicativa, se descarta (salvo que dejara el total por debajo de 12).
   - Clave de caché `routeStops:v5:`; sólo se cachea si Wikipedia respondió en
     algún punto **o** hay ≥ 12 paradas (y siempre ≥ 6).

6. **Archivos y funciones afectadas.**
   - `server.js`: reescritura de `robustRouteStops`; nuevas
     `wikiExtractByTitle`, `attachWikiExtracts`, `categoryFamily`,
     `routeCoordsKm`, `distributeAlongRoute`, `nameKeyOf`; constantes
     `ROUTE_GEO_CATS`, `ROUTE_SKIP_SETTLEMENT`, `WIKI_SETTLEMENT_LEAD`,
     `ROUTE_ADDRESS_LIKE`, `ROUTE_DESC_GENERIC`; `wikiNearby` (filtro
     `ROAD_CODE`); `overpassQuick` (consulta natural/protected_area/waterfall +
     captura de `wikipedia`/`image`, `["name"]` en cada cláusula).
   - `package.json`, `.env`, `.env.example`, `doc/APPLICATION_HANDOFF.md`
     (§6.0 + este changelog).

7. **Algoritmos, fórmulas, límites o constantes modificados.**
   - Muestreo: `n = clamp(round(roadKm/25), 4, 9)`, fracciones 0,08–0,92.
   - Filtro de corredor: `distanceToRoute ≤ 10 km`, progreso 6–93 %,
     `≥ 6 km` de origen y de destino (antes 8 km / 15–82 %).
   - `distributeAlongRoute`: 10 buckets, `perBucket` 4, `max` 30 (`robustRouteStops`
     pasa `{buckets:10, perBucket:4, max:30}`); `_score` = `interestScore` +
     bonus (wiki +9 / geoapify +3 / imagen +6 / descripción real +5 / ficha
     wiki +4).
   - Topes: 2 de una familia por tramo, 2 con el mismo arranque de nombre, 5
     playas sin ficha.
   - Clave de caché `routeStops:v3:` → `routeStops:v5:` (la v4 fue un paso
     intermedio de esta misma iteración; no llegó a documento).

8. **Nuevos invariantes funcionales.**
   - Las paradas en ruta salen de **tres fuentes combinadas**, no de una sola.
   - Se muestrea **todo** el corredor y el resultado se **reparte por tramos**:
     ninguna franja larga del trayecto queda sin representación si hay contenido.
   - Ninguna familia de contenido copa un tramo (máx. 2/tramo); ningún nombre se
     repite.
   - Toda parada no-Wikipedia aporta imagen, descripción real, web, ficha wiki o
     categoría auto-explicativa.

9. **Qué comportamiento anterior debe conservarse.**
   - **Actividades en destino** siguen con la política "sólo Wikipedia" de v1.2.6
     (este cambio es exclusivo de paradas en ruta).
   - Distancia al trazado = filtro, nunca ranking (§2.1).
   - "No pude consultar" ≠ "0 resultados": si las tres fuentes fallan se recurre
     a `routeGeneratedStops` (paradas libres por reverse-geocoding) y no se
     cachea.
   - Formato de ítem de parada intacto (`routeProgressPct`, `distanceToRouteKm`,
     `imageUrl`, `wikipediaUrl`, `source`, `verified`…), que consumen el mapa y
     `/api/metrics/route-detour`.
   - Scoring de popularidad de Wikipedia (idiomas/bytes/pageviews) de v1.2.4.

10. **Fallbacks y tratamiento de errores.** Cada fuente se consulta dentro de su
    propio `.catch` por punto de muestreo: si una (o un punto) falla, las demás
    cubren. Overpass es poco fiable desde algunas redes; su caída no afecta
    (aporta 0 y ya está). Si tras fusionar y repartir no hay nada → paradas
    `cache-stale` si existieran → `routeGeneratedStops` (`source:"generated"`,
    sin cachear).

11. **Impacto en UI y experiencia del usuario.** "Paradas en ruta" pasa de ~2
    ítems agrupados a ~16–30 repartidos por todo el trayecto, con variedad real
    (playas, miradores, castillos, torres vigía, yacimientos, museos, faros,
    parajes naturales, acueductos…). La lista ya tiene scroll vertical (v1.2.3) y
    cada ficha su miniatura + descripción (v1.2.6). Primera carga de un trayecto
    nuevo: ~45–60 s (varias decenas de consultas a tres proveedores); luego queda
    en caché 14 días y es instantánea.

12. **Impacto en APIs/proveedores externos.** Sube el uso puntual de Wikipedia
    (geosearch + extractos en 4–9 puntos), Geoapify (`/v2/places` en 4–9 puntos +
    `place-details` de las supervivientes) y Overpass (4–9 consultas). Todo
    gratuito; Wikipedia puede responder "too many requests" en ráfagas de prueba
    (mitigado con lotes de 2 y pausa de 400 ms). Uso real de un usuario: una vez
    por trayecto y a caché.

13. **Compatibilidad con datos/caché/versiones anteriores.** `routeStops:v5:`
    invalida las entradas `v3`/`v4` de paradas en ruta: la primera consulta por
    trayecto reconstruye. El resto de `data/cache.json` (rutas, resúmenes de
    base, actividades `content:v7:`, desvíos) se conserva. Se purgaron a mano las
    entradas `routeStops:` al desplegar 1.2.7.

14. **Pruebas o validaciones realizadas.**
    - `node --check server.js` OK; `npx vite build` OK.
    - `node scripts/smoke.mjs` → sin errores de consola; flujo Málaga→Almería
      completo.
    - Málaga→Almería (`roadKm` 203): 28 paradas, `source` `wikipedia+geoapify`,
      progreso repartido por deciles `{0:3,10:4,20:5,30:1,50:4,60:4,70:3,80:2,90:2}`
      (el decil 40 % es un tramo de montaña realmente vacío), 21/28 con imagen,
      27/28 con descripción real; familias: naturaleza 12, historia 8, otros 6,
      museo 2 (playas, ríos, sierras, faros, torres vigía, yacimientos, museos,
      acueducto, albufera, dunas).
    - Málaga→Granada (`roadKm` 126): 16 paradas repartidas 8–59 %, todas con
      descripción real (museos, iglesias, lagunas de Archidona, cuevas,
      yacimientos, Puerto de las Pedrizas…).
    - Overpass no respondió desde el entorno de prueba (timeout / User-Agent);
      el `.catch` lo absorbe y las otras dos fuentes cubren. En un entorno con
      Overpass disponible aportará además POIs rurales de OSM.

15. **Limitaciones conocidas que permanecen.**
    - Primera carga por trayecto lenta (~1 min) por el número de consultas; a
      partir de ahí, caché.
    - Un tramo del trayecto sin ningún contenido documentado (montaña,
      despoblado) seguirá sin paradas: es correcto, no un fallo.
    - Overpass es inestable según la red; cuando no responde se pierde la capa de
      POIs puramente-OSM (las otras dos fuentes siguen).
    - Wikipedia mete algún artículo tangencial (ríos/ramblas que cruza la
      carretera, alguna escultura aislada); van con tope de repetición y ficha
      real, pero no siempre son "paradas" en sentido estricto.
    - Bajo ráfagas de prueba Wikipedia limita el ritmo y el resultado varía algo
      entre ejecuciones; en uso normal (una vez y a caché) no se nota.

---

## v1.2.6 — Actividades y paradas en ruta: sólo contenido calidad-Wikipedia (imagen + descripción real en TODAS las opciones)

1. **Número de versión nuevo.** 1.2.6. `package.json`, `server.js` (startup log +
   `USER_AGENT` por defecto → `TravelPlannerPersonal/1.2.6`), `.env`,
   `.env.example`, cabecera de este documento.

2. **Motivo del cambio.** Tras v1.2.4/v1.2.5 el usuario observó que en las listas
   de opciones "aparecen algunas opciones con elementos gráficos y otras no… los
   que sí lo tienen son las que tienen Wikipedia… estas tienen descripciones
   mucho mejores… este es el tipo de contenido que quiero siempre". También:
   al expandir una ficha el texto descriptivo se veía recortado (sólo el tooltip
   mostraba el contenido completo) y las miniaturas se habían perdido en algunas
   tarjetas.

3. **Problema que se intenta resolver.** `robustDestinationContent("activities")`
   y `robustRouteStops` mezclaban Wikipedia (imagen + extracto real + señales de
   popularidad) con relleno de Geoapify (sin imagen, descripción de plantilla),
   produciendo listas heterogéneas: unas fichas ricas y otras genéricas. Además
   `OptionCard` recortaba `.desc` con `-webkit-line-clamp:3` y `.row` tenía
   `overflow:hidden` (heredado del arreglo de ancho de v1.2.5), que cortaba el
   texto del cajón desplegable en horizontal y en vertical.

4. **Comportamiento anterior (v1.2.5).** Actividades: Wikipedia primaria pero con
   relleno Geoapify siempre que ayudara a llegar al mínimo de ítems, sin exigir
   que el ítem de Geoapify tuviera descripción o imagen. Paradas en ruta: igual.
   Claves de caché `content:v6:` / `routeStops:v2:`. `OptionCard`: descripción
   del cajón con clamp de 3 líneas + tooltip para el resto; `.row` con
   `overflow:hidden`; sin línea de vista previa en la fila colapsada.

5. **Comportamiento nuevo.**
   - **Actividades — sólo Wikipedia como primaria** (`robustDestinationContent`,
     rama `kind==="activities"`): `wikiNearby(destination, 6500, 120)` → filtrado
     (`filterDestinationItems`, exclusión de entidades administrativas y del
     propio topónimo). Geoapify **sólo** se invoca si `items.length < 8`, y de su
     salida sólo se conservan ítems con descripción real (no plantilla) **o**
     imagen antes de `mergeByProximity`. `src` refleja el origen real
     (`wikipedia`, `wikipedia+geoapify`, `geoapify`).
   - **Paradas en ruta — sólo Wikipedia como primaria** (`robustRouteStops`):
     `wikiNearby(c, 10000, 15)` por cada punto de muestreo del corredor;
     `applyRouteFilter` (≤8 km del trazado, progreso 15–82 %, ≥10 km del destino).
     Geoapify sólo si `collected.length < 6 && GEOAPIFY_KEY`, filtrado a
     descripción/imagen.
   - **Anti-envenenamiento de caché reforzado.** Sólo se cachea (`cacheSet`) si
     Wikipedia respondió de verdad (`wikiOk`). La ruta de fallback "sólo Geoapify"
     no cachea actividades (`if(kind!=="activities")cacheSet(...)`). `wikiNearby`
     **lanza** si falla una tanda de páginas (antes agregaba resultados
     parciales), de modo que un fallo se propaga como "no pude consultar" y no
     como "pocas actividades". `wikiFetch` reintenta 3× con backoff
     `sleep(700*(i+1))`.
   - **OptionCard** (`client/src/components/OptionCard.svelte`): el cajón muestra
     la descripción **completa** sin recorte — `.desc` pasa de
     `-webkit-line-clamp:3` a `max-height:260px; overflow-y:auto;
     overscroll-behavior:contain` con estilo de barra de scroll; se elimina el
     tooltip sobre la descripción (ya no hace falta). `.row` pierde
     `overflow:hidden` (el recorte horizontal lo hace ahora el rail). Nueva línea
     `.preview` en la fila colapsada: 2 líneas de `item.description` cuando es
     real (no coincide con el patrón `GENERIC`) y mide > 60 caracteres. Miniatura
     `.thumb` 44×44 px siempre que haya `item.imageUrl`; banner del cajón con
     `aspect-ratio:16/9; max-height:170px`.

6. **Archivos y funciones afectadas.**
   - `server.js`: `robustDestinationContent` (rama `activities`),
     `robustRouteStops`, `wikiNearby` (ahora lanza en fallo de tanda),
     `wikiFetch` (backoff), constantes de clave de caché `content:v7:` /
     `routeStops:v3:`, `USER_AGENT` por defecto, log de arranque.
   - `client/src/components/OptionCard.svelte`: `descPreview`, plantilla del cajón,
     CSS `.row` / `.desc` / `.preview` / `.thumb` / `.banner`.
   - `client/src/components/OptionsPanel.svelte`: `.list` con `max-height:58vh;
     overflow-y:auto` (ya venía de v1.2.3, se confirma tras el cambio de ancho).
   - `package.json`, `.env`, `.env.example`, `doc/APPLICATION_HANDOFF.md`
     (§6.0 ampliada + este changelog).
   - `scripts/smoke.mjs`: paso de hover usa
     `.locator(".groups .group:nth-of-type(1) .row").first().hover()`.

7. **Algoritmos, fórmulas, límites o constantes modificados.**
   - Umbral de relleno Geoapify: actividades `items.length < 8`, paradas
     `collected.length < 6`.
   - Filtro de aceptación de ítems Geoapify de relleno: debe tener descripción no
     genérica **o** `imageUrl`.
   - `wikiFetch`: 3 intentos, backoff lineal `700·(i+1)` ms.
   - Claves de caché: `content:v6:`→`content:v7:`, `routeStops:v2:`→`routeStops:v3:`.
   - CSS: `.desc` `max-height:260px` (antes clamp 3 líneas); `.preview` clamp 2
     líneas; `.thumb` 44 px; `.banner` `aspect-ratio:16/9`, `max-height:170px`.

8. **Nuevos invariantes funcionales.**
   - Toda opción de "Actividades en destino" y de "Paradas en ruta" que se ofrezca
     tiene, salvo degradación por fallo de proveedor, imagen y descripción reales.
   - Geoapify nunca es fuente primaria de actividades/paradas; sólo rellena
     resultados escasos y sólo con fichas que aporten descripción o imagen.
   - No se cachea contenido de actividades/paradas si Wikipedia no respondió.
   - El cajón de `OptionCard` muestra la descripción íntegra (con scroll si es
     larga), nunca recortada tras puntos suspensivos.

9. **Qué comportamiento anterior debe conservarse.**
   - Wikipedia sigue siendo **aditiva**: si cae, la app funciona con Geoapify y
     fallbacks (sin cachear en actividades). "No pude consultar" ≠ "0 resultados"
     (§2.4).
   - Scoring de popularidad de Wikipedia de v1.2.4 (idiomas/bytes/pageviews)
     intacto.
   - `wikiPlaceCoord` para afinar centros urbanos y coordenadas de base, intacto.
   - Acordeón de opciones, hover-centrado en todas las secciones, desvíos
     permanentes de paradas seleccionadas, leyenda fija: sin cambios.
   - Distancia = filtro, ranking = interés (§2.1).

10. **Fallbacks y tratamiento de errores.** Wikipedia 429/timeout → `wikiOk`
    falso → se usa Geoapify sin cachear (actividades) / se cachea sólo si hubo
    al menos una llamada Wikipedia con éxito (paradas). `wikiNearby` que lanza en
    una tanda aborta la función completa (sin resultados parciales) y el llamador
    cae al camino de relleno. `enrichInterest` deja `infoUrl` =
    `wikipediaUrl || relatedSearchUrl(...)`.

11. **Impacto en UI y experiencia del usuario.** Listas de actividades y de
    paradas homogéneas: todas con miniatura 44 px, subtítulo con la descripción
    corta de Wikidata y vista previa de 2 líneas en la fila colapsada; al
    expandir, banner 16:9 y descripción completa desplazable, sin necesidad de
    tooltip. Enlace "Wikipedia ↗" cuando la fuente es Wikipedia.

12. **Impacto en APIs/proveedores externos.** Más peso sobre la API de Wikipedia
    (`es.wikipedia.org/w/api.php`) y menos sobre Geoapify (que ya sólo se llama
    para rellenar). Uso personal muy por debajo de límites; en ráfagas de pruebas
    Wikipedia responde "too many requests" (transitorio, no afecta a un usuario
    real).

13. **Compatibilidad con datos/caché/versiones anteriores.** Las claves nuevas
    (`content:v7:`, `routeStops:v3:`) **invalidan** las entradas previas de
    actividades y paradas: la primera consulta tras actualizar reconstruye desde
    Wikipedia. El resto de `data/cache.json` (rutas, resúmenes de base, desvíos)
    se conserva. `data/cache.json` se vació manualmente al desplegar v1.2.6.

14. **Pruebas o validaciones realizadas.**
    - `node --check server.js` OK; `npx vite build` OK.
    - `curl /api/options/activities` Almería → `source` `wikipedia`, 79 ítems,
      todos con `imageUrl`, todos `source:"wikipedia"` (Alcazaba, Catedral,
      Museo de Almería, Plaza de toros, Puerto de Almería…).
    - Aguadulce (localidad pequeña) → 8 ítems `wikipedia+geoapify` (relleno
      activado por escasez, sólo fichas con imagen/descr.).
    - `curl /api/options/route` Málaga→Almería → 16 paradas, todas `wikipedia`,
      todas con imagen (La Herradura, Castillo de La Herradura, Acantilados de
      Maro-Cerro Gordo, Playa de Cantarriján…).
    - `node scripts/smoke.mjs` → sin errores de consola ni excepciones; flujo
      Málaga→Almería completo (acordeón, selección múltiple, edición de duración,
      hover, edición de viaje, mapa con tiles).
    - Capturas `doc/screenshots/v1.2.6-{lista,desktop,desktop-oscuro}.png`:
      lista homogénea con miniaturas y vista previa de 2 líneas; cajón con
      descripción íntegra desplazable en claro y oscuro.

15. **Limitaciones conocidas que permanecen.**
    - Cobertura de Wikipedia sesgada a lo notable: excelente para actividades y
      paradas de interés; una localidad muy pequeña puede quedar con pocas
      actividades y activar el relleno de Geoapify.
    - En ráfagas de pruebas Wikipedia limita el ritmo; en uso normal (un usuario)
      no se alcanza.
    - Si Wikipedia está caída al pedir actividades por primera vez, se muestran
      fichas de Geoapify más pobres y no se cachean (se reintenta en la siguiente
      petición).
    - `client/` requiere `vite build` para regenerar `public/` (desviación de
      "sin build step" documentada desde v1.2.0-alpha.1).

---

## v1.2.5 — Ajuste de ancho: las tarjetas de opción ya no se cortan por la derecha

Con la miniatura nueva de v1.2.4, el contenido de las filas de opción se salía
del rail izquierdo (el `.rail__scroll` sólo recortaba en vertical). Cambios
puramente CSS: `--rail-w` 358→396 y `--rail-w-wide` 384→400; `.rail__scroll`
gana `overflow-x: hidden` y `> * { max-width: 100% }`; `.row` (OptionCard) gana
`min-width: 0; max-width: 100%; overflow: hidden`; `.list` (OptionsPanel) gana
`min-width: 0; overflow-x: hidden`. Verificado: ninguna tarjeta sobresale del
rail, ninguna fila tiene contenido oculto en horizontal. `package.json`/
`server.js`/`.env` → 1.2.5.

---

## v1.2.4 — Wikipedia como fuente de actividades: lugares notables, descripciones reales e imágenes + hover-centrado en todas las secciones

1. **Versión.** 1.2.4.

2. **Motivo.** (a) El hover-centrado del mapa no funcionaba en "Comida en ruta".
   (b) Las descripciones de las opciones eran genéricas e inútiles ("es un
   lugar de interés localizado por las fuentes cartográficas…") y casi idénticas;
   las opciones no siempre eran de interés. El usuario pidió mejores opciones y
   descripciones aunque hubiera que cambiar de fuente (gratuita/fiable).

3. **Problema.** Las actividades venían de Geoapify `/v2/places` por categoría:
   sin descripción real, sin imagen, sin señal de popularidad (los `rating` de
   Geoapify son `null`), así que `interestScore` quedaba plano en ~55-60 para
   todo. `robustDestinationContent` registraba en `itemsById` del mapa `route`,
   `activities`, `food`, `lodging` pero NO `routeLunch`.

4. **Comportamiento anterior.** Fuente de actividades = Geoapify. Descripciones
   por `categoryDescription()` (plantillas). `map.js` sólo centraba (`panInside`)
   marcadores de destino, y `routeLunch` no estaba en `itemsById`.

5. **Comportamiento nuevo.**
   - **Wikipedia (es) como fuente principal de actividades** (`server.js`):
     `wikiNearby(center, radius, limit)` → `list=geosearch` (artículos con
     coordenadas cercanos; tener artículo ya es señal de notabilidad) + una
     tanda `prop=extracts|pageimages|pageterms|pageviews|langlinks|info` por cada
     20 páginas. De cada artículo se saca: extracto real (2-3 frases),
     `imageUrl` (miniatura), `shortDesc` (descripción de Wikidata, p.ej.
     "catedral en Almería"), `wikiLanglinks`, `wikiBytes`, `wikiPageviews`.
     Gratis, sin clave, con atribución a Wikipedia. Es **aditivo**: si Wikipedia
     falla se sigue con Geoapify/Google/Overpass.
   - **GeoSearch pide 120 candidatos** (devuelve los N más cercanos, no "los del
     radio"; en cascos densos un límite bajo no llega a monumentos como la
     Alcazaba). La puntuación (idiomas + tamaño de artículo + visitas) saca lo
     importante arriba.
   - **Filtro de "no visitables"** (`wikiIsVisitablePlace`): descarta artículos
     de acontecimientos (batallas, asedios, bombardeos…), entidades territoriales
     (provincia, comarca, taifa, diócesis…), estaciones/aeropuertos, hospitales,
     estadios/clubes, cementerios, etc. También se descarta el artículo de la
     propia ciudad.
   - **`scoreBreakdown` para Wikipedia**: `popularity` = 0.34·idiomas +
     0.40·tamaño(bytes) + 0.26·visitas; `completeness` sube con imagen y ficha
     de Wikipedia; `reliability` 90. Resultado: Alcazaba/Catedral ~78, museo ~74,
     edificio menor ~66 (antes: todo ~56).
   - **Centro urbano afinado** (`wikiPlaceCoord`): el nodo OSM `place=city` de
     algunas localidades está mal colocado (el de Almería cae 13 km al este). Se
     corrige con la coordenada del artículo de Wikipedia del mismo nombre (si
     está a ≤25 km). Se aplica en `geocode()` y sobre las 18 bases finales de
     `/api/search/candidates` (afecta a mapa, ruta y búsqueda de contenido).
     Tras afinar, se deduplican bases que quedan en el mismo punto.
   - **Rutas del corredor** (`robustRouteStops`, cache `routeStops:v2:`):
     `wikiNearby` alrededor de los 3 puntos de muestreo → paradas notables con
     descripción real.
   - **Anti-envenenamiento de caché**: si Wikipedia falla (429/timeout — una
     tanda que falla aborta `wikiNearby` entero), el resultado sólo-Geoapify de
     actividades **no se cachea**, para reintentar Wikipedia en la siguiente
     carga en vez de quedar clavados con datos genéricos durante el TTL. Cache de
     actividades: `content:v6:`.
   - **`map.js`**: `register(lastPools.routeLunch, "food")` → el hover-centrado
     funciona también en la sección Comida (y en todas las demás).
   - **Frontend** (`OptionCard`): miniatura (`item.imageUrl`) en la fila y banner
     grande en el detalle; el subtítulo usa `item.shortDesc` de Wikidata cuando
     existe; badge de fuente "Wikipedia" (punto oscuro); enlace "Wikipedia ↗".
   - **Descripciones de restaurantes** algo menos secas: incluyen la cocina
     (`catering.cuisine`) cuando Geoapify la trae.

6. **Archivos afectados.**
   - `server.js`: `wikiFetch` (con reintento + detección de `error`),
     `wikiPlaceCoord`, `wikiCategoryFromText`, `wikiIsVisitablePlace`,
     `WIKI_SKIP`/`WIKI_NOT_PLACE_DESC`/`WIKI_EVENT_LEAD`, `wikiNearby`,
     `mergeByProximity`; `geocode()` (afina centro); `scoreBreakdown`
     (popularidad/completeness/reliability para Wikipedia); `enrichInterest`
     (`infoUrl` respeta el de Wikipedia); `robustDestinationContent` (rama de
     actividades wiki+geo, cache `v6`, sin cachear sólo-geo); `robustRouteStops`
     (`v2` + wiki); `categoryDescription` (cocina); `/api/providers` (+wikipedia);
     versión log/UA → 1.2.4.
   - `client/src/lib/map.js`: registra `routeLunch` en `itemsById`.
   - `client/src/components/OptionCard.svelte`: miniatura + banner + `shortDesc` +
     fuente Wikipedia + `linkLabel`; `.row` pasa a flexbox.
   - `package.json`, `.env`, `.env.example` → 1.2.4.

7. **Algoritmos/constantes.** Nuevo scoring de popularidad para Wikipedia (ver
   arriba). Sin cambios en el itinerario. Caches `content:v6:` (actividades),
   `routeStops:v2:`, `wikiCoord:` (en `memCache`, no persistente).

8. **Nuevos invariantes.**
   - Las actividades intentan SIEMPRE Wikipedia primero; sólo se cachea el
     resultado si Wikipedia respondió.
   - `wikiNearby` no devuelve resultados parciales: si una tanda falla, lanza.
   - Todas las secciones de opciones (no sólo paradas) centran su elemento en el
     mapa al hacer hover si no se ve.

9. **Qué se conserva.** Cadena de fallback intacta (wiki → geoapify → google →
   overpass → caché → generado). "No pude consultar" ≠ "0 opciones". Lógica de
   itinerario sin tocar. Geoapify sigue aportando cobertura (bares, tiendas,
   POI sin artículo) vía `mergeByProximity`.

10. **Fallbacks.** Wikipedia caída → Geoapify (sin cachear en actividades).
    Sin imagen → tarjeta sin miniatura. `wikiPlaceCoord` sin artículo → se
    mantiene la coordenada del geocoder.

11. **Impacto UI.** Actividades con nombre real, descripción real de Wikipedia,
    imagen y puntuación con sentido. La sección Comida ya reacciona al hover.

12. **Impacto APIs.** Nuevo consumo de la API de Wikipedia (`es.wikipedia.org/w/api.php`):
    ~1 geosearch + ~6 tandas por destino de actividades (cacheado 14 días); 3+
    para rutas; 1 por base para afinar coordenada. Con `User-Agent` descriptivo.
    Uso personal muy por debajo de los límites; en ráfagas de pruebas Wikipedia
    puede responder "too many requests" (transitorio, no se cachea).

13. **Compatibilidad.** `data/cache.json` compatible; claves nuevas conviven.

14. **Pruebas.** `vite build` sin warnings. `node --check server.js` OK. Smoke
    Playwright verde. `/api/options/activities`: Almería → Alcazaba (78),
    Catedral (76), Museo de Almería (74)…; Tarifa → Parque natural del Estrecho,
    Castillo de Tarifa, Isla de Las Palomas, Faro; Granada → Catedral, Capilla
    Real, Corral del Carbón. 82/87 con miniatura. `geocode("Granada"/"Valencia")`
    → ciudad española; `geocode("Almería")` afinada a 36.842,-2.464. Hover en
    sección Comida con zoom fuerte → el mapa se recentra. Repetir la carga no
    envenena la caché (source pasa a `cache` con los mismos datos buenos).

15. **Limitaciones que permanecen.**
    - `shortDesc` de Wikidata a veces es tosca ("Edificio en Almería, España").
    - Cobertura de Wikipedia sesgada a lo notable: bien para actividades y
      paradas; comida y alojamiento siguen siendo Geoapify.
    - En ráfagas de pruebas Wikipedia limita el ritmo; en uso normal no.
    - Alguna calle/avenida sin interés real puede colarse a media tabla.

---

## v1.2.3 — Mapa usable en los huecos, desvíos permanentes, hover que centra, listas con scroll, leyenda fija abajo-derecha

1. **Versión.** 1.2.3.

2. **Motivo.** Seis peticiones del usuario sobre v1.2.2.

3. **Problema.** (a) Los rails, aun con tarjetas ajustadas al contenido, tapaban
   el mapa en sus huecos (sin cursor de arrastre, sin poder seleccionar).
   (b) El desvío de una parada sólo se veía en hover, no tras seleccionarla.
   (c) Al pasar el ratón sobre una opción fuera de vista, el mapa no la traía.
   (d) Las listas usaban enlaces "+N más". (e) Sobraban los botones de plegar
   rails. (f) La leyenda era un `<details>` plegable a media altura y el
   itinerario podía solaparla.

4. **Comportamiento anterior.** `.rail` capturaba el ratón en toda su caja.
   El "spur" (ramal de desvío) se dibujaba sólo con `hoveredOptionId`.
   `setHovered` sólo hacía `panInside` para destinos. `OptionsPanel` recortaba a
   `CAP=7` con botón "+N más". Existían `.rail__toggle` y estado `leftOpen`/
   `rightOpen`. Leyenda `<details open>` a la izquierda.

5. **Comportamiento nuevo.**
   - **Huecos = mapa útil**: `.rail` y `.rail__scroll` con `pointer-events:none`;
     sólo `.rail__scroll > *` (las tarjetas) reciben el ratón. Entre/bajo/entre
     tarjetas el cursor es del mapa (pan, zoom, selección). El scroll del rail
     sigue funcionando con el cursor sobre una tarjeta.
   - **Desvío permanente**: nuevo endpoint `POST /api/plan/route-via`
     `{origin, vias:[{lat,lon}], destination}` → polilínea REAL por carretera
     origen→paradas→base (caché `routeVia:v1:`). `MapCanvas` la pide y la pinta
     en la capa `itinRoute` **siempre que haya paradas seleccionadas** (trazo
     recto instantáneo → geometría real). El corredor directo queda debajo como
     referencia tenue. El "spur" de hover queda sólo para paradas **no**
     seleccionadas.
   - **Hover que centra**: `setHovered` → `ensureVisible(lat,lon)`: si el punto
     no está dentro de `map.getBounds().pad(-0.12)`, `map.panTo(ll)` (mantiene
     zoom, centra en la ventana). Vale para paradas y destinos.
   - **Listas con scroll**: `OptionsPanel` sin `CAP`/`cut`/"+N más". Cada
     `.list` es `max-height:340px; overflow-y:auto` (~8 filas colapsadas). Se
     renderizan todas las opciones.
   - **Sin botones de plegar rails**: eliminados `.rail__toggle` y `leftOpen`/
     `rightOpen`. "Enfocar mapa" / "Mostrar paneles" es la única forma de
     ocultar los paneles (ahora los desplaza casi del todo, 4 px de asa).
   - **Leyenda**: `<aside>` fijo en la **esquina inferior derecha de la ventana**
     (`right/bottom: sp3`, `z-overlay`, `pointer-events:auto`), sin plegado por
     título. La atribución de Leaflet pasa a la esquina inferior izquierda
     (`map.attributionControl.setPosition("bottomleft")`).
   - **Itinerario que no solapa la leyenda**: `.rail--right .rail__scroll` tiene
     `padding-bottom:210px`, así la tarjeta del itinerario llega como mucho hasta
     encima de la leyenda; si el recorrido no cabe, `.itin__body` hace scroll
     interno (verificado con 16 filas: `cardBottom ≤ legendTop`).

6. **Archivos afectados.**
   - `server.js`: nuevo `POST /api/plan/route-via`; versión de log/UA → 1.2.3.
   - `client/src/lib/api.js`: `planRouteVia()`.
   - `client/src/lib/map.js`: capa `itinRoute`; `drawItineraryRoute()` /
     `clearItineraryRoute()`; `ensureVisible()` (sustituye `panInside`/
     `PAN_INSETS`); atribución a bottomleft.
   - `client/src/components/MapCanvas.svelte`: `$effect` de ruta con vías
     (`planRouteVia`); el `$effect` del spur ignora paradas seleccionadas;
     leyenda `<details>` → `<aside>` abajo-derecha.
   - `client/src/components/OptionsPanel.svelte`: sin "+N más"; `.list` con
     `max-height`/scroll.
   - `client/src/App.svelte`: sin `.rail__toggle` ni `leftOpen`/`rightOpen`;
     `pointer-events` en rails; `.rail--right .rail__scroll` reserva 210 px
     abajo; `.app--focus` desplaza casi del todo.
   - `package.json`, `.env`, `.env.example` → 1.2.3.
   - `scripts/smoke.mjs`: selectores del acordeón / lista con scroll.

7. **Algoritmos/constantes.** Ninguna fórmula cambia. `route-via` cachea con
   `routeVia:v1:`. `ensureVisible` usa `pad(-0.12)` como margen de "visible".
   `.list` cap = 340 px. Reserva de leyenda = 210 px.

8. **Nuevos invariantes.**
   - El contenedor de un rail no captura el ratón; sólo sus tarjetas.
   - Con paradas seleccionadas, la ruta del día en el mapa es la geometría real
     origen→paradas→base (capa `itinRoute`), no el corredor directo.
   - La leyenda vive en la esquina inferior derecha de la ventana y el
     itinerario nunca la tapa (se limita y hace scroll interno).

9. **Qué se conserva.** Toda la funcionalidad previa. El corredor directo se
   sigue dibujando (referencia). El endpoint `route-detour` sigue existiendo
   para el preview de hover.

10. **Fallbacks.** `route-via` sin OSRM → `{source:"straight", coords:[o,...vias,d]}`
    y el cliente pinta el trazo recto (que ya venía dibujado igualmente al
    instante).

11. **Impacto UI.** Mapa manejable en toda su superficie visible; el desvío de
    las paradas elegidas se ve siempre; el hover trae la opción al centro;
    listas con scroll en vez de "ver más"; menos botones; leyenda fija.

12. **Impacto APIs.** Nuevo `POST /api/plan/route-via` (OSRM `route` con
    waypoints, cacheado; 1 llamada por cambio de selección de paradas).

13. **Compatibilidad.** `data/cache.json` compatible (`routeVia:v1:` nuevo).

14. **Pruebas.** `vite build` sin warnings. `node --check server.js` OK. Smoke +
    comprobaciones dirigidas: `elementFromPoint` en el hueco del rail devuelve
    `leaflet-container`; `.list` = `max-height:340px/auto`, `more-btn=0`;
    seleccionar 2 paradas → `itinRoute` dibujada sin hover; tras zoom, hover de
    opción lejana → `map-pane` translada (recentrado); 16 filas de itinerario →
    `cardBottom(674) ≤ legendTop(678)` y `itin__body` con scroll; `rail__toggle`
    = 0. Sin errores de consola.

15. **Limitaciones que permanecen.** Las de v1.2.1/v1.2.2. La leyenda se sigue
    ocultando en ≤1024 px (móvil/tablet la hoja inferior ocupa esa zona).

---

## v1.2.2 — Ajustes de flujo: ruta al elegir base, resumen inmediato, opciones en acordeón, itinerario que se ajusta al contenido

1. **Versión.** 1.2.2.

2. **Motivo.** Cuatro peticiones concretas del usuario sobre el flujo de v1.2.1.

3. **Problema.** (a) La ruta origen→base sólo aparecía tras "Cargar opciones del
   día". (b) La barra de viaje y la tarjeta "Preparar el día" convivían con la
   lista de bases candidatas. (c) Los grupos de opciones arrancaban abiertos.
   (d) La tarjeta del itinerario estiraba todo el lateral derecho.

4. **Comportamiento anterior.** `routeData` se fijaba en `loadPlan()`.
   `chooseBase()` sólo guardaba la base y mostraba "Preparar el día" DEBAJO de
   los resultados. `OptionsPanel` usaba `<details open>` en los 3 primeros.
   `.card--fill` del rail derecho tenía `height:100%`.

5. **Comportamiento nuevo.**
   - **Ruta al elegir base**: `chooseBase()` es ahora `async` y llama a
     `/api/plan/route` (con guarda `routeSeq`) para fijar `routeData` — el mapa
     dibuja el corredor origen→base **de inmediato**. `loadPlan()` reutiliza ese
     `routeData` si ya existe (una llamada menos). Las capas que dependen del
     plan (paradas, marcadores de opción, ramal, línea del día) siguen sin
     aparecer hasta pulsar "Cargar opciones del día".
   - **Al elegir base**: se ocultan las bases candidatas y se muestran la
     **barra de viaje** (`Origen → Base · km · cambiar`) y la tarjeta **Preparar
     el día**. "cambiar" (`editingSearch = true`) reabre búsqueda + resultados;
     elegir otra base o buscar de nuevo vuelve a cerrar esa vista. El snippet
     `planContent` se reorganiza: `{#if $chosen && !editingSearch}` → barra +
     (preparar | preferencias+opciones); `{:else}` → búsqueda + resultados.
   - **Opciones en acordeón** (`OptionsPanel`): estado `openKey` (arranca `null`
     = todo colapsado). Cada `<summary>` hace `e.preventDefault()` y
     `openKey = openKey === key ? null : key`; abrir un grupo cierra los demás.
     `<details open={openKey === "…"}>`. Accesible con teclado (Enter/Espacio
     sobre el summary).
   - **Itinerario ajustado al contenido**: `.card--fill` pasa a
     `height:auto; max-height:100%`; `.rail--right .card--fill` a `flex:0 1 auto`;
     `ItineraryPanel .itin` a `height:auto; max-height:100%` y `.itin__body` a
     `flex:0 1 auto` con scroll interno sólo si el recorrido excede el alto. En
     móvil la pestaña Itinerario sigue llenando la hoja (override `min-height:55vh`).
   - Menor: `TimelineRow` no repite el texto cuando `name === label` (evita
     "Tiempo libre  Tiempo libre").

6. **Archivos afectados.** `client/src/App.svelte` (`chooseBase` async +
   `routeSeq`; `loadPlan` reutiliza ruta; `runSearch` resetea `editingSearch`;
   snippet `planContent` reorganizado; CSS `.card--fill` / `.rail--right`).
   `client/src/components/OptionsPanel.svelte` (acordeón `openKey`/`toggle`).
   `client/src/components/ItineraryPanel.svelte` (alturas).
   `client/src/components/TimelineRow.svelte` (`main` sin duplicar label).
   `package.json`, `server.js`, `.env`, `.env.example` → 1.2.2.

7. **Algoritmos/constantes.** Ninguno. Sólo orquestación de UI y una llamada
   `/api/plan/route` adelantada al momento de elegir base (misma llamada, antes).

8. **Nuevos invariantes.**
   - El mapa muestra el corredor origen→base en cuanto hay base elegida; el
     resto de capas, sólo tras "Cargar opciones del día".
   - Con base elegida y sin editar, NO se listan las bases candidatas.
   - En `OptionsPanel` hay como mucho un grupo abierto a la vez.

9. **Qué se conserva.** Toda la funcionalidad y los invariantes de v1.2.1 y
   anteriores. Backend de opciones/itinerario intacto (sólo se adelanta la
   llamada de ruta, que ya existía).

10. **Fallbacks.** Si `/api/plan/route` falla en `chooseBase`, no pasa nada: se
    recalcula en `loadPlan()`.

11. **Impacto UI.** Flujo más limpio: elegir base → ves la ruta y el resumen sin
    ruido; opciones plegadas y en acordeón; itinerario compacto.

12. **Impacto APIs.** Ninguno nuevo. `/api/plan/route` se llama al elegir base en
    vez de al cargar el plan (y se evita repetirla).

13. **Compatibilidad.** Sin cambios de datos/caché.

14. **Pruebas.** `vite build` sin warnings. `node --check server.js` OK. Smoke
    Playwright: al elegir base → `trip-bar` visible, `.bases` oculto, tarjeta
    "Preparar el día" presente, 2 paths de ruta en el mapa antes de cargar
    opciones; acordeón → 0 grupos abiertos al inicio, abrir grupo 1 y luego
    grupo 3 deja sólo el 3 abierto; tarjeta itinerario ~285 px de 900. Sin
    errores de consola.

15. **Limitaciones que permanecen.** Las de v1.2.1 (chip del ramal cerca del
    borde, nombres largos con elipsis, geocoding sin sesgo por país).

---

## v1.2.1 — UI más ligera (listas compactas + tooltips) + geometría real del desvío + geocoding menos ambiguo

1. **Versión.** 1.2.1.

2. **Motivo.** Petición del usuario tras v1.2.0: los paneles ocupaban demasiada
   pantalla y las listas de opciones eran pesadas; quería textos breves con
   tooltips, aprovechar mejor el espacio y un acabado más profesional. Más los
   pendientes opcionales anotados en v1.2.0 (desvío real, geocoding).

3. **Problema.** Cada opción se mostraba como una tarjeta alta (nombre + 2
   badges + fuente + párrafo de descripción + métricas + editor + desglose +
   enlace, todo a la vez). Los dos rails de 400 px dejaban poco mapa. El ramal
   de desvío y la línea de destino eran trazos rectos. "Granada" resolvía al
   país del Caribe.

4. **Comportamiento anterior.** `OptionCard` = tarjeta expandida siempre.
   `OptionsPanel` listaba TODAS las opciones. Rails 400 px. `map.js` dibujaba el
   spur recto origen→parada→base y pintaba ~100 marcadores de destino.
   `geocode()` tomaba `d[0]` de Nominatim con `limit=1`.

5. **Comportamiento nuevo.**
   - **`OptionCard` compacto** (`client/src/components/OptionCard.svelte`,
     reescrito): fila de una línea — casilla · nombre (elipsis, `title` completo)
     · chip de desvío `+N′` sólo en paradas de ruta · punto de color = fuente ·
     chevron. Debajo, subtítulo breve: `Categoría · % ruta · ★ · rango min ·
     interés N`. El detalle (descripción recortada a 3 líneas, métricas, editor
     de duración, desglose, enlace) sólo al expandir el chevron o al seleccionar.
   - **Tooltips** (`client/src/lib/tip.js`, acción `use:tip`): burbuja propia
     (sirve sobre el mapa) en badges, punto de fuente, métricas de desvío,
     "desglose", "horario ⓘ", recomendación de duración y descripción completa.
   - **`OptionsPanel`** (reescrito): grupos `<details>` con contador; muestra las
     7 primeras por grupo + botón "+N más"; las seleccionadas siempre visibles
     aunque estén más allá del corte. Opción "Sin …" como fila fina.
   - **Categoría legible**: `shortCat()` mapea `item.categories`/`category` a
     "Museo", "Mirador", "Restaurante", "Alojamiento"… (antes se veía todo como
     "Lugar").
   - **Barra de viaje**: con el plan cargado, la búsqueda y los resultados se
     colapsan en una barra `Origen → Base · km` con "cambiar" (reabre la
     búsqueda). Preferencias + opciones van juntas en una sola tarjeta.
   - **"Enfocar mapa"**: botón en la cabecera (sólo con plan y en escritorio)
     que adelgaza ambos rails a una pestaña; se restaura con "Mostrar paneles".
   - **Rails más estrechos**: `--rail-w` 400→358, rail derecho `--rail-w-wide`
     384. `TimelineRow` reescrito a 2 columnas (hora/duración + contenido que
     fluye) — mucho más denso.
   - **Ramal de desvío con geometría REAL**: nuevo endpoint
     `POST /api/metrics/route-detour` (OSRM `route` origen;parada;destino,
     `overview=full`, con caché `detour:v1:*`; si falla, trazo recto).
     `MapCanvas` dibuja primero el trazo recto instantáneo y lo sustituye por la
     polilínea real al resolver. `map.js` expone `drawSpur(coords, level, chip)`
     / `clearSpur()`.
   - **Marcadores de destino sólo seleccionados + el señalado**: `map.js` ya no
     pinta las ~100 opciones de destino; sólo las paradas de ruta (16), las
     seleccionadas y una transitoria para la que se señala (con `panInside`).
     `itemsById` guarda todas las coordenadas para poder saltar a cualquiera.
   - **Geocoding menos ambiguo**: `geocode()` pide `limit=6` y prefiere el primer
     resultado cuyo `addresstype` sea de núcleo poblado (`PLACE_LIKE`, sin
     "administrative"); si no hay, `d[0]`. "Granada"/"Valencia" → ciudad
     española. Devuelve además `country` (código ISO) por si se usa a futuro.

6. **Archivos afectados.**
   - `server.js`: `geocode()` (pick + `limit=6` + `country`); nuevo
     `POST /api/metrics/route-detour`; versión de log/UA → 1.2.1.
   - NUEVOS: `client/src/lib/tip.js`.
   - `client/src/lib/api.js`: `metricsRouteDetour()`.
   - `client/src/lib/map.js`: marcadores selectivos + `hoverMarker` transitorio +
     `itemsById`; `drawSpur`/`clearSpur` (el spur lo orquesta `MapCanvas`).
   - `client/src/components/`: `OptionCard.svelte` y `OptionsPanel.svelte`
     reescritos; `TimelineRow.svelte` reescrito; `MapCanvas.svelte` ($effect del
     spur + `api`/`detourLevel`); `App.svelte` (barra de viaje, "Enfocar mapa",
     `editingSearch`, tarjeta prefs+opciones, rails más estrechos).
   - `client/src/app.css`: `.tip-bubble`; `--rail-w` 358 / `--rail-w-wide` 384.
   - `package.json`, `.env`, `.env.example`: versión → 1.2.1.
   - `scripts/smoke.mjs`: selectores adaptados a las filas compactas + checks de
     spur / barra de viaje.

7. **Algoritmos/constantes.** Ninguna fórmula del itinerario cambia. Nuevo:
   `PLACE_LIKE` (filtro de geocoding), `CAP=7` (tope por grupo en la lista),
   umbrales de `detourLevel` sin cambios. `route-detour` cachea con prefijo
   `detour:v1:` (invalidar cambiando el prefijo).

8. **Nuevos invariantes.**
   - Una opción NO seleccionada de destino no tiene marcador fijo en el mapa;
     aparece sólo al señalar su tarjeta (o si se selecciona).
   - `OptionCard` colapsado no debe crecer: los datos secundarios van al
     subtítulo (texto) o a tooltips, nunca a badges permanentes salvo el coste
     de desvío de una parada de ruta.
   - El ramal de desvío se pide siempre a `/api/metrics/route-detour`; el trazo
     recto es sólo el estado transitorio mientras llega la respuesta.

9. **Qué se conserva.** Toda la funcionalidad y los invariantes de v1.2.0 y
   v1.1.5. El backend de opciones/itinerario no cambia. La lógica de
   `itinerary.js`/`scoring.js` intacta.

10. **Fallbacks.** `route-detour` sin OSRM → `{source:"straight", coords:[o,s,d]}`
    y el cliente pinta el trazo recto. `geocode()` sin resultado de tipo núcleo →
    `d[0]` como antes. `shortCat()` sin match → "Lugar de interés".

11. **Impacto UI.** Listas ~3–4× más cortas y escaneables; detalle bajo demanda;
    tooltips; más mapa visible; barra de viaje compacta; modo "Enfocar mapa".

12. **Impacto APIs.** Nuevo endpoint propio `route-detour` (OSRM `route`, 1 por
    parada señalada, cacheado). Nominatim: `limit=1`→`limit=6` en `geocode`
    (misma tarifa, 1 request). Sin cambios en el resto.

13. **Compatibilidad.** `data/cache.json` compatible (nuevas claves `detour:v1:`
    conviven con las demás). `localStorage` sólo `tp-theme`.

14. **Pruebas.** `vite build` sin warnings. `node --check server.js` OK.
    `geocode`: Sevilla→Granada y Madrid→Valencia resuelven a ciudad española
    (antes: país del Caribe / Venezuela). Smoke Playwright (selectores nuevos):
    5 grupos, ~35 filas visibles (7/grupo + seleccionadas), barra de viaje,
    selección parada+actividad → timeline 5→8 + 2 marcadores, editor de duración,
    hover parada → spur con chip (geometría real), "cambiar" reabre búsqueda,
    tooltips. Sin errores de consola. Verificación visual escritorio / "Enfocar
    mapa" / móvil.

15. **Limitaciones que permanecen.**
    - El chip del ramal se ancla al punto medio de la polilínea; en Málaga→
      Almería cae cerca de Motril y puede quedar parcialmente bajo el rail
      izquierdo (se ve entero con "Enfocar mapa").
    - Nombres muy largos en la fila compacta se recortan con elipsis (texto
      completo en el tooltip / `title`).
    - `geocode()` mejora los casos habituales pero no hace sesgo por país del
      origen; un topónimo repetido en varios países podría seguir fallando.
    - `doc/legacy-ui/` sigue como referencia; borrable.

---

## v1.2.0 — Rework frontend map-forward · Fase 3 (pulido, responsive, accesibilidad) + cierre

1. **Versión.** 1.2.0 (final del rework de tres fases; alpha.1 y alpha.2 abajo).

2. **Motivo.** Cerrar el rework: hacerlo usable en cualquier tamaño de pantalla,
   accesible, con motion respetuoso, y subir la versión en todo el proyecto.

3. **Problema.** alpha.1/alpha.2 dejaban pendiente: responsive real, teclado en
   marcadores, `prefers-reduced-motion`, leyenda del mapa, contraste, y el bump
   de versión de `server.js` / `APP_USER_AGENT`.

4. **Comportamiento anterior.** Dos rails flotantes fijos a cualquier ancho; sin
   leyenda; transiciones sin guardar contra reduced-motion; `--text-faint` con
   contraste bajo en claro; marca de versión aún en 1.1.5.

5. **Comportamiento nuevo (Fase 3).**
   - **Responsive** (`App.svelte`): breakpoint `max-width: 1024px` (`window.matchMedia`).
     - ≥1025px: dos rails flotantes (izq: búsqueda→bases→preferencias→opciones;
       der: itinerario), plegables.
     - ≤1024px: **una hoja inferior** (`.sheet`) con asa de contraer/expandir y
       pestañas **Opciones / Itinerario**; el mapa ocupa el resto. `env(safe-area-inset-bottom)`
       respetado. Zoom de Leaflet oculto (es táctil).
     - El contenido no se duplica: dos `{#snippet}` (`planContent`, `itinContent`)
       se renderizan en el layout que toque.
   - **prefers-reduced-motion**: `client/src/lib/motion.js` (`dur()`), aplicado a
     todas las transiciones `fly`. La regla global de `app.css` ya anulaba
     `animation`/`transition`; ahora también las de Svelte.
   - **Leyenda del mapa** (`MapCanvas.svelte`): `<details open>` abajo-izquierda
     con la escala de coste de desvío y las categorías de destino. Oculta ≤1024px.
   - **Accesibilidad**: marcadores Leaflet con `keyboard: true` + `alt` y eventos
     `focus`/`blur` que emiten a `hoveredOptionId` (tab por el mapa resalta la
     tarjeta); contenedor del mapa `role="region"` con `aria-label`; timeline
     `role="list"` / filas `role="listitem"`; botón de tema con `aria-label`
     descriptivo; `aria-selected`/`aria-expanded` en pestañas y asa.
   - **Contraste**: `--text` / `--text-soft` / `--text-faint` oscurecidos en tema
     claro para pasar AA sobre las superficies glass.
   - **Micro-interacción**: `@keyframes tickpop` al seleccionar una tarjeta
     (auto-desactivado por la regla global de reduced-motion).
   - **Versión**: `package.json` 1.2.0; `server.js` log de arranque y default de
     `USER_AGENT` → "1.2.0"; `.env` / `.env.example` `APP_USER_AGENT` → 1.2.0.
     `server.js` sin ningún otro cambio.

6. **Archivos afectados.**
   - `client/src/App.svelte` (layout dual + snippets + matchMedia + a11y),
     `client/src/lib/motion.js` (NUEVO), `client/src/components/MapCanvas.svelte`
     (leyenda + a11y + estilos), `client/src/components/ItineraryPanel.svelte`
     (`role="list"`, `dur()`), `client/src/components/OptionCard.svelte`
     (`tickpop`, activate() ignora clics en controles internos),
     `client/src/components/TimelineRow.svelte` (`role="listitem"`),
     `client/src/lib/map.js` (`keyboard`/`alt`/`focus`/`blur` en marcadores,
     `FIT_INSETS`/`PAN_INSETS`), `client/src/app.css` (tokens de contraste, zoom
     táctil oculto).
   - `package.json`, `server.js`, `.env`, `.env.example`: sólo cadena de versión.

7. **Algoritmos/constantes.** Ninguna fórmula del itinerario cambia. `FIT_INSETS`
   / `PAN_INSETS` (encuadre del mapa) y el breakpoint 1024px son de presentación.

8. **Nuevos invariantes.** "Itinerario siempre visible" se cumple como rail fijo
   (escritorio) o pestaña de la hoja (móvil/tablet). El contenido de planificación
   vive en `{#snippet planContent}` y el itinerario en `{#snippet itinContent}`:
   cualquier cambio de layout futuro reutiliza esos snippets, no duplica markup.

9. **Qué se conserva.** Todo. Backend intacto. Paridad funcional con v1.1.5 y con
   alpha.1/alpha.2. Todos los criterios de §41 revisados (ver punto 14).

10. **Fallbacks.** Sin cambios. La hoja móvil arranca abierta en la pestaña
    Opciones; la pestaña Itinerario se habilita al elegir base.

11. **Impacto UI.** Móvil/tablet pasan de rails superpuestos a hoja inferior con
    pestañas. Leyenda nueva en escritorio. Sin cambios de flujo.

12. **Impacto APIs.** Ninguno.

13. **Compatibilidad.** Sin cambios de datos/caché. `localStorage` sigue guardando
    sólo `tp-theme`.

14. **Pruebas.** `vite build` sin warnings. `node --check server.js` OK. Smoke
    Playwright a 1440 / 768 / 390: flujo completo, layout conmuta (rails ↔ hoja),
    pestaña Itinerario con 7 filas en móvil/tablet, sin errores de consola.
    Repaso §41: arranque (log "Travel Planner 1.2.0"), búsqueda (Almería 1ª,
    orden por interés), elección de base, carga de opciones (5 grupos), selección
    múltiple, duración editable, recálculo inmediato, comida protegida,
    desplazamientos con minutos a la izquierda, sin duplicados, badges de fuente.

15. **Limitaciones que permanecen.**
    - Spur y línea de destino siguen siendo trazos rectos (dato numérico real;
      geometría de carretera exacta = `/api/metrics/route-detour` opcional, no
      hecho).
    - Marcadores de destino agrupados junto a la base a zoom de corredor; se
      resuelven al señalar (resalta + centra). Sin clustering real.
    - Navegación por teclado del mapa: los marcadores son focusables y resaltan la
      tarjeta, pero la lista sigue siendo la superficie principal de interacción.
    - Bug preexistente de `geocode()` con destinos ambiguos (`limit=1`) sin
      resolver — fuera del alcance del rework.
    - `doc/legacy-ui/` conserva la UI vanilla como referencia; se puede borrar
      cuando ya no haga falta.

---

## v1.2.0-alpha.2 — Rework frontend · Fase 2 (mapa con ruta e indicadores de opciones)

1. **Versión.** 1.2.0-alpha.2 (segunda de tres fases).

2. **Motivo.** Requisito destacado del rework: que el mapa muestre la ruta y deje
   ver de un vistazo qué implica meter cada opción en el día.

3. **Problema.** En alpha.1 el mapa sólo dibujaba el corredor y los pines
   origen/base. No había forma visual de comparar opciones ni su desvío.

4. **Comportamiento anterior.** `map.js` exponía `showRoute` / `clearRoute` /
   `setTheme`. `MapCanvas.svelte` sólo pasaba `routeData/origin/chosen/theme`.

5. **Comportamiento nuevo.**
   - `createMapController` amplía su API: `setHoverCallback`, `showOptions(pools,
     selected)`, `setHovered(id)`. Nuevas capas Leaflet: `spur` e `itinerary`.
   - **Marcadores de opción** para cada item con lat/lon:
     - Paradas en ruta: punto coloreado por coste de desvío (verde ≤12 min,
       ámbar ≤30, rojo >30 — `detourLevel` en `format.js`); al pasar el ratón o
       seleccionar, chip `+{extraMin} min · +{extraKm} km` (datos de
       `/api/metrics/route-options`).
     - Destino (actividades/comida/alojamiento): dots pequeños por categoría;
       etiqueta con el nombre sólo en hover/selección. Se pintan **todas** para
       que cualquier tarjeta tenga marcador al que saltar.
     - Seleccionadas: dot ampliado con halo de acento.
   - **Ramal de desvío ("spur")**: al señalar una parada de ruta se dibuja
     origen→parada→base en discontinuo, con el color del coste y un chip de
     delta. Responde al store `hoveredOptionId`.
   - **Línea del itinerario en destino**: base → check-in → actividades → cena,
     con números de orden. El tramo origen→base ya lo representa el corredor
     real, así que no se duplica.
   - **Sync hover bidireccional lista↔mapa** vía store `hoveredOptionId`
     (las tarjetas y las filas del timeline ya lo emitían desde alpha.1; ahora
     el mapa también lo emite y lo consume). Al señalar un marcador de destino
     tapado por un panel, `panInside` lo trae a la franja visible.
   - Encuadre con márgenes (`FIT_INSETS`) para no quedar bajo los rails.

6. **Archivos y funciones afectadas.**
   - `client/src/lib/map.js`: reescrito. Nuevas capas, `optionIcon()`,
     `renderMarkers()`, `showSpur()`, `drawItineraryLine()`, `setHovered()`,
     `FIT_INSETS`/`PAN_INSETS`.
   - `client/src/components/MapCanvas.svelte`: props `pools`, `selected`;
     `$effect` para opciones y para `hoveredOptionId`; estilos de marcadores,
     chips, spur y números de secuencia.
   - `client/src/App.svelte`: pasa `pools={hasPlan ? viewPools : null}` y
     `selected` a `MapCanvas`.
   - `package.json`: version 1.2.0-alpha.2.

7. **Algoritmos/constantes.** Umbrales de `detourLevel` (12 / 30 min) — nuevos,
   sólo para el color del marcador; no afectan a ningún cálculo del itinerario.
   `FIT_INSETS` / `PAN_INSETS` son márgenes de encuadre, no lógica.

8. **Nuevos invariantes.** El mapa es una **vista** de `pools`/`selected`: no
   muta estado. `hoveredOptionId` es la única vía de sincronización lista↔mapa.
   Los chips de desvío usan siempre `extraKm`/`extraMin` del backend, nunca se
   recalculan en el cliente.

9. **Qué se conserva.** Todo lo de alpha.1 y v1.1.5. El corredor base sigue
   dibujándose desde `routeData.coords`. Ninguna llamada nueva a la API.

10. **Fallbacks.** Si un item no trae `extraMin` (métricas no disponibles), el
    marcador de ruta queda neutro y sin chip; el resto funciona igual.

11. **Impacto UI.** El mapa pasa a ser informativo: coste de desvío por color,
    detalle en hover, ramal de "qué implica", línea del día en destino.

12. **Impacto APIs.** Ninguno. Se siguen usando los mismos endpoints; los datos
    de `/api/metrics/route-options` (ya existentes) alimentan los indicadores.

13. **Compatibilidad.** Sin cambios de datos/caché.

14. **Pruebas.** `vite build` limpio. Smoke Playwright ampliado: 16 marcadores de
    ruta con dot de color, ~102 de destino; hover de tarjeta → marcador
    `is-hover` + chip con nombre; hover de parada → spur + chip `+km/+min`;
    selección → marcadores `is-selected` + línea de itinerario; timeline
    recalcula. Verificación visual claro y oscuro (spur verde con delta).

15. **Limitaciones que permanecen.**
    - El spur y la línea de destino son **trazos rectos** entre waypoints, no
      geometría real de carretera (suficiente como esquema de coste; el dato
      numérico sí es real). Un `/api/metrics/route-detour` opcional queda
      anotado para más adelante.
    - Muchos marcadores de destino se agrupan junto a la base a zoom de
      corredor; se resuelven al pasar el ratón (resalta + centra). Clustering
      real queda para Fase 3 si hace falta.
    - Pendiente Fase 3: responsive/bottom-sheet, accesibilidad de teclado en
      marcadores, leyenda del mapa, pulido de motion, y bump a v1.2.0 final
      (incluye `server.js` y `APP_USER_AGENT`).

---

## v1.2.0-alpha.1 — Rework frontend map-forward · Fase 1 (shell + sistema de diseño)

1. **Número de versión nuevo.** 1.2.0-alpha.1 (primera de tres fases hacia v1.2.0).

2. **Motivo del cambio.** Petición del usuario: rework visual y de UX completo,
   nivel producto comercial, con mapas que muestren la ruta y el coste de incluir
   cada opción. Manteniendo el 100% de la funcionalidad de v1.1.5.

3. **Problema que se intenta resolver.** La UI vanilla era funcional-plana, sin
   mapa, y no dejaba ver el impacto (km/min de desvío) de añadir una parada.

4. **Comportamiento anterior.** Frontend en `public/{index.html,app.js,styles.css}`,
   JS vanilla, sin build, itinerario en columna sticky, sin mapa.

5. **Comportamiento nuevo (Fase 1).**
   - Stack nuevo: Vite 6 + Svelte 5; fuente en `client/`, build a `public/`.
   - Layout *map-forward*: mapa Leaflet a pantalla completa de fondo; paneles
     "glass" flotantes plegables (izq: búsqueda → bases → preferencias +
     opciones; der: itinerario).
   - Sistema de diseño "Travel cálido" (`client/src/app.css`): acento ámbar/
     terracota, neutros arena, verde de validez, escala verde→ámbar→rojo para el
     coste de desvío; temas claro/oscuro (sistema + toggle manual, persistido en
     localStorage `tp-theme`).
   - Mapa (Fase 1): teselas Esri Gray Canvas claras/oscuras (sin clave API),
     polilínea de la ruta base + marcadores origen/base, `fitBounds`. Los
     marcadores de opción y los "spurs" de desvío llegan en Fase 2.
   - Toda la lógica de negocio portada VERBATIM (ver §46): `buildItinerary`,
     `approximateSchedule`, `isLunchViable`, preferencias, duraciones. Mismos
     límites (comida 12:30–14:30, día 22:30, duración 1–720/step 5) y mismo orden
     de eventos.

6. **Archivos y funciones afectadas.**
   - NUEVOS: `vite.config.js`; todo `client/`; `scripts/smoke.mjs`;
     `doc/legacy-ui/` (copia de la UI vieja).
   - `package.json`: version 1.2.0-alpha.1; scripts `dev`/`build`/`start`/`preview`/
     `check`; deps `leaflet`; devDeps `vite`, `svelte`, `@sveltejs/vite-plugin-svelte`,
     `concurrently`, `playwright`.
   - `server.js`: SIN cambios de lógica (solo servía `public/`, que ahora es el
     build). Log de arranque sigue diciendo "Travel Planner 1.1.5" — pendiente de
     subir a 1.2.0 al cerrar la versión final (Fase 3).
   - `.env` / `.env.example`: `APP_USER_AGENT` a 1.1.5 (pendiente 1.2.0 en Fase 3).
   - `public/`: regenerado por `vite build`.

7. **Algoritmos, fórmulas, límites o constantes modificados.** NINGUNO. La lógica
   es traducción literal. Constantes de tiempo en `client/src/lib/itinerary.js`
   (`LUNCH_START=750`, `LUNCH_END=870`, `DINNER_MIN=1140`, `DAY_END=1350`) y el
   factor local `1.22 / 28 km/h / min 5` en `format.js` son idénticos a `app.js`.

8. **Nuevos invariantes funcionales.**
   - `public/` es artefacto de build: no se edita a mano.
   - El backend y todos sus endpoints/payloads permanecen intactos.
   - `client/src/lib/{itinerary,scoring}.js` deben seguir siendo funciones puras
     que reproducen `app.js`; cualquier cambio de comportamiento se documenta.

9. **Qué comportamiento anterior debe conservarse.** Todo: búsqueda, ranking por
   interés (distancia = filtro), elección de base, carga de opciones en paralelo,
   selección múltiple de paradas/actividades, duración editable que manda,
   comida protegida, ocultación por viabilidad, avisos del día, badges de fuente
   y "Generado", enlaces "Más información".

10. **Fallbacks y tratamiento de errores.** Igual que antes a nivel de API
    (`api.js` propaga `error` del backend). Cada bloque de opciones se pide con
    `.catch` que devuelve lista vacía (como en `app.js`). El mapa: si una tesela
    falla, Leaflet reintenta; fallback de proveedor documentado en `map.js`
    (`TILE_FALLBACK` = OSM).

11. **Impacto en UI y experiencia del usuario.** Rework visual completo. Mismo
    flujo y mismas capacidades. Mapa nuevo. Plegado de paneles. Tema oscuro.

12. **Impacto en APIs/proveedores externos.** Ninguno en la API propia. Nuevo
    consumo de teselas Esri (gratis, con atribución "Teselas © Esri"). En dev,
    Vite proxya `/api` a `:3000`.

13. **Compatibilidad con datos/caché/versiones anteriores.** `data/cache.json`
    sin cambios. No hay estado de cliente persistente salvo `localStorage`
    `tp-theme` (preferencia de tema).

14. **Pruebas o validaciones realizadas.**
    - `vite build` sin warnings ni errores.
    - `node scripts/smoke.mjs` (Playwright + Chrome): carga la app, busca
      Málaga→Almería (Almería aparece 1ª), elige base, carga opciones (5 grupos,
      ~168 tarjetas), selecciona parada + actividad (timeline pasa de 5 a 8
      filas), edita duración sin crash, activa preferencia "Museos", mapa con
      teselas y polilínea de ruta. Sin errores de consola ni excepciones.
    - Verificación visual de tema claro y oscuro (capturas).

15. **Limitaciones conocidas que permanecen.**
    - Fase 1 no incluye todavía: marcadores de opción en el mapa, chips de
      desvío sobre el mapa, línea del itinerario real, ni el pulido responsive/
      accesibilidad final (Fases 2 y 3).
    - `server.js` y `APP_USER_AGENT` aún marcan 1.1.5; se suben a 1.2.0 al cerrar
      Fase 3.
    - Persiste el bug preexistente de `geocode()` con `limit=1` (destinos
      ambiguos, "Granada" → país del Caribe). Fuera de alcance de este rework.
    - Teselas Esri Gray Canvas llegan hasta zoom nativo 16 (se sobre-escala).

---

## v1.1.5 — Descubrimiento de bases restringido a núcleos reales

1. **Número de versión nuevo.** 1.1.5.

2. **Motivo del cambio.** Al buscar Málaga → Almería (200 ±40 km), Almería no
   aparecía nunca entre las bases propuestas, pese a estar a ~221 km (dentro del
   rango válido 160–240).

3. **Problema que se intenta resolver.** El descubrimiento de candidatas
   (`discoverBaseCandidates`) consultaba la categoría genérica `populated_place`
   de Geoapify. En el corredor Málaga→Almería esa categoría devuelve sobre todo
   cortijos, diseminados, aldeas mínimas y barrios sueltos ("El Canalillo",
   "Mojón Gordo", "Cañada de la Cueva de Almagro", además de barrios de la propia
   Almería como "Torrecárdenas"). Con `limit:24` por anchor y concatenación por
   orden de anchor, esos núcleos llenaban la lista; el recorte `unique.slice(0,40)`
   —y después `cands.slice(0,36)` antes de `routeTable`— dejaba fuera Almería
   (aportada por el reverse geocoding del último anchor, en la posición ~121).
   Nunca se le calculaba `roadKm`, así que nunca se comparaba contra 160–240.
   El filtro de kilometraje NO tenía ningún error; el problema era que a Almería
   no se le llegaba a medir la distancia. Por el mismo motivo tampoco aparecían
   Aguadulce (~200 km) ni Roquetas de Mar.

4. **Comportamiento anterior.** `geoapifyPopulatedPlaces` pedía
   `categories=populated_place`. `discoverBaseCandidates` deduplicaba y devolvía
   `unique.slice(0,40)` sin ordenar. El peso por tipo (`typeWeight`) sólo se
   aplicaba dentro de `/api/search/candidates`, DESPUÉS del filtro de kilometraje,
   como constante local del handler.

5. **Comportamiento nuevo.**
   - `geoapifyPopulatedPlaces` pide
     `categories=populated_place.city,populated_place.town,populated_place.village`.
   - `discoverBaseCandidates`, tras deduplicar y antes de `slice(0,40)`, ordena
     la lista de forma estable por `BASE_TYPE_WEIGHT` descendente.
   - `BASE_TYPE_WEIGHT` es constante de módulo (`{city:4,town:3,village:2,suburb:1,place:0}`),
     compartida; el handler `/api/search/candidates` la reutiliza en lugar de su
     copia local `typeWeight`.
   - Resultado en Málaga→Almería 200 ±40: Almería sale 1ª (interés 100, `city`),
     seguida de Aguadulce, El Ejido, Roquetas de Mar, Almerimar, Dalías…

6. **Archivos y funciones afectadas.**
   - `server.js`: nueva constante `BASE_TYPE_WEIGHT` (junto a `FRESH_TTL`);
     `geoapifyPopulatedPlaces()` (parámetro `categories`);
     `discoverBaseCandidates()` (sort antes del recorte);
     handler `POST /api/search/candidates` (usa `BASE_TYPE_WEIGHT`, se elimina la
     constante local `typeWeight`).
   - `package.json`: `version` 1.1.4 → 1.1.5; `description` ampliada.
   - `public/index.html`: `<title>` (estaba obsoleto en "0.9") y badge de versión → 1.1.5.
   - `.env` y `.env.example`: `APP_USER_AGENT` → `TravelPlannerPersonal/1.1.5 (personal-use)`.
   - Default de `USER_AGENT` y log de arranque en `server.js` → 1.1.5.

7. **Algoritmos, fórmulas, límites o constantes modificados.** Ninguna fórmula de
   puntuación cambia. Cambian: la categoría consultada a Geoapify y el momento en
   que se aplica el peso por tipo (ahora también antes del `slice(0,40)` de
   descubrimiento). Límites 28 km / 24 por anchor / 40 / 36 / 18 / 8 sin cambios.

8. **Nuevos invariantes funcionales.**
   - El descubrimiento de bases sólo considera núcleos `city`/`town`/`village`;
     nunca `hamlet`, `isolated_dwelling`, `farm`, `suburb`, `neighbourhood` ni el
     genérico `populated_place` sin subtipo.
   - Una localidad de tipo superior (ciudad > pueblo > villa) nunca queda fuera
     del recorte de candidatas por volumen de núcleos de tipo inferior.

9. **Qué comportamiento anterior debe conservarse.** El kilometraje sigue siendo
   filtro y no puntuación (§2.1). El ranking final sigue siendo exclusivamente
   `baseInterest` (§8). El reverse geocoding de cada anchor se mantiene como
   fallback. Radios, límites y número de resultados no cambian.

10. **Fallbacks y tratamiento de errores.** Sin cambios. Si Geoapify falla,
    `discoverBaseCandidates` sigue cayendo al reverse geocoding de los anchors.
    Si con el filtro más estricto un corredor muy rural devolviera pocas
    candidatas, el reverse geocoding aporta al menos la localidad exacta de cada
    anchor.

11. **Impacto en UI y experiencia del usuario.** Las bases propuestas pasan a ser
    localidades reales (ciudades y pueblos) en vez de topónimos rurales sin
    contenido. No cambia el layout ni ningún flujo.

12. **Impacto en APIs/proveedores externos.** Mismo endpoint Geoapify
    `/v2/places`, sólo cambia el valor de `categories`. Mismo volumen de llamadas.

13. **Compatibilidad con datos/caché/versiones anteriores.** La caché de
    `quickBaseSummary` (`baseSummary:v2:`) y de contenido (`content:v3:`) sigue
    siendo válida: se indexa por coordenadas de la base, no por el conjunto de
    candidatas. No se invalida nada. Entradas antiguas de bases que ya no se
    descubren simplemente dejan de consultarse.

14. **Pruebas o validaciones realizadas.**
    - `node --check server.js` y `node --check public/app.js`: OK.
    - Málaga → Almería, 200 ±40: Almería 1ª (206 km vía OSRM table, interés 100,
      `city`); resto = Aguadulce, El Ejido, Roquetas de Mar, Almerimar, Dalías,
      El Parador de las Hortichuelas, Campillo del Moro. Antes: 8 aldeas de
      160–172 km (Balanegra, Balerma, Los Isidros…).
    - Málaga → Cádiz, 180 ±40: Algeciras, Tarifa, Medina Sidonia, Los Barrios,
      Facinas, Benalup… (núcleos reales del corredor, sin regresión).

15. **Limitaciones conocidas que permanecen.**
    - El etiquetado OSM de `place=*` tiene ruido: algún núcleo pequeño llega
      etiquetado como `town` ("El Parador de las Hortichuelas", "Campillo del
      Moro"). No es grave: el ranking por interés los coloca por debajo.
    - Algún resort costero real podría estar etiquetado `hamlet` y quedar fuera;
      no se ha observado en las pruebas.
    - **No corregido aquí (bug preexistente, ajeno a este cambio):** `geocode()`
      usa `limit=1` sin sesgo de país ni preferencia de tipo, así que un destino
      orientativo ambiguo puede resolverse mal ("Granada" → Grenada, país del
      Caribe; "Málaga" sin tildes → un punto en Grecia). Candidato a una versión
      futura (añadir `countrycodes`/`accept-language` o preferencia de `type`).

---

## v1.1.4 — Estado documentado hasta v1.1.4

### Cambio principal

La distancia deja definitivamente de participar en el ranking.

### Nuevo comportamiento

Con:

```text
200 ±40 km
```

se consideran válidas bases de:

```text
160–240 km
```

y dentro de ese conjunto se ordenan exclusivamente por interés.

### Descubrimiento de localidades

Se añade búsqueda Geoapify `populated_place` alrededor de anchors del corredor.

### Ranking

`baseInterest` es la única nota que determina el orden.

`distanceFromIdealKm` se conserva sólo como información visual.

### UI

Cada base muestra:

- interés;
- km;
- duración de conducción;
- “Rango válido ✓”;
- diferencia respecto a distancia ideal, marcada como “no puntúa”;
- recuentos de contenido si están disponibles.

---

## v1.1.3

- duración explícita en eventos de desplazamiento;
- alojamiento estrictamente local;
- categorías de destino ampliadas;
- separación conceptual de ajuste de etapa e interés.

---

## v1.1.2

- fallbacks reforzados para opciones de destino.

---

## v1.1.1

- descripciones enriquecidas mediante Geoapify Place Details;
- Wikipedia/web/dirección;
- mejores descripciones contextuales.

---

## v1.1.0

- desplazamientos muestran duración en la columna izquierda.

---

## v1.0.x

- sticky itinerary;
- duración personalizada;
- métricas de desvío;
- valor de etapa;
- puntuaciones explicables;
- preferencias.

Varias subversiones corrigieron regresiones de inicialización y route stops.

---

# 44. INSTRUCCIÓN FINAL PARA LA PRÓXIMA IA/DESARROLLADOR

Antes de realizar cualquier cambio:

> **No asumas que una función aparentemente extraña es accidental. Revisa primero este documento y el historial de regresiones.**

Cuando un subsistema funciona:

> **modifícalo lo mínimo posible.**

Cuando una API falla:

> **no conviertas fallo de datos en ausencia real de lugares.**

Cuando la distancia está dentro del rango:

> **no la utilices para ordenar las bases.**

Cuando una nueva versión esté terminada:

> **actualiza este documento antes de entregarla.**

Este archivo debe seguir siendo suficientemente completo para que otra IA pueda retomar el proyecto sin acceso a la conversación histórica.

---

# 45. RESUMEN OPERATIVO EN UNA FRASE

Travel Planner debe encontrar **bases interesantes dentro de una ventana de kilómetros**, permitir construir un día flexible seleccionando múltiples paradas y actividades con tiempos editables, proteger comidas y coherencia geográfica/temporal, y seguir funcionando de forma útil incluso cuando alguno de sus proveedores externos falle.

---

# 46. ARQUITECTURA FRONTEND v1.2.0 (rework map-forward)

## 46.1. Por qué hay build step (desviación consciente de §3 y §0.5)

El handoff pedía "sin build step" y "no reescribir lo que funciona". El usuario
pidió explícitamente un rework total con Vite + framework ligero. Se elige Svelte
por su runtime pequeño, sus transiciones integradas y su modelo de estado simple.

Mitigación del riesgo (regla de oro §0.5): **el backend no se toca** y **la lógica
de negocio del cliente se porta literalmente**, no se rediseña. La UI vanilla
anterior se conserva en `doc/legacy-ui/` como referencia de comportamiento.

## 46.2. Cómo ejecutar

```text
npm install                # una vez (instala también devDeps de build)
npm run build              # compila client/ -> public/
npm start                  # node server.js, sirve public/ en http://localhost:3000

npm run dev                # desarrollo: backend :3000 + Vite :5173 (proxy /api)
                           #   -> abrir http://localhost:5173
node scripts/smoke.mjs     # test e2e del flujo principal (requiere Chrome/Edge)
node --check server.js     # el backend sigue validándose así
```

`server.js` sólo sirve estáticos de `public/`. Si `public/` está vacío o
desactualizado, ejecutar `npm run build`.

## 46.3. Estado y flujo (equivalencias con app.js)

| app.js (v1.1.5)                     | v1.2.0                                            |
|------------------------------------|--------------------------------------------------|
| variables sueltas de estado        | stores de `client/src/lib/stores.js`             |
| `rebuild()`                        | `buildItinerary()` en `lib/itinerary.js` + `$effect` en App.svelte con guarda `rebuildSeq` |
| `approximateSchedule()`            | `approximateSchedule()` en `lib/itinerary.js`    |
| `updateViability()` (ocultaba cards) | `lateActivityIds` / `lateLunchKeys` (`$derived.by` en App) → avisos `lateFinish`/`lateArrival` en `OptionCard`, nunca filtros (desde v1.2.24) |
| `sortPools()` + `preferenceBonus()`| `applyPreferences()` en `lib/scoring.js` sobre `viewPools` (`$derived`) |
| `customDurations` (Map global)     | store `customDurations` (Map en writable) + `selectedDuration`/`setCustomDuration` |
| `bindSelections()`                 | `toggleRouteStop`/`toggleActivity`/`setLunch`/`setDinner`/`setHotel` en stores.js |
| `exactTravelLegs()`                | `api.travelSequence()`                            |
| `leftTimelineValue()`, `evt()`     | `leftTimelineValue()` en `lib/itinerary.js`; eventos llevan además `name`/`mins`/`item` para enlazar con el mapa |

El bug histórico de inicialización de `customDurations` (§17, §38.7) deja de ser
posible: ya no es una variable con orden de declaración frágil, es un store.

## 46.4. Reglas que siguen vigentes en el código nuevo

- Distancia = filtro, ranking = interés (§2.1). El cliente no reordena bases por
  `distanceFromIdealKm`.
- Comida protegida 12:30–14:30 sólo para el **bloque reservado** sin restaurante
  (§2.8); un restaurante elegido va a su objetivo 14:00 / límite 15:00 y la cena
  a 20:00 / 21:00, reordenando (§20, §29), sin suelo. Lo hace `orderDay(...,opts)`
  + `buildItinerary`.
- Límite del día 22:30 (§2.10, §29): `DAY_END` en `itinerary.js`. Desde v1.2.24
  **ninguna opción se oculta** por horario/viabilidad en ninguna sección; las que
  romperían un límite llevan un aviso en la ficha y siguen siendo elegibles.
- Desplazamientos: columna izquierda = duración (§26): `leftTimelineValue`.
- "No pude consultar" ≠ "0 resultados" (§2.4): los `.catch` devuelven listas
  vacías sin romper el resto; los fallbacks del backend siguen marcándose
  `source:"generated"` / `verified:false` y la UI los muestra como "Generado".

## 46.5. Mapa

`client/src/lib/map.js` expone `createMapController(container)` con
`setTheme` / `showRoute` / `clearRoute` / `showOptions(pools, selected, openGroup)` /
`setHovered` / `setHoverCallback` / `setActivateCallback` / `drawSpur` /
`drawItineraryRoute` / `invalidate` / `destroy`. Teselas Esri Gray Canvas
(claro/oscuro). `zoomSnap: 1` obligatorio: Esri usa niveles LOD enteros y un
zoom fraccionado devuelve teselas rotas. Para cambiar de proveedor, editar
`TILES` / `ESRI_ATTR` (fallback OSM documentado en el mismo archivo).

Capas (de abajo a arriba): teselas → `routeCasing`/`route` (corredor base
discontinuo) → `spur` (ramal de desvío en hover de una parada) → `itinerary`
(línea base→check-in→actividades→cena, con números de orden) → `markers`
(pines origen/base + dots de opción).

**Fase 2:** marcadores por opción, color por coste de desvío, chip `+min/+km`
(de `/api/metrics/route-options`), spur origen→parada→base, línea de itinerario
en destino, sync hover bidireccional lista↔mapa (`hoveredOptionId`) con
`panInside` para marcadores tapados por paneles.

**Fase 3:** leyenda del mapa (escala de desvío + categorías), marcadores
focusables por teclado (`keyboard`/`alt` + `focus`/`blur` → `hoveredOptionId`),
zoom de Leaflet oculto en táctil (≤1024px).

**Visibilidad de marcadores (desde v1.2.8):** una opción **seleccionada** se pinta
SIEMPRE (punto con su color de categoría/desvío + borde blanco grueso, halo y
marca ✓). Una opción **no seleccionada** sólo se pinta si su grupo del acordeón
está desplegado (`openOptionGroup`, store): `route`→paradas, `act`→actividades,
`lunch`→comida en ruta + comida en destino, `dinner`→comida en destino,
`hotel`→alojamiento. Pulsar un marcador abre su grupo (`groupOfOptionId`) y pide
revelar la fila (`revealOptionId` → `OptionsPanel` hace `scrollIntoView`).

**Paradas personalizadas (desde v1.2.8):** stores `customStops` (siempre en
`selected.route`) y `mapPickMode`. Se añaden por nombre (`api.geocode({q})`) o por
pin en el mapa (`mapPickMode` + clic → `api.geocode({lat,lon})`).
`addCustomStopEnriched` calcula el progreso en la ruta y pide
`/api/metrics/route-options` para las métricas de desvío. Se dibujan como punto
cuadrado (`is-custom`). Quitarlas (`removeCustomStop`) borra de `customStops`,
`selected.route` y `customDurations` — sin rastro, no recuperable.
`App.svelte` fusiona `customStops` en `planPools.route` (no las filtran las
preferencias).

**Pendiente (opcional, no bloqueante):** geometría real del desvío vía nuevo
`/api/metrics/route-detour` (hoy son trazos rectos; el número sí es real);
clustering de marcadores de destino si el volumen molesta.

## 46.6. Responsive

Breakpoint `max-width: 1024px` detectado con `window.matchMedia` en `App.svelte`
(`narrow`).

### ≥1025px — escritorio (Fase 3)

Dos rails flotantes plegables (`.rail--left` / `.rail--right`). `.rail` y
`.rail__scroll` llevan `pointer-events: none` (los huecos dejan pasar el ratón al
mapa); sólo `.rail--left .rail__scroll` y `.rail__scroll > *` (las tarjetas)
reciben el ratón. Como las tarjetas llegan hasta el borde, tapaban el pulgar de
la barra de scroll: por eso `.rail__scroll` lleva **`scrollbar-gutter: stable`**
(desde v1.2.23). El contenido de escritorio vive en `{#snippet planContent()}` +
`{#snippet itinContent()}`.

### ≤1024px — móvil map-primary (desde v1.2.26)

Sustituye a la hoja con pestañas anterior. El mapa ocupa el viewport completo y
es la superficie principal. Toda la entrada de datos vive en **una hoja enfocada
a una sola tarea**, invocada desde una **barra flotante inferior**
(`MobileBar.svelte`).

- Store `mobileTask` (`stores.js`): tarea/hoja activa. `null` = sólo mapa + barra.
  Los valores de categoría de opción (`route`/`custom`/`lunch`/`act`/`dinner`/
  `hotel`) coinciden con `openOptionGroup`; el resto: `search`/`prep`/`tune`/`itin`.
- `MobileBar` muestra botones con icono + badge según la fase: sin base →
  «Buscar etapa»; base sin plan → «Preparar el día»; con plan → Ajustes · Paradas
  · Añadir · Comida · Cena · Dormir · Planes · Itinerario. `open(task)` fija
  `mobileTask` y sincroniza `openOptionGroup`.
- La hoja (`.m-sheet` en `App.svelte`) tiene cabecera (título de `SHEET_TITLES`,
  asa y ✕) y cuerpo con scroll. `closeSheet()` pone `mobileTask` y
  `openOptionGroup` a `null`.
- **Alturas (desde v1.2.27).** Las hojas de opción (`route`/`custom`/`lunch`/
  `act`/`dinner`/`hotel`) **no tapan el mapa**: van sin scrim, por encima de la
  barra (`bottom: 78px`) y a media altura (`44vh`, «peek»); el asa
  (`.m-sheet__grab` → `sheetExpanded`) las amplía a `80vh` y vuelve a bajarlas.
  Cambian a peek al cambiar de tarea. Sólo `search` e `itin` (en `SCRIM_TASKS`)
  ocupan pantalla completa (`88vh`, `bottom: 0`) con scrim. El derivado
  `mapBottomInset` (px, según `winH` y peek/tall) se pasa a `MapCanvas` →
  `ctl.setBottomInset()` → `fitToRoute()` reencuadra la ruta en la mitad visible.
  Con «marcar en el mapa» activo la hoja se repliega (`.is-ducked`) dejando el asa.
- `{#snippet mobileTaskView(task)}` reparte el contenido reutilizando los
  componentes de escritorio: `SearchPanel`+`BaseResults` (search), la mini-tarjeta
  de salida+`loadPlan` (prep), hora de salida+`PreferencesBar` (tune),
  `ItineraryPanel` (itin) y `OptionsPanel mobile` (categorías de opción — ver §28).
- Un toque en un pin del mapa hace `openOptionGroup.set(g)`; un `$effect` en
  `App.svelte` abre la hoja de esa tarea en móvil.
- Barra de viaje compacta (`.m-trip`) sobre el mapa cuando hay base elegida, con
  «cambiar» → `mobileTask='search'`.
- Toda la rama de escritorio queda intacta; `narrow` sigue en 1024 px (una sola
  ruta móvil para teléfono y tablet).

`client/src/lib/motion.js` (`dur(ms)`, `reducedMotion()`) envuelve las
transiciones `fly`; con `prefers-reduced-motion` devuelven 0. La regla global de
`app.css` ya anula `animation`/`transition` CSS.

## 46.7. Guardar / cargar el viaje (desde v1.2.29)

`client/src/lib/trip-state.js`:

- `buildSnapshot(extra)` — objeto serializable con **sólo lo no recomputable**:
  `searchContext` (sin `referenceRoute`), `baseResults`, `chosen`, `routeData`,
  `pools`, `selected`, `customStops`, `customDurations` (como pares), `preferences`
  (como array), `departureTime`. `extra` mezcla estado local de App
  (`planLoaded`, `originText`). Campo `v` = `TRIP_VERSION`.
- Las **coordenadas de ruta** van como array plano `[lat,lon,lat,lon,…]`
  (`packCoords`/`unpackCoords`): ~45 % menos que un array de `{lat,lon}`. Es el
  único bulto real (una ruta de 200 km ≈ 3600 puntos).
- `applySnapshot(s)` — vuelca a los stores. Lo derivado (itinerario, ruta del
  día, `legCache`, `activeRoute`) lo reconstruyen los `$effect` de `App.svelte`;
  la única red al cargar es `/api/plan/day` (normalmente en caché).

`App.svelte`:

- **Autoguardado**: un `$effect` con retardo de 1,5 s escribe la instantánea en
  `localStorage["dailytrip:trip"]` mientras hay base elegida. Un refresco o
  cierre no pierde nada.
- Al montar, si hay instantánea válida se ofrece una barra **«Continuar / Empezar
  de cero»** (`resumeSnap`); no se restaura sola.
- **Guardar viaje** (`ItineraryPanel`, junto a «Descargar itinerario`, sólo con
  plan cargado): descarga `dailytrip-<origen>-<destino>-<fecha>.json`.
- **Cargar viaje**: botón en la tarjeta de búsqueda (y en la hoja «search` de
  móvil) → `<input type=file>` oculto → `applyTrip()` valida `v` y vuelca todo.
