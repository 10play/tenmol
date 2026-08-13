#!/usr/bin/env node
// Assemble packages/graph/manifest.json + MANIFEST.md by merging every *.manifest.json sidecar
// written by the feature-graph workflow. Deterministic; safe to re-run.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const GRAPH = dirname(dirname(fileURLToPath(import.meta.url))) // packages/graph
const FEATURES = join(GRAPH, 'features')

function walk(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const sidecars = walk(FEATURES).filter((f) => f.endsWith('.manifest.json'))
const rows = []
const problems = []
for (const f of sidecars) {
  let data
  try {
    data = JSON.parse(readFileSync(f, 'utf8'))
  } catch (e) {
    problems.push(`INVALID JSON: ${relative(GRAPH, f)} — ${e.message}`)
    continue
  }
  const arr = Array.isArray(data) ? data : Array.isArray(data.features) ? data.features : null
  if (!arr) {
    problems.push(`NOT AN ARRAY: ${relative(GRAPH, f)}`)
    continue
  }
  for (const r of arr) {
    if (!r || !r.name || !r.kind) {
      problems.push(`BAD ROW in ${relative(GRAPH, f)}: ${JSON.stringify(r).slice(0, 80)}`)
      continue
    }
    rows.push({
      name: String(r.name),
      kind: String(r.kind || 'feature'),
      category: String(r.category || 'misc'),
      subcategory: String(r.subcategory || ''),
      summary: String(r.summary || ''),
      signature: String(r.signature || ''),
      default: String(r.default ?? ''),
      sourceRefs: Array.isArray(r.sourceRefs) ? r.sourceRefs.map(String) : [],
      parityStatus: String(r.parityStatus || 'unknown'),
      doc: String(r.doc || ''),
      sidecar: relative(GRAPH, f),
    })
  }
}

// De-duplicate on (kind,name); prefer the row with the richer summary.
const byKey = new Map()
for (const r of rows) {
  const k = `${r.kind}::${r.name}`
  const prev = byKey.get(k)
  if (!prev || (r.summary.length > prev.summary.length)) byKey.set(k, r)
}
const merged = [...byKey.values()].sort(
  (a, b) => a.kind.localeCompare(b.kind) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
)

writeFileSync(join(GRAPH, 'manifest.json'), JSON.stringify({
  generated: 'feature-graph workflow',
  counts: countBy(merged, 'kind'),
  total: merged.length,
  features: merged,
}, null, 2) + '\n')

// ---- MANIFEST.md ----
function countBy(list, key) {
  const m = {}
  for (const r of list) m[r.kind === undefined ? 'x' : r[key]] = (m[r[key]] || 0) + 1
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]))
}
const byKind = countBy(merged, 'kind')
const byCat = countBy(merged, 'category')

let md = ''
md += `# PyMOL Feature Manifest\n\n`
md += `Every user-facing feature of PyMOL as reproduced/targeted by **tenmol**, one row each.\n`
md += `Generated from the per-feature deep-dive docs under \`features/\` — do not hand-edit; run\n`
md += `\`node packages/graph/scripts/assemble-manifest.mjs\`. Machine-readable form: \`manifest.json\`.\n\n`
md += `**${merged.length} features.**\n\n`
md += `## By kind\n\n| Kind | Count |\n| --- | --- |\n`
for (const [k, n] of Object.entries(byKind)) md += `| ${k} | ${n} |\n`
md += `\n## By category\n\n| Category | Count |\n| --- | --- |\n`
for (const [c, n] of Object.entries(byCat)) md += `| ${c} | ${n} |\n`
md += `\n`

// Group tables by category, kind order commands first.
const cats = [...new Set(merged.map((r) => r.category))].sort()
for (const cat of cats) {
  const group = merged.filter((r) => r.category === cat)
  md += `## ${cat} (${group.length})\n\n`
  md += `| Feature | Kind | Summary | Parity | Doc |\n| --- | --- | --- | --- | --- |\n`
  for (const r of group) {
    const doc = r.doc ? `[doc](${r.doc.replace(/^packages\/graph\//, '')})` : ''
    const sig = r.signature ? ` \`${r.signature}\`` : ''
    md += `| \`${r.name}\`${sig} | ${r.kind} | ${r.summary.replace(/\|/g, '\\|')} | ${r.parityStatus} | ${doc} |\n`
  }
  md += `\n`
}

if (problems.length) {
  md += `## ⚠ Assembly problems (${problems.length})\n\n`
  for (const p of problems) md += `- ${p}\n`
  md += `\n`
}

writeFileSync(join(GRAPH, 'MANIFEST.md'), md)

console.log(`sidecars: ${sidecars.length}`)
console.log(`rows read: ${rows.length}  merged (deduped): ${merged.length}`)
console.log(`by kind: ${JSON.stringify(byKind)}`)
console.log(`problems: ${problems.length}`)
for (const p of problems) console.log('  ' + p)
