#!/usr/bin/env node
/**
 * Bump android/app/build.gradle versionCode (+1) and versionName patch (+1).
 *
 * Usage:
 *   node scripts/bump-android-version.mjs
 *   node scripts/bump-android-version.mjs --version-code 30 --version-name 1.0.29
 *   node scripts/bump-android-version.mjs --dry-run
 *
 * Writes GITHUB_OUTPUT keys version_code / version_name when running in Actions.
 */
import fs from "fs";
import path from "path";

const gradlePath = path.join(process.cwd(), "android", "app", "build.gradle");
const args = process.argv.slice(2);

function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const dryRun = args.includes("--dry-run");

if (!fs.existsSync(gradlePath)) {
  console.error(`Missing ${gradlePath}`);
  process.exit(1);
}

const content = fs.readFileSync(gradlePath, "utf8");
const codeMatch = content.match(/versionCode\s+(\d+)/);
const nameMatch = content.match(/versionName\s+"([^"]+)"/);

if (!codeMatch || !nameMatch) {
  console.error("Could not parse versionCode / versionName from android/app/build.gradle");
  process.exit(1);
}

let versionCode = parseInt(codeMatch[1], 10);
let versionName = nameMatch[1];

const setCode = getArg("version-code");
const setName = getArg("version-name");

if (setCode) {
  versionCode = parseInt(setCode, 10);
  if (!Number.isFinite(versionCode) || versionCode < 1) {
    console.error(`Invalid --version-code: ${setCode}`);
    process.exit(1);
  }
} else {
  versionCode += 1;
}

if (setName) {
  versionName = setName;
} else {
  const parts = versionName.split(".");
  if (parts.length >= 1 && /^\d+$/.test(parts[parts.length - 1])) {
    parts[parts.length - 1] = String(parseInt(parts[parts.length - 1], 10) + 1);
    versionName = parts.join(".");
  } else {
    versionName = `${versionName}.1`;
  }
}

const next = content
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`);

if (!dryRun) {
  fs.writeFileSync(gradlePath, next);
  console.log(`Updated ${gradlePath}`);
} else {
  console.log("Dry run — no file write");
}

console.log(`versionCode=${versionCode}`);
console.log(`versionName=${versionName}`);

const out = process.env.GITHUB_OUTPUT;
if (out) {
  fs.appendFileSync(out, `version_code=${versionCode}\nversion_name=${versionName}\n`);
}
