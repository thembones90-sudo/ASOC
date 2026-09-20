const fs=require('fs'), path=require('path'), crypto=require('crypto');
const dataDir=process.env.ASOC_DATA_DIR?path.resolve(process.env.ASOC_DATA_DIR):__dirname;
const file=process.env.ASOC_AUTH_FILE?path.resolve(process.env.ASOC_AUTH_FILE):path.join(dataDir,'auth-store.json');
fs.mkdirSync(path.dirname(file),{recursive:true});
const ITER=210000;
const VERIFY_TTL_MS=Math.max(5*60*1000,Number(process.env.ASOC_EMAIL_VERIFY_TTL_MS)||60*60*1000);
const RESEND_COOLDOWN_MS=Math.max(15000,Number(process.env.ASOC_EMAIL_RESEND_COOLDOWN_MS)||60*1000);

const backupFile=file+'.bak';
function validate(d){
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
  if(!object(d)||!object(d.players))throw Error('Invalid auth database');
  const ids=new Set();
  for(const [key,p] of Object.entries(d.players)){
    if(!object(p)||typeof p.id!=='string'||!p.id||ids.has(p.id)||
       typeof p.email!=='string'||p.email!==key||normEmail(key)!==key||
       typeof p.salt!=='string'||!p.salt||typeof p.hash!=='string'||! /^[a-f0-9]{64}$/i.test(p.hash))throw Error('Invalid auth account');
    ids.add(p.id);
    if(p.verificationRequired!==undefined&&typeof p.verificationRequired!=='boolean')throw Error('Invalid verification state');
    for(const field of ['emailVerifiedAt','verificationExpiresAt','verificationSentAt']){
      if(p[field]!=null&&(!Number.isFinite(p[field])||p[field]<0))throw Error('Invalid verification timestamp');
    }
    if(p.verificationTokenHash!==undefined&&!/^[a-f0-9]{64}$/i.test(p.verificationTokenHash))throw Error('Invalid verification digest');
  }
  return d;
}
function read(filePath){return validate(JSON.parse(fs.readFileSync(filePath,'utf8')))}
function atomic(filePath,d){
  const tmp=filePath+'.tmp-'+process.pid+'-'+crypto.randomBytes(8).toString('hex');
  let fd;
  try{
    fd=fs.openSync(tmp,'wx',0o600);
    fs.writeFileSync(fd,JSON.stringify(d,null,2),'utf8');
    fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    fs.renameSync(tmp,filePath);
  }catch(error){
    if(fd!==undefined)try{fs.closeSync(fd)}catch{}
    try{fs.unlinkSync(tmp)}catch{}
    throw error;
  }
}
function unavailable(){return Error('Auth storage unavailable; repair or restore the database before retrying')}
function load(){
  let mainError;
  try{return read(file)}catch(error){mainError=error}
  // Permission and I/O failures are not evidence of corruption. Never replace them.
  if(mainError.code&&mainError.code!=='ENOENT')throw unavailable();
  let backup;
  try{backup=read(backupFile)}catch(error){
    if(mainError.code==='ENOENT'&&error.code==='ENOENT')return {players:{}};
    throw unavailable();
  }
  try{
    if(mainError.code!=='ENOENT')fs.renameSync(file,file+'.corrupt-'+Date.now()+'-'+crypto.randomBytes(6).toString('hex'));
    atomic(file,backup);
  }catch{throw unavailable()}
  console.warn('[auth-store] Restored validated backup; any corrupt main file was quarantined.');
  return backup;
}
function save(d){
  validate(d);
  // Re-read before replacing either file; never back up corrupt data.
  let previous;
  try{previous=read(file)}catch(error){if(error.code!=='ENOENT')throw unavailable()}
  try{
    if(previous)atomic(backupFile,previous);
    else atomic(backupFile,d);
    atomic(file,d);
  }catch{throw unavailable()}
}
function normEmail(v){return String(v||'').trim().toLowerCase()}
function isRealEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)}
function isLegacyIdentity(v){return /^[a-z0-9][a-z0-9_-]{2,31}$/.test(v)}
function hash(p,s){return crypto.pbkdf2Sync(String(p),s,ITER,32,'sha256').toString('hex')}
function digestToken(token){return crypto.createHash('sha256').update(String(token||'')).digest('hex')}
function isVerified(p){return Boolean(p&&(p.verificationRequired!==true||p.emailVerifiedAt))}
function safe(p){return {id:p.id,email:p.email,name:p.name||'',createdAt:p.createdAt,emailVerified:isVerified(p),emailVerifiedAt:p.emailVerifiedAt||null}}

function stampVerification(p){
  const token=crypto.randomBytes(32).toString('base64url');
  const now=Date.now();
  p.verificationRequired=true;
  p.emailVerifiedAt=null;
  p.verificationTokenHash=digestToken(token);
  p.verificationExpiresAt=now+VERIFY_TTL_MS;
  p.verificationSentAt=now;
  return token;
}

function register(email,password,name='',options={}){
  email=normEmail(email);
  const requireVerification=options.requireVerification!==false;
  if(requireVerification?!isRealEmail(email):!(isRealEmail(email)||isLegacyIdentity(email)))throw Error(requireVerification?'Enter a valid email address':'Enter a valid identity ID');
  if(String(password).length<6)throw Error('Password must be at least 6 characters');
  const d=load();
  if(d.players[email])throw Error('Account already exists');
  const salt=crypto.randomBytes(16).toString('hex');
  const p={id:'lh-'+crypto.randomBytes(10).toString('base64url'),email,name:String(name||'').trim().slice(0,20),salt,hash:hash(password,salt),createdAt:Date.now()};
  let verificationToken=null;
  if(requireVerification)verificationToken=stampVerification(p);
  else{p.verificationRequired=false;p.emailVerifiedAt=Date.now();}
  d.players[email]=p;
  save(d);
  return {player:safe(p),verificationToken};
}

function login(email,password){
  email=normEmail(email);
  const p=load().players[email];
  if(!p)return null;
  const a=Buffer.from(hash(password,p.salt),'hex'),b=Buffer.from(p.hash,'hex');
  return a.length===b.length&&crypto.timingSafeEqual(a,b)?safe(p):null;
}

function getById(id){
  const p=Object.values(load().players||{}).find(player=>player&&player.id===id);
  return p?safe(p):null;
}

function verifyEmail(token){
  const tokenHash=digestToken(token);
  const d=load();
  const p=Object.values(d.players||{}).find(player=>player&&player.verificationTokenHash===tokenHash);
  if(!p)return {ok:false,reason:'invalid'};
  if(isVerified(p))return {ok:true,alreadyVerified:true,player:safe(p)};
  if(!p.verificationExpiresAt||Number(p.verificationExpiresAt)<Date.now())return {ok:false,reason:'expired',email:p.email};
  p.emailVerifiedAt=Date.now();
  delete p.verificationTokenHash;
  delete p.verificationExpiresAt;
  delete p.verificationSentAt;
  save(d);
  return {ok:true,player:safe(p)};
}

function issueVerificationToken(email){
  email=normEmail(email);
  const d=load();
  const p=d.players[email];
  if(!p||isVerified(p))return {ok:false,reason:'not_pending'};
  const now=Date.now();
  const retryAfterMs=Math.max(0,RESEND_COOLDOWN_MS-(now-Number(p.verificationSentAt||0)));
  if(retryAfterMs>0)return {ok:false,reason:'cooldown',retryAfterMs};
  const verificationToken=stampVerification(p);
  save(d);
  return {ok:true,player:safe(p),verificationToken};
}

module.exports={
  register,login,getById,verifyEmail,issueVerificationToken,isVerified,
  VERIFY_TTL_MS,RESEND_COOLDOWN_MS
};
