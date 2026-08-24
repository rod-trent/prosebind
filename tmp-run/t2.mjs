import { readFile } from 'node:fs/promises';
import { Project, LineIndex } from '../packages/core/dist/index.js';
import { findManuscripts } from '../packages/daemon/dist/index.js';
import { GrokModel, Analyzer, TIER2_LENSES } from '../packages/analyze/dist/index.js';

const root = 'examples/the-quarry';
const project = await Project.open(root);
for (const p of await findManuscripts(root)) project.setDocument(p, await readFile(p, 'utf8'));

const announced = [];
const analyzer = new Analyzer({
  model: new GrokModel({ timeoutMs: 180000 }),
  lenses: TIER2_LENSES,
  policy: { cloudAllowed: true, onCloudCall: (m, bytes) => announced.push(bytes) },
  onError: (s, l, e) => console.log(`  ! ${l}: ${e.message.slice(0, 90)}`),
});

let kept = 0, dropped = 0;
const t0 = Date.now();
for (const path of project.files) {
  const doc = project.document(path);
  const idx = new LineIndex(doc.text);
  for (const scene of doc.segments.filter(s => s.kind === 'scene')) {
    for (const rec of await analyzer.analyzeAll(doc, scene, project.graph)) {
      kept += rec.diagnostics.length; dropped += rec.dropped;
      for (const d of rec.diagnostics) {
        console.log(`${path.split(/[\/]/).pop()}:${idx.positionAt(d.span.start).line + 1} [${d.check}] ${d.confidence.toFixed(2)}`);
        console.log(`   ${d.message}`);
        if (d.detail) console.log(`   why: ${d.detail}`);
        console.log(`   at: ${JSON.stringify(doc.text.slice(d.span.start, d.span.end).slice(0, 80))}`);
      }
      if (rec.dropped) console.log(`   (${rec.dropped} dropped by the anchor gate — ${rec.lens})`);
    }
  }
}
console.log(`\nkept ${kept}, dropped ${dropped} | ${((Date.now()-t0)/1000).toFixed(0)}s | ${announced.length} cloud calls, ${announced.reduce((a,b)=>a+b,0)} bytes sent`);
