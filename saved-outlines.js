// saved-outlines.js
// Encapsulates the Saved Outlines tab UI/logic. Expects simple callbacks from index.

export function setupSavedOutlines({
  getSavedOutlines,
  setSavedOutlines,
  saveOutlinesLocal,
  getWidgetShelf,
  applyOutline,
  touchCloud,
  renderHomeSavedBar
}){
  const savedList = document.getElementById('savedList');
  const createOutlineBtn = document.getElementById('createOutlineBtn');
  const createOutlineForm = document.getElementById('createOutlineForm');
  const newOutlineTitleInput = document.getElementById('newOutlineTitle');
  const createOutlineConfirm = document.getElementById('createOutlineConfirm');
  const createOutlineCancel = document.getElementById('createOutlineCancel');

  const mergeBar = document.getElementById('mergeBar');
  const mergeSourceName = document.getElementById('mergeSourceName');
  const mergeTargetName = document.getElementById('mergeTargetName');
  const mergeTitleInput = document.getElementById('mergeTitleInput');
  const mergeConfirmBtn = document.getElementById('mergeConfirmBtn');
  const mergeCancelBtn  = document.getElementById('mergeCancelBtn');

  let mergeProposal = null;

  function ensureOutlineShapes(outlines){
    outlines.forEach(o=>{
      o.sections = o.sections || [];
      o.sections.forEach(s=>{
        if(typeof s.minutes!=='number') s.minutes = Number(s.minutes)||5;
        if(!('desc' in s)) s.desc='';
        if(!('links' in s)) s.links=[];
        if(!('name' in s)) s.name='Untitled';
        if(!('id' in s)) s.id='S'+Math.random().toString(16).slice(2);
      });
    });
  }

  function anySavedEditorOpen(){ return !!savedList.querySelector('.editor:not(.hidden)'); }

  function sectionEditorBlockHTML(s, idx){
    const linksHTML = (s.links||[]).map((l, li)=> editorLinkRowHTML(l, idx, li)).join('');
    return `
      <div class="border border-[var(--border)] rounded-lg p-3" data-idx="${idx}">
        <div class="flex flex-wrap items-center gap-2">
          <input class="input flex-1 sec-title" value="${escapeHtml(s.name)}" placeholder="Section title"/>
          <input class="input w-24 sec-mins" type="number" value="${(+s.minutes)||0}" min="0" step="0.25"/>
          <button class="btn-xxs" data-act="delete">Delete</button>
        </div>
        <div class="mt-2">
          <label class="text-xs muted">Notes</label>
          <textarea class="input w-full mt-1 sec-desc" rows="2" placeholder="Add notes…">${escapeHtml(s.desc||'')}</textarea>
        </div>
        <div class="mt-2">
          <div class="flex items-center justify-between">
            <span class="text-sm font-semibold">Links</span>
            <span class="text-xs muted">Drag from shelf • Drag to reorder</span>
          </div>
          <div class="mt-2 space-y-2 editor-links-area" data-idx="${idx}">
            ${linksHTML || `<div class="text-xs muted">No links yet.</div>`}
          </div>
        </div>
      </div>`;
  }
  function editorLinkRowHTML(l, sidx, li){
    const icon = l.icon==='img' && l.img ? `<img src="${l.img}" class="w-4 h-4 rounded-[3px] object-cover" alt=""/>` : `<span>${l.emoji||'🔗'}</span>`;
    return `
      <div class="editor-link-row" draggable="true" data-sidx="${sidx}" data-li="${li}">
        <span class="w-5 h-5 flex items-center justify-center border border-[var(--border)] rounded">${icon}</span>
        <input class="input flex-1 link-title" value="${escapeHtml(l.label||'')}" placeholder="Label"/>
        <input class="input flex-[2] link-url" value="${escapeHtml(l.url||'')}" placeholder="https://…"/>
        <button class="btn-xxs" data-act="icon">Icon</button>
        <button class="btn-xxs" data-act="remove">Remove</button>
      </div>`;
  }

  function renderOutlineEditor(container, outlineObj){
    const id = outlineObj.id;
    container.innerHTML = `
      <div class="mb-3">
        <div class="flex items-center justify-between">
          <div class="block-title">Link widgets</div>
          <div class="text-xs muted">Drag into a section’s Links</div>
        </div>
        <div class="mt-2 editor-shelf" id="editorShelf_${id}"></div>
      </div>
      <div class="space-y-3" id="editorBody_${id}"></div>
      <div class="mt-2 flex items-center gap-2">
        <button class="px-3 py-2 rounded-xl border border-[var(--border)] text-sm" data-act="add-section">+ Add Section</button>
        <span class="ml-auto text-xs muted">${outlineObj.sections.length} section${outlineObj.sections.length!==1?'s':''}</span>
      </div>
    `;

    // Shelf built from Home shelf (shared)
    const shelfEl = container.querySelector(`#editorShelf_${id}`);
    const widgetShelf = getWidgetShelf();
    shelfEl.innerHTML = widgetShelf.map(w=>{
      const icon = (w.icon==='img' && w.img)
        ? `<img src="${w.img}" alt="" class="link-icon rounded-[4px] object-cover" draggable="false"/>`
        : `<span class="link-icon">${w.emoji||'🔗'}</span>`;
      return `<div class="link-card editor-shelf-item" draggable="true" data-wid="${w.id}">
        ${icon}
        <div class="min-w-0"><div class="truncate">${escapeHtml(w.label)}</div><div class="text-xs muted truncate">${escapeHtml(w.url||'')}</div></div>
      </div>`;
    }).join('');
    shelfEl.querySelectorAll('.editor-shelf-item').forEach(card=>{
      card.addEventListener('dragstart', e=>{
        const payloadStr = JSON.stringify({type:'shelf', id:card.dataset.wid});
        try{ e.dataTransfer.setData('text/plain', payloadStr); }catch{}
        e.dataTransfer.effectAllowed='copy';
        card.classList.add('drag-ghost');
      });
      card.addEventListener('dragend', ()=> card.classList.remove('drag-ghost'));
    });

    const body = container.querySelector(`#editorBody_${id}`);
    body.innerHTML = outlineObj.sections.map((s, idx)=> sectionEditorBlockHTML(s, idx)).join('');
    attachSectionEditorHandlers(body, outlineObj, id);

    container.querySelector('[data-act="add-section"]').onclick = ()=>{
      outlineObj.sections.push({ id:'S'+Date.now()+Math.random().toString(16).slice(2), name:'New section', minutes:5, desc:'', links:[] });
      saveOutlinesLocal(); touchCloud(); renderOutlineEditor(container, outlineObj);
    };
  }

  function attachSectionEditorHandlers(container, outlineObj, oid){
    // Inputs
    container.querySelectorAll('[data-idx]').forEach(block=>{
      const idx = +block.dataset.idx;
      const title = block.querySelector('.sec-title');
      const mins  = block.querySelector('.sec-mins');
      const desc  = block.querySelector('.sec-desc');
      title.addEventListener('input', ()=>{ outlineObj.sections[idx].name = title.value; saveOutlinesLocal(); });
      mins.addEventListener('input', ()=>{ outlineObj.sections[idx].minutes = Math.max(0, Number(mins.value)||0); saveOutlinesLocal(); });
      desc.addEventListener('input', ()=>{ outlineObj.sections[idx].desc = desc.value; saveOutlinesLocal(); });

      block.querySelector('[data-act="delete"]').addEventListener('click', ()=>{
        if(!confirm('Delete section?')) return;
        outlineObj.sections.splice(idx,1);
        saveOutlinesLocal(); renderOutlineEditor(block.closest('.editor'), outlineObj);
      });

      // Link field changes
      block.querySelectorAll('.link-title').forEach((inp, li)=> inp.addEventListener('input', ()=>{ outlineObj.sections[idx].links[li].label = inp.value; saveOutlinesLocal(); }));
      block.querySelectorAll('.link-url').forEach((inp, li)=> inp.addEventListener('input', ()=>{ outlineObj.sections[idx].links[li].url = inp.value; saveOutlinesLocal(); }));

      // Buttons on link rows
      block.querySelectorAll('[data-act="remove"]').forEach((btn, li)=> btn.addEventListener('click', ()=>{
        outlineObj.sections[idx].links.splice(li,1); saveOutlinesLocal(); renderOutlineEditor(block.closest('.editor'), outlineObj);
      }));
      block.querySelectorAll('[data-act="icon"]').forEach((btn, li)=> btn.addEventListener('click', ()=>{
        const cur = outlineObj.sections[idx].links[li];
        const type = (prompt('Icon type: emoji / img', cur.icon||'emoji')||'emoji').toLowerCase();
        if(type==='img'){ cur.icon='img'; cur.img=prompt('Image URL (.png/.ico):', cur.img||'')||''; cur.emoji=''; }
        else{ cur.icon='emoji'; cur.emoji=prompt('Emoji/text:', cur.emoji||'🔗')||'🔗'; cur.img=''; }
        saveOutlinesLocal(); renderOutlineEditor(block.closest('.editor'), outlineObj);
      }));

      // Drag FROM link rows (reorder)
      block.querySelectorAll('.editor-link-row').forEach(row=>{
        row.addEventListener('dragstart', e=>{
          const sidx = Number(row.dataset.sidx); const li = Number(row.dataset.li);
          const payloadStr = JSON.stringify({type:'reorder', index: li, sidx});
          try{ e.dataTransfer.setData('text/plain', payloadStr); }catch{}
          e.dataTransfer.effectAllowed='move';
          row.classList.add('drag-ghost');
        });
        row.addEventListener('dragend', ()=> row.classList.remove('drag-ghost'));
      });

      // Drop target for adding/reordering links
      const linksArea = block.querySelector('.editor-links-area');
      let over=0;
      linksArea.addEventListener('dragenter', ()=>{ over++; linksArea.classList.add('drag-over-outline'); });
      linksArea.addEventListener('dragleave', ()=>{ over=Math.max(0,over-1); if(over===0) linksArea.classList.remove('drag-over-outline'); });
      linksArea.addEventListener('dragover', e=>{ e.preventDefault(); e.dataTransfer.dropEffect='copy'; });
      linksArea.addEventListener('drop', e=>{
        e.preventDefault(); over=0; linksArea.classList.remove('drag-over-outline');
        const payload = parseDropPayload(e.dataTransfer); if(!payload) return;
        const section = outlineObj.sections[idx];
        if(payload.type==='shelf'){
          const w=(getWidgetShelf()||[]).find(x=>x.id===payload.id); if(!w) return;
          section.links.push({ id:'l_'+Date.now()+Math.random().toString(16).slice(2), label:w.label, url:w.url, icon:w.icon, emoji:w.emoji||'', img:w.img||'' });
          saveOutlinesLocal(); renderOutlineEditor(linksArea.closest('.editor'), outlineObj);
        }else if(payload.type==='reorder' && (payload.sidx===undefined || payload.sidx===idx)){
          const from = payload.index;
          const items=[...linksArea.querySelectorAll('.editor-link-row')];
          let to = items.length;
          for(let i=0;i<items.length;i++){ const r=items[i].getBoundingClientRect(); if(e.clientY < r.top + r.height/2){ to=i; break; } }
          if(from===to) return;
          const [m]=section.links.splice(from,1); section.links.splice(to,0,m);
          saveOutlinesLocal(); renderOutlineEditor(linksArea.closest('.editor'), outlineObj);
        }
      });
    });
  }

  function renderSavedOutlines(afterRenderCb){
    const savedOutlines = getSavedOutlines();
    ensureOutlineShapes(savedOutlines);
    savedList.innerHTML = savedOutlines.map(o=>`
      <div class="card p-4" data-oid="${o.id}">
        <div class="flex items-center gap-2">
          <input class="input flex-1 outline-title" value="${escapeHtml(o.title)}" aria-label="Outline title"/>
          <div class="ml-auto flex items-center gap-2">
            <button class="btn-xs" data-act="edit">Edit</button>
            <button class="btn-xs" data-act="load">Load</button>
            <button class="btn-xs" data-act="delete">Delete</button>
          </div>
        </div>
        <div class="mt-3 hidden editor"></div>
      </div>`).join('');

    // Per-card wiring
    savedList.querySelectorAll('[data-oid]').forEach(card=>{
      const oid = card.dataset.oid;
      const outlineObj = getSavedOutlines().find(x=>x.id===oid);

      // Allow drag-to-merge ONLY when no editor is open
      const willAllowDnD = ()=> !anySavedEditorOpen();
      const setCardDraggable = ()=>{
        card.draggable = willAllowDnD();
        card.classList.toggle('opacity-60', anySavedEditorOpen());
      };
      setCardDraggable();

      card.addEventListener('dragstart', (e)=>{ if(!willAllowDnD()){ e.preventDefault(); return; } e.dataTransfer.setData('text/plain', oid); e.dataTransfer.effectAllowed='move'; card.classList.add('drag-ghost'); });
      card.addEventListener('dragend', ()=> card.classList.remove('drag-ghost'));
      card.addEventListener('dragover', (e)=>{ if(!willAllowDnD()) return; e.preventDefault(); card.classList.add('drag-over-outline'); });
      card.addEventListener('dragleave', ()=> card.classList.remove('drag-over-outline'));
      card.addEventListener('drop', (e)=>{
        if(!willAllowDnD()) return;
        e.preventDefault(); card.classList.remove('drag-over-outline');
        const sourceId = e.dataTransfer.getData('text/plain'); const targetId = oid; if(!sourceId || sourceId===targetId) return;
        const src = getSavedOutlines().find(x=>x.id===sourceId); const tgt = getSavedOutlines().find(x=>x.id===targetId); if(!src || !tgt) return;
        mergeProposal = {sourceId, targetId};
        mergeSourceName.textContent = src.title; mergeTargetName.textContent = tgt.title;
        mergeTitleInput.value = `${tgt.title} + ${src.title}`; mergeBar.style.display='block'; mergeTitleInput.focus();
      });

      // Title change (live)
      card.querySelector('.outline-title')?.addEventListener('input', e=>{
        outlineObj.title = e.target.value;
        saveOutlinesLocal();
        renderHomeSavedBar();
        touchCloud();
      });

      // Edit toggle
      card.querySelector('[data-act="edit"]').addEventListener('click', ()=>{
        const editor = card.querySelector('.editor');
        const opening = editor.classList.contains('hidden');
        editor.classList.toggle('hidden', !opening);
        if(opening){ card.setAttribute('data-editing','true'); renderOutlineEditor(editor, outlineObj); }
        else{ card.removeAttribute('data-editing'); }
        savedList.querySelectorAll('[data-oid]').forEach(c=> c.draggable = !anySavedEditorOpen());
        savedList.querySelectorAll('[data-oid]').forEach(c=> c.classList.toggle('opacity-60', anySavedEditorOpen()));
      });

      // Load into Home
      card.querySelector('[data-act="load"]').addEventListener('click', ()=>{ applyOutline(outlineObj); document.querySelector('.tab-link[data-tab="homeTab"]')?.click(); });

      // Delete outline
      card.querySelector('[data-act="delete"]').addEventListener('click', ()=>{
        if(!confirm('Delete this outline?')) return;
        const arr = getSavedOutlines().slice();
        const idx = arr.findIndex(x=>x.id===oid);
        if(idx>=0){ arr.splice(idx,1); setSavedOutlines(arr); saveOutlinesLocal(); renderSavedOutlines(); renderHomeSavedBar(); touchCloud(); }
      });
    });

    // Merge bar
    mergeCancelBtn.onclick = ()=>{ mergeProposal=null; mergeBar.style.display='none'; };
    mergeConfirmBtn.onclick = ()=>{
      if(!mergeProposal) return;
      const arr = getSavedOutlines().slice();
      const {sourceId, targetId} = mergeProposal; const src = arr.find(x=>x.id===sourceId); const tgt = arr.find(x=>x.id===targetId); if(!src || !tgt) return;
      const newSections = [
        ...tgt.sections.map(s=>({ ...structuredClone(s), id:'S'+Math.random().toString(16).slice(2) })),
        ...src.sections.map(s=>({ ...structuredClone(s), id:'S'+Math.random().toString(16).slice(2) }))
      ];
      const title = (mergeTitleInput.value||'').trim() || `${tgt.title} + ${src.title}`;
      const merged = { id:'O'+Date.now(), title, sections:newSections, createdAt: Date.now() };
      arr.unshift(merged); setSavedOutlines(arr); saveOutlinesLocal(); mergeProposal=null; mergeBar.style.display='none'; renderSavedOutlines(); renderHomeSavedBar(); touchCloud();
    };

    if(typeof afterRenderCb==='function') afterRenderCb();
  }

  // Create outline UI
  createOutlineBtn.onclick = ()=>{
    createOutlineForm.classList.remove('hidden');
    newOutlineTitleInput.value=''; newOutlineTitleInput.focus();
  };
  createOutlineCancel.onclick = ()=> createOutlineForm.classList.add('hidden');
  createOutlineConfirm.onclick = ()=>{
    const title = (newOutlineTitleInput.value||'').trim() || 'New outline';
    const arr = getSavedOutlines().slice();
    const outlineObj = { id:'O'+Date.now()+Math.random().toString(16).slice(2), title, sections:[], createdAt: Date.now() };
    arr.unshift(outlineObj); setSavedOutlines(arr); saveOutlinesLocal();
    createOutlineForm.classList.add('hidden');
    renderSavedOutlines(()=>{ // open editor instantly
      const card = document.querySelector(`[data-oid="${outlineObj.id}"]`);
      if(card){ const editor = card.querySelector('.editor'); if(editor && editor.classList.contains('hidden')){ editor.classList.remove('hidden'); card.setAttribute('data-editing','true'); renderOutlineEditor(editor, outlineObj); } }
    });
    touchCloud();
  };

  // Utilities
  function escapeHtml(s){ return (s??'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  function parseDropPayload(dt){
    let data = ''; const types = dt?.types ? Array.from(dt.types) : [];
    if(types.includes('text/plain')) data = dt.getData('text/plain');
    if(!data && types.includes('text')) data = dt.getData('text');
    if(!data) data = dt.getData('application/json') || dt.getData('Text') || '';
    try{ return JSON.parse(data); }catch{ return null; }
  }

  // Initial paint
  function init(){ renderSavedOutlines(); }
  init();

  // Public API back to index
  return {
    renderSavedOutlines
  };
}

