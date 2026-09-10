// Selección del mejor resultado de Nominatim para un LUGAR CONCRETO (bar, museo,
// hotel, monumento…). Antes se cogía `d[0]` a ciegas y una calle o un pueblo
// homónimo ganaba al sitio buscado ("Andarax" -> calle en vez del bar).
import { haversineKm } from "../client/src/lib/format.js";

// Clases OSM que representan un punto concreto, no una vía ni un límite.
export const POI_CLASSES = new Set([
  "amenity", "shop", "tourism", "leisure", "historic",
  "office", "craft", "club", "building", "man_made"
]);

// `type` de Nominatim/Geoapify que también delata un punto concreto aunque
// `class`/`category` venga vacío (p. ej. hoteles llegan como {class:undefined,
// type:"hotel", addresstype:"building"}).
export const POI_TYPES = new Set([
  "hotel", "hostel", "motel", "guest_house", "apartment", "apartments", "chalet",
  "resort", "spa", "camp_site", "caravan_site",
  "restaurant", "cafe", "bar", "pub", "fast_food", "food_court", "biergarten", "nightclub",
  "museum", "gallery", "artwork", "attraction", "viewpoint", "monument", "memorial",
  "castle", "fort", "ruins", "archaeological_site", "theme_park", "water_park",
  "zoo", "aquarium", "theatre", "cinema", "arts_centre", "winery", "marina"
]);

// Prefijos genéricos que la gente antepone al nombre ("Bar Andarax"): se
// prueba también la consulta sin ellos.
export const NAME_PREFIX =
  /^(bar|restaurante|cafeter[ií]a|caf[eé]|hotel|hostal|pensi[oó]n|apartamentos?|mes[oó]n|taberna|bodega|pizzer[ií]a|marisquer[ií]a|asador|chiringuito|kiosco|quiosco|helader[ií]a|panader[ií]a|museo|iglesia|ermita|catedral|castillo|parque|jard[ií]n|plaza|mercado|centro comercial)\s+/i;

const norm = (v) => String(v || "").trim().toLocaleLowerCase("es");

/**
 * @param {Array} list  resultados de Nominatim (format=jsonv2, addressdetails=1)
 * @param {string} q    consulta original del usuario
 * @param {{lat:number,lon:number}|null} center  centro del área de búsqueda
 * @returns {{best:object, bestScore:number, nameHit:boolean}}
 */
export function pickPlaceResult(list, q, center = null) {
  const qHead = norm(String(q).split(/[,\d]/)[0]);
  const score = (r) => {
    const cls = r.class || r.category || "";
    const nm = norm(r.name || "");
    let s = Number(r.importance || 0) * 8;
    if (POI_CLASSES.has(cls) || POI_TYPES.has(r.type)) s += 100;
    if (r.address && r.address.house_number) s += 45;
    if (["amenity", "shop", "tourism", "leisure", "historic"].includes(r.addresstype)) s += 25;
    if (nm && qHead && nm === qHead) s += 40;
    else if (nm && qHead && (nm.includes(qHead) || qHead.includes(nm))) s += 15;
    if (cls === "highway" && !(r.address && r.address.house_number)) s -= 25;
    if (cls === "boundary" || cls === "place") s -= 15;
    if (center && Number.isFinite(Number(r.lat))) {
      const km = haversineKm(center, { lat: Number(r.lat), lon: Number(r.lon) });
      s += Math.max(-45, 35 * (1 - km / 50));
    }
    return s;
  };
  let best = list[0], bestScore = -Infinity;
  for (const r of list) {
    const sc = score(r);
    if (sc > bestScore) { bestScore = sc; best = r; }
  }
  const bn = norm(best && best.name);
  const nameHit = !!(qHead && bn && (bn.includes(qHead) || qHead.includes(bn)));
  return { best, bestScore, nameHit };
}
