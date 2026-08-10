import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(repoRoot, "index.html"), "utf8");

function cspContent() {
  const match = html.match(
    /http-equiv="Content-Security-Policy"\s*\n?\s*content="([^"]+)"/u,
  );
  assert.notEqual(match, null, "index.html must declare a CSP meta tag");
  return match[1];
}

test("every inline script hash is listed in the CSP", () => {
  const csp = cspContent();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)];
  assert.ok(scripts.length >= 1, "expected at least one inline script");

  for (const [, body] of scripts) {
    const hash = createHash("sha256").update(body, "utf8").digest("base64");
    assert.ok(
      csp.includes(`'sha256-${hash}'`),
      `inline script hash sha256-${hash} is missing from the CSP meta tag — update index.html after editing the inline script`,
    );
  }
});

test("the CSP keeps the origin locked down", () => {
  const csp = cspContent();
  assert.ok(csp.includes("default-src 'self'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(csp.includes("base-uri 'none'"));
  assert.ok(csp.includes("form-action 'none'"));
  assert.ok(!csp.includes("unsafe-inline"));
  assert.ok(!csp.includes("unsafe-eval"));
});

test("no element uses inline event handlers or inline styles", () => {
  assert.equal(/\son[a-z]+="/u.test(html), false, "inline event handlers violate the CSP");
  assert.equal(/\sstyle="/u.test(html), false, "inline style attributes violate the CSP");
});
