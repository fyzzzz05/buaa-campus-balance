const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const exec=promisify(execFile);
const label='edu.buaa.campusbalance.widget-refresh';
const bridgeLabel='edu.buaa.campusbalance.widget-bridge';
const bridgePlist=path.join(os.homedir(),'Library','LaunchAgents',bridgeLabel+'.plist');
const state=path.join(os.homedir(),'Library','Application Support','CampusBalance','widget-account.json');
const plist=path.join(os.homedir(),'Library','LaunchAgents',label+'.plist');
const xml=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
function makePlist(node,worker,helper) {
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(worker)}</string></array><key>EnvironmentVariables</key><dict><key>CAMPUS_APP</key><string>1</string><key>CAMPUS_WIDGET_HELPER</key><string>${xml(helper)}</string></dict><key>RunAtLoad</key><true/><key>StartCalendarInterval</key><dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>30</integer></dict></dict></plist>`;
}
function makeBridgePlist(bridge,tokenFile) {
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${bridgeLabel}</string><key>ProgramArguments</key><array><string>${xml(bridge)}</string><string>${xml(tokenFile)}</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>`;
}
function supported() { return process.platform==='darwin' && process.env.CAMPUS_APP==='1' && Boolean(process.env.CAMPUS_WIDGET_HELPER && process.env.CAMPUS_WIDGET_REFRESH && process.env.CAMPUS_WIDGET_NODE); }
async function disable(run=exec) {
  if(!supported())return;
  try { await run('/bin/launchctl',['bootout',`gui/${process.getuid()}/${label}`],{timeout:5000}); } catch {}
  try { await run('/bin/launchctl',['bootout',`gui/${process.getuid()}/${bridgeLabel}`],{timeout:5000}); } catch {}
  let stillLoaded=false;
  try { await run('/bin/launchctl',['print',`gui/${process.getuid()}/${label}`],{timeout:5000}); stillLoaded=true; } catch {}
  if (stillLoaded) throw new Error('Widget agent could not be stopped');
  try { fs.unlinkSync(bridgePlist); } catch (e) { if(e.code!=='ENOENT')throw e; }
  try { fs.unlinkSync(plist); } catch (e) { if(e.code!=='ENOENT')throw e; }
  try { fs.unlinkSync(state); } catch (e) { if(e.code!=='ENOENT')throw e; }
}
async function enable(user, networkSamePassword, run=exec) {
  if(!supported())return;
  if(!/^[A-Za-z0-9][A-Za-z0-9@._-]{1,64}$/.test(user))throw new Error('Invalid account');
  const node=process.env.CAMPUS_WIDGET_NODE,worker=process.env.CAMPUS_WIDGET_REFRESH,helper=process.env.CAMPUS_WIDGET_HELPER;
  if (![node,worker,helper].every(p=>path.isAbsolute(p) && fs.existsSync(p)))throw new Error('Widget tools unavailable');
  const body=makePlist(node,worker,helper);
  const bridge=process.env.CAMPUS_WIDGET_BRIDGE, tokenFile=process.env.CAMPUS_WIDGET_TOKEN_FILE;
  if ((bridge || tokenFile) && ![bridge,tokenFile].every(p=>p && path.isAbsolute(p) && fs.existsSync(p))) throw new Error('Widget bridge unavailable');
  fs.mkdirSync(path.dirname(state),{recursive:true,mode:0o700});fs.mkdirSync(path.dirname(plist),{recursive:true,mode:0o700});
  fs.writeFileSync(state,JSON.stringify({user,networkSamePassword:networkSamePassword===true}),{mode:0o600});
  try { await run('/bin/launchctl',['bootout',`gui/${process.getuid()}/${label}`],{timeout:5000}); } catch {}
  fs.writeFileSync(plist,body,{mode:0o600});
  if (bridge && tokenFile) {
    try { await run('/bin/launchctl',['bootout',`gui/${process.getuid()}/${bridgeLabel}`],{timeout:5000}); } catch {}
    fs.writeFileSync(bridgePlist,makeBridgePlist(bridge,tokenFile),{mode:0o600});
    await run('/bin/launchctl',['bootstrap',`gui/${process.getuid()}`,bridgePlist],{timeout:5000});
  }
  await run('/bin/launchctl',['bootstrap',`gui/${process.getuid()}`,plist],{timeout:5000});
}
module.exports={supported,enable,disable,makePlist};
