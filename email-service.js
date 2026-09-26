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

// One ASOC-styled email shell for every identity-control message.
function identityEmailHtml({heading,lead,buttonLabel,url,footnote}){
  const link=escapeHtml(url);
  return [
    '<div style="font-family:Arial,sans-serif;background:#09090d;color:#e8e8ef;padding:32px">',
    '<div style="max-width:620px;margin:auto;border:1px solid #5d2b75;padding:28px;background:#111118">',
    '<div style="font-size:12px;letter-spacing:2px;color:#a86bc3">ASOC // IDENTITY CONTROL</div>',
    '<h1 style="font-size:24px;margin:14px 0">'+escapeHtml(heading)+'</h1>',
    '<p>'+lead+'</p>',
    '<p style="margin:28px 0"><a href="'+link+'" style="display:inline-block;padding:14px 20px;background:#4b165c;color:#fff;text-decoration:none;border:1px solid #a86bc3">'+escapeHtml(buttonLabel)+'</a></p>',
    '<p style="font-size:13px;color:#aaa">'+escapeHtml(footnote)+'</p>',
    '<p style="font-size:12px;color:#777;word-break:break-all">'+link+'</p>',
    '</div></div>'
  ].join('');
}

function verificationMessage({name,verifyUrl}){
  const hero=escapeHtml(name||'Little Hero');
  return {
    subject:'ASOC // Verify your Little Hero identity',
    html:identityEmailHtml({
      heading:'Verify your Little Hero identity',
      lead:hero+', your account exists but remains locked until this email address is confirmed.',
      buttonLabel:'VERIFY IDENTITY',
      url:verifyUrl,
      footnote:'This link expires automatically. If you did not create an ASOC account, ignore this message.'
    }),
    text:'Verify your ASOC Little Hero identity: '+verifyUrl,
    tag:'asoc-email-verification'
  };
}

function resetMessage({name,resetUrl,ttlMinutes}){
  const hero=escapeHtml(name||'Little Hero');
  const minutes=ttlMinutes||30;
  return {
    subject:'ASOC // Reset your Little Hero password',
    html:identityEmailHtml({
      heading:'Reset your Little Hero password',
      lead:hero+', a password reset was requested for this identity. Use the link below to set a new password.',
      buttonLabel:'SET NEW PASSWORD',
      url:resetUrl,
      footnote:'This link works once and expires in '+minutes+' minutes. If you did not request a reset, ignore this message -- your password is unchanged.'
    }),
    text:'Reset your ASOC Little Hero password (expires in '+minutes+' minutes): '+resetUrl,
    tag:'asoc-password-reset'
  };
}

async function sendViaResend({to,idempotencyKey},{subject,html}){
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
      body:JSON.stringify({from:FROM,to:[to],subject,html}),
      signal:controller.signal
    });
    const raw=await response.text();
    if(!response.ok){
      let detail='';
      try{detail=JSON.parse(raw)?.message||''}catch{}
      throw Error('Email provider rejected the message'+(detail?': '+detail:''));
    }
    let data={};
    try{data=raw?JSON.parse(raw):{}}catch{}
    return {provider:'resend',id:data.id||null};
  } finally {
    clearTimeout(timer);
  }
}

async function sendViaPostmark({to},{subject,html,text,tag}) {
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
      body:JSON.stringify({From:FROM,To:to,Subject:subject,HtmlBody:html,TextBody:text,MessageStream:'outbound',Tag:tag}),
      signal:controller.signal
    });
    const raw=await response.text();
    if(!response.ok){
      let detail='';
      try{detail=JSON.parse(raw)?.Message||JSON.parse(raw)?.ErrorCode||''}catch{}
      throw Error('Email provider rejected the message'+(detail?': '+detail:''));
    }
    let data={};
    try{data=raw?JSON.parse(raw):{}}catch{}
    return {provider:'postmark',id:data.MessageID||null};
  } finally {
    clearTimeout(timer);
  }
}

function sendViaTest(record){
  fs.mkdirSync(path.dirname(TEST_OUTBOX),{recursive:true});
  fs.appendFileSync(TEST_OUTBOX,JSON.stringify({...record,sentAt:Date.now()})+'\n','utf8');
  return {provider:'test',id:null};
}

async function deliver(payload,message,testRecord){
  if(!isConfigured())throw Error('Email service is not configured');
  if(PROVIDER==='test')return sendViaTest(testRecord);
  if(PROVIDER==='resend')return sendViaResend(payload,message);
  if(PROVIDER==='postmark')return sendViaPostmark(payload,message);
  throw Error('Unsupported email provider');
}

async function sendVerificationEmail(payload){
  return deliver(payload,verificationMessage(payload),{to:payload.to,name:payload.name,verifyUrl:payload.verifyUrl});
}

async function sendPasswordResetEmail(payload){
  return deliver(payload,resetMessage(payload),{kind:'reset',to:payload.to,name:payload.name,resetUrl:payload.resetUrl});
}

module.exports={provider:PROVIDER,isConfigured,sendVerificationEmail,sendPasswordResetEmail};
