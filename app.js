(()=>{'use strict';
const APP_VERSION='4.2.2',DB_NAME='FotoarchivPWA',DB_VERSION=1,PAGE_SIZE=180;
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],fmt=new Intl.NumberFormat('de-DE'),fmtDate=new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
const state={db:null,photos:[],libraries:[],favorites:[],projects:[],selected:new Set(),activeTags:new Set(),excludedTags:new Set(),tagMode:'and',search:'',yearFrom:'',yearTo:'',tagState:'all',projectFilterId:'',sort:'dateDesc',listView:false,renderLimit:PAGE_SIZE,activeView:'library',activeProjectId:null,toastTimer:null,driveToken:'',driveExpiresAt:0,installPrompt:null,thumbLoading:false,thumbFailed:new Map(),thumbUrls:new Map(),thumbErrorNotified:false};
function readRuntimeConfig(){
  const packaged=window.FOTOARCHIV_CONFIG||{};
  let saved={};try{saved=JSON.parse(localStorage.getItem('fa_runtime_config')||'{}')||{}}catch{}
  // Ein Client aus der vorigen Google-Cloud-Projektkonfiguration darf die
  // neue, ausgelieferte Client-ID nicht unbemerkt überschreiben.
  const userOverride=saved.configBaseClientId===packaged.googleClientId ? saved.googleClientId : '';
  return {...packaged,googleClientId:userOverride||packaged.googleClientId||''};
}
let cfg=readRuntimeConfig();
function saveRuntimeConfig(next){
  cfg={...cfg,...next};
  localStorage.setItem('fa_runtime_config',JSON.stringify({
    googleClientId:cfg.googleClientId||'',
    configBaseClientId:window.FOTOARCHIV_CONFIG?.googleClientId||''
  }));
}
function uid(){return crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now().toString(36)}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function norm(s){return String(s??'').normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').trim().replace(/\s+/gu,' ').toLocaleLowerCase('de-DE')}
function clean(s){return String(s??'').normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').trim().replace(/\s+/gu,' ')}
function rawTags(t){return Array.isArray(t)?t:typeof t==='string'?[t]:[]}
function allTags(){const m=new Map();for(const p of state.photos)for(const t of rawTags(p.tags)){const c=clean(t),k=norm(c);if(k&&!m.has(k))m.set(k,c)}return [...m.values()].sort((a,b)=>a.localeCompare(b,'de'))}
function canonical(raw){const c=clean(raw),k=norm(c);return allTags().find(x=>norm(x)===k)||c}
function tagSet(p){return new Set(rawTags(p.tags).map(norm).filter(Boolean))}
function hasAll(p,tags){const s=tagSet(p);return tags.map(norm).filter(Boolean).every(t=>s.has(t))}
function hasAny(p,tags){const s=tagSet(p);return tags.map(norm).filter(Boolean).some(t=>s.has(t))}
function splitTags(s){return String(s||'').split(/[,;\n]+/).map(canonical).filter(Boolean)}
function yearOf(p){const d=p.capturedAt||p.fileDate;if(!d)return null;const y=new Date(d).getFullYear();return Number.isFinite(y)?y:null}
function niceDate(p){const d=p.capturedAt||p.fileDate;try{return d?fmtDate.format(new Date(d)):'Datum unbekannt'}catch{return'Datum unbekannt'}}
function toast(m,ms=3000){clearTimeout(state.toastTimer);const e=$('#toast');e.textContent=m;e.classList.add('show');state.toastTimer=setTimeout(()=>e.classList.remove('show'),ms)}
function busy(v){$('#progress').classList.toggle('show',!!v)}
function openModal(h){$('#modal').innerHTML=h;$('#modalBack').classList.add('show')}
function closeModal(){$('#modalBack').classList.remove('show')}
function reqP(r){return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function txP(tx){return new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error)})}
async function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const d=r.result;for(const n of['photos','libraries','favorites','projects'])if(!d.objectStoreNames.contains(n))d.createObjectStore(n,{keyPath:'id'})};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function getAll(n){const t=state.db.transaction(n,'readonly');return reqP(t.objectStore(n).getAll())}
async function put(n,o){const t=state.db.transaction(n,'readwrite');t.objectStore(n).put(o);await txP(t)}
async function putMany(n,a){if(!a.length)return;const t=state.db.transaction(n,'readwrite'),s=t.objectStore(n);a.forEach(x=>s.put(x));await txP(t)}
async function del(n,id){const t=state.db.transaction(n,'readwrite');t.objectStore(n).delete(id);await txP(t)}
async function loadData(){[state.photos,state.libraries,state.favorites,state.projects]=await Promise.all(['photos','libraries','favorites','projects'].map(getAll));state.photos.forEach(p=>{p.tags=rawTags(p.tags).map(clean).filter(Boolean)});
  const currentIds=new Set(state.photos.map(p=>p.id));
  for(const [id,cached] of state.thumbUrls)if(!currentIds.has(id)){URL.revokeObjectURL(cached.url);state.thumbUrls.delete(id)}
  state.favorites.forEach((f,i)=>{f.filter||={};f.filter.excludeTags||=[];f.filter.tagMode=f.filter.tagMode==='or'?'or':'and';if(f.quickOrder==null)f.quickOrder=i});renderAll()}

// PWA installation
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e;$('#installBtn').hidden=false});
window.addEventListener('appinstalled',()=>{$('#installBtn').hidden=true;state.installPrompt=null;toast('Fotoarchiv wurde installiert.')});
async function installApp(){if(state.installPrompt){state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;$('#installBtn').hidden=true;return}openModal(`<h2>App installieren</h2><p>Wenn die App installierbar ist, zeigt Chrome im Browsermenü außerdem <strong>App installieren</strong> bzw. <strong>Zum Startbildschirm hinzufügen</strong>.</p><p class="muted">Der eigene Installationsknopf erscheint automatisch, sobald Chrome die Installierbarkeit bestätigt.</p><div class="modal-footer"><button class="btn" id="modalClose">Schließen</button></div>`);$('#modalClose').onclick=closeModal}

// Google Identity Services: direktes Browser-Tokenmodell, ohne Backend/Cloudflare.
// Das kurzlebige Token wird bewusst nur im Arbeitsspeicher gehalten.
function driveConfigured(){return !!String(cfg.googleClientId||'').trim()}
function tokenValid(){return !!state.driveToken&&state.driveExpiresAt>Date.now()+60_000}
let googleTokenClient=null;
let googleTokenClientFor='';
let requestedDriveAction='drive-menu';
function connectDrive(after='drive-menu'){
  if(!driveConfigured()){showDriveSetup();toast('Bitte zuerst die Google Client-ID einrichten.',4500);return}
  const oauth=window.google?.accounts?.oauth2;
  if(!oauth?.initTokenClient){toast('Die Google-Anmeldung lädt noch. Bitte kurz warten und erneut tippen.',4500);return}
  requestedDriveAction=after;
  try{
    if(!googleTokenClient||googleTokenClientFor!==cfg.googleClientId){
      googleTokenClient=oauth.initTokenClient({
        client_id:String(cfg.googleClientId).trim(),
        scope:'https://www.googleapis.com/auth/drive.readonly',
        callback:(response)=>{
          if(response?.error||!response?.access_token){
            toast('Google-Anmeldung nicht abgeschlossen. '+(response?.error_description||response?.error||''),5000);return;
          }
          state.driveToken=response.access_token;
          state.driveExpiresAt=Date.now()+Math.max(0,Number(response.expires_in||3600))*1000;
          state.thumbFailed.clear();state.thumbErrorNotified=false;renderDriveButton();closeModal();toast('Google Drive ist verbunden.');renderLibrary();
          if(requestedDriveAction==='choose-folder') chooseDriveFolder();
          else driveMenu();
        },
        error_callback:(err)=>{
          const detail=err?.type==='popup_closed'?'Das Google-Fenster wurde geschlossen.':err?.type==='popup_failed_to_open'?'Chrome hat das Google-Anmeldefenster blockiert.':'Bitte die Google-Anmeldung erneut versuchen.';
          toast(detail,5000);
        }
      });
      googleTokenClientFor=cfg.googleClientId;
    }
    // Direkt im Klick-Ereignis aufrufen: wichtig für Popup-Blocker auf Android.
    googleTokenClient.requestAccessToken({prompt:'select_account'});
  }catch(err){console.error(err);toast('Google-Anmeldung konnte nicht gestartet werden.',5000)}
}
async function ensureDrive(){if(tokenValid())return state.driveToken;throw new Error('Google Drive ist nicht verbunden. Bitte oben auf „☁ Drive“ tippen und erneut verbinden.')}
async function driveFetch(url){
  const t=await ensureDrive();
  const r=await fetch(url,{headers:{Authorization:`Bearer ${t}`}});
  if(r.status===401){state.driveToken='';state.driveExpiresAt=0;renderDriveButton();throw new Error('Die Google-Sitzung ist abgelaufen. Bitte Drive erneut verbinden.')}
  return r;
}
async function driveJSON(url){const r=await driveFetch(url),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d?.error?.message||`Google Drive HTTP ${r.status}`);return d}
function renderDriveButton(){$('#driveBtn').textContent=tokenValid()?'☁ Drive ✓':'☁ Drive'}
function showDriveSetup(){
  openModal(`<h2>Google Drive einrichten</h2><p>Die Google-Anmeldung funktioniert direkt im Browser. Cloudflare oder ein Client-Secret sind nicht nötig.</p><label style="display:block;margin-top:10px"><span class="mini-label">Google OAuth Client-ID</span><input class="field" id="setupClientId" value="${esc(cfg.googleClientId||'')}" placeholder="…apps.googleusercontent.com"></label><p class="muted" style="font-size:13px">Die Client-ID ist öffentlich. Gib hier niemals ein Passwort oder einen Client-Secret ein.</p><div class="modal-footer"><button class="btn" id="openSetupGuide">Hilfe öffnen</button><button class="btn" id="modalClose">Abbrechen</button><button class="btn primary" id="saveDriveSetup">Speichern</button></div>`);
  $('#modalClose').onclick=closeModal;
  $('#openSetupGuide').onclick=()=>location.href='./SETUP.html';
  $('#saveDriveSetup').onclick=()=>{saveRuntimeConfig({googleClientId:$('#setupClientId').value.trim()});googleTokenClient=null;googleTokenClientFor='';closeModal();toast('Google-Einrichtung gespeichert.');renderDriveButton()};
}
async function driveMenu(){
  if(!driveConfigured())return showDriveSetup();
  openModal(`<h2>Google Drive</h2><p>Das Fotoarchiv kann deine Originalfotos in Google Drive <strong>nur lesen</strong>, nicht löschen oder verändern.</p><div class="panel" style="margin:10px 0"><strong>${tokenValid()?'Verbunden':'Nicht verbunden'}</strong><div class="muted" style="font-size:12px;margin-top:4px">Google Identity Services · Zugriffstoken nur im Arbeitsspeicher</div></div><div style="display:grid;gap:8px">${!tokenValid()?'<button class="btn primary" id="connectDrive">Mit Google Drive verbinden</button>':'<button class="btn primary" id="chooseDrive">Drive-Fotoordner hinzufügen</button><button class="btn" id="forgetDrive">Verbindung trennen</button>'}</div><div class="modal-footer"><button class="btn" id="modalClose">Schließen</button></div>`);
  $('#modalClose').onclick=closeModal;
  $('#connectDrive')?.addEventListener('click',()=>connectDrive('drive-menu'));
  $('#chooseDrive')?.addEventListener('click',()=>chooseDriveFolder());
  $('#forgetDrive')?.addEventListener('click',()=>{
    if(state.driveToken&&window.google?.accounts?.oauth2?.revoke){
      window.google.accounts.oauth2.revoke(state.driveToken,()=>{});
    }
    state.driveToken='';state.driveExpiresAt=0;renderDriveButton();closeModal();toast('Drive-Verbindung getrennt.');
  });
}
async function listDriveFolders(parent='root'){const q=encodeURIComponent(`'${String(parent).replace(/'/g,"\\'")}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`),fields=encodeURIComponent('files(id,name),nextPageToken');let token='',out=[];do{const u=`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=1000&orderBy=name&fields=${fields}&spaces=drive${token?`&pageToken=${encodeURIComponent(token)}`:''}`;const d=await driveJSON(u);out.push(...(d.files||[]));token=d.nextPageToken||''}while(token);return out}
async function chooseDriveFolder(existingId=null,current='root',crumbs=[]){try{busy(true);const folders=await listDriveFolders(current);busy(false);openModal(`<h2>Drive-Ordner auswählen</h2><div class="muted" style="margin-bottom:10px">${esc(['Meine Ablage',...crumbs.map(x=>x.name)].join(' › '))}</div><div style="display:grid;gap:6px">${folders.length?folders.map(f=>`<button class="btn" data-folder="${f.id}" data-name="${esc(f.name)}" style="justify-content:flex-start">📁 ${esc(f.name)}</button>`).join(''):'<div class="muted">Keine Unterordner.</div>'}</div><div class="modal-footer">${crumbs.length?'<button class="btn" id="driveBack">← Zurück</button>':''}<button class="btn" id="modalClose">Abbrechen</button>${current!=='root'?'<button class="btn primary" id="useFolder">Diesen Ordner verwenden</button>':''}</div>`);$('#modalClose').onclick=closeModal;$$('[data-folder]').forEach(b=>b.onclick=()=>chooseDriveFolder(existingId,b.dataset.folder,[...crumbs,{id:b.dataset.folder,name:b.dataset.name}]));$('#driveBack')?.addEventListener('click',()=>{const c=crumbs.slice(0,-1),p=c.length?c.at(-1).id:'root';chooseDriveFolder(existingId,p,c)});$('#useFolder')?.addEventListener('click',async()=>{const name=crumbs.at(-1)?.name||'Drive-Fotoordner';let lib=existingId?state.libraries.find(x=>x.id===existingId):null;if(lib){lib.driveFolderId=current;lib.name=name}else{lib={id:uid(),name,sourceType:'drive',driveFolderId:current,createdAt:Date.now(),lastScanAt:null};state.libraries.push(lib)}await put('libraries',lib);closeModal();await scanDriveLibrary(lib.id)})}catch(e){busy(false);console.error(e);toast(`Drive-Ordner konnten nicht geladen werden: ${e.message}`,5000)}}
async function listChildren(parent){let token='',out=[];const q=encodeURIComponent(`'${String(parent).replace(/'/g,"\\'")}' in parents and trashed=false`),fields=encodeURIComponent('nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime,md5Checksum,thumbnailLink,imageMediaMetadata(time,width,height))');do{const u=`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=1000&fields=${fields}&spaces=drive&orderBy=folder,name${token?`&pageToken=${encodeURIComponent(token)}`:''}`;const d=await driveJSON(u);out.push(...(d.files||[]));token=d.nextPageToken||''}while(token);return out}
async function scanDriveFolder(root){const files=[],q=[{id:root,prefix:''}];while(q.length){const c=q.shift(),items=await listChildren(c.id);for(const f of items){if(f.mimeType==='application/vnd.google-apps.folder')q.push({id:f.id,prefix:`${c.prefix}${f.name}/`});else if((f.mimeType||'').startsWith('image/'))files.push({...f,relativePath:`${c.prefix}${f.name}`})}}return files}
async function scanDriveLibrary(id){state.thumbFailed.clear();state.thumbErrorNotified=false;const lib=state.libraries.find(x=>x.id===id);if(!lib)return;busy(true);try{const entries=await scanDriveFolder(lib.driveFolderId),existing=state.photos.filter(p=>p.libraryId===id),by=new Map(existing.map(p=>[p.driveFileId,p])),seen=new Set(),changed=[];let added=0,moved=0;for(const e of entries){let p=by.get(e.id),lm=e.modifiedTime?Date.parse(e.modifiedTime):Date.now(),cap=e.imageMediaMetadata?.time?Date.parse(e.imageMediaMetadata.time):(e.createdTime?Date.parse(e.createdTime):lm);if(p){seen.add(p.id);if(p.relativePath!==e.relativePath)moved++;Object.assign(p,{fileName:e.name,relativePath:e.relativePath,size:Number(e.size||0),lastModified:lm,fileDate:lm,capturedAt:Number.isFinite(cap)?cap:lm,hash:e.md5Checksum?`md5:${e.md5Checksum}`:`drive:${e.id}`,driveThumbnailLink:e.thumbnailLink||p.driveThumbnailLink||null,mimeType:e.mimeType,missing:false});changed.push(p)}else{p={id:uid(),libraryId:id,sourceType:'drive',driveFileId:e.id,fileName:e.name,relativePath:e.relativePath,size:Number(e.size||0),lastModified:lm,fileDate:lm,capturedAt:Number.isFinite(cap)?cap:lm,hash:e.md5Checksum?`md5:${e.md5Checksum}`:`drive:${e.id}`,driveThumbnailLink:e.thumbnailLink||null,mimeType:e.mimeType,tags:[],thumbnail:null,missing:false,createdAt:Date.now()};state.photos.push(p);changed.push(p);seen.add(p.id);added++}}existing.forEach(p=>{if(!seen.has(p.id)){p.missing=true;changed.push(p)}});lib.lastScanAt=Date.now();await Promise.all([putMany('photos',changed),put('libraries',lib)]);await loadData();toast(`Drive aktualisiert${added||moved?`: ${added} neu, ${moved} verschoben/umbenannt`:''}.`)}catch(e){console.error(e);toast(`Drive konnte nicht aktualisiert werden: ${e.message}`,5000)}finally{busy(false)}}
// Die Drive-Felder thumbnailLink verweisen oft auf googleusercontent.com.
// Laut Google ist das im Browser durch CORS nicht verlaesslich. Ausschliesslich
// die offizielle Drive-API unter www.googleapis.com (Bearer-Token) verwenden.
async function driveBlob(p){
  const url=`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(p.driveFileId)}?alt=media`;
  const r=await driveFetch(url);
  if(!r.ok){let detail='';try{const d=await r.json();detail=d?.error?.message||''}catch{}throw new Error(`Drive HTTP ${r.status}${detail?': '+detail:''}`)}
  return r.blob();
}
// Originalfotos werden nur im Arbeitsspeicher decodiert. In IndexedDB liegen
// lediglich kleine JPEG-Vorschaubilder (maximal 480 Pixel Kantenlaenge).
async function makeLocalThumbnail(blob){
  if(!blob?.size)throw new Error('Bilddatei ist leer.');
  let img,objectURL='';
  try{
    if(typeof createImageBitmap==='function'){
      try{img=await createImageBitmap(blob)}catch{}
    }
    if(!img){
      objectURL=URL.createObjectURL(blob);
      img=new Image();
      img.src=objectURL;
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Dieses Bildformat kann das Geraet nicht anzeigen.'));if(img.complete){if(img.naturalWidth)resolve();else reject(new Error('Bild kann nicht gelesen werden.'))}});
    }
    const w=img.width||img.naturalWidth,h=img.height||img.naturalHeight;
    if(!w||!h)throw new Error('Bildgroesse nicht lesbar.');
    const ratio=Math.min(1,480/Math.max(w,h));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(w*ratio));canvas.height=Math.max(1,Math.round(h*ratio));
    const ctx=canvas.getContext('2d',{alpha:false});
    if(!ctx)throw new Error('Bildvorschau wird nicht unterstuetzt.');
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const thumb=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.78));
    if(!thumb?.size)throw new Error('Vorschaubild konnte nicht erstellt werden.');
    return thumb;
  }finally{
    if(typeof img?.close==='function')img.close();
    if(objectURL)URL.revokeObjectURL(objectURL);
  }
}
async function hydrateThumbs(photos){
  if(state.thumbLoading||!tokenValid())return;
  const q=photos.filter(p=>!p.thumbnail&&!p.missing&&p.driveFileId&&!state.thumbFailed.has(p.driveFileId)).slice(0,12);
  if(!q.length)return;
  state.thumbLoading=true;
  let n=0;const errors=[];
  try{
    const workers=Array.from({length:Math.min(2,q.length)},async()=>{
      while(q.length){
        const p=q.shift();
        try{
          const blob=await driveBlob(p);
          p.thumbnail=await makeLocalThumbnail(blob);
          await put('photos',p);n++;
        }catch(err){
          state.thumbFailed.set(p.driveFileId,err.message||'Unbekannter Fehler');errors.push(err.message||'Unbekannter Fehler');
          console.warn('Vorschau fehlgeschlagen:',p.fileName,err);
        }
      }
    });
    await Promise.all(workers);
  }finally{state.thumbLoading=false}
  if(n)renderLibrary();
  else if(errors.length&&!state.thumbErrorNotified){
    state.thumbErrorNotified=true;
    toast('Vorschaubilder konnten nicht geladen werden: '+errors[0],8000);
  }
}

function filtered(){let a=state.photos.slice(),q=norm(state.search);if(q)a=a.filter(p=>norm(p.fileName).includes(q)||norm(p.relativePath).includes(q)||rawTags(p.tags).some(t=>norm(t).includes(q)));if(state.activeTags.size){const t=[...state.activeTags];a=a.filter(p=>state.tagMode==='or'?hasAny(p,t):hasAll(p,t))}if(state.excludedTags.size){const t=[...state.excludedTags];a=a.filter(p=>!hasAny(p,t))}if(state.projectFilterId){const pr=state.projects.find(x=>x.id===state.projectFilterId),ids=new Set(pr?.photoIds||[]);a=a.filter(p=>ids.has(p.id))}const yf=parseInt(state.yearFrom),yt=parseInt(state.yearTo);if(Number.isFinite(yf))a=a.filter(p=>(yearOf(p)||0)>=yf);if(Number.isFinite(yt))a=a.filter(p=>(yearOf(p)||9999)<=yt);if(state.tagState==='untagged')a=a.filter(p=>!p.tags.length);if(state.tagState==='tagged')a=a.filter(p=>p.tags.length);const col=new Intl.Collator('de',{numeric:true,sensitivity:'base'});a.sort((x,y)=>state.sort==='dateAsc'?(x.capturedAt||0)-(y.capturedAt||0):state.sort==='nameAsc'?col.compare(x.fileName,y.fileName):state.sort==='nameDesc'?col.compare(y.fileName,x.fileName):state.sort==='tagsDesc'?y.tags.length-x.tags.length:(y.capturedAt||0)-(x.capturedAt||0));return a}
function thumbURL(p){
  if(!p.thumbnail)return '';
  try{
    const previous=state.thumbUrls.get(p.id);
    if(previous?.blob===p.thumbnail)return previous.url;
    if(previous)URL.revokeObjectURL(previous.url);
    const url=URL.createObjectURL(p.thumbnail);
    state.thumbUrls.set(p.id,{blob:p.thumbnail,url});
    return url;
  }catch{return ''}
}
function photoCard(p){const u=thumbURL(p),tags=p.tags||[];return `<article class="photo-card ${state.selected.has(p.id)?'selected':''}" data-id="${p.id}"><div class="thumb">${u?`<img src="${u}" alt="">`:'<span class="fallback">▧</span>'}<button class="check">${state.selected.has(p.id)?'✓':''}</button></div><div class="card-body"><div><div class="filename">${esc(p.fileName)}</div><div class="meta">${esc(niceDate(p))}</div></div><div class="tags">${tags.slice(0,3).map(t=>`<span class="tag-mini">${esc(t)}</span>`).join('')}${tags.length>3?`<span class="tag-more">+${tags.length-3}</span>`:''}</div></div></article>`}
function renderTags(){const inc=[...state.activeTags].map(t=>`<span class="chip active">${esc(t)} <button data-inc="${esc(t)}">×</button></span>`),exc=[...state.excludedTags].map(t=>`<span class="chip exclude">nicht ${esc(t)} <button data-exc="${esc(t)}">×</button></span>`);$('#activeTagChips').innerHTML=[...inc,...exc].join('');$$('[data-inc]').forEach(b=>b.onclick=()=>{removeEq(state.activeTags,b.dataset.inc);renderLibrary()});$$('[data-exc]').forEach(b=>b.onclick=()=>{removeEq(state.excludedTags,b.dataset.exc);renderLibrary()});$('#tagSuggestions').innerHTML=allTags().map(t=>`<option value="${esc(t)}"></option>`).join('')}
function removeEq(set,t){const k=norm(t);for(const x of [...set])if(norm(x)===k)set.delete(x)}
function renderProjectFilter(){const s=$('#projectFilter'),v=state.projectFilterId;s.innerHTML='<option value="">Alle Fotos</option>'+state.projects.slice().sort((a,b)=>a.name.localeCompare(b.name,'de')).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');s.value=v}
function renderQuick(){const q=state.favorites.filter(f=>f.quick).sort((a,b)=>(a.quickOrder??999)-(b.quickOrder??999)),b=$('#quickbar');b.classList.toggle('show',!!q.length);b.innerHTML=q.length?'<span class="quick-label">Schnellfilter</span>'+q.map(f=>`<button class="quick-btn" data-q="${f.id}">${esc(f.name)}</button>`).join(''):'';$$('[data-q]').forEach(x=>x.onclick=()=>applyFilter(state.favorites.find(f=>f.id===x.dataset.q).filter))}
function renderLibrary(){renderTags();renderQuick();renderProjectFilter();const a=filtered(),slice=a.slice(0,state.renderLimit);$('#resultCount').textContent=`${fmt.format(a.length)} ${a.length===1?'Foto':'Fotos'}`;const c=$('#libraryContent');if(!state.libraries.length){c.innerHTML=`<div class="empty"><h2>Google-Drive-Fotoordner hinzufügen</h2><p>Die PWA speichert Tags, Favoriten und Fotoabende auf diesem Tablet. Die Originalfotos bleiben in Google Drive.</p><button class="btn primary" id="emptyDrive">☁ Google Drive verbinden</button></div>`;$('#emptyDrive').onclick=()=>{if(tokenValid())chooseDriveFolder();else connectDrive('choose-folder')};return}if(!a.length){c.innerHTML=`<div class="empty"><h2>Keine Fotos gefunden</h2><p>Für die aktuellen Filter gibt es keine Treffer.</p><button class="btn" id="clearFiltersBtn">Filter zurücksetzen</button></div>`;$('#clearFiltersBtn').onclick=clearFilters;return}c.innerHTML=`<div class="gallery ${state.listView?'list':''}" id="gallery">${slice.map(photoCard).join('')}</div>${a.length>slice.length?'<div style="text-align:center;padding:18px"><button class="btn" id="morePhotos">Weitere anzeigen</button></div>':''}`;$$('#gallery .photo-card').forEach(x=>x.onclick=()=>toggleSelect(x.dataset.id));$('#morePhotos')?.addEventListener('click',()=>{state.renderLimit+=PAGE_SIZE;renderLibrary()});hydrateThumbs(slice)}
function toggleSelect(id){state.selected.has(id)?state.selected.delete(id):state.selected.add(id);renderLibrary();renderSelection()}
function renderSelection(){const n=state.selected.size;$('#selectionBar').classList.toggle('show',n>0);$('#selectionCount').textContent=`${n} ausgewählt`}
async function addBulk(){const tags=splitTags($('#bulkTagInput').value);if(!tags.length)return;const ch=[];for(const p of state.photos)if(state.selected.has(p.id)){for(const t of tags)if(!p.tags.some(x=>norm(x)===norm(t)))p.tags.push(t);ch.push(p)}await putMany('photos',ch);$('#bulkTagInput').value='';renderAll();toast('Tag(s) hinzugefügt.')}
function removeBulkMenu(){const m=new Map();state.photos.filter(p=>state.selected.has(p.id)).forEach(p=>p.tags.forEach(t=>m.set(t,(m.get(t)||0)+1)));openModal(`<h2>Tag entfernen</h2><div class="cards">${[...m].map(([t,n])=>`<button class="btn" data-rm="${esc(t)}">${esc(t)} · ${n}</button>`).join('')}</div><div class="modal-footer"><button class="btn" id="modalClose">Schließen</button></div>`);$('#modalClose').onclick=closeModal;$$('[data-rm]').forEach(b=>b.onclick=async()=>{const ch=[];for(const p of state.photos)if(state.selected.has(p.id)){p.tags=p.tags.filter(t=>norm(t)!==norm(b.dataset.rm));ch.push(p)}await putMany('photos',ch);closeModal();renderAll()})}

function currentFilter(){return{search:state.search,tags:[...state.activeTags],excludeTags:[...state.excludedTags],tagMode:state.tagMode,yearFrom:state.yearFrom,yearTo:state.yearTo,tagState:state.tagState,projectFilterId:state.projectFilterId,sort:state.sort}}
function summary(f){const a=[];if(f.tags?.length)a.push((f.tagMode==='or'?'einer von: ':'alle: ')+f.tags.join(f.tagMode==='or'?' / ':' + '));if(f.excludeTags?.length)a.push('ohne '+f.excludeTags.join(', '));if(f.yearFrom||f.yearTo)a.push(`${f.yearFrom||'…'}–${f.yearTo||'…'}`);if(f.projectFilterId){const p=state.projects.find(x=>x.id===f.projectFilterId);if(p)a.push(`Fotoabend „${p.name}“`)}return a.join(' · ')||'Alle Fotos'}
async function saveFilter(){const f=currentFilter();openModal(`<h2>Filter speichern</h2><input class="field" id="favName" placeholder="Name"><label style="display:flex;gap:8px;margin-top:12px"><input type="checkbox" id="favQuick"> Als Schnellfilter anzeigen</label><div class="modal-footer"><button class="btn" id="modalClose">Abbrechen</button><button class="btn primary" id="favSave">Speichern</button></div>`);$('#modalClose').onclick=closeModal;$('#favSave').onclick=async()=>{const n=$('#favName').value.trim();if(!n)return;const o={id:uid(),name:n,filter:f,quick:$('#favQuick').checked,quickOrder:state.favorites.filter(x=>x.quick).length,createdAt:Date.now()};state.favorites.push(o);await put('favorites',o);closeModal();renderAll();toast('Favorit gespeichert.')}}
function applyFilter(f){state.search=f.search||'';state.activeTags=new Set(f.tags||[]);state.excludedTags=new Set(f.excludeTags||[]);state.tagMode=f.tagMode==='or'?'or':'and';state.yearFrom=f.yearFrom||'';state.yearTo=f.yearTo||'';state.tagState=f.tagState||'all';state.projectFilterId=f.projectFilterId||'';state.sort=f.sort||'dateDesc';syncControls();switchView('library')}
function clearFilters(){state.search='';state.activeTags.clear();state.excludedTags.clear();state.tagMode='and';state.yearFrom='';state.yearTo='';state.tagState='all';state.projectFilterId='';syncControls();renderLibrary()}
function countFilter(f){const b={search:state.search,activeTags:state.activeTags,excludedTags:state.excludedTags,tagMode:state.tagMode,yearFrom:state.yearFrom,yearTo:state.yearTo,tagState:state.tagState,projectFilterId:state.projectFilterId,sort:state.sort};Object.assign(state,{search:f.search||'',activeTags:new Set(f.tags||[]),excludedTags:new Set(f.excludeTags||[]),tagMode:f.tagMode==='or'?'or':'and',yearFrom:f.yearFrom||'',yearTo:f.yearTo||'',tagState:f.tagState||'all',projectFilterId:f.projectFilterId||'',sort:f.sort||'dateDesc'});const n=filtered().length;Object.assign(state,b);return n}
function renderFavorites(){const c=$('#favoritesContent');if(!state.favorites.length){c.innerHTML='<div class="empty"><h2>Noch keine Favoriten</h2><p>Speichere in der Bibliothek einen Filter.</p></div>';return}c.innerHTML=`<div class="cards">${state.favorites.slice().sort((a,b)=>a.name.localeCompare(b.name,'de')).map(f=>`<div class="simple-card"><h3>${f.quick?'★ ':''}${esc(f.name)}</h3><p>${esc(summary(f.filter))}</p><p style="margin-top:7px"><strong>${countFilter(f.filter)}</strong> Treffer</p><div class="actions"><button class="btn small primary" data-openfav="${f.id}">Öffnen</button><button class="btn small" data-favmenu="${f.id}">⋯</button></div></div>`).join('')}</div>`;$$('[data-openfav]').forEach(b=>b.onclick=()=>applyFilter(state.favorites.find(f=>f.id===b.dataset.openfav).filter));$$('[data-favmenu]').forEach(b=>b.onclick=()=>favMenu(b.dataset.favmenu))}
function favMenu(id){const f=state.favorites.find(x=>x.id===id);openModal(`<h2>${esc(f.name)}</h2><div style="display:grid;gap:8px"><button class="btn" id="editFav">Bearbeiten</button><button class="btn" id="toggleQuick">${f.quick?'Aus Schnellfiltern entfernen':'Als Schnellfilter anzeigen'}</button><button class="btn danger" id="delFav">Löschen</button></div><div class="modal-footer"><button class="btn" id="modalClose">Schließen</button></div>`);$('#modalClose').onclick=closeModal;$('#editFav').onclick=()=>editFav(id);$('#toggleQuick').onclick=async()=>{f.quick=!f.quick;if(f.quick)f.quickOrder=state.favorites.filter(x=>x.quick).length;await put('favorites',f);closeModal();renderAll()};$('#delFav').onclick=async()=>{await del('favorites',id);state.favorites=state.favorites.filter(x=>x.id!==id);closeModal();renderAll()}}
function editFav(id){const f=state.favorites.find(x=>x.id===id),fl=f.filter||{};openModal(`<h2>Favorit bearbeiten</h2><label><span class="mini-label">Name</span><input class="field" id="efName" value="${esc(f.name)}"></label><label><span class="mini-label">Tags einschließen</span><input class="field" id="efTags" value="${esc((fl.tags||[]).join(', '))}"></label><label><span class="mini-label">Verknüpfung</span><select class="field" id="efMode"><option value="and" ${fl.tagMode!=='or'?'selected':''}>UND</option><option value="or" ${fl.tagMode==='or'?'selected':''}>ODER</option></select></label><label><span class="mini-label">Tags ausschließen</span><input class="field" id="efEx" value="${esc((fl.excludeTags||[]).join(', '))}"></label><div class="modal-footer"><button class="btn" id="modalClose">Abbrechen</button><button class="btn primary" id="efSave">Speichern</button></div>`);$('#modalClose').onclick=closeModal;$('#efSave').onclick=async()=>{f.name=$('#efName').value.trim()||f.name;f.filter={...fl,tags:splitTags($('#efTags').value),excludeTags:splitTags($('#efEx').value),tagMode:$('#efMode').value};await put('favorites',f);closeModal();renderAll()}}
async function moveQuick(id,d){const q=state.favorites.filter(x=>x.quick).sort((a,b)=>(a.quickOrder??999)-(b.quickOrder??999)),i=q.findIndex(x=>x.id===id),j=i+d;if(j<0||j>=q.length)return;[q[i],q[j]]=[q[j],q[i]];for(let k=0;k<q.length;k++){q[k].quickOrder=k;await put('favorites',q[k])}manageQuick()}
function manageQuick(){const q=state.favorites.filter(x=>x.quick).sort((a,b)=>(a.quickOrder??999)-(b.quickOrder??999)),avail=state.favorites.filter(x=>!x.quick);openModal(`<h2>Schnellfilter verwalten</h2>${q.map((f,i)=>`<div class="library-row"><div class="name">${esc(f.name)}</div><div class="row-actions"><button class="btn small" data-up="${f.id}">↑</button><button class="btn small" data-down="${f.id}">↓</button><button class="btn small" data-unpin="${f.id}">Entfernen</button></div></div>`).join('')||'<p class="muted">Noch keine Schnellfilter.</p>'}${avail.length?`<select class="field" id="pinFav"><option value="">Favorit hinzufügen …</option>${avail.map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select>`:''}<div class="modal-footer"><button class="btn" id="modalClose">Fertig</button></div>`);$('#modalClose').onclick=closeModal;$$('[data-up]').forEach(b=>b.onclick=()=>moveQuick(b.dataset.up,-1));$$('[data-down]').forEach(b=>b.onclick=()=>moveQuick(b.dataset.down,1));$$('[data-unpin]').forEach(b=>b.onclick=async()=>{const f=state.favorites.find(x=>x.id===b.dataset.unpin);f.quick=false;await put('favorites',f);manageQuick();renderLibrary()});$('#pinFav')?.addEventListener('change',async e=>{const f=state.favorites.find(x=>x.id===e.target.value);if(f){f.quick=true;f.quickOrder=q.length;await put('favorites',f);manageQuick();renderLibrary()}})}

function projectChoice(){const ids=[...state.selected];openModal(`<h2>Fotoabend</h2><div style="display:grid;gap:8px"><button class="btn primary" id="newPr">Neuen Fotoabend erstellen</button>${state.projects.length?'<button class="btn" id="addPr">Zu bestehendem Fotoabend hinzufügen</button>':''}</div><div class="modal-footer"><button class="btn" id="modalClose">Abbrechen</button></div>`);$('#modalClose').onclick=closeModal;$('#newPr').onclick=()=>newProject(ids);$('#addPr')?.addEventListener('click',()=>chooseProject(ids))}
function newProject(ids){openModal(`<h2>Neuer Fotoabend</h2><input class="field" id="prName" placeholder="Name"><div class="modal-footer"><button class="btn" id="modalClose">Abbrechen</button><button class="btn primary" id="prSave">Erstellen</button></div>`);$('#modalClose').onclick=closeModal;$('#prSave').onclick=async()=>{const n=$('#prName').value.trim();if(!n)return;const p={id:uid(),name:n,photoIds:[...new Set(ids)],createdAt:Date.now(),updatedAt:Date.now()};state.projects.push(p);await put('projects',p);state.selected.clear();closeModal();state.activeProjectId=p.id;switchView('projects')}}
function chooseProject(ids){openModal(`<h2>Zu Fotoabend hinzufügen</h2><div class="cards">${state.projects.map(p=>`<button class="btn" data-addpr="${p.id}">${esc(p.name)} · ${p.photoIds.length}</button>`).join('')}</div><div class="modal-footer"><button class="btn" id="modalClose">Abbrechen</button></div>`);$('#modalClose').onclick=closeModal;$$('[data-addpr]').forEach(b=>b.onclick=async()=>{const p=state.projects.find(x=>x.id===b.dataset.addpr),set=new Set(p.photoIds),add=ids.filter(x=>!set.has(x));p.photoIds.push(...add);p.updatedAt=Date.now();await put('projects',p);state.selected.clear();closeModal();renderAll();toast(`${add.length} Foto(s) hinzugefügt.`)})}
function renderProjects(){const c=$('#projectsContent'),p=state.projects.find(x=>x.id===state.activeProjectId);if(p)return renderProjectEditor(p);c.innerHTML=`<div class="page-title"><div><h1>Fotoabende</h1><p>Feste Zusammenstellungen mit eigener Reihenfolge.</p></div></div>${state.projects.length?`<div class="cards">${state.projects.slice().sort((a,b)=>b.updatedAt-a.updatedAt).map(x=>`<div class="simple-card"><h3>${esc(x.name)}</h3><p>${x.photoIds.length} Fotos</p><div class="actions"><button class="btn small primary" data-openpr="${x.id}">Öffnen</button><button class="btn small" data-prmenu="${x.id}">⋯</button></div></div>`).join('')}</div>`:'<div class="empty"><h2>Noch kein Fotoabend</h2><p>Wähle Fotos in der Bibliothek aus.</p></div>'}`;$$('[data-openpr]').forEach(b=>b.onclick=()=>{state.activeProjectId=b.dataset.openpr;renderProjects()});$$('[data-prmenu]').forEach(b=>b.onclick=()=>projectMenu(b.dataset.prmenu))}
function projectMenu(id){const p=state.projects.find(x=>x.id===id);openModal(`<h2>${esc(p.name)}</h2><div style="display:grid;gap:8px"><button class="btn" id="renPr">Umbenennen</button><button class="btn" id="dupPr">Duplizieren</button><button class="btn" id="filterPr">In Bibliothek anzeigen</button><button class="btn danger" id="delPr">Löschen</button></div><div class="modal-footer"><button class="btn" id="modalClose">Schließen</button></div>`);$('#modalClose').onclick=closeModal;$('#renPr').onclick=()=>renameProject(id);$('#dupPr').onclick=async()=>{const q={...p,id:uid(),name:`${p.name} – Kopie`,photoIds:[...p.photoIds],createdAt:Date.now(),updatedAt:Date.now()};state.projects.push(q);await put('projects',q);closeModal();renderAll()};$('#filterPr').onclick=()=>{closeModal();clearFilters();state.projectFilterId=id;syncControls();switchView('library')};$('#delPr').onclick=async()=>{await del('projects',id);state.projects=state.projects.filter(x=>x.id!==id);closeModal();renderAll()}}
function renameProject(id){const p=state.projects.find(x=>x.id===id);openModal(`<h2>Fotoabend umbenennen</h2><input class="field" id="renName" value="${esc(p.name)}"><div class="modal-footer"><button class="btn" id="modalClose">Abbrechen</button><button class="btn primary" id="renSave">Speichern</button></div>`);$('#modalClose').onclick=closeModal;$('#renSave').onclick=async()=>{p.name=$('#renName').value.trim()||p.name;p.updatedAt=Date.now();await put('projects',p);closeModal();renderAll()}}
function renderProjectEditor(p){const photos=p.photoIds.map(id=>state.photos.find(x=>x.id===id)).filter(Boolean);$('#projectsContent').innerHTML=`<div class="project-head"><button class="btn" id="backPr">← Fotoabende</button><div><strong>${esc(p.name)}</strong><div class="muted">${photos.length} Fotos</div></div><span class="spacer"></span><button class="btn" id="renPrTop">Umbenennen</button><button class="btn primary" id="zipPr">ZIP exportieren</button></div><div class="filmstrip">${photos.map((x,i)=>filmItem(x,i)).join('')}</div>`;$('#backPr').onclick=()=>{state.activeProjectId=null;renderProjects()};$('#renPrTop').onclick=()=>renameProject(p.id);$('#zipPr').onclick=()=>exportProject(p);$$('[data-left]').forEach(b=>b.onclick=()=>moveProjectPhoto(p,b.dataset.left,-1));$$('[data-right]').forEach(b=>b.onclick=()=>moveProjectPhoto(p,b.dataset.right,1));$$('[data-remove]').forEach(b=>b.onclick=async()=>{p.photoIds=p.photoIds.filter(x=>x!==b.dataset.remove);p.updatedAt=Date.now();await put('projects',p);renderProjects()});hydrateThumbs(photos)}
function filmItem(p,i){const u=thumbURL(p);return `<div class="film-item"><span class="order">${String(i+1).padStart(2,'0')}</span><div class="thumb">${u?`<img src="${u}">`:'<span class="fallback">▧</span>'}</div><div class="name">${esc(p.fileName)}</div><div class="film-actions"><button data-left="${p.id}">←</button><button data-right="${p.id}">→</button><button data-remove="${p.id}">×</button></div></div>`}
async function moveProjectPhoto(p,id,d){const i=p.photoIds.indexOf(id),j=i+d;if(j<0||j>=p.photoIds.length)return;[p.photoIds[i],p.photoIds[j]]=[p.photoIds[j],p.photoIds[i]];p.updatedAt=Date.now();await put('projects',p);renderProjects()}
function u16(n){return new Uint8Array([n&255,n>>>8&255])}function u32(n){return new Uint8Array([n&255,n>>>8&255,n>>>16&255,n>>>24&255])}function concat(a){let n=a.reduce((s,x)=>s+x.length,0),o=new Uint8Array(n),p=0;for(const x of a){o.set(x,p);p+=x.length}return o}let crcT;function crc32(b){if(!crcT){crcT=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;crcT[n]=c>>>0}}let c=-1;for(const x of b)c=(c>>>8)^crcT[(c^x)&255];return(c^-1)>>>0}function dos(d=new Date()){const y=Math.max(1980,d.getFullYear());return{t:(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1),d:((y-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate()}}
async function makeZip(entries){const enc=new TextEncoder(),chunks=[],central=[];let off=0;for(let i=0;i<entries.length;i++){toast(`ZIP: ${i+1} von ${entries.length}`,900);const e=entries[i],name=enc.encode(e.name),data=new Uint8Array(await e.blob.arrayBuffer()),crc=crc32(data),dt=dos(new Date());const local=concat([u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(dt.t),u16(dt.d),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name]);chunks.push(local,data);central.push(concat([u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(dt.t),u16(dt.d),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(off),name]));off+=local.length+data.length}const cs=central.reduce((s,x)=>s+x.length,0),eocd=concat([u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(cs),u32(off),u16(0)]);return new Blob([...chunks,...central,eocd],{type:'application/zip'})}
async function exportProject(p){busy(true);try{const photos=p.photoIds.map(id=>state.photos.find(x=>x.id===id)).filter(Boolean),digits=Math.max(3,String(photos.length).length),entries=[];for(let i=0;i<photos.length;i++)entries.push({name:`${String(i+1).padStart(digits,'0')}__${photos[i].fileName}`,blob:await driveBlob(photos[i],false)});const z=await makeZip(entries),u=URL.createObjectURL(z),a=document.createElement('a');a.href=u;a.download=`Fotoabend_${p.name.replace(/[\\/:*?"<>|]+/g,'_')}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(u),30000);toast('ZIP erstellt.')}catch(e){console.error(e);toast(`Export fehlgeschlagen: ${e.message}`,5000)}finally{busy(false)}}

function renderDashboard(){const total=state.photos.length,tagged=state.photos.filter(p=>p.tags.length).length,counts=new Map();state.photos.forEach(p=>new Set(p.tags).forEach(t=>counts.set(t,(counts.get(t)||0)+1)));const top=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,12);$('#dashboardContent').innerHTML=`<div class="metric-grid"><div class="metric"><div class="value">${fmt.format(total)}</div><div class="name">Fotos</div></div><div class="metric"><div class="value">${total?(tagged/total*100).toFixed(1).replace('.',','):0} %</div><div class="name">mit Tags</div></div><div class="metric"><div class="value">${fmt.format(total-tagged)}</div><div class="name">ohne Tags</div></div><div class="metric"><div class="value">${fmt.format(counts.size)}</div><div class="name">Tags</div></div></div><div class="panel"><h2>Häufigste Tags</h2>${top.map(([t,n])=>`<div class="tag-stat" data-dash="${esc(t)}"><div>${esc(t)}</div><div class="bar"><div style="width:${total?n/total*100:0}%"></div></div><div class="number">${n} · ${total?(n/total*100).toFixed(1).replace('.',','):0}%</div></div>`).join('')||'<p class="muted">Noch keine Tags.</p>'}</div>`;$$('[data-dash]').forEach(x=>x.onclick=()=>{clearFilters();state.activeTags.add(x.dataset.dash);switchView('library')})}
function librariesMenu(){openModal(`<h2>Fotoquellen</h2>${state.libraries.map(l=>`<div class="library-row"><div><div class="name">☁ ${esc(l.name)}</div><div class="smalltxt">${state.photos.filter(p=>p.libraryId===l.id).length} Fotos${l.lastScanAt?` · aktualisiert ${fmtDate.format(new Date(l.lastScanAt))}`:''}</div></div><div class="row-actions"><button class="btn small" data-scan="${l.id}">Aktualisieren</button><button class="btn small" data-rechoose="${l.id}">Ordner neu wählen</button><button class="btn small" data-dellib="${l.id}">Entfernen</button></div></div>`).join('')||'<p class="muted">Noch keine Drive-Ordner.</p>'}<div class="modal-footer"><button class="btn" id="modalClose">Schließen</button><button class="btn primary" id="addLib">☁ Drive-Ordner hinzufügen</button></div>`);$('#modalClose').onclick=closeModal;$('#addLib').onclick=()=>chooseDriveFolder();$$('[data-scan]').forEach(b=>b.onclick=()=>{closeModal();scanDriveLibrary(b.dataset.scan)});$$('[data-rechoose]').forEach(b=>b.onclick=()=>chooseDriveFolder(b.dataset.rechoose));$$('[data-dellib]').forEach(b=>b.onclick=async()=>{const id=b.dataset.dellib;if(!confirm('Fotoquelle aus dem Katalog entfernen? Die Originalfotos in Drive bleiben erhalten.'))return;const photos=state.photos.filter(p=>p.libraryId===id);for(const p of photos)await del('photos',p.id);await del('libraries',id);closeModal();await loadData()})}
function help(){openModal(`<h2>Einführung</h2><div class="panel"><strong>1. Google Drive verbinden</strong><p class="muted">Einmal anmelden und einen Fotoordner auswählen.</p></div><div class="panel"><strong>2. Tags vergeben</strong><p class="muted">Mehrere Fotos markieren und Tags hinzufügen.</p></div><div class="panel"><strong>3. Wiederfinden</strong><p class="muted">UND, ODER und Ausschluss-Tags kombinieren; wichtige Filter als Favorit speichern.</p></div><div class="panel"><strong>4. Fotoabend</strong><p class="muted">Fotos auswählen, Reihenfolge bestimmen und nummerierte Kopien als ZIP herunterladen.</p></div><div class="panel"><strong>Bitte nicht</strong><p class="muted">Nicht das Google-Drive-Original für einen Fotoabend umbenennen. Nicht den Browser-/App-Speicher löschen, ohne vorher eine Katalogsicherung zu erstellen.</p></div><div class="modal-footer"><button class="btn" id="modalClose">Schließen</button></div>`);$('#modalClose').onclick=closeModal}
function backup(){const data={version:4,appVersion:APP_VERSION,createdAt:new Date().toISOString(),photos:state.photos.map(({thumbnail,...p})=>p),libraries:state.libraries,favorites:state.favorites,projects:state.projects},b=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=`fotoarchiv-katalog-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);toast('Katalog-Sicherung erstellt.')}
async function restore(file){try{const d=JSON.parse(await file.text());if(!Array.isArray(d.photos))throw new Error('Ungültige Sicherung');const libMap=new Map();for(const l of d.libraries||[]){let ex=state.libraries.find(x=>x.driveFolderId&&x.driveFolderId===l.driveFolderId);if(!ex){ex={...l,id:uid(),sourceType:'drive'};state.libraries.push(ex);await put('libraries',ex)}libMap.set(l.id,ex.id)}const idMap=new Map(),ch=[];for(const raw of d.photos){let ex=state.photos.find(x=>x.driveFileId&&x.driveFileId===raw.driveFileId);if(ex){ex.tags=[...new Map([...ex.tags,...rawTags(raw.tags)].map(t=>[norm(t),clean(t)])).values()];ch.push(ex);idMap.set(raw.id,ex.id)}else{const p={...raw,id:uid(),libraryId:libMap.get(raw.libraryId)||null,thumbnail:null,missing:true};state.photos.push(p);ch.push(p);idMap.set(raw.id,p.id)}}await putMany('photos',ch);for(const f of d.favorites||[]){const x={...f,id:uid()};state.favorites.push(x);await put('favorites',x)}for(const p of d.projects||[]){const x={...p,id:uid(),photoIds:(p.photoIds||[]).map(i=>idMap.get(i)).filter(Boolean)};state.projects.push(x);await put('projects',x)}await loadData();toast('Sicherung eingelesen. Drive-Ordner anschließend aktualisieren.',4500)}catch(e){console.error(e);toast('Sicherung konnte nicht gelesen werden.',4500)}}
function moreMenu(){openModal(`<h2>Weitere Optionen</h2><div style="display:grid;gap:8px"><button class="btn" id="libMenu">Fotoquellen verwalten</button><button class="btn" id="refreshAll">Alle Drive-Ordner aktualisieren</button><button class="btn" id="backup">Katalog sichern</button><button class="btn" id="restore">Katalog aus Sicherung laden</button><button class="btn" id="quick">Schnellfilter verwalten</button><button class="btn" id="help">Einführung & Hilfe</button></div><div class="modal-footer"><button class="btn" id="modalClose">Schließen</button></div>`);$('#modalClose').onclick=closeModal;$('#libMenu').onclick=librariesMenu;$('#refreshAll').onclick=async()=>{closeModal();for(const l of state.libraries)await scanDriveLibrary(l.id)};$('#backup').onclick=()=>{closeModal();backup()};$('#restore').onclick=()=>$('#restoreInput').click();$('#quick').onclick=manageQuick;$('#help').onclick=help}
function switchView(v){state.activeView=v;$$('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${v}`));$$('nav button').forEach(x=>x.classList.toggle('active',x.dataset.view===v));if(v==='library')renderLibrary();if(v==='favorites')renderFavorites();if(v==='projects')renderProjects();if(v==='dashboard')renderDashboard()}
function syncControls(){$('#searchInput').value=state.search;$('#tagModeSelect').value=state.tagMode;$('#yearFrom').value=state.yearFrom;$('#yearTo').value=state.yearTo;$('#tagState').value=state.tagState;$('#sortSelect').value=state.sort;renderProjectFilter();$('#projectFilter').value=state.projectFilterId}
function renderAll(){renderLibrary();renderFavorites();renderProjects();renderDashboard();renderSelection();renderDriveButton()}
function bind(){
  $$('nav button').forEach(b=>b.onclick=()=>switchView(b.dataset.view));$('#installBtn').onclick=installApp;$('#driveBtn').onclick=driveMenu;$('#moreBtn').onclick=moreMenu;$('#addDriveFolderBtn').onclick=()=>{if(tokenValid())chooseDriveFolder();else connectDrive('choose-folder')};$('#modalBack').onclick=e=>{if(e.target===$('#modalBack'))closeModal()};
  $('#searchInput').oninput=e=>{state.search=e.target.value;renderLibrary()};
  const addTag=(input,mode)=>{const ts=splitTags(input.value);for(const t of ts){removeEq(mode==='inc'?state.excludedTags:state.activeTags,t);const s=mode==='inc'?state.activeTags:state.excludedTags;removeEq(s,t);s.add(t)}input.value='';renderLibrary()};
  $('#filterTagInput').onkeydown=e=>{if(e.key==='Enter'||e.key===','){e.preventDefault();addTag(e.target,'inc')}};$('#excludeTagInput').onkeydown=e=>{if(e.key==='Enter'||e.key===','){e.preventDefault();addTag(e.target,'exc')}};$('#tagModeSelect').onchange=e=>{state.tagMode=e.target.value;renderLibrary()};$('#yearFrom').oninput=e=>{state.yearFrom=e.target.value;renderLibrary()};$('#yearTo').oninput=e=>{state.yearTo=e.target.value;renderLibrary()};$('#tagState').onchange=e=>{state.tagState=e.target.value;renderLibrary()};$('#projectFilter').onchange=e=>{state.projectFilterId=e.target.value;renderLibrary()};$('#sortSelect').onchange=e=>{state.sort=e.target.value;renderLibrary()};$('#viewToggle').onclick=()=>{state.listView=!state.listView;renderLibrary()};$('#saveFilterBtn').onclick=saveFilter;$('#manageQuickFilters').onclick=manageQuick;
  $('#bulkTagAdd').onclick=addBulk;$('#bulkTagInput').onkeydown=e=>{if(e.key==='Enter')addBulk()};$('#bulkTagRemove').onclick=removeBulkMenu;$('#createProjectBtn').onclick=projectChoice;$('#clearSelection').onclick=()=>{state.selected.clear();renderLibrary();renderSelection()};$('#restoreInput').onchange=e=>{const f=e.target.files?.[0];if(f)restore(f);e.target.value=''};
}
async function init(){if(window.matchMedia?.('(display-mode: standalone)').matches)$('#installBtn').hidden=true;if(!window.isSecureContext)$('#httpsNotice').hidden=false;sessionStorage.removeItem('fa_drive_token');sessionStorage.removeItem('fa_drive_exp');state.db=await openDB();bind();await loadData();syncControls();if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(console.error);if(!localStorage.getItem('fa_intro_seen')){localStorage.setItem('fa_intro_seen','1');setTimeout(help,450)}}
init().catch(e=>{console.error(e);toast('Fotoarchiv konnte nicht gestartet werden.',5000)});
})();
