'use strict';
const LINES = Object.freeze({
  "SUMMON": [
    "@all Assemble, you disappointments. Five soldiers at the gate. Do not make me recruit from the fucking cemetery.",
    "@all The legion marches. I need five functioning brains, but experience tells me to lower my expectations.",
    "@all Report for duty. Whatever you were doing cannot possibly justify being this useless."
  ],
  "START": [
    "The gates are sealed. Become useful before you become casualties.",
    "Advance, you miserable recruits. The enemy is ahead. Try to remember that.",
    "Battle begins. Keep your eyes open and your stupidity under fucking control."
  ],
  "COLUMN": [
    "Position secured. One of you has demonstrated signs of intelligence. Investigation pending.",
    "A successful strike. Hold your applause—you have finally met the minimum requirement.",
    "The flank is ours. Keep moving before that functioning brain cell deserts."
  ],
  "FINAL": [
    "Victory. You have overcome the enemy and my entirely reasonable expectations of failure.",
    "The enemy has fallen. Somehow, this incompetent fucking legion remains standing.",
    "Campaign won. Stand tall. This may be the last competent thing you do all week."
  ],
  "WRONG": [
    "You struck nothing and embarrassed the legion. Aim again, idiot.",
    "Rejected. Your confidence has once again outrun your fucking intelligence.",
    "A wasted strike. The enemy remains unharmed. My patience does not."
  ],
  "REPEATED": [
    "You keep deploying the same stupidity and expecting a different fucking casualty report.",
    "That answer has already died here. Stop dragging its corpse back onto the battlefield.",
    "Repeating a failed assault does not make you persistent. It makes you an idiot with a schedule."
  ],
  "INVALID": [
    "That position does not exist, you illiterate siege ornament.",
    "Read the battlefield before issuing coordinates, you navigational fucking disaster.",
    "No such field. I have seen headless infantry follow a map more successfully."
  ],
  "AMBIGUOUS": [
    "One target, one answer. Even a condemned foot soldier can manage that.",
    "Name your fucking target. I command a legion; I do not interpret panicked mumbling.",
    "Your orders are unclear. Pick one position and try speaking like someone worth commanding."
  ],
  "LOW_TIME": [
    "The line is collapsing. Stop fondling your weapons and fucking strike.",
    "Time is bleeding out. Give me a final answer before I give you a burial detail.",
    "The enemy needs only your hesitation. Stop supplying it so generously."
  ],
  "DEFEAT": [
    "An entire legion of functioning organs, and not one useful brain between you.",
    "The line is broken. Your collective incompetence has achieved what the enemy could only hope for.",
    "Defeat. Remember this battlefield. You paid for every inch of it with fucking stupidity."
  ],
  "CANCEL": [
    "@all Too few answered. I have commanded corpses with better attendance. Campaign dismissed.",
    "@all Five soldiers were required. Apparently even that exceeded your collective fucking capabilities. Stand down.",
    "@all Insufficient ranks. The enemy wins by attendance. What an exquisitely pathetic defeat. Campaign cancelled."
  ],
  "AMUSE": [
    "Dismissed. Go disgrace yourselves somewhere that no longer requires my supervision.",
    "Return to the encampment. You are relieved of the burden of pretending to be soldiers.",
    "Break ranks. Drink, argue, and waste your miserable evening. Command has endured enough."
  ]
});
for (const choices of Object.values(LINES)) Object.freeze(choices);
function normalize(value) {
 const v=value&&typeof value==='object'?value:{};
 return {last:Object.fromEntries(Object.entries(v.last||{}).filter(([k,i])=>LINES[k]&&Number.isInteger(i)&&i>=0&&i<3)),keys:Array.isArray(v.keys)?v.keys.filter(k=>typeof k==='string').slice(-64):[],chatterAt:Number(v.chatterAt)||0};
}
function take(state,event,{key,now=Date.now(),chatter=false,random=n=>Math.floor(Math.random()*n)}={}) {
 if(!LINES[event])throw Error('Unknown SPECTRA voice event');
 const v=state.voice=normalize(state.voice);
 if(key&&v.keys.includes(key))return null;
 if(chatter&&v.chatterAt&&now-v.chatterAt<12000)return null;
 const options=LINES[event].map((_,i)=>i).filter(i=>i!==v.last[event]);
 const index=options[random(options.length)];v.last[event]=index;
 if(key)v.keys=[...v.keys,key].slice(-64);
 if(chatter)v.chatterAt=now;
 return LINES[event][index];
}
module.exports={LINES,normalize,take};
