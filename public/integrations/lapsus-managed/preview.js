// Visual preview only. No request, login, storage or connection is performed.
document.querySelector('#managed-preview-search').addEventListener('click',()=>{
  const status=document.querySelector('#managed-preview-status');
  status.hidden=false;
  status.textContent='Ceci est un aperçu du design. La connexion réelle se lance depuis les réglages ENT de Lapsus.';
});
document.querySelector('#managed-ent-cancel').addEventListener('click',()=>{location.href='./';});

const previewTypes=[['cal','Cours'],['check','Devoirs et contrôles'],['mail','Mails de l’ENT'],['news','Actualités']];
const previewList=document.querySelector('#managed-data-types');if(previewList)previewList.innerHTML=previewTypes.map(([icon,label])=>`<li><svg class="managed-ent-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="./assets/lapsus-icons.svg#${icon}"></use></svg>${label}</li>`).join('');
