'use strict';
const campus = require('../../lib/campus');
const diagnostics = require('../../lib/diagnostics');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({error:'不支持此请求'});
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return res.status(403).json({error:'请求来源不受支持'});
  try { return res.status(200).json(await campus.beginLogin(req.body?.challengeId)); }
  catch (error) {
    const diagnostic = diagnostics.report(error, 'schoolLogin');
    return res.status(503).json({error:diagnostic.message,diagnostic});
  }
};
