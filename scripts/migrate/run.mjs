/**
 * CLI over the migration engine. Every subcommand is idempotent and reads the
 * repo as truth, so any of them can be run after a crash to resume safely.
 *
 *   node scripts/migrate/run.mjs status   <plan.json>
 *       Show every task's recorded status AND whether its postcondition already
 *       holds in the working tree (the two can differ after a crash — that gap
 *       is exactly what reconcile closes).
 *
 *   node scripts/migrate/run.mjs next     <plan.json>
 *       Print the next actionable task (unverified, deps satisfied, postcondition
 *       not yet met) as JSON, for an agent to perform. Empty => nothing to do.
 *
 *   node scripts/migrate/run.mjs reconcile <plan.json> [taskId]
 *       For each task (or one): if its postcondition now holds, run its verify
 *       gates and record verified/applied; else leave pending. This is the
 *       RESUME + CHECKPOINT + VERIFY step — run it after every agent edit and
 *       after any crash. Never re-applies a change that is already in place.
 *
 *   node scripts/migrate/run.mjs verify   <plan.json> [taskId]
 *       Re-run verify gates for applied-but-unverified tasks (e.g. after the
 *       sandbox recovers enough to run typecheck/build).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  REPO, STATUS, loadState, record, checkPostcondition, runGate, stateAge,
} from './engine.mjs';

const GATE_CMDS = {
  typecheck: ['pnpm', '-s', 'typecheck'],
  build: ['pnpm', '-s', '--filter', '@tenmol/web', 'build'],
  lint: ['node', 'node_modules/eslint/bin/eslint.js', 'apps/web', 'scripts'],
  webtest: ['pnpm', '-s', 'test:ci'],
};

function loadPlan(planPath) {
  const plan = JSON.parse(readFileSync(join(REPO, planPath), 'utf8'));
  if (!plan.name || !Array.isArray(plan.tasks)) throw new Error('plan needs {name, tasks:[]}');
  return plan;
}

/** Topological-ish order: a task waits until its deps are verified. */
function ordered(plan, st) {
  const done = (id) => st.tasks[id]?.status === STATUS.VERIFIED;
  const remaining = [...plan.tasks];
  const out = [];
  let guard = remaining.length * remaining.length + 1;
  while (remaining.length && guard-- > 0) {
    const i = remaining.findIndex((t) => (t.deps ?? []).every((d) => done(d) || out.some((o) => o.id === d)));
    out.push(...remaining.splice(i < 0 ? 0 : i, 1));
  }
  return out.concat(remaining);
}

function depsMet(task, st) {
  return (task.deps ?? []).every((d) => st.tasks[d]?.status === STATUS.VERIFIED);
}

function verifyTask(planName, st, task) {
  const gates = task.verify ?? [];
  const results = [];
  for (const g of gates) {
    if (g === 'postcondition') {
      const pc = checkPostcondition(task.postcondition);
      results.push({ gate: 'postcondition', status: pc.ok ? 'pass' : 'fail', detail: pc.failures.join('; ') });
    } else if (GATE_CMDS[g]) {
      results.push(runGate(g, GATE_CMDS[g]));
    } else {
      results.push({ gate: g, status: 'fail', detail: 'unknown gate' });
    }
  }
  const anyFail = results.some((r) => r.status === 'fail');
  const anyDeferred = results.some((r) => r.status === 'deferred');
  const status = anyFail ? STATUS.FAILED : anyDeferred ? STATUS.APPLIED : STATUS.VERIFIED;
  return record(planName, st, task.id, { status, verify: results, title: task.title });
}

const [sub, planPath, taskId] = process.argv.slice(2);
if (!sub || !planPath) {
  console.error('usage: run.mjs <status|next|reconcile|verify> <plan.json> [taskId]');
  process.exit(2);
}
const plan = loadPlan(planPath);
const st = loadState(plan.name);

if (sub === 'status') {
  const rows = ordered(plan, st).map((t) => {
    const rec = st.tasks[t.id] ?? { status: STATUS.PENDING };
    const pc = checkPostcondition(t.postcondition);
    return { id: t.id, status: rec.status, postconditionMet: pc.ok, deps: depsMet(t, st) };
  });
  const tally = rows.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  console.log(`plan: ${plan.name} — ${plan.tasks.length} tasks — last checkpoint ${Math.round(stateAge(plan.name) / 1000)}s ago`);
  console.log(JSON.stringify(tally));
  for (const r of rows) {
    console.log(`  [${r.status.padEnd(8)}] ${r.id}${r.postconditionMet ? ' ✓done-in-tree' : ''}${r.deps ? '' : ' (deps pending)'}`);
  }
} else if (sub === 'next') {
  const task = ordered(plan, st).find(
    (t) => st.tasks[t.id]?.status !== STATUS.VERIFIED && depsMet(t, st) && !checkPostcondition(t.postcondition).ok,
  );
  console.log(task ? JSON.stringify(task, null, 2) : '');
} else if (sub === 'reconcile') {
  const tasks = ordered(plan, st).filter((t) => !taskId || t.id === taskId);
  for (const t of tasks) {
    if (st.tasks[t.id]?.status === STATUS.VERIFIED) continue;
    const pc = checkPostcondition(t.postcondition);
    if (!pc.ok) {
      if (!depsMet(t, st)) record(plan.name, st, t.id, { status: STATUS.BLOCKED, title: t.title });
      continue; // still pending — needs its change applied
    }
    const rec = verifyTask(plan.name, st, t);
    console.error(`[${rec.status}] ${t.id}${rec.status === STATUS.APPLIED ? ' (verify deferred — env)' : ''}`);
  }
  const st2 = loadState(plan.name);
  const tally = plan.tasks.reduce((m, t) => { const s = st2.tasks[t.id]?.status ?? 'pending'; m[s] = (m[s] ?? 0) + 1; return m; }, {});
  console.error('reconcile done:', JSON.stringify(tally));
} else if (sub === 'verify') {
  const tasks = ordered(plan, st).filter((t) => (!taskId || t.id === taskId) && st.tasks[t.id]?.status === STATUS.APPLIED);
  for (const t of tasks) {
    const rec = verifyTask(plan.name, st, t);
    console.error(`[${rec.status}] ${t.id}`);
  }
} else {
  console.error(`unknown subcommand: ${sub}`);
  process.exit(2);
}
