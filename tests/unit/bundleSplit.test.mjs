// The vendor chunks, and the two ways splitting goes wrong silently.
//
// The app shipped as one 1,450 kB chunk and Vite warned about it on every
// build. Splitting removes no bytes — it changes when they are paid for: a
// copy change to App.jsx used to invalidate React, Leaflet, Supabase and every
// icon along with it, so a returning visitor re-downloaded ~1.4 MB to see a
// reworded sentence.
//
// BOTH FAILURE MODES HERE WERE REAL, not hypothetical, and neither breaks
// anything visibly:
//
//   1. AN EMPTY CHUNK. Naming only 'react' and 'react-dom' produced a 0.0 kB
//      vendor-react, because the automatic JSX transform imports
//      react/jsx-runtime and the entry imports react-dom/client. Every actual
//      byte of React stayed in the app chunk and the split bought an extra
//      HTTP request for nothing.
//   2. A CHUNK THAT SWALLOWED ANOTHER. Naming react-leaflet in vendor-map
//      pulled React's core INTO vendor-map: the built vendor-react began
//      `import{c,r}from"./vendor-map"` at 1 kB, so a Leaflet version bump
//      would have invalidated React too and the whole point was lost.
//
// Neither shows up in the browser, in a test run, or in the build output
// unless somebody reads the file sizes. Hence this file.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nbundleSplit — the libraries cache separately from the app');

const config = read('../../vite.config.js');
const VENDORS = ['vendor-react', 'vendor-map', 'vendor-supabase', 'vendor-icons'];

it('the four vendor chunks are configured', () => {
  assert.match(config, /manualChunks:/, 'manualChunks is gone — the app is one chunk again');
  for (const v of VENDORS) {
    assert.ok(config.includes(`'${v}'`), `${v} is no longer configured`);
  }
});

it('vendor-react names the JSX runtime and the DOM client entry', () => {
  // Failure mode 1. Mutation: drop either and the chunk goes back to ~0 kB.
  const line = config.match(/'vendor-react': \[([^\]]+)\]/);
  assert.ok(line, 'vendor-react is not an array of module ids');
  for (const id of ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client']) {
    assert.ok(line[1].includes(`'${id}'`), `vendor-react does not name ${id}`);
  }
});

it('vendor-map does not name react-leaflet', () => {
  // Failure mode 2. react-leaflet is a thin React binding; naming it here
  // hoists React into the map chunk.
  const line = config.match(/'vendor-map': \[([^\]]+)\]/);
  assert.ok(line, 'vendor-map is not an array of module ids');
  assert.ok(line[1].includes("'leaflet'"), 'vendor-map no longer names leaflet');
  assert.ok(!line[1].includes('react-leaflet'),
    'react-leaflet is back in vendor-map — this pulls React into the map chunk and '
    + 'a Leaflet bump will invalidate React');
});

const DIR = new URL('../../dist/assets/', import.meta.url);
if (!existsSync(DIR)) {
  console.log('  SKIP  built-output checks — no dist/assets (run npm run build)');
} else {
  const files = readdirSync(DIR).filter(f => f.endsWith('.js'));
  const find = (prefix) => files.find(f => f.startsWith(`${prefix}-`));
  const sizeOf = (f) => statSync(new URL(f, DIR)).size;

  it('every vendor chunk was emitted and none of them is empty', () => {
    // Failure mode 1, checked on the artefact rather than the config. A chunk
    // under 5 kB is a request that bought nothing.
    for (const v of VENDORS) {
      const f = find(v);
      assert.ok(f, `${v} was not emitted`);
      const kb = sizeOf(f) / 1024;
      assert.ok(kb > 5, `${v} is ${kb.toFixed(1)} kB — an empty chunk costs a request and saves nothing`);
    }
  });

  it('React is in vendor-react and Leaflet is in vendor-map, not the other way round', () => {
    const reactChunk = read(`../../dist/assets/${find('vendor-react')}`);
    const mapChunk = read(`../../dist/assets/${find('vendor-map')}`);
    // React ships a license banner in its minified builds — a reliable marker
    // that the actual library, not a re-export stub, is in this file.
    assert.match(reactChunk, /@license React/, 'vendor-react does not contain React itself');
    assert.ok(sizeOf(find('vendor-react')) / 1024 > 100,
      `vendor-react is ${(sizeOf(find('vendor-react')) / 1024).toFixed(1)} kB — too small to hold react-dom`);
    assert.ok(!/@license React/.test(mapChunk),
      'React ended up inside vendor-map — check what names react-leaflet');
    assert.match(mapChunk, /leaflet/i, 'vendor-map does not contain Leaflet');
  });

  it('vendor-react does not depend on another vendor chunk for React itself', () => {
    // Failure mode 2's signature was `import{c,r}from"./vendor-map"` at the top
    // of a 1 kB vendor-react. A small interop helper crossing chunks is normal
    // and fine; React's own exports coming from elsewhere is not.
    const reactChunk = read(`../../dist/assets/${find('vendor-react')}`);
    assert.ok(!/^import[^;]*from"\.\/vendor-map/.test(reactChunk),
      'vendor-react imports from vendor-map — React is in the wrong chunk');
  });

  it('the app chunk is meaningfully smaller than the single bundle was', () => {
    // It was 1,421.9 kB with everything in it. This is a regression guard, not
    // a target: if it creeps back past 1,100 kB the split has stopped working.
    const app = find('index');
    assert.ok(app, 'no index chunk was emitted');
    const kb = sizeOf(app) / 1024;
    assert.ok(kb < 1100,
      `the app chunk is ${kb.toFixed(1)} kB — the vendor split has stopped taking effect`);
  });

  it('the route-split screens are still their own chunks', () => {
    // These predate this change and must not have been swept into a vendor
    // chunk, which would undo their lazy loading.
    for (const name of ['CoverageGlobe', 'CorporateScreen']) {
      assert.ok(find(name), `${name} is no longer code-split`);
    }
  });
}

console.log(`\n  ${passed} checks passed\n`);
