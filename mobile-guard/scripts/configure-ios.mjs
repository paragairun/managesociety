/**
 * Post-processing for a generated iOS project.
 *
 * `npx cap add ios` and `npx cap sync ios` copy capacitor.config.ts into
 * <app>/ios/App/App/capacitor.config.json. That copy carries the Android
 * utm_source, because one config file serves both platforms. This
 * rewrites just that parameter so analytics can tell an iPhone from an
 * Android phone, and leaves everything else exactly as Capacitor wrote
 * it.
 *
 * One copy at the repo root rather than one inside each app: the resident
 * and guard shells need identical treatment, and two files that must stay
 * in step is how they stop being in step.
 *
 * Run after `cap sync ios`, from the repo root, naming the app directory:
 *     node scripts/configure-ios.mjs mobile-resident
 *     node scripts/configure-ios.mjs mobile-guard
 *
 * Written to be safe to run twice, and to fail loudly rather than write
 * a broken config: the generated file is an input of unknown shape as
 * far as this script is concerned, so every assumption about it is
 * checked before anything is written.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const IOS_UTM = "ios_app";
const APP_DIR = process.argv[2];

function fail(message) {
  console.error(`configure-ios: ${message}`);
  process.exit(1);
}

if (!APP_DIR) {
  fail("name the app directory, e.g. node scripts/configure-ios.mjs mobile-guard");
}

const CONFIG = resolve(APP_DIR, "ios/App/App/capacitor.config.json");

if (!existsSync(CONFIG)) {
  fail(
    `${CONFIG} not found. Run "npx cap add ios" (first time) or ` +
    `"npx cap sync ios" before this script.`,
  );
}

let raw;
try {
  raw = readFileSync(CONFIG, "utf8");
} catch (err) {
  fail(`could not read ${CONFIG}: ${err.message}`);
}

let config;
try {
  config = JSON.parse(raw);
} catch (err) {
  fail(`${CONFIG} is not valid JSON: ${err.message}`);
}

if (!config || typeof config !== "object" || Array.isArray(config)) {
  fail("expected the generated config to be a JSON object.");
}
if (!config.server || typeof config.server.url !== "string") {
  fail("expected server.url in the generated config; Capacitor's output has changed shape.");
}

let url;
try {
  url = new URL(config.server.url);
} catch {
  fail(`server.url is not a valid URL: ${config.server.url}`);
}

const before = url.searchParams.get("utm_source");
if (before === IOS_UTM) {
  console.log(`configure-ios: already set (utm_source=${IOS_UTM}), nothing to do.`);
  process.exit(0);
}

url.searchParams.set("utm_source", IOS_UTM);
config.server.url = url.toString();

try {
  writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);
} catch (err) {
  fail(`could not write ${CONFIG}: ${err.message}`);
}

console.log(`configure-ios: utm_source ${before ?? "(absent)"} -> ${IOS_UTM}`);
console.log(`configure-ios: server.url is now ${config.server.url}`);
