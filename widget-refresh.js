// Daily local refresh for the desktop widget. Passwords remain in Keychain;
// the widget receives only balance values and never receives school cookies.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const campus=require('./lib/campus');
const credentials=require('./lib/credentials');
const settings=require('./lib/settings');
const widget=require('./lib/widget-snapshot');

async function refresh(config, deps={campus,credentials,settings,widget}) {
  if (!config || !/^[A-Za-z0-9][A-Za-z0-9@._-]{1,64}$/.test(config.user)) throw new Error('Missing widget account');
  const password=await deps.credentials.read(config.user);
  const current=await deps.campus.login(config.user,password,config.networkSamePassword===true);
  const data={};
  try { data.card=await deps.campus.card(current,{balanceOnly:true}); } catch { data.card={status:'unavailable'}; }
  try { data.net=await deps.campus.network(current,{balanceOnly:true}); } catch { data.net={status:'unavailable'}; }
  try { Object.assign(data,await deps.campus.electricity(deps.settings.read(config.user))); } catch { data.lighting=data.air={status:'unavailable'}; }
  await deps.widget.publish(data);
  return data;
}

if (require.main===module) {
  const configPath=path.join(os.homedir(),'Library','Application Support','CampusBalance','widget-account.json');
  try {
    const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
    refresh(config).catch(()=>{process.exitCode=1});
  } catch { process.exitCode=1; }
}
module.exports={refresh};
