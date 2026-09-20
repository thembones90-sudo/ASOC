const fs=require('fs'), path=require('path'), crypto=require('crypto');
const file=process.env.ASOC_AUTH_FILE || path.join(__dirname,'auth-store.json');
const ITER=210000;
function load(){try{const d=JSON.parse(fs.readFileSync(file,'utf8'));return d&&typeof d==='object'?d:{players:{}}}catch(e){return {players:{}}}}
function save(d){const t=file+'.tmp';fs.writeFileSync(t,JSON.stringify(d,null,2));fs.renameSync(t,file)}
function normEmail(v){return String(v||'').trim().toLowerCase()}
function hash(p,s){return crypto.pbkdf2Sync(String(p),s,ITER,32,'sha256').toString('hex')}
function safe(p){return {id:p.id,email:p.email,name:p.name||'',createdAt:p.createdAt}}
function register(email,password,name=''){email=normEmail(email);if(!/^(?:[^\s@]+@[^\s@]+\.[^\s@]+|[a-z0-9][a-z0-9_-]{2,31})$/.test(email))throw Error('Enter a valid identity ID');if(String(password).length<6)throw Error('Password must be at least 6 characters');const d=load();if(d.players[email])throw Error('Account already exists');const salt=crypto.randomBytes(16).toString('hex');const p={id:'lh-'+crypto.randomBytes(10).toString('base64url'),email,name:String(name||'').trim().slice(0,20),salt,hash:hash(password,salt),createdAt:Date.now()};d.players[email]=p;save(d);return safe(p)}
function login(email,password){email=normEmail(email);const p=load().players[email];if(!p)return null;const a=Buffer.from(hash(password,p.salt),'hex'),b=Buffer.from(p.hash,'hex');return a.length===b.length&&crypto.timingSafeEqual(a,b)?safe(p):null}
function getById(id){const players=Object.values(load().players||{});const p=players.find(player=>player&&player.id===id);return p?safe(p):null}
module.exports={register,login,getById};
