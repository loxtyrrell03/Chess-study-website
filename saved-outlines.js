// saved-outlines.js — Outline accordion + compact subsections + per-section edit mode
//
// Exports: setupSavedOutlines({ getSavedOutlines, setSavedOutlines, saveOutlinesLocal,
//                              getWidgetShelf, setWidgetShelf, applyOutline,
//                              touchCloud, renderHomeSavedBar })
//
// Changes per request:
// • Outline card starts COLLAPSED: Title + [+ Section] + Load + Delete + ▶ chevron.
// • Expanding shows subsections as SMALL, INDENTED rows (title + minutes on the right).
// • Clicking a subsection opens EDIT MODE with: Title input, Description textarea, Minutes,
//   inline Widget Shelf (above), and a labeled “Links” drop bar (below the shelf).
// • Green Save button (bottom-right) saves changes and exits edit mode.
// • Shelf items: single-click to edit; bin to delete. Links: reorder by drag, click to edit, bin to delete.
// • Subsections themselves can be REORDERED by drag-and-drop (when not in edit mode).
// • Preview rows have a right-side bin icon (doesn’t overlap time).
// • Merge outlines by dragging one outline title onto another card (merge bar UI).
//
// Note: remove the “No saved outlines yet” banner — renders empty when list is empty.

export function setupSavedOutlines({
  getSavedOutlines,
  setSavedOutlines,
  saveOutlinesLocal,
  getWidgetShelf,
  setWidgetShelf,
  applyOutline,
  touchCloud,
  renderHomeSavedBar
}) {
  // DOM
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

  // UI state
  const expandedOutlines = new Set();      // outline ids that are expanded
  const editingSections  = new Set();      // keys `${outlineId}|${sectionId}`
  let draggingOutlineId  = null;           // for merge drag
  let draggingSec = null;                  // { oid, sid, from } for subsection reordering

  /* ---------- helpers ---------- */
  const escapeHtml = (s)=> (s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const byId  = (arr, id)=> (arr || []).find(x => x.id === id);
  const keyOf = (oId, sId)=> `${oId}|${sId}`;
  const fmtMins = (n)=> String(Number(n || 0)).replace(/\.0+$/,'');
  const escSel = (s)=> (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');
  const saveAll = ()=>{
    saveOutlinesLocal && saveOutlinesLocal();
    renderHomeSavedBar && renderHomeSavedBar();
    touchCloud && touchCloud();
  };
  function parsePayload(dt){
    let str=''; const types = dt?.types ? Array.from(dt.types) : [];
    if(types.includes('text/plain')) str = dt.getData('text/plain');
    if(!str && types.includes('text')) str = dt.getData('text');
    if(!str) str = dt.getData('application/json') || dt.getData('Text') || '';
    try{ return JSON.parse(str); }catch{ return null; }
  }

  /* ---------- modal editor for a link/shelf widget ---------- */
  function openWidgetEditor(widget, onSave){
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-backdrop" data-close="1"></div>
      <div class="modal-panel max-w-[520px]">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-lg font-semibold">Edit link</h3>
          <button class="btn-xxs" data-close="1">✕</button>
        </div>
        <div class="grid gap-2">
          <label class="text-sm">Title
            <input id="wLabel" class="input mt-1" value="${escapeHtml(widget.label || '')}"/>
          </label>
          <label class="text-sm">URL
            <input id="wUrl" class="input mt-1" value="${escapeHtml(widget.url || '')}" placeholder="https://…"/>
          </label>
          <label class="text-sm">Icon type
            <select id="wIcon" class="input mt-1">
              <option value="emoji" ${widget.icon!=='img'?'selected':''}>Emoji/Text</option>
              <option value="img"   ${widget.icon==='img'?'selected':''}>Image URL</option>
            </select>
          </label>
          <label class="text-sm" id="emojiRow">Emoji/Text
            <input id="wEmoji" class="input mt-1" value="${escapeHtml(widget.emoji || '')}" placeholder="♟️"/>
          </label>
          <label class="text-sm hidden" id="imgRow">Image URL
            <input id="wImg" class="input mt-1" value="${escapeHtml(widget.img || '')}" placeholder="https://…/icon.png"/>
          </label>
        </div>
        <div class="mt-3 flex items-center justify-end gap-2">
          <button class="px-3 py-2 rounded-xl border border-[var(--border)]" data-close="1">Cancel</button>
          <button id="wSave" class="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white">Save</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const iconSel = modal.querySelector('#wIcon');
    const emojiRow = modal.querySelector('#emojiRow');
    const imgRow   = modal.querySelector('#imgRow');
    const syncRows = ()=>{
      const useImg = iconSel.value==='img';
      emojiRow.classList.toggle('hidden', useImg);
      imgRow.classList.toggle('hidden', !useImg);
    };
    syncRows();
    iconSel.addEventListener('change', syncRows);

    const close = ()=>{ modal.classList.add('hidden'); setTimeout(()=>modal.remove(), 140); };
    modal.addEventListener('click', (e)=>{ if(e.target.dataset.close==='1') close(); });
    const onEsc = (e)=>{ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', onEsc);} };
    document.addEventListener('keydown', onEsc);

    modal.querySelector('#wSave').onclick = ()=>{
      const label = modal.querySelector('#wLabel').value.trim() || 'Untitled';
      const url   = modal.querySelector('#wUrl').value.trim() || '';
      const icon  = iconSel.value==='img' ? 'img' : 'emoji';
      let emoji='', img='';
      if(icon==='img') img = modal.querySelector('#wImg').value.trim();
      else emoji = modal.querySelector('#wEmoji').value.trim() || '🔗';
      onSave({ label, url, icon, emoji, img });
      close();
    };
  }

  /* ---------- HTML builders ---------- */

  // Subsection PREVIEW row (small, indented) — includes minutes + right bin
  function sectionPreviewRowHtml(s){
    return `
      <div class="rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] cursor-pointer select-none"
           data-sid="${escapeHtml(s.id)}" data-view="preview"
           style="padding:.35rem .5rem; margin-left:18px;">
        <div class="flex items-center gap-2">
          <div class="truncate flex-1 text-[.98rem] font-semibold">${escapeHtml(s.name || 'Untitled section')}</div>
          <span class="text-xs muted w-12 text-right">${fmtMins(s.minutes)}m</span>
          <button class="btn-xxs" data-act="del-sec" title="Delete section"
                  style="margin-left:.25rem">🗑️</button>
        </div>
      </div>`;
  }

  // Link pill inside a section (non-navigating)
  function linkPillHtml(w, i){
    const iconHtml = (w.icon==='img' && w.img)
      ? `<img src="${escapeHtml(w.img)}" alt="" class="link-icon rounded-[4px] object-cover" draggable="false"/>`
      : `<span class="link-icon">${escapeHtml(w.emoji || '🔗')}</span>`;
    return `
      <div class="widget" data-link-idx="${i}">
        <div class="link-card section-link" draggable="true" data-idx="${i}" style="padding:.35rem .55rem;font-size:.9rem;">
          ${iconHtml}
          <span class="truncate max-w-[12rem]">${escapeHtml(w.label || 'Untitled')}</span>
        </div>
        <button class="bin" data-act="del-link" title="Delete">🗑️</button>
      </div>`;
  }

  // Inline Widget Shelf (ABOVE the Links bar)
  function inlineShelfHtml(shelf){
    const items = (shelf||[]).map(w=>{
      const iconHtml = (w.icon==='img' && w.img)
        ? `<img src="${escapeHtml(w.img)}" alt="" class="link-icon rounded-[4px] object-cover" draggable="false"/>`
        : `<span class="link-icon">${escapeHtml(w.emoji || '🔗')}</span>`;
      return `
        <div class="widget" data-wid="${escapeHtml(w.id)}" style="position:relative;">
          <div class="link-card draggable-shelf" draggable="true" data-wid="${escapeHtml(w.id)}" title="${escapeHtml(w.url || '')}" style="cursor:grab">
            ${iconHtml}
            <div class="min-w-0">
              <div class="truncate">${escapeHtml(w.label || 'Untitled')}</div>
              <div class="text-xs muted truncate">${escapeHtml(w.url || '')}</div>
            </div>
          </div>
          <button class="bin" data-act="del-shelf" title="Delete from shelf">🗑️</button>
        </div>`;
    }).join('');
    return `
      <div class="mt-2 p-2 rounded-xl border border-[var(--border)] bg-white" data-role="inline-shelf">
        <div class="editor-shelf" data-role="shelf-row">
          ${items || '<div class="text-xs muted">No shelf widgets yet.</div>'}
        </div>
        <div class="text-xs muted mt-1">Drag from shelf → drop into the “Links” bar below. Click any shelf item to edit.</div>
      </div>`;
  }

  // Subsection EDIT card (Title + Description + Minutes + Shelf on top + Links bar + Save)
  function sectionEditCardHtml(s){
    const desc = escapeHtml(s.desc || '');
    return `
      <div class="rounded-lg border border-[var(--border)] bg-[var(--panel)]"
           data-sid="${escapeHtml(s.id)}" data-view="edit"
           style="padding:.5rem .6rem; margin-left:18px;">
        <div class="grid gap-2">
          <label class="text-sm">Title
            <input class="input mt-1" data-role="edit-title" value="${escapeHtml(s.name || '')}" placeholder="Section title"/>
          </label>
          <label class="text-sm">Description</label>
          <textarea class="input w-full" data-role="edit-desc" style="min-height:80px">${desc}</textarea>
          <div class="flex items-center gap-2">
            <label class="text-sm">Minutes
              <input class="input ml-2 w-24" type="number" min="0.25" step="0.25" data-role="edit-mins" value="${escapeHtml(String(s.minutes || 0))}"/>
            </label>
          </div>

          ${inlineShelfHtml((getWidgetShelf && getWidgetShelf()) || [])}

          <div class="mt-2">
            <div class="text-sm font-bold mb-1">Links</div>
            <div class="section-links-bar" data-role="links-bar">
              ${(s.links||[]).map((w,i)=>linkPillHtml(w,i)).join('')}
            </div>
          </div>

          <div class="mt-2 flex justify-end">
            <button class="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white" data-act="save-section">Save</button>
          </div>
        </div>
      </div>`;
  }

  // Outline card (collapsed or expanded)
  function outlineCardHtml(o, isExpanded){
    const chevron = isExpanded ? '▾' : '▸';
    return `
      <div class="card p-4" data-oid="${escapeHtml(o.id)}">
        <div class="flex items-center gap-2">
          <div class="flex-1 font-bold text-lg truncate">${escapeHtml(o.title || 'Untitled outline')}</div>
          <button class="btn-xs" data-act="add-section">+ Section</button>
          <button class="btn-xs" data-act="load">Load</button>
          <button class="btn-xs" data-act="delete">Delete</button>
          <button class="btn-xxs" data-act="toggle-expand" aria-expanded="${isExpanded ? 'true':'false'}" title="${isExpanded?'Collapse':'Expand'}">${chevron}</button>
        </div>
        ${isExpanded ? `
          <div class="mt-3 grid gap-2" data-role="sections">
            ${(o.sections||[]).map(s=>{
              const k = keyOf(o.id, s.id);
              return editingSections.has(k) ? sectionEditCardHtml(s) : sectionPreviewRowHtml(s);
            }).join('')}
          </div>` : ''}
      </div>`;
  }

  /* ---------- renderer ---------- */
  function renderSavedOutlines(){
    if(!savedListEl) return;
    const outlines = getSavedOutlines() || [];
    // No placeholder banner when empty — per request
    savedListEl.innerHTML = outlines.map(o => outlineCardHtml(o, expandedOutlines.has(o.id))).join('');

    // Wire up each outline card
    outlines.forEach(o=>{
      const card = savedListEl.querySelector(`[data-oid="${escSel(o.id)}"]`);
      if(!card) return;

      // Header actions
      card.querySelector('[data-act="load"]')?.addEventListener('click', ()=> applyOutline && applyOutline(o));
      card.querySelector('[data-act="delete"]')?.addEventListener('click', ()=>{
        if(!confirm('Delete this outline?')) return;
        const list = getSavedOutlines() || [];
        const idx = list.findIndex(x=>x.id===o.id);
        if(idx>=0){ list.splice(idx,1); setSavedOutlines(list); saveAll(); renderSavedOutlines(); }
      });
      card.querySelector('[data-act="toggle-expand"]')?.addEventListener('click', ()=>{
        if(expandedOutlines.has(o.id)) expandedOutlines.delete(o.id);
        else expandedOutlines.add(o.id);
        renderSavedOutlines();
      });
      card.querySelector('[data-act="add-section"]')?.addEventListener('click', ()=>{
        const list = getSavedOutlines() || [];
        const me   = byId(list, o.id); if(!me) return;
        me.sections = me.sections || [];
        me.sections.push({ id:'S'+Date.now().toString(36), name:'New section', minutes:5, desc:'', links:[] });
        setSavedOutlines(list); saveAll();
        expandedOutlines.add(o.id); // auto-expand so user sees the new subsection
        renderSavedOutlines();
      });

      // Drag-to-merge (title draggable onto other outline cards)
      const titleEl = card.querySelector('.font-bold');
      if(titleEl){
        titleEl.setAttribute('draggable','true');
        titleEl.addEventListener('dragstart', (e)=>{
          draggingOutlineId = o.id;
          try{ e.dataTransfer.setData('text/plain', JSON.stringify({type:'merge', id:o.id})); }catch{}
          e.dataTransfer.effectAllowed='move';
          card.classList.add('drag-ghost');
        });
        titleEl.addEventListener('dragend', ()=>{
          draggingOutlineId = null;
          card.classList.remove('drag-ghost');
          document.querySelectorAll('[data-oid]').forEach(el=>{ el.style.outline=''; el.style.outlineOffset=''; });
        });
        card.addEventListener('dragover', (e)=>{
          if(draggingOutlineId && draggingOutlineId !== o.id){
            e.preventDefault();
            card.style.outline='2px dashed var(--accent)'; card.style.outlineOffset='4px';
          }
        });
        card.addEventListener('dragleave', ()=>{
          card.style.outline=''; card.style.outlineOffset='';
        });
        card.addEventListener('drop', (e)=>{
          card.style.outline=''; card.style.outlineOffset='';
          if(!draggingOutlineId || draggingOutlineId===o.id) return;
          e.preventDefault();
          const list = getSavedOutlines() || [];
          const src = byId(list, draggingOutlineId);
          const tgt = o;
          if(!src || !tgt) return;
          if(mergeBar){
            mergeBar.style.display='block';
            if(mergeSrcName)  mergeSrcName.textContent  = src.title || 'Untitled';
            if(mergeTgtName)  mergeTgtName.textContent  = tgt.title || 'Untitled';
            if(mergeTitleInp) mergeTitleInp.value = `${tgt.title||'Untitled'} + ${src.title||'Untitled'}`;
            mergeConfirm.onclick = ()=>{
              const merged = {
                id:'O'+Date.now().toString(36),
                title:(mergeTitleInp?.value || '').trim() || `${tgt.title||''} + ${src.title||''}`,
                sections:[...(tgt.sections||[]).map(s=>structuredClone(s)), ...(src.sections||[]).map(s=>structuredClone(s))]
              };
              list.push(merged);
              setSavedOutlines(list); saveAll();
              mergeBar.style.display='none';
              renderSavedOutlines();
            };
            mergeCancel.onclick = ()=>{ mergeBar.style.display='none'; };
          }
        });
      }

      // Sections wiring (only if expanded)
      if(!expandedOutlines.has(o.id)) return;
      const sectionsWrap = card.querySelector('[data-role="sections"]');
      if(!sectionsWrap) return;

      // Enable drag-reorder of subsections (preview rows only)
      const previewRows = Array.from(sectionsWrap.querySelectorAll('[data-view="preview"]'));
      previewRows.forEach((row, idx)=>{
        row.setAttribute('draggable', 'true');
        row.addEventListener('dragstart', (e)=>{
          draggingSec = { oid:o.id, sid: row.getAttribute('data-sid'), from: idx };
          try{ e.dataTransfer.setData('text/plain', JSON.stringify({type:'sec-move', oid:o.id, sid:draggingSec.sid, from: idx})); }catch{}
          e.dataTransfer.effectAllowed='move';
          row.classList.add('drag-ghost');
        });
        row.addEventListener('dragend', ()=>{
          draggingSec = null;
          row.classList.remove('drag-ghost');
          previewRows.forEach(r=> r.style.outline='');
        });
        row.addEventListener('dragover', (e)=>{
          const payload = parsePayload(e.dataTransfer) || draggingSec;
          if(payload && (payload.type==='sec-move' || draggingSec) && (payload.oid===o.id)){
            e.preventDefault();
            row.style.outline = '2px dashed var(--accent)';
          }
        });
        row.addEventListener('dragleave', ()=>{
          row.style.outline='';
        });
        row.addEventListener('drop', (e)=>{
          row.style.outline='';
          const payload = parsePayload(e.dataTransfer) || draggingSec;
          if(!payload || (payload.oid!==o.id)) return;
          e.preventDefault();
          const list = getSavedOutlines() || [];
          const me   = byId(list, o.id); if(!me) return;
          const from = Number(payload.from);
          const to   = idx;
          if(isNaN(from) || isNaN(to) || from===to) return;
          const [moved] = me.sections.splice(from,1);
          me.sections.splice(to,0,moved);
          setSavedOutlines(list); saveAll();
          renderSavedOutlines();
        });

        // Clicking preview -> enter edit (except when clicking the bin)
        row.addEventListener('click', (e)=>{
          if(e.target && (e.target.closest('[data-act="del-sec"]'))) return;
          editingSections.add(keyOf(o.id, row.getAttribute('data-sid')));
          renderSavedOutlines();
        });

        // Bin button on preview row
        row.querySelector('[data-act="del-sec"]')?.addEventListener('click', (e)=>{
          e.stopPropagation();
          const list = getSavedOutlines() || [];
          const me   = byId(list, o.id); if(!me) return;
          const sidx = me.sections.findIndex(se => se.id === row.getAttribute('data-sid'));
          if(sidx>=0){
            if(confirm('Delete this section?')){
              me.sections.splice(sidx,1);
              setSavedOutlines(list); saveAll(); renderSavedOutlines();
            }
          }
        });
      });

      // Wire edit cards
      (o.sections || []).forEach(sec=>{
        const secKey = keyOf(o.id, sec.id);
        if(!editingSections.has(secKey)) return;
        const secEl = sectionsWrap.querySelector(`[data-sid="${escSel(sec.id)}"][data-view="edit"]`);
        if(!secEl) return;

        // Save button
        secEl.querySelector('[data-act="save-section"]')?.addEventListener('click', (ev)=>{
          ev.stopPropagation();
          const list = getSavedOutlines() || [];
          const me   = byId(list, o.id); if(!me) return;
          const s    = me.sections?.find(x=>x.id===sec.id); if(!s) return;
          const titleEl = secEl.querySelector('[data-role="edit-title"]');
          const descEl  = secEl.querySelector('[data-role="edit-desc"]');
          const minsEl  = secEl.querySelector('[data-role="edit-mins"]');
          s.name    = titleEl ? (titleEl.value || 'Untitled section') : s.name;
          s.desc    = descEl ? descEl.value : s.desc;
          s.minutes = minsEl ? Math.max(0.25, Number(minsEl.value || 0)) : s.minutes;
          setSavedOutlines(list); saveAll();
          editingSections.delete(secKey);
          renderSavedOutlines();
        });

        // Links bar DnD
        const bar = secEl.querySelector('[data-role="links-bar"]');
        if(bar){
          let over=0;
          bar.addEventListener('dragenter', ()=>{ over++; bar.classList.add('drag-over-outline'); });
          bar.addEventListener('dragleave', ()=>{ over=Math.max(0,over-1); if(!over) bar.classList.remove('drag-over-outline'); });
          bar.addEventListener('dragover', (e)=>{ e.preventDefault(); e.dataTransfer.dropEffect='copy'; });
          bar.addEventListener('drop', (e)=>{
            e.preventDefault(); over=0; bar.classList.remove('drag-over-outline');
            const payload = parsePayload(e.dataTransfer);
            const list = getSavedOutlines() || [];
            const me   = byId(list, o.id); if(!me) return;
            const s    = me.sections?.find(x=>x.id===sec.id); if(!s) return;
            s.links = s.links || [];
            if(payload?.type==='shelf'){
              const shelf = (getWidgetShelf && getWidgetShelf()) || [];
              const w = shelf.find(x=>x.id===payload.id);
              if(!w) return;
              s.links.push({ id:'l'+Date.now().toString(36), label:w.label, url:w.url, icon:w.icon, emoji:w.emoji||'', img:w.img||'' });
              setSavedOutlines(list); saveAll(); renderSavedOutlines();
            }else if(payload?.type==='reorder'){
              const from = payload.index;
              const cards = [...bar.querySelectorAll('.section-link')];
              let to = cards.length;
              for(let i=0;i<cards.length;i++){
                const r = cards[i].getBoundingClientRect();
                if(e.clientY < r.top + r.height/2){ to=i; break; }
              }
              if(from==null || to==null || from===to) return;
              const [moved] = s.links.splice(from,1);
              s.links.splice(to,0,moved);
              setSavedOutlines(list); saveAll(); renderSavedOutlines();
            }
          });

          // link pill: reorder + edit + delete
          bar.querySelectorAll('.section-link').forEach(pill=>{
            pill.addEventListener('dragstart', (e)=>{
              const index = Number(pill.dataset.idx);
              try{ e.dataTransfer.setData('text/plain', JSON.stringify({type:'reorder', index})); }catch{}
              e.dataTransfer.effectAllowed='move';
              pill.classList.add('drag-ghost');
            });
            pill.addEventListener('dragend', ()=> pill.classList.remove('drag-ghost'));
            pill.addEventListener('click', (e)=>{
              e.stopPropagation();
              const list = getSavedOutlines() || [];
              const me   = byId(list, o.id); if(!me) return;
              const s    = me.sections?.find(x=>x.id===sec.id); if(!s) return;
              const i    = Number(pill.dataset.idx);
              const w    = s.links?.[i]; if(!w) return;
              openWidgetEditor(w, (upd)=>{ Object.assign(w, upd); setSavedOutlines(list); saveAll(); renderSavedOutlines(); });
            });
          });
          bar.querySelectorAll('[data-act="del-link"]').forEach(bin=>{
            bin.addEventListener('click', (e)=>{
              e.stopPropagation();
              const list = getSavedOutlines() || [];
              const me   = byId(list, o.id); if(!me) return;
              const s    = me.sections?.find(x=>x.id===sec.id); if(!s) return;
              const pill = bin.closest('.widget')?.querySelector('.section-link');
              const i    = Number(pill?.dataset.idx ?? -1);
              if(i>=0){ s.links.splice(i,1); setSavedOutlines(list); saveAll(); renderSavedOutlines(); }
            });
          });
        }

        // Inline shelf actions (drag & edit & delete)
        const shelfWrap = secEl.querySelector('[data-role="inline-shelf"]');
        if(shelfWrap){
          shelfWrap.querySelectorAll('.draggable-shelf').forEach(card=>{
            card.addEventListener('dragstart', (e)=>{
              const id = card.dataset.wid;
              try{ e.dataTransfer.setData('text/plain', JSON.stringify({type:'shelf', id})); }catch{}
              e.dataTransfer.effectAllowed='copy';
              card.classList.add('drag-ghost');
            });
            card.addEventListener('dragend', ()=> card.classList.remove('drag-ghost'));
            card.addEventListener('click', (e)=>{
              e.stopPropagation();
              if(!setWidgetShelf) return alert('setWidgetShelf not wired in index.html');
              const shelf = (getWidgetShelf && getWidgetShelf()) || [];
              const w = shelf.find(x=>x.id===card.dataset.wid); if(!w) return;
              openWidgetEditor(w, (upd)=>{ Object.assign(w, upd); setWidgetShelf([...shelf]); renderSavedOutlines(); });
            });
          });
          shelfWrap.querySelectorAll('[data-act="del-shelf"]').forEach(btn=>{
            btn.addEventListener('click', (e)=>{
              e.stopPropagation();
              if(!setWidgetShelf) return alert('setWidgetShelf not wired in index.html');
              const wid = btn.closest('[data-wid]')?.dataset.wid || btn.parentElement?.dataset.wid;
              const shelf = (getWidgetShelf && getWidgetShelf()) || [];
              const idx = shelf.findIndex(x=>x.id===wid);
              if(idx>=0){ shelf.splice(idx,1); setWidgetShelf([...shelf]); renderSavedOutlines(); }
            });
          });
        }
      });
    });
  }

  /* ---------- create outline wiring ---------- */
  if(createBtn){
    createBtn.onclick = ()=>{
      createForm?.classList.toggle('hidden');
      if(createForm && !createForm.classList.contains('hidden')){ createTitle.value=''; createTitle.focus(); }
    };
  }
  if(createCancel){ createCancel.onclick = ()=> createForm?.classList.add('hidden'); }
  if(createOk){
    createOk.onclick = ()=>{
      const t = (createTitle?.value || '').trim() || 'New outline';
      const list = getSavedOutlines() || [];
      list.push({ id:'O'+Date.now().toString(36), title:t, sections:[] });
      setSavedOutlines(list); saveAll();
      createForm?.classList.add('hidden');
      // New outline stays collapsed by default
      renderSavedOutlines();
    };
  }

  // initial render
  renderSavedOutlines();

  return { renderSavedOutlines };
}
