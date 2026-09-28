'use strict';

const MINIMUM_BET = 0.1;
const MAX_BET = 100000;
const PHASES = new Set(['TABLE_OPEN','BETTING_OPEN','LOCKED','SPINNING','RESULT','CARNAGE','ABORTED']);
const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

function cleanCoins(value) { return Math.round(Number(value) * 10) / 10; }
function newRound(id, now = Date.now()) {
  return { id:String(id), phase:'TABLE_OPEN', createdAt:now, joined:{}, wagers:[], winningNumber:null, spinToken:null, revealAt:null, settled:false, settledAt:null, carnage:null };
}
function createTable(id, roundId, minimumBet = MINIMUM_BET, now = Date.now()) {
  const min = cleanCoins(minimumBet);
  return { id:String(id), open:true, minimumBet:Number.isFinite(min)&&min>0?min:MINIMUM_BET, round:newRound(roundId,now), history:[] };
}
function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || raw.open !== true) return null;
  const roundRaw=raw.round&&typeof raw.round==='object'?raw.round:{};
  const round={
    id:String(roundRaw.id||''), phase:PHASES.has(roundRaw.phase)?roundRaw.phase:'TABLE_OPEN', createdAt:Number(roundRaw.createdAt)||Date.now(),
    joined:roundRaw.joined&&typeof roundRaw.joined==='object'?roundRaw.joined:{}, wagers:Array.isArray(roundRaw.wagers)?roundRaw.wagers:[],
    winningNumber:Number.isInteger(roundRaw.winningNumber)&&roundRaw.winningNumber>=0&&roundRaw.winningNumber<=36?roundRaw.winningNumber:null,
    spinToken:roundRaw.spinToken?String(roundRaw.spinToken):null,revealAt:Number(roundRaw.revealAt)||null,settled:roundRaw.settled===true,settledAt:Number(roundRaw.settledAt)||null,
    carnage:roundRaw.carnage&&typeof roundRaw.carnage==='object'?roundRaw.carnage:null
  };
  return {id:String(raw.id||''),open:true,minimumBet:Math.max(MINIMUM_BET,cleanCoins(raw.minimumBet||MINIMUM_BET)),round,history:Array.isArray(raw.history)?raw.history.slice(-20):[]};
}
function validateBet(input, minimumBet = MINIMUM_BET) {
  const rawAmount=Number(input?.amount),amount=cleanCoins(rawAmount),type=String(input?.type||'').toUpperCase(),value=input?.value;
  if (!Number.isFinite(rawAmount)||Math.abs(rawAmount*10-Math.round(rawAmount*10))>1e-9) return {error:'WAGERS USE TENTHS OF A SHADOW COIN'};
  if (!Number.isFinite(amount)||amount<minimumBet||amount>MAX_BET) return {error:`MINIMUM WAGER IS ${minimumBet} SC`};
  if (type==='STRAIGHT') { const number=Number(value); if(!Number.isInteger(number)||number<0||number>36)return{error:'CHOOSE A NUMBER FROM 0 TO 36'}; return{type, value:number, amount}; }
  if (['RED','BLACK','ODD','EVEN','LOW','HIGH'].includes(type)) return {type,value:null,amount};
  return {error:'UNKNOWN ROULETTE BET'};
}
function betLabel(bet){return bet.type==='STRAIGHT'?`NUMBER ${bet.value}`:bet.type==='LOW'?'1–18':bet.type==='HIGH'?'19–36':bet.type;}
function resolveBet(bet, number) {
  let won=false,odds=1;
  if(bet.type==='STRAIGHT'){won=Number(bet.value)===number;odds=35;}
  else if(number!==0){
    if(bet.type==='RED')won=RED.has(number);
    if(bet.type==='BLACK')won=!RED.has(number);
    if(bet.type==='ODD')won=number%2===1;
    if(bet.type==='EVEN')won=number%2===0;
    if(bet.type==='LOW')won=number>=1&&number<=18;
    if(bet.type==='HIGH')won=number>=19&&number<=36;
  }
  const gross=won?cleanCoins(bet.amount*(odds+1)):0;
  return {won,odds,gross,label:betLabel(bet)};
}
function isZeroImmune(wagers,playerId,number){return number===0&&wagers.some(w=>String(w.playerId)===String(playerId)&&w.type==='STRAIGHT'&&w.value===0);}
function totals(round){const wagers=round?.wagers||[];return{players:new Set(wagers.map(w=>String(w.playerId))).size,coins:cleanCoins(wagers.reduce((n,w)=>n+Number(w.amount||0),0)),zeroPlayers:new Set(wagers.filter(w=>w.type==='STRAIGHT'&&w.value===0).map(w=>String(w.playerId))).size};}
function view(state,viewerId,isGm,balance=0){
  const normalized=normalizeState(state);if(!normalized)return{open:false,phase:'CLOSED',minimumBet:MINIMUM_BET,balance};
  const round=normalized.round,t=totals(round),joined=Object.values(round.joined||{}),own=round.wagers.filter(w=>String(w.playerId)===String(viewerId));
  const payload={open:true,tableId:normalized.id,roundId:round.id,phase:round.phase,minimumBet:normalized.minimumBet,joinedCount:joined.length,activePlayers:t.players,totalWagered:t.coins,zeroPlayers:t.zeroPlayers,balance,joined:!!round.joined[String(viewerId)],ownWagers:own,ownTotal:cleanCoins(own.reduce((n,w)=>n+Number(w.amount||0),0)),result:['RESULT','CARNAGE'].includes(round.phase)?round.winningNumber:null,revealAt:round.revealAt,carnage:round.carnage};
  if(isGm){payload.players=joined;payload.wagers=round.wagers;delete payload.balance;delete payload.joined;delete payload.ownWagers;delete payload.ownTotal;}
  return payload;
}

module.exports={MINIMUM_BET,MAX_BET,RED,newRound,createTable,normalizeState,validateBet,resolveBet,isZeroImmune,totals,view,cleanCoins,betLabel};
