export const featureLabels={grades:'Notes',reports:'Bulletins',attendance:'Vie scolaire',messages:'Messages',news:'Actualités',notebook:'Cahier de textes',profile:'Mon profil',homework:'Devoirs de l’ENT',lessonDetails:'Contenu des séances',homeworkDetails:'Détail des devoirs',evaluationDetails:'Détail des évaluations',absenceDetails:'Historique des absences'};
export const unsupportedSource=error=>[403,404,405,501].includes(Number(error.status||error.response?.status))||['NO_SCHOOLING_SOLUTION_CONFIGURED','SERVICE_NOT_AVAILABLE','SERVICE_NOT_ENABLED','NOT_IMPLEMENTED','FEATURE_NOT_SUPPORTED','UNSUPPORTED'].includes(error.code||error.name||error.message);
export const emptyCapabilities=()=>Object.fromEntries(Object.keys(featureLabels).map(key=>[key,{state:'unknown',label:featureLabels[key]}]));
export function declaredCapabilities(info,schoolId){
  const result=emptyCapabilities(),permissions=info?.permissions;
  if(!Array.isArray(permissions))return result;
  const rules={grades:['EVAL','READ_EVALUATIONS'],reports:['EVAL','READ_EVALUATIONS'],attendance:['ABS','READ_ABSENCE_FILES'],messages:['MSG','READ_MESSAGES'],notebook:['CDT','READ_LESSONS'],homework:['TAF','READ_HOMEWORK_ASSIGNMENTS'],lessonDetails:['CDT','READ_LESSONS_DETAILS'],absenceDetails:['ABS','READ_ABSENCE_FILES_DETAILS']};
  for(const [key,[service,operation]]of Object.entries(rules)){
    const entries=permissions.filter(p=>p.service===service&&(!p.schoolId||p.schoolId===schoolId));
    result[key]={label:featureLabels[key],state:entries.some(p=>p.permittedOperations?.includes(operation))?'available':'unavailable'};
  }
  if(info.school?.subscribedServices?.some(value=>['ART','COMC'].includes(value)))result.news.state='available';
  return result;
}
