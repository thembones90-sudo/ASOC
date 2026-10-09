const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const script=fs.readFileSync('js/tickle.js','utf8');
function check(role){
 const nodes=new Map(), timers=[];
 const make=(tag)=>({tagName:tag,children:[],style:{setProperty(){}},setAttribute(){},addEventListener(){},appendChild(x){this.children.push(x);},append(...xs){this.children.push(...xs);},remove(){nodes.delete(this.id);},set id(v){this._id=v;nodes.set(v,this);},get id(){return this._id;}});
 const doc={createElement:make,getElementById:id=>nodes.get(id),body:{appendChild(el){nodes.set(el.id,el);}}};
 const window={matchMedia:()=>({matches:false})};
 const context={window,document:doc,localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>role==='gm'?'':'p2'},setTimeout:(cb)=>{timers.push(cb);return timers.length;},clearTimeout:()=>{}};
 vm.runInNewContext(script,context);
 const event={type:'tickle:impact',actorId:'shadow-broker',targetId:'p2',actorName:'SHADOW BROKER',targetName:'Little Hero',outcome:'happy'};
 window.AsocTickle.onMessage(event,role==='gm'?null:role==='victim'?'p2':'p4',role==='gm');
 let layer=nodes.get('asoc-tickle-layer');
 assert(layer);
 assert(layer.className.includes(role==='gm'?'is-attacker':'is-'+role));
 const first=layer;
 window.AsocTickle.onMessage({...event,revenge:true},role==='gm'?null:role==='victim'?'p2':'p4',role==='gm');
 assert(nodes.get('asoc-tickle-layer')!==first);
 window.AsocTickle.clear();
 assert(!nodes.get('asoc-tickle-layer'));
}
check('gm');check('victim');check('observer');
console.log('TICKLE_UI_TEST_PASS roles=gm,victim,observer replacement=pass cleanup=pass');