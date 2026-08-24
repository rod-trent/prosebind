import { GrokModel } from '../packages/analyze/dist/index.js';
const model = new GrokModel({ timeoutMs: 120000 });
console.log('available:', await model.available(), '| chosen:', model.id);
const t0 = Date.now();
const r = await model.generate({
  system: 'You reply with JSON only.',
  prompt: 'Return exactly: {"ok": true, "model_family": "<your family name>"}',
  schema: { type: 'object' },
  temperature: 0,
  maxTokens: 200,
});
console.log(`round trip: ${Date.now() - t0}ms`);
console.log('raw:', JSON.stringify(r.text).slice(0, 200));
