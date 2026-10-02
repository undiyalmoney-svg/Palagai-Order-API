#!/usr/bin/env node
/**
 * Bundle Charts SMC + ATM (TypeScript, no Angular) into bundle.js.
 * Needs the palagai checkout beside this repo (../palagai) to rebuild.
 */
'use strict';

const path = require('path');
const esbuild = require('esbuild');

const ROOT = __dirname;
const STUBS = {
  'live-chart-data.service': path.join(ROOT, 'stubs/live-chart-data.service.ts'),
  'chart-live-trades': path.join(ROOT, 'stubs/chart-live-trades.ts'),
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
        name: 'charts-protect-stubs',
        setup(api) {
          api.onResolve({ filter: /live-chart-data\.service/ }, () => ({
            path: STUBS['live-chart-data.service'],
          }));
          api.onResolve({ filter: /chart-live-trades(['"]|$)/ }, (args) => {
            if (/atm-order\.util/.test(args.importer)) {
              return { path: STUBS['chart-live-trades'] };
            }
            return undefined;
          });
          api.onResolve({ filter: /paper-desk\.models/ }, () => ({
            path: STUBS['paper-desk.models'],
          }));
          api.onResolve({ filter: /^@angular\// }, () => {
            throw new Error(`Angular leaked into the Protect bundle from ${ROOT}`);
          });
          api.onResolve({ filter: /^rxjs/ }, () => {
            throw new Error(`rxjs leaked into the Protect bundle from ${ROOT}`);
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
