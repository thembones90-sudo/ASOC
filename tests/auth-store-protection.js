const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asoc-auth-protection-'));
const file=path.join(dir,'auth.json');
process.env.ASOC_AUTH_FILE=file;
const store=require('../auth-store');
const register=email=>store.register(email,'password','Hero',{requireVerification:false});
try{
  register('legacy');
  let original=JSON.parse(fs.readFileSync(file));
  delete original.players.legacy.verificationRequired;delete original.players.legacy.emailVerifiedAt;
  fs.writeFileSync(file,JSON.stringify(original));
  assert.equal(store.login('legacy','password').emailVerified,true);
  const pending=store.register('pending@example.com','password');
  assert.equal(store.verifyEmail(pending.verificationToken).ok,true);
  assert.equal(store.login('pending@example.com','password').emailVerified,true);
  register('third');
  const backup=fs.readFileSync(file+'.bak','utf8');
  fs.writeFileSync(file,'{broken');
  assert.ok(store.login('legacy','password'));
  assert.equal(fs.readFileSync(file,'utf8'),backup);
  assert.ok(fs.readdirSync(dir).some(n=>n.includes('.corrupt-')));
  fs.unlinkSync(file);
  assert.ok(store.login('legacy','password'));
  for(const bad of ['{bad','[]','{}','{"players":[]}','{"players":{"x":{}}}']){
    fs.writeFileSync(file,bad);fs.writeFileSync(file+'.bak','bad backup');
    assert.throws(()=>register('newhero'),/Auth storage unavailable/);
    assert.equal(fs.readFileSync(file,'utf8'),bad);
    assert.equal(fs.readFileSync(file+'.bak','utf8'),'bad backup');
  }
  fs.unlinkSync(file);
  assert.throws(()=>register('newhero'),/Auth storage unavailable/);
  fs.writeFileSync(file,backup);fs.writeFileSync(file+'.bak',backup);
  const realRead=fs.readFileSync;
  fs.readFileSync=function(p,...args){if(p===file)throw Object.assign(Error('denied'),{code:'EACCES'});return realRead.call(this,p,...args)};
  try{assert.throws(()=>register('newhero'),/Auth storage unavailable/)}finally{fs.readFileSync=realRead}
  assert.equal(fs.readFileSync(file,'utf8'),backup);
  const rename=fs.renameSync;
  fs.renameSync=function(src,dst){if(dst===file)throw Error('injected rename failure');return rename.call(this,src,dst)};
  try{assert.throws(()=>register('newhero'),/Auth storage unavailable/)}finally{fs.renameSync=rename}
  assert.equal(fs.readFileSync(file,'utf8'),backup);
  assert.ok(!fs.readdirSync(dir).some(n=>n.includes('.tmp-')));
  assert.ok(store.login('legacy','password'));
  console.log('PASS auth durability, recovery, legacy/verified compatibility and write failures');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
