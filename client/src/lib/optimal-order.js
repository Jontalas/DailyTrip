// Exact directed shortest visiting path for everyday plans (up to 12 nodes).
// The mask carries phase/meal precedence; a virtual town-centre boundary costs
// nothing and preserves the last physical point instead of routing through it.
export function optimalOrder(stops,matrix) {
  const n=stops.length;
  if(n>12)return null;
  const end=(1<<n)-1,width=n+1;
  const base=stops.findIndex(s=>s.kind==='base'),terminalBase=base===n-1;
  const needs=new Int32Array(n);
  let anchor=-1;
  stops.forEach((s,i)=>{
    if(!['route','activity'].includes(s.kind)){
      if(anchor>=0)needs[i]|=1<<anchor;
      anchor=i;
    }
    if(s.kind==='activity' && base>=0)needs[i]|=1<<base;
    if(s.kind==='hotelReturn' || (s.kind==='base' && terminalBase))needs[i]|=end^(1<<i);
    if(s.kind==='dinner')stops.forEach((other,j)=>{if(j!==i && other.kind!=='hotelReturn')needs[i]|=1<<j;});
  });
  const values=new Float64Array((end+1)*width).fill(Infinity);
  const parent=new Int32Array(values.length).fill(-1),added=new Int16Array(values.length);
  values[0]=0;
  for(let mask=0;mask<end;mask++)for(let last=0;last<width;last++){
    const state=mask*width+last,cost=values[state];
    if(!Number.isFinite(cost))continue;
    for(let i=0;i<n;i++){
      if((mask&(1<<i)) || (mask&needs[i])!==needs[i])continue;
      const virtual=i===base && !terminalBase;
      const next=(mask|(1<<i))*width+(virtual?last:i+1);
      const value=cost+(virtual?0:matrix[last][i+1]);
      if(value<values[next]){values[next]=value;parent[next]=state;added[next]=i+1;}
    }
  }
  let best=end*width;
  for(let last=1;last<width;last++)if(values[end*width+last]<values[best])best=end*width+last;
  if(!Number.isFinite(values[best]))return null;
  const order=[];
  for(let state=best;parent[state]>=0;state=parent[state])order.push(added[state]);
  return order.reverse();
}
