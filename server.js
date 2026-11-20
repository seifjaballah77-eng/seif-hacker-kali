"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "public");
const rooms = new Map();
const ALLOWED_PERMISSIONS = new Set(["sync", "screen", "app-control"]);
const MIME = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".webmanifest":"application/manifest+json",".svg":"image/svg+xml"};

const server = http.createServer((req,res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch { res.writeHead(400); return res.end("Bad request"); }
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = path.resolve(ROOT, "." + requested);
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT,"index.html")) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file,(err,data) => {
    if(err){res.writeHead(404,{"Cache-Control":"no-store"});return res.end("Not found");}
    res.writeHead(200,{"Content-Type":MIME[path.extname(file)]||"application/octet-stream","Cache-Control":"no-cache","X-Content-Type-Options":"nosniff"});
    res.end(data);
  });
});

const wss = new WebSocketServer({server,maxPayload:64*1024});
function send(ws,obj){ if(ws && ws.readyState===1) ws.send(JSON.stringify(obj)); }
function detach(ws){ if(ws){ws.room=null;ws.role=null;} }
function closeRoom(room,reason,except=null){
  if(!room)return;
  clearTimeout(room.expiry); clearTimeout(room.pendingExpiry);
  rooms.delete(room.id);
  for(const peer of [room.host,room.guest]) {
    if(peer && peer!==except) send(peer,{type:"ended",reason:reason||"انتهت الجلسة"});
    if(peer) detach(peer);
  }
}
function fail(ws,message){send(ws,{type:"error",message});}
wss.on("connection",ws=>{
  ws.id=crypto.randomUUID(); ws.room=null; ws.role=null;
  ws.rateAt=Date.now(); ws.rateCount=0; ws.isAlive=true;
  ws.on("pong",()=>{ws.isAlive=true;});
  ws.on("message",(raw)=>{
    const now=Date.now();
    if(now-ws.rateAt>10000){ws.rateAt=now;ws.rateCount=0;}
    if(++ws.rateCount>60){fail(ws,"طلبات كثيرة جداً. انتظر قليلاً.");return;}
    let msg;
    try{msg=JSON.parse(raw.toString());}catch{return fail(ws,"صيغة الطلب غير صالحة.");}
    if(!msg || typeof msg.type!=="string")return fail(ws,"نوع الطلب غير صالح.");

    if(msg.type==="create"){
      if(ws.room)return fail(ws,"هذا الجهاز مرتبط بجلسة بالفعل.");
      const id=crypto.randomBytes(5).toString("hex").toUpperCase();
      const room={id,host:ws,guest:null,approved:false,expiry:null,pendingExpiry:null};
      room.expiry=setTimeout(()=>closeRoom(room,"انتهت صلاحية رمز الاقتران."),5*60*1000);
      rooms.set(id,room); ws.room=id; ws.role="host";
      return send(ws,{type:"created",room:id,expiresIn:300});
    }

    if(msg.type==="join"){
      if(ws.room)return fail(ws,"افصل الجلسة الحالية أولاً.");
      const id=String(msg.room||"").trim().toUpperCase();
      if(!/^[A-F0-9]{10}$/.test(id))return fail(ws,"أدخل رمز اقتران صحيحاً.");
      const room=rooms.get(id);
      if(!room || room.approved || room.guest || room.host.readyState!==1)return fail(ws,"رمز الاقتران غير صالح أو مستخدم أو انتهت صلاحيته.");
      room.guest=ws; ws.room=id; ws.role="guest";
      const device=String(msg.device||"جهاز جديد").slice(0,80);
      room.pendingExpiry=setTimeout(()=>{
        if(rooms.get(id)===room && !room.approved && room.guest){
          send(room.guest,{type:"error",message:"انتهت مهلة انتظار موافقة المضيف."});
          detach(room.guest); room.guest=null;
          send(room.host,{type:"request-expired"});
        }
      },90000);
      send(ws,{type:"approval-required",device});
      return send(room.host,{type:"join-request",device});
    }

    const room=rooms.get(ws.room);
    if(!room)return fail(ws,"لا توجد جلسة نشطة لهذا الجهاز.");
    if(msg.type==="approve"){
      if(ws!==room.host || !room.guest)return fail(ws,"لا يوجد طلب اقتران للموافقة عليه.");
      clearTimeout(room.pendingExpiry); room.approved=true; clearTimeout(room.expiry);
      send(room.host,{type:"paired",role:"host"});
      return send(room.guest,{type:"paired",role:"guest"});
    }
    if(msg.type==="reject"){
      if(ws!==room.host || !room.guest)return fail(ws,"لا يوجد طلب لرفضه.");
      const guest=room.guest; room.guest=null; detach(guest);
      clearTimeout(room.pendingExpiry);
      send(guest,{type:"ended",reason:"رفض المضيف طلب الاقتران."});
      return send(room.host,{type:"request-rejected"});
    }
    if(msg.type==="end"){
      closeRoom(room,"أنهى أحد الطرفين الاقتران.");
      return;
    }
    if(!room.approved || !room.guest)return fail(ws,"يجب إتمام الموافقة قبل تبادل البيانات.");
    const other=ws===room.host?room.guest:ws===room.guest?room.host:null;
    if(!other)return fail(ws,"هذا الجهاز ليس عضواً في الجلسة.");

    if(msg.type==="signal"){
      const data=msg.data;
      if(!data || typeof data!=="object" || (!data.description && !data.candidate))return fail(ws,"بيانات الاتصال غير صالحة.");
      return send(other,{type:"signal",data});
    }
    if(msg.type==="permission"){
      const permission=String(msg.permission||"");
      if(!ALLOWED_PERMISSIONS.has(permission))return fail(ws,"هذه الصلاحية غير متاحة.");
      return send(other,{type:"permission-request",permission});
    }
    if(msg.type==="permission-result"){
      const permission=String(msg.permission||"");
      if(!ALLOWED_PERMISSIONS.has(permission) || typeof msg.granted!=="boolean")return fail(ws,"نتيجة الصلاحية غير صالحة.");
      return send(other,{type:"permission-result",permission,granted:msg.granted});
    }
    return fail(ws,"طلب غير معروف.");
  });
  ws.on("close",()=>{
    const room=rooms.get(ws.room);
    if(!room)return;
    if(ws===room.host){closeRoom(room,"انقطع اتصال الجهاز المضيف.");return;}
    if(ws===room.guest){
      room.guest=null; detach(ws); clearTimeout(room.pendingExpiry);
      if(room.approved){closeRoom(room,"انقطع اتصال الجهاز الآخر.");}
      else send(room.host,{type:"request-cancelled"});
    }
  });
  ws.on("error",()=>{});
});

const heartbeat=setInterval(()=>{
  for(const ws of wss.clients){
    if(ws.isAlive===false){ws.terminate();continue;}
    ws.isAlive=false;
    try{ws.ping();}catch{ws.terminate();}
  }
},30000);
wss.on("close",()=>clearInterval(heartbeat));
server.listen(PORT,()=>console.log("SEIF HACKER KALI signaling server listening on "+PORT));
