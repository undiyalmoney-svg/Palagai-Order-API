#!/usr/bin/env node
/**
 * Bundle paper tick (TypeScript, no Angular) into bundle.js.
 * Needs the palagai checkout beside this repo (../palagai) to rebuild.
 */
'use strict';

const path = require('path');
const esbuild = require('esbuild');

const ROOT = __dirname;
const STUBS = {
  'paper-desk.models': path.join(ROOT, 'stubs/paper-desk.models.ts'),
};

async function build() {
  await esbuild.build({
    absWorkingDir: path.join(ROOT, '../../'),
    entryPoints: [path.join(ROOT, 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(ROOT, 'bundle.js'),
    sourcemap: false,
    logLevel: 'info',
    plugins: [
      {
        name: 'paper-live-stubs',
        setup(api) {
          api.onResolve({ filter: /paper-desk\.models/ }, () => ({
            path: STUBS['paper-desk.models'],
          }));
          api.onResolve({ filter: /^@angular\// }, () => {
            throw new Error(`Angular leaked into the Paper Live bundle from ${ROOT}`);
          });
          api.onResolve({ filter: /^rxjs/ }, () => {
            throw new Error(`rxjs leaked into the Paper Live bundle from ${ROOT}`);
          });
        },
      },
    ],
  });
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
