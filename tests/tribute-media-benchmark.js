'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { create } = require('../tribute-media-store');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-tribute-bench-'));
const percentile = (values, p) => values.slice().sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
try {
  const store = create(root);
  const tributes = Array.from({length:72}, (_, i) => {
    const bytes = crypto.createHash('sha512').update(String(i)).digest();
    const body = Buffer.alloc(264000);
    for (let at=0; at<body.length; at+=bytes.length) bytes.copy(body, at);
    return { id:`synthetic-${i}`, playerName:`P${i%12}`, imageData:'data:image/png;base64,'+body.toString('base64') };
  });
  const inlineBytes = Buffer.byteLength(JSON.stringify({bloodTributes:tributes}));
  const started = process.hrtime.bigint();
  const compact = tributes.map(t => { const mediaRef=store.putDataUrl(t.imageData); return {id:t.id,playerName:t.playerName,mediaRef}; });
  const migrationMs = Number(process.hrtime.bigint()-started)/1e6;
  const compactBytes = Buffer.byteLength(JSON.stringify({bloodTributes:compact}));
  const measure = value => Array.from({length:25},()=>{const s=process.hrtime.bigint();JSON.stringify(value);return Number(process.hrtime.bigint()-s)/1e6;});
  const before=measure({bloodTributes:tributes}), after=measure({bloodTributes:compact});
  console.log(JSON.stringify({fixture:{objects:72,inlineBytes,compactBytes,privateBlobBytes:fs.readdirSync(store.dir).reduce((n,f)=>n+fs.statSync(path.join(store.dir,f)).size,0)},oneTimeMigrationMs:migrationMs,stringifyMs:{before:{p50:percentile(before,.5),p95:percentile(before,.95)},after:{p50:percentile(after,.5),p95:percentile(after,.95)}}}));
} finally { fs.rmSync(root,{recursive:true,force:true}); }
