#!/usr/bin/env node
// Standalone check for whether the deployed Worker has the secrets it
// needs configured in Cloudflare. NOT wired into deploy/CI -- run it by
// hand, after logging in with `wrangler login`:
//   node scripts/check-cloudflare-secrets.mjs --name <worker-name>
//
// Since a real Cloudflare-authenticated session isn't available in every
// environment (e.g. this one), it can also be exercised against a
// simulated `wrangler secret list` response, without calling wrangler:
//   node scripts/check-cloudflare-secrets.mjs --simulate path/to/fixture.json
//
// This script only ever sees and prints secret *names* -- `wrangler secret
// list` itself never returns secret values (Cloudflare doesn't let you
// read a secret back), so there is nothing to redact; it is safe by
// construction, not by discipline. It never shells out to anything other
// than `wrangler secret list`.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REQUIRED = ["ACCESS_ROLES_JSON", "CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD", "ANTHROPIC_API_KEY"];
const OPTIONAL = ["ACCESS_TECH_NAMES_JSON"];

function parseArgs(argv) {
  const args = { name: null, simulate: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--name") args.name = argv[++i];
    else if (argv[i] === "--simulate") args.simulate = argv[++i];
  }
  return args;
}

// Returns an array of secret name strings. Never returns or logs values --
// `wrangler secret list` doesn't expose them in the first place.
function listSecretNames({ name, simulate }) {
  let raw;
  if (simulate) {
    raw = simulate === "-" ? readFileSync(0, "utf8") : readFileSync(simulate, "utf8");
  } else {
    if (!name) {
      throw new Error("Missing --name <worker-name> (or use --simulate <fixture.json> to test without Cloudflare access)");
    }
    raw = execFileSync("wrangler", ["secret", "list", "--name", name], { encoding: "utf8" });
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error("Could not parse secret list as JSON: " + e.message);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Expected a JSON array from `wrangler secret list`, got: " + typeof parsed);
  }
  return parsed.map((entry) => entry && entry.name).filter((n) => typeof n === "string");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let names;
  try {
    names = listSecretNames(args);
  } catch (e) {
    console.error("check-cloudflare-secrets: " + e.message);
    process.exit(1);
  }

  const present = new Set(names);
  const missingRequired = REQUIRED.filter((n) => !present.has(n));
  const missingOptional = OPTIONAL.filter((n) => !present.has(n));

  if (missingOptional.length > 0) {
    console.log(`check-cloudflare-secrets: optional secret(s) not set (ok): ${missingOptional.join(", ")}`);
  }

  if (missingRequired.length > 0) {
    console.error(`check-cloudflare-secrets: missing required secret(s): ${missingRequired.join(", ")}`);
    process.exit(1);
  }

  console.log(`check-cloudflare-secrets: all ${REQUIRED.length} required secrets are set.`);
  process.exit(0);
}

main();
