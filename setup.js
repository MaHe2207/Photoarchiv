(()=>{'use strict';
const $=s=>document.querySelector(s);
const origin=location.origin;
$('#origin').textContent=origin;
let saved={};try{saved=JSON.parse(localStorage.getItem('fa_runtime_config')||'{}')||{}}catch{}
const defaults=window.FOTOARCHIV_CONFIG||{};
$('#clientId').value=saved.googleClientId||defaults.googleClientId||'';
$('#copyOrigin').onclick=async()=>{try{await navigator.clipboard.writeText(origin);$('#copyOrigin').textContent='Kopiert ✓'}catch{$('#status').textContent='Bitte die Adresse manuell markieren.'}};
$('#save').onclick=()=>{
 const googleClientId=$('#clientId').value.trim();
 if(!/^[\w-]+\.apps\.googleusercontent\.com$/.test(googleClientId)){$('#status').textContent='Bitte eine gültige Google Client-ID eingeben.';return}
 localStorage.setItem('fa_runtime_config',JSON.stringify({googleClientId}));
 $('#status').textContent='Gespeichert. Du kannst das Fotoarchiv jetzt öffnen.';
};
})();
