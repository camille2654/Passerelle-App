export function menuClient(user,control={}){return {
  getSchoolInfos:async()=>{control.discoveries=(control.discoveries||0)+1;if(control.fail)throw Object.assign(new Error('private source failure'),{status:503});return [{id:'other',title:'Conseil du lycée'}, {id:'menu-'+user.id,title:'Menus du 2 au 6 novembre 2026',publicationDateTime:'2026-10-16T12:00:00Z'}];},
  getSchoolInfo:async()=>({title:'Menus du 2 au 6 novembre 2026',publicationDateTime:'2026-10-16T12:00:00Z',attachments:[{id:'menu-file-'+user.id,name:'Menus.pdf',mimeType:'application/pdf',size:100,url:'https://horizons.ent.auvergnerhonealpes.fr/lectureFichiergw.do?fixture=private'}]}),
  request:async options=>{control.options=options;return {data:Buffer.from('%PDF-test-fixture')};}
};}
export const menuParser=async(bytes,range)=>({period:range,days:{'2026-11-02':{items:['Salade du jardin','Pâtes au fromage','Fruits'],ocr:true,image:Buffer.from([0xff,0xd8,0xff,0xd9])},'2026-11-03':{items:['Poisson et riz','Yaourt'],ocr:true,image:Buffer.from([0xff,0xd8,0xff,0xd9])},'2026-11-05':{items:['Poulet et légumes'],ocr:true}}});
