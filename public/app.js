const $=id=>document.getElementById(id);let socket=null,room=null,role=null,peer=null,channel=null,localStream=null,permissions={};const wsUrl=location.hostname==="localhost"||location.hostname==="127.0.0.1"?(location.protocol==="https:"?"wss://":"ws://")+location.host:"wss://seif-hacker-kali.onrender.com";
function connect(){return new Promise((resolve,reject)=>{socket=new WebSocket(wsUrl);socket.onopen=()=>resolve();socket.onerror=reject;socket.onmessage=e=>handle(JSON.parse(e.data));socket.onclose=()=>{setStatus("انقطع الاتصال");resetSession()}})}
function send(data){if(socket&&socket.readyState===1)socket.send(JSON.stringify(data))}
function setStatus(s){$("status").textContent="● "+s}
function show(id){document.querySelectorAll(".view").forEach(x=>x.classList.add("hidden"));$(id).classList.remove("hidden");document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.view===id));$("heading").textContent=id==="sim"?"مركز المحاكاة":"الاقتران مع موافقة"}
document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>show(b.dataset.view));
async function ensureSocket(){if(!socket||socket.readyState!==1)await connect()}
$("create").onclick=async()=>{try{await ensureSocket();send({type:"create"});show("pair")}catch{$("joinMsg").textContent="تعذر الاتصال بخادم الاقتران."}};
$("join").onclick=async()=>{try{await ensureSocket();room=$("joinCode").value.trim().toUpperCase();if(!room)return;$("joinMsg").textContent="جارٍ إرسال طلب الاقتران…";send({type:"join",room,device:navigator.userAgent.includes("Android")?"Android":navigator.userAgent.includes("iPhone")?"iPhone":"متصفح / كمبيوتر"})}catch{$("joinMsg").textContent="تعذر الاتصال بخادم الاقتران."}};
$("copy").onclick=()=>navigator.clipboard.writeText(new URL("./?join="+encodeURIComponent(room),location.href).href);
$("approve").onclick=()=>send({type:"approve"});$("reject").onclick=()=>send({type:"reject"});$("end").onclick=()=>send({type:"end"});
function handle(m){
 if(m.type==="created"){room=m.room;$("invite").classList.remove("hidden");$("roomCode").textContent=room;$("pairUrl").textContent=new URL("./?join="+encodeURIComponent(room),location.href).href;if(window.QRCode)QRCode.toCanvas($("pairUrl").textContent,{width:190,margin:1},(e,c)=>{if(!e){$("qr").replaceChildren(c)}});setStatus("بانتظار الجهاز الآخر");}
 if(m.type==="join-request"){$("approval").classList.remove("hidden");$("requestDevice").textContent="نوع الجهاز: "+m.device;setStatus("طلب موافقة وارد");}
 if(m.type==="approval-required")$("joinMsg").textContent="تم إرسال الطلب. انتظر موافقة الجهاز المضيف.";
 if(m.type==="paired"){$("approval").classList.add("hidden");$("session").classList.remove("hidden");role=m.role;setStatus("مقترن — "+role);startPeer();}
 if(m.type==="signal")onSignal(m.data);
 if(m.type==="permission-request")answerPermission(m.permission);
 if(m.type==="permission-result"){permissions[m.permission]=m.granted;alert((m.granted?"تم منح":"تم رفض")+" إذن: "+m.permission);}
 if(m.type==="ended"){alert(m.reason||"تم إنهاء الجلسة");resetSession();}
 if(m.type==="error")alert(m.message);
}
function startPeer(){peer=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});peer.onicecandidate=e=>{if(e.candidate)send({type:"signal",data:{candidate:e.candidate}})};peer.ontrack=e=>$("remoteVideo").srcObject=e.streams[0];peer.ondatachannel=e=>bindChannel(e.channel);if(role==="host"){channel=peer.createDataChannel("seif-control");bindChannel(channel);peer.createOffer().then(o=>peer.setLocalDescription(o)).then(()=>send({type:"signal",data:{description:peer.localDescription}})).catch(console.error)} }
function bindChannel(ch){channel=ch;ch.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}if(m.type==="sync-output"&&permissions.sync)$("output").textContent=m.text;if(m.type==="app-action"&&permissions["app-control"])$("output").textContent+="\n[REMOTE APP ACTION] "+String(m.value).slice(0,120)}}
const pendingCandidates=[];
async function onSignal(data){if(!peer)return;try{if(data.description){await peer.setRemoteDescription(data.description);while(pendingCandidates.length)await peer.addIceCandidate(pendingCandidates.shift());if(data.description.type==="offer"){const a=await peer.createAnswer();await peer.setLocalDescription(a);send({type:"signal",data:{description:peer.localDescription}})}}else if(data.candidate){if(peer.remoteDescription)await peer.addIceCandidate(data.candidate);else pendingCandidates.push(data.candidate)}}catch(e){console.error(e)}}
document.querySelectorAll("[data-permission]").forEach(b=>b.onclick=()=>{const p=b.dataset.permission;if(p==="screen"){requestPermission("screen");return}send({type:"permission",permission:p})});
function answerPermission(p){const yes=confirm("الجهاز الآخر يطلب الإذن التالي: "+p+"\nهل توافق؟");send({type:"permission-result",permission:p,granted:yes});permissions[p]=yes;if(yes&&p==="screen")startScreenShare()}
async function requestPermission(p){const yes=confirm("هل تريد طلب مشاركة الشاشة من الجهاز الآخر؟");if(yes)send({type:"permission",permission:p})}
async function startScreenShare(){try{if(!navigator.mediaDevices?.getDisplayMedia)throw Error("مشاركة الشاشة غير مدعومة في هذا المتصفح");localStream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});localStream.getTracks().forEach(t=>peer.addTrack(t,localStream));const offer=await peer.createOffer();await peer.setLocalDescription(offer);send({type:"signal",data:{description:peer.localDescription}});localStream.getVideoTracks()[0].onended=()=>localStream=null}catch(e){alert("لم تبدأ مشاركة الشاشة: "+e.message)}}
function resetSession(){pendingCandidates.length=0;if(localStream)localStream.getTracks().forEach(t=>t.stop());if(peer)peer.close();peer=null;channel=null;localStream=null;permissions={};$("session").classList.add("hidden");$("approval").classList.add("hidden");setStatus("غير متصل")}
$("cmd").onsubmit=e=>{e.preventDefault();const v=$("command").value.trim();if(!v)return;const out=$("output");const commands={help:"الأوامر: help, status, scan, matrix, clear",status:"MODE: LOCAL SIMULATION\nREMOTE: CONSENT REQUIRED",scan:"محاكاة فحص محلية: لا توجد أجهزة مستهدفة.",matrix:"MATRIX VISUALIZER: READY"};if(v==="clear")out.textContent="";else out.textContent+="\n> "+v+"\n"+(commands[v]||"أمر تجريبي غير معروف. اكتب help.");$("command").value="";if(permissions.sync&&channel?.readyState==="open")channel.send(JSON.stringify({type:"sync-output",text:out.textContent}))};
const q=new URLSearchParams(location.search).get("join");if(q){show("pair");$("joinCode").value=q;$("joinMsg").textContent="تم تعبئة رمز الاقتران من الرابط. اضغط طلب الانضمام."}
if("serviceWorker"in navigator&&location.protocol==="https:")navigator.serviceWorker.register("/sw.js").catch(()=>{});
