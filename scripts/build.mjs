import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { generateIcons } from './generate-icons.mjs';

const ROOT = process.cwd();
const DIST = path.resolve(ROOT, 'dist');
const SRC = path.resolve(ROOT, 'src');

async function runBuild() {
  // 1. Ensure icons exist
  generateIcons();

  // 2. Clean dist directory
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // 3. Build UI pages (devtools.html, panel.html, sidepanel.html)
  await build({
    root: ROOT,
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': SRC },
    },
    build: {
      outDir: DIST,
      emptyOutDir: false,
      sourcemap: false,
      rollupOptions: {
        input: {
          devtools: path.resolve(ROOT, 'devtools.html'),
          panel: path.resolve(ROOT, 'panel.html'),
          sidepanel: path.resolve(ROOT, 'sidepanel.html'),
        },
      },
    },
  });

  // 4. Build MV3 Service Worker as a single self-contained ES module
  await build({
    root: ROOT,
    configFile: false,
    publicDir: false,
    resolve: {
      alias: { '@': SRC },
    },
    build: {
      outDir: DIST,
      emptyOutDir: false,
      sourcemap: false,
      lib: {
        entry: path.resolve(SRC, 'background/service-worker.ts'),
        formats: ['es'],
        fileName: () => 'service-worker.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });

  // 5. Build MAIN world page observer as a self-contained IIFE
  await build({
    root: ROOT,
    configFile: false,
    publicDir: false,
    resolve: {
      alias: { '@': SRC },
    },
    build: {
      outDir: path.resolve(DIST, 'collectors'),
      emptyOutDir: false,
      sourcemap: false,
      lib: {
        entry: path.resolve(SRC, 'collectors/page-observer.ts'),
        name: 'TagCompanionPageObserver',
        formats: ['iife'],
        fileName: () => 'page-observer.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });

  // 6. Build ISOLATED world content bridge as a self-contained IIFE
  await build({
    root: ROOT,
    configFile: false,
    publicDir: false,
    resolve: {
      alias: { '@': SRC },
    },
    build: {
      outDir: path.resolve(DIST, 'collectors'),
      emptyOutDir: false,
      sourcemap: false,
      lib: {
        entry: path.resolve(SRC, 'collectors/content-bridge.ts'),
        name: 'TagCompanionContentBridge',
        formats: ['iife'],
        fileName: () => 'content-bridge.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });

  // 7. Copy manifest.json and icons
  fs.copyFileSync(
    path.resolve(ROOT, 'manifest.json'),
    path.resolve(DIST, 'manifest.json'),
  );
  fs.cpSync(
    path.resolve(ROOT, 'public/icons'),
    path.resolve(DIST, 'icons'),
    { recursive: true },
  );

  console.log('\nBuild completed cleanly -> dist/');
}

runBuild().catch((err) => {
  console.error(err);
  process.exit(1);
});
