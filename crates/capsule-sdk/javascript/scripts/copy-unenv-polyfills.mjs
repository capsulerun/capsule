import { cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const unenvDir = join(dirname(require.resolve('unenv/package.json')), 'dist/runtime');
const outDir = join(__dirname, '../dist/polyfills/unenv-runtime');

cpSync(unenvDir, outDir, { recursive: true });
console.log(`Copied unenv runtime to ${outDir}`);
