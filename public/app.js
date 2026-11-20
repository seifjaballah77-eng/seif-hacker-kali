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
  document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.view===id));
  $("heading").textContent=id==="sim"?"مركز المحاكاة":"الاقتران مع موافقة";
}
document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",()=>show(b.dataset.view)));

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
function permissionName(p){return ({sync:"مزامنة المحاكاة",screen:"مشاركة الشاشة","app-control":"التحكم داخل صفحة التطبيق"})[p]||p;}
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
$("cmd").addEventListener("submit",e=>{
  e.preventDefault();const value=$("command").value.trim();if(!value)return;
  const out=$("output"),commands={help:"الأوامر: help, status, scan, matrix, clear",status:"MODE: LOCAL SIMULATION\nREMOTE: CONSENT REQUIRED",scan:"محاكاة فحص محلية: لا يتم فحص شبكات حقيقية.",matrix:"MATRIX VISUALIZER: READY"};
  if(value==="clear")out.textContent="";
  else out.textContent+="\n> "+value+"\n"+(commands[value]||"أمر تجريبي غير معروف. اكتب help.");
  $("command").value="";
  if(permissions.sync&&channel?.readyState==="open")channel.send(JSON.stringify({type:"sync-output",text:out.textContent.slice(-12000)}));
});
const inviteCode=new URLSearchParams(location.search).get("join");
if(inviteCode){show("pair");$("joinCode").value=inviteCode.toUpperCase();message("تم تعبئة الرمز من رابط الدعوة. اضغط «طلب الانضمام» لإرسال الطلب.");}
if("serviceWorker"in navigator&&location.protocol==="https:")navigator.serviceWorker.register("./sw.js").catch(()=>{});
