(()=>{'use strict';
const $=s=>document.querySelector(s),origin=location.origin,redirect=new URL('./oauth-callback.html',location.href).href;
$('#origin').textContent=origin;$('#redirect').textContent=redirect;
let saved={};try{saved=JSON.parse(localStorage.getItem('fa_runtime_config')||'{}')||{}}catch{}
const defaults=window.FOTOARCHIV_CONFIG||{};$('#clientId').value=saved.googleClientId||defaults.googleClientId||'';$('#broker').value=saved.oauthBrokerUrl||defaults.oauthBrokerUrl||'';
function status(t,good=false){$('#status').innerHTML=`<div class="${good?'good':'note'}">${t}</div>`}
document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>{const text=$('#'+b.dataset.copy).textContent;try{await navigator.clipboard.writeText(text);b.textContent='Kopiert ✓';setTimeout(()=>b.textContent='Kopieren',1200)}catch{status('Kopieren nicht möglich. Bitte den Wert markieren und manuell kopieren.')}});
$('#save').onclick=()=>{const googleClientId=$('#clientId').value.trim(),oauthBrokerUrl=$('#broker').value.trim().replace(/\/$/,'');if(!googleClientId||!oauthBrokerUrl){status('Bitte Client-ID und Worker-URL eintragen.');return}localStorage.setItem('fa_runtime_config',JSON.stringify({googleClientId,oauthBrokerUrl}));status('Einrichtung auf diesem Gerät gespeichert.',true)};
$('#testWorker').onclick=async()=>{const u=$('#broker').value.trim().replace(/\/$/,'');if(!u){status('Bitte zuerst die Worker-URL eintragen.');return}try{const r=await fetch(u+'/health');const d=await r.json().catch(()=>({}));if(r.ok&&d.ok)status('Der OAuth-Broker ist erreichbar.',true);else status('Der Worker antwortet, aber nicht wie erwartet.')}catch(e){status('Der Worker konnte nicht erreicht werden. Prüfe die URL und die Cloudflare-Einrichtung.')}};
})();
