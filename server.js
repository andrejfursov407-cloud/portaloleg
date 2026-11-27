// Олег AI — сервер без внешних npm-зависимостей (Node >= 22.13)
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import crypto from 'node:crypto';import {DatabaseSync} from 'node:sqlite';import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const ROOT=path.dirname(fileURLToPath(import.meta.url)),DATA=process.env.DATA_DIR||path.join(ROOT,'data'),PORT=+process.env.PORT||3000;
const PUB=path.join(ROOT,'public'),VOICES=path.join(DATA,'voices');
fs.mkdirSync(VOICES,{recursive:true});fs.mkdirSync(path.join(DATA,'backups'),{recursive:true});
const VERSION=()=>JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'))).version;
const db=new DatabaseSync(path.join(DATA,'oleg.db'));
db.exec(`create table if not exists users(id integer primary key,name text unique,pass text,role text,created int);
create table if not exists sessions(token text primary key,uid int,exp int);
create table if not exists settings(k text primary key,v text);
create table if not exists chats(id integer primary key,uid int,title text,created int);
create table if not exists msgs(id integer primary key,chat int,role text,content text)`);
const DEF={ollama:process.env.OLLAMA_URL||'http://127.0.0.1:11434',model:'',voice:'',search:'1',searx:'',signup:'1',
prompt:'Ты — Олег, свой в доску мастер на все руки и умный помощник. Говоришь по-русски (или на языке собеседника), живо и по делу, с лёгким юмором, но без воды. Разбираешься во всех областях: быт, ремонт, код, наука, право, учёба, бизнес. Если нужны свежие данные, факты, новости, цены или ты не уверен — сам вызывай web_search и опирайся на результаты, называя источники. Не выдумывай. Для опасных вещей напоминай про безопасность.'};
const get=k=>db.prepare('select v from settings where k=?').get(k)?.v??DEF[k];
const set=(k,v)=>db.prepare('insert into settings(k,v) values(?,?) on conflict(k) do update set v=excluded.v').run(k,String(v));
const json=(res,c,o)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o))};
const body=(req,max=1e6)=>new Promise((ok,no)=>{const a=[];let n=0;req.on('data',d=>{n+=d.length;if(n>max){no(new Error('Слишком большой файл'));req.destroy()}else a.push(d)});req.on('end',()=>ok(Buffer.concat(a)));req.on('error',no)});
const jb=async req=>JSON.parse((await body(req)).toString()||'{}');
const hash=(p,s=crypto.randomBytes(16).toString('hex'))=>s+':'+crypto.scryptSync(p,s,32).toString('hex');
const check=(p,h)=>{const [s,x]=h.split(':');return crypto.timingSafeEqual(Buffer.from(hash(p,s).split(':')[1]),Buffer.from(x))};
const cookies=r=>Object.fromEntries((r.headers.cookie||'').split(/;\s*/).filter(Boolean).map(c=>c.split('=')));
const user=req=>{const t=cookies(req).sid;if(!t)return null;return db.prepare('select u.id,u.name,u.role from sessions s join users u on u.id=s.uid where s.token=? and s.exp>?').get(t,Date.now())||null};
const login=(res,uid)=>{const t=crypto.randomBytes(32).toString('hex');db.prepare('insert into sessions values(?,?,?)').run(t,uid,Date.now()+30*864e5);
res.setHeader('Set-Cookie',`sid=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.COOKIE_SECURE?'; Secure':''}`)};
const tries=new Map();const limited=ip=>{const n=(tries.get(ip)||0)+1;tries.set(ip,n);setTimeout(()=>tries.delete(ip),9e5).unref();return n>20};
const strip=s=>s.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#x27;/g,"'").replace(/&quot;/g,'"').trim();
async function search(q){try{const sx=get('searx');
 if(sx){const j=await(await fetch(sx.replace(/\/$/,'')+'/search?format=json&q='+encodeURIComponent(q))).json();return j.results.slice(0,6).map(r=>r.title+'\n'+r.url+'\n'+(r.content||'')).join('\n\n')||'Ничего не найдено'}
 const h=await(await fetch('https://html.duckduckgo.com/html/?q='+encodeURIComponent(q),{headers:{'User-Agent':'Mozilla/5.0'}})).text();
 const re=/class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g,out=[];let x;
 while((x=re.exec(h))&&out.length<6){let u=x[1];const m=u.match(/uddg=([^&]+)/);if(m)u=decodeURIComponent(m[1]);out.push(strip(x[2])+'\n'+u+'\n'+strip(x[3]))}
 return out.join('\n\n')||'Ничего не найдено'}catch(e){return 'Поиск недоступен: '+e.message}}
const TOOL={type:'function',function:{name:'web_search',description:'Поиск в интернете: свежая информация, факты, новости, цены, документация',parameters:{type:'object',properties:{query:{type:'string',description:'Поисковый запрос'}},required:['query']}}};
const ol=async(p,b,m='POST')=>{const r=await fetch(get('ollama')+p,{method:m,body:b&&JSON.stringify(b)});if(!r.ok)throw new Error('Ollama '+r.status+': '+(await r.text()).slice(0,200));return r};
const safe=s=>/^[\w.-]{1,80}$/.test(s||'');
const voices=()=>fs.readdirSync(VOICES).filter(f=>f.endsWith('.onnx')&&fs.existsSync(path.join(VOICES,f+'.json'))).map(f=>f.slice(0,-5));
const MIME={'.html':'text/html;charset=utf-8','.js':'text/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/json'};

async function chat(req,res,u){const {chat:cid0,message}=await jb(req);const model=get('model');
 if(!model)return json(res,400,{error:'Админ ещё не выбрал модель (⚙ → Модели).'});
 let cid=cid0;if(cid){if(!db.prepare('select 1 from chats where id=? and uid=?').get(cid,u.id))return json(res,404,{error:'Чат не найден'})}
 else cid=Number(db.prepare('insert into chats(uid,title,created) values(?,?,?)').run(u.id,String(message).slice(0,40),Date.now()).lastInsertRowid);
 db.prepare('insert into msgs(chat,role,content) values(?,?,?)').run(cid,'user',message);
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});const send=o=>res.write('data: '+JSON.stringify(o)+'\n\n');send({t:'chat',id:cid});
 try{const hist=db.prepare('select role,content from msgs where chat=? order by id desc limit 30').all(cid).reverse();
  const m=[{role:'system',content:get('prompt')+' Сегодня '+new Date().toISOString().slice(0,10)+'.'},...hist];let tools=get('search')=='1'?[TOOL]:undefined,ans='';
  for(let i=0;i<5&&!ans;i++){let r;
   try{r=await(await ol('/api/chat',{model,messages:m,stream:false,tools})).json()}
   catch(e){if(tools&&/tool/i.test(e.message)){tools=undefined;send({t:'status',v:'модель без поиска'});i--;continue}throw e}
   const g=r.message;if(g.tool_calls?.length&&tools){m.push(g);for(const c of g.tool_calls){const q=c.function.arguments?.query||'';send({t:'status',v:'🔎 '+q});m.push({role:'tool',tool_name:c.function.name,content:await search(q)})}}
   else ans=g.content||'…'}
  ans=ans||'Не получилось собрать ответ, попробуй переформулировать.';
  db.prepare('insert into msgs(chat,role,content) values(?,?,?)').run(cid,'assistant',ans);send({t:'text',v:ans})}
 catch(e){send({t:'error',v:e.message})}send({t:'done'});res.end()}

async function applyUpdate(req,res,url){const buf=await body(req,500e6),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'oleg-'));
 try{fs.writeFileSync(tmp+'/u.oleg',buf);fs.mkdirSync(tmp+'/x');execFileSync('tar',['xzf',tmp+'/u.oleg','-C',tmp+'/x','--no-same-owner']);
  const man=JSON.parse(fs.readFileSync(tmp+'/x/manifest.json'));if(man.app!=='oleg-ai'||!man.files)throw new Error('Это не файл обновления Олег AI (.oleg)');
  if(man.version===VERSION()&&url.searchParams.get('force')!=='1')throw new Error('Версия '+man.version+' уже установлена');
  for(const [f,h] of Object.entries(man.files)){const p=path.resolve(tmp,'x/payload',f);
   if(!p.startsWith(path.join(tmp,'x/payload')+path.sep)||f.startsWith('data')||f.includes('..'))throw new Error('Недопустимый путь: '+f);
   if(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==h)throw new Error('Контрольная сумма не совпала: '+f)}
  execFileSync('tar',['czf',path.join(DATA,'backups',`before-${VERSION()}-${Date.now()}.tgz`),'-C',ROOT,'--exclude=./data','--exclude=./node_modules','.']);
  for(const f of Object.keys(man.files)){const to=path.join(ROOT,f);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(tmp,'x/payload',f),to)}
  json(res,200,{ok:true,version:man.version,notes:man.notes||''});setTimeout(()=>process.exit(0),800)} // systemd (Restart=always) поднимет новую версию
 finally{fs.rmSync(tmp,{recursive:true,force:true})}}

http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://x'),p=url.pathname,rt=req.method+' '+p;
 if(!p.startsWith('/api/')){let f=path.join(PUB,p==='/'?'index.html':p);if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(PUB,'index.html');
  res.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});return fs.createReadStream(f).pipe(res)}
 if(req.method!=='GET'&&req.headers['x-req']!=='1')return json(res,403,{error:'bad request'});
 if(rt==='POST /api/register'||rt==='POST /api/login'){if(limited(req.socket.remoteAddress))return json(res,429,{error:'Слишком много попыток, подожди'});
  const {name,password}=await jb(req);if(!/^[\w.-]{3,32}$/.test(name||'')||(password||'').length<8)return json(res,400,{error:'Логин 3–32 символа (a-z, 0-9, _ . -), пароль от 8 символов'});
  if(p==='/api/register'){const n=db.prepare('select count(*) c from users').get().c;if(n&&get('signup')!=='1')return json(res,403,{error:'Регистрация закрыта'});
   if(db.prepare('select 1 from users where name=?').get(name))return json(res,409,{error:'Логин занят'});
   const id=Number(db.prepare('insert into users(name,pass,role,created) values(?,?,?,?)').run(name,hash(password),n?'user':'admin',Date.now()).lastInsertRowid);login(res,id);return json(res,200,{ok:true})}
  const r=db.prepare('select * from users where name=?').get(name);if(!r||!check(password,r.pass))return json(res,401,{error:'Неверный логин или пароль'});login(res,r.id);return json(res,200,{ok:true})}
 if(rt==='GET /api/health')return json(res,200,{ok:true,version:VERSION()});
 const u=user(req);if(!u)return json(res,401,{error:'auth'});
 if(rt==='POST /api/logout'){db.prepare('delete from sessions where token=?').run(cookies(req).sid);return json(res,200,{ok:true})}
 if(rt==='GET /api/me')return json(res,200,{...u,version:VERSION(),voice:!!get('voice')});
 if(rt==='GET /api/status'){let up=false;try{await ol('/api/version',null,'GET');up=true}catch{}return json(res,200,{model:get('model'),search:get('search')=='1',ollama:up,voice:get('voice')})}
 if(rt==='GET /api/chats')return json(res,200,db.prepare('select id,title from chats where uid=? order by id desc limit 100').all(u.id));
 if(req.method==='GET'&&/^\/api\/chats\/\d+$/.test(p)){const id=+p.split('/')[3];if(!db.prepare('select 1 from chats where id=? and uid=?').get(id,u.id))return json(res,404,{});return json(res,200,db.prepare('select role,content from msgs where chat=? order by id').all(id))}
 if(req.method==='POST'&&/^\/api\/chats\/\d+\/delete$/.test(p)){const id=+p.split('/')[3];if(db.prepare('select 1 from chats where id=? and uid=?').get(id,u.id)){db.prepare('delete from msgs where chat=?').run(id);db.prepare('delete from chats where id=?').run(id)}return json(res,200,{ok:true})}
 if(rt==='POST /api/chat')return chat(req,res,u);
 if(rt==='POST /api/tts'){const v=get('voice');if(!v||!safe(v))return json(res,404,{error:'Голос не настроен'});const {text}=await jb(req);
  const out=path.join(os.tmpdir(),crypto.randomUUID()+'.wav');
  await new Promise((ok,no)=>{const c=spawn(process.env.PIPER_BIN||'piper',['--model',path.join(VOICES,v+'.onnx'),'--output_file',out]);c.on('error',no);c.on('close',k=>k?no(new Error('piper '+k)):ok());c.stdin.end(String(text).slice(0,3000))});
  res.writeHead(200,{'content-type':'audio/wav'});return fs.createReadStream(out).pipe(res).on('close',()=>fs.unlink(out,()=>{}))}
 // ---- админ ----
 if(p.startsWith('/api/admin/')){if(u.role!=='admin')return json(res,403,{error:'Только для админа'});
  if(rt==='GET /api/admin/info'){let models=[];try{models=(await(await ol('/api/tags',null,'GET')).json()).models.map(m=>({name:m.name,size:m.size}))}catch{}
   return json(res,200,{version:VERSION(),models,voices:voices(),users:db.prepare('select id,name,role from users').all(),
    settings:{ollama:get('ollama'),model:get('model'),voice:get('voice'),search:get('search'),searx:get('searx'),signup:get('signup'),prompt:get('prompt')}})}
  if(rt==='POST /api/admin/settings'){const b=await jb(req);for(const k of Object.keys(DEF))if(k in b)set(k,b[k]);return json(res,200,{ok:true})}
  if(rt==='POST /api/admin/pull'){const {name}=await jb(req);if(!/^[\w.:\/-]{1,100}$/.test(name||''))return json(res,400,{error:'Неверное имя модели'});
   res.writeHead(200,{'content-type':'application/x-ndjson'});try{const r=await ol('/api/pull',{model:name,stream:true});for await(const c of r.body)res.write(c)}catch(e){res.write(JSON.stringify({error:e.message})+'\n')}return res.end()}
  if(rt==='POST /api/admin/delmodel'){const {name}=await jb(req);await ol('/api/delete',{model:name},'DELETE');if(get('model')===name)set('model','');return json(res,200,{ok:true})}
  if(rt==='POST /api/admin/voice'){const n=url.searchParams.get('name'),ext=url.searchParams.get('ext');if(!safe(n)||!['onnx','json'].includes(ext))return json(res,400,{error:'Неверное имя'});
   fs.writeFileSync(path.join(VOICES,n+'.onnx'+(ext==='json'?'.json':'')),await body(req,300e6));return json(res,200,{ok:true})}
  if(rt==='POST /api/admin/voicedel'){const {name}=await jb(req);if(safe(name))for(const e of ['.onnx','.onnx.json'])fs.rmSync(path.join(VOICES,name+e),{force:true});if(get('voice')===name)set('voice','');return json(res,200,{ok:true})}
  if(rt==='POST /api/admin/update')return applyUpdate(req,res,url)}
 json(res,404,{error:'not found'})}catch(e){if(!res.headersSent)json(res,500,{error:e.message});else res.end()}}).listen(PORT,process.env.HOST||'0.0.0.0',()=>console.log('Олег AI v'+VERSION()+' → http://localhost:'+PORT));
