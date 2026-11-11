import {finishPasserelleConnection} from '/passerelle/passerelle-connect.js';
const status=document.querySelector('#status');
try{
  let adapter,accountKey;
  const calendars=await finishPasserelleConnection({getAccountKey:async()=>{
    adapter=await import('/passerelle/lapsus-adapter.js');
    accountKey=await adapter.getCurrentAccountKey();return accountKey;
  }});
  // Implement this adapter in Lapsus using its authenticated account storage.
  // Do not log calendars: their URLs are private bearer capabilities.
  await adapter.savePasserelleCalendars(calendars,{expectedAccountKey:accountKey});
  status.textContent='Votre agenda Passerelle est connecté.';
  location.replace('/');
}catch(error){status.textContent=error.message||'La connexion n’a pas abouti. Relancez-la depuis Lapsus.';}
