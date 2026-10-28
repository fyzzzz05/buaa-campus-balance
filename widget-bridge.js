// Loopback-only bridge for the sandboxed widget. It serves only the sanitized
// snapshot and requires a per-installation random token.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const token=fs.readFileSync(process.argv[2],'utf8').trim();
if(!/^[0-9a-f]{64}$/.test(token))process.exit(1);
const file=path.join(os.homedir(),'Library','Application Support','CampusBalance','widget-snapshot.json');
const server=http.createServer((req,res)=>{
  const provided=Buffer.from(req.headers.authorization||''), expected=Buffer.from('Bearer '+token);
  if(req.method!=='GET'||req.url!=='/snapshot'||provided.length!==expected.length||!crypto.timingSafeEqual(provided,expected)){res.writeHead(404);return res.end()}
  fs.readFile(file,(err,data)=>{if(err||data.length>4096){res.writeHead(404);return res.end()}res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(data)})
});
server.listen(Number(process.env.CAMPUS_WIDGET_BRIDGE_PORT || 49771),'127.0.0.1');
