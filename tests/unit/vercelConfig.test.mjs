// vercel.json must contain only keys Vercel's schema knows.
//
// THE OUTAGE THIS EXISTS TO PREVENT. A "_comment_git" key was added to explain
// why a setting was there. vercel.json is JSON, JSON has no comments, and
// Vercel rejects unknown top-level properties outright:
//
//   The `vercel.json` schema validation failed with the following message:
//   should NOT have additional property `_comment_git`
//
// It failed BEFORE the build started, so there was no build log to read — the
// deployment just went red with nothing in it. Production was broken across
// three merges by a change whose entire purpose was to tidy up a cosmetic red
// cross on a branch nobody deploys.
//
// Explanations go in .github/workflows/deploy.yml, or in a file that permits
// comments. Not here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cfg = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));

// Vercel's documented top-level properties. Deliberately a fixed list rather
// than "anything without an underscore": the failure mode is a plausible-
// looking key, and `comment` or `notes` would have failed exactly the same way.
const ALLOWED = new Set([
  'buildCommand', 'cleanUrls', 'crons', 'devCommand', 'framework', 'functions',
  'git', 'headers', 'ignoreCommand', 'images', 'installCommand', 'outputDirectory',
  'public', 'redirects', 'regions', 'rewrites', 'trailingSlash', 'installFlags',
]);

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nvercelConfig — only keys the schema accepts');

it('every top-level key is one Vercel knows', () => {
  const unknown = Object.keys(cfg).filter(k => !ALLOWED.has(k));
  assert.deepEqual(unknown, [],
    `vercel.json has ${unknown.join(', ')} — Vercel rejects the whole file and the deploy dies before the build starts`);
});

it('no comment-shaped keys, however they are spelled', () => {
  const commentish = Object.keys(cfg).filter(k => /^_|comment|note|todo|xxx/i.test(k));
  assert.deepEqual(commentish, [], `JSON has no comments: ${commentish.join(', ')}`);
});

it('gh-pages is still switched off', () => {
  // The setting the broken comment was explaining. It has to survive the fix.
  assert.equal(cfg.git?.deploymentEnabled?.['gh-pages'], false);
});

it('the build still points at the real build', () => {
  assert.equal(cfg.buildCommand, 'npm run build');
  assert.equal(cfg.outputDirectory, 'dist');
});

console.log(`  ${passed} checks passed`);
