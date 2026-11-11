// Rename to lapsus-adapter.js after implementing the account-specific storage.
// Called after the user authorizes Passerelle. This example deliberately saves nothing.
export async function getCurrentAccountKey(){
  throw new Error('Lapsus doit fournir l’identifiant stable de son compte connecté.');
}
export async function savePasserelleCalendars(calendars,{expectedAccountKey}={}){
  if(!Array.isArray(calendars)||!calendars.length)throw new Error('Aucun agenda n’a été autorisé.');
  if(!expectedAccountKey||await getCurrentAccountKey()!==expectedAccountKey)throw new Error('Le compte Lapsus a changé.');
  throw new Error('Lapsus doit encore enregistrer les agendas dans le compte connecté. Voir le guide d’intégration.');
}
