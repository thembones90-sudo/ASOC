'use strict';
// Aggregate-only latency telemetry. No text, identity, token, room code or
// payload is retained. Buckets are bounded and periodically reset.
const MEASURED = new Set(['chat:guess', 'gm:judgeGuess', 'gm:broadcast']);
const buckets = new Map();
const MAX_SAMPLES = 1000;
const REPORT_EVERY = Math.max(10, Number(process.env.ASOC_REALTIME_METRICS_EVERY) || 100);
function isMeasured(type) { return MEASURED.has(String(type || '')); }
function percentile(values, p) { if (!values.length) return 0; const sorted=[...values].sort((a,b)=>a-b); return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]; }
function summary(samples, key) { const v=samples.map(x=>x[key]); return {p50:+percentile(v,.5).toFixed(1),p95:+percentile(v,.95).toFixed(1),p99:+percentile(v,.99).toFixed(1),worst:+Math.max(...v).toFixed(1)}; }
function record(type, sample) {
  if (!isMeasured(type)) return;
  const list=buckets.get(type)||[];list.push(sample);if(list.length>MAX_SAMPLES)list.shift();buckets.set(type,list);
  if (list.length % REPORT_EVERY === 0) {
    console.log('[realtime-performance] '+JSON.stringify({operation:type,samples:list.length,queueMs:summary(list,'queueMs'),validationAndMutationMs:summary(list,'validationAndMutationMs'),batchPreparationMs:summary(list,'batchPreparationMs'),persistenceMs:summary(list,'persistenceMs'),totalServerMs:summary(list,'totalServerMs'),queueToBroadcastMs:summary(list,'queueToBroadcastMs'),frames:summary(list,'frameCount')}));
  }
}
function snapshot(type) { const list=buckets.get(type)||[]; return list.length?{samples:list.length,queueMs:summary(list,'queueMs'),validationAndMutationMs:summary(list,'validationAndMutationMs'),batchPreparationMs:summary(list,'batchPreparationMs'),persistenceMs:summary(list,'persistenceMs'),totalServerMs:summary(list,'totalServerMs'),queueToBroadcastMs:summary(list,'queueToBroadcastMs'),frames:summary(list,'frameCount')}:null; }
module.exports={isMeasured,record,snapshot};
