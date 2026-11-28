// Олег AI — сервер без внешних npm-зависимостей (Node >= 22.13)
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import crypto from 'node:crypto';import {DatabaseSync} from 'node:sqlite';import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';import dns from 'node:dns/promises';
process.on('unhandledRejection',e=>console.error('unhandled:',e));
const ROOT=path.dirname(fileURLToPath(import.meta.url)),DATA=process.env.DATA_DIR||path.join(ROOT,'data'),PORT=+process.env.PORT||3000;
const PUB=path.join(ROOT,'public'),VOICES=path.join(DATA,'voices'),MUSIC=path.join(DATA,'music'),UIDIR=path.join(DATA,'ui');
fs.mkdirSync(VOICES,{recursive:true});fs.mkdirSync(MUSIC,{recursive:true});fs.mkdirSync(UIDIR,{recursive:true});fs.mkdirSync(path.join(DATA,'backups'),{recursive:true});
const VERSION=()=>JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'))).version;
const db=new DatabaseSync(path.join(DATA,'oleg.db'));
db.exec(`create table if not exists users(id integer primary key,name text unique,pass text,role text,created int);
create table if not exists sessions(token text primary key,uid int,exp int);
create table if not exists settings(k text primary key,v text);
create table if not exists chats(id integer primary key,uid int,title text,created int);
create table if not exists msgs(id integer primary key,chat int,role text,content text,att text)`);
db.exec('pragma journal_mode=wal');
db.exec(`create table if not exists kb(id integer primary key,title text,created int);create table if not exists kbc(id integer primary key,kb int,text text);
create table if not exists fb(id integer primary key,msg int,uid int,rating int,approved int default 0,created int,unique(msg,uid))`);db.prepare('delete from sessions where exp<?').run(Date.now());
const DEF={ollama:process.env.OLLAMA_URL||'http://127.0.0.1:11434',model:'',voice:'',search:'1',searx:'',signup:'1',
prompt:'Ты — Олег, свой в доску мастер на все руки и умный помощник. Говоришь по-русски (или на языке собеседника), живо и по делу, с лёгким юмором, но без воды. Разбираешься во всех областях: быт, ремонт, код, наука, право, учёба, бизнес. Если нужны свежие данные, факты, новости, цены или ты не уверен — сам вызывай web_search и опирайся на результаты, называя источники. Умеешь читать и анализировать прикреплённые файлы и страницы по ссылке (open_url). Не выдумывай. Для опасных вещей напоминай про безопасность.'};
const freeDisk=()=>{try{const s=fs.statfsSync(DATA);return Math.round(s.bavail*s.bsize/2**30)}catch{return 0}};
const HW=(()=>{const ram=+(os.totalmem()/2**30).toFixed(1);return{cores:os.cpus().length,ram,disk:freeDisk(),tier:ram<3.2?'mini':ram<6.5?'mid':'full'}})();
const PRESETS={ // mini = 1 ядро/2 ГБ/10 ГБ, mid = 2 ядра/4 ГБ, full = 4 ядра/8 ГБ/150 ГБ
 mini:{ctx:3072,keep:'30m',hist:6,results:3,maxfile:1,ttsmax:300,parallel:1,page:1500,smode:'smart',maxtok:320,kb:2,maxq:3,models:['qwen2.5:1.5b','qwen2.5:0.5b','llama3.2:1b']},
 mid:{ctx:4096,keep:'15m',hist:14,results:5,maxfile:3,ttsmax:600,parallel:1,page:4000,smode:'tools',maxtok:700,kb:3,maxq:6,models:['qwen2.5:3b','llama3.2:3b','qwen3:4b']},
 full:{ctx:8192,keep:'30m',hist:30,results:6,maxfile:8,ttsmax:1200,parallel:2,page:10000,smode:'tools',maxtok:1500,kb:4,maxq:12,models:['qwen2.5:7b','qwen3:8b','llama3.1:8b']}};
Object.assign(DEF,{learn:'0',kbon:'1',music:'*',musicvol:'0.35',duck:'0.08',fade:'1200',netname:'Borisovka v1.0',since:'1971',profile:'auto',temp:'0.6',threads:'0',pages:'1',speed:'1',autospeak:'0'});
const KEYS=[...Object.keys(DEF),...Object.keys(PRESETS.full).filter(k=>k!=='models')];
const raw=k=>db.prepare('select v from settings where k=?').get(k)?.v;
const get=k=>{const v=raw(k);if(v!==undefined)return v;if(k in DEF)return DEF[k];const p=raw('profile')||'auto';return PRESETS[p==='auto'?HW.tier:p][k]};
const set=(k,v)=>db.prepare('insert into settings(k,v) values(?,?) on conflict(k) do update set v=excluded.v').run(k,String(v));
const json=(res,c,o)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o))};
const body=(req,max=1e6)=>new Promise((ok,no)=>{const a=[];let n=0,big=false;req.on('data',d=>{n+=d.length;if(n>max){big=true;a.length=0}else a.push(d)});req.on('end',()=>big?no(new Error('Слишком большой файл (лимит '+Math.round(max/1e6)+' МБ)')):ok(Buffer.concat(a)));req.on('error',no)});
const jb=async req=>JSON.parse((await body(req)).toString()||'{}');
const hash=(p,s=crypto.randomBytes(16).toString('hex'))=>s+':'+crypto.scryptSync(p,s,32).toString('hex');
const check=(p,h)=>{const [s,x]=h.split(':');return crypto.timingSafeEqual(Buffer.from(hash(p,s).split(':')[1]),Buffer.from(x))};
const cookies=r=>Object.fromEntries((r.headers.cookie||'').split(/;\s*/).filter(Boolean).map(c=>c.split('=')));
const user=req=>{const t=cookies(req).sid;if(!t)return null;return db.prepare('select u.id,u.name,u.role from sessions s join users u on u.id=s.uid where s.token=? and s.exp>?').get(t,Date.now())||null};
const login=(res,uid)=>{const t=crypto.randomBytes(32).toString('hex');db.prepare('insert into sessions values(?,?,?)').run(t,uid,Date.now()+30*864e5);
res.setHeader('Set-Cookie',`sid=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.COOKIE_SECURE?'; Secure':''}`)};
const tries=new Map(),ipOf=req=>(process.env.TRUST_PROXY&&(req.headers['x-forwarded-for']||'').split(',')[0].trim())||req.socket.remoteAddress;
const limited=ip=>(tries.get(ip)||0)>=20,fail=ip=>{tries.set(ip,(tries.get(ip)||0)+1);setTimeout(()=>{const n=(tries.get(ip)||1)-1;n>0?tries.set(ip,n):tries.delete(ip)},9e5).unref()};
const strip=s=>s.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#x27;/g,"'").replace(/&quot;/g,'"').trim();
async function search(q){try{const sx=get('searx');
 if(sx){const j=await(await fetch(sx.replace(/\/$/,'')+'/search?format=json&q='+encodeURIComponent(q))).json();return j.results.slice(0,+get('results')).map(r=>r.title+'\n'+r.url+'\n'+(r.content||'')).join('\n\n')||'Ничего не найдено'}
 const h=await(await fetch('https://html.duckduckgo.com/html/?q='+encodeURIComponent(q),{headers:{'User-Agent':'Mozilla/5.0'}})).text();
 const re=/class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g,out=[];let x;
 while((x=re.exec(h))&&out.length<+get('results')){let u=x[1];const m=u.match(/uddg=([^&]+)/);if(m)u=decodeURIComponent(m[1]);out.push(strip(x[2])+'\n'+u+'\n'+strip(x[3]))}
 return out.join('\n\n')||'Ничего не найдено'}catch(e){return 'Поиск недоступен: '+e.message}}
const TOOL={type:'function',function:{name:'web_search',description:'Поиск в интернете: свежая информация, факты, новости, цены, документация',parameters:{type:'object',properties:{query:{type:'string',description:'Поисковый запрос'}},required:['query']}}};
const piper=(args,txt)=>new Promise((ok,no)=>{const c=spawn(process.env.PIPER_BIN||'piper',args);let er='';try{os.setPriority(c.pid,10)}catch{}c.on('error',no);c.stderr.on('data',d=>er+=d);c.stdin.on('error',()=>{});c.on('close',k=>k?no(new Error('piper '+k+' '+er.slice(-150))):ok());c.stdin.end(txt)});
async function runPiper(v,txt,out){const m=path.join(VOICES,v+'.onnx'),ls=String(1/(+get('speed')||1));
 try{await piper(['--model',m,'--output_file',out,'--length_scale',ls],txt)}catch(e){if(/ENOENT/.test(e.message))throw new Error('Piper не установлен');await piper(['--model',m,'--output-file',out,'--length-scale',ls],txt)}}
const OPEN={type:'function',function:{name:'open_url',description:'Открыть веб-страницу по ссылке и прочитать её текст',parameters:{type:'object',properties:{url:{type:'string'}},required:['url']}}};
const priv=a=>/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1|::ffff|fc|fd|fe80)/i.test(a);
async function openUrl(u){try{let x=new URL(u),t='';for(let i=0;i<4;i++){if(!/^https?:$/.test(x.protocol))throw new Error('протокол');const {address}=await dns.lookup(x.hostname);if(priv(address))return 'Адрес запрещён';
 const r=await fetch(x,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(12000)});const l=r.headers.get('location');if(r.status>=300&&r.status<400&&l){x=new URL(l,x);continue}t=await r.text();break}
 return strip(t.replace(/<(script|style|nav|footer)[\s\S]*?<\/\1>/gi,'')).replace(/\s+/g,' ').slice(0,+get('page'))||'Пусто'}catch(e){return 'Не удалось открыть: '+e.message}}
const xml=b=>strip(b.toString().replace(/<\/(w:p|a:p|text:p|si|row)>/g,'\n').replace(/<\/(w:tc|c)>/g,'\t'));
function extract(name,buf){const e=path.extname(name).toLowerCase(),tmp=path.join(os.tmpdir(),crypto.randomUUID()+e),X={maxBuffer:80e6};
 try{fs.writeFileSync(tmp,buf);
  if(e==='.pdf')return execFileSync('pdftotext',['-layout','-q',tmp,'-'],X).toString();
  if(e==='.pptx')return execFileSync('unzip',['-Z1',tmp]).toString().split('\n').filter(x=>/^ppt\/slides\/slide\d+\.xml$/.test(x)).map(x=>xml(execFileSync('unzip',['-p',tmp,x],X))).join('\n\n');
  if(['.docx','.xlsx','.odt'].includes(e))return xml(execFileSync('unzip',['-p',tmp,{'.docx':'word/document.xml','.odt':'content.xml','.xlsx':'xl/sharedStrings.xml'}[e]],X));
  if(buf.subarray(0,4000).includes(0))throw new Error('Формат не поддерживается. Подходят: текст, код, CSV, JSON, PDF, DOCX, XLSX, PPTX');
  return buf.toString('utf8')}
 catch(x){throw new Error(x.code==='ENOENT'?'На сервере нет pdftotext/unzip: apt install poppler-utils unzip':x.message)}finally{fs.rmSync(tmp,{force:true})}}
const UP=new Map();let slots=0;const waitq=[];
const acquire=()=>new Promise(ok=>{const t=()=>{if(slots<+get('parallel')){slots++;ok()}else waitq.push(t)};t()});const release=()=>{slots--;waitq.shift()?.()};
const ol=async(p,b,m='POST',signal)=>{const r=await fetch(get('ollama')+p,{method:m,body:b&&JSON.stringify(b),signal});if(!r.ok)throw new Error('Ollama '+r.status+': '+(await r.text()).slice(0,200));return r};
const safe=s=>/^[\w.-]{1,80}$/.test(s||'');
const voices=()=>fs.readdirSync(VOICES).filter(f=>f.endsWith('.onnx')&&fs.existsSync(path.join(VOICES,f+'.json'))).map(f=>f.slice(0,-5));
const AUD=/\.(mp3|ogg|opus|wav|m4a|aac|flac|webm)$/i,AMIME={mp3:'audio/mpeg',ogg:'audio/ogg',opus:'audio/ogg',wav:'audio/wav',m4a:'audio/mp4',aac:'audio/aac',flac:'audio/flac',webm:'audio/webm'};
const musicList=()=>fs.readdirSync(MUSIC).filter(f=>AUD.test(f)).sort();
const MIME={'.html':'text/html;charset=utf-8','.js':'text/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/json'};

const tier=()=>{const p=raw('profile')||'auto';return p==='auto'?HW.tier:p};
const sysPrompt=()=>{const n=get('netname'),y=get('since'),d=new Date().toISOString().slice(0,10);
 if(tier()==='mini'&&raw('prompt')===undefined)return `Ты — Олег AI, нейросеть «${n}», существуешь с ${y} года. Говори по-русски, живо, по делу и кратко (до 6 предложений), если не просят подробно. Не выдумывай: опирайся на результаты поиска, файлы и базу знаний, не знаешь — так и скажи. Ты нейросеть, не человек; под капотом локальная модель, выбранная админом. Сегодня ${d}.`;
 return `Тебя зовут Олег AI. Ты нейросеть «${n}» и существуешь с ${y} года. Когда тебя спрашивают, кто ты, как тебя зовут, как называется нейросеть или с какого ты года, отвечай именно так. Если искренне спросят, человек ли ты, честно скажи, что ты нейросеть. Если спросят, какая модель у тебя под капотом, скажи, что работаешь на локальной модели, которую выбрал администратор. `+get('prompt')+' Сегодня '+d+'.'};
const needsSearch=q=>{q=q.toLowerCase().trim();if(q.length<15||/^(привет|здравствуй|здарова|спасибо|благодар|ок\b|ладно|пока|хорошо|понял|ясно|как дела|ты кто|кто ты|как тебя зовут)/.test(q))return false;
 return /\?|сегодня|сейчас|новост|курс|погод|цен[аыу]|стоит|когда|кто так|что так|где |найди|поищи|последн|202\d|актуальн|вышел|результат|счёт|расписан/.test(q)};
const SC=new Map();async function searchC(q){const k=q.toLowerCase(),c=SC.get(k);if(c&&Date.now()-c.t<6e5)return c.v;const v=(await search(q)).slice(0,1800);if(!v.startsWith('Поиск недоступен')){SC.set(k,{t:Date.now(),v});if(SC.size>60)SC.delete(SC.keys().next().value)}return v}
// --- база знаний (BM25, без эмбеддингов — лёгкая для слабого железа)
let IDX=null;const SW=new Set('что как это для при или его она они все так где там тут про над под без чем кто был быть есть нужно можно надо тоже ещё еще очень если когда'.split(' ')),stem=w=>w.length>5?w.slice(0,5):w,toks=s=>(s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]).filter(w=>!SW.has(w)).map(stem);
function kbIndex(){const df=new Map(),docs=db.prepare('select kb,text from kbc').all().map(r=>{const t=toks(r.text),tf=new Map();t.forEach(x=>tf.set(x,(tf.get(x)||0)+1));tf.forEach((_,k)=>df.set(k,(df.get(k)||0)+1));return{text:r.text,tf,len:t.length||1}});return IDX={docs,df,N:docs.length,avg:docs.reduce((a,d)=>a+d.len,0)/(docs.length||1)}}
function kbFind(q,k){const I=IDX||kbIndex();if(!I.N||!k)return[];const qt=[...new Set(toks(q))],need=qt.length<=2?1:2;
 return I.docs.map(d=>{let s=0,m=0;for(const w of qt){const f=d.tf.get(w);if(!f)continue;m++;const n=I.df.get(w);s+=(Math.log(1+(I.N-n+.5)/(n+.5))+.3)*f*2.2/(f+1.2*(.25+.75*d.len/I.avg))}return[m>=need?s:0,d.text]}).filter(x=>x[0]>0).sort((a,b)=>b[0]-a[0]).slice(0,k).map(x=>x[1])}
const chunk=s=>{const o=[];let cur='';for(const p of s.replace(/\r/g,'').split(/\n{2,}|(?<=[.!?])\s+/)){for(let i=0;i<p.length;i+=500){const x=p.slice(i,i+500);if((cur+' '+x).length>500){if(cur.trim())o.push(cur.trim());cur=x}else cur+=' '+x}}if(cur.trim())o.push(cur.trim());return o};
function kbAdd(title,text){const ch=chunk(text);if(!ch.length)throw new Error('Пустой текст');if(db.prepare('select count(*) c from kbc').get().c+ch.length>4000)throw new Error('База знаний переполнена (лимит 4000 фрагментов)');
 const id=Number(db.prepare('insert into kb(title,created) values(?,?)').run(String(title||'Без названия').slice(0,100),Date.now()).lastInsertRowid),ins=db.prepare('insert into kbc(kb,text) values(?,?)');for(const c of ch)ins.run(id,c);IDX=null;return id}
function fbToKb(mid){const r=db.prepare("select m.content a,(select content from msgs where chat=m.chat and id<m.id and role='user' order by id desc limit 1) q from msgs m where m.id=?").get(mid);if(!r||!r.q)return false;
 const q=r.q.replace(/^📎[^\n]*\n/,'');kbAdd('Обучение: '+q.slice(0,50),'Вопрос: '+q.slice(0,500)+'\nОтвет: '+r.a.slice(0,1500));db.prepare('update fb set approved=1 where msg=?').run(mid);return true}
// --- настраиваемый интерфейс
const UI_T={title:'OLEG AI V2.2',tagline:'АНАЛИЗ. ПЛАНИРОВАНИЕ. РЕШЕНИЕ.',statusTitle:'Системный статус',stMode:'Режим:',stKb:'База знаний:',stSrv:'Серверы:',stTea:'Уровень чая:',stNet:'Нейросеть:',vIdle:'ДИАГНОСТИКА',vBusy:'АНАЛИЗ',vOff:'ОФЛАЙН',vOn:'АКТИВНА',vNoS:'ВЫКЛ',vSrvOk:'НА СВЯЗИ.',vSrvNo:'НЕТ СВЯЗИ',teaLow:'НИЗКИЙ',teaMid:'СРЕДНИЙ',teaHigh:'ВЫСОКИЙ',placeholder:'Напиши задачу…',send:'ОТПРАВИТЬ',stop:'СТОП',userLabel:'Задача:',botLabel:'Олег:',botFirst:'Олег AI :',greeting:'Здорово, хозяин! Чего стряслось-то? (Приветствие)',thinking:'(Думает…)',fileTask:'Проанализируй файл',authTitle:'Олег AI — вход',loginPh:'Логин',passPh:'Пароль (от 8 символов)',btnLogin:'Войти',btnReg:'Регистрация',authHint:'Первый зарегистрированный пользователь становится администратором.',menuTitle:'Чаты',newChat:'+ Новый чат',logout:'Выйти',close:'Закрыть',empty:'Пока пусто',ttMic:'Голосовой ввод',ttClip:'Прикрепить файл',ttMusic:'Музыка вкл/выкл',ttVoice:'Озвучка ответов',ttMenu:'Чаты',ttAdmin:'Админ-панель',ttNew:'Новый чат'};
const UI_L={layout:'cs',bar:'bottom',btnPos:'hr',btns:['bgb','bv','bm','ba'],mic:1,clip:1,avatar:1,lite:0,fs:1,op:.8,aw:25,c1:'#ff5fa8',c2:'#35e6d4'};
function cleanUI(b){const o={t:{},l:{},css:''},l=b.l||{};for(const k in UI_T)if(typeof b.t?.[k]==='string')o.t[k]=b.t[k].slice(0,200);
 const num=(k,a,z)=>{const v=+l[k];if(!isNaN(v)&&l[k]!==''&&l[k]!==null)o.l[k]=Math.min(z,Math.max(a,v))},en=(k,v)=>{if(v.includes(l[k]))o.l[k]=l[k]},col=k=>{if(/^#[0-9a-f]{6}$/i.test(l[k]))o.l[k]=l[k]};
 en('layout',['cs','sc','st','sb','c']);en('bar',['bottom','top']);en('btnPos',['hr','hl','barl','barr']);['mic','clip','avatar','lite'].forEach(k=>{if(k in l)o.l[k]=l[k]?1:0});num('fs',.7,1.5);num('op',.3,1);num('aw',15,45);col('c1');col('c2');
 if(Array.isArray(l.btns)){const s=l.btns.filter((x,i,a)=>UI_L.btns.includes(x)&&a.indexOf(x)===i);if(!s.includes('ba'))s.push('ba');o.l.btns=s}
 if(typeof b.css==='string')o.css=b.css.slice(0,20000).replace(/<\/style/gi,'');return o}
const getUI=()=>{let s={};try{s=JSON.parse(raw('ui')||'{}')}catch{}const im=fs.readdirSync(UIDIR).map(f=>f.split('.')[0]);return{t:{...UI_T,...s.t},l:{...UI_L,...s.l},css:s.css||'',img:{avatar:im.includes('avatar'),bg:im.includes('bg'),v:+raw('uiv')||0}}};
// --- модель: потоковый вызов, прогрев, параметры
const warm=async()=>{const m=get('model');if(!m)return;try{const o={num_ctx:+get('ctx')};if(+get('threads'))o.num_thread=+get('threads');await ol('/api/generate',{model:m,prompt:'',keep_alive:get('keep'),options:o})}catch{}};
async function callModel(model,m,tl,options,send,signal){const body={model,messages:m,stream:true,options,keep_alive:get('keep'),...(/qwen3|deepseek-r1/i.test(model)?{think:false}:{})};if(tl)body.tools=tl;
 const r=await ol('/api/chat',body,'POST',signal),dec=new TextDecoder();let buf='',content='',calls=[];
 for await(const c of r.body){buf+=dec.decode(c,{stream:true});let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!l)continue;let j;try{j=JSON.parse(l)}catch{continue}
  if(j.error)throw new Error(j.error);const g=j.message||{};if(g.content){content+=g.content;send({t:'delta',v:g.content})}if(g.tool_calls)calls.push(...g.tool_calls)}}
 return{content,calls}}
async function chat(req,res,u){const {chat:cid0,message,file}=await jb(req);const model=get('model'),msg=String(message||'').trim().slice(0,4000);
 if(!model)return json(res,400,{error:'Админ ещё не выбрал модель (⚙ → Модели).'});
 if(waitq.length>=+get('maxq'))return json(res,503,{error:'Сервер сейчас занят — попробуй через минуту.'});
 const f=file?UP.get(file):null;if(file&&(!f||f.uid!==u.id))return json(res,400,{error:'Файл не найден, прикрепи заново'});if(!msg&&!f)return json(res,400,{error:'Пустое сообщение'});
 let cid=cid0;if(cid){if(!db.prepare('select 1 from chats where id=? and uid=?').get(cid,u.id))return json(res,404,{error:'Чат не найден'})}
 else cid=Number(db.prepare('insert into chats(uid,title,created) values(?,?,?)').run(u.id,(msg||f.name).slice(0,40),Date.now()).lastInsertRowid);
 db.prepare('insert into msgs(chat,role,content,att) values(?,?,?,?)').run(cid,'user',(f?'📎 '+f.name+'\n':'')+(msg||'Проанализируй файл'),f?.text||null);if(f)UP.delete(file);
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','x-accel-buffering':'no'});const send=o=>{try{res.write('data: '+JSON.stringify(o)+'\n\n')}catch{}};send({t:'chat',id:cid});
 const ac=new AbortController();res.on('close',()=>ac.abort());
 if(slots>=+get('parallel'))send({t:'status',v:'в очереди…'});await acquire();
 try{if(ac.signal.aborted)return;
  const ctx=+get('ctx'),cut=Math.floor(ctx*1.2),old=tier()==='mini'?500:1200,H=db.prepare('select role,content,att from msgs where chat=? order by id desc limit ?').all(cid,+get('hist')).reverse();
  const m=[{role:'system',content:sysPrompt()},...H.map((x,i)=>{const c=x.att?x.content+'\n\n--- содержимое файла ---\n'+x.att.slice(0,i===H.length-1?cut:1500):x.content;return{role:x.role,content:i>=H.length-2?c:c.slice(0,old)}})];
  const last=H[H.length-1];if(last.att&&last.att.length>cut)send({t:'status',v:'файл длинный: читаю первые '+cut+' символов (увеличь «Контекст» в настройках)'});
  const sm=get('smode'),on=get('search')=='1',tools=[];let extra='';
  const urls=on&&get('pages')=='1'&&sm!=='tools'?(msg.match(/https?:\/\/[^\s)]+/g)||[]).slice(0,1):[];
  for(const x of urls){send({t:'status',v:'🌐 '+x});extra+='\n[Страница '+x+']\n'+await openUrl(x)}
  if(on&&!f&&!urls.length){if(sm==='always'||(sm==='smart'&&needsSearch(msg))){send({t:'status',v:'🔎 '+msg.slice(0,60)});extra+='\n[Результаты веб-поиска — опирайся на них и называй источники]\n'+await searchC(msg.slice(0,150))}}
  if(on&&sm==='tools'){tools.push(TOOL);if(get('pages')=='1')tools.push(OPEN)}
  if(get('kbon')=='1'){const k=kbFind(msg,+get('kb'));if(k.length)extra+='\n[База знаний Олега — используй, если относится к вопросу]\n'+k.map(x=>'- '+x).join('\n')}
  const room=Math.max(600,Math.floor(ctx*1.5)-m.reduce((a,x)=>a+x.content.length,0));if(extra)m[m.length-1].content+=extra.slice(0,room);
  let tl=tools.length?tools:undefined,ans='';const options={num_ctx:ctx,temperature:+get('temp'),num_predict:+get('maxtok')||-1};if(+get('threads'))options.num_thread=+get('threads');
  const sig=AbortSignal.any([ac.signal,AbortSignal.timeout(3e5)]);
  for(let i=0;i<4&&!ans;i++){let r;
   try{r=await callModel(model,m,tl,options,send,sig)}catch(e){if(tl&&/tool/i.test(e.message)){tl=undefined;send({t:'status',v:'модель без инструментов поиска'});i--;continue}throw e}
   if(r.calls.length&&tl){if(r.content)send({t:'reset'});m.push({role:'assistant',content:r.content,tool_calls:r.calls});for(const c of r.calls){const a=c.function.arguments||{};
    if(c.function.name==='open_url'){send({t:'status',v:'🌐 '+a.url});m.push({role:'tool',tool_name:'open_url',content:await openUrl(a.url||'')})}
    else{send({t:'status',v:'🔎 '+(a.query||'')});m.push({role:'tool',tool_name:'web_search',content:await searchC(a.query||'')})}}}
   else ans=r.content}
  if(!ans&&tl){send({t:'reset'});ans=(await callModel(model,m,undefined,options,send,sig)).content}
  ans=ans||'Не получилось собрать ответ, попробуй переформулировать.';
  const mid=Number(db.prepare('insert into msgs(chat,role,content) values(?,?,?)').run(cid,'assistant',ans).lastInsertRowid);send({t:'text',v:ans,id:mid})}
 catch(e){if(!ac.signal.aborted)send({t:'error',v:e.message})}finally{release()}try{send({t:'done'});res.end()}catch{}}

async function applyUpdate(req,res,url){const buf=await body(req,500e6),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'oleg-'));
 try{fs.writeFileSync(tmp+'/u.oleg',buf);fs.mkdirSync(tmp+'/x');try{execFileSync('tar',['xzf',tmp+'/u.oleg','-C',tmp+'/x','--no-same-owner'],{stdio:'pipe'})}catch{throw new Error('Не удалось распаковать: это не файл обновления .oleg')}
  const man=JSON.parse(fs.readFileSync(tmp+'/x/manifest.json'));if(man.app!=='oleg-ai'||!man.files)throw new Error('Это не файл обновления Олег AI (.oleg)');
  if(man.version===VERSION()&&url.searchParams.get('force')!=='1')throw new Error('Версия '+man.version+' уже установлена');
  for(const [f,h] of Object.entries(man.files)){const p=path.resolve(tmp,'x/payload',f);
   if(!p.startsWith(path.join(tmp,'x/payload')+path.sep)||f.startsWith('data')||f.includes('..'))throw new Error('Недопустимый путь: '+f);
   if(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==h)throw new Error('Контрольная сумма не совпала: '+f)}
  execFileSync('tar',['czf',path.join(DATA,'backups',`before-${VERSION()}-${Date.now()}.tgz`),'-C',ROOT,'--exclude=./data','--exclude=./node_modules','.']);
  for(const f of Object.keys(man.files)){const to=path.join(ROOT,f);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(tmp,'x/payload',f),to)}
  json(res,200,{ok:true,version:man.version,notes:man.notes||''});setTimeout(()=>process.exit(0),800)} // systemd (Restart=always) поднимет новую версию
 finally{fs.rmSync(tmp,{recursive:true,force:true})}}

if(!raw('voice')&&voices().length)set('voice',voices()[0]);
if(!raw('model')&&process.env.DEFAULT_MODEL)set('model',process.env.DEFAULT_MODEL);setTimeout(warm,3000).unref();
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://x'),p=url.pathname,rt=req.method+' '+p;
 if(!p.startsWith('/api/')){if(p==='/ui/avatar'||p==='/ui/bg'){const k=p.slice(4),fn=fs.readdirSync(UIDIR).find(x=>x.startsWith(k+'.'));if(!fn){res.writeHead(404);return res.end()}res.writeHead(200,{'content-type':{png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif'}[fn.split('.').pop()],'cache-control':'public, max-age=86400','x-content-type-options':'nosniff'});return fs.createReadStream(path.join(UIDIR,fn)).pipe(res)}let f=path.join(PUB,p==='/'?'index.html':p);if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(PUB,'index.html');
  res.writeHead(200,{'x-content-type-options':'nosniff','x-frame-options':'DENY','content-type':MIME[path.extname(f)]||'application/octet-stream'});return fs.createReadStream(f).pipe(res)}
 if(req.method!=='GET'&&req.headers['x-req']!=='1')return json(res,403,{error:'bad request'});
 if(rt==='POST /api/register'||rt==='POST /api/login'){const ip=ipOf(req);if(limited(ip))return json(res,429,{error:'Слишком много попыток, подожди'});
  const {name,password}=await jb(req);if(!/^[\w.-]{3,32}$/.test(name||'')||(password||'').length<8)return json(res,400,{error:'Логин 3–32 символа (a-z, 0-9, _ . -), пароль от 8 символов'});
  if(p==='/api/register'){const n=db.prepare('select count(*) c from users').get().c;if(n&&get('signup')!=='1')return json(res,403,{error:'Регистрация закрыта'});
   if(db.prepare('select 1 from users where name=?').get(name)){fail(ip);return json(res,409,{error:'Логин занят'})}if(0)return json(res,409,{error:'Логин занят'});
   const id=Number(db.prepare('insert into users(name,pass,role,created) values(?,?,?,?)').run(name,hash(password),n?'user':'admin',Date.now()).lastInsertRowid);fail(ip);login(res,id);return json(res,200,{ok:true})}
  const r=db.prepare('select * from users where name=?').get(name);if(!r||!check(password,r.pass)){fail(ip);return json(res,401,{error:'Неверный логин или пароль'})}login(res,r.id);return json(res,200,{ok:true})}
 if(rt==='GET /api/ui')return json(res,200,getUI());
 if(rt==='GET /api/health')return json(res,200,{ok:true,version:VERSION()});
 const u=user(req);if(!u)return json(res,401,{error:'auth'});
 if(rt==='POST /api/logout'){db.prepare('delete from sessions where token=?').run(cookies(req).sid);return json(res,200,{ok:true})}
 if(rt==='GET /api/me')return json(res,200,{...u,version:VERSION(),voice:!!get('voice'),ttsmax:+get('ttsmax'),netname:get('netname'),music:{tracks:musicList(),sel:get('music'),vol:+get('musicvol'),duck:+get('duck'),fade:+get('fade')},autospeak:get('autospeak')=='1',maxfile:+get('maxfile')});
 if(rt==='GET /api/status'){let up=false;try{await ol('/api/version',null,'GET');up=true}catch{}const l=os.loadavg()[0]/HW.cores;return json(res,200,{model:get('model'),search:get('search')=='1',ollama:up,voice:get('voice'),tea:l<.5?'low':l<1.2?'mid':'high',busy:slots>0})}
 if(rt==='GET /api/chats')return json(res,200,db.prepare('select id,title from chats where uid=? order by id desc limit 100').all(u.id));
 if(req.method==='GET'&&/^\/api\/chats\/\d+$/.test(p)){const id=+p.split('/')[3];if(!db.prepare('select 1 from chats where id=? and uid=?').get(id,u.id))return json(res,404,{});return json(res,200,db.prepare('select id,role,content from msgs where chat=? order by id').all(id))}
 if(req.method==='POST'&&/^\/api\/chats\/\d+\/delete$/.test(p)){const id=+p.split('/')[3];if(db.prepare('select 1 from chats where id=? and uid=?').get(id,u.id)){db.prepare('delete from msgs where chat=?').run(id);db.prepare('delete from chats where id=?').run(id)}return json(res,200,{ok:true})}
 if(rt==='POST /api/feedback'){const {msg,rating}=await jb(req);if(!db.prepare("select 1 from msgs m join chats c on c.id=m.chat where m.id=? and c.uid=? and m.role='assistant'").get(msg,u.id))return json(res,404,{error:'нет такого ответа'});
  const r=rating>0?1:-1;db.prepare('insert into fb(msg,uid,rating,created) values(?,?,?,?) on conflict(msg,uid) do update set rating=excluded.rating').run(msg,u.id,r,Date.now());if(r===1&&get('learn')=='1')fbToKb(msg);return json(res,200,{ok:true})}
 if(rt==='POST /api/chat')return await chat(req,res,u);
 if(rt==='POST /api/tts'){const v=get('voice');if(!v||!safe(v))return json(res,404,{error:'Голос не настроен'});const {text}=await jb(req);
  const out=path.join(os.tmpdir(),crypto.randomUUID()+'.wav');
  await runPiper(v,String(text).slice(0,Math.floor(+get('ttsmax')*1.5)),out);
  res.writeHead(200,{'content-type':'audio/wav'});return fs.createReadStream(out).pipe(res).on('close',()=>fs.unlink(out,()=>{}))}
 if(req.method==='GET'&&p.startsWith('/api/music/')){const n=path.basename(decodeURIComponent(p.slice(11)));if(!musicList().includes(n))return json(res,404,{error:'Трек не найден'});
  const f=path.join(MUSIC,n),st=fs.statSync(f),m=/bytes=(\d*)-(\d*)/.exec(req.headers.range||'');let s=0,e=st.size-1;
  if(m){if(m[1]!==''){s=+m[1];if(m[2]!=='')e=Math.min(+m[2],e)}else if(m[2]!==''){s=Math.max(0,st.size-+m[2])}}
  if(s>e||s>=st.size){res.writeHead(416,{'content-range':'bytes */'+st.size});return res.end()}
  res.writeHead(m?206:200,{'content-type':AMIME[path.extname(n).slice(1).toLowerCase()]||'audio/mpeg','accept-ranges':'bytes','content-length':e-s+1,'cache-control':'private, max-age=3600',...(m&&{'content-range':`bytes ${s}-${e}/${st.size}`})});return fs.createReadStream(f,{start:s,end:e}).pipe(res)}
 if(rt==='POST /api/upload'){const n=(url.searchParams.get('name')||'file').slice(0,120);const buf=await body(req,+get('maxfile')*1e6);const text=extract(n,buf).replace(/\r/g,'').trim();
  if(!text)return json(res,400,{error:'В файле не нашлось текста (скан или картинка?)'});const id=crypto.randomUUID();UP.set(id,{uid:u.id,name:n,text});setTimeout(()=>UP.delete(id),36e5).unref();return json(res,200,{id,name:n,chars:text.length})}
 // ---- админ ----
 if(p.startsWith('/api/admin/')){if(u.role!=='admin')return json(res,403,{error:'Только для админа'});
  if(rt==='GET /api/admin/info'){let models=[];try{models=(await(await ol('/api/tags',null,'GET')).json()).models.map(m=>({name:m.name,size:m.size}))}catch{}
   return json(res,200,{version:VERSION(),models,voices:voices(),users:db.prepare('select id,name,role from users').all(),
    settings:Object.fromEntries(KEYS.map(k=>[k,get(k)])),hw:{...HW,disk:freeDisk(),detected:HW.tier},presets:Object.fromEntries(Object.entries(PRESETS).map(([k,v])=>[k,v.models])),music:musicList().map(n=>({name:n,size:fs.statSync(path.join(MUSIC,n)).size})),kb:db.prepare('select k.id,k.title,(select count(*) from kbc where kb=k.id) n from kb k order by id desc').all(),fb:{up:db.prepare('select count(*) c from fb where rating=1').get().c,down:db.prepare('select count(*) c from fb where rating=-1').get().c}})}
  if(rt==='POST /api/admin/settings'){const b=await jb(req);if('profile' in b&&b.profile!==get('profile'))for(const k of Object.keys(PRESETS.full).filter(k=>k!=='models'))db.prepare('delete from settings where k=?').run(k);for(const k of KEYS)if(k in b)set(k,b[k]);if(['model','ctx','keep','threads','profile'].some(k=>k in b))setTimeout(warm,300);return json(res,200,{ok:true})}
  if(rt==='POST /api/admin/pull'){const {name}=await jb(req);if(!/^[\w.:\/-]{1,100}$/.test(name||''))return json(res,400,{error:'Неверное имя модели'});
   res.writeHead(200,{'content-type':'application/x-ndjson'});try{const r=await ol('/api/pull',{model:name,stream:true});for await(const c of r.body)res.write(c)}catch(e){res.write(JSON.stringify({error:e.message})+'\n')}return res.end()}
  if(rt==='POST /api/admin/delmodel'){const {name}=await jb(req);await ol('/api/delete',{model:name},'DELETE');if(get('model')===name)set('model','');return json(res,200,{ok:true})}
  if(rt==='POST /api/admin/voice'){const n=url.searchParams.get('name'),ext=url.searchParams.get('ext');if(!safe(n)||!['onnx','json'].includes(ext))return json(res,400,{error:'Неверное имя'});
   fs.writeFileSync(path.join(VOICES,n+'.onnx'+(ext==='json'?'.json':'')),await body(req,300e6));return json(res,200,{ok:true})}
  if(rt==='POST /api/admin/voicedel'){const {name}=await jb(req);if(safe(name))for(const e of ['.onnx','.onnx.json'])fs.rmSync(path.join(VOICES,name+e),{force:true});if(get('voice')===name)set('voice','');return json(res,200,{ok:true})}
  if(rt==='POST /api/admin/kb'){const {title,text}=await jb(req);return json(res,200,{ok:true,id:kbAdd(title,String(text||'').slice(0,5e5))})}
  if(rt==='POST /api/admin/kbfile'){const n=(url.searchParams.get('name')||'file').slice(0,120);return json(res,200,{ok:true,id:kbAdd(n,extract(n,await body(req,5e6)))})}
  if(rt==='POST /api/admin/kbdel'){const {id}=await jb(req);db.prepare('delete from kbc where kb=?').run(id);db.prepare('delete from kb where id=?').run(id);IDX=null;return json(res,200,{ok:true})}
  if(rt==='GET /api/admin/fb')return json(res,200,db.prepare("select f.id,f.rating,f.approved,m.id mid,m.content a,(select content from msgs where chat=m.chat and id<m.id and role='user' order by id desc limit 1) q from fb f join msgs m on m.id=f.msg order by f.id desc limit 100").all());
  if(rt==='POST /api/admin/fbact'){const {id,action}=await jb(req),f=db.prepare('select msg from fb where id=?').get(id);if(f&&action==='add')fbToKb(f.msg);if(action==='del')db.prepare('delete from fb where id=?').run(id);return json(res,200,{ok:true})}
  if(rt==='GET /api/admin/dataset'){const r=db.prepare("select distinct m.id,m.content a,(select content from msgs where chat=m.chat and id<m.id and role='user' order by id desc limit 1) q from fb f join msgs m on m.id=f.msg where f.rating=1 or f.approved=1").all();
   res.writeHead(200,{'content-type':'application/x-ndjson','content-disposition':'attachment; filename="oleg-dataset.jsonl"'});return res.end(r.filter(x=>x.q).map(x=>JSON.stringify({messages:[{role:'system',content:'Ты — Олег AI.'},{role:'user',content:x.q.replace(/^📎[^\n]*\n/,'')},{role:'assistant',content:x.a}]})).join('\n'))}
  if(rt==='POST /api/admin/ui'){const {ui}=await jb(req);set('ui',JSON.stringify(cleanUI(ui||{})));return json(res,200,getUI())}
  if(rt==='POST /api/admin/uireset'){db.prepare("delete from settings where k='ui'").run();return json(res,200,getUI())}
  if(rt==='POST /api/admin/uiimg'){const k=url.searchParams.get('kind'),e=(url.searchParams.get('ext')||'').toLowerCase();if(!['avatar','bg'].includes(k)||!['png','jpg','jpeg','webp','gif'].includes(e))return json(res,400,{error:'Нужна картинка png/jpg/webp/gif'});
   const buf=await body(req,6e6);for(const x of fs.readdirSync(UIDIR))if(x.startsWith(k+'.'))fs.rmSync(path.join(UIDIR,x));fs.writeFileSync(path.join(UIDIR,k+'.'+e),buf);set('uiv',Date.now());return json(res,200,getUI())}
  if(rt==='POST /api/admin/uiimgdel'){const {kind}=await jb(req);for(const x of fs.readdirSync(UIDIR))if(x.startsWith(kind+'.'))fs.rmSync(path.join(UIDIR,x));set('uiv',Date.now());return json(res,200,getUI())}
  if(rt==='POST /api/admin/music'){const n=path.basename(url.searchParams.get('name')||'').replace(/[^\p{L}\p{N}._ -]/gu,'_').slice(0,100);if(!AUD.test(n))return json(res,400,{error:'Нужен аудиофайл: mp3, ogg, wav, m4a, flac'});
   fs.writeFileSync(path.join(MUSIC,n),await body(req,60e6));return json(res,200,{ok:true,name:n})}
  if(rt==='POST /api/admin/musicdel'){const {name}=await jb(req),n=path.basename(String(name||''));if(musicList().includes(n))fs.rmSync(path.join(MUSIC,n));if(get('music')===n)set('music','*');return json(res,200,{ok:true})}
  if(rt==='POST /api/admin/user'){const {id,action,value}=await jb(req);if(id===u.id&&action!=='pass')return json(res,400,{error:'Нельзя менять себя'});
   if(action==='del'){for(const c of db.prepare('select id from chats where uid=?').all(id))db.prepare('delete from msgs where chat=?').run(c.id);for(const q of ['chats','sessions'])db.prepare(`delete from ${q} where uid=?`).run(id);db.prepare('delete from users where id=?').run(id)}
   if(action==='role')db.prepare('update users set role=? where id=?').run(value==='admin'?'admin':'user',id);
   if(action==='pass'){if((value||'').length<8)return json(res,400,{error:'Пароль от 8 символов'});db.prepare('update users set pass=? where id=?').run(hash(value),id);db.prepare('delete from sessions where uid=?').run(id)}
   return json(res,200,{ok:true})}
  if(rt==='POST /api/admin/update')return await applyUpdate(req,res,url)}
 json(res,404,{error:'not found'})}catch(e){if(!res.headersSent)json(res,500,{error:e.message});else res.end()}}).listen(PORT,process.env.HOST||'0.0.0.0',()=>console.log('Олег AI v'+VERSION()+' → http://localhost:'+PORT));
