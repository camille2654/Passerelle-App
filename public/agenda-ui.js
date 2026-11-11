/* Local interactions for the authorized week snapshot. */
const agendaUI=(()=>{
  const pendingWork=new Set(),noteDrafts=new Map();
  let config=null,identity='',selected=null,origin=null,originCourse=null,gesture=null,suppressUntil=0,epoch=0;
  const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hour=value=>new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
  function configure(value){config=value;}
  function reset(){epoch++;pendingWork.clear();noteDrafts.clear();identity='';selected=null;origin=null;originCourse=null;gesture=null;const dialog=document.querySelector('#agenda-course-dialog');if(dialog){dialog.close();dialog.replaceChildren();}}
  function dialog(){
    let node=document.querySelector('#agenda-course-dialog');
    if(!node){node=document.createElement('dialog');node.id='agenda-course-dialog';node.className='agenda-course-dialog';node.setAttribute('aria-labelledby','agenda-course-title');document.body.append(node);}
    return node;
  }
  function selectedRow(id,date){const view=config?.getView(),day=view?.days.find(day=>day.date===date);return day?PasserelleAgenda.groupCourses(PasserelleAgenda.entries(day),config.changes()?.items||[]).find(row=>row.kind==='course'&&row.members.some(member=>member.id===id)):null;}
  const noteKey=row=>row?.raw.subject?.key||row?.raw.subject?.label||(row?PasserelleAgenda.courseLabel(row):'');
  function rememberDraft(){const field=document.querySelector('#agenda-note-text');if(selected&&field)noteDrafts.set(noteKey(selected),field.value);}
  function courseRows(){const day=config?.getView()?.days.find(day=>day.date===selected?.date);return day?PasserelleAgenda.groupCourses(PasserelleAgenda.entries(day),config.changes()?.items||[]).filter(row=>row.kind==='course'):[];}
  function courseNavigation(){const rows=courseRows(),index=rows.findIndex(row=>row.raw.id===selected?.raw.id);return `<nav class="agenda-course-navigation" aria-label="Parcourir les cours de cette journée"><button type="button" class="text-button" data-agenda-step="-1" ${index<=0?'disabled':''}>${icon('arrow')} Cours précédent</button><span>${index+1} / ${rows.length}</span><button type="button" class="text-button" data-agenda-step="1" ${index<0||index>=rows.length-1?'disabled':''}>Cours suivant ${icon('arrow')}</button></nav>`;}
  function stepCourse(direction){
    if(config?.identity()!==identity)return;const rows=courseRows(),index=rows.findIndex(row=>row.raw.id===selected?.raw.id),next=rows[index+direction];if(!next)return;
    rememberDraft();selected=next;dialog().innerHTML=contents();const field=document.querySelector('#agenda-note-text');if(field)field.value=noteDrafts.get(noteKey(next))||'';
    dialog().querySelector('[data-agenda-step="'+direction+'"]:not(:disabled)')?.focus({preventScroll:true});motion.scene(dialog().querySelector('.agenda-course-content'));
  }
  function contents(){
    const row=selected,view=config.getView();if(!row||!view)return '';
    const key=row.raw.subject?.key,label=row.raw.subject?.label||PasserelleAgenda.courseLabel(row);
    const related=Object.values(Object.fromEntries((view.work||view.days.flatMap(day=>day.work||[])).filter(work=>key?work.subject?.key===key:work.subject?.label===label||work.subjectLabel===label).map(work=>[work.id,work])));
    const notes=(view.notes||[]).filter(note=>!note.done&&(key?note.subjectKey===key:note.subjectLabel===label));
    const details=[...new Set(row.members.map(member=>member.description).filter(Boolean))];
    return `<header class="agenda-course-heading"><span class="agenda-course-heading-icon" aria-hidden="true">${PasserelleAgenda.subjectIcon(row)}</span><div><p>${row.raw.cancelled?'Cours annulé':'Mon cours'}${row.members.length>1?' · '+row.members.length+' séances':''}</p><h2 id="agenda-course-title">${esc(PasserelleAgenda.courseLabel(row))}</h2></div><button type="button" class="icon-button" data-agenda-close aria-label="Fermer les détails du cours">${icon('close')}</button></header>${courseNavigation()}<div class="agenda-course-content"><div class="agenda-course-facts"><span>${icon('calendar')}${esc(new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',weekday:'long',day:'numeric',month:'long'}).format(new Date(row.date+'T12:00:00Z')))}</span><span>${icon('clock')}${esc(hour(row.raw.start))} – ${esc(hour(row.raw.end))}</span><span>${icon('pin')}${esc(row.raw.location||'Salle non précisée')}</span></div>${details.length?`<section><h3>${icon('book')}Informations du cours</h3>${details.map(text=>`<p class="agenda-course-prose">${esc(text)}</p>`).join('')}</section>`:''}${key?`<button type="button" class="text-button" data-agenda-subject="${esc(key)}">${icon('book')} Tout voir dans cette matière ${icon('arrow')}</button>`:''}<section><h3>${icon('homework')}À préparer cette semaine</h3>${related.length?`<ul class="agenda-course-work">${related.map(work=>`<li data-agenda-task="${esc(work.id)}" class="${work.done?'is-done':''}"><label class="agenda-work-toggle"><input type="checkbox" data-agenda-work-done="${esc(work.id)}" ${work.done?'checked':''} ${pendingWork.has(work.id)?'disabled':''} aria-label="${esc((work.done?'Remettre à faire : ':'Marquer comme fait : ')+work.title)}"><span><small>${work.kind==='exam'?'Contrôle':'Devoir'} · ${esc(work.due)}</small><strong>${esc(work.title)}</strong><span class="agenda-work-state">${work.done?'Fait':'À faire'}</span></span></label>${work.details?`<p>${esc(work.details)}</p>`:''}</li>`).join('')}</ul><button type="button" class="text-button" data-agenda-work>Ouvrir mes devoirs ${icon('arrow')}</button>`:'<p class="agenda-course-empty">Aucun devoir associé dans la semaine affichée.</p>'}</section><p id="agenda-work-status" class="agenda-work-status" role="status" hidden></p><section><h3>${icon('note')}Mes notes pour cette matière</h3>${notes.length?`<ul class="agenda-course-notes">${notes.map(note=>`<li>${esc(note.text)}</li>`).join('')}</ul>`:'<p class="agenda-course-empty">Un livre à apporter, une question à poser…</p>'}<form id="agenda-note-form"><label for="agenda-note-text">Ajouter une note personnelle</label><textarea id="agenda-note-text" name="text" rows="2" maxlength="2000" required placeholder="À retrouver au prochain cours…"></textarea><p id="agenda-note-status" class="agenda-note-status" role="status" hidden></p><button type="submit" class="button">${icon('plus')} Enregistrer ma note</button></form></section></div>`;
  }
  function open(button){
    const row=selectedRow(button.dataset.agendaCourse,button.dataset.courseDate);if(!row)return;
    noteDrafts.clear();identity=config.identity();selected=row;origin=button;originCourse={id:button.dataset.agendaCourse,date:button.dataset.courseDate,top:window.scrollY};const node=dialog();node.innerHTML=contents();motion.open(node);
  }
  async function close(){const node=document.querySelector('#agenda-course-dialog');if(node?.open)await motion.close(node);selected=null;noteDrafts.clear();const target=origin?.isConnected?origin:[...document.querySelectorAll('[data-agenda-course]')].find(node=>node.dataset.agendaCourse===originCourse?.id&&node.dataset.courseDate===originCourse?.date);if(target){target.focus({preventScroll:true});window.scrollTo({top:originCourse?.top??window.scrollY,behavior:'instant'});}origin=null;originCourse=null;}
  document.addEventListener('click',event=>{
    if(Date.now()<suppressUntil&&event.target.closest('.agenda-presentation')){event.preventDefault();event.stopImmediatePropagation();return;}
    const course=event.target.closest('[data-agenda-course]');if(course){open(course);return;}
    const step=event.target.closest('[data-agenda-step]');if(step&&!step.disabled){stepCourse(Number(step.dataset.agendaStep));return;}
    if(event.target.closest('[data-agenda-close]'))void close();
    const subject=event.target.closest('[data-agenda-subject]');if(subject){const key=subject.dataset.agendaSubject;void close().then(()=>libraryPortal.open(key));return;}
    if(event.target.closest('[data-agenda-work]'))void close().then(()=>features.open('work'));
    const node=document.querySelector('#agenda-course-dialog');if(event.target===node){const box=node.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)void close();}
  },true);
  document.addEventListener('cancel',event=>{if(event.target.id==='agenda-course-dialog'){event.preventDefault();void close();}},true);
  document.addEventListener('input',event=>{if(event.target.id==='agenda-note-text'&&selected)noteDrafts.set(noteKey(selected),event.target.value);});
  document.addEventListener('submit',event=>{
    if(event.target.id!=='agenda-note-form')return;event.preventDefault();
    const form=event.target,row=selected,owner=identity,version=epoch,status=form.querySelector('[role=status]'),button=form.querySelector('button');
    if(!row||config.identity()!==owner)return;button.disabled=true;status.hidden=true;
    const body={text:form.elements.text.value,accountId:state.user.id,studentId:state.user.studentId||null,...(row.raw.subject?.key?{subjectKey:row.raw.subject.key}:{subjectLabel:row.raw.subject?.label||PasserelleAgenda.courseLabel(row)})};
    void api('personal/notes',body).then(async()=>{
      if(epoch!==version||config.identity()!==owner)return;if(noteDrafts.get(noteKey(row))===body.text)noteDrafts.delete(noteKey(row));await config.reload();if(epoch!==version||config.identity()!==owner||selected!==row||!form.isConnected)return;
      dialog().innerHTML=contents();const message=document.querySelector('#agenda-note-status');message.hidden=false;message.textContent='Votre note est enregistrée pour cette matière.';const field=document.querySelector('#agenda-note-text');field.value=noteDrafts.get(noteKey(row))||'';field.focus();
    }).catch(error=>{if(form.isConnected&&epoch===version&&config.identity()===owner){status.hidden=false;status.textContent=error.message;}}).finally(()=>{if(button.isConnected)button.disabled=false;});
  });
  function updateWorkNodes(id,done,title,disabled){
    document.querySelectorAll('[data-agenda-work-done]').forEach(input=>{
      if(input.dataset.agendaWorkDone!==id)return;input.checked=done;input.disabled=disabled;
      input.setAttribute('aria-label',(done?'Remettre à faire : ':'Marquer comme fait : ')+title);
      const item=input.closest('[data-agenda-task]');item.classList.toggle('is-done',done);item.querySelector('.agenda-work-state').textContent=done?'Fait':'À faire';
    });
  }
  document.addEventListener('change',event=>{
    const input=event.target;if(!input.matches('[data-agenda-work-done]'))return;
    const activeCourse=selected,id=input.dataset.agendaWorkDone,owner=identity,version=epoch,work=config?.getView()?.work?.find(item=>item.id===id);
    if(!work||config.identity()!==owner||pendingWork.has(id)){if(work)input.checked=!!work.done;return;}
    const before=!!work.done,done=input.checked,feedbackOwner=experience.identity();
    pendingWork.add(id);input.disabled=true;
    const current=()=>epoch===version&&config.identity()===owner;
    const message=text=>{const status=document.querySelector('#agenda-work-status');if(status&&current()&&selected===activeCourse&&document.querySelector('#agenda-course-dialog')?.open){status.hidden=false;status.textContent=text;}};
    message('Enregistrement…');let committed=false;
    void api('work/'+encodeURIComponent(id),{done}).then(async()=>{
      if(!current())return;committed=true;work.done=done;updateWorkNodes(id,done,work.title,true);
      message(done?'Travail marqué comme fait.':'Travail remis à faire.');
      await config.reload();if(!current())return;
      try{await refresh(true);}catch{message('Le changement est enregistré. Le reste de l’espace sera actualisé à la prochaine ouverture.');}
      if(current()&&selected===activeCourse)experience.workFeedback(work,before,feedbackOwner,{container:document.querySelector('#agenda-work-status'),reload:config.reload,onUndo:done=>{work.done=done;updateWorkNodes(id,done,work.title,false);}});
    }).catch(error=>{if(current()){if(!committed)updateWorkNodes(id,before,work.title,true);message(error.message);}}).finally(()=>{
      if(!current())return;pendingWork.delete(id);updateWorkNodes(id,committed?done:before,work.title,false);
    });
  });
  document.addEventListener('touchstart',event=>{
    if(event.touches.length!==1||!event.target.closest('.agenda-presentation[data-agenda-mode=day]')||event.target.closest('input,textarea,select,.agenda-day-notes')){gesture=null;return;}
    gesture={x:event.touches[0].clientX,y:event.touches[0].clientY,at:Date.now(),owner:config?.identity()};
  },{passive:true});
  document.addEventListener('touchend',event=>{
    const start=gesture;gesture=null;if(!start||event.changedTouches.length!==1||config?.identity()!==start.owner)return;
    const dx=event.changedTouches[0].clientX-start.x,dy=event.changedTouches[0].clientY-start.y;
    if(Date.now()-start.at>700||Math.abs(dx)<65||Math.abs(dx)<Math.abs(dy)*1.7)return;
    const current=document.querySelector('.agenda-day-selector [aria-pressed=true]')?.dataset.date;if(!current)return;
    const date=new Date(current+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+(dx<0?1:-1));suppressUntil=Date.now()+450;config.selectDay(date.toISOString().slice(0,10),dx<0?'next':'previous');
  },{passive:true});
  document.addEventListener('touchcancel',()=>{gesture=null;},{passive:true});
  document.addEventListener('keydown',event=>{
    const button=event.target.closest('.agenda-day-selector [data-extra=agenda-day]');if(!button||!['ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();const date=new Date(button.dataset.date+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+(event.key==='ArrowRight'?1:-1));config.selectDay(date.toISOString().slice(0,10),event.key==='ArrowRight'?'next':'previous');
  });
  setInterval(()=>{const root=document.querySelector('#extras-root');if(config&&!document.hidden&&root&&!document.querySelector('#page-planner')?.hidden)PasserelleAgenda.refreshLive(root);},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){const root=document.querySelector('#extras-root');if(root)PasserelleAgenda.refreshLive(root);}});
  return {configure,reset};
})();
