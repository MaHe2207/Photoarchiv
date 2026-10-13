(()=>{'use strict';
let saved={};try{saved=JSON.parse(localStorage.getItem('fa_runtime_config')||'{}')||{}}catch{};const cfg={...(window.FOTOARCHIV_CONFIG||{}),...saved};
const $=s=>document.querySelector(s);
const msg=(t,error=false)=>{const e=$('#message');e.textContent=t;if(error)e.style.color='#b42318'};
function brokerBase(){return String(cfg.oauthBrokerUrl||'').trim().replace(/\/$/,'')}
async function main(){
  const q=new URLSearchParams(location.search),error=q.get('error'),code=q.get('code'),returnedState=q.get('state');
  if(error)throw new Error(q.get('error_description')||error);
  const expectedState=sessionStorage.getItem('fa_oauth_state')||'',verifier=sessionStorage.getItem('fa_oauth_verifier')||'';
  if(!code)throw new Error('Google hat keinen Autorisierungscode zurückgegeben.');
  if(!expectedState||!returnedState||expectedState!==returnedState)throw new Error('Die Anmeldung konnte aus Sicherheitsgründen nicht bestätigt werden (state stimmt nicht überein).');
  if(!verifier)throw new Error('Der PKCE-Sicherheitscode fehlt. Bitte die Google-Anmeldung erneut starten.');
  const broker=brokerBase();if(!broker)throw new Error('Der OAuth-Broker ist in config.js noch nicht eingetragen.');
  const redirectUri=new URL('./oauth-callback.html',location.href).href.split('?')[0].split('#')[0];
  const r=await fetch(`${broker}/exchange`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,code_verifier:verifier,redirect_uri:redirectUri})});
  const data=await r.json().catch(()=>({}));
  if(!r.ok||!data.access_token)throw new Error(data.error||data.error_description||`Token-Austausch fehlgeschlagen (${r.status}).`);
  const exp=Date.now()+Number(data.expires_in||3600)*1000;
  sessionStorage.setItem('fa_drive_token',data.access_token);
  sessionStorage.setItem('fa_drive_exp',String(exp));
  sessionStorage.removeItem('fa_oauth_state');sessionStorage.removeItem('fa_oauth_verifier');
  const ret=sessionStorage.getItem('fa_oauth_return')||'./';sessionStorage.removeItem('fa_oauth_return');
  msg('Google Drive ist verbunden. Du wirst zum Fotoarchiv zurückgebracht.');
  location.replace(ret+(ret.includes('?')?'&':'?')+'oauth=ok');
}
main().catch(e=>{console.error(e);$('#spinner').hidden=true;msg(e.message||'Die Anmeldung konnte nicht abgeschlossen werden.',true);$('#backBtn').hidden=false;$('#backBtn').onclick=()=>location.href='./';});
})();