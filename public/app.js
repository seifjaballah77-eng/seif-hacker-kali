"use strict";
const $=id=>document.getElementById(id);
let socket=null,room=null,role=null,peer=null,channel=null,localStream=null;
let permissions={},pendingCandidates=[],makingOffer=false,ignoreOffer=false,isSettingRemoteAnswerPending=false;
const SIGNAL_URL=(location.hostname==="localhost"||location.hostname==="127.0.0.1")
  ? (location.protocol==="https:"?"wss://":"ws://")+location.host
  : "wss://seif-hacker-kali.onrender.com";

function setStatus(value){$("status").textContent="● "+value;}
function show(id){
  document.querySelectorAll(".view").forEach(x=>x.classList.add("hidden"));
  $(id).classList.remove("hidden");
  document.querySelectorAll(".top-button[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===id));
  
}
document.querySelectorAll(".top-button[data-view]").forEach(b=>b.addEventListener("click",()=>show(b.dataset.view)));

function connect(){
  return new Promise((resolve,reject)=>{
    if(socket && socket.readyState===WebSocket.OPEN)return resolve();
    if(socket && socket.readyState===WebSocket.CONNECTING){
      const current=socket;
      current.addEventListener("open",()=>resolve(),{once:true});
      current.addEventListener("error",()=>reject(new Error("تعذر الاتصال بخادم الاقتران")),{once:true});
      return;
    }
    const ws=new WebSocket(SIGNAL_URL); socket=ws;
    const timeout=setTimeout(()=>{try{ws.close();}catch{}reject(new Error("انتهت مهلة الاتصال بالخادم"));},12000);
    ws.onopen=()=>{clearTimeout(timeout);resolve();setStatus("متصل بخادم الاقتران");};
    ws.onerror=()=>{clearTimeout(timeout);reject(new Error("تعذر الاتصال بخادم الاقتران"));};
    ws.onmessage=e=>{try{handle(JSON.parse(e.data));}catch(err){console.error("رسالة خادم غير مفهومة",err);}};
    ws.onclose=()=>{clearTimeout(timeout);socket=null;resetSession(false);setStatus("انقطع اتصال الخادم");};
  });
}
async function ensureSocket(){if(!socket||socket.readyState!==WebSocket.OPEN)await connect();}
function send(data){
  if(!socket||socket.readyState!==WebSocket.OPEN){setStatus("لا يوجد اتصال بالخادم");return false;}
  socket.send(JSON.stringify(data));return true;
}
function message(value){$("joinMsg").textContent=value;}
$("create").addEventListener("click",async()=>{
  try{message("جارٍ إنشاء جلسة آمنة مؤقتة…");await ensureSocket();send({type:"create"});}
  catch(e){message(e.message);setStatus("تعذر الاتصال");}
});
$("join").addEventListener("click",async()=>{
  try{
    const code=$("joinCode").value.trim().toUpperCase();
    if(!/^[A-F0-9]{10}$/.test(code)){message("رمز الاقتران يجب أن يتكون من 10 أحرف وأرقام.");return;}
    room=code;message("جارٍ الاتصال بالخادم وإرسال طلب الاقتران…");await ensureSocket();
    const device=/Android/i.test(navigator.userAgent)?"Android":/iPhone|iPad/i.test(navigator.userAgent)?"iPhone / iPad":/Win/i.test(navigator.userAgent)?"Windows":/Linux/i.test(navigator.userAgent)?"Linux":"متصفح";
    send({type:"join",room,device});
  }catch(e){message(e.message);setStatus("تعذر الاتصال");}
});
$("copy").addEventListener("click",async()=>{
  const url=$("pairUrl").textContent;
  try{await navigator.clipboard.writeText(url);message("تم نسخ رابط الاقتران.");}
  catch{message("تعذر النسخ تلقائياً. انسخ الرابط الظاهر يدوياً.");}
});
$("approve").addEventListener("click",()=>{if(send({type:"approve"}))message("تم إرسال الموافقة، جارٍ إنشاء الاتصال…");});
$("reject").addEventListener("click",()=>send({type:"reject"}));
$("end").addEventListener("click",()=>{send({type:"end"});resetSession();});

function handle(m){
  switch(m.type){
    case "created":{
      room=m.room;role="host";$("invite").classList.remove("hidden");
      $("roomCode").textContent=room;
      const url=new URL("./?join="+encodeURIComponent(room),location.href).href;
      $("pairUrl").textContent=url;
      if(window.QRCode)QRCode.toCanvas(url,{width:190,margin:1},(err,canvas)=>{if(!err)$("qr").replaceChildren(canvas);});
      setStatus("بانتظار الجهاز الآخر");message("شارك الرمز أو QR مع الجهاز الآخر. تنتهي صلاحيته بعد 5 دقائق.");break;
    }
    case "join-request":
      $("approval").classList.remove("hidden");$("requestDevice").textContent="نوع الجهاز: "+m.device;
      setStatus("طلب موافقة وارد");message("وصل طلب اقتران. راجع نوع الجهاز قبل الموافقة.");break;
    case "approval-required":message("تم إرسال الطلب. انتظر موافقة المضيف.");setStatus("بانتظار الموافقة");break;
    case "paired":
      role=m.role;$("approval").classList.add("hidden");$("session").classList.remove("hidden");
      setStatus("مقترن — "+(role==="host"?"المضيف":"الجهاز المنضم"));
      message("تمت الموافقة. جارٍ تأسيس اتصال الجهازين…");startPeer();break;
    case "signal":onSignal(m.data);break;
    case "permission-request":answerPermission(m.permission);break;
    case "permission-result":
      permissions[m.permission]=m.granted;
      message((m.granted?"وافق الطرف الآخر على ":"رفض الطرف الآخر ")+permissionName(m.permission));
      break;
    case "request-expired":$("approval").classList.add("hidden");message("انتهت مهلة طلب الانضمام. يمكن للجهاز الآخر إعادة المحاولة.");break;
    case "request-cancelled":$("approval").classList.add("hidden");message("ألغى الجهاز الآخر طلب الاقتران.");break;
    case "request-rejected":$("approval").classList.add("hidden");message("تم رفض طلب الاقتران.");break;
    case "ended":alert(m.reason||"تم إنهاء الاقتران.");resetSession();break;
    case "error":message(m.message||"حدث خطأ.");setStatus("تعذر إكمال العملية");break;
  }
}
function permissionName(p){return ({sync:"مزامنة النصوص",screen:"مشاركة الشاشة","app-control":"التفاعل داخل صفحة التطبيق"})[p]||p;}
function startPeer(){
  if(peer)peer.close();
  pendingCandidates=[];makingOffer=false;ignoreOffer=false;isSettingRemoteAnswerPending=false;
  const polite=role==="guest";
  peer=new RTCPeerConnection({iceServers:[
    {urls:"stun:stun.l.google.com:19302"},
    {urls:"stun:stun1.l.google.com:19302"}
  ]});
  peer.onicecandidate=e=>{if(e.candidate)send({type:"signal",data:{candidate:e.candidate}});};
  peer.ontrack=e=>{if(e.streams&&e.streams[0]){$("remoteVideo").srcObject=e.streams[0];$("remoteVideo").play().catch(()=>{});}};
  peer.onconnectionstatechange=()=>{
    if(!peer)return;
    if(peer.connectionState==="connected"){setStatus("الاتصال المباشر نشط");message("تم إنشاء اتصال مباشر بين الجهازين.");}
    else if(peer.connectionState==="connecting")setStatus("جارٍ إنشاء الاتصال المباشر");
    else if(peer.connectionState==="failed"){setStatus("فشل الاتصال المباشر");message("تعذر عبور الشبكة باستخدام STUN. قد تتطلب بعض الشبكات خادم TURN.");}
    else if(peer.connectionState==="disconnected")setStatus("الاتصال متقطع");
  };
  peer.ondatachannel=e=>bindChannel(e.channel);
  peer.onnegotiationneeded=async()=>{
    try{
      makingOffer=true;
      await peer.setLocalDescription();
      send({type:"signal",data:{description:peer.localDescription}});
    }catch(e){console.error("Negotiation error",e);}
    finally{makingOffer=false;}
  };
  if(role==="host")bindChannel(peer.createDataChannel("seif-control"));
  // Avoid unused negotiation variables in older browsers while retaining perfect-negotiation handling.
  peer._seifPolite=polite;
}
function bindChannel(ch){
  channel=ch;
  ch.onopen=()=>{setStatus("الاتصال المباشر نشط");message("قناة البيانات جاهزة بين الجهازين.");};
  ch.onclose=()=>{if(peer?.connectionState==="connected")message("أُغلقت قناة تبادل البيانات.");};
  ch.onmessage=e=>{
    let m;try{m=JSON.parse(e.data);}catch{return;}
    if(m.type==="sync-output"&&permissions.sync)$("output").textContent=String(m.text||"").slice(0,12000);
    if(m.type==="app-action"&&permissions["app-control"])$("output").textContent+="\n[REMOTE APP ACTION] "+String(m.value||"").slice(0,120);
  };
}
async function onSignal(data){
  if(!peer)return;
  try{
    if(data.description){
      const description=data.description;
      const offerCollision=description.type==="offer"&&(makingOffer||peer.signalingState!=="stable");
      ignoreOffer=!peer._seifPolite&&offerCollision;
      if(ignoreOffer)return;
      isSettingRemoteAnswerPending=description.type==="answer";
      if(offerCollision&&peer._seifPolite)await peer.setLocalDescription({type:"rollback"});
      await peer.setRemoteDescription(description);
      isSettingRemoteAnswerPending=false;
      while(pendingCandidates.length)await peer.addIceCandidate(pendingCandidates.shift());
      if(description.type==="offer"){
        await peer.setLocalDescription();
        send({type:"signal",data:{description:peer.localDescription}});
      }
    }else if(data.candidate){
      if(ignoreOffer)return;
      if(peer.remoteDescription)await peer.addIceCandidate(data.candidate);
      else pendingCandidates.push(data.candidate);
    }
  }catch(e){console.error("WebRTC signaling error",e);message("حدث خطأ أثناء تأسيس الاتصال المباشر.");}
}
document.querySelectorAll("[data-permission]").forEach(button=>{
  button.addEventListener("click",()=>{
    const permission=button.dataset.permission;
    if(!peer||peer.connectionState!=="connected"){message("انتظر حتى يصبح الاتصال المباشر نشطاً.");return;}
    if(!permissions[permission])send({type:"permission",permission});
    else message("هذه الصلاحية مفعّلة لهذه الجلسة بالفعل.");
  });
});
function answerPermission(permission){
  if(!["sync","screen","app-control"].includes(permission))return;
  const yes=confirm("الجهاز الآخر يطلب: "+permissionName(permission)+"\n\nهل توافق؟");
  send({type:"permission-result",permission,granted:yes});
  permissions[permission]=yes;
  if(yes&&permission==="screen")startScreenShare();
}
async function startScreenShare(){
  try{
    if(!navigator.mediaDevices?.getDisplayMedia)throw new Error("مشاركة الشاشة غير مدعومة في هذا المتصفح.");
    if(!peer||peer.connectionState==="closed")throw new Error("الاتصال غير جاهز.");
    localStream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
    localStream.getTracks().forEach(track=>peer.addTrack(track,localStream));
    localStream.getVideoTracks()[0].addEventListener("ended",()=>{
      localStream=null;message("أوقفت مشاركة الشاشة.");
      if(peer)peer.getSenders().filter(s=>s.track?.kind==="video").forEach(s=>peer.removeTrack(s));
    });
    message("بدأت مشاركة الشاشة بعد موافقتك وموافقة المتصفح.");
  }catch(e){permissions.screen=false;send({type:"permission-result",permission:"screen",granted:false});alert("لم تبدأ مشاركة الشاشة: "+e.message);}
}
function resetSession(closeSocket=false){
  pendingCandidates=[];permissions={};room=null;role=null;channel=null;
  if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}
  if(peer){peer.ontrack=null;peer.close();peer=null;}
  $("session").classList.add("hidden");$("approval").classList.add("hidden");$("invite").classList.add("hidden");
  $("remoteVideo").srcObject=null;
  if(closeSocket&&socket){socket.close();socket=null;}
  setStatus("غير مقترن");
}
const output=$("output"),commandInput=$("command"),canvas=$("matrixRain"),cinema=$("cinema");
const NL=String.fromCharCode(10);let cinemaRunning=false,cinemaCancelled=false,cinemaStarted=false;
const fragments=["[*] INITIALIZING SECURE TERMINAL INTERFACE ...","[+] LOADING CORE MODULES ................. OK","[*] ANALYZING ROUTE TABLE / NODE STATUS ...","[+] SESSION CHANNEL ESTABLISHED","[*] VERIFYING ENCRYPTION LAYERS .......... OK","[+] PACKET STREAM: "+Math.floor(1000+Math.random()*9000)+" KB/s","0x"+Math.floor(Math.random()*0xffffff).toString(16).toUpperCase()+" :: RESPONSE ACCEPTED","THREAD_"+Math.floor(Math.random()*9000+1000)+" // PROCESS ACTIVE","[+] MEMORY BUFFER SYNCHRONIZED","[*] SCANNING VIRTUAL NETWORK SEGMENTS ...","ROUTE :: NODE-"+Math.floor(Math.random()*900+100)+" -> GATEWAY-"+Math.floor(Math.random()*90+10),"[+] CHECKSUM VERIFIED — NO ERRORS","DATA_BLOCK_"+Math.floor(Math.random()*99999)+" : TRANSFER COMPLETE","[*] ESTABLISHING LOCAL SESSION ...","[+] FIREWALL STATUS: READY"];
function appendOutput(t){output.textContent+=t;if(output.textContent.length>14000)output.textContent=output.textContent.slice(-11000);output.scrollTop=output.scrollHeight;if(permissions.sync&&channel?.readyState==="open")channel.send(JSON.stringify({type:"sync-output",text:output.textContent.slice(-10000)}));}
function typeFast(el,t){return new Promise(resolve=>{let i=0;function tick(){if(!el.isConnected||cinemaCancelled){resolve();return;}const n=Math.min(t.length-i,10+Math.floor(Math.random()*24));el.textContent+=t.slice(i,i+n);i+=n;el.scrollTop=el.scrollHeight;if(i<t.length)setTimeout(tick,1);else resolve();}tick();});}
function progressMarkup(label){return '<section class="cinema-progress"><div class="progress-label"><span>'+label+'</span><b class="progress-number">0%</b></div><div class="progress-track"><div class="progress-fill"></div></div></section>';}
function animateProgress(root,duration){const fill=root.querySelector(".progress-fill"),number=root.querySelector(".progress-number"),start=performance.now();return new Promise(resolve=>{function frame(now){if(cinemaCancelled||!fill?.isConnected){resolve();return;}const p=Math.min(100,Math.floor((now-start)/duration*100));fill.style.width=p+"%";number.textContent=p+"%";if(p<100)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});}
function escapeText(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function enterImmersive(){if(document.documentElement.requestFullscreen&&!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{});document.body.classList.add("cinema-mode");}
function renderCinemaTerminal(title,lines=""){cinema.innerHTML='<div class="cinema-top"><span>SEIF // SYSTEM CONSOLE</span><span class="cinema-live">● ONLINE</span></div><div class="cinema-terminal"><div class="cinema-terminal-head">'+title+'</div><pre class="cinema-log">'+escapeText(lines)+'</pre></div><div class="cinema-bottom">LOCAL DISPLAY • NO EXTERNAL SYSTEM ACCESS</div>';}
function askCinemaCommand(title,hint,placeholder,validator){return new Promise(resolve=>{if(cinemaCancelled){resolve(null);return;}cinema.innerHTML='<div class="cinema-top"><span>SEIF // SYSTEM CONSOLE</span><span class="cinema-live">● WAITING FOR INPUT</span></div><div class="cinema-center"><div class="cinema-kicker">COMMAND INPUT</div><h1>'+title+'</h1><p>'+hint+'</p><form class="cinema-command-form" id="cinemaCommandForm"><span class="cinema-prompt">C:\\\\SEIF&gt;</span><input id="cinemaCommandInput" autocomplete="off" spellcheck="false" placeholder="'+placeholder+'" aria-label="اكتب الأمر"><button class="cinema-button" type="submit">تنفيذ</button></form></div><div class="cinema-bottom">SYSTEM CONSOLE • INPUT READY</div>';const form=cinema.querySelector("#cinemaCommandForm"),input=cinema.querySelector("#cinemaCommandInput");input.focus();form.addEventListener("submit",e=>{e.preventDefault();const value=input.value.trim();if(!value){input.focus();return;}resolve(value);},{once:true});});}
let cinemaSound=true,cinemaAudio=null,cinemaOperator="OPERATOR",selectedLocation="";
function playCinemaTone(freq=620,duration=.09,type="sine"){
 if(!cinemaSound)return;
 try{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;cinemaAudio=cinemaAudio||new AC();if(cinemaAudio.state==="suspended")cinemaAudio.resume();const osc=cinemaAudio.createOscillator(),gain=cinemaAudio.createGain();osc.type=type;osc.frequency.value=freq;gain.gain.setValueAtTime(.0001,cinemaAudio.currentTime);gain.gain.exponentialRampToValueAtTime(.055,cinemaAudio.currentTime+.012);gain.gain.exponentialRampToValueAtTime(.0001,cinemaAudio.currentTime+duration);osc.connect(gain);gain.connect(cinemaAudio.destination);osc.start();osc.stop(cinemaAudio.currentTime+duration+.02);}catch{}
}
function updateCinemaTools(){const sound=$("cinemaSoundToggle");if(sound)sound.textContent=cinemaSound?"♫ الصوت: يعمل":"♫ الصوت: متوقف";const full=$("cinemaFullToggle");if(full)full.textContent=document.fullscreenElement?"⛶ ملء الشاشة":"⛶ تكبير";}

async function resolveLocation(query){
 const response=await fetch("https://photon.komoot.io/api/?q="+encodeURIComponent(query)+"&limit=1",{headers:{Accept:"application/json"}});
 if(!response.ok)throw new Error("تعذر تحديد الموقع الآن");
 const data=await response.json(),f=data.features&&data.features[0];
 if(!f||!f.geometry||!Array.isArray(f.geometry.coordinates))throw new Error("لم يتم العثور على الموقع. اكتب اسم مدينة أو دولة أوضح.");
 const [lng,lat]=f.geometry.coordinates,p=f.properties||{};
 if(!Number.isFinite(lat)||!Number.isFinite(lng))throw new Error("إحداثيات الموقع غير متاحة");
 return {lat,lng,name:p.name||query,country:p.country||""};
}
async function requestGlobeLocation(){
 let title="تحديد الموقع",hint="اكتب اسم الدولة أو المدينة التي تريد تحديدها على الكرة الأرضية";
 while(!cinemaCancelled){const q=await askCinemaCommand(title,hint,"Tunis, Tunisia",null);if(q===null)return null;try{return await resolveLocation(q);}catch(e){title="تعذر تحديد الموقع";hint=e.message+" — أدخل اسم مدينة أو دولة معروفاً.";}}
 return null;
}
function countryLabelPoint(f){
 const p=f.properties||{},x=Number(p.LABEL_X),y=Number(p.LABEL_Y);
 if(Number.isFinite(x)&&Number.isFinite(y))return {lng:x,lat:y};
 const pts=[];const walk=c=>{if(!Array.isArray(c))return;if(typeof c[0]==="number"){pts.push(c);return;}c.forEach(walk);};walk(f.geometry&&f.geometry.coordinates);
 if(!pts.length)return null;return {lng:pts.reduce((s,p)=>s+p[0],0)/pts.length,lat:pts.reduce((s,p)=>s+p[1],0)/pts.length};
}
let countryDataPromise=null;
function preloadGlobalNetwork(){
 const start=()=>{if(!countryDataPromise)countryDataPromise=loadCountryData().catch(err=>{countryDataPromise=null;throw err;});countryDataPromise.catch(()=>{});};
 if("requestIdleCallback"in window)requestIdleCallback(start,{timeout:2500});else setTimeout(start,1200);
 const texture=new Image();texture.decoding="async";texture.src="https://unpkg.com/three-globe@2.41.12/example/img/earth-night.jpg";
}
async function loadCountryData(){
 for(const url of ["https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson","https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson"]){
  try{const r=await fetch(url,{mode:"cors",cache:"force-cache"});if(!r.ok)continue;const j=await r.json();if(j.features&&j.features.length>150)return j;}catch(e){}
 }
 throw new Error("تعذر تحميل قاعدة بيانات حدود الدول");
}
function globeMarkup(){return '<div class="globe-panel"><div class="globe-topline"><span>GLOBAL GEOGRAPHIC RADAR</span><span class="globe-live"><i></i> LIVE SCAN</span></div><div class="globe-stage"><div id="earthGlobe" class="earth-globe"></div><div class="globe-radar-sweep"></div><div class="globe-crosshair"></div><div class="globe-loading" id="globeLoading">جارٍ تحميل بيانات الدول والحدود...</div></div><div class="globe-info"><div><small>الموقع المحدد</small><b id="globeLocationName"></b></div><div><small>الدولة</small><b id="globeCountryName">—</b></div><div><small>الإحداثيات</small><b id="globeCoordinates"></b></div></div><div class="globe-foot"><span>COUNTRY BORDERS • NATURAL EARTH DATA</span><span id="globeCountryCount">LOADING</span><span>DRAG TO ROTATE • SCROLL TO ZOOM</span></div></div>';}
async function showWorldGlobe(location){
 selectedLocation=location.name+(location.country?", "+location.country:"");
 cinema.innerHTML='<div class="cinema-top"><span>SEIF // SYSTEM CONSOLE</span><span class="cinema-live">● GLOBAL RADAR ACTIVE</span></div><div class="map-screen"><div class="cinema-kicker">GEOGRAPHIC POSITION CONFIRMED</div><h1>رادار الكرة الأرضية</h1><p>اسحب الكرة لتدويرها واستخدم عجلة الماوس للتكبير والتصغير</p>'+globeMarkup()+'<button class="cinema-button" id="continueMap">متابعة التحليل</button></div><div class="cinema-bottom">GLOBAL GEOGRAPHIC RADAR • POSITION LOCKED</div>';
 const loading=cinema.querySelector("#globeLoading");cinema.querySelector("#globeLocationName").textContent=location.name;cinema.querySelector("#globeCoordinates").textContent=location.lat.toFixed(4)+"° · "+location.lng.toFixed(4)+"°";
 if(!window.Globe){loading.textContent="تعذر تحميل محرك الكرة الأرضية. تحقق من الاتصال.";return new Promise(resolve=>cinema.querySelector("#continueMap").addEventListener("click",resolve,{once:true}));}
 try{
  const geo=await (countryDataPromise||loadCountryData());if(cinemaCancelled)return;
  const host=cinema.querySelector("#earthGlobe"),w=Math.max(280,host.clientWidth||window.innerWidth-48),h=Math.max(300,Math.min(560,Math.round(w*.62)));
  const labels=geo.features.map(f=>{const pos=countryLabelPoint(f),p=f.properties||{},name=p.ADMIN||p.NAME_EN||p.NAME;if(!pos||!name)return null;return {lat:pos.lat,lng:pos.lng,name:String(name)};}).filter(Boolean);
  const networkHubs=GLOBAL_NODES;
  const backbonePairs=[[0,1],[1,2],[2,3],[3,4],[4,5],[5,3],[2,6],[6,7],[7,3],[0,9],[9,4],[0,8],[8,11],[11,6],[3,10],[1,11],[12,1],[12,6],[12,2]];
  const backbone=backbonePairs.map(([a,b])=>({startLat:networkHubs[a].lat,startLng:networkHubs[a].lng,endLat:networkHubs[b].lat,endLng:networkHubs[b].lng}));
  const hubPoints=networkHubs.map(p=>({...p,size:.075}));
  const globe=Globe()(host).width(w).height(h).backgroundColor("rgba(0,0,0,0)").showAtmosphere(true).atmosphereColor("#4bff83").atmosphereAltitude(.22)
   .globeImageUrl("https://unpkg.com/three-globe@2.41.12/example/img/earth-night.jpg")
   .polygonsData(geo.features).polygonAltitude(.006).polygonCapColor(()=>"rgba(12,64,35,0.48)").polygonSideColor(()=>"rgba(30,110,65,0.18)").polygonStrokeColor(()=>"rgba(100,255,145,0.78)")
   .polygonLabel(f=>{const p=f.properties||{};return "<b>"+escapeText(p.ADMIN||p.NAME_EN||p.NAME||"")+"</b>";})
   .labelsData(labels).labelLat(d=>d.lat).labelLng(d=>d.lng).labelText(d=>d.name).labelSize(1.0).labelDotRadius(.10).labelColor(()=>"rgba(225,255,232,0.86)").labelResolution(3).labelAltitude(.012)
   .arcsData(backbone).arcStartLat(d=>d.startLat).arcStartLng(d=>d.startLng).arcEndLat(d=>d.endLat).arcEndLng(d=>d.endLng)
   .arcColor(()=>["rgba(65,255,130,.95)","rgba(255,45,75,.85)"]).arcAltitudeAutoScale(.34).arcStroke(.42)
   .arcDashLength(.42).arcDashGap(2.2).arcDashInitialGap(()=>Math.random()).arcDashAnimateTime(2600)
   .ringsData([{lat:location.lat,lng:location.lng,maxR:5}]).ringLat(d=>d.lat).ringLng(d=>d.lng).ringMaxRadius("maxR").ringPropagationSpeed(1.5).ringRepeatPeriod(1500)
   .pointsData([{lat:location.lat,lng:location.lng,size:.24,color:"#ff2948"},...hubPoints.map(p=>({...p,color:"#55ff89"}))])
   .pointLat(d=>d.lat).pointLng(d=>d.lng).pointAltitude(.025).pointRadius("size").pointColor(d=>d.color);
  globe.pointOfView({lat:location.lat,lng:location.lng,altitude:1.75},1400);
  const controls=globe.controls();controls.autoRotate=true;controls.autoRotateSpeed=.28;controls.enableDamping=true;controls.dampingFactor=.08;
  const resize=()=>{if(host.isConnected){const nw=Math.max(280,host.clientWidth);globe.width(nw).height(Math.max(300,Math.min(560,Math.round(nw*.62))));}};window.addEventListener("resize",resize);
  const country=geo.features.find(f=>{const p=f.properties||{};return p.ADMIN===location.country||p.NAME===location.country||p.NAME_EN===location.country;});
  cinema.querySelector("#globeCountryName").textContent=country?(country.properties.ADMIN||country.properties.NAME_EN||country.properties.NAME):location.country||"غير محددة";
  cinema.querySelector("#globeCountryCount").textContent=geo.features.length+" COUNTRIES / TERRITORIES";loading.remove();
  return new Promise(resolve=>cinema.querySelector("#continueMap").addEventListener("click",()=>{window.removeEventListener("resize",resize);playCinemaTone(880,.1);resolve();},{once:true}));
 }catch(e){loading.textContent="تعذر تحميل بيانات الكرة الأرضية: "+e.message;console.error(e);return new Promise(resolve=>cinema.querySelector("#continueMap").addEventListener("click",resolve,{once:true}));}
}
const GLOBAL_NODES=[
 {name:"NEW YORK",lat:40.7128,lng:-74.0060,region:"NORTH AMERICA"},
 {name:"LONDON",lat:51.5072,lng:-0.1276,region:"EUROPE"},
 {name:"FRANKFURT",lat:50.1109,lng:8.6821,region:"EUROPE"},
 {name:"SINGAPORE",lat:1.3521,lng:103.8198,region:"ASIA"},
 {name:"TOKYO",lat:35.6762,lng:139.6503,region:"ASIA"},
 {name:"HONG KONG",lat:22.3193,lng:114.1694,region:"ASIA"},
 {name:"DUBAI",lat:25.2048,lng:55.2708,region:"MIDDLE EAST"},
 {name:"MUMBAI",lat:19.0760,lng:72.8777,region:"ASIA"},
 {name:"SAO PAULO",lat:-23.5505,lng:-46.6333,region:"SOUTH AMERICA"},
 {name:"LOS ANGELES",lat:34.0522,lng:-118.2437,region:"NORTH AMERICA"},
 {name:"SYDNEY",lat:-33.8688,lng:151.2093,region:"OCEANIA"},
 {name:"JOHANNESBURG",lat:-26.2041,lng:28.0473,region:"AFRICA"},
 {name:"TUNIS",lat:36.8065,lng:10.1815,region:"AFRICA"}
];
const MISSION_STEPS=["تحديد الموقع الجغرافي","تحليل مسار الاتصال","اكتشاف عقدة الشبكة","تأكيد صلاحية المتابعة","إنشاء تقرير الجلسة"];
let missionStep=0,monitorTimer=null;
function setMissionStep(step){missionStep=Math.max(missionStep,Math.min(MISSION_STEPS.length,step));}
function toggleFeaturePanel(kind){
 const panel=$("featurePanel");if(!panel)return;
 if(panel.dataset.kind===kind&&!panel.classList.contains("hidden")){panel.classList.add("hidden");panel.dataset.kind="";if(monitorTimer){clearInterval(monitorTimer);monitorTimer=null;}return;}
 panel.dataset.kind=kind;panel.classList.remove("hidden");
 if(monitorTimer){clearInterval(monitorTimer);monitorTimer=null;}
 if(kind==="nodes")renderNodesPanel(panel);
 if(kind==="missions")renderMissionsPanel(panel);
 if(kind==="monitor"){renderMonitorPanel(panel);monitorTimer=setInterval(()=>{if(panel.dataset.kind==="monitor"&&!panel.classList.contains("hidden"))renderMonitorPanel(panel);},2500);}
}
function renderNodesPanel(panel){
 panel.innerHTML='<div class="feature-head"><b>GLOBAL NODES / '+GLOBAL_NODES.length+'</b><button type="button" data-close-feature>×</button></div><p class="feature-note">مراكز اتصال مرئية على الكرة — مواقع مرجعية وليست قياساً مباشراً لحالة الخوادم.</p><div class="node-list">'+GLOBAL_NODES.map((n,i)=>'<div class="node-row"><i></i><span><b>'+escapeText(n.name)+'</b><small>'+escapeText(n.region)+' · '+n.lat.toFixed(2)+', '+n.lng.toFixed(2)+'</small></span><em>MAP NODE</em></div>').join("")+'</div>';
 panel.querySelector("[data-close-feature]").addEventListener("click",()=>toggleFeaturePanel("nodes"));
}
function renderMissionsPanel(panel){
 panel.innerHTML='<div class="feature-head"><b>MISSION CONTROL</b><button type="button" data-close-feature>×</button></div><p class="feature-note">تقدم مراحل الجلسة الحالية</p><div class="mission-progress"><span style="width:'+Math.round(missionStep/MISSION_STEPS.length*100)+'%"></span></div><div class="mission-count">'+missionStep+' / '+MISSION_STEPS.length+' COMPLETE</div><div class="mission-list">'+MISSION_STEPS.map((s,i)=>'<div class="mission-row '+(i<missionStep?"done":i===missionStep?"current":"")+'"><b>'+(i<missionStep?"✓":String(i+1).padStart(2,"0"))+'</b><span>'+s+'</span><small>'+(i<missionStep?"COMPLETE":i===missionStep?"ACTIVE":"LOCKED")+'</small></div>').join("")+'</div>';
 panel.querySelector("[data-close-feature]").addEventListener("click",()=>toggleFeaturePanel("missions"));
}
function renderMonitorPanel(panel){
 const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
 const nav=performance.getEntriesByType("navigation")[0];
 const rtt=c&&Number.isFinite(c.rtt)?Math.round(c.rtt)+" ms":"غير متاح";
 const down=c&&Number.isFinite(c.downlink)?c.downlink.toFixed(1)+" Mb/s":"غير متاح";
 const type=c?(c.effectiveType||c.type||"غير محدد"):"غير مدعوم";
 const memory=navigator.deviceMemory? navigator.deviceMemory+" GB":"غير متاح";
 const cores=navigator.hardwareConcurrency?String(navigator.hardwareConcurrency):"غير متاح";
 const load=nav?Math.round(nav.domContentLoadedEventEnd)+" ms":"—";
 const rows=[["NETWORK",navigator.onLine?"ONLINE":"OFFLINE"],["CONNECTION TYPE",type],["ESTIMATED DOWNLINK",down],["ESTIMATED RTT",rtt],["DEVICE MEMORY",memory],["CPU THREADS",cores],["PAGE READY",load]];
 panel.innerHTML='<div class="feature-head"><b>LOCAL NETWORK MONITOR</b><button type="button" data-close-feature>×</button></div><div class="monitor-live"><i></i> BROWSER TELEMETRY · REFRESH 2.5s</div><div class="monitor-grid">'+rows.map(([k,v])=>'<div><small>'+k+'</small><b>'+escapeText(v)+'</b></div>').join("")+'</div><p class="feature-note">القيم تقديرات يوفرها المتصفح والجهاز الحالي، وقد لا تتوفر في بعض المتصفحات. لا تمثل مراقبة عالمية أو قياساً لحركة الإنترنت لدى الآخرين.</p>';
 panel.querySelector("[data-close-feature]").addEventListener("click",()=>toggleFeaturePanel("monitor"));
}
async function startCinema(){if(cinemaRunning||cinemaStarted)return;cinemaStarted=true;cinemaRunning=true;cinemaCancelled=false;enterImmersive();canvas.style.opacity="0";cinema.classList.remove("hidden");updateCinemaTools();const lines=[];for(let i=0;i<135;i++)lines.push(fragments[Math.floor(Math.random()*fragments.length)]);renderCinemaTerminal("SYSTEM DIAGNOSTICS — RUNNING");await typeFast(cinema.querySelector(".cinema-log"),lines.join(NL)+NL);if(cinemaCancelled)return;
 cinema.innerHTML='<div class="cinema-top"><span>SEIF // SYSTEM CONSOLE</span><span class="cinema-live">● LOADING</span></div><div class="cinema-center"><div class="cinema-kicker">INITIALIZING</div><h1>جارٍ التحميل</h1><p>يتم تجهيز النظام وتحميل المكونات...</p>'+progressMarkup("تحميل النظام")+'</div><div class="cinema-bottom">SYSTEM CONSOLE • PLEASE WAIT</div>';playCinemaTone(520,.08);await animateProgress(cinema,3200);if(cinemaCancelled)return;
 const operator=await askCinemaCommand("تسجيل اسم المستخدم","أدخل الاسم الذي سيظهر في سجل العمليات","operator",null);if(operator===null||cinemaCancelled)return;cinemaOperator=operator.slice(0,40);playCinemaTone(720,.1);
 const location=await requestGlobeLocation();if(!location||cinemaCancelled)return;
 await showWorldGlobe(location);if(cinemaCancelled)return;setMissionStep(1);
 while(!cinemaCancelled){
  const cmd=await askCinemaCommand("أدخل أمر الفحص","اكتب أي أمر غير فارغ للبدء: scan","scan",null);if(cmd===null||cinemaCancelled)return;setMissionStep(2);playCinemaTone(680,.08);
  renderCinemaTerminal("NETWORK ANALYSIS","OPERATOR: "+cinemaOperator+NL+"MODE: "+"GLOBAL OPERATIONS"+NL+"C:\\SEIF> "+cmd+NL+"[+] ANALYZING ROUTE TABLE ..."+NL+"[+] PACKETS VERIFIED"+NL);
  cinema.innerHTML='<div class="cinema-top"><span>SEIF // SYSTEM CONSOLE</span><span class="cinema-live">● PROCESSING</span></div><div class="cinema-center"><div class="cinema-kicker">'+"GLOBAL OPERATIONS"+'</div><h1>جارٍ تحليل المسار</h1><p>المستخدم: '+escapeText(cinemaOperator)+' — يتم تجهيز بيانات الاتصال...</p>'+progressMarkup("تحميل بيانات الجلسة")+'</div><div class="cinema-bottom">LOCAL DISPLAY • '+"GLOBAL OPERATIONS"+'</div>';await animateProgress(cinema,3200);if(cinemaCancelled)return;playCinemaTone(820,.13);
  const locate=await askCinemaCommand("أدخل أمر تحديد العقدة","اكتب أي نص للانتقال إلى المرحلة التالية","locate",null);if(locate===null||cinemaCancelled)return;setMissionStep(3);playCinemaTone(700,.08);
  cinema.innerHTML='<div class="target-found"><div class="target-icon">✓</div><div class="target-kicker">SCAN COMPLETE</div><h1>تم العثور على العقدة</h1><p>اكتمل تحليل المسار — '+escapeText(cinemaOperator)+'</p><div class="target-line">NODE STATUS: <b>FOUND</b></div><div class="target-line">NEXT: <b>AUTHORIZATION</b></div></div>';
  const override=await askCinemaCommand("تأكيد صلاحية المتابعة","أدخل أي نص لمواصلة العملية","override",null);if(override===null||cinemaCancelled)return;setMissionStep(4);
  cinema.innerHTML='<div class="red-alert"><div class="alert-box"><span>!</span></div><div class="alert-label">CRITICAL SYSTEM ALERT</div><h1>تم رصد نشاط غير معتاد</h1><p>المستخدم: '+escapeText(cinemaOperator)+' — يلزم إدخال معرّف الحساب للمتابعة</p><div class="blood-flash"></div><div class="target-line">ACCOUNT IDENTIFICATION REQUIRED</div></div>';playCinemaTone(170,.35,"sawtooth");
  const target=await askCinemaCommand("إدخال معرّف الحساب","أدخل أي اسم أو معرّف لعرضه في التقرير","username",null);if(target===null||cinemaCancelled)return;const account=target.slice(0,60);
  const deploy=await askCinemaCommand("تجهيز حزمة البيانات","أدخل أي نص لبدء شريط الإرسال","deploy",null);if(deploy===null||cinemaCancelled)return;
  cinema.innerHTML='<div class="sending-scene"><div class="sending-mark">!</div><div class="sending-kicker">DATA TRANSFER</div><h1>جارٍ تجهيز البيانات</h1><p>المستخدم: <b>'+escapeText(cinemaOperator)+'</b> — المعرّف: <b>'+escapeText(account)+'</b></p>'+progressMarkup("تقدم المعالجة")+'<div class="sending-status">PREPARING...</div></div><div class="cinema-bottom">LOCAL DISPLAY • '+"GLOBAL OPERATIONS"+'</div>';playCinemaTone(430,.12);await animateProgress(cinema,4200);if(cinemaCancelled)return;
  const finish=await askCinemaCommand("اكتملت المعالجة","أدخل أي نص للإنهاء، أو اكتب restart لإعادة التشغيل","finish / restart",null);if(finish===null||cinemaCancelled)return;if(finish.toLowerCase()==="restart"){missionStep=0;cinemaRunning=false;return startCinema();}setMissionStep(5);
  cinema.innerHTML='<div class="target-found"><div class="target-icon">✓</div><div class="target-kicker">PROCESS COMPLETE</div><h1>اكتملت العملية</h1><p>تم إنهاء التسلسل بنجاح</p><div class="target-line">OPERATOR: <b>'+escapeText(cinemaOperator)+'</b></div><div class="target-line">SCENARIO: <b>'+"GLOBAL OPERATIONS"+'</b></div><div class="target-line">ACCOUNT: <b>'+escapeText(account)+'</b></div><button class="cinema-button" id="exitCinema">إنهاء</button><button class="cinema-button" id="restartCinema">إعادة التشغيل</button><div class="cinema-bottom">SEIF SYSTEM TERMINAL</div></div>';playCinemaTone(980,.22);cinema.querySelector("#exitCinema").addEventListener("click",leaveCinema);cinema.querySelector("#restartCinema").addEventListener("click",()=>{missionStep=0;cinemaRunning=false;startCinema();});return;
 }
}
function leaveCinema(){cinemaCancelled=true;cinemaRunning=false;if(monitorTimer){clearInterval(monitorTimer);monitorTimer=null;}const feature=$("featurePanel");if(feature)feature.classList.add("hidden");cinema.classList.add("hidden");document.body.classList.remove("cinema-mode");if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});}
function stopExecution(){leaveCinema();appendOutput(NL+"^C"+NL+"> تم إيقاف العملية."+NL);}
$("cmd").addEventListener("submit",e=>{e.preventDefault();startCinema();});
commandInput.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("cmd").requestSubmit();}if(e.key==="c"&&(e.ctrlKey||e.metaKey)){e.preventDefault();stopExecution();}});
commandInput.addEventListener("input",()=>{commandInput.style.height="auto";commandInput.style.height=Math.min(commandInput.scrollHeight,160)+"px";});
document.addEventListener("keydown",e=>{if(!cinemaStarted&&e.key==="Enter"){e.preventDefault();startCinema();return;}if(e.key==="Escape"&&document.fullscreenElement){document.exitFullscreen().catch(()=>{});return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="c"&&cinemaRunning){e.preventDefault();stopExecution();}});
$("fullScreen").addEventListener("click",()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen?.().catch(()=>{});else document.exitFullscreen?.().catch(()=>{});});$("cinemaSoundToggle").addEventListener("click",()=>{cinemaSound=!cinemaSound;updateCinemaTools();if(cinemaSound)playCinemaTone(760,.12);});$("nodesToggle").addEventListener("click",()=>toggleFeaturePanel("nodes"));$("monitorToggle").addEventListener("click",()=>toggleFeaturePanel("monitor"));$("missionsToggle").addEventListener("click",()=>toggleFeaturePanel("missions"));$("cinemaFullToggle").addEventListener("click",()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen?.().catch(()=>{});else document.exitFullscreen?.().catch(()=>{});});document.addEventListener("fullscreenchange",updateCinemaTools);canvas.style.opacity="0";
preloadGlobalNetwork();
const inviteCode=new URLSearchParams(location.search).get("join");
if(inviteCode){show("pair");$("joinCode").value=inviteCode.toUpperCase();message("تم تعبئة الرمز من رابط الدعوة. اضغط «طلب الانضمام» لإرسال الطلب.");}
if("serviceWorker"in navigator&&location.protocol==="https:")navigator.serviceWorker.register("./sw.js").catch(()=>{});
