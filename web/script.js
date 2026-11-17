const previewCanvas=document.getElementById('previewCanvas'),previewCtx=previewCanvas.getContext('2d');const outputCanvas=document.getElementById('mixCanvas'),outputCtx=outputCanvas.getContext('2d');const tracksElement=document.getElementById('tracks'),clipGridElement=document.getElementById('clipGrid'),mediaList=document.getElementById('mediaList'),videoInput=document.getElementById('videoInput'),importStatus=document.getElementById('importStatus');const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));const supportedVideo=/\.(mp4|m4v|webm|mov|ogv|ogg|mkv|avi)$/i;let rustCore=null;import('./pkg/vj_core.js').then(async module=>{await module.default();rustCore=module;}).catch(()=>{});const PROJECT_KEY='vj-studio-project-v1';let savedProject=null;try{savedProject=JSON.parse(localStorage.getItem(PROJECT_KEY)||'null')}catch(e){}const state={tracks:[],selectedId:null,activeColumns:savedProject?.activeColumns||{},gridColumns:savedProject?.gridColumns||4,layerIds:Array.isArray(savedProject?.layerIds)?savedProject.layerIds:[],strobe:.42,strobeRate:4,strobeEnabled:false,visualizerColorA:'#55e8d7',visualizerColorB:'#bd70ff',crossfade:50,visualizerStyle:'bars',micGain:12,micSensitivity:2,noiseFloor:.012,micEnabled:false,micStream:null,audioContext:null,analyser:null,timeData:null,freqData:null,micLevel:0,micPeak:0,lastBeat:0,lastAbove:false,prevBass:0,bassFloor:0.012,strobeUntil:0,beatBpm:0,beatPeriod:0,beatConfidence:0,lastBeatAt:0,nextBeatAt:0,lastOnsetAt:0,prevSpectrum:null,spectrumPrimed:false,floatFreqData:null,fluxMean:.25,fluxDeviation:.8,bassNoiseDb:-94,strobePulseUntil:0,lastStrobeAt:-1e9,outputWindow:null,screens:[],chromaEnabled:false,chromaColor:'#00ff00',chromaTolerance:35,filterPreset:'none',visualizerRect:{x:.1,y:.68,w:.8,h:.25},drag:null,programState:null,transitionFrom:null,transitionTarget:null,transitionProgress:0,transitioning:false,transitionStarted:0,transitionDuration:1000,transitionStyle:'mix'};
let browserEngine=null;
import('./browser-engine.js?v=beta-0.8.8').then(m=>{browserEngine=m.initBrowserEngine({state,render,status,saveProject:()=>saveProject(),savedProject});}).catch(e=>status('Browser Engine konnte nicht geladen werden: '+e.message,true));
function status(message,error=false){importStatus.textContent=message;importStatus.classList.toggle('error',error)}function fitRect(v,w,h){const ratio=v.videoWidth/v.videoHeight,target=w/h;let dw=w,dh=h;if(ratio>target)dh=w/ratio;else dw=h*ratio;return{x:(w-dw)/2,y:(h-dh)/2,w:dw,h:dh}}function backdrop(ctx,c){const g=ctx.createLinearGradient(0,0,c.width,c.height);g.addColorStop(0,'#171627');g.addColorStop(.52,'#13181d');g.addColorStop(1,'#071716');ctx.fillStyle=g;ctx.fillRect(0,0,c.width,c.height)}function rgb(hex){return{r:parseInt(hex.slice(1,3),16),g:parseInt(hex.slice(3,5),16),b:parseInt(hex.slice(5,7),16)}}
const FILTERS={none:'none',cinema:'contrast(1.18) saturate(.82) sepia(.12)',vivid:'contrast(1.16) saturate(1.65)',mono:'grayscale(1)',noir:'grayscale(1) contrast(1.55)',dream:'brightness(1.12) saturate(1.35)',warm:'sepia(.28) saturate(1.25)',cool:'hue-rotate(18deg) saturate(1.18)',invert:'invert(1)'};
function detectCanvasFilter(){try{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d',{willReadFrequently:true});x.fillStyle='#fff';x.fillRect(0,0,1,1);x.filter='invert(1)';x.fillRect(0,0,1,1);x.filter='none';return x.getImageData(0,0,1,1).data[0]<32;}catch(e){return false;}}
const CANVAS_FILTER_SUPPORTED=detectCanvasFilter();
function applyFallbackFilter(ctx,canvas,v,preset,frameToken){
 if(!ctx||!v.videoWidth||!v.videoHeight)return null;
 const scale=Math.min(1,640/Math.max(v.videoWidth,v.videoHeight)),w=Math.max(1,Math.round(v.videoWidth*scale)),h=Math.max(1,Math.round(v.videoHeight*scale));
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;canvas._vjKey='';}
 const cacheKey=String(frameToken??v.currentTime??'static')+'|'+preset;
 if(canvas._vjKey===cacheKey)return canvas;
 const filter=FILTERS[preset];
 if(!filter)return null;
 ctx.save();
 try{
  ctx.clearRect(0,0,w,h);
  if(CANVAS_FILTER_SUPPORTED){
   ctx.filter=filter;
   ctx.drawImage(v,0,0,w,h);
   ctx.restore();
   canvas._vjKey=cacheKey;
   return canvas;
  }
  ctx.filter='none';
  ctx.drawImage(v,0,0,w,h);
  const im=ctx.getImageData(0,0,w,h),p=im.data,cl=x=>Math.max(0,Math.min(255,x));
  for(let i=0;i<p.length;i+=4){
   let r=p[i],g=p[i+1],b=p[i+2],y=.2126*r+.7152*g+.0722*b;
   switch(preset){
    case'mono':r=g=b=y;break;
    case'noir':r=g=b=cl((y-128)*1.65+128);break;
    case'invert':r=255-r;g=255-g;b=255-b;break;
    case'vivid':{const sat=1.75,con=1.18;r=cl(((y+(r-y)*sat)-128)*con+128);g=cl(((y+(g-y)*sat)-128)*con+128);b=cl(((y+(b-y)*sat)-128)*con+128);break;}
    case'warm':{const nr=.393*r+.769*g+.189*b,ng=.349*r+.686*g+.168*b,nb=.272*r+.534*g+.131*b;r=cl(nr);g=cl(ng);b=cl(nb);break;}
    case'cool':r=cl(r*.88);g=cl(g*1.02);b=cl(b*1.22+10);break;
    case'dream':r=cl(r*1.12+16);g=cl(g*1.10+12);b=cl(b*1.08+18);break;
    case'cinema':{const sat=.82,con=1.18;r=cl(((y+(r-y)*sat)-128)*con+128+10);g=cl(((y+(g-y)*sat)-128)*con+128+5);b=cl(((y+(b-y)*sat)-128)*con+128);break;}
   }
   p[i]=r;p[i+1]=g;p[i+2]=b;
  }
  ctx.putImageData(im,0,0);
  ctx.restore();
  canvas._vjKey=cacheKey;
  return canvas;
 }catch(error){
  ctx.restore();
  // If pixel access is blocked, try the browser's native Canvas filter as a second path.
  try{
   ctx.save();
   ctx.clearRect(0,0,w,h);
   ctx.filter=filter;
   ctx.drawImage(v,0,0,w,h);
   ctx.restore();
   canvas._vjKey=cacheKey;
   return canvas;
  }catch(fallbackError){
   try{ctx.restore()}catch(restoreError){}
   canvas._vjKey='';
   return null;
  }
 }
}
function drawClip(ctx,t,c,mix=1,renderState=state){
 const v=t.video;
 if(!t.visible||v.readyState<HTMLMediaElement.HAVE_CURRENT_DATA||!v.videoWidth)return;
 const box={x:t.x*c.width,y:t.y*c.height,w:t.w*c.width,h:t.h*c.height},preset=t.filterPreset||renderState.filterPreset||'none';
 const frameToken=t.type==='image'&&String(t.fileName||'').toLowerCase().endsWith('.gif')?(t.gifDecoder?'gif:'+t.gifFrameIndex:'gif-native:'+Math.floor(performance.now()/33)):(Number.isFinite(v.currentTime)?v.currentTime:'static');
 let source=v,nativeFilter=false;
 if(preset!=='none'){
  const fc=t.filterCanvas||(t.filterCanvas=document.createElement('canvas'));
  const filtered=applyFallbackFilter(fc.getContext('2d',CANVAS_FILTER_SUPPORTED?{}:{willReadFrequently:true}),fc,v,preset,frameToken);
  if(filtered)source=filtered;
  else{
   nativeFilter=true;
   if(t.filterErrorPreset!==preset){t.filterErrorPreset=preset;status('Filter-Fallback nicht verfügbar. Der Browser versucht den Effekt direkt beim Rendern.',true);}
  }
 }else t.filterErrorPreset='';
 if(renderState.chromaEnabled){
  const maxSide=640,scale=Math.min(1,maxSide/Math.max(v.videoWidth,v.videoHeight)),w=Math.max(1,Math.round(v.videoWidth*scale)),h=Math.max(1,Math.round(v.videoHeight*scale));
  const off=t.keyCanvas||(t.keyCanvas=document.createElement('canvas'));
  if(off.width!==w||off.height!==h){off.width=w;off.height=h;t.keyTime='';}
  const k=off.getContext('2d',{willReadFrequently:true}),keyCache=frameToken+'|'+preset+'|'+renderState.chromaColor+'|'+renderState.chromaTolerance;
  let keyReady=t.keyTime===keyCache;
  if(!keyReady){
   try{
    k.save();k.clearRect(0,0,w,h);k.filter=nativeFilter?(FILTERS[preset]||'none'):'none';k.drawImage(source,0,0,w,h);k.filter='none';k.restore();
    const im=k.getImageData(0,0,w,h),p=im.data,key=rgb(renderState.chromaColor),tol=renderState.chromaTolerance*2.2;
    for(let i=0;i<p.length;i+=4){const dr=p[i]-key.r,dg=p[i+1]-key.g,db=p[i+2]-key.b,dist=Math.sqrt(dr*dr+dg*dg+db*db);if(dist<tol)p[i+3]=0;else if(dist<tol+28)p[i+3]=Math.min(p[i+3],Math.round(255*(dist-tol)/28));}
    k.putImageData(im,0,0);t.keyTime=keyCache;keyReady=true;
   }catch(error){
    try{k.restore()}catch(restoreError){}
    t.keyTime='';
    if(t.keyError!==true){t.keyError=true;status('Chroma Key konnte das Bild nicht auslesen; der Clip wird ohne Key angezeigt.',true);}
   }
  }
  if(keyReady){source=off;nativeFilter=false;}
 }
 ctx.save();
 const blendOps={normal:'source-over',add:'lighter',screen:'screen',multiply:'multiply',overlay:'overlay',difference:'difference',lighten:'lighten',darken:'darken',subtract:'difference'};
 ctx.globalCompositeOperation=blendOps[t.blendMode||'normal']||'source-over';
 ctx.globalAlpha=t.opacity*mix*(t.audioReactive?clamp(.35+renderState.micLevel*.65,0,1):1);
 ctx.beginPath();ctx.rect(box.x,box.y,box.w,box.h);ctx.clip();
 ctx.filter=nativeFilter?(FILTERS[preset]||'none'):'none';
 const r=fitRect(v,box.w,box.h);ctx.drawImage(source,box.x+r.x,box.y+r.y,r.w,r.h);
 ctx.restore();
}
function drawVisualizer(ctx,c,time,renderState=state){if(renderState.visualizerStyle==='off')return;const colorA=renderState.visualizerColorA||'#55e8d7',colorB=renderState.visualizerColorB||'#bd70ff';const r=renderState.visualizerRect,x=r.x*c.width,y=r.y*c.height,w=r.w*c.width,h=r.h*c.height,base=y+h*.9,n=64;ctx.save();ctx.globalCompositeOperation='screen';if(renderState.visualizerStyle==='wave'){ctx.beginPath();for(let i=0;i<=n;i++){const xx=x+i/n*w,val=renderState.timeData?Math.abs((renderState.timeData[Math.floor(i/n*(renderState.timeData.length-1))]-128)/128):(Math.sin(time*.004+i*.2)+1)*.12,yy=y+h*.82-val*h*.72-renderState.micLevel*h*.18;i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy)}ctx.strokeStyle=colorA;ctx.shadowColor=colorA;ctx.shadowBlur=14;ctx.lineWidth=Math.max(2,h*.025);ctx.stroke()}else if(renderState.visualizerStyle==='circle'){const cx=x+w/2,cy=y+h/2,radius=Math.min(w,h)*.18;for(let i=0;i<n;i++){const a=i/n*Math.PI*2-Math.PI/2,val=renderState.freqData?renderState.freqData[Math.floor(i/n*renderState.freqData.length)]/255:(Math.sin(time*.003+i*.3)+1)*.12,outer=radius+val*h*.4+renderState.micLevel*h*.15;ctx.beginPath();ctx.moveTo(cx+Math.cos(a)*radius,cy+Math.sin(a)*radius);ctx.lineTo(cx+Math.cos(a)*outer,cy+Math.sin(a)*outer);ctx.strokeStyle=i%2?colorB:colorA;ctx.lineWidth=Math.max(2,h*.025);ctx.stroke()}}else{const bw=w/n;for(let i=0;i<n;i++){const val=renderState.freqData?renderState.freqData[Math.floor(i/n*renderState.freqData.length)]/255:(Math.sin(time*.003+i*.24)+1)*.12,env=renderState.visualizerStyle==='spectrum'?Math.pow(1-i/n,.45):1,bh=Math.max(h*.04,(val*.78+renderState.micLevel*.3)*h*env),g=ctx.createLinearGradient(0,base-bh,0,base);g.addColorStop(0,colorB);g.addColorStop(.5,colorA);g.addColorStop(1,colorB);ctx.fillStyle=g;ctx.fillRect(x+i*bw+bw*.16,base-bh,bw*.68,bh)}}ctx.restore();ctx.save();ctx.strokeStyle='rgba(209,255,56,.65)';ctx.setLineDash([8,6]);ctx.strokeRect(x,y,w,h);ctx.setLineDash([]);ctx.fillStyle='#d1ff38';ctx.fillRect(x+w-12,y+h-12,12,12);ctx.restore()}
function drawStrobe(ctx,time,renderState=state){if(!renderState.strobeEnabled)return;const period=1000/renderState.strobeRate,mic=renderState.micEnabled&&time<renderState.strobePulseUntil,free=!renderState.micEnabled&&(time%period)<55;if(!mic&&!free)return;const alpha=clamp(renderState.strobe*(mic?.82+renderState.micPeak*.18:.7),0,.96);ctx.save();ctx.globalCompositeOperation='screen';ctx.fillStyle=`rgba(255,255,255,${alpha})`;ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.restore()}
function scene(ctx,c,time,preview=false,renderState=state){backdrop(ctx,c);const solo=renderState.tracks.some(t=>t.solo),vis=renderState.tracks.filter(t=>t.visible&&(!solo||t.solo)&&(renderState.activeColumns[t.layerId||t.id]??0)===Number(t.column||0)),layerOrder=[...new Set([...(Array.isArray(renderState.layerIds)?renderState.layerIds:[]),...renderState.tracks.map(t=>t.layerId||t.id)])];for(const layerId of [...layerOrder].reverse()){const layer=vis.filter(t=>(t.layerId||t.id)===layerId),la=layer.filter(t=>t.deck==='A'),lb=layer.filter(t=>t.deck==='B'),raw=renderState.crossfade/100,f=raw*raw*(3-2*raw);if(la.length&&lb.length){la.forEach(t=>drawClip(ctx,t,c,1-f,renderState));lb.forEach(t=>drawClip(ctx,t,c,f,renderState));}else layer.forEach(t=>drawClip(ctx,t,c,1,renderState));}if(renderState.visualizerStyle!=='off')drawVisualizer(ctx,c,time,renderState);drawStrobe(ctx,time,renderState);if(preview){const selected=renderState.tracks.find(x=>x.id===renderState.selectedId&&x.visible);if(selected)drawSelectionOverlay(ctx,c,selected);}if(!vis.length){ctx.fillStyle='#999';ctx.font='600 28px system-ui';ctx.textAlign='center';ctx.fillText('Clips in der Preview starten',c.width/2,c.height/2)}}
function snapshotScene(source=state){const keys=['tracks','layerIds','activeColumns','crossfade','strobe','strobeRate','strobeEnabled','visualizerColorA','visualizerColorB','visualizerStyle','visualizerRect','micEnabled','micLevel','micPeak','strobePulseUntil','chromaEnabled','chromaColor','chromaTolerance','filterPreset'];const snap={};for(const key of keys){if(key==='tracks')snap.tracks=source.tracks.map(t=>({...t}));else if(key==='layerIds')snap.layerIds=[...(source.layerIds||[...new Set(source.tracks.map(t=>t.layerId||t.id))])];else if(key==='activeColumns')snap.activeColumns={...source.activeColumns};else if(key==='visualizerRect')snap.visualizerRect={...source.visualizerRect};else snap[key]=source[key];}return snap}
state.programState=snapshotScene({tracks:[],activeColumns:{},crossfade:50,strobe:state.strobe,strobeRate:state.strobeRate,visualizerStyle:'off',visualizerRect:state.visualizerRect,micEnabled:false,micLevel:0,micPeak:0,strobePulseUntil:0,chromaEnabled:false,chromaColor:state.chromaColor,chromaTolerance:state.chromaTolerance,filterPreset:'none'});
const transitionFromCanvas=document.createElement('canvas'),transitionToCanvas=document.createElement('canvas');transitionFromCanvas.width=transitionToCanvas.width=outputCanvas.width;transitionFromCanvas.height=transitionToCanvas.height=outputCanvas.height;
function paintTransition(ctx,c,time){const p=clamp(state.transitionProgress/100,0,1),fromBase=state.transitionFrom||state.programState,toBase=state.transitionTarget||snapshotScene(),from={...fromBase,strobe:state.strobe,strobeRate:state.strobeRate},to={...toBase,strobe:state.strobe,strobeRate:state.strobeRate};for(const canvas of [transitionFromCanvas,transitionToCanvas])if(canvas.width!==c.width||canvas.height!==c.height){canvas.width=c.width;canvas.height=c.height;}scene(transitionFromCanvas.getContext('2d'),transitionFromCanvas,time,false,from);scene(transitionToCanvas.getContext('2d'),transitionToCanvas,time,false,to);ctx.clearRect(0,0,c.width,c.height);const style=state.transitionStyle;if(style==='wipe'){ctx.drawImage(transitionFromCanvas,0,0);ctx.save();ctx.beginPath();ctx.rect(0,0,c.width*p,c.height);ctx.clip();ctx.drawImage(transitionToCanvas,0,0);ctx.restore()}else if(style==='push'){ctx.drawImage(transitionFromCanvas,-c.width*p,0);ctx.drawImage(transitionToCanvas,c.width*(1-p),0)}else if(style==='zoom'){ctx.drawImage(transitionFromCanvas,0,0);ctx.save();ctx.globalAlpha=p;const scale=.72+.28*p,w=c.width*scale,h=c.height*scale;ctx.drawImage(transitionToCanvas,(c.width-w)/2,(c.height-h)/2,w,h);ctx.restore()}else if(style==='dip'){ctx.drawImage(transitionFromCanvas,0,0);if(p<.5){ctx.fillStyle='rgba(0,0,0,'+Math.min(1,p*2)+')';ctx.fillRect(0,0,c.width,c.height)}else{ctx.drawImage(transitionToCanvas,0,0);ctx.fillStyle='rgba(0,0,0,'+Math.max(0,2-2*p)+')';ctx.fillRect(0,0,c.width,c.height)}}else{ctx.drawImage(transitionFromCanvas,0,0);ctx.save();ctx.globalAlpha=p;ctx.drawImage(transitionToCanvas,0,0);ctx.restore();}}
const takeTransition=document.getElementById('takeTransition'),transitionProgress=document.getElementById('transitionProgress'),transitionProgressValue=document.getElementById('transitionProgressValue'),transitionStatus=document.getElementById('transitionStatus'),transitionStyle=document.getElementById('transitionStyle'),transitionDuration=document.getElementById('transitionDuration');
state.transitionFrom=state.programState;state.transitionTarget=snapshotScene();
function updateTransition(time){if(state.transitioning){const p=clamp((time-state.transitionStarted)/state.transitionDuration,0,1);state.transitionProgress=p*100;transitionProgress.value=String(Math.round(state.transitionProgress));transitionProgressValue.value=Math.round(state.transitionProgress)+'%';if(p>=1){state.transitioning=false;state.programState=state.transitionTarget;state.transitionFrom=state.programState;takeTransition.disabled=false;transitionStatus.textContent='Output aktualisiert';}}else if(state.transitionProgress<100){state.transitionTarget=snapshotScene();}paintTransition(outputCtx,outputCanvas,time);}
function startTransition(){state.transitionFrom=state.programState;state.transitionTarget=snapshotScene();state.transitionProgress=0;state.transitionStarted=performance.now();state.transitionDuration=Number(transitionDuration.value)||1000;state.transitionStyle=transitionStyle.value;state.transitioning=true;takeTransition.disabled=true;transitionStatus.textContent='Übergang läuft …';}
takeTransition.addEventListener('click',startTransition);
transitionProgress.addEventListener('input',()=>{state.transitioning=false;takeTransition.disabled=false;state.transitionProgress=Number(transitionProgress.value);state.transitionTarget=snapshotScene();state.transitionStyle=transitionStyle.value;transitionProgressValue.value=Math.round(state.transitionProgress)+'%';transitionStatus.textContent=state.transitionProgress>=100?'Output übernommen':`Preview → Output · ${Math.round(state.transitionProgress)}%`;if(state.transitionProgress>=100){state.programState=state.transitionTarget;}});
transitionStyle.addEventListener('change',()=>{state.transitionStyle=transitionStyle.value;});
transitionDuration.addEventListener('change',()=>{state.transitionDuration=Number(transitionDuration.value)||1000;});
document.getElementById('resetTransition').addEventListener('click',()=>{state.transitioning=false;takeTransition.disabled=false;state.transitionProgress=0;state.transitionTarget=snapshotScene();transitionProgress.value='0';transitionProgressValue.value='0%';transitionStatus.textContent='Änderungen sind nur in der Preview';});
function check(label,cls,t,checked){const l=document.createElement('label'),i=document.createElement('input');i.type='checkbox';i.className=cls;i.dataset.id=t.id;i.checked=checked;l.append(i,document.createTextNode(label));return l}function range(label,cls,t,value){const l=document.createElement('label');l.className='track-range';l.append(document.createTextNode(`${label} ${Math.round(value*100)}%`));const i=document.createElement('input');i.type='range';i.min='0';i.max='1';i.step='.01';i.value=value;i.className=cls;i.dataset.id=t.id;l.append(i);return l}function action(text,what,t,title){const b=document.createElement('button');b.type='button';b.textContent=text;b.dataset.action=what;b.dataset.id=t.id;b.title=title;return b}
function renderTracks(){tracksElement.replaceChildren();mediaList.replaceChildren();document.getElementById('mediaCount').textContent=state.tracks.length;if(!state.tracks.length){for(const parent of [tracksElement,mediaList]){const e=document.createElement('div');e.className='empty';e.textContent=parent===tracksElement?'Videos, Bilder, Kameras oder Generatoren hinzufügen.':'Deine Medien erscheinen hier.';parent.append(e)}return}state.tracks.forEach((t,index)=>{const row=document.createElement('article');row.className=`track${t.id===state.selectedId?' selected':''}`;const title=document.createElement('div');title.className='track-title-wrap';const num=document.createElement('span');num.className='track-number';num.textContent=String(index+1).padStart(2,'0');const stack=document.createElement('div');stack.style.minWidth='0';const name=document.createElement('div');name.className='track-title';name.textContent=t.name;const sub=document.createElement('div');sub.className='track-subtitle';sub.textContent=`LAYER ${String([...new Set(state.tracks.map(x=>x.layerId||x.id))].indexOf(t.layerId||t.id)+1).padStart(2,'0')} · SLOT ${Number(t.column||0)+1} · DECK ${t.deck}${t.error?' · '+t.error:''}`;stack.append(name,sub);title.append(num,stack);const toggles=document.createElement('div');toggles.className='track-toggles';toggles.append(check('On','track-visible',t,t.visible),check('Solo','track-solo',t,!!t.solo),check('Audio','track-audio',t,!!t.audioReactive));const controls=document.createElement('div');controls.className='track-actions';const deck=document.createElement('select');deck.className='deck-select';deck.dataset.id=t.id;deck.innerHTML=`<option value="A" ${t.deck==='A'?'selected':''}>A</option><option value="B" ${t.deck==='B'?'selected':''}>B</option>`;const blend=document.createElement('select');blend.className='track-blend';blend.dataset.id=t.id;blend.title='Blend mode';blend.innerHTML=['normal','add','screen','multiply','overlay','difference','lighten','darken','subtract'].map(v=>'<option value="'+v+'" '+((t.blendMode||'normal')===v?'selected':'')+'>'+v.toUpperCase()+'</option>').join('');const sync=document.createElement('select');sync.className='track-sync';sync.dataset.id=t.id;sync.title='Beat sync';sync.innerHTML='<option value="0">FREE</option>'+[.25,.5,1,2,4,8,16,32].map(v=>'<option value="'+v+'" '+(Number(t.syncBeats||0)===v?'selected':'')+'>'+v+' BEATS</option>').join('');const mode=document.createElement('select');mode.className='track-playmode';mode.dataset.id=t.id;mode.title='Clip playback mode';mode.innerHTML=['loop','once-clear','once-hold'].map(v=>'<option value="'+v+'" '+((t.playMode||'loop')===v?'selected':'')+'>'+({loop:'LOOP','once-clear':'ONCE → CLEAR','once-hold':'ONCE → HOLD'}[v])+'</option>').join('');const autopilot=document.createElement('select');autopilot.className='track-autopilot';autopilot.dataset.id=t.id;autopilot.title='Autopilot';autopilot.innerHTML=['off','next','previous','random'].map(v=>'<option value="'+v+'" '+((t.autopilot||'off')===v?'selected':'')+'>'+v.toUpperCase()+'</option>').join('');const effect=document.createElement('select');effect.className='track-effect';effect.dataset.id=t.id;effect.title='Layer effect';effect.innerHTML='<option value="inherit">GLOBAL FX</option>'+['cinema','vivid','mono','noir','dream','warm','cool','invert'].map(v=>'<option value="'+v+'" '+((t.filterPreset||'')===v?'selected':'')+'>'+v.toUpperCase()+'</option>').join('');controls.append(deck,blend,sync,mode,autopilot,effect,action(t.locked?'🔒':'🔓','lock',t,t.locked?'Clip entsperren':'Clip fixieren'),action('−','shrink',t,'Layer um 10 % verkleinern'),action('+','enlarge',t,'Layer um 10 % vergrößern'),action(t.id===state.selectedId?'Preview ✓':'Preview','select',t,'Preview'));const del=action('×','remove',t,'Entfernen');del.className='delete';controls.append(del,action('↑','up',t,'Nach vorne'),action('↓','down',t,'Nach hinten'));row.append(title,toggles,range('Deckkraft','track-opacity',t,t.opacity),range('Lautstärke','track-volume',t,t.volume),controls);tracksElement.append(row);const item=document.createElement('div');item.className=`media-item${t.id===state.selectedId?' selected':''}`;item.dataset.id=t.id;item.draggable=true;item.innerHTML=`<span class="media-thumb">${t.error?'!':'▶'}</span><span style="min-width:0"><span class="media-name"></span><span class="media-meta">DECK ${t.deck}</span></span>`;item.querySelector('.media-name').textContent=t.name;mediaList.append(item)})}

function gridGroups(){const map=new Map();for(const id of state.layerIds||[])if(id)map.set(id,[]);state.tracks.forEach(t=>{t.layerId=t.layerId||t.id;t.column=Number.isInteger(t.column)?t.column:0;if(!map.has(t.layerId))map.set(t.layerId,[]);map.get(t.layerId).push(t)});return [...map.entries()]}
function launchGridClip(layerId,column,clip){state.activeColumns[layerId]=column;if(clip){clip.visible=true;state.selectedId=clip.id;clip.video?.play?.().catch?.(()=>{});}render();saveProject();}
function launchGridColumn(column){for(const [layerId,clips] of gridGroups()){const clip=clips.find(t=>Number(t.column||0)===column);state.activeColumns[layerId]=clip?column:-1;if(clip){clip.visible=true;clip.video?.play?.().catch?.(()=>{});}}render();saveProject();status(`Spalte ${column+1} gestartet.`)}
function placeClipInSlot(moved,layerId,column,clips=[]){if(moved.locked){status(`${moved.name} ist fixiert und kann nicht verschoben werden.`,true);return}const occupied=clips.find(t=>t.id!==moved.id&&Number(t.column||0)===column);if(occupied){let free=0;while(clips.some(t=>t.id!==moved.id&&t.id!==occupied.id&&Number(t.column||0)===free)||free===column)free++;occupied.column=free;}moved.layerId=layerId;moved.column=column;moved.deck=clips[0]?.deck||'A';launchGridClip(layerId,column,moved);status(`${moved.name} in Spalte ${column+1} abgelegt.`)}
function renderClipGrid(){
 if(!clipGridElement)return;clipGridElement.replaceChildren();
 const groups=gridGroups(),maxColumn=Math.max(state.gridColumns,...state.tracks.map(t=>Number(t.column||0)+1),1);clipGridElement.style.setProperty('--grid-columns',maxColumn);
 const head=document.createElement('div');head.className='clip-grid-row clip-grid-head';
 const label=document.createElement('div');label.className='clip-grid-layer-label';label.textContent='LAYER';head.append(label);
 for(let c=0;c<maxColumn;c++){const b=document.createElement('button');b.type='button';b.className='clip-grid-column';b.textContent=String(c+1);b.title=`Spalte ${c+1} starten (Taste ${c+1<=9?c+1:'—'})`;b.addEventListener('click',()=>launchGridColumn(c));head.append(b)}
 clipGridElement.append(head);
 if(!groups.length){const empty=document.createElement('div');empty.className='clip-grid-empty';empty.textContent='Medien importieren und hier als Layer oder Clip-Slot ablegen.';clipGridElement.append(empty)}
 groups.forEach(([layerId,clips],index)=>{
  const row=document.createElement('div');row.className='clip-grid-row';row.dataset.layer=layerId;
  const layerLabel=document.createElement('div');layerLabel.className='clip-grid-layer-label';layerLabel.innerHTML=`<b> LAYER ${String(index+1).padStart(2,'0')}</b><small></small>`;layerLabel.querySelector('small').textContent=clips[0]?.name||'Leer · Clip hier ablegen';layerLabel.title='Tippe auf einen freien Slot oder ziehe einen Clip hierher';if(!clips.length){const remove=document.createElement('button');remove.type='button';remove.className='empty-layer-remove';remove.textContent='×';remove.title='Leere Ebene entfernen';remove.addEventListener('click',()=>{state.layerIds=state.layerIds.filter(id=>id!==layerId);delete state.activeColumns[layerId];render();saveProject()});layerLabel.append(remove)}row.append(layerLabel);
  for(let c=0;c<maxColumn;c++){
   const clip=clips.find(t=>Number(t.column||0)===c),cell=document.createElement('button');cell.type='button';cell.className='clip-grid-cell'+(clip?' filled':' empty-slot')+((state.activeColumns[layerId]??0)===c?' active':'');cell.dataset.layer=layerId;cell.dataset.column=String(c);
   if(clip){cell.dataset.clip=clip.id;const title=document.createElement('b');title.textContent=clip.name;const meta=document.createElement('small');meta.textContent=(clip.type||'video').toUpperCase()+(clip.error?' · FEHLER':'');cell.append(title,meta);cell.title=`${clip.name} · Layer ${index+1}, Spalte ${c+1}`;cell.addEventListener('click',()=>launchGridClip(layerId,c,clip));cell.addEventListener('contextmenu',e=>{e.preventDefault();state.selectedId=clip.id;render();status(`Preview ausgewählt: ${clip.name}`)});}
   else{cell.textContent='＋';cell.title=`Clip hier ablegen oder antippen, um den ausgewählten Clip einzusetzen`;cell.addEventListener('click',()=>{const picked=state.tracks.find(t=>t.id===state.selectedId);if(picked)placeClipInSlot(picked,layerId,c,clips);});}
   cell.addEventListener('dragover',e=>{e.preventDefault();cell.classList.add('drop-target')});cell.addEventListener('dragleave',()=>cell.classList.remove('drop-target'));cell.addEventListener('drop',e=>{e.preventDefault();cell.classList.remove('drop-target');const id=e.dataTransfer.getData('text/vj-clip');const moved=state.tracks.find(t=>t.id===id);if(!moved)return;placeClipInSlot(moved,layerId,c,clips);});
   row.append(cell);
  }
  clipGridElement.append(row);
 });
 const newRow=document.createElement('div');newRow.className='clip-grid-new-layer';newRow.textContent='＋ Neue Ebene anlegen · Clip hier ablegen';newRow.addEventListener('dragover',e=>{e.preventDefault();newRow.classList.add('drop-target')});newRow.addEventListener('dragleave',()=>newRow.classList.remove('drop-target'));newRow.addEventListener('drop',e=>{e.preventDefault();newRow.classList.remove('drop-target');const moved=state.tracks.find(t=>t.id===e.dataTransfer.getData('text/vj-clip'));if(!moved)return;if(moved.locked){status('Clip ist fixiert und kann nicht verschoben werden.',true);return}moved.layerId=globalThis.crypto?.randomUUID?.()||`layer-${Date.now()}`;moved.column=0;moved.deck='A';launchGridClip(moved.layerId,0,moved);status(`${moved.name} als neuer Layer hinzugefügt.`)});clipGridElement.append(newRow);
}
function render(){renderTracks();renderClipGrid()}
document.getElementById('addGridColumn')?.addEventListener('click',()=>{state.gridColumns=Math.min(16,state.gridColumns+1);render();saveProject();});
document.getElementById('addGridLayer')?.addEventListener('click',()=>{const id=globalThis.crypto?.randomUUID?.()||('layer-'+Date.now()+'-'+Math.random().toString(36).slice(2,7));state.layerIds.push(id);const picked=state.tracks.find(t=>t.id===state.selectedId);if(picked){picked.layerId=id;picked.column=0;picked.deck='A';state.activeColumns[id]=0;}render();saveProject();status(picked?(picked.name+' in neuer Ebene abgelegt.'):'Neue leere Ebene angelegt. Wähle einen Clip und tippe auf ＋.');});
mediaList.addEventListener('dragstart',e=>{const item=e.target.closest('.media-item');if(!item)return;const clip=state.tracks.find(t=>t.id===item.dataset.id);if(clip?.locked){e.preventDefault();status('Clip ist fixiert und kann nicht verschoben werden.',true);return}e.dataTransfer.setData('text/vj-clip',item.dataset.id);e.dataTransfer.effectAllowed='move';});

function enableClipPointerDrag(container,sourceSelector){
 let active=null,ghost=null,moved=false;
 const clear=()=>{if(ghost){ghost.remove();ghost=null}if(active&&active.source)active.source.classList.remove('pointer-dragging');active=null;moved=false;document.querySelectorAll('.pointer-drop-target').forEach(x=>x.classList.remove('pointer-drop-target'));};
 container.addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse'&&e.button!==0)return;
  const source=e.target.closest(sourceSelector);if(!source)return;
  const id=source.dataset.id||source.dataset.clip;if(!id)return;const dragged=state.tracks.find(t=>t.id===id);if(dragged?.locked)return;
  active={id:id,source:source,x:e.clientX,y:e.clientY,pointerId:e.pointerId};source.setPointerCapture?.(e.pointerId);moved=false;
 });
 container.addEventListener('pointermove',e=>{
  if(!active||active.pointerId!==e.pointerId)return;
  const dx=e.clientX-active.x,dy=e.clientY-active.y;
  if(!moved&&Math.hypot(dx,dy)<9)return;
  moved=true;e.preventDefault();
  if(!ghost){ghost=document.createElement('div');ghost.className='clip-drag-ghost';ghost.textContent=(state.tracks.find(t=>t.id===active.id)?.name)||'Clip';document.body.append(ghost);active.source.classList.add('pointer-dragging')}
  ghost.style.left=e.clientX+'px';ghost.style.top=e.clientY+'px';
  document.querySelectorAll('.pointer-drop-target').forEach(x=>x.classList.remove('pointer-drop-target'));
  const under=document.elementFromPoint(e.clientX,e.clientY),target=under?.closest('.clip-grid-cell,.clip-grid-new-layer,.clip-grid-layer-label');
  if(target)target.classList.add('pointer-drop-target');
 });
 container.addEventListener('pointerup',e=>{
  if(!active||active.pointerId!==e.pointerId)return;
  const current=active,wasMoved=moved;
  if(wasMoved){
   const under=document.elementFromPoint(e.clientX,e.clientY),target=under?.closest('.clip-grid-cell,.clip-grid-new-layer,.clip-grid-layer-label'),clip=state.tracks.find(t=>t.id===current.id);
   if(target&&clip){
    if(target.classList.contains('clip-grid-cell'))placeClipInSlot(clip,target.dataset.layer,Number(target.dataset.column),gridGroups().find(pair=>pair[0]===target.dataset.layer)?.[1]||[]);
    else if(target.classList.contains('clip-grid-layer-label')){const id=target.closest('.clip-grid-row')?.dataset.layer;if(id)placeClipInSlot(clip,id,0,gridGroups().find(pair=>pair[0]===id)?.[1]||[]);}
    else{const id=globalThis.crypto?.randomUUID?.()||('layer-'+Date.now());state.layerIds.push(id);placeClipInSlot(clip,id,0,[]);status(clip.name+' in neuer Ebene abgelegt.');}
   }
  }else if(container===mediaList){state.selectedId=current.id;render();const selected=state.tracks.find(t=>t.id===current.id);status((selected?.name||'Clip')+' ausgewählt. Jetzt in einen Layer-Slot ziehen oder antippen.');}
  clear();
 });
 container.addEventListener('pointercancel',clear);
}
enableClipPointerDrag(mediaList,'.media-item');
enableClipPointerDrag(clipGridElement,'.clip-grid-cell.filled');
function setLayerProp(t,key,value){for(const x of state.tracks)if((x.layerId||x.id)===(t.layerId||t.id)){x[key]=value;if(key==='volume'&&x.video)x.video.volume=value;}}
tracksElement.addEventListener('input',e=>{const c=e.target,t=state.tracks.find(x=>x.id===c.dataset.id);if(!t)return;if(c.classList.contains('track-visible'))setLayerProp(t,'visible',c.checked);if(c.classList.contains('track-solo'))setLayerProp(t,'solo',c.checked);if(c.classList.contains('track-audio'))setLayerProp(t,'audioReactive',c.checked);if(c.classList.contains('track-opacity'))setLayerProp(t,'opacity',+c.value);if(c.classList.contains('track-volume'))setLayerProp(t,'volume',+c.value);if(c.type==='checkbox')render();});tracksElement.addEventListener('change',e=>{const t=state.tracks.find(x=>x.id===e.target.dataset.id);if(e.target.classList.contains('deck-select')&&t){setLayerProp(t,'deck',e.target.value);render();}if(e.target.classList.contains('track-blend')&&t){setLayerProp(t,'blendMode',e.target.value);saveProject();}if(e.target.classList.contains('track-sync')&&t){t.syncBeats=+e.target.value;saveProject();}if(e.target.classList.contains('track-playmode')&&t){t.playMode=e.target.value;t.video.loop=t.playMode==='loop';saveProject();}if(e.target.classList.contains('track-autopilot')&&t){t.autopilot=e.target.value;saveProject();}if(e.target.classList.contains('track-effect')&&t){t.filterPreset=e.target.value==='inherit'?'':e.target.value;saveProject();}});tracksElement.addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(!b)return;const i=state.tracks.findIndex(t=>t.id===b.dataset.id);if(i<0)return;const a=b.dataset.action;if(a==='enlarge'||a==='shrink'){const t=state.tracks[i],members=state.tracks.filter(x=>(x.layerId||x.id)===(t.layerId||t.id)),factor=a==='enlarge'?1.1:1/1.1,nw=clamp(t.w*factor,.15,1),nh=clamp(t.h*factor,.15,1),cx=t.x+t.w/2,cy=t.y+t.h/2,nx=clamp(cx-nw/2,0,1-nw),ny=clamp(cy-nh/2,0,1-nh);members.forEach(x=>{x.w=nw;x.h=nh;x.x=nx;x.y=ny})}else if(a==='remove'){const[t]=state.tracks.splice(i,1);if(savedProject?.tracks)savedProject.tracks=savedProject.tracks.filter(x=>x.fileName!==(t.fileName||t.name));t.video.pause?.();try{t.gifDecoder?.close()}catch(e){}t.nativeGifImage?.remove?.();t.stream?.getTracks().forEach(track=>track.stop());if(t.url)URL.revokeObjectURL(t.url);if(t.id===state.selectedId)state.selectedId=state.tracks[0]?.id||null}else if(a==='select')state.selectedId=state.tracks[i].id;else if(a==='lock'){state.tracks[i].locked=!state.tracks[i].locked;status(state.tracks[i].locked?'Clip fixiert.':'Clip entsperrt.');}else if(a==='up'||a==='down'){const groups=gridGroups(),gi=groups.findIndex(g=>g[0]===(state.tracks[i].layerId||state.tracks[i].id)),to=gi+(a==='up'?1:-1);if(gi>=0&&to>=0&&to<groups.length){[groups[gi],groups[to]]=[groups[to],groups[gi]];state.tracks=groups.flatMap(g=>g[1]);state.layerIds=groups.map(g=>g[0]);}}render();});mediaList.addEventListener('click',e=>{const item=e.target.closest('.media-item');if(item){state.selectedId=item.dataset.id;render()}});
videoInput.addEventListener('change',e=>{browserEngine?.addFiles(Array.from(e.target.files||[]));e.target.value=''});
const crossfadeControl=document.getElementById('crossfadeControl'),crossfadeValue=document.getElementById('crossfadeValue'),strobe=document.getElementById('strobeIntensity'),rate=document.getElementById('strobeRate'),strobeToggle=document.getElementById('strobeToggle'),vizColorA=document.getElementById('visualizerColorA'),vizColorB=document.getElementById('visualizerColorB'),gain=document.getElementById('visualizerGain'),visual=document.getElementById('visualizerStyle'),chroma=document.getElementById('chromaEnabled'),chromaColor=document.getElementById('chromaColor'),tolerance=document.getElementById('chromaTolerance');function controls(){state.filterPreset=document.getElementById('filterPreset').value;state.crossfade=+crossfadeControl.value;crossfadeValue.textContent=state.crossfade+'%';state.strobe=+strobe.value;state.strobeRate=+rate.value;state.strobeEnabled=strobeToggle.checked;state.visualizerColorA=vizColorA.value;state.visualizerColorB=vizColorB.value;state.micGain=+gain.value;state.micSensitivity=+document.getElementById('micSensitivity').value;state.visualizerStyle=visual.value;state.chromaEnabled=chroma.checked;state.chromaColor=chromaColor.value;state.chromaTolerance=+tolerance.value;document.getElementById('strobeValue').value=`${Math.round(state.strobe/.85*100)}%`;document.getElementById('rateValue').value=`${state.strobeRate} Hz`;document.getElementById('gainValue').value=`${state.micGain}×`;document.getElementById('chromaValue').value=state.chromaTolerance}document.getElementById('filterPreset').addEventListener('change',e=>{state.filterPreset=e.target.value;});[crossfadeControl,strobe,rate,strobeToggle,vizColorA,vizColorB,gain,visual,chroma,chromaColor,tolerance].forEach(i=>{i.addEventListener('input',controls);i.addEventListener('change',controls)});document.getElementById('playAll').addEventListener('click',()=>state.tracks.forEach(t=>t.video.play?.().catch?.(()=>{})));document.getElementById('pauseAll').addEventListener('click',()=>state.tracks.forEach(t=>t.video.pause?.()));
const micButton=document.getElementById('micToggle'),beatReadout=document.getElementById('beatReadout'),micHelp=document.getElementById('micHelp'),micStatus=document.getElementById('micStatus'),meter=document.getElementById('micMeterFill');micButton.addEventListener('click',async()=>{if(state.micEnabled){state.micStream.getTracks().forEach(t=>t.stop());await state.audioContext.close();state.micEnabled=false;resetBeatTracker();state.analyser=null;state.floatFreqData=null;state.freqData=null;state.timeData=null;state.micLevel=0;micButton.classList.remove('active');micButton.innerHTML='◉ <span>Mikrofon aktivieren</span>';micStatus.textContent='MIC OFF';return}if(!navigator.mediaDevices?.getUserMedia){micHelp.textContent='Mikrofon benötigt HTTPS oder localhost.';return}try{state.micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});const AC=window.AudioContext||window.webkitAudioContext;state.audioContext=new AC();await state.audioContext.resume();state.analyser=state.audioContext.createAnalyser();state.analyser.fftSize=4096;state.analyser.smoothingTimeConstant=Number(document.getElementById('audioSmoothing')?.value??.08);state.analyser.minDecibels=-90;state.analyser.maxDecibels=-10;state.audioContext.createMediaStreamSource(state.micStream).connect(state.analyser);state.timeData=new Uint8Array(state.analyser.fftSize);state.freqData=new Uint8Array(state.analyser.frequencyBinCount);state.floatFreqData=new Float32Array(state.analyser.frequencyBinCount);resetBeatTracker();state.micEnabled=true;micButton.classList.add('active');micButton.innerHTML='◉ <span>Mikrofon deaktivieren</span>';micStatus.textContent='MIC LIVE';micHelp.textContent='Mikrofon aktiv. Pegelanzeige reagiert auf Eingangssignal.'}catch(err){micHelp.textContent=err.name==='NotAllowedError'?'Mikrofon blockiert: Browser-Berechtigung erlauben.':'Mikrofon nicht verfügbar. HTTPS und Eingabegerät prüfen.'}});function resetBeatTracker(){
 state.beatBpm=0;state.beatPeriod=0;state.beatConfidence=0;state.lastBeatAt=0;state.nextBeatAt=0;state.lastOnsetAt=0;state.strobePulseUntil=0;state.lastStrobeAt=-1e9;
 state.fluxMean=.25;state.fluxDeviation=.8;state.bassNoiseDb=-94;state.spectrumPrimed=false;
 state.prevSpectrum=state.floatFreqData?new Float32Array(state.floatFreqData.length):null;
 if(state.prevSpectrum)state.prevSpectrum.fill(-100);
}
function registerBeat(now,strength){
 const previous=state.lastBeatAt;
 if(previous){
  const elapsed=now-previous;
  if(elapsed>=260&&elapsed<=2400){
   const steps=state.beatPeriod?clamp(Math.round(elapsed/state.beatPeriod),1,4):1;
   const observed=elapsed/steps;
   if(observed>=280&&observed<=1400){
    if(!state.beatPeriod)state.beatPeriod=observed;
    else{
     const ratio=observed/state.beatPeriod;
     if(ratio>=.72&&ratio<=1.38)state.beatPeriod=state.beatPeriod*.82+observed*.18;
     else if(ratio>=.55&&ratio<=1.8){state.beatPeriod=state.beatPeriod*.9+observed*.1;state.beatConfidence*=.55;}
     else state.beatConfidence*=.45;
    }
    state.beatConfidence=clamp(state.beatConfidence+.22,0,1);
   }
  }else if(elapsed>2400){state.beatPeriod=0;state.beatConfidence=0;}
 }
 state.lastBeatAt=now;
 state.beatBpm=state.beatPeriod?60000/state.beatPeriod:0;
 state.nextBeatAt=state.beatPeriod?now+state.beatPeriod:0;
 if(now-state.lastStrobeAt>70){state.strobePulseUntil=now+38;state.lastStrobeAt=now;}
 state.micPeak=clamp(strength/12,.15,1);
}
function audio(){
 if(!state.analyser){
  state.micLevel*=.9;state.micPeak*=.9;meter.style.width=`${state.micLevel*100}%`;
  beatReadout.textContent='MIC OFF · FREE RATE';return;
 }
 state.analyser.getByteTimeDomainData(state.timeData);
 state.analyser.getByteFrequencyData(state.freqData);
 state.analyser.getFloatFrequencyData(state.floatFreqData);
 let sum=0;for(const v of state.timeData){const sample=(v-128)/128;sum+=sample*sample}
 const rms=Math.sqrt(sum/state.timeData.length),raw=clamp(rms*state.micGain*5,0,1),now=performance.now();
 const binHz=state.audioContext.sampleRate/state.analyser.fftSize;
 const first=Math.max(2,Math.floor(38/binHz)),last=Math.min(state.floatFreqData.length-1,Math.ceil(160/binHz));
 let flux=0,bassDb=0,count=0;
 if(!state.prevSpectrum||state.prevSpectrum.length!==state.floatFreqData.length)resetBeatTracker();
 for(let i=first;i<=last;i++){
  const db=Number.isFinite(state.floatFreqData[i])?state.floatFreqData[i]:-100;
  if(state.spectrumPrimed){
   const rise=Math.max(0,Math.min(24,db-state.prevSpectrum[i]));
   flux+=rise*(i*binHz<110?1.2:.85);
  }
  bassDb+=db;count++;state.prevSpectrum[i]=db;
 }
 state.spectrumPrimed=true;
 flux/=Math.max(1,count);bassDb/=Math.max(1,count);
 if(bassDb<state.bassNoiseDb+10)state.bassNoiseDb=state.bassNoiseDb*.995+bassDb*.005;
 const sensitivity=clamp(state.micSensitivity,.8,4);
 const threshold=Math.max(2.4,state.fluxMean+state.fluxDeviation*(3.4-(sensitivity-.8)*.56));
 const energyGate=Math.max(-86,state.bassNoiseDb+5);
 const onset=bassDb>energyGate&&flux>threshold&&now-state.lastOnsetAt>245;
 if(onset){state.lastOnsetAt=now;registerBeat(now,flux);}
 else if(state.beatPeriod&&state.nextBeatAt&&now>=state.nextBeatAt&&now-state.lastBeatAt<state.beatPeriod*1.65){
  const late=now-state.nextBeatAt,steps=Math.floor(late/state.beatPeriod)+1;
  if(late<state.beatPeriod*.48&&now-state.lastStrobeAt>70){state.strobePulseUntil=now+38;state.lastStrobeAt=now;}
  state.nextBeatAt+=steps*state.beatPeriod;
 }
 if(state.beatPeriod&&now-state.lastBeatAt>Math.max(1900,state.beatPeriod*2.8)){state.beatPeriod=0;state.beatBpm=0;state.beatConfidence=0;state.nextBeatAt=0;}
 const clippedFlux=Math.min(flux,state.fluxMean+state.fluxDeviation*2.4),oldMean=state.fluxMean;
 state.fluxMean=oldMean+(clippedFlux-oldMean)*.025;
 state.fluxDeviation+=(Math.abs(clippedFlux-oldMean)-state.fluxDeviation)*.025;
 state.micLevel=raw>state.micLevel?state.micLevel*.2+raw*.8:state.micLevel*.78+raw*.22;
 state.micPeak*=.88;meter.style.width=`${state.micLevel*100}%`;
 beatReadout.textContent=state.beatPeriod?`${Math.round(state.beatBpm)} BPM · ${state.beatConfidence>=.55?'BEAT LOCK':'SYNCING'}`:'BEAT SEARCH';
}
async function detectScreens(){const select=document.getElementById('monitorSelect');if(!window.getScreenDetails){status('Browser unterstützt keine Monitor-Erkennung. Ausgabe-Fenster öffnen und manuell auf den gewünschten Bildschirm ziehen.');return}try{const d=await window.getScreenDetails();state.screens=d.screens;select.replaceChildren();d.screens.forEach((s,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=s.label||`Bildschirm ${i+1}`;select.append(o)});status(`${d.screens.length} Bildschirm(e) erkannt.`)}catch(e){status('Monitorzugriff verweigert. Website-Berechtigung „Fensterverwaltung“ erlauben oder Ausgabe-Fenster manuell ziehen.')}}document.getElementById('detectMonitors').addEventListener('click',detectScreens);
function drawSelectionOverlay(ctx,c,t){const x=t.x*c.width,y=t.y*c.height,w=t.w*c.width,h=t.h*c.height;ctx.save();ctx.strokeStyle='#d1ff38';ctx.lineWidth=Math.max(2,c.width/640);ctx.setLineDash([9,6]);ctx.strokeRect(x,y,w,h);ctx.setLineDash([]);const s=Math.max(12,c.width*.014),points=[[x,y],[x+w/2,y],[x+w,y],[x+w,y+h/2],[x+w,y+h],[x+w/2,y+h],[x,y+h],[x,y+h/2]];ctx.fillStyle='#d1ff38';points.forEach(([px,py])=>{ctx.fillRect(px-s/2,py-s/2,s,s);ctx.strokeStyle='#151515';ctx.lineWidth=1.5;ctx.strokeRect(px-s/2,py-s/2,s,s)});ctx.restore()}
function point(e,c){const r=c.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height}}
function edgeAt(p,t,threshold=.035){const l=Math.abs(p.x-t.x)<=threshold,r=Math.abs(p.x-(t.x+t.w))<=threshold,top=Math.abs(p.y-t.y)<=threshold,bottom=Math.abs(p.y-(t.y+t.h))<=threshold;if(l&&top)return' nw';if(r&&top)return' ne';if(l&&bottom)return' sw';if(r&&bottom)return' se';if(top)return'n';if(bottom)return's';if(l)return'w';if(r)return'e';return''}
function topmostTrackAt(p){const solo=state.tracks.some(t=>t.solo),visible=state.tracks.filter(t=>t.visible&&t.opacity>0&&t.video?.readyState>=2&&t.video?.videoWidth&&(!solo||t.solo)&&(state.activeColumns[t.layerId||t.id]??0)===Number(t.column||0)),layers=[...new Set([...(state.layerIds||[]),...state.tracks.map(t=>t.layerId||t.id)])],mix=state.crossfade/100,f=mix*mix*(3-2*mix);for(const id of layers){const group=visible.filter(t=>(t.layerId||t.id)===id),a=group.filter(t=>t.deck==='A'),b=group.filter(t=>t.deck==='B'),ordered=a.length&&b.length?[...a.filter(t=>1-f>.001),...b.filter(t=>f>.001)]:group;for(let i=ordered.length-1;i>=0;i--){const t=ordered[i];if(p.x>=t.x&&p.x<=t.x+t.w&&p.y>=t.y&&p.y<=t.y+t.h)return t;}}return null}
function attachDrag(c){const pointers=new Map();let pinch=null;c.style.touchAction='none';c.addEventListener('pointerdown',e=>{const p=point(e,c);pointers.set(e.pointerId,p);c.setPointerCapture(e.pointerId);if(pointers.size===2){const pts=[...pointers.values()],dx=pts[0].x-pts[1].x,dy=pts[0].y-pts[1].y,t=state.tracks.find(x=>x.id===state.selectedId&&x.visible);if(t&&!t.locked){pinch={id:t.id,distance:Math.max(.01,Math.hypot(dx,dy)),w:t.w,h:t.h,cx:t.x+t.w/2,cy:t.y+t.h/2};state.drag=null;e.preventDefault()}return}const r=state.visualizerRect;if(c===previewCanvas&&state.visualizerStyle!=='off'&&p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h){state.drag={type:'viz',resize:p.x>r.x+r.w-.025&&p.y>r.y+r.h-.025,dx:p.x-r.x,dy:p.y-r.y};e.preventDefault();return}const t=topmostTrackAt(p);if(t&&!t.locked){state.selectedId=t.id;const edge=edgeAt(p,t);state.drag={type:'track',id:t.id,edge,dx:p.x-t.x,dy:p.y-t.y,startX:t.x,startY:t.y,startW:t.w,startH:t.h};render();e.preventDefault()}});c.addEventListener('pointermove',e=>{if(pointers.has(e.pointerId))pointers.set(e.pointerId,point(e,c));if(pinch&&pointers.size>=2){const pts=[...pointers.values()],distance=Math.max(.01,Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y)),t=state.tracks.find(x=>x.id===pinch.id);if(t&&!t.locked){const factor=distance/pinch.distance,nw=clamp(pinch.w*factor,.08,2),nh=clamp(pinch.h*factor,.08,2);t.w=nw;t.h=nh;t.x=clamp(pinch.cx-nw/2,-.5,1.5-nw);t.y=clamp(pinch.cy-nh/2,-.5,1.5-nh);}e.preventDefault();return}if(!state.drag)return;const p=point(e,c),d=state.drag;if(d.type==='viz'){const r=state.visualizerRect;if(d.resize){r.w=clamp(p.x-r.x,.12,1-r.x);r.h=clamp(p.y-r.y,.08,1-r.y)}else{r.x=clamp(p.x-d.dx,0,1-r.w);r.y=clamp(p.y-d.dy,0,1-r.h)}}else{const t=state.tracks.find(x=>x.id===d.id);if(!t||t.locked)return;if(d.edge){const min=.08;if(d.edge.includes('w')){const right=d.startX+d.startW;t.x=clamp(p.x,0,right-min);t.w=right-t.x}if(d.edge.includes('e'))t.w=clamp(p.x-d.startX,min,2);if(d.edge.includes('n')){const bottom=d.startY+d.startH;t.y=clamp(p.y,0,bottom-min);t.h=bottom-t.y}if(d.edge.includes('s'))t.h=clamp(p.y-d.startY,min,2)}else{t.x=clamp(p.x-d.dx,-.5,1.5-t.w);t.y=clamp(p.y-d.dy,-.5,1.5-t.h)}}e.preventDefault()});const finish=e=>{pointers.delete(e.pointerId);if(pointers.size<2)pinch=null;state.drag=null};for(const ev of ['pointerup','pointercancel','lostpointercapture'])c.addEventListener(ev,finish)}
attachDrag(previewCanvas);function openOutput(){const win=window.open('','vjstudio-output','popup,width=1280,height=760');if(!win){status('Popup blockiert. Popups für diese Seite erlauben.',true);return}state.outputWindow=win;win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>VJ Studio Output</title><style>*{box-sizing:border-box}body{margin:0;background:#090a0d;color:#aaa;font:11px system-ui}header{height:30px;padding:7px 12px;background:#191a1e}canvas{width:100vw;height:calc(100vh - 30px);display:block;touch-action:none}</style></head><body><header>VJ STUDIO · PROGRAM OUTPUT</header><canvas id="out" width="1280" height="720"></canvas></body></html>');win.document.close();const s=state.screens[Number(document.getElementById('monitorSelect').value)];if(s)try{win.moveTo(s.availLeft,s.availTop);win.resizeTo(s.availWidth,s.availHeight)}catch(e){}attachDrag(win.document.getElementById('out'))}document.getElementById('openOutput').addEventListener('click',openOutput);document.getElementById('fullscreenOutput').addEventListener('click',()=>{const w=state.outputWindow&&!state.outputWindow.closed?state.outputWindow:window;w.document.documentElement.requestFullscreen?.().catch(()=>{})});
const fxDeck=document.querySelector('.video-effects-deck');document.getElementById('effectsPopupContent').append(fxDeck);document.getElementById('openEffects').addEventListener('click',()=>document.getElementById('effectsDialog').showModal());document.getElementById('closeEffects').addEventListener('click',()=>document.getElementById('effectsDialog').close());document.getElementById('previewFullscreen').addEventListener('click',()=>document.querySelector('.preview-monitor').requestFullscreen?.().catch(()=>{}));document.getElementById('programFullscreen').addEventListener('click',()=>document.querySelector('.program').requestFullscreen?.().catch(()=>{}));function animate(time){if(state.targetFps&&time-(state.lastFrameAt||0)<1000/state.targetFps){requestAnimationFrame(animate);return}state.lastFrameAt=time;audio();browserEngine?.renderGenerators(time);browserEngine?.updatePlayback(time);scene(previewCtx,previewCanvas,time,true,state);updateTransition(time);if(state.outputWindow&&!state.outputWindow.closed){const c=state.outputWindow.document.getElementById('out');if(c)c.getContext('2d').drawImage(outputCanvas,0,0,c.width,c.height)}else if(state.outputWindow?.closed)state.outputWindow=null;document.getElementById('previewLabel').textContent=state.tracks.find(t=>t.id===state.selectedId)?.name||'Clip auswählen';document.getElementById('outputLabel').textContent=`${new Set((state.programState?.tracks||[]).filter(t=>t.visible&&(state.programState.activeColumns[t.layerId||t.id]??0)===Number(t.column||0)).map(t=>t.layerId||t.id)).size} aktive Layer`;requestAnimationFrame(animate)}document.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;if(/^[1-9]$/.test(e.key)){launchGridColumn(Number(e.key)-1);return}if(e.code!=='Space')return;e.preventDefault();const t=state.tracks.find(x=>x.id===state.selectedId);if(t){if(t.video.paused)t.video.play?.().catch?.(()=>{});else t.video.pause?.()}});function projectSnapshot(){return{version:1,gridColumns:state.gridColumns,layerIds:state.layerIds,activeColumns:state.activeColumns,controls:{crossfade:state.crossfade,renderQuality:document.getElementById('renderQuality')?.value||'1080',fpsSelect:document.getElementById('fpsSelect')?.value||'60',audioSmoothing:document.getElementById('audioSmoothing')?.value||'0.08',keybinds,midiMappings,midiFaderMappings,userScenes,strobeIntensity:strobe.value,strobeRate:rate.value,strobeToggle:strobeToggle.checked,visualizerColorA:vizColorA.value,visualizerColorB:vizColorB.value,visualizerGain:gain.value,visualizerStyle:visual.value,chromaEnabled:chroma.checked,chromaColor:chromaColor.value,chromaTolerance:tolerance.value,filterPreset:document.getElementById('filterPreset').value,micSensitivity:document.getElementById('micSensitivity').value},tracks:[...state.tracks.filter(t=>t.type!=='camera').map(t=>({fileName:t.fileName||t.name,layerId:t.layerId||t.id,column:Number(t.column||0),deck:t.deck,x:t.x,y:t.y,w:t.w,h:t.h,opacity:t.opacity,volume:t.volume,visible:t.visible,locked:!!t.locked,strobe:t.strobe,type:t.type||'video',generatorKind:t.generatorKind||null,generatorPalette:t.generatorPalette||'rainbow',blendMode:t.blendMode||'normal',syncBeats:t.syncBeats||0,playMode:t.playMode||'loop',autopilot:t.autopilot||'off',filterPreset:t.filterPreset||'',solo:!!t.solo,audioReactive:!!t.audioReactive})),...(savedProject?.tracks||[]).filter(old=>!state.tracks.some(t=>(t.fileName||t.name)===old.fileName))]};}
let lastProjectJSON='';
function saveProject(){try{const json=JSON.stringify(projectSnapshot());if(json!==lastProjectJSON){localStorage.setItem(PROJECT_KEY,json);lastProjectJSON=json;savedProject=JSON.parse(json);}}catch(e){status('Automatisches Speichern nicht verfügbar (Browser-Speicher blockiert).',true)}}
function downloadProject(){saveProject();const blob=new Blob([JSON.stringify(projectSnapshot(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='vj-studio-project.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
document.getElementById('exportProject').addEventListener('click',downloadProject);
document.getElementById('importProjectInput').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text());if(data.version!==1||!data.controls||!Array.isArray(data.tracks))throw new Error('Ungültiges Projektformat');localStorage.setItem(PROJECT_KEY,JSON.stringify(data));location.reload();}catch(err){status('Projektdatei ungültig: '+err.message,true)}e.target.value=''});
document.addEventListener('input',e=>{if(e.target.closest('#effectsDialog')||e.target.closest('.track'))setTimeout(saveProject,0);},true);
document.addEventListener('change',e=>{if(e.target.closest('#effectsDialog')||e.target.closest('.track')||e.target.id==='filterPreset'||e.target.classList.contains('deck-select'))setTimeout(saveProject,0);},true);
tracksElement.addEventListener('click',()=>setTimeout(saveProject,0));
for(const canvas of [outputCanvas,previewCanvas])canvas.addEventListener('pointerup',()=>setTimeout(saveProject,0));
if(savedProject?.controls){for(const [id,value] of Object.entries(savedProject.controls)){const el=document.getElementById(id);if(el){if(el.type==='checkbox')el.checked=!!value;else el.value=String(value)}}}
controls();const quality=document.getElementById('renderQuality');if(!savedProject?.controls?.renderQuality)quality.value='1080';function applyRenderQuality(){const h=Number(quality.value)||1080,w=Math.round(h*16/9);for(const c of [previewCanvas,outputCanvas]){if(c.width!==w||c.height!==h){c.width=w;c.height=h;}}status(`Render-Auflösung: ${w}×${h}`)}quality?.addEventListener('change',()=>{applyRenderQuality();saveProject()});applyRenderQuality();render();if(savedProject?.tracks?.length){const msg='Projekt geladen: '+savedProject.tracks.length+' Clip(s) vorgemerkt. Bitte Videos erneut auswählen – Videodateien werden nicht gespeichert.';status(msg);document.getElementById('importStatus').title='Die Projektdaten sind lokal gespeichert; Videodateien müssen nach einem Neuladen erneut ausgewählt werden.';}requestAnimationFrame(animate);

/* BETA 0.8.0 — configurable keyboard, MIDI, scenes and render settings */
const SETTINGS_ACTIONS=[
 {id:'transition',label:'Übergang starten'},
 {id:'strobe',label:'Strobe umschalten'},
 {id:'playPause',label:'Ausgewählten Clip abspielen / pausieren'},
 {id:'nextScene',label:'Nächste gespeicherte Szene'},
 {id:'previousScene',label:'Vorherige gespeicherte Szene'},
 ...Array.from({length:8},(_,i)=>({id:'scene'+(i+1),label:'Szene '+(i+1)+' abrufen'}))
];
const settingsDialog=document.getElementById('settingsDialog');
const settingsOpen=document.getElementById('openSettings');
const settingsClose=document.getElementById('closeSettings');
const fpsSelect=document.getElementById('fpsSelect');
const audioSmoothing=document.getElementById('audioSmoothing');
let keybinds={...(savedProject?.controls?.keybinds||{})};
let midiMappings={...(savedProject?.controls?.midiMappings||{})};
let userScenes={...(savedProject?.controls?.userScenes||{})};
let pendingKeyAction=null,pendingMidiAction=null,pendingMidiControl=null,midiAccess=null,midiLastValues={},midiFaderMappings={...(savedProject?.controls?.midiFaderMappings||{})};
if(crossfadeControl){crossfadeControl.value=String(savedProject?.controls?.crossfade??state.crossfade);controls();}
state.targetFps=Number(savedProject?.controls?.fpsSelect||fpsSelect?.value||60);
if(fpsSelect&&savedProject?.controls?.fpsSelect)fpsSelect.value=String(savedProject.controls.fpsSelect);
if(audioSmoothing&&savedProject?.controls?.audioSmoothing)audioSmoothing.value=String(savedProject.controls.audioSmoothing);
function persistSettings(){saveProject();}
function keyLabel(code){if(!code)return'Nicht belegt';return code.replace('Key','').replace('Digit','').replace('Numpad','Num ');}
function midiLabel(m){if(!m)return'Nicht belegt';return(m.type==='cc'?'CC':'Note')+' '+m.number+' · Kanal '+m.channel+(m.deviceName?' · '+m.deviceName:'');}
function renderKeybindRows(){
 const root=document.getElementById('keybindRows');if(!root)return;root.replaceChildren();
 SETTINGS_ACTIONS.forEach(action=>{
  const row=document.createElement('div');row.className='mapping-row';
  const name=document.createElement('strong');name.textContent=action.label;
  const capture=document.createElement('button');capture.type='button';capture.className='subtle-button mapping-capture';capture.textContent=pendingKeyAction===action.id?'Taste drücken …':keyLabel(keybinds[action.id]);
  capture.addEventListener('click',()=>{pendingKeyAction=action.id;renderKeybindRows();});
  const clear=document.createElement('button');clear.type='button';clear.className='subtle-button mapping-clear';clear.textContent='×';clear.title='Tastenzuordnung löschen';clear.addEventListener('click',()=>{delete keybinds[action.id];persistSettings();renderKeybindRows();});
  row.append(name,capture,clear);root.append(row);
 });
}
function renderMidiMappingRows(){
 const root=document.getElementById('midiMappingRows');if(!root)return;root.replaceChildren();
 SETTINGS_ACTIONS.forEach(action=>{
  const row=document.createElement('div');row.className='mapping-row';
  const name=document.createElement('strong');name.textContent=action.label;
  const capture=document.createElement('button');capture.type='button';capture.className='subtle-button mapping-capture';capture.textContent=pendingMidiAction===action.id?'MIDI-Signal senden …':midiLabel(midiMappings[action.id]);
  capture.addEventListener('click',()=>{pendingMidiAction=action.id;renderMidiMappingRows();});
  const clear=document.createElement('button');clear.type='button';clear.className='subtle-button mapping-clear';clear.textContent='×';clear.title='MIDI-Zuordnung löschen';clear.addEventListener('click',()=>{delete midiMappings[action.id];persistSettings();renderMidiMappingRows();});
  row.append(name,capture,clear);root.append(row);
 });
 const heading=document.createElement('p');heading.className='muted small';heading.textContent='MIDI-Fader · kontinuierliche CC-Steuerung';root.append(heading);
 const faderLabels={crossfade:'Crossfader',transitionProgress:'Übergang (Preview → Live)',strobeRate:'Strobe Rate',strobeIntensity:'Strobe Intensität'};
 for(const [id,label] of Object.entries(faderLabels)){
  const row=document.createElement('div');row.className='mapping-row';
  const name=document.createElement('strong');name.textContent=label;
  const capture=document.createElement('button');capture.type='button';capture.className='subtle-button mapping-capture';
  capture.textContent=pendingMidiControl===id?'Fader bewegen …':midiLabel(midiFaderMappings[id]);
  capture.addEventListener('click',()=>{pendingMidiControl=id;pendingMidiAction=null;renderMidiMappingRows();});
  const clear=document.createElement('button');clear.type='button';clear.className='subtle-button mapping-clear';clear.textContent='×';clear.title='Fader-Zuordnung löschen';
  clear.addEventListener('click',()=>{delete midiFaderMappings[id];persistSettings();renderMidiMappingRows();});
  row.append(name,capture,clear);root.append(row);
 }
}
function scenePayload(){
 return {activeColumns:{...state.activeColumns},layerIds:[...(state.layerIds||[])],tracks:state.tracks.map(t=>({id:t.id,key:t.fileName||t.name,visible:!!t.visible,column:Number(t.column||0),layerId:t.layerId||t.id,deck:t.deck,opacity:t.opacity,blendMode:t.blendMode||'normal'})),strobe:state.strobe,strobeRate:state.strobeRate,strobeEnabled:state.strobeEnabled,crossfade:state.crossfade,transitionStyle:state.transitionStyle,transitionDuration:state.transitionDuration,visualizerStyle:state.visualizerStyle,visualizerColorA:state.visualizerColorA,visualizerColorB:state.visualizerColorB,visualizerRect:{...state.visualizerRect},filterPreset:state.filterPreset,chromaEnabled:state.chromaEnabled,chromaColor:state.chromaColor,chromaTolerance:state.chromaTolerance};
}
function captureScene(slot){
 userScenes[String(slot)]={...scenePayload(),name:'Szene '+slot,savedAt:Date.now()};
 persistSettings();renderSceneRows();status('Szene '+slot+' gespeichert.');
}
function recallScene(slot){
 const sceneData=userScenes[String(slot)];if(!sceneData){status('Szene '+slot+' ist noch leer.',true);return false;}
 state.activeColumns={...(sceneData.activeColumns||{})};state.layerIds=[...(sceneData.layerIds||state.layerIds||[])];
 (sceneData.tracks||[]).forEach(saved=>{const t=state.tracks.find(x=>x.id===saved.id||(saved.key&&(x.fileName||x.name)===saved.key));if(!t)return;for(const k of ['visible','column','layerId','deck','opacity','blendMode'])if(saved[k]!==undefined)t[k]=saved[k];});
 for(const k of ['strobe','strobeRate','strobeEnabled','crossfade','transitionStyle','transitionDuration','visualizerStyle','visualizerColorA','visualizerColorB','filterPreset','chromaEnabled','chromaColor','chromaTolerance'])if(sceneData[k]!==undefined)state[k]=sceneData[k];
 if(sceneData.visualizerRect)state.visualizerRect={...sceneData.visualizerRect};
 if(document.getElementById('filterPreset'))document.getElementById('filterPreset').value=state.filterPreset||'none';if(transitionStyle)transitionStyle.value=state.transitionStyle||'mix';if(transitionDuration)transitionDuration.value=String(state.transitionDuration||1000);if(strobe)strobe.value=String(state.strobe);if(rate)rate.value=String(state.strobeRate);if(strobeToggle)strobeToggle.checked=!!state.strobeEnabled;if(vizColorA)vizColorA.value=state.visualizerColorA;if(vizColorB)vizColorB.value=state.visualizerColorB;if(visual)visual.value=state.visualizerStyle;if(chroma)chroma.checked=!!state.chromaEnabled;if(chromaColor)chromaColor.value=state.chromaColor;if(tolerance)tolerance.value=String(state.chromaTolerance);
 controls();render();startTransition();persistSettings();status('Szene '+slot+' geladen · Übergang läuft.');
 return true;
}
function renderSceneRows(){
 const root=document.getElementById('sceneRows');if(!root)return;root.replaceChildren();
 for(let slot=1;slot<=8;slot++){
  const data=userScenes[String(slot)],row=document.createElement('div');row.className='scene-row';
  const name=document.createElement('strong');name.textContent=data?.name||('Szene '+slot+' · Leer');
  const save=document.createElement('button');save.type='button';save.className='subtle-button';save.textContent='Aktuell speichern';save.addEventListener('click',()=>captureScene(slot));
  const recall=document.createElement('button');recall.type='button';recall.className='subtle-button';recall.textContent='Abrufen';recall.disabled=!data;recall.addEventListener('click',()=>recallScene(slot));
  row.append(name,save,recall);root.append(row);
 }
}
function runMappedAction(id){
 if(id==='transition'){startTransition();return;}
 if(id==='strobe'){state.strobeEnabled=!state.strobeEnabled;if(strobeToggle)strobeToggle.checked=state.strobeEnabled;controls();persistSettings();return;}
 if(id==='playPause'){const t=state.tracks.find(x=>x.id===state.selectedId);if(t?.video){if(t.video.paused)t.video.play?.().catch?.(()=>{});else t.video.pause?.();}return;}
 if(id==='nextScene'||id==='previousScene'){
  const slots=Object.keys(userScenes).map(Number).filter(n=>n>=1&&n<=8).sort((a,b)=>a-b);if(!slots.length)return;
  const current=slots.findIndex(n=>JSON.stringify(userScenes[String(n)]?.activeColumns||{})===JSON.stringify(state.activeColumns));
  const next=id==='nextScene'?(current+1)%slots.length:(current<=0?slots.length-1:current-1);recallScene(slots[next]);return;
 }
 if(id.startsWith('scene'))recallScene(Number(id.slice(5)));
}
function keyCombo(e){const parts=[];if(e.ctrlKey)parts.push('Ctrl');if(e.altKey)parts.push('Alt');if(e.shiftKey)parts.push('Shift');if(e.metaKey)parts.push('Meta');parts.push(e.code);return parts.join('+');}
document.addEventListener('keydown',e=>{
 if(pendingKeyAction){
  if(['ControlLeft','ControlRight','AltLeft','AltRight','ShiftLeft','ShiftRight','MetaLeft','MetaRight'].includes(e.code))return;
  e.preventDefault();e.stopImmediatePropagation();keybinds[pendingKeyAction]=keyCombo(e);pendingKeyAction=null;persistSettings();renderKeybindRows();return;
 }
 if(settingsDialog?.open)return;
 if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
 const combo=keyCombo(e),action=SETTINGS_ACTIONS.find(a=>keybinds[a.id]===combo);
 if(action){e.preventDefault();e.stopImmediatePropagation();runMappedAction(action.id);}
},true);
function midiMessage(event){
 const [statusByte,number,value]=event.data||[];if(statusByte===undefined)return;
 const command=statusByte&0xf0,channel=(statusByte&0x0f)+1;
 const edgeKey=event.currentTarget.id+':'+channel+':'+(command===0x80?0x90:command)+':'+number;
 if(command===0x80||(command===0x90&&value===0)){midiLastValues[edgeKey]=false;return;}
 let type=null;if(command===0x90&&value>0)type='note';else if(command===0xb0)type='cc';else return;
 if(pendingMidiControl){
  const selected=document.getElementById('midiInputSelect')?.value||'';
  if(selected&&selected!==event.currentTarget.id)return;
  if(type!=='cc')return;
  midiFaderMappings[pendingMidiControl]={type:'cc',channel,number,deviceId:selected||null,deviceName:selected?(event.currentTarget.name||''):''};
  const label={crossfade:'Crossfader',transitionProgress:'Übergang (Preview → Live)',strobeRate:'Strobe Rate',strobeIntensity:'Strobe Intensität'}[pendingMidiControl];
  pendingMidiControl=null;persistSettings();renderMidiMappingRows();
  const info=document.getElementById('midiSettingsStatus');if(info)info.textContent='MIDI-Fader gelernt: '+label+' · '+midiLabel(midiFaderMappings[Object.keys(midiFaderMappings).find(k=>midiFaderMappings[k]?.number===number&&midiFaderMappings[k]?.channel===channel)]);
  return;
 }
 if(pendingMidiAction){
  const selected=document.getElementById('midiInputSelect')?.value||'';
  if(selected&&selected!==event.currentTarget.id)return;
  const learned={type,channel,number,deviceId:selected||null,deviceName:selected?(event.currentTarget.name||''):''};midiMappings[pendingMidiAction]=learned;
  pendingMidiAction=null;persistSettings();renderMidiMappingRows();
  const info=document.getElementById('midiSettingsStatus');if(info)info.textContent='MIDI gelernt: '+midiLabel(learned);
  return;
 }
 if(type==='cc'){
  let changed=false;
  for(const [id,m] of Object.entries(midiFaderMappings)){
   if(m&&m.number===number&&m.channel===channel&&(!m.deviceId||m.deviceId===event.currentTarget.id)){
    const normalized=value/127;
    if(id==='crossfade'&&crossfadeControl){crossfadeControl.value=String(Math.round(normalized*100));changed=true;}
    if(id==='transitionProgress'&&transitionProgress){transitionProgress.value=String(Math.round(normalized*100));transitionProgress.dispatchEvent(new Event('input',{bubbles:true}));changed=true;}
    if(id==='strobeRate'){rate.value=String((1+normalized*7).toFixed(2));changed=true;}
    if(id==='strobeIntensity'){strobe.value=String((normalized*.96).toFixed(3));changed=true;}
   }
  }
  if(changed){controls();persistSettings();return;}
 }
 const active=type==='note'?value>0:value>=64,was=midiLastValues[edgeKey]||false;midiLastValues[edgeKey]=active;
 if(!active||was)return;
 for(const [id,m] of Object.entries(midiMappings)){
  if(m&&m.type===type&&m.number===number&&m.channel===channel&&(!m.deviceId||m.deviceId===event.currentTarget.id))runMappedAction(id);
 }
}
function refreshMidiInputs(){
 const select=document.getElementById('midiInputSelect');if(!select)return;const selected=select.value;select.replaceChildren(new Option('Alle Eingänge',''));
 if(midiAccess)for(const input of midiAccess.inputs.values())select.add(new Option(input.name||('MIDI '+input.id),input.id));
 if([...select.options].some(o=>o.value===selected))select.value=selected;
}
function attachMidiInputs(){
 if(!midiAccess)return;
 for(const input of midiAccess.inputs.values())input.onmidimessage=midiMessage;
 refreshMidiInputs();
 const info=document.getElementById('midiSettingsStatus');if(info)info.textContent='MIDI verbunden · '+midiAccess.inputs.size+' Eingang/Eingänge verfügbar.';
}
async function connectMidi(){
 if(!navigator.requestMIDIAccess){const message='Dieser Browser unterstützt Web MIDI nicht. Bitte Chrome oder Edge verwenden.';const info=document.getElementById('midiSettingsStatus');if(info)info.textContent=message;status(message,true);return;}
 try{midiAccess=await navigator.requestMIDIAccess({sysex:false});midiAccess.onstatechange=attachMidiInputs;attachMidiInputs();document.getElementById('midiStatus').textContent='MIDI READY';status('MIDI verbunden · '+midiAccess.inputs.size+' Eingang/Eingänge gefunden.');}
 catch(error){const message=error.name==='SecurityError'?'MIDI benötigt HTTPS und Browser-Berechtigung.':'MIDI konnte nicht verbunden werden: '+error.message;const info=document.getElementById('midiSettingsStatus');if(info)info.textContent=message;status(message,true);}
}
document.getElementById('midiToggle')?.addEventListener('click',connectMidi);
document.getElementById('midiConnectSettings')?.addEventListener('click',connectMidi);
settingsOpen?.addEventListener('click',()=>{settingsDialog.showModal();renderKeybindRows();renderMidiMappingRows();renderSceneRows();refreshMidiInputs();});
settingsClose?.addEventListener('click',()=>settingsDialog.close());
fpsSelect?.addEventListener('change',()=>{state.targetFps=Number(fpsSelect.value)||60;persistSettings();status('Bildrate auf '+state.targetFps+' FPS begrenzt.');});
audioSmoothing?.addEventListener('change',()=>{if(state.analyser)state.analyser.smoothingTimeConstant=Number(audioSmoothing.value);persistSettings();});
renderKeybindRows();renderMidiMappingRows();renderSceneRows();
