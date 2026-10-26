#!/usr/bin/env node
/**
 * Dependency audit with a documented exception list.
 *
 *   npm run audit
 *
 * Fails on any high/critical advisory that is not covered by
 * security/audit-exceptions.json, and on any expired exception.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const exceptionsPath = "security/audit-exceptions.json";
const registry = JSON.parse(fs.readFileSync(exceptionsPath, "utf8"));
const exceptions = new Map(registry.exceptions.map((entry) => [entry.package, entry]));
const today = new Date().toISOString().slice(0, 10);

const npmCli = process.env.npm_execpath;
const result = npmCli
  ? spawnSync(process.execPath, [npmCli, "audit", "--json"], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    })
  : spawnSync("npm", ["audit", "--json"], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      shell: true,
    });

const raw = String(result.stdout ?? "");

let report;
try {
  report = JSON.parse(raw.replace(/^\uFEFF/, ""));
} catch {
  console.error("Could not parse npm audit output.");
  process.exit(2);
}

const vulnerabilities = report.vulnerabilities ?? {};
const findings = Object.entries(vulnerabilities).map(([name, value]) => ({
  name,
  severity: value.severity,
  direct: Boolean(value.isDirect),
  via: (value.via ?? [])
    .map((entry) => (typeof entry === "string" ? entry : entry.url ?? entry.title))
    .filter(Boolean),
}));

if (findings.length === 0) {
  console.log("No known dependency advisories.");
  process.exit(0);
}

const blocking = [];
const accepted = [];
const moderate = [];

for (const finding of findings) {
  const exception = exceptions.get(finding.name);
  const isSevere = finding.severity === "critical" || finding.severity === "high";
  if (isSevere && exception && exception.expires >= today) {
    accepted.push(finding);
  } else if (isSevere) {
    blocking.push(finding);
  } else {
    moderate.push(finding);
  }
}

console.log("Dependency audit");
console.log("");
for (const finding of findings) {
  const status =
    accepted.includes(finding) ? "accepted" : blocking.includes(finding) ? "BLOCKING" : "moderate";
  console.log(
    `  [${status}] ${finding.severity.padEnd(8)} ${finding.name}${finding.direct ? " (direct)" : ""}`,
  );
}

const expired = registry.exceptions.filter((entry) => entry.expires < today);
if (expired.length > 0) {
  console.log("");
  console.error("Expired exceptions:");
  for (const entry of expired) console.error(`  - ${entry.package} (expired ${entry.expires})`);
}

console.log("");
console.log(
  `${accepted.length} accepted, ${blocking.length} blocking, ${moderate.length} moderate, ${expired.length} expired exceptions.`,
);

if (blocking.length > 0 || expired.length > 0) {
  console.error("");
  console.error("Update the dependency or add a documented exception in " + exceptionsPath + ".");
  process.exit(1);
}