// Package the same Worker module that the Node tests import for the hosted runtime.
import {mkdir, copyFile, writeFile, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
const root = dirname(fileURLToPath(import.meta.url));
for (const dir of ['dist/server','dist/.openai','drizzle/meta']) await mkdir(join(root,dir),{recursive:true});
await copyFile(join(root,'worker.mjs'),join(root,'dist/server/index.js'));
await copyFile(join(root,'.openai/hosting.json'),join(root,'dist/.openai/hosting.json'));
const migration = await readFile(join(root,'schema.sql'),'utf8');
await writeFile(join(root,'drizzle/0000_usage.sql'),migration);
await writeFile(join(root,'drizzle/meta/_journal.json'),JSON.stringify({
  version:'7', dialect:'sqlite', entries:[{idx:0,version:'6',when:1795215600000,tag:'0000_usage',breakpoints:true}]
},null,2)+'\n');
