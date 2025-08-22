// saved-outlines.js — Saved Outlines manager with desktop-like folders.
// Exports: setupSavedOutlines({...})
//
// Adds:
// • Folder grid (top) with inline “+ New folder” from index.html.
// • Double-click folder to open; breadcrumb shows "Main › Folder".
// • Drag an outline card onto a folder (or breadcrumb) to move it.
// • Filtering: savedList shows items in current folder (Main shows items without folderId).
//
// Edit behavior preserved. Link editing remains available. Widget shelf UI is intentionally removed from Saved nav.

export function setupSavedOutlines({
  getSavedOutlines,
  setSavedOutlines,
  saveOutlinesLocal,
  getWidgetShelf,   // kept in signature for compatibility (not used here)
  setWidgetShelf,   // kept in signature for compatibility (not used here)
  applyOutline,
  touchCloud,
  renderHomeSavedBar,
  // live sync with Home
  getActiveOutlineId,
  syncCurrentFromSaved,
  // folders API (provided by index.html)
  getFolders,
  setFolders,
  saveFoldersLocal,
}) {
  // ---------- DOM ----------
  const savedListEl   = document.getElementById('savedList');
  const createBtn     = document.getElementById('createOutlineBtn');
  const createForm    = document.getElementById('createOutlineForm');
  const createTitle   = document.getElementById('newOutlineTitle');
  const createOk      = document.getElementById('createOutlineConfirm');
  const createCancel  = document.getElementById('createOutlineCancel');

  const mergeBar      = document.getElementById('mergeBar');
  const mergeSrcName  = document.getElementById('mergeSourceName');
  const mergeTgtName  = document.getElementById('mergeTargetName');
  const mergeTitleInp = document.getElementById('mergeTitleInput');
  const mergeConfirm  = document.getElementById('mergeConfirmBtn');
  const mergeCancel   = document.getElementById('mergeCancelBtn');

  // ---------- UI state ----------
  const expandedOutlines = new Set();
  const editingSections  = new Set(); // `${outlineId}|${sectionId}`
  let draggingOutlineId  = null;      // for outline merge drag
  let isMergeDrag        = false;

  // ---------- helpers ----------
  const escapeHtml = (s)=> (s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const byId  = (arr, id)=> (arr || []).find(x => x.id === id);
  const keyOf = (oId, sId)=> `${oId}|${sId}`;
  const fmtMins = (n)=> String(Number(n || 0)).replace(/\.0+$/,'');
  const escSel = (s)=> (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');
  const debounce = (fn,ms=400)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms);} };

  const getActiveId = ()=> (typeof getActiveOutlineId === 'function' ? getActiveOutlineId() : null);
  function persist(changedOutlineId){
    if (typeof saveOutlinesLocal === 'function') saveOutlinesLocal();
    if (typeof renderHomeSavedBar === 'function') renderHomeSavedBar();
    if (typeof touchCloud === 'function') touchCloud();

    const activeId = getActiveId?.();
    if (activeId && changedOutlineId && activeId === changedOutlineId && typeof syncCurrentFromSaved === 'function') {
      const list = (getSavedOutlines && getSavedOutlines()) || [];
      const o = list.find(x => x.id === activeId);
      if (o) syncCurrentFromSaved(structuredClone(o));
    }
  }

  function normalizeUrl(input){
    let u = (input || '').trim();
    if(!u) return '';
    if(/^https?:\/\//i.test(u)) return u;
    u = u.replace(/^\/\//,'');
    const slash = u.indexOf('/');
    let host = slash >= 0 ? u.slice(0, slash) : u;
    const rest = slash >= 0 ? u.slice(slash) : '';
    if(!/^www\./i.test(host)){
      const parts = host.split('.');
      if(parts.length === 2){ host = 'www.' + host; }
    }
    return 'https://' + host + rest;
  }
  const askConfirm = (msg)=> (window.sfConfirm ? window.sfConfirm(msg) : Promise.resolve(confirm(msg)));
  const askPrompt  = (label, def)=> (window.sfPrompt  ? window.sfPrompt(label, def) : Promise.resolve(prompt(label, def)));

  // ---------- renderers ----------
  function outlineCardHtml(o, isExpanded){
    const chevron = isExpanded ? '▾' : '▸';
    return `
      <div class="card p-4" data-oid="${escapeHtml(o.id)}" draggable="false">
        <div class="flex items-center gap-2" data-role="outline-head">
          <div class="flex-1 font-bold text-lg truncate" data-role="outline-title">${escapeHtml(o.title || 'Untitled outline')}</div>
          <button class="btn-xs" data-act="add-section">+ Section</button>
          <button class="btn-xs" data-act="load">Load</button>
          <button class="btn-xs" data-act="duplicate">Duplicate</button>
          <button class="btn-xs" data-act="delete">Delete</button>
          <button class="btn-xxs" data-act="toggle-expand" aria-expanded="${isExpanded ? 'true':'false'}" title="${isExpanded?'Collapse':'Expand'}">${chevron}</button>
        </div>
        ${isExpanded ? `
          <ul class="mt-3" data-role="sections">
            ${(o.sections||[]).map(s=>{
              const k = keyOf(o.id, s.id);
              return editingSections.has(k)
                ? `<li class="outline-row editing" data-sid="${escapeHtml(s.id)}" data-view="edit">${sectionEditCardInnerHtml(s)}</li>`
                : sectionPreviewRowHtml(s);
            }).join('')}
          </ul>` : ''}
      </div>`;
  }

  function sectionPreviewRowHtml(s){
    return `
      <li class="outline-row section-row" data-sid="${escapeHtml(s.id)}" data-view="preview" draggable="true">
        <div class="flex items-center gap-2">
          <div class="title truncate flex-1">${escapeHtml(s.name || 'Untitled section')}</div>
          <span class="mins text-xs muted">${fmtMins(s.minutes)}m</span>
          <button class="btn-xxs bin" data-act="del-sec" title="Delete section">🗑️</button>
        </div>
      </li>`;
  }

  function linksBarInnerHtml(links){
    return (links||[]).map((w,i)=> {
      const iconHtml = (w.icon==='img' && w.img)
        ? `<img src="${escapeHtml(w.img)}" alt="" class="rounded-[4px] object-cover" draggable="false" style="width:18px;height:18px;"/>`
        : `<span class="link-icon">${escapeHtml(w.emoji||'🔗')}</span>`;
      return `
        <div class="widget" data-link-idx="${i}">
          <div class="link-card section-link" draggable="true" data-idx="${i}">
            ${iconHtml}
            <span class="truncate max-w-[12rem]">${escapeHtml(w.label || 'Untitled')}</span>
          </div>
          <button class="bin" data-act="del-link" title="Delete">🗑️</button>
        </div>`;
    }).join('');
  }

  function sectionEditCardInnerHtml(s){
    const desc = escapeHtml(s.desc || '');
    return `
      <div class="section-edit compact-edit" data-sid="${escapeHtml(s.id)}" data-view="edit">
        <div class="row head">
          <span class="lbl">Title</span>
          <input class="input title-input flex-1" data-role="edit-title" value="${escapeHtml(s.name || '')}" placeholder="Section title"/>
          <div class="mins-wrap">
            <label class="text-xs muted">Min</label>
            <input class="input mins-input" type="number" min="0.25" step="0.25" data-role="edit-mins" value="${escapeHtml(String(s.minutes || 0))}"/>
          </div>
        </div>
        <div class="row"><label class="text-sm" style="font-weight:600">Description</label><textarea class="input w-full" data-role="edit-desc">${desc}</textarea></div>
        <div class="row"><div class="text-sm font-bold">Links</div><div class="section-links-bar" data-role="links-bar">${linksBarInnerHtml(s.links)}</div></div>
        <div class="row" style="justify-content:end; display:flex;">
          <button class="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white" data-act="save-section">Save</button>
        </div>
      </div>`;
  }

  function renderSavedOutlines(){
    if(!savedListEl) return;
    const outlines = (getSavedOutlines && getSavedOutlines()) || [];
    const currentFolderId = (window.__getCurrentFolderId ? window.__getCurrentFolderId() : null);

    const visible = outlines.filter(o=> (currentFolderId ? o.folderId === currentFolderId : !o.folderId));
    savedListEl.innerHTML = visible.map(o => outlineCardHtml(o, expandedOutlines.has(o.id))).join('');

    visible.forEach(o=>{
      const card = savedListEl.querySelector(`[data-oid="${escSel(o.id)}"]`);
      if(!card) return;

      // Header actions
      card.querySelector('[data-act="load"]')?.addEventListener('click', ()=>{ applyOutline && applyOutline(o); const homeBtn = document.querySelector('.tab-link[data-tab="homeTab"]'); homeBtn?.click(); });
      card.querySelector('[data-act="duplicate"]')?.addEventListener('click', async ()=>{
        const list = (getSavedOutlines && getSavedOutlines()) || [];
        const src  = byId(list, o.id); if(!src) return;
        const copy = structuredClone(src);
        copy.id = 'O'+Date.now().toString(36);
        const title = await askPrompt('Duplicate title:', `Copy of ${src.title || 'Outline'}`);
        copy.title = (title && title.trim()) || `Copy of ${src.title || 'Outline'}`;
        copy.sections = (copy.sections||[]).map((s, i)=> ({...s, id: 'S'+Date.now().toString(36)+i}));
        list.push(copy); setSavedOutlines(list);
        saveOutlinesLocal && saveOutlinesLocal(); renderHomeSavedBar && renderHomeSavedBar(); touchCloud && touchCloud(); renderSavedOutlines();
      });
      card.querySelector('[data-act="delete"]')?.addEventListener('click', async ()=>{
        if(!await askConfirm('Delete this outline?')) return;
        const list = (getSavedOutlines && getSavedOutlines()) || [];
        const idx = list.findIndex(x=>x.id===o.id);
        if(idx>=0){
          list.splice(idx,1); setSavedOutlines(list);
          saveOutlinesLocal && saveOutlinesLocal(); renderHomeSavedBar && renderHomeSavedBar(); touchCloud && touchCloud(); renderSavedOutlines();
        }
      });
      card.querySelector('[data-act="toggle-expand"]')?.addEventListener('click', ()=>{ if(expandedOutlines.has(o.id)) expandedOutlines.delete(o.id); else expandedOutlines.add(o.id); renderSavedOutlines(); });
      card.querySelector('[data-act="add-section"]')?.addEventListener('click', ()=>{
        expandedOutlines.add(o.id);
        const me = byId((getSavedOutlines && getSavedOutlines()) || [], o.id); if(!me) return;
        me.sections = me.sections || [];
        me.sections.push({ id:'S'+Date.now().toString(36), name:'New section', minutes:5, desc:'', links:[] });
        setSavedOutlines && setSavedOutlines(me ? [...(getSavedOutlines && getSavedOutlines())] : []);
        persist(o.id);
        renderSavedOutlines();
      });

      // Make title draggable for merge + folder move indicator
      const titleEl = card.querySelector('[data-role="outline-title"]');
      if(titleEl){
        titleEl.setAttribute('draggable','true');
        titleEl.addEventListener('dragstart', (e)=>{
          draggingOutlineId = o.id; isMergeDrag = true; window.__draggingOutlineId = o.id;
          document.body.classList.add('is-merge-drag');
          try{
            e.dataTransfer.setData('text/plain', JSON.stringify({type:'merge', id:o.id}));
            const img = new Image(); img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";
            if(e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(img, 0, 0);
          }catch{}
          e.dataTransfer.effectAllowed='move';
          card.classList.add('drag-ghost');
        });
        titleEl.addEventListener('dragend', ()=>{
          draggingOutlineId = null; isMergeDrag = false; window.__draggingOutlineId = null;
          document.body.classList.remove('is-merge-drag');
          card.classList.remove('drag-ghost');
          document.querySelectorAll('[data-oid]').forEach(el=>{ el.style.outline=''; el.style.outlineOffset=''; });
        });

        // Permissive card merge target
        const onDragOverCard = (e)=>{
          const incoming = draggingOutlineId;
          if(incoming && incoming !== o.id){ e.preventDefault(); card.style.outline='2px dashed var(--accent)'; card.style.outlineOffset='4px'; }
        };
        const onDragLeaveCard = ()=>{ card.style.outline=''; card.style.outlineOffset=''; };
        const onDropCard = (e)=>{
          card.style.outline=''; card.style.outlineOffset='';
          if(!draggingOutlineId || draggingOutlineId===o.id) return;
          e.preventDefault();
          const list = (getSavedOutlines && getSavedOutlines()) || [];
          const src = byId(list, draggingOutlineId);
          const tgt = o; if(!src || !tgt) return;

          if(mergeBar){
            mergeBar.style.display='block';
            mergeSrcName && (mergeSrcName.textContent  = src.title || 'Untitled');
            mergeTgtName && (mergeTgtName.textContent  = tgt.title || 'Untitled');
            mergeTitleInp && (mergeTitleInp.value = `${tgt.title||'Untitled'} + ${src.title||'Untitled'}`);
            mergeConfirm.onclick = ()=>{
              const merged = { id:'O'+Date.now().toString(36), title:(mergeTitleInp?.value || '').trim() || `${tgt.title||''} + ${src.title||''}`, sections:[...(tgt.sections||[]).map(s=>structuredClone(s)), ...(src.sections||[]).map(s=>structuredClone(s))] };
              list.push(merged);
              setSavedOutlines(list);
              saveOutlinesLocal && saveOutlinesLocal(); renderHomeSavedBar && renderHomeSavedBar(); touchCloud && touchCloud();
              mergeBar.style.display='none'; renderSavedOutlines();
            };
            mergeCancel.onclick = ()=>{ mergeBar.style.display='none'; };
          }
        };
        card.addEventListener('dragover', onDragOverCard, true);
        card.addEventListener('dragleave', onDragLeaveCard, true);
        card.addEventListener('drop', onDropCard, true);
      }

      // Sections wiring (only if expanded)
      if(!expandedOutlines.has(o.id)) return;
      const sectionsList = card.querySelector('[data-role="sections"]'); if(!sectionsList) return;

      // Subsection reorder
      let dragging = null;
      const makePh = (h, titleText)=>{ const ph = document.createElement('li'); ph.className='outline-row drop-placeholder'; ph.style.setProperty('--ph', `${Math.max(36,h)}px`); ph.innerHTML = `<div class="text-xs muted px-2 truncate">${escapeHtml(titleText||'')}</div>`; return ph; };

      sectionsList.querySelectorAll('li.section-row[data-sid]').forEach((li, idx)=>{
        // open inline editor
        li.addEventListener('click', (e)=>{ if(e.target.closest('[data-act="del-sec"], .link-card, .bin, input, textarea, select, button')) return; editingSections.add(keyOf(o.id, li.dataset.sid)); renderSavedOutlines(); });
        // delete
        li.querySelector('[data-act="del-sec"]')?.addEventListener('click', async (e)=>{ e.stopPropagation(); if(!await askConfirm('Delete this section?')) return;
          const list = (getSavedOutlines && getSavedOutlines()) || []; const me = byId(list, o.id); if(!me) return; const sidx = me.sections.findIndex(se => se.id === li.dataset.sid);
          if(sidx>=0){ me.sections.splice(sidx,1); setSavedOutlines(list); persist(o.id); renderSavedOutlines(); }
        });
        // drag row
        li.addEventListener('dragstart', (e)=>{
          if(li.classList.contains('editing')){ e.preventDefault(); return; }
          const titleText = (li.querySelector('.title')?.textContent || '').trim();
          dragging = { from: idx, el: li, placeholder: makePh(li.offsetHeight, titleText) };
          li.classList.add('dragging'); li.after(dragging.placeholder);
          try{
            e.dataTransfer.setData('text/plain', JSON.stringify({type:'sec-move', from: idx, oid:o.id}));
            const img = new Image(); img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";
            if(e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(img, 0, 0);
          }catch{}
          e.dataTransfer.effectAllowed='move';
        });
        li.addEventListener('dragend', ()=>{ li.classList.remove('dragging'); dragging?.placeholder?.remove(); dragging = null; });
        const over = (e)=>{ if(!dragging) return; e.preventDefault(); const r = li.getBoundingClientRect(); const before = e.clientY < (r.top + r.height/2); const ph = dragging.placeholder; if(!ph) return; if(before){ if(li.previousSibling !== ph) li.parentElement.insertBefore(ph, li); }else{ if(li.nextSibling !== ph) li.after(ph); } };
        li.addEventListener('dragover', over); li.addEventListener('dragenter', over);
      });

      sectionsList.addEventListener('dragover', (e)=>{ if(!dragging) return; e.preventDefault(); if(!sectionsList.contains(dragging.placeholder)) sectionsList.appendChild(dragging.placeholder); });

      sectionsList.addEventListener('drop', (e)=>{
        if(!dragging) return; e.preventDefault();
        const from = dragging.from;
        const rows = Array.from(sectionsList.querySelectorAll('li.outline-row'));
        const phIndex = rows.indexOf(dragging.placeholder);
        the_to = phIndex < 0 ? rows.length-1 : phIndex;
        const finalTo = (the_to > from) ? the_to - 1 : the_to;
        if(from !== finalTo && from >= 0 && finalTo >= 0){
          const list = (getSavedOutlines && getSavedOutlines()) || [];
          const me   = byId(list, o.id); if(!me) return;
          const [moved] = me.sections.splice(from,1);
          me.sections.splice(finalTo,0,moved);
          setSavedOutlines(list); persist(o.id);
        }
        dragging?.placeholder?.remove(); dragging = null; renderSavedOutlines();
      });

      // Wire edit cards inside <li class="editing">
      (o.sections || []).forEach(sec=>{
        const secKey = keyOf(o.id, sec.id);
        if(!editingSections.has(secKey)) return;
        const li = sectionsList.querySelector(`li.editing[data-sid="${escSel(sec.id)}"]`); if(!li) return;

        const secEl = li.querySelector('.section-edit');
        const linksBar = secEl?.querySelector('[data-role="links-bar"]'); if (linksBar) linksBar.innerHTML = linksBarInnerHtml(sec.links || []);

        // Save button
        secEl?.querySelector('[data-act="save-section"]')?.addEventListener('click', ()=>{
          const list = (getSavedOutlines && getSavedOutlines()) || []; const me = byId(list, o.id); if(!me) return;
          const s    = me.sections?.find(x=>x.id===sec.id); if(!s) return;
          const titleEl = secEl.querySelector('[data-role="edit-title"]'); const descEl  = secEl.querySelector('[data-role="edit-desc"]'); const minsEl  = secEl.querySelector('[data-role="edit-mins"]');
          s.name    = titleEl ? (titleEl.value || 'Untitled section') : s.name;
          s.desc    = descEl ? descEl.value : s.desc;
          s.minutes = minsEl ? Math.max(0.25, Number(minsEl.value || 0)) : s.minutes;
          setSavedOutlines(list); persist(o.id); editingSections.delete(secKey); renderSavedOutlines();
        });

        // Debounced description autosave
        const descEl = secEl?.querySelector('[data-role="edit-desc"]');
        if (descEl) {
          const autoSaveDesc = debounce(()=>{
            const list = (getSavedOutlines && getSavedOutlines()) || [];
            const me   = byId(list, o.id); if(!me) return;
            const s    = me.sections?.find(x=>x.id===sec.id); if(!s) return;
            s.desc = descEl.value; setSavedOutlines(list); persist(o.id);
          }, 400);
          descEl.addEventListener('input', autoSaveDesc);
        }

        // Links bar DnD + edit + delete
        if(linksBar){
          let over=0;
          linksBar.addEventListener('dragenter', ()=>{ over++; linksBar.classList.add('drag-over-outline'); });
          linksBar.addEventListener('dragleave', ()=>{ over=Math.max(0,over-1); if(!over) linksBar.classList.remove('drag-over-outline'); });
          linksBar.addEventListener('dragover', (e)=>{ e.preventDefault(); e.dataTransfer.dropEffect='copy'; });
          linksBar.addEventListener('drop', (e)=>{
            e.preventDefault(); over=0; linksBar.classList.remove('drag-over-outline');
            const list = (getSavedOutlines && getSavedOutlines()) || [];
            const me   = byId(list, o.id); if(!me) return;
            const s    = me.sections?.find(x=>x.id===sec.id); if(!s) return;
            s.links = s.links || [];
            // Accept drops from Planner shelf via payload type 'shelf'
            try{
              const payload = JSON.parse(e.dataTransfer.getData('text/plain') || '{}');
              if(payload?.type==='shelf'){
                // We don't access shelf list here; accept a generic link payload if present
                if(payload.label && payload.url){
                  s.links.push({ id:'l'+Date.now().toString(36), label:payload.label, url:payload.url, icon:payload.icon||'emoji', emoji:payload.emoji||'🔗', img:payload.img||'' });
                }
              }
            }catch{}
            setSavedOutlines(list); persist(o.id); renderSavedOutlines();
          });

          // Click to edit & delete
          linksBar.querySelectorAll('.section-link').forEach(pill=>{
            pill.addEventListener('dragstart', (e)=>{ const index = Number(pill.dataset.idx); try{
              e.dataTransfer.setData('text/plain', JSON.stringify({type:'reorder', index}));
              const img = new Image(); img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";
              if(e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(img, 0, 0);
            }catch{} e.dataTransfer.effectAllowed='move'; pill.classList.add('drag-ghost'); });
            pill.addEventListener('dragend', ()=> pill.classList.remove('drag-ghost'));
            pill.addEventListener('click', (e)=>{ e.stopPropagation();
              const list = (getSavedOutlines && getSavedOutlines()) || []; const me = byId(list, o.id); if(!me) return;
              const s    = me.sections?.find(x=>x.id===sec.id); if(!s) return;
              const i    = Number(pill.dataset.idx); const w = s.links?.[i]; if(!w) return;
              // Use editor from index
              window.openWidgetEditor && openWidgetEditor(w, (upd)=>{ upd.url = normalizeUrl(upd.url); Object.assign(w, upd); setSavedOutlines(list); persist(o.id); renderSavedOutlines(); });
            });
          });
          linksBar.querySelectorAll('[data-act="del-link"]').forEach(bin=>{
            bin.addEventListener('click', (e)=>{ e.stopPropagation();
              const list = (getSavedOutlines && getSavedOutlines()) || []; const me = byId(list, o.id); if(!me) return;
              const s    = me.sections?.find(x=>x.id===sec.id); if(!s) return;
              const pill = bin.closest('.widget')?.querySelector('.section-link');
              const i    = Number(pill?.dataset.idx ?? -1);
              if(i>=0){ s.links.splice(i,1); setSavedOutlines(list); persist(o.id); renderSavedOutlines(); }
            });
          });
        }
      });
    }); // end visible.forEach
  } // end renderSavedOutlines

  // ---------- create outline wiring ----------
  if(createBtn){ createBtn.onclick = ()=>{ createForm?.classList.toggle('hidden'); if(createForm && !createForm.classList.contains('hidden')){ createTitle.value=''; createTitle.focus(); } }; }
  if(createCancel){ createCancel.onclick = ()=> createForm?.classList.add('hidden'); }
  if(createOk){
    createOk.onclick = ()=>{
      const t = (createTitle?.value || '').trim() || 'New outline';
      const list = (getSavedOutlines && getSavedOutlines()) || [];
      const currentFolderId = (window.__getCurrentFolderId ? window.__getCurrentFolderId() : null);
      list.push({ id:'O'+Date.now().toString(36), title:t, sections:[], folderId: currentFolderId || null });
      setSavedOutlines(list);
      saveOutlinesLocal && saveOutlinesLocal(); renderHomeSavedBar && renderHomeSavedBar(); touchCloud && touchCloud();
      createForm?.classList.add('hidden'); renderSavedOutlines();
    };
  }

  // initial render
  renderSavedOutlines();

  // expose renderer (index calls it after folder ops)
  return { renderSavedOutlines };
}
