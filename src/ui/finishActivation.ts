/** A pointer/touch release never finishes a measurement. Only a subsequent button
 * click belonging to an unmoved, uncancelled activation may call FINISH.
 * This blocks compatibility clicks following a drag across the former sticky bar.
 */
export function bindFinishActivation(button:HTMLButtonElement,page:EventTarget,viewport:EventTarget,finish:()=>void){
  let origin:{x:number;y:number}|undefined,blocked=true,armed=false,released=false;
  const inside=(e:Event)=>e.target===button||!!e.target&&button.contains(e.target as Node);
  const point=(e:Event)=>{const p=e as PointerEvent&TouchEvent;const t=p.touches?.[0]??p.changedTouches?.[0];return {x:t?.clientX??p.clientX??0,y:t?.clientY??p.clientY??0};};
  const cancel=()=>{blocked=true;armed=false;released=false;origin=undefined;};
  const down=(e:Event)=>{if(!inside(e)||(e as PointerEvent).button>0||(e as TouchEvent).touches?.length>1){cancel();return;}origin=point(e);blocked=false;armed=true;released=false;};
  const move=(e:Event)=>{if(origin){const p=point(e);if(Math.hypot(p.x-origin.x,p.y-origin.y)>8)cancel();}};
  const up=(e:Event)=>{move(e);if(!inside(e))cancel();else if(armed&&!blocked){released=true;origin=undefined;}};
  for(const name of ['pointerdown','touchstart'])page.addEventListener(name,down,{capture:true});
  for(const name of ['pointermove','touchmove'])page.addEventListener(name,move,{capture:true});
  for(const name of ['pointerup','touchend'])page.addEventListener(name,up,{capture:true});
  for(const name of ['pointercancel','touchcancel','scroll','visibilitychange'])page.addEventListener(name,cancel,{capture:true});
  for(const name of ['resize','orientationchange','pagehide'])viewport.addEventListener(name,cancel);
  button.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){blocked=false;armed=true;released=true;}});
  button.addEventListener('blur',cancel);
  button.addEventListener('click',e=>{
    if(blocked||!armed||!released){e.preventDefault();return;}
    cancel();if(!button.disabled&&!button.hidden)finish();
  });
  return {cancel};
}
