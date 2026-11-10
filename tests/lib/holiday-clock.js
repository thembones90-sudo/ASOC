// Test-only fake wall clock for a child ASOC server. Never loaded by production.
if(process.env.NODE_ENV!=='test'||!process.env.ASOC_HOLIDAY_CLOCK_FILE)throw Error('Test clock requires an isolated test server');
const fs=require('fs');const NativeDate=Date;const read=()=>Number(fs.readFileSync(process.env.ASOC_HOLIDAY_CLOCK_FILE,'utf8'));
global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[read()]));}static now(){return read();}};
