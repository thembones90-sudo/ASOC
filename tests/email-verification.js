const assert=require('assert/strict');
const http=require('http');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawn}=require('child_process');
const {once}=require('events');
const WebSocket=require('ws');
const crypto=require('crypto');

const ROOT=path.resolve(__dirname,'..');
const PORT=Number(process.env.ASOC_EMAIL_TEST_PORT)||18310;
const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'asoc-email-verify-'));
const outbox=path.join(tempDir,'outbox.jsonl');

function request(urlPath,method='GET',body=null){
  return new Promise((resolve,reject)=>{
    const payload=body===null?null:JSON.stringify(body);
    const req=http.request({
      hostname:'127.0.0.1',port:PORT,path:urlPath,method,
      headers:payload?{'content-type':'application/json','content-length':Buffer.byteLength(payload)}:{}
    },res=>{
      let raw='';res.on('data',c=>raw+=c);res.on('end',()=>{
        let data={};try{data=raw?JSON.parse(raw):{}}catch{}
        resolve({status:res.statusCode,headers:res.headers,data,raw});
      });
    });
    req.on('error',reject);if(payload)req.write(payload);req.end();
  });
}

function startServer(verification='1'){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['server.js'],{
      cwd:ROOT,
      env:{
        ...process.env,
        PORT:String(PORT),
        ASOC_DATA_DIR:tempDir,
        ASOC_GM_PASSWORD:'email-test-gm',
        ASOC_EMAIL_PROVIDER:'test',
        ASOC_EMAIL_TEST_OUTBOX:outbox,
        ASOC_EMAIL_VERIFICATION:verification,
        ASOC_PUBLIC_BASE_URL:'http://127.0.0.1:'+PORT
      },
      stdio:['ignore','pipe','pipe']
    });
    let stderr='';
    const timer=setTimeout(()=>{child.kill();reject(Error('Email verification test server startup timeout: '+stderr))},12000);
    child.stderr.on('data',c=>stderr+=c.toString());
    child.stdout.on('data',c=>{
      if(c.toString().includes('ASOC Engine server running')){
        clearTimeout(timer);resolve(child);
      }
    });
    child.once('exit',code=>{
      clearTimeout(timer);
      if(code&&code!==0)reject(Error('Email verification test server exited '+code+': '+stderr));
    });
  });
}

async function stopServer(child){
  if (!child || child.exitCode !== null) return;
  const exited=once(child,'exit');
  child.kill('SIGTERM');
  await exited;
}
function join(token){
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket('ws://127.0.0.1:'+PORT);
    const timer=setTimeout(()=>{ws.terminate();reject(Error('Join timed out'))},5000);
    ws.on('error',reject);
    ws.on('message',raw=>{
      const message=JSON.parse(raw);
      if(message.type==='protocol:hello') ws.send(JSON.stringify({type:'protocol:hello',protocolVersion:1}));
      if(message.type==='protocol:ready') ws.send(JSON.stringify({type:'room:join',authToken:token,name:'VERIFY HERO'}));
      if(['join:success','auth:required','error'].includes(message.type)){
        clearTimeout(timer);ws.close();resolve(message);
      }
    });
  });
}

(async()=>{
  let server;
  try{
    server=await startServer();
    const credentials={email:'little.hero@example.com',password:'test-password',name:'VERIFY HERO'};
    const created=await request('/api/auth/player/register','POST',credentials);
    assert.equal(created.status,201);
    assert.equal(created.data.verificationRequired,true);
    assert.equal(created.data.token,undefined);
    assert.equal(created.data.player.emailVerified,false);
    const badIdentity=await request('/api/auth/player/register','POST',{email:'old_style_id',password:'test-password',name:'BAD'});
    assert.equal(badIdentity.status,400,'new registration requires a real email address');

    const blocked=await request('/api/auth/player/login','POST',credentials);
    assert.equal(blocked.status,403);
    assert.equal(blocked.data.code,'EMAIL_NOT_VERIFIED');

    const lines=fs.readFileSync(outbox,'utf8').trim().split(/\r?\n/);
    assert.equal(lines.length,1);
    const message=JSON.parse(lines[0]);
    assert.equal(message.to,credentials.email);
    const verifyUrl=new URL(message.verifyUrl);
    const verified=await request(verifyUrl.pathname+verifyUrl.search);
    assert.equal(verified.status,302);
    assert.equal(verified.headers.location,'/join.html?verified=1');

    const loggedIn=await request('/api/auth/player/login','POST',credentials);
    assert.equal(loggedIn.status,200);
    assert.ok(loggedIn.data.token);
    assert.equal(loggedIn.data.player.emailVerified,true);

    const replay=await request(verifyUrl.pathname+verifyUrl.search);
    assert.equal(replay.status,302);
    assert.equal(replay.headers.location,'/join.html?verify=invalid');

    const pending={email:'pending@example.com',password:'test-password',name:'PENDING'};
    await request('/api/auth/player/register','POST',pending);
    await stopServer(server);
    server=await startServer('0');
    const pendingLogin=await request('/api/auth/player/login','POST',pending);
    assert.equal(pendingLogin.status,200);
    assert.equal(pendingLogin.data.player.emailVerified,false);
    assert.equal((await join(pendingLogin.data.token)).type,'join:success');
    const legacy=await request('/api/auth/player/register','POST',{email:'legacy_hero',password:'test-password'});
    assert.equal(legacy.status,201);
    await stopServer(server);
    // Exercise pre-verification-schema legacy semantics as well.
    const authFile=path.join(tempDir,'auth-store.json');
    const db=JSON.parse(fs.readFileSync(authFile,'utf8'));
    delete db.players.legacy_hero.verificationRequired;
    delete db.players.legacy_hero.emailVerifiedAt;
    fs.writeFileSync(authFile,JSON.stringify(db));
    server=await startServer('1');
    const rejected=await join(pendingLogin.data.token);
    assert.equal(rejected.type,'auth:required');
    assert.equal(rejected.code,'EMAIL_NOT_VERIFIED');
    const sessions=JSON.parse(fs.readFileSync(path.join(tempDir,'.player-auth-sessions.json'),'utf8')).sessions;
    const key=crypto.createHash('sha256').update(pendingLogin.data.token).digest('hex');
    assert.equal(sessions[key],undefined,'rejected session removed from disk');
    assert.equal((await join(loggedIn.data.token)).type,'join:success');
    assert.equal((await join(legacy.data.token)).type,'join:success');
    await stopServer(server);
    server=await startServer('1');
    assert.equal((await join(pendingLogin.data.token)).type,'auth:required');

    console.log('PASS player email verification: create -> blocked -> email link -> login');
  }finally{
    await stopServer(server);
    fs.rmSync(tempDir,{recursive:true,force:true});
  }
})().catch(err=>{console.error(err);process.exitCode=1});
