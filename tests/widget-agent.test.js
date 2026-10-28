const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');

test('widget agent stores only account configuration and is removed on logout',{skip:process.platform!=='darwin'},async t=>{
  const oldHome=process.env.HOME,oldApp=process.env.CAMPUS_APP,oldHelper=process.env.CAMPUS_WIDGET_HELPER,oldWorker=process.env.CAMPUS_WIDGET_REFRESH,oldNode=process.env.CAMPUS_WIDGET_NODE;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'campus-agent-'));
  process.env.HOME=dir;process.env.CAMPUS_APP='1';
  for(const name of ['helper','worker','node'])fs.writeFileSync(path.join(dir,name),'');
  process.env.CAMPUS_WIDGET_HELPER=path.join(dir,'helper');process.env.CAMPUS_WIDGET_REFRESH=path.join(dir,'worker');process.env.CAMPUS_WIDGET_NODE=path.join(dir,'node');
  const commands=[];
  const run=async (file,args)=>{commands.push(args[0]);if(args[0]==='bootout'||args[0]==='print')throw new Error('not loaded');return {stdout:''}};
  delete require.cache[require.resolve('../lib/widget-agent')];const agent=require('../lib/widget-agent');
  t.after(()=>{for(const [k,v] of Object.entries({HOME:oldHome,CAMPUS_APP:oldApp,CAMPUS_WIDGET_HELPER:oldHelper,CAMPUS_WIDGET_REFRESH:oldWorker,CAMPUS_WIDGET_NODE:oldNode})){if(v===undefined)delete process.env[k];else process.env[k]=v}fs.rmSync(dir,{recursive:true,force:true})});
  await agent.enable('testuser',true,run);
  const file=path.join(dir,'Library','Application Support','CampusBalance','widget-account.json');
  const data=JSON.parse(fs.readFileSync(file,'utf8'));assert.deepEqual(data,{user:'testuser',networkSamePassword:true});
  assert.equal(fs.statSync(file).mode&0o777,0o600);assert(commands.includes('bootstrap'));
  await agent.disable(run);assert.equal(fs.existsSync(file),false);
});
