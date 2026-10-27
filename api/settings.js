const session=require('../lib/session');
const settings=require('../lib/settings');
module.exports=async function(req,res){
  res.setHeader('Cache-Control','no-store');
  const current=session.read(req);if(!current)return res.status(401).json({error:'请重新登录'});
  if(process.env.CAMPUS_WEB!=='1' && process.env.CAMPUS_APP!=='1')return res.status(503).json({error:'宿舍设置仅支持本机运行'});
  if(req.method==='GET')return res.status(200).json({settings:settings.read(current.user)});
  if(req.method!=='POST')return res.status(405).json({error:'不支持此请求'});
  const origin=req.headers.origin;if(!origin || new URL(origin).origin!==`http://${req.headers.host}`)return res.status(403).json({error:'请求来源不受支持'});
  try{return res.status(200).json({settings:settings.write(current.user,req.body)})}catch{return res.status(400).json({error:'请检查宿舍名称和电表号'})}
};
