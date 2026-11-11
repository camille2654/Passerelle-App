import {PublicError} from './sync.js';

export function documentPreviewType(bytes){
 if(!Buffer.isBuffer(bytes))return null;
 if(bytes.subarray(0,1024).toString('latin1').match(/^\s*%PDF-/))return 'application/pdf';
 if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
 return null;
}
export function assertPreviewOwner(req){
 let student;try{student=decodeURIComponent(req.get('x-passerelle-student')??'');}catch{throw new PublicError('Le profil a changé. Rouvrez le document.',409);}
 if(req.get('x-passerelle-account')!==req.user.id||student!==(req.user.studentId||''))throw new PublicError('Le compte ou l’élève a changé. Rouvrez le document.',409);
}
export function sendDocumentPreview(res,file){
 const type=documentPreviewType(file.bytes);
 if(!type)throw new PublicError('L’aperçu est disponible pour les PDF et les photos JPG, PNG ou WebP. Téléchargez ce document pour l’ouvrir.',415);
 res.set({'Cache-Control':'no-store','Content-Disposition':'inline','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}).type(type).send(file.bytes);
}
