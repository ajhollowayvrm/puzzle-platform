// Bundle the Lambda handler into a single CJS file for SAM to zip.
// @aws-sdk/* is provided by the Node 20 Lambda runtime, so it's left external
// (keeps the artifact tiny). Node built-ins (node:crypto, etc.) stay external too.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/handler.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-lambda/index.js',
  external: ['@aws-sdk/*'],
  legalComments: 'none',
  logLevel: 'info',
});

console.log('bundled → packages/server/dist-lambda/index.js');
