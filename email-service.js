const fs=require('fs');
const path=require('path');

const PROVIDER=String(process.env.ASOC_EMAIL_PROVIDER||'').trim().toLowerCase()||(process.env.ASOC_POSTMARK_SERVER_TOKEN?'postmark':process.env.ASOC_RESEND_API_KEY?'resend':'none');
const FROM=String(process.env.ASOC_EMAIL_FROM||'').trim();
const RESEND_API_KEY=String(process.env.ASOC_RESEND_API_KEY||'').trim();
const POSTMARK_SERVER_TOKEN=String(process.env.ASOC_POSTMARK_SERVER_TOKEN||'').trim();
const TEST_OUTBOX=String(process.env.ASOC_EMAIL_TEST_OUTBOX||'').trim();

function escapeHtml(value){
  return String(value||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function isConfigured(){
  if(PROVIDER==='test')return Boolean(TEST_OUTBOX);
  if(PROVIDER==='resend')return Boolean(RESEND_API_KEY&&FROM);
  if(PROVIDER==='postmark')return Boolean(POSTMARK_SERVER_TOKEN&&FROM);
  return false;
}

function verificationEmailHtml(name,verifyUrl){
  const hero=escapeHtml(name||'Little Hero');
  const url=escapeHtml(verifyUrl);
  return [
    '<div style="font-family:Arial,sans-serif;background:#09090d;color:#e8e8ef;padding:32px">',
    '<div style="max-width:620px;margin:auto;border:1px solid #5d2b75;padding:28px;background:#111118">',
    '<div style="font-size:12px;letter-spacing:2px;color:#a86bc3">ASOC // IDENTITY CONTROL</div>',
    '<h1 style="font-size:24px;margin:14px 0">Verify your Little Hero identity</h1>',
    '<p>'+hero+', your account exists but remains locked until this email address is confirmed.</p>',
    '<p style="margin:28px 0"><a href="'+url+'" style="display:inline-block;padding:14px 20px;background:#4b165c;color:#fff;text-decoration:none;border:1px solid #a86bc3">VERIFY IDENTITY</a></p>',
    '<p style="font-size:13px;color:#aaa">This link expires automatically. If you did not create an ASOC account, ignore this message.</p>',
    '<p style="font-size:12px;color:#777;word-break:break-all">'+url+'</p>',
    '</div></div>'
  ].join('');
}

async function sendViaResend({to,name,verifyUrl,idempotencyKey}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{
        'content-type':'application/json',
        authorization:'Bearer '+RESEND_API_KEY,
        ...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})
      },
      body:JSON.stringify({
        from:FROM,
        to:[to],
        subject:'ASOC // Verify your Little Hero identity',
        html:verificationEmailHtml(name,verifyUrl)
      }),
      signal:controller.signal
    });
    const raw=await response.text();
    if(!response.ok){
      let detail='';
      try{detail=JSON.parse(raw)?.message||''}catch{}
      throw Error('Email provider rejected verification message'+(detail?': '+detail:''));
    }
    let data={};
    try{data=raw?JSON.parse(raw):{}}catch{}
    return {provider:'resend',id:data.id||null};
  } finally {
    clearTimeout(timer);
  }
}

async function sendViaPostmark({to,name,verifyUrl}) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch('https://api.postmarkapp.com/email',{
      method:'POST',
      headers:{
        'accept':'application/json',
        'content-type':'application/json',
        'X-Postmark-Server-Token':POSTMARK_SERVER_TOKEN
      },
      body:JSON.stringify({
        From:FROM,
        To:to,
        Subject:'ASOC // Verify your Little Hero identity',
        HtmlBody:verificationEmailHtml(name,verifyUrl),
        TextBody:'Verify your ASOC Little Hero identity: '+verifyUrl,
        MessageStream:'outbound',
        Tag:'asoc-email-verification'
      }),
      signal:controller.signal
    });
    const raw=await response.text();
    if(!response.ok){
      let detail='';
      try{detail=JSON.parse(raw)?.Message||JSON.parse(raw)?.ErrorCode||''}catch{}
      throw Error('Email provider rejected verification message'+(detail?': '+detail:''));
    }
    let data={};
    try{data=raw?JSON.parse(raw):{}}catch{}
    return {provider:'postmark',id:data.MessageID||null};
  } finally {
    clearTimeout(timer);
  }
}

function sendViaTest({to,name,verifyUrl}){
  fs.mkdirSync(path.dirname(TEST_OUTBOX),{recursive:true});
  fs.appendFileSync(TEST_OUTBOX,JSON.stringify({to,name,verifyUrl,sentAt:Date.now()})+'\n','utf8');
  return {provider:'test',id:null};
}

async function sendVerificationEmail(payload){
  if(!isConfigured())throw Error('Email verification service is not configured');
  if(PROVIDER==='test')return sendViaTest(payload);
  if(PROVIDER==='resend')return sendViaResend(payload);
  if(PROVIDER==='postmark')return sendViaPostmark(payload);
  throw Error('Unsupported email provider');
}

module.exports={provider:PROVIDER,isConfigured,sendVerificationEmail};
