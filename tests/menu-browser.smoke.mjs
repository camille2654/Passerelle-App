import {setTheme} from './simple-navigation.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createApp} from '../src/server.js';
import {random,digest} from '../src/store.js';
import {menuClient,menuParser} from './menu-fixture.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-menu-browser-')),baseURL='http://127.0.0.1:8021/agenda',control={},errors=[];
const source=createApp({dataDir:dir,baseURL,bootstrap:false,clock:()=>Date.parse('2026-11-02T11:00:00Z'),schoolOptions:{clientFactory:async(store,user)=>menuClient(user,control)},menuOptions:{parser:menuParser}});
source.store.state.users.push({id:'menu-browser',name:'Camille',login:'menu-browser',admin:false,schoolName:'Lycée des Horizons',studentId:'student',skolengo:source.store.seal({school:{id:'school',name:'Lycée des Horizons',emsCode:'rra',emsOIDCWellKnownUrl:'https://sso.ent.auvergnerhonealpes.fr/oidc/.well-known'}})});
const token=random();source.store.state.sessions.push({hash:digest(token),userId:'menu-browser',expires:Date.now()+3600000});source.store.save();const server=source.app.listen(8021,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));let browser,page;
async function shot(name){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:'test-results/'+name+'.png',fullPage:true,animations:'disabled',timeout:60000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
try{
  browser=await chromium.launch({headless:true,args:['--renderer-process-limit=1']});page=await browser.newPage({viewport:{width:1440,height:1050},locale:'fr-FR',timezoneId:'Europe/Paris'});page.setDefaultTimeout(45000);page.setDefaultNavigationTimeout(60000);page.on('pageerror',error=>errors.push(error.message));fs.mkdirSync('test-results',{recursive:true});
  await page.clock.setFixedTime(new Date('2026-11-02T11:00:00Z'));await page.context().addCookies([{name:'agenda_session',value:token,domain:'127.0.0.1',path:'/agenda'}]);
  await page.goto(baseURL+'/',{waitUntil:'domcontentloaded'});await page.getByRole('region',{name:'Menu du lycée'}).getByText('Pâtes au fromage',{exact:true}).waitFor();assert.equal(await page.locator('.canteen-dishes').getByText('Poisson et riz',{exact:true}).count(),0);await shot('menu-home-desktop');
  await page.locator('.simple-menu-options summary').click();const input=page.getByLabel('Choisir le jour du menu',{exact:true});await input.fill('2026-11-03');await input.dispatchEvent('change');await page.locator('.canteen-dishes').getByText('Poisson et riz',{exact:true}).waitFor();assert.equal(await page.locator('.canteen-dishes').getByText('Pâtes au fromage',{exact:true}).count(),0);
  await input.fill('2026-11-04');await input.dispatchEvent('change');await page.getByText('Aucun menu publié pour ce jour.',{exact:true}).waitFor();assert.equal(await page.locator('.canteen-dishes').count(),0);await page.getByRole('button',{name:'Voir le prochain menu',exact:false}).click();await page.locator('.canteen-dishes').getByText('Poulet et légumes',{exact:true}).waitFor();
  await page.locator('#menu-root').getByRole('button',{name:'Aujourd’hui',exact:true}).click();await page.locator('.canteen-dishes').getByText('Pâtes au fromage',{exact:true}).waitFor();const imageURL=await page.getByRole('link',{name:'Voir l’extrait original',exact:false}).getAttribute('href');const image=await page.request.get(new URL(imageURL,baseURL+'/').href);assert.equal(image.status(),200);assert.ok(image.headers()['content-type'].includes('image/jpeg'));
  const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Ouvrir le PDF',exact:false}).click();assert.equal(await(await downloadPromise).failure(),null);
  control.fail=true;await page.getByRole('button',{name:'Actualiser le menu',exact:true}).click();await page.getByRole('alert').filter({hasText:'ENT ne répond pas'}).waitFor();assert.equal(await page.locator('.canteen-dishes li').count(),3);assert.ok(!(await page.locator('#menu-root').textContent()).includes('private source failure'));
  await page.setViewportSize({width:390,height:844});await shot('menu-home-mobile');await setTheme(page,'dark');await shot('menu-home-mobile-dark');
  await page.evaluate(()=>refresh());assert.equal(await page.locator('.canteen-dishes li').count(),3);await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
  await page.getByRole('button',{name:'Se déconnecter',exact:true}).click();await page.getByRole('button',{name:'Créer un compte gratuit',exact:true}).waitFor();assert.equal(await page.getByText('Pâtes au fromage',{exact:true}).count(),0);assert.equal(await page.locator('#menu-root').count(),0);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,dailyMenuOnHome:true,dateSelection:true,missingDayNeverReplaced:true,nextPublishedDay:true,privateSourceImage:true,privatePDF:true,sourceFailureKeepsMatchingDate:true,desktop:true,mobile:true,dark:true,reducedMotion:true,logoutClearsMenu:true,realEmailsSent:0}));
}catch(error){await page?.screenshot({path:'test-results/menu-failure.png',animations:'disabled',timeout:60000}).catch(()=>{});throw error;}finally{await source.browsers.close();await browser?.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
