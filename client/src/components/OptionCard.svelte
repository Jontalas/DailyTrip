<script>
  import {
    customDurations,
    selectedDuration,
    recommendedMinutes,
    setCustomDuration,
    hoveredOptionId
  } from "../lib/stores.js";
  import { detourLevel } from "../lib/format.js";
  import {api} from "../lib/api.js";
  import { tip } from "../lib/tip.js";

  let {
    item: rawItem,
    mode = "multi",
    selected = false,
    phaseLabel = null,
    custom = false,
    quality = false,
    meal = null,
    lateArrival = false,
    lateFinish = false,
    ontoggle,
    onselect,
    onremove
  } = $props();

  let details=$state(null), contentBusy=$state(false),contentError=$state('');
  let item=$derived({...rawItem,...details});
  let photoIndex=$state(0);
  let failedImages=$state(new Set());
  let photo=$derived(item.images?.[photoIndex]);
  async function loadContent() {
    if(contentBusy || item.verified===false) return;
    contentBusy=true;contentError='';
    try {details=await api.placeContent(rawItem);}
    catch(e) {contentError=e.message;}
    finally {contentBusy=false;}
  }
  function imageFailed(url) {failedImages=new Set([...failedImages,url]);}
  const SOURCE_LABEL = {
    wikipedia: "Wikipedia",
    geoapify: "Geoapify",
    google: "Google Places",
    osm: "OpenStreetMap",
    cache: "caché reciente",
    "cache-stale": "caché antigua",
    generated: "generado por la app (sin lugar concreto)"
  };
  // Se comprueba token a token contra los segmentos de categoría (Geoapify usa
  // "catering.restaurant", "tourism.sights", "heritage"…). Orden = prioridad.
  const CAT = [
    [["museum"], "Museo"],
    [["gallery", "art_gallery"], "Galería"],
    [["viewpoint"], "Mirador"],
    [["heritage", "historic", "sights", "castle", "ruins", "monument", "archaeological_site", "memorial", "fort", "monastery", "church", "cathedral"], "Patrimonio"],
    [["beach"], "Playa"],
    [["nature_reserve", "national_park", "natural", "protected_area", "geopark", "forest"], "Naturaleza"],
    [["park", "garden", "dog_park"], "Parque"],
    [["zoo", "aquarium", "wildlife_park"], "Fauna"],
    [["theme_park", "amusement", "water_park"], "Ocio"],
    [["cafe"], "Cafetería"],
    [["restaurant", "fast_food", "catering"], "Restaurante"],
    [["hotel", "hostel", "motel", "accommodation", "guest_house", "apartment", "resort", "chalet", "camp_site", "hut"], "Alojamiento"],
    [["theatre", "cinema", "arts_centre", "nightclub", "entertainment"], "Ocio"],
    [["marina", "harbour", "maritime", "pier"], "Puerto"],
    [["attraction", "tourism", "landmark", "artwork"], "Atracción"],
    [["leisure"], "Ocio"],
    [["generated"], "Flexible"]
  ];
  function shortCat(item) {
    const cats = item.categories?.length ? item.categories : [item.category];
    const tokens = new Set(
      cats
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .split(/[^a-z_]+/)
        .filter(Boolean)
    );
    for (const [keys, label] of CAT) if (keys.some((k) => tokens.has(k))) return label;
    return "Lugar de interés";
  }

  let open = $state(false);
  $effect(() => {
    if (selected) open = true;
  });

  $effect(()=>{if(open && !details && !contentBusy && !contentError) loadContent();});

  let interest = $derived(Math.round(item.adjustedInterest ?? item.interestScore ?? 0));
  let dur = $derived(selectedDuration(item, $customDurations));
  let recMin = $derived(item.durationRangeMin ?? Math.round(recommendedMinutes(item) * 0.7));
  let recMax = $derived(item.durationRangeMax ?? Math.round(recommendedMinutes(item) * 1.3));
  let det = $derived(item.extraMin != null ? detourLevel(item.extraMin) : null);
  // Descripción corta de Wikidata ("catedral en Almería") si la hay; si no, categoría.
  let catLabel = $derived(item.shortDesc ? capShort(item.shortDesc) : shortCat(item));
  function capShort(s) {
    s = String(s).trim();
    return s.length > 42 ? s.slice(0, 40) + "…" : s;
  }

  let subline = $derived(
    [
      catLabel,
      item.routeProgressPct != null ? `${item.routeProgressPct}% ruta` : null,
      item.rating ? `★ ${item.rating}` : null,
      `${recMin}–${recMax} min`,
      `interés ${interest}`
    ]
      .filter(Boolean)
      .join(" · ")
  );

  // Anticipo de la descripción en la fila colapsada (sólo si es una descripción
  // REAL, no una plantilla genérica). 2 líneas máx.
  let GENERIC = /localizado por las fuentes cartográficas|incluido por las fuentes cartográficas|es un lugar de interés/i;
  let descPreview = $derived(
    item.description && !GENERIC.test(item.description) && item.description.length > 60
      ? item.description
      : null
  );

  // Señales de calidad para comer/cenar/dormir (sólo si la fuente las trae).
  const PRICE = { 1: "€", 2: "€€", 3: "€€€", 4: "€€€€" };
  let qualityBits = $derived(
    !quality
      ? []
      : [
          item.stars ? `${"★".repeat(Math.max(1, Math.min(5, Math.round(item.stars))))} hotel` : null,
          item.rating ? `★ ${Number(item.rating).toFixed(1)}${item.userRatingCount ? ` (${item.userRatingCount})` : ""}` : null,
          item.priceLevel ? PRICE[Math.max(1, Math.min(4, Math.round(item.priceLevel)))] : null,
          item.cuisine ? String(item.cuisine).split(/[;,]/)[0].replace(/_/g, " ").trim() : null
        ].filter(Boolean)
  );

  let link = $derived(
    item.infoUrl ||
      item.website ||
      item.wikipediaUrl ||
      "https://www.google.com/search?q=" + encodeURIComponent(item.name || "")
  );
  let linkLabel = $derived(
    item.source === "wikipedia" || (item.wikipediaUrl && link === item.wikipediaUrl)
      ? "Wikipedia ↗"
      : "más info ↗"
  );

  function activate(e) {
    if (e?.target?.closest?.(".expand-btn, .drawer, a, .rm")) return;
    if (mode === "multi") ontoggle?.(item);
    // Single (comida/cena/alojamiento): volver a pulsar la seleccionada la quita.
    else onselect?.(selected ? null : item);
  }
  function onKey(e) {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate(e);
    }
  }
</script>

<div
  class="row"
  class:is-selected={selected}
  class:is-hovered={$hoveredOptionId === item.id}
  class:is-custom={custom}
  data-opt-id={item.id}
  onmouseenter={() => hoveredOptionId.set(item.id)}
  onmouseleave={() => hoveredOptionId.set(null)}
  role="presentation"
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="face"
    role="button"
    tabindex="0"
    aria-pressed={selected}
    onclick={activate}
    onkeydown={onKey}
  >
    <span class="tick" aria-hidden="true" data-mode={mode}></span>

    {#if item.imageUrl && !failedImages.has(item.imageUrl)}
      <img class="thumb" src={item.imageUrl} alt="" loading="lazy" onerror={()=>imageFailed(item.imageUrl)} />
    {/if}

    <div class="body">
      <div class="head">
      <b class="name" title={item.name}>{item.name}</b>
      {#if custom}<span class="tag tag--custom">personalizada</span>{/if}
      {#if phaseLabel}<span class="tag">{phaseLabel === "EN RUTA" ? "ruta" : "destino"}</span>{/if}
      {#if det}
        <span
          class="pill pill--{det}"
          use:tip={`Incluir esta parada añade +${item.extraMin} min y +${item.extraKm} km sobre la ruta directa`}
        >
          +{item.extraMin}′
        </span>
      {/if}
      <span
        class="src src--{item.source}"
        class:src--gen={item.verified === false}
        use:tip={`Fuente: ${SOURCE_LABEL[item.source] || item.source || "desconocida"}`}
      ></span>
      {#if custom}
        <button
          class="rm"
          type="button"
          aria-label={`Quitar ${item.name} del itinerario`}
          use:tip={"Quitar esta parada personalizada (no se podrá recuperar)"}
          onclick={() => onremove?.(item)}
        >×</button>
      {/if}
      <button
        class="expand-btn"
        type="button"
        aria-label={open ? "Ocultar detalles" : "Ver detalles"}
        aria-expanded={open}
        onclick={() => (open = !open)}
      >
        <span class="chev" class:up={open}></span>
      </button>
    </div>

      <p class="sub tnum" title={subline}>{subline}</p>

      {#if qualityBits.length}
        <p class="quality">{#each qualityBits as q, i}<span>{q}</span>{#if i < qualityBits.length - 1}<i>·</i>{/if}{/each}</p>
      {/if}

      {#if meal}
        <p class="availability-note">{meal==='lunch' && item.lunchOpening===false ? 'El horario publicado no cubre la comida: podría estar cerrado.' : 'Podría estar cerrado a tu llegada. Confirma el horario con el local.'}</p>
      {/if}
      {#if lateArrival}<p class="availability-note">Con el orden actual, comer aquí caería después de las 15:00. Al elegirlo se reordena la ruta para acercarlo a las 14:00; si aun así no cabe, verás un aviso.</p>{/if}
      {#if lateFinish}<p class="availability-note">Con el plan actual, elegirla haría terminar el día después de las 22:30. Puedes seleccionarla y ajustar el itinerario.</p>{/if}
      {#if descPreview && !open}
        <p class="preview">{descPreview}</p>
      {/if}
    </div>
  </div>

  {#if open}
    <div class="drawer">
        {#if contentBusy}<p class="content-note" role="status">Buscando información y fotografías…</p>{/if}
        {#if contentError || item.contentStatus === 'partial'}
          <p class="content-note">{contentError || 'Parte de la información no está disponible.'} <button type="button" onclick={loadContent}>Reintentar</button></p>
        {/if}
        {#if photo && !failedImages.has(photo.url)}
          <figure>
            <a href={photo.sourceUrl} target="_blank" rel="noopener"><img class="banner" src={photo.url} alt={photo.title || item.name} loading="lazy" onerror={()=>imageFailed(photo.url)} /></a>
            <figcaption>{photo.author} · {photo.license} · <a href={photo.sourceUrl} target="_blank" rel="noopener">Wikimedia Commons ↗</a></figcaption>
          </figure>
        {:else if item.imageUrl && !failedImages.has(item.imageUrl)}
          <figure><img class="banner" src={item.imageUrl} alt={item.name} loading="lazy" onerror={()=>imageFailed(item.imageUrl)} />
            <figcaption>{item.imageAttribution || 'Fotografía de la fuente'} {#if item.wikipediaUrl}<a href={item.wikipediaUrl} target="_blank" rel="noopener">Ver procedencia ↗</a>{/if}</figcaption>
          </figure>
        {/if}
        {#if item.images?.length>1}
          <div class="photo-picker" aria-label="Fotografías del lugar">{#each item.images as image,i}<button type="button" aria-pressed={photoIndex===i} onclick={()=>photoIndex=i}>Foto {i+1}</button>{/each}</div>
        {/if}
        {#if item.contentStatus==='limited'}<p class="content-note">Información documental limitada: no se ha encontrado un artículo que corresponda con seguridad a este lugar.</p>{/if}
        {#if item.description}
          <p class="desc">{item.description}</p>
          {#if item.descriptionSource}<p class="content-note">Texto: <a href={item.wikipediaUrl} target="_blank" rel="noopener">{item.descriptionSource}</a> · CC BY-SA. Extracto; consulta el artículo completo.</p>{/if}
        {/if}

        {#if item.kmFromOrigin != null}
          <div class="metrics metrics--{det}">
            <span use:tip={"Kilómetros por carretera desde el punto de salida hasta esta parada"}>
              salida <b class="tnum">{item.kmFromOrigin} km</b>
            </span>
            <span use:tip={"Kilómetros por carretera desde esta parada hasta la base final"}>
              destino <b class="tnum">{item.kmToDestination} km</b>
            </span>
            <span use:tip={"Desvío total: kilómetros de más frente a ir directo"}>
              desvío <b class="tnum">+{item.extraKm} km</b>
            </span>
            <span use:tip={"Tiempo de conducción de más frente a ir directo"}>
              +tiempo <b class="tnum">+{item.extraMin} min</b>
            </span>
          </div>
        {/if}

        {#if selected}
          <div class="duration">
            <label for={`dur-${item.id}`}>Tiempo que usaré</label>
            <div class="dur-input">
              <input
                id={`dur-${item.id}`}
                type="number"
                min="1"
                max="720"
                step="5"
                value={dur}
                oninput={(e) => setCustomDuration(item.id, e.currentTarget.value)}
                aria-label={`Minutos para ${item.name}`}
              />
              <span>min</span>
              <small use:tip={"Duración que suele recomendarse para este tipo de lugar"}>rec. {recMin}–{recMax}</small>
            </div>
          </div>
        {/if}

        <div class="place-links">
          <a href={`https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lon}`} target="_blank" rel="noopener">Cómo llegar ↗</a>
          {#if item.website && /^https?:\/\//.test(item.website)}<a href={item.website} target="_blank" rel="noopener">Web del lugar ↗</a>{/if}
          {#if item.galleryUrl}<a href={item.galleryUrl} target="_blank" rel="noopener">Más fotografías ↗</a>{/if}
        </div>
        <div class="drawer-foot">
          {#if item.interestBreakdown}
            {@const bd = item.interestBreakdown}
            <span
              class="why"
              use:tip={`Tipo ${bd.category} · Relevancia ${bd.popularity} · Información ${bd.completeness} · Fiabilidad ${bd.reliability}  (0–100 cada uno)`}
            >
              desglose
            </span>
          {/if}
          {#if item.openingHours}
            <span class="hours" use:tip={`Horario informado por la fuente: ${item.openingHours}`}>horario ⓘ</span>
          {/if}
          <a class="more" href={link} target="_blank" rel="noopener">{linkLabel}</a>
        </div>
    </div>
  {/if}
</div>

<style>
  .availability-note {margin-top:4px;font-size:11px;line-height:1.4;color:var(--text-soft);}
  figure {margin:0;}
  figcaption,.content-note {font-size:10px;line-height:1.5;color:var(--text-faint);}
  .content-note button {text-decoration:underline;color:var(--accent);}
  .place-links,.photo-picker {display:flex;flex-wrap:wrap;gap:8px;font-size:11px;}
  .photo-picker button {padding:4px 8px;border:1px solid var(--line);border-radius:var(--r-sm);}
  .photo-picker button[aria-pressed="true"] {background:var(--accent-tint);}

  .row {
    padding: 8px 10px;
    border-radius: var(--r-sm);
    border: 1px solid transparent;
    min-width: 0;
    max-width: 100%;
    transition: background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out);
  }
  .face {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-2);
    min-width: 0;
    cursor: pointer;
  }
  .face:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--r-xs);
  }
  .thumb {
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: var(--r-xs);
    object-fit: cover;
    background: var(--surface-2);
  }
  .banner {
    width: 100%;
    max-height: 170px;
    aspect-ratio: 16 / 9;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--surface-2);
  }
  .row:hover,
  .row.is-hovered {
    background: var(--surface-2);
  }
  .row.is-selected {
    background: color-mix(in srgb, var(--accent-tint) 55%, transparent);
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .row.is-custom {
    border-left: 3px solid var(--text);
  }

  .tick {
    width: 16px;
    height: 16px;
    margin-top: 2px;
    border: 2px solid var(--line-strong);
    background: var(--surface);
    transition: background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out);
  }
  .tick[data-mode="multi"] {
    border-radius: 5px;
  }
  .tick[data-mode="single"] {
    border-radius: 50%;
  }
  .is-selected .tick {
    background: var(--accent);
    border-color: var(--accent);
    box-shadow: inset 0 0 0 3px var(--surface);
    animation: tickpop var(--dur-2) var(--ease-spring);
  }
  @keyframes tickpop {
    0% {
      transform: scale(0.5);
    }
    60% {
      transform: scale(1.15);
    }
    100% {
      transform: scale(1);
    }
  }

  .body {
    flex: 1;
    min-width: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .name {
    font-size: var(--fs-13);
    font-weight: 650;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }
  .tag {
    flex: none;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-faint);
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    padding: 0 5px;
  }
  .tag--custom {
    color: var(--surface);
    background: var(--text);
    border-color: var(--text);
  }
  .rm {
    flex: none;
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    font-size: 15px;
    line-height: 1;
    border-radius: 5px;
    color: var(--text-faint);
  }
  .rm:hover {
    background: var(--danger-tint, color-mix(in srgb, var(--danger) 16%, transparent));
    color: var(--danger);
  }
  .pill {
    flex: none;
    font-size: 10px;
    font-weight: 800;
    line-height: 1;
    padding: 3px 5px;
    border-radius: 5px;
    cursor: help;
    color: #fff;
  }
  .pill--good {
    background: var(--data-good);
  }
  .pill--mid {
    background: var(--data-mid);
    color: #1c140c;
  }
  .pill--high {
    background: var(--data-high);
  }
  .src {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-faint);
    cursor: help;
  }
  .src--wikipedia {
    background: var(--text);
  }
  .src--geoapify {
    background: #4f9e6b;
  }
  .src--google {
    background: #4285f4;
  }
  .src--osm {
    background: #7ebc6f;
  }
  .src--gen {
    background: var(--line-strong);
  }
  .expand-btn {
    flex: none;
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    border-radius: 5px;
    color: var(--text-faint);
  }
  .expand-btn:hover {
    background: var(--line);
    color: var(--text);
  }
  .chev {
    width: 6px;
    height: 6px;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: rotate(45deg) translate(-1px, -1px);
    transition: transform var(--dur-1) var(--ease-out);
  }
  .chev.up {
    transform: rotate(-135deg) translate(-1px, -1px);
  }

  .sub {
    margin-top: 2px;
    font-size: 11px;
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .quality {
    margin-top: 3px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    font-size: 11px;
    font-weight: 700;
    color: var(--text-soft);
  }
  .quality i {
    color: var(--text-faint);
    font-style: normal;
  }
  .preview {
    margin-top: 4px;
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--text-soft);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .drawer {
    margin-top: 8px;
    display: grid;
    gap: 8px;
  }
  .desc {
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-soft);
    max-height: 260px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .desc::-webkit-scrollbar {
    width: 6px;
  }
  .desc::-webkit-scrollbar-thumb {
    background: var(--line-strong);
    border-radius: 99px;
  }
  .metrics {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3px 10px;
    padding: 6px 9px;
    border-radius: var(--r-xs);
    background: var(--surface-sunk);
    font-size: 11px;
    color: var(--text-faint);
  }
  .metrics span {
    cursor: help;
  }
  .metrics b {
    color: var(--text);
    font-weight: 800;
  }
  .metrics--good {
    box-shadow: inset 3px 0 0 var(--data-good);
  }
  .metrics--mid {
    box-shadow: inset 3px 0 0 var(--data-mid);
  }
  .metrics--high {
    box-shadow: inset 3px 0 0 var(--data-high);
  }
  .duration {
    display: grid;
    gap: 5px;
    padding: 7px 9px;
    border: 1px solid var(--line);
    border-radius: var(--r-xs);
    background: var(--surface-sunk);
  }
  .duration label {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-soft);
  }
  .dur-input {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 700;
  }
  .duration input {
    width: 72px;
    height: 30px;
    padding: 0 6px;
    text-align: right;
    font-size: 13px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 5px;
  }
  .duration small {
    margin-left: auto;
    font-weight: 400;
    color: var(--text-faint);
    cursor: help;
  }
  .drawer-foot {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 11px;
  }
  .why,
  .hours {
    color: var(--text-faint);
    cursor: help;
    border-bottom: 1px dotted var(--line-strong);
  }
  .more {
    margin-left: auto;
    font-weight: 700;
    font-size: 11px;
  }

  @media (max-width: 520px) {
    .metrics {
      grid-template-columns: 1fr;
    }
  }
</style>
