// Browser journeys follow the same visible navigation as a pupil.
export async function openArea(page,label){
 const primary={'Mon espace':'Accueil','Mon organisation':'Agenda'};
 const main=page.getByRole('navigation',{name:'Navigation principale',exact:true});
 if(primary[label]){await main.getByRole('button',{name:primary[label],exact:true}).click();return;}
 await main.getByRole('button',{name:'Plus',exact:true}).click();
 const route={'Mon ENT':'Mon lycée','Mes outils':'Rechercher','Mon abonnement ICS':'Réglages'};
 if(route[label]){await page.locator('#page-more .simple-link').filter({has:page.locator('strong',{hasText:new RegExp('^'+route[label]+'$')})}).click();if(label==='Mon abonnement ICS')await page.locator('#page-settings .simple-link').filter({hasText:'ENT et abonnement agenda'}).click();return;}
 await page.locator('#page-more .simple-link').filter({has:page.locator('strong',{hasText:'Administration'})}).click();
 const admin={'Pilotage':'Pilotage','Comptes & notifications':'Comptes et mails','Journal d’activité':'Journal','Assistance utilisateurs':'Assistance'};
 if(label!=='Pilotage')await page.locator('.simple-admin-nav').getByRole('button',{name:admin[label],exact:true}).click();
}
export async function openTool(page,label){
 const primary=page.getByRole('navigation',{name:'Navigation principale',exact:true});
 if(label==='Semaine'){await primary.getByRole('button',{name:'Agenda',exact:true}).click();return;}
 if(label==='Devoirs & contrôles'){await primary.getByRole('button',{name:'Devoirs',exact:true}).click();return;}
 await primary.getByRole('button',{name:'Plus',exact:true}).click();
 const direct={Rechercher:'Rechercher',Changements:'Nouveautés',Assistance:'Aide et contact'};
 if(direct[label]){await page.locator('#page-more .simple-link').filter({has:page.locator('strong',{hasText:new RegExp('^'+direct[label]+'$')})}).click();return;}
 if(['Matières','Pronote','Application','Préférences'].includes(label)){
  await page.locator('#page-more .simple-link').filter({has:page.locator('strong',{hasText:/^Réglages$/})}).click();
  const title={Matières:'Matières',Pronote:'Pronote',Application:'Apparence et application',Préférences:'Accueil et vacances'}[label];await page.locator('#page-settings .simple-link').filter({has:page.locator('strong',{hasText:new RegExp('^'+title+'$')})}).click();return;
 }
 if(!await page.locator('.simple-toolbox').evaluate(node=>node.open))await page.locator('.simple-toolbox summary').click();const target={Bilan:'Bilan de la semaine'}[label]||label;
 await page.locator('.simple-tool-grid .simple-link').filter({has:page.locator('strong',{hasText:new RegExp('^'+target+'$')})}).click();
}
export async function setTheme(page,theme){
 const screen=await page.locator('#app').getAttribute('data-page');
 const tool=screen==='planner'?await page.locator('#extras-root > .sr-only').textContent():screen==='hub'?await page.locator('#hub-root > .sr-only').textContent():null;
 await openTool(page,'Application');await page.locator('#app-theme').selectOption(theme);
 if(tool){await openTool(page,tool);return;}
 const areas={school:'Mon espace',ent:'Mon ENT',calendar:'Mon abonnement ICS',control:'Pilotage',people:'Comptes & notifications',logs:'Journal d’activité',support:'Assistance utilisateurs'};
 if(areas[screen])await openArea(page,areas[screen]);else if(screen==='work')await openTool(page,'Devoirs & contrôles');else if(screen==='subjects')await openTool(page,'Matières');
}

export async function openMailNotifications(page){
 await page.getByRole('button',{name:'Mes notifications',exact:true}).click();
 await page.getByRole('tab',{name:'Par mail',exact:true}).click();
}
