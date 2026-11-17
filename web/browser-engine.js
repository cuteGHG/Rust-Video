const VIDEO_EXT=/\.(mp4|m4v|webm|mov|ogv|ogg|mkv|avi)$/i;
const IMAGE_EXT=/\.(png|jpe?g|webp|gif|bmp)$/i;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const uid=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`;
const BEATS=[.25,.5,1,2,4,8,16,32];
const OPS={normal:'source-over',add:'lighter',screen:'screen',multiply:'multiply',overlay:'overlay',difference:'difference',lighten:'lighten',darken:'darken',subtract:'difference'};
function createImageMedia(file,url){const img=new Image();img.src=url;img.decoding='async';img.loading='eager';img.setAttribute('fetchpriority','high');Object.defineProperties(img,{videoWidth:{get:()=>img.naturalWidth},videoHeight:{get:()=>img.naturalHeight},readyState:{get:()=>img.complete&&img.naturalWidth?4:0},paused:{get:()=>false}});img.volume=.8;img.play=()=>Promise.resolve();img.pause=()=>{};return img}
function keepNativeGifAnimated(t){
 const img=t.nativeGifImage||t.video;
 if(!img||img.tagName!=='IMG')return false;
 // Use the browser's own animated-image timeline. Do not replace it with a
 // canvas holding frame zero: drawImage(img, ...) samples the current GIF frame.
 t.nativeGifImage=img;t.video=img;t.gifDecoder=null;t.gifNativeFallback=true;
 const sizeSource=()=>{
  const w=img.naturalWidth||img.width||1,h=img.naturalHeight||img.height||1;
  img.style.width=w+'px';img.style.height=h+'px';
 };
 img.setAttribute('aria-hidden','true');
 img.style.position='fixed';img.style.left='0';img.style.top='0';
 img.style.width=(img.naturalWidth||1)+'px';img.style.height=(img.naturalHeight||1)+'px';
 img.style.opacity='0.001';img.style.visibility='visible';
 img.style.pointerEvents='none';
 // Keep the animated source in the top compositing layer. A negative z-index
 // can place it behind the document background, where Safari may stop painting
 // animated GIF frames even though the image remains connected to the DOM.
 img.style.zIndex='2147483647';
 img.style.display='block';img.style.maxWidth='none';img.style.maxHeight='none';
 if(!img.isConnected)document.body.append(img);
 if(!img.complete||!img.naturalWidth)img.addEventListener('load',sizeSource,{once:true});
 else sizeSource();
 return true;
}
function readGifSubBlocks(bytes,state){
 const parts=[];let total=0;
 while(state.p<bytes.length){const size=bytes[state.p++];if(!size)break;const part=bytes.subarray(state.p,state.p+size);parts.push(part);total+=size;state.p+=size;}
 const out=new Uint8Array(total);let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length;}return out;
}
function decodeGifLzw(data,minCodeSize,expected){
 const clear=1<<minCodeSize,end=clear+1,table=new Array(4096),out=new Uint8Array(expected);
 let codeSize=minCodeSize+1,nextCode=end+1,bit=0,old=null,first=0,pos=0;
 const reset=()=>{for(let i=0;i<clear;i++)table[i]=[i];codeSize=minCodeSize+1;nextCode=end+1;old=null;};
 reset();
 while(bit+codeSize<=data.length*8&&pos<expected){
  let code=0;for(let i=0;i<codeSize;i++)code|=((data[(bit+i)>>3]>>((bit+i)&7))&1)<<i;bit+=codeSize;
  if(code===clear){reset();continue;}if(code===end)break;
  let entry;
  if(code<nextCode&&table[code])entry=table[code];
  else if(code===nextCode&&old!==null)entry=table[old].concat(first);
  else throw new Error("Ungültiger GIF-LZW-Code");
  for(let i=0;i<entry.length&&pos<expected;i++)out[pos++]=entry[i];
  first=entry[0];
  if(old!==null&&nextCode<4096){table[nextCode++]=table[old].concat(first);if(nextCode===(1<<codeSize)&&codeSize<12)codeSize++;}
  old=code;
 }
 if(pos!==expected)throw new Error("GIF-Frame unvollständig");
 return out;
}
function decodeGifFile(buffer){
 const bytes=new Uint8Array(buffer),state={p:0};
 const read=()=>{if(state.p>=bytes.length)throw new Error("GIF unerwartet abgeschnitten");return bytes[state.p++];};
 const u16=()=>read()|(read()<<8);
 const signature=String.fromCharCode(...bytes.subarray(0,6));if(signature!=="GIF87a"&&signature!=="GIF89a")throw new Error("Keine gültige GIF-Datei");
 state.p=6;const width=u16(),height=u16(),packed=read(),background=read();read();
 if(!width||!height||width*height>16000000)throw new Error("GIF-Abmessungen ungültig");
 const readPalette=size=>{const p=new Uint8Array(size*3);for(let i=0;i<p.length;i++)p[i]=read();return p;};
 const globalPalette=(packed&128)?readPalette(1<<((packed&7)+1)):null;
 const output=document.createElement("canvas");output.width=width;output.height=height;
 const out=output.getContext("2d",{willReadFrequently:true});if(!out)throw new Error("Canvas nicht verfügbar");
 out.clearRect(0,0,width,height);
 let gce={delay:100,transparent:null,disposal:0},frames=[],previous=null,done=false;
 while(state.p<bytes.length&&!done){
  const marker=read();
  if(marker===0x3b)break;
  if(marker===0x21){
   const label=read();
   if(label===0xf9){const size=read();if(size!==4)throw new Error("GIF-Steuerblock ungültig");const flags=read(),delay=u16()*10,transparent=read();read();gce={delay:delay||100,transparent:(flags&1)?transparent:null,disposal:(flags>>2)&7};}
   else readGifSubBlocks(bytes,state);
   continue;
  }
  if(marker!==0x2c)throw new Error("Unbekannter GIF-Block");
  const left=u16(),top=u16(),fw=u16(),fh=u16(),flags=read();
  if(!fw||!fh||left+fw>width||top+fh>height)throw new Error("GIF-Frame außerhalb der Bildfläche");
  const palette=(flags&128)?readPalette(1<<((flags&7)+1)):globalPalette;
  if(!palette)throw new Error("GIF-Farbpalette fehlt");
  const min=read(),compressed=readGifSubBlocks(bytes,state);
  const indices=decodeGifLzw(compressed,min,fw*fh),rgba=new Uint8ClampedArray(fw*fh*4);
  const rows=[];if(flags&64){for(let y=0;y<fh;y++)rows.push(y);const order=[];for(const [first,step] of [[0,8],[4,8],[2,4],[1,2]])for(let y=first;y<fh;y+=step)order.push(y);rows.splice(0,rows.length,...order);}
  else for(let y=0;y<fh;y++)rows.push(y);
  let src=0;for(const y of rows)for(let x=0;x<fw;x++){const index=indices[src++],dst=(y*fw+x)*4;if(index===gce.transparent)continue;const p=index*3;if(p+2>=palette.length)throw new Error("GIF-Palettenindex ungültig");rgba[dst]=palette[p];rgba[dst+1]=palette[p+1];rgba[dst+2]=palette[p+2];rgba[dst+3]=255;}
  if(previous?.disposal===2){out.clearRect(previous.left,previous.top,previous.width,previous.height);}
  else if(previous?.disposal===3&&previous.restore){out.clearRect(0,0,width,height);out.drawImage(previous.restore,0,0);}
  const restore=gce.disposal===3?document.createElement("canvas"):null;
  if(restore){restore.width=width;restore.height=height;restore.getContext("2d").drawImage(output,0,0);}
  const patch=document.createElement("canvas");patch.width=fw;patch.height=fh;
  patch.getContext("2d").putImageData(new ImageData(rgba,fw,fh),0,0);out.drawImage(patch,left,top);
  const snapshot=document.createElement("canvas");snapshot.width=width;snapshot.height=height;snapshot.getContext("2d").drawImage(output,0,0);
  frames.push({canvas:snapshot,duration:Math.max(20,gce.delay||100)});
  previous={left,top,width:fw,height:fh,disposal:gce.disposal,restore};gce={delay:100,transparent:null,disposal:0};
 }
 if(!frames.length)throw new Error("GIF enthält keine Frames");
 return{width,height,frames,totalDuration:frames.reduce((sum,frame)=>sum+frame.duration,0)};
}
async function setupGifPlayback(file,t){
 try{
  const decoded=decodeGifFile(await file.arrayBuffer());
  const canvas=document.createElement("canvas");canvas.width=decoded.width;canvas.height=decoded.height;
  Object.defineProperties(canvas,{videoWidth:{get:()=>canvas.width},videoHeight:{get:()=>canvas.height},readyState:{get:()=>4},paused:{get:()=>false}});
  canvas.volume=.8;canvas.play=()=>Promise.resolve();canvas.pause=()=>{};
  t.gifFrames=decoded.frames;t.gifTotalDuration=decoded.totalDuration;t.gifStartedAt=performance.now();t.gifFrameIndex=0;
  canvas.getContext("2d").drawImage(decoded.frames[0].canvas,0,0);t.video=canvas;t.gifDecoder=true;t.gifNativeImage?.remove();t.nativeGifImage?.remove();
  status("GIF-Frames dekodiert: "+file.name+" · "+decoded.frames.length+" Frames");
 }catch(error){
  t.gifError=error?.message||"GIF konnte nicht dekodiert werden";
  keepNativeGifAnimated(t);status("GIF-Decoder fehlgeschlagen: "+t.gifError,true);
 }
}
function updateGifFrames(time){
 for(const t of state.tracks){
  if(!t.gifDecoder||!t.gifFrames?.length||t.type!=="image")continue;
  const elapsed=((performance.now()-t.gifStartedAt)%t.gifTotalDuration+t.gifTotalDuration)%t.gifTotalDuration;
  let cursor=0,index=0;for(;index<t.gifFrames.length-1;index++){cursor+=t.gifFrames[index].duration;if(elapsed<cursor)break;}
  if(index===t.gifFrameIndex)continue;
  const ctx=t.video.getContext("2d");ctx.clearRect(0,0,t.video.width,t.video.height);ctx.drawImage(t.gifFrames[index].canvas,0,0);t.gifFrameIndex=index;
 }
}
function createGenerator(kind){
 const c=document.createElement('canvas');c.width=640;c.height=360;
 Object.defineProperties(c,{videoWidth:{get:()=>c.width},videoHeight:{get:()=>c.height},readyState:{get:()=>4},paused:{get:()=>false}});
 c.volume=.8;c.play=()=>Promise.resolve();c.pause=()=>{};c.currentTime=0;
 return c;
}
function renderGenerator(t,time,bpm){
 const c=t.video,x=c.getContext('2d'),w=c.width,h=c.height,beat=bpm>0?time/60000*bpm:time/1000;
 c.currentTime=time/1000;x.save();x.globalCompositeOperation='source-over';x.clearRect(0,0,w,h);
 const baseHue={rainbow:0,fire:12,ocean:195,neon:285,forest:115}[t.generatorPalette||'rainbow']??0,hue=(baseHue+time*.025)%360,phase=beat*Math.PI*2;
 const grad=(a,b)=>{const g=x.createLinearGradient(0,0,w,h);g.addColorStop(0,a);g.addColorStop(1,b);return g};
 switch(t.generatorKind){
 case'plasma':{const g=x.createRadialGradient(w*(.5+.22*Math.sin(time*.00031)),h*(.5+.3*Math.cos(time*.00027)),4,w*.5,h*.5,w*.8);g.addColorStop(0,`hsl(${hue} 95% 70%)`);g.addColorStop(.45,`hsl(${hue+95} 90% 38%)`);g.addColorStop(1,'#080817');x.fillStyle=g;x.fillRect(0,0,w,h);for(let i=0;i<6;i++){x.beginPath();x.arc(w/2+Math.sin(time*.0002+i)*w*.24,h/2+Math.cos(time*.00023+i*2)*h*.25,25+i*13,0,Math.PI*2);x.strokeStyle=`hsla(${hue+i*47} 100% 75% / .45)`;x.lineWidth=3;x.stroke()}break}
 case'tunnel':{x.fillStyle='#080812';x.fillRect(0,0,w,h);for(let i=18;i>0;i--){const r=(i/18)*Math.min(w,h)*.72*(.72+.28*Math.sin(phase*.25));x.beginPath();x.ellipse(w/2,h/2,r*1.5,r,phase*.08,0,Math.PI*2);x.strokeStyle=`hsl(${hue+i*13} 95% 60% / .8)`;x.lineWidth=5;x.stroke()}break}
 case'bars':{x.fillStyle='#070912';x.fillRect(0,0,w,h);for(let i=0;i<26;i++){const bw=w/26*.72,bh=h*(.18+.72*(.5+.5*Math.sin(phase+i*.7)));x.fillStyle=`hsl(${hue+i*9} 95% 58%)`;x.fillRect(i*w/26,(h-bh)/2,bw,bh)}break}
 case'rings':{x.fillStyle='#090812';x.fillRect(0,0,w,h);for(let i=0;i<17;i++){const r=14+i*18+Math.sin(phase-i*.4)*8;x.beginPath();x.arc(w/2,h/2,r,0,Math.PI*2);x.strokeStyle=`hsla(${hue+i*18} 100% 65% / .9)`;x.lineWidth=4+(i%3);x.stroke()}break}
 case'noise':{x.fillStyle=grad('#080916','#27104a');x.fillRect(0,0,w,h);for(let i=0;i<190;i++){const xx=(Math.sin(i*127.1+time*.00015)*.5+.5)*w,yy=(Math.sin(i*311.7-time*.00012)*.5+.5)*h,r=2+(i%7)*1.6;x.fillStyle=`hsla(${hue+i*2} 100% 65% / .45)`;x.fillRect(xx,yy,r,r)}break}
 case'kaleido':{x.fillStyle='#070810';x.fillRect(0,0,w,h);x.save();x.translate(w/2,h/2);for(let i=0;i<12;i++){x.rotate(Math.PI/6);x.rotate(time*.0001);const g=x.createLinearGradient(0,0,w*.45,h*.3);g.addColorStop(0,`hsl(${hue+i*20} 95% 65%)`);g.addColorStop(1,'#140c32');x.fillStyle=g;x.beginPath();x.moveTo(0,0);x.lineTo(w*.48,-h*.2);x.lineTo(w*.38,h*.24);x.closePath();x.fill()}x.restore();break}
 case'gradient':{x.fillStyle=grad(`hsl(${hue} 90% 55%)`,`hsl(${hue+150} 90% 30%)`);x.fillRect(0,0,w,h);const g=x.createRadialGradient(w*(.5+.35*Math.sin(time*.0002)),h*(.5+.35*Math.cos(time*.00017)),4,w/2,h/2,h*.9);g.addColorStop(0,'#ffffff55');g.addColorStop(1,'#00000000');x.fillStyle=g;x.fillRect(0,0,w,h);break}
 case'strobe':{x.fillStyle=(Math.floor(beat)%2)?'#f4f4ff':'#100d2c';x.fillRect(0,0,w,h);x.fillStyle=`hsl(${hue} 95% 65%)`;x.fillRect(w*.2,h*.2,w*.6,h*.6);break}
 case'checker':{x.fillStyle='#090a13';x.fillRect(0,0,w,h);x.save();x.translate(w/2,h/2);x.rotate(time*.00012);const size=34;for(let yy=-h;yy<h;yy+=size)for(let xx=-w;xx<w;xx+=size){if((Math.floor(xx/size)+Math.floor(yy/size))%2===0){x.fillStyle=`hsl(${hue+Math.abs(xx/w)*100} 90% 60%)`;x.fillRect(xx,yy,size,size)}}x.restore();break}
 }
 x.restore();
}
export function initBrowserEngine({state,render,status,saveProject,savedProject}){
 const input=document.getElementById('videoInput'),paletteSelect=document.getElementById('generatorPalette'),cameraButton=document.getElementById('addCamera'),generatorButton=document.getElementById('addGenerator'),generatorSelect=document.getElementById('generatorKind'),tapButton=document.getElementById('tapTempo'),midiButton=document.getElementById('midiToggle'),midiStatus=document.getElementById('midiStatus');
 const midi={access:null,active:false};
 let taps=[],manualBpm=0,lastBeatRate=0;
 function deck(){return 'A'}
 function restored(name){return savedProject?.tracks?.find(t=>t.fileName===name)||null}
 function addTrack(t){state.tracks.push(t);state.selectedId=t.id;render();saveProject();return t}
 function base(name,type,video,url='',fileName=name){const old=restored(fileName);return Object.assign({id:uid(),layerId:old?.layerId||uid(),column:old?.column??0,name,fileName,type,video,url,volume:.8,opacity:1,visible:true,strobe:true,deck:deck(),x:.1,y:.1,w:.8,h:.8,error:'',blendMode:'normal',syncBeats:0},old?{deck:old.deck||deck(),x:old.x??.1,y:old.y??.1,w:old.w??.8,h:old.h??.8,opacity:old.opacity??1,volume:old.volume??.8,visible:old.visible??true,strobe:old.strobe??true,blendMode:old.blendMode||'normal',syncBeats:old.syncBeats||0,playMode:old.playMode||'loop',autopilot:old.autopilot||'off',filterPreset:old.filterPreset||'',solo:!!old.solo,audioReactive:!!old.audioReactive,locked:!!old.locked}:{locked:false})}
 function addFiles(files){
  let count=0;
  for(const file of files){
   if(file.type.startsWith('video/')||VIDEO_EXT.test(file.name)){
    const url=URL.createObjectURL(file),video=document.createElement('video');video.src=url;video.loop=true;video.muted=true;video.playsInline=true;video.preload='auto';video.setAttribute('playsinline','');
    const t=base(file.name.replace(/\.[^/.]+$/,''),'video',video,url,file.name);
    video.addEventListener('loadedmetadata',()=>{video.loop=t.playMode==='loop';status(`Video bereit: ${file.name} · ${video.videoWidth}×${video.videoHeight}`);if(!restored(file.name))video.play().catch(()=>status('Clip bereit. Wiedergabe über PLAY starten.'));else status(`Projektclip bereit: ${file.name}. PLAY drücken.`);});video.addEventListener('ended',()=>{if(t.playMode==='once-clear'){t.visible=false;render()}else if(t.playMode==='once-hold'){video.currentTime=Math.max(0,video.duration-.05);video.pause()}if(t.autopilot!=='off'){const peers=state.tracks.filter(x=>x.deck===t.deck&&x.type==='video');if(peers.length>1){const index=peers.indexOf(t);let next;if(t.autopilot==='random'){const choices=peers.filter(x=>x!==t);next=choices[Math.floor(Math.random()*choices.length)]}else{const step=t.autopilot==='previous'?-1:1;next=peers[(index+step+peers.length)%peers.length]}next.visible=true;next.video.play().catch(()=>{});render()}}});
    video.addEventListener('error',()=>{t.error=video.error?.code===4?'Codec nicht unterstützt':'Ladefehler';status(`${file.name}: ${t.error}. MP4/H.264 oder WebM testen.`,true);render()});video.load();addTrack(t);count++;
   }else if(file.type.startsWith('image/')||IMAGE_EXT.test(file.name)){
    const url=URL.createObjectURL(file),img=createImageMedia(file,url),t=base(file.name.replace(/\.[^/.]+$/,''),'image',img,url,file.name);
    img.onload=()=>{status(`Bild bereit: ${file.name} · ${img.naturalWidth}×${img.naturalHeight}`);render()};img.onerror=()=>{t.error='Bild konnte nicht geladen werden';status(t.error,true);render()};addTrack(t);if(/\.gif$/i.test(file.name)||file.type==='image/gif')setupGifPlayback(file,t);count++;
   }
  }
  if(count)status(`${count} Quelle(n) hinzugefügt.`);else status('Keine unterstützten Medien gefunden. Video oder Bild wählen.',true);
 }
 input.addEventListener('change',e=>{addFiles(Array.from(e.target.files||[]));e.target.value=''});
 function addGenerator(kind,old=null){const canvas=createGenerator(kind),t=base(kind.toUpperCase(),'generator',canvas,'',kind.toUpperCase());t.generatorKind=kind;t.generatorPalette=old?.generatorPalette||paletteSelect?.value||'rainbow';t.name={plasma:'Plasma',tunnel:'Tunnel',bars:'Beat Bars',rings:'Rings',noise:'Noise',kaleido:'Kaleidoscope',gradient:'Gradient',strobe:'Strobe',checker:'Checker'}[kind]||kind;if(old)Object.assign(t,{generatorPalette:old.generatorPalette||t.generatorPalette,deck:old.deck||t.deck,x:old.x??t.x,y:old.y??t.y,w:old.w??t.w,h:old.h??t.h,opacity:old.opacity??t.opacity,visible:old.visible??true,strobe:old.strobe??true,blendMode:old.blendMode||'normal',syncBeats:old.syncBeats||0});addTrack(t);if(!old)status(`Generator hinzugefügt: ${t.name}`)}
 generatorButton.addEventListener('click',()=>addGenerator(generatorSelect.value));paletteSelect?.addEventListener('change',()=>{const t=state.tracks.find(x=>x.id===state.selectedId&&x.type==='generator');if(t){t.generatorPalette=paletteSelect.value;saveProject();}});
 async function addCamera(){if(!navigator.mediaDevices?.getUserMedia){status('Kamera benötigt HTTPS und getUserMedia.',true);return}try{const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}},audio:false}),video=document.createElement('video');video.srcObject=stream;video.muted=true;video.playsInline=true;video.autoplay=true;video.setAttribute('playsinline','');await video.play();const t=base('Live Camera','camera',video);t.stream=stream;addTrack(t);status('Live-Kamera aktiv.')}catch(e){status('Kamera nicht verfügbar oder Berechtigung verweigert: '+e.message,true)}}
 cameraButton.addEventListener('click',addCamera);
 for(const old of savedProject?.tracks||[])if(old.type==='generator'&&old.generatorKind)addGenerator(old.generatorKind,old);
 function renderGenerators(time){for(const t of state.tracks)if(t.type==='generator'&&t.visible)renderGenerator(t,time,state.beatBpm||manualBpm);updateGifFrames(time)}
 function updatePlayback(time){const bpm=state.beatBpm||manualBpm;if(!bpm)return;for(const t of state.tracks){if(!t.video||t.type==='image'||t.type==='generator'||t.type==='camera')continue;if(!t.syncBeats){if(t._syncRate){t.video.playbackRate=1;t._syncRate=false;}continue;}const d=t.video.duration;if(!Number.isFinite(d)||d<=0)continue;const rate=d/(t.syncBeats*60/bpm);const target=clamp(rate,.25,4);if(Math.abs(t.video.playbackRate-target)>.03)t.video.playbackRate=target;t._syncRate=true}}
 tapButton.addEventListener('click',()=>{const now=performance.now()/1000;if(taps.length&&now-taps[taps.length-1]>2)taps=[];taps.push(now);if(taps.length>8)taps.shift();if(taps.length>=2){manualBpm=clamp(60/((taps[taps.length-1]-taps[0])/(taps.length-1)),30,240);document.getElementById('beatReadout').textContent=`${Math.round(manualBpm)} BPM · TAP TEMPO`;status(`Tap Tempo: ${Math.round(manualBpm)} BPM`)}});
 midiButton.addEventListener('click',async()=>{if(!navigator.requestMIDIAccess){midiStatus.textContent='MIDI N/A';status('Web MIDI wird von diesem Browser nicht unterstützt.',true);return}try{midi.access=await navigator.requestMIDIAccess({sysex:false});midi.active=true;for(const input of midi.access.inputs.values())input.onmidimessage=onMidi;midi.access.onstatechange=()=>{for(const input of midi.access.inputs.values())input.onmidimessage=onMidi};midiStatus.textContent=`${midi.access.inputs.size} MIDI IN`;status('Web MIDI verbunden. Note-on startet den ausgewählten Clip; Note-off pausiert ihn.')}catch(e){midiStatus.textContent='MIDI BLOCKED';status('MIDI-Zugriff verweigert: '+e.message,true)}});
 function onMidi(e){const [statusByte,note,velocity]=e.data,command=statusByte&0xf0,t=state.tracks.find(x=>x.id===state.selectedId);if(!t)return;if(command===0x90&&velocity>0){t.video.play?.().catch?.(()=>{});if(t.video.volume!==undefined)t.video.volume=Math.max(.1,velocity/127)}else if(command===0x80||(command===0x90&&velocity===0))t.video.pause?.()}
 return{addFiles,addGenerator,renderGenerators,updatePlayback,get manualBpm(){return manualBpm},get blendOps(){return OPS}};
}
