const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const auth = require('./api/auth');
const data = require('./api/data');
const settings = require('./api/settings');

if (process.env.CAMPUS_APP === '1' || process.env.CAMPUS_WEB === '1') process.env.SESSION_SECRET = fs.readFileSync(0, 'utf8').trim();
if (!process.env.SESSION_SECRET && (process.env.CAMPUS_APP === '1' || process.env.CAMPUS_WEB === '1')) throw new Error('Missing local session secret');
process.env.SESSION_SECRET ||= require('node:crypto').randomBytes(32).toString('hex');
const files = {'/':'index.html','/index.html':'index.html','/dashboard':'dashboard.html','/dashboard.html':'dashboard.html'};
const server = http.createServer(async (req,res) => {
  if (process.env.CAMPUS_WEB === '1' && req.headers.host !== `127.0.0.1:${server.address().port}`) { res.statusCode=403; return res.end(); }
  const url = new URL(req.url,'http://localhost');
  res.status = function(code){this.statusCode=code;return this;};
  res.json = function(value){this.setHeader('Content-Type','application/json; charset=utf-8');this.end(JSON.stringify(value));};
  if (url.pathname === '/api/auth' || url.pathname === '/api/data' || url.pathname === '/api/settings') {
    let raw='';for await(const chunk of req) {raw+=chunk;if(raw.length>10000){res.statusCode=413;return res.end();}}
    try {req.body=raw ? JSON.parse(raw) : {};} catch {res.statusCode=400;return res.end();}
    try {return await (url.pathname === '/api/auth' ? auth : url.pathname === '/api/data' ? data : settings)(req,res);} catch {res.statusCode=500;return res.end();}
  }
  if (!files[url.pathname]) {res.statusCode=404;return res.end();}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  fs.createReadStream(path.join(__dirname,'public',files[url.pathname])).pipe(res);
});
server.listen(Number(process.env.PORT || 4173),'127.0.0.1',()=>console.log(`READY ${server.address().port}`));
if (process.env.CAMPUS_APP === '1') {
  const parent = Number(process.env.CAMPUS_PARENT_PID);
  setInterval(() => {if (parent && process.ppid !== parent) process.exit(0);}, 15000).unref();
}
