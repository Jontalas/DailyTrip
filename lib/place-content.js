import {haversineKm} from '../client/src/lib/format.js';
const clean=s=>String(s || '').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').trim();
const words=s=>clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]+/g)||[];
export function matchesPlace(item,page) {
  const a=words(item.name),b=words(page.title);
  const overlap=a.filter(w=>b.includes(w)).length/Math.max(a.length,b.length,1);
  const coord=page.coordinates?.[0];
  return overlap>=0.65 && coord && haversineKm(item,{lat:coord.lat,lon:coord.lon})<2;
}
export async function placeContent(item,request) {
  const query=async(host,params)=>{
    const url=new URL(`https://${host}/w/api.php`);
    Object.entries({action:'query',format:'json',formatversion:'2',...params}).forEach(([k,v])=>url.searchParams.set(k,v));
    const data=await request(url,{},10000);
    if(data.error) throw Error('Fuente de información no disponible');
    return data;
  };
  let lang='es',title='',page=null;
  const tag=String(item.wikipediaTag||'').match(/^([a-z]{2,3}):(.+)$/);
  if(tag) {lang=tag[1];title=tag[2];}
  else if(item.wikipediaUrl) {
    try {const url=new URL(item.wikipediaUrl);const m=url.hostname.match(/^([a-z]{2,3})\.wikipedia\.org$/);if(m){lang=m[1];title=decodeURIComponent(url.pathname.replace(/^\/wiki\//,''));}}catch{}
  }
  const props={prop:'extracts|pageimages|pageprops|coordinates|info',exintro:'1',explaintext:'1',piprop:'name',inprop:'url',redirects:'1'};
  if(title) page=(await query(`${lang}.wikipedia.org`,{...props,titles:title})).query?.pages?.find(p=>!p.missing);
  else {
    // Require both identity and proximity; a nearby article alone is not evidence.
    for(const language of ['es','en']) {
      const data=await query(`${language}.wikipedia.org`,{...props,generator:'geosearch',ggscoord:`${item.lat}|${item.lon}`,ggsradius:'2000',ggslimit:'50'});
      page=data.query?.pages?.filter(p=>matchesPlace(item,p)).sort((a,b)=>words(b.title).length-words(a.title).length)[0];
      if(page) {lang=language;break;}
    }
  }
  if(!page) return {contentStatus:'limited',contentCheckedAt:new Date().toISOString()};
  const result={contentStatus:'ok',contentCheckedAt:new Date().toISOString(),description:clean(page.extract).slice(0,6500),
    descriptionSource:`Wikipedia (${lang})`,wikipediaUrl:page.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,images:[]};
  const files=new Set(page.pageimage?[page.pageimage]:[]);
  let partial=false;
  const entityId=page.pageprops?.wikibase_item;
  if(/^Q\d+$/.test(entityId || '')) {
    try {
      const data=await query('www.wikidata.org',{action:'wbgetentities',ids:entityId,props:'claims'});
      const claims=data.entities?.[entityId]?.claims || {};
      for(const claim of claims.P18 || []) {const file=claim.mainsnak?.datavalue?.value;if(typeof file==='string')files.add(file);}
      const website=claims.P856?.[0]?.mainsnak?.datavalue?.value;
      if(typeof website==='string' && /^https?:\/\//.test(website)) result.website=website;
      const category=claims.P373?.[0]?.mainsnak?.datavalue?.value;
      if(category) result.galleryUrl=`https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(category)}`;
      result.wikidataUrl=`https://www.wikidata.org/wiki/${entityId}`;
    }catch{partial=true;}
  }
  if(files.size) {
    try {
      const data=await query('commons.wikimedia.org',{titles:[...files].slice(0,6).map(f=>`File:${f}`).join('|'),prop:'imageinfo',iiprop:'url|extmetadata',iiurlwidth:'960'});
      for(const p of data.query?.pages || []) {
        const info=p.imageinfo?.[0],meta=info?.extmetadata;
        if(!info || !meta?.LicenseShortName?.value || !info.thumburl) continue;
        result.images.push({url:info.thumburl,sourceUrl:info.descriptionurl,author:clean(meta.Artist?.value),license:clean(meta.LicenseShortName.value),title:clean(p.title.replace(/^File:/,''))});
      }
    }catch{partial=true;}
  }
  if(!result.description) delete result.description;
  if(result.images.length) result.imageUrl=result.images[0].url;
  if(partial) result.contentStatus='partial';
  return result;
}
