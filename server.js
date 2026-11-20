const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "public");
const rooms = new Map();
const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".webmanifest":"application/manifest+json", ".svg":"image/svg+xml" };

const server = http.createServer((req,res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = path.normalize(path.join(ROOT, requested));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file,(err,data)=> {
    if(err){res.writeHead(404);return res.end("Not found");}
    res.writeHead(200,{"Content-Type":types[path.extname(file)]||"application/octet-stream","Cache-Control":"no-cache"});
    res.end(data);
  });
});

const wss = new WebSocketServer({server});
function send(ws,obj){ if(ws.readyState===1) ws.send(JSON.stringify(obj)); }
function cleanup(room){
  if(!room) return;
  clearTimeout(room.expiry);
  for(const peer of room.peers) send(peer,{type:"ended",reason:"انتهت الجلسة"});
  rooms.delete(room.id);
}
wss.on("connection",ws=>{
  ws.id=crypto.randomUUID(); ws.room=null; ws.role=null;
  ws.on("message",raw=>{
    let msg; try{msg=JSON.parse(raw.toString())}catch{return send(ws,{type:"error",message:"طلب غير صالح"});}
    if(msg.type==="create"){
      const id=crypto.randomBytes(5).toString("hex").toUpperCase();
      const room={id,host:ws,guest:null,peers:[ws],approved:false,expiry:setTimeout(()=>cleanup(room),5*60*1000)};
      rooms.set(id,room); ws.room=id; ws.role="host";
      return send(ws,{type:"created",room:id,expiresIn:300});
    }
    if(msg.type==="join"){
      const id=String(msg.room||"").toUpperCase(); const room=rooms.get(id);
      if(!room || room.guest || room.host.readyState!==1) return send(ws,{type:"error",message:"رمز الاقتران غير صالح أو انتهت صلاحيته"});
      room.guest=ws; room.peers.push(ws); ws.room=id; ws.role="guest";
      send(ws,{type:"approval-required",device:String(msg.device||"جهاز جديد").slice(0,80)});
      return send(room.host,{type:"join-request",device:String(msg.device||"جهاز جديد").slice(0,80)});
    }
    const room=rooms.get(ws.room);
    if(!room) return send(ws,{type:"error",message:"لا توجد جلسة"});
    if(msg.type==="approve" && ws===room.host && room.guest){
      room.approved=true; clearTimeout(room.expiry);
      send(room.host,{type:"paired",role:"host"});
      send(room.guest,{type:"paired",role:"guest"});
      return;
    }
    if(msg.type==="reject" && ws===room.host){ cleanup(room); return; }
    if(msg.type==="end"){ cleanup(room); return; }
    if(msg.type==="signal" && room.approved){
      const other=ws===room.host?room.guest:room.host;
      if(other) send(other,{type:"signal",data:msg.data});
    }
    if(msg.type==="permission" && room.approved){
      const other=ws===room.host?room.guest:room.host;
      if(other) send(other,{type:"permission-request",permission:String(msg.permission||"").slice(0,40)});
    }
    if(msg.type==="permission-result" && room.approved){
      const other=ws===room.host?room.guest:room.host;
      if(other) send(other,{type:"permission-result",permission:msg.permission,granted:!!msg.granted});
    }
  });
  ws.on("close",()=>{const room=rooms.get(ws.room); if(room) cleanup(room);});
});
server.listen(PORT,()=>console.log("SEIF HACKER KALI listening on "+PORT));
