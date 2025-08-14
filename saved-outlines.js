// saved-outlines.js — inline section shelf + reliable merge drag/drop
//
// Exports: setupSavedOutlines({ getSavedOutlines, setSavedOutlines, saveOutlinesLocal,
//                              getWidgetShelf, setWidgetShelf, applyOutline,
//                              touchCloud, renderHomeSavedBar })
//
// Behavior (Saved tab):
// • Each section always shows its links as compact, indented pills (no navigation).
// • Click a section’s “Edit” to reveal an INLINE widget shelf inside that section.
// • Drag from the inline shelf → drop into that section’s links bar; drag pills to reorder.
// • Single-click any shelf widget OR link pill to edit (title/url/icon). Never navigates.
// • Bin buttons delete shelf widgets or section links.
// • Drag an outline title onto another outline card to MERGE (reliable in all browsers).

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
  const savedListEl   = document.querySelector('#savedList');
  const mergeBar      = document.querySelector('#mergeBar');
  const mergeSrcName  = document.querySelector('#mergeSourceName');
  const mergeTgtName  = document.querySelector('#mergeTargetName');
  const mergeTitleInp = document.querySelector('#mergeTitleInput');
  const mergeConfirm  = document.querySelector('#mergeConfirmBtn');
  const mergeCancel   = document.querySelector('#mergeCancelBtn');

  const createBtn     = document.querySelector('#createOutlineBtn');
  const createForm    = document.querySelector('#createOutlineForm');
  const createTitle   = document.querySelector('#newOutlineTitle');
  const createOk      = document.querySelector('#createOutlineConfirm');
  const createCancel  = document.querySelector('#createOutlineCancel');

  // Which sections are currently in "edit" (show inline shelf)
  // key format: `${outlineId}|${sectionId}`
  const editingSections = new Set();

  // Track outline being dragged for merge (robust cross-browser)
  let draggingOutlineId = null;

  /* ---------------- helpers ---------------- */
  const escapeHtml = (s)=> (s??'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const byId = (arr, id)=> arr.find(x=>x.id===id);
  const keyOf = (oId, sId)=> `${oId}|${sId}`;
  const fmtMins = (n)=> String(Number(n||0)).replace(/\.0+$/,'');
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

  /* ---------------- editors ---------------- */
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
          <label class="text-sm">Title<input id="wLabel" class="input mt-1" value="${escapeHtml(widget.label||'')}" /></label>
          <label class="text-sm">URL<input id="wUrl" class="input mt-1" value="${escapeHtml(widget.url||'')}" placeholder="https://…"/></label>
          <label class="text-sm">Icon type
            <select id="wIcon" class="input mt-1">
              <option value="emoji" ${widget.icon!=='img'?'selected':''}>Emoji/Text</option>
              <option value="img"   ${widget.icon==='img'?'selected':''}>Image URL</option>
            </select>
          </label>
          <label class="text-sm" id="emojiRow">Emoji/Text<input id="wEmoji" class="input mt-1" value="${escapeHtml(widget.emoji||'')}" placeholder="♟️"/></label>
          <label class="text-sm hidden" id="imgRow">Image URL<input id="wImg" class="input mt-1" value="${escapeHtml(widget.img||'')}" placeholder="https://…/icon.png"/></label>
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
    const syncRows = ()=>{ const useImg = iconSel.value==='img'; emojiRow.classList.toggle('hidden', useImg); imgRow.classList.toggle('hidden', !useImg); };
    syncRows(); iconSel.addEventListener('change', syncRows);

    const close = ()=>{ modal.classList.add('hidden'); setTimeout(()=>modal.remove(), 150); };
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

  /* ---------------- rendering ---------------- */
  function subLinksHTML(links){
    // compact, indented pills; no anchors (no navigation in Saved)
    return (links||[]).map((w,i)=> `
      <div class="relative" data-idx="${i}" style="position:relative;">
        <div class="link-card section-link" draggable="true" data-idx="${i}" style="padding:.4rem .55rem; font-size:.9rem;">
          ${w.icon==='img' && w.img
            ? `<img src="${escapeHtml(w.img)}" alt="" class="link-icon rounded-[4px] object-cover" draggable="false"/>`
            : `<span class="link-icon">${escapeHtml(w.emoji||'🔗')}</span>`}
          <span class="truncate max-w-[12rem]">${escapeHtml(w.label||'Untitled')}</span>
        </div>
        <button class="btn-xxs" title="Delete" data-act="del-link"
          style="position:absolute;top:-8px;right:-8px;border-radius:9999px;border:var(--borderW) solid var(--border);background:#fff;">🗑️</button>
      </div>`).join('');
  }

  function inlineShelfHTML(shelf){
    // shown inside a section only when that section is editing
    return `
      <div class="mt-2 p-2 rounded-xl border border-[var(--border)] bg-white" data-role="inline-shelf">
        <div class="editor-shelf" data-role="shelf-row">
          ${shelf && shelf.length ? shelf.map(w=>`
            <div class="relative" data-wid="${w.id}" style="position:relative;">
              <div class="link-card draggable-shelf" draggable="true" data-wid="${w.id}" title="${escapeHtml(w.url||'')}" style="cursor:grab">
                ${w.icon==='img' && w.img
                  ? `<img src="${escapeHtml(w.img)}" alt="" class="link-icon rounded-[4px] object-cover" draggable="false"/>`
                  : `<span class="link-icon">${escapeHtml(w.emoji||'🔗')}</span>`}
                <div class="min-w-0">
                  <div class="truncate">${escapeHtml(w.label||'Untitled')}</div>
                  <div class="text-xs muted truncate">${escapeHtml(w.url||'')}</div>
                </div>
              </div>
              <button class="btn-xxs" title="Delete from shelf" data-act="del-shelf"
                style="position:absolute;top:-8px;right:-8px;border-radius:9999px;border:var(--borderW) solid var(--border);background:#fff;">🗑️</button>
            </div>
          `).join('') : `<div class="text-xs muted">No shelf widgets yet.</div>`}
        </div>
        <div class="text-xs muted mt-1">Tip: drag a widget into this section’s links. Click any widget to edit.</div>
      </div>`;
  }

  function sectionCardHTML(oId, s){
    const inEdit = editingSections.has(keyOf(oId, s.id));
    const links = s.links || [];
    return `
      <div class="p-3 rounded-xl border border-[var(--border)] bg-[var(--panel)]" data-sid="${s.id}">
        <div class="flex items-center gap-2">
          <div class="font-semibold truncate flex-1">${escapeHtml(s.name||'Untitled section')}</div>
          <span class="text-xs muted w-14 text-right">${fmtMins(s.minutes)}m</span>
          <button class="btn-xxs" data-act="${inEdit?'done-sec':'edit-sec'}">${inEdit?'Done':'Edit'}</button>
        </div>

        <!-- compact, indented sub-links (always visible) -->
        <div class="mt-2" data-role="links-bar"
             style="margin-left:16px; background:var(--panel-muted); border:var(--borderW) solid var(--border); border-radius:10px; padding:.45rem .5rem; display:flex; flex-wrap:wrap; gap:.45rem; min-height:40px;">
          ${subLinksHTML(links)}
        </div>

        ${inEdit ? inlineShelfHTML((getWidgetShelf&&getWidgetShelf())||[]) : ''}
      </div>`;
  }

  function outlineCardHTML(o){
    return `
      <div class="card p-4" data-oid="${o.id}">
        <div class="flex items-center gap-2">
          <h4 class="font-bold text-lg truncate flex-1" draggable="true">${escapeHtml(o.title||'Untitled outline')}</h4>
          <button class="btn-xs" data-act="load">Load</button>
          <button class="btn-xs" data-act="delete">Delete</button>
        </div>
        <div class="mt-3 space-y-3">
          ${(o.sections||[]).map(s=> sectionCardHTML(o.id, s)).join('')}
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <input class="input flex-1 text-sm" placeholder="Section title" data-role="new-title"/>
          <input class="input w-28 text-sm" placeholder="Minutes" type="number" min="0.25" step="0.25" data-role="new-mins"/>
          <button class="btn-xs" data-act="add-section">+ Add Section</button>
        </div>
      </div>`;
  }

  function renderSavedOutlines(){
    if(!savedListEl) return;
    const outlines = getSavedOutlines() || [];
    savedListEl.innerHTML = outlines.length
      ? outlines.map(outlineCardHTML).join('')
      : `<div class="card p-4">No saved outlines yet.</div>`;

    // Wire each outline card
    outlines.forEach(o=>{
      const card = savedListEl.querySelector(`[data-oid="${o.id}"]`);
      if(!card) return;

      // ===== Merge via drag title onto another card =====
      const titleEl = card.querySelector('h4');
      if (titleEl) {
        titleEl.setAttribute('draggable', 'true');

        titleEl.addEventListener('dragstart', (e)=>{
          draggingOutlineId = o.id;
          try {
            e.dataTransfer.setData('text/plain', JSON.stringify({ type:'merge', id:o.id }));
          } catch {}
          e.dataTransfer.effectAllowed = 'move';
          card.classList.add('drag-ghost');
        });

        titleEl.addEventListener('dragend', ()=>{
          draggingOutlineId = null;
          card.classList.remove('drag-ghost');
          document.querySelectorAll('[data-oid]').forEach(el=>{
            el.style.outline = ''; el.style.outlineOffset = '';
          });
        });
      }

      // Allow drop anywhere on the card (except itself)
      card.addEventListener('dragover', (e)=>{
        if (draggingOutlineId && draggingOutlineId !== o.id) {
          e.preventDefault();
          card.style.outline = '2px dashed var(--accent)';
          card.style.outlineOffset = '4px';
        }
      });

      card.addEventListener('dragleave', ()=>{
        card.style.outline = ''; card.style.outlineOffset = '';
      });

      card.addEventListener('drop', (e)=>{
        card.style.outline = ''; card.style.outlineOffset = '';
        if (!draggingOutlineId || draggingOutlineId === o.id) return;
        e.preventDefault();

        const srcId = draggingOutlineId;
        const list = getSavedOutlines() || [];
        const src = byId(list, srcId);
        const tgt = o;
        if (!src || !tgt) return;

        if (mergeBar) {
          mergeBar.style.display = 'block';
          if (mergeSrcName)  mergeSrcName.textContent  = src.title || 'Untitled';
          if (mergeTgtName)  mergeTgtName.textContent  = tgt.title || 'Untitled';
          if (mergeTitleInp) mergeTitleInp.value = `${tgt.title||'Untitled'} + ${src.title||'Untitled'}`;

          mergeConfirm.onclick = ()=>{
            const merged = {
              id: 'O'+Date.now().toString(36),
              title: (mergeTitleInp?.value || '').trim() || `${tgt.title||''} + ${src.title||''}`,
              sections: [
                ...(tgt.sections||[]).map(s=>structuredClone(s)),
                ...(src.sections||[]).map(s=>structuredClone(s))
              ]
            };
            list.push(merged);
            setSavedOutlines(list);
            saveAll();
            mergeBar.style.display = 'none';
            renderSavedOutlines();
          };
          mergeCancel.onclick = ()=>{ mergeBar.style.display = 'none'; };
        }
      });

      // ===== Outline header buttons =====
      card.querySelector('[data-act="load"]')?.addEventListener('click', ()=> applyOutline && applyOutline(o));
      card.querySelector('[data-act="delete"]')?.addEventListener('click', ()=>{
        if(!confirm('Delete this outline?')) return;
        const list = getSavedOutlines(); const idx = list.findIndex(x=>x.id===o.id);
        if(idx>=0){ list.splice(idx,1); setSavedOutlines(list); saveAll(); renderSavedOutlines(); }
      });

      // ===== Add section =====
      const addBtn = card.querySelector('[data-act="add-section"]');
      addBtn?.addEventListener('click', ()=>{
        const tInp = card.querySelector('[data-role="new-title"]');
        const mInp = card.querySelector('[data-role="new-mins"]');
        const title = (tInp?.value||'').trim() || 'New section';
        const mins  = Math.max(0.25, Number(mInp?.value || 5));
        const list = getSavedOutlines(); const me = byId(list, o.id); if(!me) return;
        me.sections = me.sections || [];
        me.sections.push({ id:'S'+Date.now().toString(36), name:title, minutes:mins, links:[] });
        setSavedOutlines(list); saveAll(); renderSavedOutlines();
      });

      // ===== Per-section behaviors =====
      card.querySelectorAll('[data-sid]').forEach(secEl=>{
        const sid  = secEl.getAttribute('data-sid');
        const k    = keyOf(o.id, sid);
        const list = getSavedOutlines();
        const me   = byId(list, o.id);
        const sec  = me?.sections?.find(x=>x.id===sid);
        if(!sec) return;

        // Toggle inline shelf
        secEl.querySelector('[data-act="edit-sec"]')?.addEventListener('click', ()=>{
          editingSections.add(k); renderSavedOutlines();
        });
        secEl.querySelector('[data-act="done-sec"]')?.addEventListener('click', ()=>{
          editingSections.delete(k); renderSavedOutlines();
        });

        // Links bar (always visible)
        const bar = secEl.querySelector('[data-role="links-bar"]');
        // Drag visuals + accept drops
        let overCount=0;
        bar.addEventListener('dragenter', ()=>{ overCount++; bar.classList.add('drag-over-outline'); });
        bar.addEventListener('dragleave', ()=>{ overCount=Math.max(0,overCount-1); if(overCount===0) bar.classList.remove('drag-over-outline'); });
        bar.addEventListener('dragover', (e)=>{ e.preventDefault(); e.dataTransfer.dropEffect='copy'; });
        bar.addEventListener('drop', (e)=>{
          e.preventDefault(); overCount=0; bar.classList.remove('drag-over-outline');
          const payload = parsePayload(e.dataTransfer);
          const list2 = getSavedOutlines();
          const me2 = byId(list2, o.id); const sec2 = me2?.sections?.find(x=>x.id===sid);
          if(!sec2) return;
          sec2.links = sec2.links || [];

          if(payload?.type==='shelf'){
            const shelf = (getWidgetShelf && getWidgetShelf()) || [];
            const w = shelf.find(x=>x.id===payload.id); if(!w) return;
            sec2.links.push({ id:'l_'+Date.now().toString(36), label:w.label, url:w.url, icon:w.icon, emoji:w.emoji||'', img:w.img||'' });
            setSavedOutlines(list2); saveAll(); renderSavedOutlines();
          }else if(payload?.type==='reorder'){
            const from = payload.index;
            const cards = [...bar.querySelectorAll('.section-link')];
            let to = cards.length;
            for(let i=0;i<cards.length;i++){
              const r=cards[i].getBoundingClientRect();
              if(e.clientY < r.top + r.height/2){ to=i; break; }
            }
            if(from==null || to==null || from===to) return;
            const [moved] = sec2.links.splice(from,1);
            sec2.links.splice(to,0,moved);
            setSavedOutlines(list2); saveAll(); renderSavedOutlines();
          }
        });

        // Link pill interactions (edit/delete/reorder) — never navigate
        bar.querySelectorAll('.section-link').forEach(pill=>{
          pill.addEventListener('dragstart', (e)=>{
            const index = Number(pill.dataset.idx);
            try{ e.dataTransfer.setData('text/plain', JSON.stringify({type:'reorder', index})); }catch{}
            e.dataTransfer.effectAllowed='move';
            pill.classList.add('drag-ghost');
          });
          pill.addEventListener('dragend', ()=> pill.classList.remove('drag-ghost'));
          pill.addEventListener('click', ()=>{
            const list2 = getSavedOutlines(); const me2 = byId(list2, o.id); const sec2 = me2?.sections?.find(x=>x.id===sid);
            const i = Number(pill.dataset.idx); const w = sec2?.links?.[i]; if(!w) return;
            openWidgetEditor(w, (upd)=>{ Object.assign(w, upd); setSavedOutlines(list2); saveAll(); renderSavedOutlines(); });
          });
        });
        bar.querySelectorAll('[data-act="del-link"]').forEach(bin=>{
          bin.addEventListener('click', (ev)=>{
            ev.stopPropagation();
            const list2 = getSavedOutlines(); const me2 = byId(list2, o.id); const sec2 = me2?.sections?.find(x=>x.id===sid);
            const pill = bin.parentElement?.querySelector('.section-link'); const i = Number(pill?.dataset.idx ?? -1);
            if(i>=0){ sec2.links.splice(i,1); setSavedOutlines(list2); saveAll(); renderSavedOutlines(); }
          });
        });

        // Inline shelf (when editing this section)
        const shelfWrap = secEl.querySelector('[data-role="inline-shelf"]');
        if(shelfWrap){
          // draggable shelf cards
          shelfWrap.querySelectorAll('.draggable-shelf').forEach(card=>{
            card.addEventListener('dragstart', (e)=>{
              const id=card.dataset.wid;
              try{ e.dataTransfer.setData('text/plain', JSON.stringify({type:'shelf', id})); }catch{}
              e.dataTransfer.effectAllowed='copy';
              card.classList.add('drag-ghost');
            });
            card.addEventListener('dragend', ()=> card.classList.remove('drag-ghost'));
            // single-click edits shelf item (not the section link)
            card.addEventListener('click', ()=>{
              if(!setWidgetShelf) return alert('setWidgetShelf not wired in index.html');
              const shelf = (getWidgetShelf&&getWidgetShelf())||[];
              const w = shelf.find(x=>x.id===card.dataset.wid); if(!w) return;
              openWidgetEditor(w, (upd)=>{ Object.assign(w, upd); setWidgetShelf([...shelf]); renderSavedOutlines(); });
            });
          });
          // delete shelf item
          shelfWrap.querySelectorAll('[data-act="del-shelf"]').forEach(btn=>{
            btn.addEventListener('click', (e)=>{
              e.stopPropagation();
              if(!setWidgetShelf) return alert('setWidgetShelf not wired in index.html');
              const wid = btn.closest('[data-wid]')?.dataset.wid;
              const shelf = (getWidgetShelf&&getWidgetShelf())||[];
              const idx = shelf.findIndex(x=>x.id===wid);
              if(idx>=0){ shelf.splice(idx,1); setWidgetShelf([...shelf]); renderSavedOutlines(); }
            });
          });
        }
      });
    });
  }

  /* ---------------- create outline wiring ---------------- */
  createBtn && (createBtn.onclick = ()=>{
    createForm?.classList.toggle('hidden');
    if(createForm && !createForm.classList.contains('hidden')){ createTitle.value=''; createTitle.focus(); }
  });
  createCancel && (createCancel.onclick = ()=> createForm?.classList.add('hidden'));
  createOk && (createOk.onclick = ()=>{
    const t = (createTitle?.value||'').trim() || 'New outline';
    const list = getSavedOutlines() || [];
    list.push({ id:'O'+Date.now().toString(36), title:t, sections:[] });
    setSavedOutlines(list); saveAll(); createForm?.classList.add('hidden'); renderSavedOutlines();
  });

  // Initial draw
  renderSavedOutlines();

  return { renderSavedOutlines };
}
