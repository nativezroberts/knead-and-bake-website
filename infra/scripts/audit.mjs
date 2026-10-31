#!/usr/bin/env node
/**
 * CI dependency audit for infra/ — same bar as `npm audit --omit=dev --audit-level=moderate`,
 * except for advisories listed in ALLOWLIST. Each entry must say why it is safe and when to remove it.
 * An allowlisted advisory only skips that exact advisory; any other finding still fails the build.
 */
import { execSync } from 'node:child_process';

const ALLOWLIST = {
  // minimatch bundled inside aws-cdk-lib (latest 2.275.0 still bundles <11.0.1; no fix available).
  // Build-time only: runs during `cdk synth` on the CI runner with our own glob patterns,
  // never shipped to Lambda. Remove once aws-cdk-lib bundles minimatch >= 11.0.1.
  'GHSA-g3hv-75wg-m249': 'minimatch in aws-cdk-lib (build-time only)',
};

const BLOCKING = new Set(['moderate', 'high', 'critical']);

let raw;
try {
  raw = execSync('npm audit --omit=dev --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
} catch (err) {
  raw = err.stdout; // npm audit exits non-zero when it finds anything
}

let report;
try {
  report = JSON.parse(raw);
} catch {
  console.error('Could not parse npm audit output.');
  process.exit(1);
}

// Fail closed: a registry/network error still prints JSON (with "error" and no
// "vulnerabilities"), which must not be mistaken for a clean report.
if (report.error || !report.vulnerabilities || typeof report.metadata?.vulnerabilities !== 'object') {
  console.error('npm audit did not return a complete report:', report.error?.summary || report.error?.code || 'missing vulnerabilities data');
  process.exit(1);
}

const failures = [];
const allowed = new Set();
for (const [pkg, vuln] of Object.entries(report.vulnerabilities)) {
  for (const via of vuln.via || []) {
    if (typeof via !== 'object') continue; // transitive pointer; its root advisory is checked on its own entry
    if (!BLOCKING.has(via.severity)) continue;
    const id = String(via.url || '').split('/').pop();
    if (ALLOWLIST[id]) allowed.add(`${id} (${ALLOWLIST[id]})`);
    else failures.push(`${pkg}: ${via.severity} ${via.title} ${via.url}`);
  }
}

for (const a of allowed) console.log(`Allowlisted: ${a}`);
if (failures.length) {
  console.error(`Blocking vulnerabilities:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('Infra audit passed.');
