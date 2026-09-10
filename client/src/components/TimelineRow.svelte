<script>
  import { leftTimelineValue } from "../lib/itinerary.js";
  import { hoveredOptionId } from "../lib/stores.js";

  let { event } = $props();

  let left = $derived(leftTimelineValue(event));
  let isTravel = $derived(event.phase === "travel");
  // texto: para eventos con lugar, "Nombre" a secas (los minutos ya van como
  // sufijo del propio nombre en buildItinerary); para travel, el destino.
  let main = $derived(event.name && event.name !== event.label ? event.name : event.name ? "" : event.detail);
  let sub = $derived(
    isTravel ? (event.journeyDurationMin != null ? `${event.journeyDurationMin} min de conducción en total; pausa para comer aparte` : null) : event.mins != null ? `${event.mins} min` : null
  );
  let linkId = $derived(event.item?.id ?? null);
</script>

<div
  class="row row--{event.phase}"
  class:row--linked={linkId && $hoveredOptionId === linkId}
  class:row--link={!!linkId}
  onmouseenter={() => linkId && hoveredOptionId.set(linkId)}
  onmouseleave={() => linkId && hoveredOptionId.set(null)}
  role="listitem"
>
  <time class="left tnum" class:left--dur={isTravel}>{left}</time>
  <div class="content">
    <span class="label">{event.label}</span>
    <span class="main">{main}</span>
    {#if sub}<span class="sub tnum">{sub}</span>{/if}
  </div>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 46px 1fr;
    gap: 8px;
    padding: 6px 6px 6px 8px;
    border-bottom: 1px solid var(--line);
    border-left: 3px solid var(--line);
    font-size: 12px;
    transition: background var(--dur-1) var(--ease-out);
  }
  .row:last-child {
    border-bottom: 0;
  }
  .row--link {
    cursor: pointer;
  }
  .row--linked {
    background: var(--accent-tint);
  }
  .row--route {
    border-left-color: var(--accent);
  }
  .row--destination {
    border-left-color: var(--line-strong);
  }
  .row--food {
    border-left-color: var(--warning);
  }
  .row--travel {
    border-left-style: dotted;
    border-left-color: var(--text-faint);
    color: var(--text-faint);
  }
  .left {
    font-weight: 700;
    color: var(--text-soft);
    padding-top: 1px;
  }
  .left--dur {
    color: var(--text-faint);
    font-weight: 600;
    font-size: 11px;
  }
  .content {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 3px 7px;
  }
  .label {
    font-weight: 750;
    color: var(--text);
  }
  .row--travel .label {
    font-weight: 600;
    color: var(--text-faint);
  }
  .main {
    color: var(--text-soft);
    min-width: 0;
  }
  .sub {
    color: var(--text-faint);
    font-weight: 600;
    white-space: nowrap;
  }
  .row--travel .sub {white-space: normal;}
</style>
