import fs from 'node:fs';
import { chromium } from 'playwright';
const baseURL='http://127.0.0.1:8022/agenda';
const browser=await chromium.launch({headless:true,args:['--renderer-process-limit=1']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1050},locale:'fr-FR',timezoneId:'Europe/Paris'});
 page.setDefaultNavigationTimeout(60000);page.setDefaultTimeout(45000);
 await page.goto(baseURL+'/brand/',{waitUntil:'domcontentloaded'});await page.evaluate(()=>document.fonts.ready);
 const assets=await page.evaluate(async()=>{
  const img=new Image();img.src='./symbol.png';await img.decode();const out={};
  for(const size of [64,180,192,512]){const c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d');ctx.fillStyle='#f6f5ef';ctx.fillRect(0,0,size,size);ctx.imageSmoothingQuality='high';ctx.drawImage(img,0,0,size,size);out['icon'+size]=c.toDataURL('image/png').split(',')[1]}
  await document.fonts.load('800 80px Manrope');
  for(const mode of ['light','dark']){const c=document.createElement('canvas');c.width=760;c.height=180;const ctx=c.getContext('2d');ctx.imageSmoothingQuality='high';if(mode==='dark'){ctx.fillStyle='#153d38';ctx.fillRect(0,0,760,180);ctx.filter='brightness(0) invert(1)'}ctx.drawImage(img,12,22,136,136);ctx.filter='none';ctx.fillStyle=mode==='dark'?'#f6f5ef':'#153d38';ctx.font='800 86px Manrope';ctx.letterSpacing='-4px';ctx.textBaseline='middle';ctx.fillText('passerelle',153,95);out[mode]=c.toDataURL('image/png').split(',')[1]}
  return out;
 });
 fs.mkdirSync('public/icons',{recursive:true});
 for(const [key,name] of Object.entries({icon64:'icons/favicon-64.png',icon180:'icons/apple-180.png',icon192:'icons/app-192.png',icon512:'icons/app-512.png',light:'brand/logo-horizontal.png',dark:'brand/logo-horizontal-dark.png'})) fs.writeFileSync('public/'+name,Buffer.from(assets[key],'base64'));
 fs.copyFileSync('public/icons/apple-180.png','public/apple-touch-icon.png');
 await page.reload({waitUntil:'domcontentloaded'});await page.evaluate(()=>document.fonts.ready);
 fs.mkdirSync('test-results',{recursive:true});
 await page.screenshot({path:'test-results/brand-guide-desktop.png',fullPage:true,animations:'disabled'});
 await page.evaluate(() => { for (const a of document.querySelectorAll('a')) if (a.origin === location.origin) a.href = a.href.replace(location.origin, 'https://repere.84.235.226.127.sslip.io'); });
 await page.pdf({path:'public/brand/passerelle-identite.pdf',format:'A4',printBackground:true,preferCSSPageSize:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/brand-guide-mobile.png',fullPage:true,animations:'disabled'});
 await page.close();console.log('Brand icons, wordmarks, PDF and guide captures exported');
}finally{await browser.close()}
