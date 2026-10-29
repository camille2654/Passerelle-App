import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const baseURL='http://127.0.0.1:8022/agenda',errors=[],warnings=[];
const browser=await chromium.launch({headless:true,args:['--renderer-process-limit=1']});
const page=await browser.newPage({viewport:{width:1440,height:1050},locale:'fr-FR',timezoneId:'Europe/Paris'});page.setDefaultTimeout(45000);page.setDefaultNavigationTimeout(60000);
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&m.text().includes('Content Security Policy'))errors.push(m.text())});
async function capture(name,fullPage=false){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:'test-results/'+name+'.png',fullPage,animations:'disabled',timeout:60000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' horizontal overflow')}
try{
 await page.goto(baseURL+'/',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Votre espace scolaire.'}).waitFor();await capture('brand-login-desktop');
 await page.setViewportSize({width:390,height:844});await capture('brand-login-mobile',true);
 await page.getByLabel('Identifiant du portail',{exact:true}).fill('brand-fixture');await page.getByLabel('Mot de passe du portail',{exact:true}).fill('temporary-brand-password');await page.getByRole('button',{name:'Se connecter',exact:false}).click();await page.getByRole('heading',{name:'Mon espace scolaire',exact:true}).waitFor();
 await capture('brand-home-mobile',true);
 await page.setViewportSize({width:1440,height:1050});await capture('brand-home-desktop');
 await page.getByRole('button',{name:'Mon organisation',exact:true}).click();await page.locator('.week-grid').waitFor();await capture('brand-week-desktop');
 await page.getByLabel('Thème d’affichage',{exact:true}).selectOption('dark');await capture('brand-week-desktop-dark');
 await page.getByRole('button',{name:'Mon espace',exact:true}).click();await capture('brand-home-desktop-dark');
 await page.setViewportSize({width:390,height:844});await capture('brand-home-mobile-dark',true);
 await page.getByRole('button',{name:'Mon abonnement ICS',exact:true}).click();await capture('brand-ics-mobile-dark',true);
 await page.getByRole('button',{name:'Comptes & notifications',exact:true}).click();await page.locator('.person-card').waitFor();await capture('brand-admin-mobile-dark',true);
 await page.getByLabel('Thème d’affichage',{exact:true}).selectOption('light');await page.setViewportSize({width:1440,height:1050});await capture('brand-admin-desktop');
 await page.getByRole('button',{name:'Journal d’activité',exact:true}).click();await page.locator('.log-table').waitFor();await capture('brand-logs-desktop');
 for(const width of [360,390,820,1440]){await page.setViewportSize({width,height:1050});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'logs overflow '+width)}
 await page.goto(baseURL+'/brand/',{waitUntil:'domcontentloaded'});await page.setViewportSize({width:1440,height:1050});await capture('brand-cover-desktop');
 const links=await page.locator('a[download]').evaluateAll(nodes=>nodes.map(n=>n.href));for(const url of links){const r=await page.request.get(url);assert.equal(r.status(),200,'download '+new URL(url).pathname)}
 await page.setViewportSize({width:360,height:844});await capture('brand-cover-mobile');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,login:true,home:true,week:true,admin:true,logs:true,dark:true,mobile:true,brandDownloads:true,errors}));
}finally{await browser.close()}
