// Сборка файла обновления: npm run build-update  →  dist/oleg-ai-<версия>.oleg
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),ver=JSON.parse(fs.readFileSync(root+'/package.json')).version;
const INC=['server.js','package.json','public','install.sh','update.sh','tools'],files={};
const walk=(p)=>{const a=path.join(root,p);if(fs.statSync(a).isDirectory())fs.readdirSync(a).forEach(f=>walk(path.join(p,f)));else files[p]=crypto.createHash('sha256').update(fs.readFileSync(a)).digest('hex')};
INC.forEach(walk);
const tmp=fs.mkdtempSync('/tmp/oleg-b-');for(const f of Object.keys(files)){fs.mkdirSync(path.dirname(path.join(tmp,'payload',f)),{recursive:true});fs.copyFileSync(path.join(root,f),path.join(tmp,'payload',f))}
fs.writeFileSync(tmp+'/manifest.json',JSON.stringify({app:'oleg-ai',version:ver,notes:process.argv[2]||'',files},null,1));
fs.mkdirSync(root+'/dist',{recursive:true});const out=`${root}/dist/oleg-ai-${ver}.oleg`;
execFileSync('tar',['czf',out,'-C',tmp,'manifest.json','payload']);console.log('Готово:',out);
