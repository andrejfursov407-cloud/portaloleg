const $=i=>document.getElementById(i),E=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let LITE=false,me,cid=null,speak=false,busy=false,AD=null,FID=null,UI=null,AV='/avatar.png',ctl=null,sid=0,bgKey='';
const au=new Audio(),T=k=>UI?.t?.[k]??'';
// ---- фон: закат, пальмы, неоновый город (или своя картинка) ----
function buildBg(){const key=(UI.img.bg?'img'+UI.img.v:'svg')+(LITE?'L':'');if(key===bgKey)return;bgKey=key;
 if(UI.img.bg){$('bg').innerHTML='';$('bg').style.background=`url(/ui/bg?v=${UI.img.v}) center/cover no-repeat`;return}$('bg').style.background='';
 const lite=LITE,R=(s=>()=>(s=s*16807%2147483647)/2147483647)(7),W=1600,H=900;let h=`<defs><linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6a2f9c"/><stop offset=".35" stop-color="#d4479e"/><stop offset=".6" stop-color="#ff7a6a"/><stop offset=".8" stop-color="#ffb35a"/></linearGradient><radialGradient id="sn"><stop offset="0" stop-color="#fff0b0"/><stop offset=".45" stop-color="#ffb35a"/><stop offset="1" stop-color="#ff6a8a" stop-opacity="0"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#sk)"/><circle cx="800" cy="600" r="280" fill="url(#sn)"/>`;
 for(const [x0,x1,base,mx] of [[900,1600,720,360],[0,620,720,140]]){let x=x0;while(x<x1){const w=45+R()*70,ht=60+R()*mx;h+=`<rect x="${x|0}" y="${base-ht|0}" width="${w|0}" height="${ht|0}" fill="#6a2c90" opacity=".92"/>`;
  if(!lite)for(let y=base-ht+10;y<base-10;y+=16)for(let k=x+6;k<x+w-8;k+=14)if(R()<.42)h+=`<rect x="${k|0}" y="${y|0}" width="6" height="8" fill="${R()<.5?'#35e6d4':'#ff5fae'}" opacity=".85"/>`;x+=w+6}}
 h+=`<rect y="720" width="${W}" height="180" fill="#3a1450" opacity=".88"/><rect y="720" width="${W}" height="5" fill="#ffb35a" opacity=".7"/>`;
 const palm=(x,y,ht,l,c)=>{const tx=x+l,ty=y-ht;let s=`<path d="M${x} ${y}Q${x+l*.1} ${y-ht*.55} ${tx} ${ty}" stroke="${c}" stroke-width="${ht*.022}" fill="none" stroke-linecap="round"/>`;for(let i=0;i<9;i++){const a=i/9*6.283,dx=Math.cos(a)*ht*.34,dy=Math.sin(a)*ht*.08+ht*.13;s+=`<path d="M${tx} ${ty}Q${tx+dx*.6} ${ty-ht*.13} ${tx+dx} ${ty+dy}" stroke="${c}" stroke-width="${ht*.016}" fill="none" stroke-linecap="round"/>`}return s};
 h+=palm(70,900,820,90,'#2a0f3e')+palm(260,900,540,-60,'#3a1558')+palm(1490,900,780,-120,'#2a0f3e')+palm(1330,900,500,70,'#3a1558');
 $('bg').innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" width="100%" height="100%">${h}</svg>`}
// ---- применение настроек интерфейса ----
function applyUI(){const t=UI.t,l=UI.l,r=document.documentElement.style;
 document.querySelectorAll('[data-t]').forEach(e=>e.textContent=t[e.dataset.t]??e.textContent);document.querySelectorAll('[data-tp]').forEach(e=>e.placeholder=t[e.dataset.tp]??'');document.querySelectorAll('[data-tt]').forEach(e=>e.title=t[e.dataset.tt]??'');
 r.setProperty('--pk',l.c1);r.setProperty('--cy',l.c2);r.setProperty('--fs',l.fs);r.setProperty('--op',l.op);r.setProperty('--aw',l.aw+'%');
 const lite=l.lite||navigator.hardwareConcurrency<=2||navigator.deviceMemory<=2;LITE=!!lite;document.body.classList.toggle('lite',!!lite);
 document.body.dataset.ly=l.layout;document.body.dataset.bp=l.bar;
 $({hr:'hbr',hl:'hbl',barl:'barl',barr:'barr'}[l.btnPos]).append($('hb'));
 const ids=['bgb','bv','bm','ba'];l.btns.forEach(i=>$('hb').append($(i)));ids.filter(i=>!l.btns.includes(i)).forEach(i=>{$('hb').append($(i))});ids.forEach(i=>$(i).classList.toggle('xoff',!l.btns.includes(i)));
 $('mic').classList.toggle('xoff',!l.mic);$('clip').classList.toggle('xoff',!l.clip);
 AV=UI.img.avatar?'/ui/avatar?v='+UI.img.v:'/avatar.png';$('av').src=AV;$('av').style.display=l.avatar?'':'none';
 $('ucss').textContent=UI.css||'';$('go').querySelector('span').textContent=busy?t.stop:t.send;buildBg();if(me)status()}
// ---- запросы ----
async function api(p,b,raw,signal){const o={headers:{'X-Req':'1'},signal};if(b!==undefined){o.method='POST';if(raw){o.body=b}else{o.body=JSON.stringify(b);o.headers['Content-Type']='application/json'}}
 const r=await fetch('/api/'+p,o);if(r.status===401&&p!=='login'&&p!=='register'){$('auth').classList.add('on');throw new Error('Нужен вход')}
 if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||'Ошибка '+r.status);return r}
const J=async(p,b)=>(await api(p,b)).json();
const md=t=>E(t).replace(/```(?:\w*\n)?([\s\S]*?)```/g,'<pre>$1</pre>').replace(/`([^`\n]+)`/g,'<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g,'<b style="color:#fff;text-transform:none">$1</b>');
// ---- фоновая музыка: цикл, плавное затухание на озвучке/микрофоне ----
let AC,GN,bgm=new Audio(),curT='',dk=new Set(),bOn=localStorage.bm!=='0',armedB=false;bgm.preload='auto';
function bgmInit(){if(GN)return;const A=window.AudioContext||window.webkitAudioContext;if(!A)return;AC=new A();GN=AC.createGain();GN.gain.value=0;AC.createMediaElementSource(bgm).connect(GN);GN.connect(AC.destination)}
function bgmVol(v,ms){if(GN){const t=AC.currentTime;GN.gain.cancelScheduledValues(t);GN.gain.setValueAtTime(GN.gain.value,t);GN.gain.setTargetAtTime(v,t,Math.max(ms,50)/3000)}
 else{const f=bgm.volume,t0=performance.now();clearInterval(bgm._r);bgm._r=setInterval(()=>{const k=Math.min(1,(performance.now()-t0)/Math.max(ms,50));bgm.volume=Math.min(1,Math.max(0,f+(v-f)*k));if(k===1)clearInterval(bgm._r)},40)}}
const bgmList=()=>{const m=me?.music;return m?(m.sel==='*'?m.tracks:m.tracks.filter(x=>x===m.sel)):[]};
const bgmApply=ms=>{const m=me.music;bgmVol(bOn?(dk.size?m.duck:m.vol):0,ms??m.fade)};
function duck(r,on){const had=dk.size>0;on?dk.add(r):dk.delete(r);if(me?.music&&(dk.size>0)!==had)bgmApply()}
function setT(n){curT=n;bgm.src='/api/music/'+encodeURIComponent(n)}
bgm.onended=()=>{const l=bgmList();if(l.length>1){setT(l[(l.indexOf(curT)+1)%l.length]);bgm.play().catch(()=>{})}};
function bgmStart(){if(!bOn||!curT||!bgm.paused&&AC?.state==='running')return;bgmInit();AC?.resume();bgm.play().then(()=>bgmApply()).catch(()=>{if(armedB)return;armedB=true;['pointerdown','keydown','touchend'].forEach(ev=>addEventListener(ev,()=>{armedB=false;bgmStart()},{once:true}))})}
function musicSync(){const l=bgmList();$('bgb').hidden=!l.length;$('bgb').classList.toggle('off',!bOn);bgm.loop=l.length===1;
 if(!l.length){bgm.pause();curT='';return}if(!l.includes(curT))setT(l[0]);if(bOn&&bgm.paused)bgmStart();else bgmApply(400)}
$('bgb').onclick=()=>{bOn=!bOn;localStorage.bm=bOn?1:0;$('bgb').classList.toggle('off',!bOn);if(bOn)bgmStart();else{bgmApply(600);setTimeout(()=>{if(!bOn)bgm.pause()},900)}};
// ---- озвучка ----
const stopSay=()=>{duck('tts',false);sid++;au.pause();window.speechSynthesis?.cancel()};
const one=c=>new Promise(async ok=>{try{const r=await api('tts',{text:c});au.src=URL.createObjectURL(await r.blob());duck('tts',true);au.onended=au.onerror=ok;await au.play()}catch{if(window.speechSynthesis){duck('tts',true);const u=new SpeechSynthesisUtterance(c);u.lang='ru-RU';u.onend=u.onerror=ok;speechSynthesis.speak(u)}else ok()}});
async function say(t){stopSay();const my=sid,L=me.ttsmax||600,ch=[];t=t.replace(/https?:\S+/g,'').replace(/[`*#_>|]/g,'');
 for(const s of t.match(/[^.!?\n]+[.!?\n]*/g)||[t]){if(ch.length&&ch[ch.length-1].length+s.length<L)ch[ch.length-1]+=s;else ch.push(s.slice(0,L))}
 for(const c of ch.slice(0,8)){if(my!==sid)return;await one(c)}if(my===sid)duck('tts',false)}
const unlock=()=>{au.src='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';au.play().catch(()=>{})};
// ---- чат ----
function acts(d,t,id){const x=d.lastElementChild,b=(c,h,f)=>{const e=document.createElement('button');e.className=c;e.innerHTML=h;e.onclick=f;x.append(' ',e)};b('sy','🔊',()=>say(t));
 if(id){const f=r=>async ev=>{try{await J('feedback',{msg:id,rating:r});x.querySelectorAll('.fb').forEach(z=>z.classList.remove('on'));ev.target.classList.add('on')}catch{}};b('sy fb','👍',f(1));b('sy fb','👎',f(-1))}}
function add(role,t,cls='',label,id){const d=document.createElement('div'),u=role==='user';d.className='m '+(u?'u ':'')+cls;
 d.innerHTML=(u?'<i></i>':`<img src="${AV}" alt="" onerror="this.style.visibility='hidden'">`)+'<div><b>'+E(label||(u?T('userLabel'):T('botLabel')))+'</b> <span></span></div>';
 d.querySelector('span').innerHTML=u?E(t):md(t);if(!u&&!cls)acts(d,t,id);$('log').append(d);$('log').scrollTop=1e9;return d}
async function boot(){try{me=await J('me');$('auth').classList.remove('on');$('ba').hidden=me.role!=='admin';document.title='Oleg AI — '+me.netname;$('s5').textContent=me.netname.toUpperCase();speak=localStorage.sp?localStorage.sp==='1':me.autospeak;$('bv').textContent=speak?'🔊':'🔇';status();clearInterval(window.tm);window.tm=setInterval(status,15000);musicSync();newChat()}catch{}}
async function status(){try{const s=await J('status'),t=UI.t;$('s1').textContent=!s.ollama?t.vOff:s.busy?t.vBusy:t.vIdle;$('s2').textContent=s.search?t.vOn:t.vNoS;$('s2').className=s.search?'':'off';$('s3').textContent=s.ollama?t.vSrvOk:t.vSrvNo;$('s3').className=s.ollama?'':'off';$('s4').textContent=t[{low:'teaLow',mid:'teaMid',high:'teaHigh'}[s.tea]];$('av').title='Модель: '+(s.model||'не выбрана')}catch{}}
function newChat(){cid=null;FID=null;$('fc').className='';$('log').innerHTML='';add('assistant',T('greeting').replace('{name}',me?.name||''),'',T('botFirst'));$('menu').classList.remove('on')}
async function auth(k){try{await J(k,{name:$('an').value.trim(),password:$('ap').value});$('ap').value='';boot()}catch(e){$('ae').textContent=e.message}}
$('li').onclick=()=>auth('login');$('re').onclick=()=>auth('register');$('ap').onkeydown=e=>{if(e.key==='Enter')auth('login')};
$('lo').onclick=async()=>{await api('logout',{});location.reload()};$('nc').onclick=newChat;$('x').onclick=newChat;$('mc').onclick=()=>$('menu').classList.remove('on');
$('bm').onclick=async()=>{const l=await J('chats');$('cl').innerHTML=l.map(c=>`<div class="row"><a href="#" data-i="${c.id}" style="color:#fff;flex:1">${E(c.title)}</a><button class="bt g" data-d="${c.id}">✕</button></div>`).join('')||'<small>'+E(T('empty'))+'</small>';$('menu').classList.add('on')};
$('cl').onclick=async e=>{const i=e.target.dataset.i,d=e.target.dataset.d;e.preventDefault();
 if(d){await api('chats/'+d+'/delete',{});if(+d===cid)newChat();return $('bm').onclick()}
 if(i){cid=+i;$('log').innerHTML='';(await J('chats/'+i)).forEach(m=>add(m.role,m.content,'',null,m.id));$('menu').classList.remove('on')}};
$('bv').onclick=()=>{speak=!speak;localStorage.sp=speak?1:0;$('bv').textContent=speak?'🔊':'🔇';if(!speak)stopSay()};
// ---- файлы ----
$('clip').onclick=()=>$('fi').click();
$('fi').onchange=async()=>{const f=$('fi').files[0];$('fi').value='';if(!f)return;if(f.size>me.maxfile*1e6)return add('assistant','Файл больше лимита '+me.maxfile+' МБ (лимит меняется в админ-панели).','er');
 $('fc').className='on';$('fc').textContent='Читаю '+f.name+'…';try{const d=await(await api('upload?name='+encodeURIComponent(f.name),f,true)).json();FID=d.id;$('fc').innerHTML='📎 '+E(d.name)+' ('+d.chars+' символов) <u id="fu">убрать</u>';$('fu').onclick=()=>{FID=null;$('fc').className=''}}catch(e){FID=null;$('fc').className='';add('assistant',e.message,'er')}};
// ---- отправка со стримингом ----
function setBusy(b){busy=b;$('go').querySelector('span').textContent=b?T('stop'):T('send')}
$('f').onsubmit=async e=>{e.preventDefault();if(busy){ctl?.abort();return}const t=$('in').value.trim(),fid=FID;if(!t&&!fid)return;setBusy(true);unlock();$('in').value='';$('in').style.height='auto';FID=null;const fn=$('fc').textContent;$('fc').className='';
 add('user',(fid?'📎 '+fn.replace(/ \(.*/,'').replace('📎 ','')+'\n':'')+(t||T('fileTask')));let st=add('assistant',T('thinking'),'st'),live=null,acc='',tm=0;ctl=new AbortController();
 const draw=()=>{tm=0;live.querySelector('span').innerHTML=md(acc);$('log').scrollTop=1e9};
 try{const r=await api('chat',{chat:cid,message:t,file:fid},false,ctl.signal),rd=r.body.getReader(),dc=new TextDecoder();let buf='';
  for(;;){const {done,value}=await rd.read();if(done)break;buf+=dc.decode(value,{stream:true});const p=buf.split('\n\n');buf=p.pop();
   for(const l of p){const o=JSON.parse(l.slice(6));
    if(o.t==='chat')cid=o.id;else if(o.t==='status')st&&(st.querySelector('span').textContent='('+o.v+')');
    else if(o.t==='delta'){if(!live){st?.remove();st=null;live=add('assistant','','live')}acc+=o.v;if(!tm)tm=setTimeout(draw,90)}
    else if(o.t==='reset'){live?.remove();live=null;acc='';if(!st)st=add('assistant',T('thinking'),'st')}
    else if(o.t==='text'){clearTimeout(tm);st?.remove();st=null;if(live){live.className='m';live.querySelector('span').innerHTML=md(o.v);acts(live,o.v,o.id);live=null}else add('assistant',o.v,'',null,o.id);if(speak)say(o.v)}
    else if(o.t==='error'){st?.remove();st=null;live?.remove();live=null;add('assistant',o.v,'er')}}}}
 catch(x){clearTimeout(tm);st?.remove();st=null;if(live){live.className='m';acc&&acts(live,acc,0)}if(x.name!=='AbortError')add('assistant',x.message,'er')}
 st?.remove();ctl=null;setBusy(false);status()};
$('in').oninput=()=>{$('in').style.height='auto';$('in').style.height=$('in').scrollHeight+'px'};
$('in').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&matchMedia('(hover:hover)').matches){e.preventDefault();$('f').requestSubmit()}};
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)$('mic').hidden=true;else{let rc;$('mic').onclick=()=>{if(rc){rc.stop();return}rc=new SR();rc.lang='ru-RU';rc.interimResults=true;duck('mic',true);$('mic').classList.add('on');
 rc.onresult=e=>{$('in').value=[...e.results].map(r=>r[0].transcript).join('')};rc.onend=()=>{duck('mic',false);rc=null;$('mic').classList.remove('on')};rc.start()}}
// ---- админ-панель грузится только по клику (экономия на слабых устройствах) ----
$('ba').onclick=async()=>{if(!window.ADM)await new Promise((ok,no)=>{const s=document.createElement('script');s.src='/admin.js?v='+me.version;s.onload=ok;s.onerror=no;document.head.append(s)});openAdmin()};
$('ax').onclick=()=>$('adm').classList.remove('on');
(async()=>{UI=await fetch('/api/ui').then(r=>r.json()).catch(()=>null)||{t:{},l:{layout:'cs',bar:'bottom',btnPos:'hr',btns:['bgb','bv','bm','ba'],mic:1,clip:1,avatar:1,lite:0,fs:1,op:.8,aw:25,c1:'#ff5fa8',c2:'#35e6d4'},css:'',img:{avatar:false,bg:false,v:0}};applyUI();boot()})();
