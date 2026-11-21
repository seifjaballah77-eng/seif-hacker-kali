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
const NL=String.fromCharCode(10);let enterArmed=false,cinemaRunning=false,cinemaCancelled=false;
const fragments=["[*] INITIALIZING SECURE TERMINAL INTERFACE ...","[+] LOADING CORE MODULES ................. OK","[*] ANALYZING ROUTE TABLE / NODE STATUS ...","[+] SESSION CHANNEL ESTABLISHED","[*] VERIFYING ENCRYPTION LAYERS .......... OK","[+] PACKET STREAM: "+Math.floor(1000+Math.random()*9000)+" KB/s","0x"+Math.floor(Math.random()*0xffffff).toString(16).toUpperCase()+" :: RESPONSE ACCEPTED","THREAD_"+Math.floor(Math.random()*9000+1000)+" // PROCESS ACTIVE","[+] MEMORY BUFFER SYNCHRONIZED","[*] SCANNING VIRTUAL NETWORK SEGMENTS ...","ROUTE :: NODE-"+Math.floor(Math.random()*900+100)+" -> GATEWAY-"+Math.floor(Math.random()*90+10),"[+] CHECKSUM VERIFIED — NO ERRORS","DATA_BLOCK_"+Math.floor(Math.random()*99999)+" : TRANSFER COMPLETE","[*] ESTABLISHING LOCAL SESSION ...","[+] FIREWALL STATUS: READY"];
function appendOutput(t){output.textContent+=t;if(output.textContent.length>14000)output.textContent=output.textContent.slice(-11000);output.scrollTop=output.scrollHeight;if(permissions.sync&&channel?.readyState==="open")channel.send(JSON.stringify({type:"sync-output",text:output.textContent.slice(-10000)}));}
function typeFast(el,t){return new Promise(resolve=>{let i=0;function tick(){if(!el.isConnected||cinemaCancelled){resolve();return;}const n=Math.min(t.length-i,10+Math.floor(Math.random()*24));el.textContent+=t.slice(i,i+n);i+=n;el.scrollTop=el.scrollHeight;if(i<t.length)setTimeout(tick,1);else resolve();}tick();});}
function progressMarkup(label){return '<section class="cinema-progress"><div class="progress-label"><span>'+label+'</span><b class="progress-number">0%</b></div><div class="progress-track"><div class="progress-fill"></div></div></section>';}
function animateProgress(root,duration){const fill=root.querySelector(".progress-fill"),number=root.querySelector(".progress-number"),start=performance.now();return new Promise(resolve=>{function frame(now){if(cinemaCancelled||!fill?.isConnected){resolve();return;}const p=Math.min(100,Math.floor((now-start)/duration*100));fill.style.width=p+"%";number.textContent=p+"%";if(p<100)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});}
function escapeText(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function enterImmersive(){if(document.documentElement.requestFullscreen&&!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{});document.body.classList.add("cinema-mode");}
function renderCinemaTerminal(title,lines=""){cinema.innerHTML='<div class="cinema-top"><span>SEIF // SYSTEM CONSOLE</span><span class="cinema-live">● ONLINE</span></div><div class="cinema-terminal"><div class="cinema-terminal-head">'+title+'</div><pre class="cinema-log">'+escapeText(lines)+'</pre></div><div class="cinema-bottom">LOCAL DISPLAY • NO EXTERNAL SYSTEM ACCESS</div>';}
function askCinemaCommand(title,hint,placeholder,validator){return new Promise(resolve=>{if(cinemaCancelled){resolve(null);return;}cinema.innerHTML='<div class="cinema-top"><span>SEIF // SYSTEM CONSOLE</span><span class="cinema-live">● WAITING FOR INPUT</span></div><div class="cinema-center"><div class="cinema-kicker">COMMAND INPUT</div><h1>'+title+'</h1><p>'+hint+'</p><form class="cinema-command-form" id="cinemaCommandForm"><span class="cinema-prompt">C:\\\\SEIF&gt;</span><input id="cinemaCommandInput" autocomplete="off" spellcheck="false" placeholder="'+placeholder+'" aria-label="اكتب الأمر"><button class="cinema-button" type="submit">تنفيذ</button></form></div><div class="cinema-bottom">SYSTEM CONSOLE • INPUT READY</div>';const form=cinema.querySelector("#cinemaCommandForm"),input=cinema.querySelector("#cinemaCommandInput");input.focus();form.addEventListener("submit",e=>{e.preventDefault();const value=input.value.trim();if(!value){input.focus();return;}resolve(value);},{once:true});});}
let cinemaSound=true,cinemaAudio=null,cinemaOperator="OPERATOR",cinemaScenario="NETWORK SCAN";
const cinemaScenarios=[
 {name:"فحص الشبكة",en:"NETWORK SCAN",desc:"تحليل العقد ومسارات الاتصال"},
 {name:"تحليل النظام",en:"SYSTEM ANALYSIS",desc:"قراءة مؤشرات النظام والموارد"},
 {name:"اكتشاف الملفات",en:"FILE DISCOVERY",desc:"استعراض الملفات والفهارس"},
 {name:"مركز التحكم",en:"CONTROL CENTER",desc:"تشغيل لوحة مراقبة مركزية"},
 {name:"تتبع العقد",en:"NODE TRACKING",desc:"عرض نقاط اتصال موزعة"},
 {name:"تحليل الإشارات",en:"SIGNAL ANALYSIS",desc:"فحص الإشارات وتدفق البيانات"}
];
function playCinemaTone(freq=620,duration=.09,type="sine"){
 if(!cinemaSound)return;
 try{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;cinemaAudio=cinemaAudio||new AC();if(cinemaAudio.state==="suspended")cinemaAudio.resume();const osc=cinemaAudio.createOscillator(),gain=cinemaAudio.createGain();osc.type=type;osc.frequency.value=freq;gain.gain.setValueAtTime(.0001,cinemaAudio.currentTime);gain.gain.exponentialRampToValueAtTime(.055,cinemaAudio.currentTime+.012);gain.gain.exponentialRampToValueAtTime(.0001,cinemaAudio.currentTime+duration);osc.connect(gain);gain.connect(cinemaAudio.destination);osc.start();osc.stop(cinemaAudio.currentTime+duration+.02);}catch{}
}
function updateCinemaTools(){const sound=$("cinemaSoundToggle");if(sound)sound.textContent=cinemaSound?"♫ الصوت: يعمل":"♫ الصوت: متوقف";const full=$("cinemaFullToggle");if(full)full.textContent=document.fullscreenElement?"⛶ ملء الشاشة":"⛶ تكبير";}
function chooseCinemaScenario(){return new Promise(resolve=>{
 cinema.innerHTML='<div class="cinema-top"><span>SEIF // SYSTEM CONSOLE</span><span class="cinema-live">● SELECT MODE</span></div><div class="scenario-picker"><div class="cinema-kicker">MISSION SELECT</div><h1>اختر السيناريو</h1><p>حدد نوع العملية التي تريد عرضها</p><div class="scenario-grid">'+cinemaScenarios.map((s,i)=>'<button class="scenario-card" data-scenario="'+i+'"><b>0'+(i+1)+' / '+s.en+'</b><strong>'+s.name+'</strong><small>'+s.desc+'</small></button>').join("")+'</div></div><div class="cinema-bottom">SEIF SYSTEM TERMINAL • READY</div>';
 cinema.querySelectorAll("[data-scenario]").forEach(btn=>btn.addEventListener("click",()=>{const selected=cinemaScenarios[Number(btn.dataset.scenario)];cinemaScenario=selected.en;playCinemaTone(760,.12);resolve(selected);},{once:true}));
 });}
function worldMapMarkup(){
 const clusters=[{x:170,y:145,n:4},{x:285,y:185,n:3},{x:480,y:150,n:4},{x:575,y:230,n:3},{x:735,y:175,n:4},{x:820,y:325,n:2}];
 const pts=[];clusters.forEach(c=>{for(let i=0;i<c.n;i++)pts.push({x:c.x+(Math.random()-.5)*95,y:c.y+(Math.random()-.5)*65});});
 const lines=pts.slice(0,pts.length-1).filter((p,i)=>i%2===0).map((p,i)=>'<line x1="'+p.x+'" y1="'+p.y+'" x2="'+pts[i+1].x+'" y2="'+pts[i+1].y+'"/>').join("");
 const dots=pts.map((p,i)=>'<g><circle class="map-pulse" cx="'+p.x+'" cy="'+p.y+'" r="10"/><circle class="map-dot" cx="'+p.x+'" cy="'+p.y+'" r="'+(i%4===0?4:2.8)+'"/></g>').join("");
 return '<div class="world-map-wrap"><div class="map-heading"><span>GLOBAL NODE NETWORK</span><b>'+pts.length+' ACTIVE NODES</b></div><svg class="world-map" viewBox="0 0 1000 500" role="img" aria-label="خريطة عالمية عليها نقاط اتصال موزعة"><defs><pattern id="mapGrid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#17452a" stroke-width="1"/></pattern></defs><rect width="1000" height="500" fill="url(#mapGrid)"/><g class="map-land"><path d="M75 100 130 55 205 65 255 110 240 165 205 190 185 250 145 230 120 180 85 160Z"/><path d="M235 255 280 275 300 335 280 410 250 455 225 385 210 315Z"/><path d="M420 105 475 75 540 88 570 120 620 112 655 145 630 180 590 190 570 230 530 220 510 260 475 225 450 185 415 160Z"/><path d="M490 245 545 235 585 275 570 350 530 420 495 370 470 300Z"/><path d="M650 115 720 80 810 105 890 155 860 205 790 210 745 185 700 205 660 175Z"/><path d="M760 275 825 260 870 300 850 370 800 390 765 345Z"/><path d="M900 420 930 405 950 430 930 450Z"/></g><g class="map-links">'+lines+'</g><g class="map-points">'+dots+'</g></svg><div class="map-legend"><span><i></i> NODE ONLINE</span><span>LIVE ROUTE ANALYSIS</span><span>REGION: GLOBAL</span></div></div>';
}
function showWorldMap(){cinema.innerHTML='<div class="cinema-top"><span>SEIF // SYSTEM CONSOLE</span><span class="cinema-live">● GLOBAL SCAN</span></div><div class="map-screen"><div class="cinema-kicker">WORLDWIDE NETWORK</div><h1>خريطة نقاط الاتصال</h1><p>رصد العقد النشطة حول العالم</p>'+worldMapMarkup()+'<button class="cinema-button" id="continueMap">متابعة التحليل</button></div><div class="cinema-bottom">GLOBAL NETWORK • '+cinemaScenario+'</div>';cinema.querySelector("#continueMap").addEventListener("click",()=>{playCinemaTone(880,.1);cinema.dataset.mapDone="1";});return new Promise(resolve=>{cinema.querySelector("#continueMap").addEventListener("click",resolve,{once:true});});}
async function startCinema(){if(cinemaRunning)return;cinemaRunning=true;cinemaCancelled=false;enterImmersive();canvas.style.opacity="0";cinema.classList.remove("hidden");updateCinemaTools();const lines=[];for(let i=0;i<135;i++)lines.push(fragments[Math.floor(Math.random()*fragments.length)]);renderCinemaTerminal("SYSTEM DIAGNOSTICS — RUNNING");await typeFast(cinema.querySelector(".cinema-log"),lines.join(NL)+NL);if(cinemaCancelled)return;
 cinema.innerHTML='<div class="cinema-top"><span>SEIF // SYSTEM CONSOLE</span><span class="cinema-live">● LOADING</span></div><div class="cinema-center"><div class="cinema-kicker">INITIALIZING</div><h1>جارٍ التحميل</h1><p>يتم تجهيز النظام وتحميل المكونات...</p>'+progressMarkup("تحميل النظام")+'</div><div class="cinema-bottom">SYSTEM CONSOLE • PLEASE WAIT</div>';playCinemaTone(520,.08);await animateProgress(cinema,3200);if(cinemaCancelled)return;
 const scenario=await chooseCinemaScenario();if(cinemaCancelled)return;
 const operator=await askCinemaCommand("تسجيل اسم المستخدم","أدخل الاسم الذي سيظهر في سجل العمليات","operator",null);if(operator===null||cinemaCancelled)return;cinemaOperator=operator.slice(0,40);playCinemaTone(720,.1);
 await showWorldMap();if(cinemaCancelled)return;
 while(!cinemaCancelled){
  const cmd=await askCinemaCommand("أدخل أمر الفحص","اكتب أي أمر غير فارغ للبدء: scan","scan",null);if(cmd===null||cinemaCancelled)return;playCinemaTone(680,.08);
  renderCinemaTerminal("NETWORK ANALYSIS","OPERATOR: "+cinemaOperator+NL+"MODE: "+scenario.en+NL+"C:\\SEIF> "+cmd+NL+"[+] ANALYZING ROUTE TABLE ..."+NL+"[+] PACKETS VERIFIED"+NL);
  cinema.innerHTML='<div class="cinema-top"><span>SEIF // SYSTEM CONSOLE</span><span class="cinema-live">● PROCESSING</span></div><div class="cinema-center"><div class="cinema-kicker">'+scenario.en+'</div><h1>جارٍ تحليل المسار</h1><p>المستخدم: '+escapeText(cinemaOperator)+' — يتم تجهيز بيانات الاتصال...</p>'+progressMarkup("تحميل بيانات الجلسة")+'</div><div class="cinema-bottom">LOCAL DISPLAY • '+scenario.en+'</div>';await animateProgress(cinema,3200);if(cinemaCancelled)return;playCinemaTone(820,.13);
  const locate=await askCinemaCommand("أدخل أمر تحديد العقدة","اكتب أي نص للانتقال إلى المرحلة التالية","locate",null);if(locate===null||cinemaCancelled)return;playCinemaTone(700,.08);
  cinema.innerHTML='<div class="target-found"><div class="target-icon">✓</div><div class="target-kicker">SCAN COMPLETE</div><h1>تم العثور على العقدة</h1><p>اكتمل تحليل المسار — '+escapeText(cinemaOperator)+'</p><div class="target-line">NODE STATUS: <b>FOUND</b></div><div class="target-line">NEXT: <b>AUTHORIZATION</b></div></div>';
  const override=await askCinemaCommand("تأكيد صلاحية المتابعة","أدخل أي نص لمواصلة العملية","override",null);if(override===null||cinemaCancelled)return;
  cinema.innerHTML='<div class="red-alert"><div class="alert-box"><span>!</span></div><div class="alert-label">CRITICAL SYSTEM ALERT</div><h1>تم رصد نشاط غير معتاد</h1><p>المستخدم: '+escapeText(cinemaOperator)+' — يلزم إدخال معرّف الحساب للمتابعة</p><div class="blood-flash"></div><div class="target-line">ACCOUNT IDENTIFICATION REQUIRED</div></div>';playCinemaTone(170,.35,"sawtooth");
  const target=await askCinemaCommand("إدخال معرّف الحساب","أدخل أي اسم أو معرّف لعرضه في التقرير","username",null);if(target===null||cinemaCancelled)return;const account=target.slice(0,60);
  const deploy=await askCinemaCommand("تجهيز حزمة البيانات","أدخل أي نص لبدء شريط الإرسال","deploy",null);if(deploy===null||cinemaCancelled)return;
  cinema.innerHTML='<div class="sending-scene"><div class="sending-mark">!</div><div class="sending-kicker">DATA TRANSFER</div><h1>جارٍ تجهيز البيانات</h1><p>المستخدم: <b>'+escapeText(cinemaOperator)+'</b> — المعرّف: <b>'+escapeText(account)+'</b></p>'+progressMarkup("تقدم المعالجة")+'<div class="sending-status">PREPARING...</div></div><div class="cinema-bottom">LOCAL DISPLAY • '+scenario.en+'</div>';playCinemaTone(430,.12);await animateProgress(cinema,4200);if(cinemaCancelled)return;
  const finish=await askCinemaCommand("اكتملت المعالجة","أدخل أي نص للإنهاء، أو اكتب restart لإعادة التشغيل","finish / restart",null);if(finish===null||cinemaCancelled)return;if(finish.toLowerCase()==="restart"){cinemaRunning=false;return startCinema();}
  cinema.innerHTML='<div class="target-found"><div class="target-icon">✓</div><div class="target-kicker">PROCESS COMPLETE</div><h1>اكتملت العملية</h1><p>تم إنهاء التسلسل بنجاح</p><div class="target-line">OPERATOR: <b>'+escapeText(cinemaOperator)+'</b></div><div class="target-line">SCENARIO: <b>'+scenario.en+'</b></div><div class="target-line">ACCOUNT: <b>'+escapeText(account)+'</b></div><button class="cinema-button" id="exitCinema">إنهاء</button><button class="cinema-button" id="restartCinema">إعادة التشغيل</button><div class="cinema-bottom">SEIF SYSTEM TERMINAL</div></div>';playCinemaTone(980,.22);cinema.querySelector("#exitCinema").addEventListener("click",leaveCinema);cinema.querySelector("#restartCinema").addEventListener("click",()=>{cinemaRunning=false;startCinema();});return;
 }
}
function leaveCinema(){cinemaCancelled=true;cinemaRunning=false;cinema.classList.add("hidden");document.body.classList.remove("cinema-mode");if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});}
function stopExecution(){leaveCinema();appendOutput(NL+"^C"+NL+"> تم إيقاف العملية."+NL);}
$("cmd").addEventListener("submit",e=>{e.preventDefault();const value=commandInput.value.trim();if(value){enterArmed=true;appendOutput(NL+"C:\\SEIF> "+value+NL+"[ENTER 1/2] اضغط Enter مرة ثانية لفتح الطرفية..."+NL);commandInput.value="";commandInput.style.height="auto";return;}if(enterArmed){enterArmed=false;startCinema();}});
commandInput.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("cmd").requestSubmit();}if(e.key==="c"&&(e.ctrlKey||e.metaKey)){e.preventDefault();stopExecution();}});
commandInput.addEventListener("input",()=>{commandInput.style.height="auto";commandInput.style.height=Math.min(commandInput.scrollHeight,160)+"px";});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&document.fullscreenElement){document.exitFullscreen().catch(()=>{});return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="c"&&cinemaRunning){e.preventDefault();stopExecution();}});
$("fullScreen").addEventListener("click",()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen?.().catch(()=>{});else document.exitFullscreen?.().catch(()=>{});});canvas.style.opacity="0";
const inviteCode=new URLSearchParams(location.search).get("join");
if(inviteCode){show("pair");$("joinCode").value=inviteCode.toUpperCase();message("تم تعبئة الرمز من رابط الدعوة. اضغط «طلب الانضمام» لإرسال الطلب.");}
if("serviceWorker"in navigator&&location.protocol==="https:")navigator.serviceWorker.register("./sw.js").catch(()=>{});
