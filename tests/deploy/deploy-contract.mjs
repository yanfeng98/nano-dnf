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
const META_PATTERN = /<meta\s+([^>]*?)\/?>/g;
const REQUIRED_META = [
  { key: "name", value: "description" },
  { key: "property", value: "og:title" },
  { key: "property", value: "og:description" },
  { key: "property", value: "og:url" },
  { key: "property", value: "og:image" },
  { key: "property", value: "og:image:width" },
  { key: "property", value: "og:image:height" },
  { key: "name", value: "twitter:card" },
  { key: "name", value: "twitter:image" }
];

/** Every asset the page asks the browser to load, de-duplicated. */
export function referencedAssets(html) {
  return [...new Set([...String(html).matchAll(REF_PATTERN)].map((match) => match[1]))];
}

/** Meta tags keyed by their identifying attribute, e.g. `og:image` -> url. */
export function metaTags(html) {
  const tags = {};
  for (const match of String(html).matchAll(META_PATTERN)) {
    const attrs = {};
    for (const attr of match[1].matchAll(/([a-zA-Z:-]+)\s*=\s*"([^"]*)"/g)) {
      attrs[attr[1]] = attr[2];
    }
    const key = attrs.property || attrs.name;
    if (key) tags[key] = attrs.content || "";
  }
  return tags;
}

/** Share-preview problems in a published page: missing tags, relative image. */
export function shareCardProblems(html) {
  const tags = metaTags(html);
  const problems = [];
  REQUIRED_META.forEach(({ key, value }) => {
    if (!tags[value]) problems.push(`the page is missing the ${value} meta tag`);
  });
  if (tags["twitter:card"] && tags["twitter:card"] !== "summary_large_image") {
    problems.push(`twitter:card should be summary_large_image, got ${tags["twitter:card"]}`);
  }
  ["og:image", "twitter:image", "og:url"].forEach((key) => {
    const value = tags[key];
    if (value && !/^https?:\/\//.test(value)) {
      problems.push(`${key} must be an absolute URL for crawlers, got ${value}`);
    }
  });
  /* The declared size has to match what the card actually is. */
  const width = Number(tags["og:image:width"]);
  const height = Number(tags["og:image:height"]);
  return { tags, problems, width, height };
}

/**
 * Where the preview card lives inside the published site.
 *
 * The image URL is absolute, so it is resolved against `og:url` to get a path
 * relative to the site root - the site is served from a sub-path, so a naive
 * strip of the host would leave `nano-dnf/` in the result.
 */
export function shareCardPath(html) {
  const tags = metaTags(html);
  if (!tags["og:image"]) return null;
  try {
    const image = new URL(tags["og:image"]);
    let base = tags["og:url"] ? new URL(tags["og:url"]).pathname : "/";
    if (!base.endsWith("/")) base += "/";
    return image.pathname.startsWith(base)
      ? image.pathname.slice(base.length)
      : image.pathname.replace(/^\//, "");
  } catch (error) {
    return null;
  }
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
export async function fetchBody(target, { attempts = 3, backoffMs = 2000 } = {}) {
  let last = { status: 0, body: Buffer.alloc(0), error: "not attempted" };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(target, { redirect: "follow" });
      return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
    } catch (error) {
      last = { status: 0, body: Buffer.alloc(0), error: String(error) };
      if (attempt < attempts && backoffMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, attempt * backoffMs));
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

  /* The share card has to exist and match the size the tags promise. */
  const share = shareCardProblems(index.body.toString("utf8"));
  problems.push(...share.problems);
  if (share.tags["og:image"]) {
    const card = await fetchBody(share.tags["og:image"]);
    if (card.status !== 200) {
      problems.push(`the share card returned HTTP ${card.status} (${share.tags["og:image"]})`);
    } else {
      /* PNG magic plus the IHDR size, without pulling in an image library. */
      const isPng = card.body.subarray(1, 4).toString("ascii") === "PNG";
      if (!isPng) {
        problems.push("the share card is not a PNG");
      } else {
        const cardWidth = card.body.readUInt32BE(16);
        const cardHeight = card.body.readUInt32BE(20);
        if (cardWidth !== share.width || cardHeight !== share.height) {
          problems.push(
            `the share card is ${cardWidth}x${cardHeight} but the tags promise ${share.width}x${share.height}`
          );
        }
      }
    }
  }

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
