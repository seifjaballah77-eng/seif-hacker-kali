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
const NL=String.fromCharCode(10);let enterArmed=false,cinemaRunning=false;
const fragments=["[*] INITIALIZING SECURE TERMINAL INTERFACE ...","[+] LOADING CORE MODULES ................. OK","[*] ANALYZING ROUTE TABLE / NODE STATUS ...","[+] SESSION CHANNEL ESTABLISHED","[*] VERIFYING ENCRYPTION LAYERS .......... OK","[+] PACKET STREAM: "+Math.floor(1000+Math.random()*9000)+" KB/s","0x"+Math.floor(Math.random()*0xffffff).toString(16).toUpperCase()+" :: RESPONSE ACCEPTED","THREAD_"+Math.floor(Math.random()*9000+1000)+" // PROCESS ACTIVE","[+] MEMORY BUFFER SYNCHRONIZED","[*] SCANNING VIRTUAL NETWORK SEGMENTS ...","ROUTE :: NODE-"+Math.floor(Math.random()*900+100)+" -> GATEWAY-"+Math.floor(Math.random()*90+10),"[+] CHECKSUM VERIFIED — NO ERRORS","DATA_BLOCK_"+Math.floor(Math.random()*99999)+" : TRANSFER COMPLETE","[*] ESTABLISHING SIMULATED TARGET SESSION ...","[+] FIREWALL STATUS: VISUAL SIMULATION"];
function appendOutput(t){output.textContent+=t;if(output.textContent.length>14000)output.textContent=output.textContent.slice(-11000);output.scrollTop=output.scrollHeight;if(permissions.sync&&channel?.readyState==="open")channel.send(JSON.stringify({type:"sync-output",text:output.textContent.slice(-10000)}));}
function typeFast(el,t){return new Promise(resolve=>{let i=0;function tick(){if(!el.isConnected){resolve();return;}const n=Math.min(t.length-i,10+Math.floor(Math.random()*24));el.textContent+=t.slice(i,i+n);i+=n;el.scrollTop=el.scrollHeight;if(i<t.length)setTimeout(tick,1);else resolve();}tick();});}
function progressMarkup(label){return '<section class="cinema-progress"><div class="progress-label"><span>'+label+'</span><b class="progress-number">0%</b></div><div class="progress-track"><div class="progress-fill"></div></div></section>';}
function animateProgress(root,duration){const fill=root.querySelector(".progress-fill"),number=root.querySelector(".progress-number"),start=performance.now();return new Promise(resolve=>{function frame(now){const p=Math.min(100,Math.floor((now-start)/duration*100));fill.style.width=p+"%";number.textContent=p+"%";if(p<100)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});}
function escapeText(v){return String(v).replace(/[&<>"\']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","\'":"&#39;"}[c]));}
function enterImmersive(){if(document.documentElement.requestFullscreen&&!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{});document.body.classList.add("cinema-mode");}
async function startCinema(){if(cinemaRunning)return;cinemaRunning=true;enterImmersive();canvas.style.opacity="0";cinema.classList.remove("hidden");cinema.innerHTML='<div class="cinema-top"><span>SEIF // SYSTEM CONSOLE</span><span class="cinema-live">● LIVE SIMULATION</span></div><div class="cinema-terminal"><div class="cinema-terminal-head">SYSTEM DIAGNOSTICS — RUNNING</div><pre class="cinema-log"></pre></div><div class="cinema-bottom">VISUAL SEQUENCE • FICTIONAL ENVIRONMENT • NO REAL TARGETING</div>';
const log=cinema.querySelector(".cinema-log"),lines=[];for(let i=0;i<135;i++)lines.push(fragments[Math.floor(Math.random()*fragments.length)]);await typeFast(log,lines.join(NL)+NL);
cinema.innerHTML='<div class="cinema-top"><span>SEIF // SYSTEM CONSOLE</span><span class="cinema-live">● PROCESSING</span></div><div class="cinema-center"><div class="cinema-kicker">NETWORK ANALYSIS</div><h1>جارٍ تحليل المسار</h1><p>يتم تجهيز بيانات العرض السينمائي...</p>'+progressMarkup("تحميل بيانات الجلسة")+'</div><div class="cinema-bottom">SIMULATED PROCESS • 100% LOCAL VISUAL EFFECT</div>';await animateProgress(cinema,4800);
cinema.innerHTML='<div class="target-found"><div class="target-icon">✓</div><div class="target-kicker">SCAN COMPLETE</div><h1>تم تحديد موقع الهدف</h1><p>اكتمل الفحص التمثيلي بنجاح</p><div class="target-line">TARGET STATUS: <b>FOUND</b></div><button class="cinema-button" id="continueAttack">متابعة المشهد</button></div>';await new Promise(r=>{cinema.querySelector("#continueAttack").addEventListener("click",r,{once:true});setTimeout(r,1800);});
cinema.innerHTML='<div class="red-alert"><div class="alert-box"><span>!</span></div><div class="alert-label">CRITICAL SECURITY ALERT</div><h1>تحذير أمني خطير</h1><p>تم تفعيل مشهد الإنذار السينمائي</p><div class="blood-flash"></div><button class="cinema-button light" id="showVirus">متابعة</button></div>';await new Promise(r=>{cinema.querySelector("#showVirus").addEventListener("click",r,{once:true});setTimeout(r,2400);});
cinema.innerHTML='<div class="virus-scene"><div class="virus-warning">⚠ SYSTEM WARNING</div><h1>سيتم إرسال فيروس للهدف</h1><p class="fiction-note">هذا مشهد تمثيلي فقط — لن يتم إرسال أي ملف أو فيروس.</p><label for="fakeTarget">اسم الحساب المستهدف في المشهد</label><input id="fakeTarget" maxlength="48" placeholder="اكتب اسم حسابه هنا..." autocomplete="off"><button class="cinema-button" id="sendFake">بدء الإرسال</button></div>';await new Promise(r=>cinema.querySelector("#sendFake").addEventListener("click",r,{once:true}));
const account=cinema.querySelector("#fakeTarget").value.trim()||"UNKNOWN_USER";cinema.innerHTML='<div class="sending-scene"><div class="sending-mark">!</div><div class="sending-kicker">SIMULATED PAYLOAD TRANSFER</div><h1>جارٍ الإرسال</h1><p>الحساب: <b>'+escapeText(account)+'</b></p><p class="fiction-note">عملية بصرية وهمية — لا يوجد اتصال بالحساب أو إرسال حقيقي.</p>'+progressMarkup("تقدم الإرسال الوهمي")+'<div class="sending-status">PREPARING VISUAL SEQUENCE...</div></div>';await animateProgress(cinema,6500);
cinema.querySelector(".sending-status").textContent="اكتمل المشهد التمثيلي بنجاح";const done=document.createElement("button");done.className="cinema-button";done.textContent="إعادة المشهد";done.addEventListener("click",()=>{cinemaRunning=false;cinema.classList.add("hidden");document.body.classList.remove("cinema-mode");if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});appendOutput(NL+"[SIMULATION COMPLETE]"+NL);});cinema.querySelector(".sending-scene").append(done);}
function stopExecution(){cinemaRunning=false;cinema.classList.add("hidden");document.body.classList.remove("cinema-mode");if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});appendOutput(NL+"^C"+NL+"> تم إيقاف المشهد."+NL);}
$("cmd").addEventListener("submit",e=>{e.preventDefault();const value=commandInput.value.trim();if(value){enterArmed=true;appendOutput(NL+"C:\\SEIF> "+value+NL+"[ENTER 1/2] اضغط Enter مرة ثانية لبدء المشهد السينمائي..."+NL);commandInput.value="";commandInput.style.height="auto";return;}if(enterArmed){enterArmed=false;startCinema();}});
commandInput.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("cmd").requestSubmit();}if(e.key==="c"&&(e.ctrlKey||e.metaKey)){e.preventDefault();stopExecution();}});
commandInput.addEventListener("input",()=>{commandInput.style.height="auto";commandInput.style.height=Math.min(commandInput.scrollHeight,160)+"px";});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&document.fullscreenElement){document.exitFullscreen().catch(()=>{});return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="c"&&cinemaRunning){e.preventDefault();stopExecution();}});
$("fullScreen").addEventListener("click",()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen?.().catch(()=>{});else document.exitFullscreen?.().catch(()=>{});});canvas.style.opacity="0";
const inviteCode=new URLSearchParams(location.search).get("join");
if(inviteCode){show("pair");$("joinCode").value=inviteCode.toUpperCase();message("تم تعبئة الرمز من رابط الدعوة. اضغط «طلب الانضمام» لإرسال الطلب.");}
if("serviceWorker"in navigator&&location.protocol==="https:")navigator.serviceWorker.register("./sw.js").catch(()=>{});
