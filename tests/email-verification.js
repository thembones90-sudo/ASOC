const assert=require('assert/strict');
const http=require('http');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawn}=require('child_process');

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

function startServer(){
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
        ASOC_EMAIL_VERIFICATION:'1',
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

    console.log('PASS player email verification: create -> blocked -> email link -> login');
  }finally{
    if(server&&!server.killed)server.kill('SIGTERM');
    await new Promise(r=>setTimeout(r,150));
    fs.rmSync(tempDir,{recursive:true,force:true});
  }
})().catch(err=>{console.error(err);process.exitCode=1});
