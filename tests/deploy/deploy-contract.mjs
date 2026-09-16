/*
 * Pure helpers for the deployed-artifact checks.
 *
 * Deliberately dependency-free: Node's built-in fetch plus the filesystem only.
 * The browser half lives in live-smoke.mjs, because the CI job that runs
 * `npm test` has no node_modules and must still be able to check this contract.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEFAULT_URL = "https://luyf-lemon-love.space/nano-dnf/";
export const DEFAULT_WAIT_SECONDS = 300;
const REF_PATTERN = /(?:src|href)="\.\/([^"]+)"/g;

/** Every asset the page asks the browser to load, de-duplicated. */
export function referencedAssets(html) {
  return [...new Set([...String(html).matchAll(REF_PATTERN)].map((match) => match[1]))];
}

export function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Fetch a URL, retrying network-level failures.
 *
 * A DNS or TLS blip must not fail a deploy check, while a real HTTP status -
 * including 404 - is returned as-is so a broken asset still fails loudly.
 */
export async function fetchBody(target, attempts = 3) {
  let last = { status: 0, body: Buffer.alloc(0), error: "not attempted" };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(target, { redirect: "follow" });
      return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
    } catch (error) {
      last = { status: 0, body: Buffer.alloc(0), error: String(error) };
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
    }
  }
  return last;
}

/** Compare the published bytes with the checkout for one relative path. */
export function checkoutMatches(relPath, published) {
  const local = path.join(ROOT, relPath);
  if (!fs.existsSync(local)) return { checked: false };
  const localHash = sha256(fs.readFileSync(local));
  const publishedHash = sha256(published);
  return {
    checked: true,
    matches: localHash === publishedHash,
    localHash,
    publishedHash,
    summary: `${relPath} (live ${publishedHash.slice(0, 12)} vs checkout ${localHash.slice(0, 12)})`
  };
}

/**
 * Fetch the published page, prove every referenced asset exists, and prove the
 * published bytes still match the checkout.
 */
export async function inspectPublished(baseUrl) {
  const problems = [];
  const index = await fetchBody(baseUrl);
  if (index.status !== 200) {
    return {
      problems: [
        `${baseUrl} returned HTTP ${index.status}${index.error ? ` (${index.error})` : ""}`
      ],
      refs: [],
      lagging: []
    };
  }

  const refs = referencedAssets(index.body.toString("utf8"));
  if (!refs.length) problems.push("the published index.html references no local assets");

  const lagging = [];
  for (const relPath of refs) {
    const asset = await fetchBody(new URL(relPath, baseUrl).toString());
    if (asset.status !== 200) {
      problems.push(`${relPath} returned HTTP ${asset.status} - the deploy is missing a referenced asset`);
      continue;
    }
    const comparison = checkoutMatches(relPath, asset.body);
    if (comparison.checked && !comparison.matches) lagging.push(comparison.summary);
  }

  const indexComparison = checkoutMatches("index.html", index.body);
  if (indexComparison.checked && !indexComparison.matches) lagging.push(indexComparison.summary);

  return { problems, refs, lagging };
}

/** Give CDN propagation a bounded chance before calling a deploy stale. */
export async function waitForPublished(baseUrl, waitSeconds, log) {
  const deadline = Date.now() + waitSeconds * 1000;
  let last = await inspectPublished(baseUrl);
  while (last.lagging.length && Date.now() < deadline) {
    if (log) log(`waiting for the deploy to catch up: ${last.lagging.join(", ")}`);
    await new Promise((resolve) => setTimeout(resolve, 15000));
    last = await inspectPublished(baseUrl);
  }
  return last;
}
