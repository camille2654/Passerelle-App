import { parisDate } from '../src/work.js';

export function schoolClient(user, control = {}) {
  const today = parisDate(new Date()), suffix = user.id, file = { id: 'document-' + suffix, name: 'Bulletin ' + suffix + '.pdf', mimeType: 'application/pdf', size: 12, url: 'https://api.skolengo.com/api/v1/documents/' + suffix + '.pdf' };
  const result = { id: 'result-' + suffix, mark: 0, comment: '<p>Des progrès réguliers.</p>', subSkillsEvaluationResults: [{ level: '3', subSkill: { shortLabel: 'Calculer' } }] };
  const grade = { id: 'evaluation-' + suffix, title: 'Calcul littéral', dateTime: today + 'T08:00:00Z', coefficient: 2, scale: 20, average: 12.5, evaluationResult: result };
  const subject = { label: 'Mathématiques' }, work = { id: 'work-' + suffix, title: 'Exercices de calcul', dueDate: today, html: '<p>Faire les exercices 4 et 5.</p>', subject, attachments: [file] };
  const lesson = { id: 'lesson-' + suffix, title: 'Fonctions et variations', subject, startDateTime: today + 'T08:00:00Z', endDateTime: today + 'T09:00:00Z', location: 'B204', canceled: false, anyContent: true, teachers: [{ firstName: 'Alex', lastName: 'Martin' }] };
  return {
    getEvaluationSettings: async student => { control.students?.push(student); return [{ periods: [{ id: 'period-' + suffix, label: 'Premier trimestre', startDate: '2026-09-01', endDate: '2027-08-31' }], skillsSetting: { skillAcquisitionLevels: [{ level: '3', label: 'Maîtrise satisfaisante' }] } }]; },
    getEvaluation: async (student, period, limit, offset) => offset ? [] : [{ id: 'service-' + suffix, subject, studentAverage: 13.75, average: 12.5, scale: 20, teachers: lesson.teachers, evaluations: [grade] }],
    getEvaluationDetail: async () => grade,
    getPeriodicReportsFiles: async (student, limit, offset) => { if (control.failReports) throw Object.assign(new Error('PRIVATE SOURCE MESSAGE'), { status: 503 }); if (offset && control.exactPage) throw Object.assign(new Error('page offset out of range: beyond data set'), { status: '400' }); return offset ? [] : [{ ...file, period: { label: 'Premier trimestre' } }, { ...file, id: 'foreign-url', name: 'Ressource externe.pdf', url: 'https://attacker.invalid/private' }]; },
    getAbsenceFiles: async (student, limit, offset) => offset ? [] : [{ id: 'absence-' + suffix, currentState: { absenceType: 'LATENESS', absenceStartDateTime: today + 'T08:00:00Z', absenceEndDateTime: today + 'T08:10:00Z', absenceFileStatus: 'LOCKED', absenceReason: { longLabel: 'Transport' }, comment: 'Dossier traité' } }],
    getAbsenceFile: async () => ({ id: 'absence-' + suffix, currentState: { absenceType: 'LATENESS', absenceFileStatus: 'LOCKED' }, history: [{ creationDateTime: today + 'T10:00:00Z', absenceFileStatus: 'LOCKED', comment: 'Dossier traité' }] }),
    getUsersMailSettings: async () => ({ folders: [{ id: 'inbox-' + suffix, name: 'Boîte de réception', type: 'INBOX' }, { id: 'sent-' + suffix, name: 'Messages envoyés', type: 'SENT' }] }),
    getCommunicationsFolder: async (folder, limit, offset) => offset ? [] : [{ id: 'message-' + suffix, subject: 'Sortie de classe', firstParticipationContent: '<p>Bonjour à tous.</p>', read: false, participationsNumber: 1, lastParticipation: { dateTime: today + 'T10:00:00Z', sender: { person: lesson.teachers[0] } } }],
    getCommunicationParticipations: async () => { control.opened = (control.opened || 0) + 1; return [{ dateTime: today + 'T10:00:00Z', sender: { person: lesson.teachers[0] }, content: '<p>Bonjour à tous.<br>Rendez-vous à 9 heures.</p><script>window.sourceAttack=true</script><img src="https://attacker.invalid/tracker">', attachments: [file] }]; },
    getSchoolInfos: async () => [{ id: 'news-' + suffix, title: 'La vie du lycée', shortContent: '<p>Une nouvelle rencontre.</p>', publicationDateTime: today + 'T08:00:00Z' }],
    getSchoolInfo: async () => ({ title: 'La vie du lycée', content: '<h2>Bienvenue</h2><p>Une nouvelle rencontre.</p>', publicationDateTime: today + 'T08:00:00Z', attachments: [file], linkedWebSiteUrl: 'javascript:alert(1)' }),
    getAgenda: async (student, start, end) => [{ date: today, lessons: [lesson] }],
    getLesson: async () => ({ ...lesson, contents: [{ title: 'Les fonctions', html: '<p>Étudier les variations.</p>', attachments: [file] }], toDoForTheLesson: [work], toDoAfterTheLesson: [] }),
    getHomeworkAssignments: async () => [work],
    getHomeworkAssignment: async () => ({ ...work, teacher: lesson.teachers[0], individualCorrectedWork: { title: 'Correction', html: '<p>Correction disponible.</p>', attachments: [file] } }),
    getUserInfo: async () => ({ firstName: 'Camille', lastName: 'Exemple', className: 'Première 2', internalMail: 'camille@example.invalid', regime: 'Externe', school: { name: 'Lycée des Tilleuls', city: 'Lyon', subscribedServices: ['EVAL', 'ABS', 'CDT', 'MSG'] } }),
    request: async options => { control.downloadOptions = options; return { data: Buffer.from('%PDF-fixture') }; }
  };
}
