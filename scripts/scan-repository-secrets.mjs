#!/usr/bin/env node
// Standalone secret scanner. NOT wired into deploy/CI -- run it by hand:
//   node scripts/scan-repository-secrets.mjs
// Scans every git-tracked file for common secret shapes (API keys, private
// key blocks, cloud credentials, JWT-shaped Access tokens, etc.) and exits
// non-zero if it finds anything, so it's usable as a manual pre-push gate
// without being force-connected to any pipeline.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [
  { name: "Anthropic API key", re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "OpenAI API key", re: /sk-[A-Za-z0-9]{32,}/g },
  { name: "AWS access key ID", re: /AKIA[0-9A-Z]{16}/g },
  { name: "Generic AWS/secret assignment", re: /(?:aws_secret_access_key|secret_access_key)\s*[:=]\s*['"][A-Za-z0-9\/+=]{30,}['"]/gi },
  { name: "Cloudflare API token", re: /\bcf_[A-Za-z0-9_-]{30,}\b/g },
  { name: "PEM private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: "Slack token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: "Google API key", re: /AIza[0-9A-Za-z_-]{35}/g },
  { name: "Generic 'password ='/'secret =' assignment with a literal value", re: /\b(?:password|passwd|secret|api_key|apikey)\s*[:=]\s*['"][^'"\s]{8,}['"]/gi },
  { name: "GitHub token", re: /gh[pousr]_[A-Za-z0-9]{30,}/g },
];

// Paths that legitimately contain lookalike strings (test fixtures, this
// script's own pattern list, lockfiles) and would otherwise be permanent
// false positives.
const EXCLUDE_PATHS = [/^scripts\/scan-repository-secrets\.mjs$/, /(^|\/)package-lock\.json$/, /\.test\.js$/, /^sql\//];

function listTrackedFiles() {
  const out = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

function isBinaryLike(buf) {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function scanFile(path) {
  let buf;
  try {
    buf = readFileSync(path);
  } catch (e) {
    return []; // deleted-but-still-staged, unreadable, etc. -- not this script's problem
  }
  if (isBinaryLike(buf)) return [];
  const text = buf.toString("utf8");
  const lines = text.split("\n");
  const findings = [];
  for (const { name, re } of PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0;
      const match = re.exec(lines[i]);
      if (match) {
        findings.push({ path, line: i + 1, rule: name, snippet: lines[i].trim().slice(0, 120) });
      }
    }
  }
  return findings;
}

function main() {
  const files = listTrackedFiles().filter((f) => !EXCLUDE_PATHS.some((re) => re.test(f)));
  const allFindings = [];
  for (const file of files) {
    allFindings.push(...scanFile(file));
  }

  if (allFindings.length === 0) {
    console.log(`scan-repository-secrets: scanned ${files.length} tracked files, no matches.`);
    process.exit(0);
  }

  console.error(`scan-repository-secrets: ${allFindings.length} possible secret(s) found:\n`);
  for (const f of allFindings) {
    console.error(`  ${f.path}:${f.line}  [${f.rule}]`);
    console.error(`    ${f.snippet}`);
  }
  console.error(`\nIf any of these are false positives, add the path to EXCLUDE_PATHS in this script.`);
  process.exit(1);
}

main();
