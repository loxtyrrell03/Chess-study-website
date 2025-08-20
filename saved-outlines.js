// saved-outlines.js — Saved Outlines manager (with Folders + DnD)
// Exports: setupSavedOutlines({...})
//
// New in this version:
// • Folders: Create, rename, delete, and drag outlines into/out of folders.
// • Saved Outlines are the source of defaults. Home edits DO NOT push back.
// • If the edited outline is the active one, updates live-sync to Home.
//
// Structure in local storage / cloud:
// savedOutlines: Array of either
//   { id:'O...', title:'...', sections:[...] }                       // outline
//   { id:'F...', type:'folder', title:'...', children:[outline,...]} // folder
//
// NOTE: index.html flattens outlines (root + folders) when showing chips.

export function setupSavedOutlines({
  getSavedOutlines,
  setSavedOutlines,
  saveOutlinesLocal,
  getWidgetShelf,
  setWidgetShelf,
  applyOutline,
  touchCloud,
  renderHomeSavedBar,
  // Live two-way for Saved → Home only:
  getActiveOutlineId,
  syncCurrentFromSaved
}) {
  // ---------- DOM ----------
  const savedListEl   = document.getElementById('savedList');
  const createBtn     = document.getElementById('createOutlineBtn');
  const createForm    = document.getElementById('createOutlineForm');
  const createTitle   = document.getElementById('newOutlineTitle');
  const createOk      = document.getElementById('createOutlineConfirm');
  const createCancel  = document.getElementById('createOutlineCancel');

  const createFolderBtn = document.getElementById('createFolderBtn');

  const mergeBar      = document.getElementById('mergeBar');
  const mergeSrcName  = document.getElementById('mergeSourceName');
  const mergeTgtName  = document.getElementById('mergeTargetName');
  const mergeTitleInp = document.getElementById('mergeTitleInput');
  const mergeConfirm  = document.getElementById('mergeConfirmBtn');
  const mergeCancel   = document.getElementById('mergeCancelBtn');

  // ---------- UI state ----------
  const expandedOutlines = new Set(); // outline ids expanded
  const expandedFolders  = new Set(); // folder ids expanded
  const editingSections  = new Set(); // keys `${outlineId}|${sectionId}`
  let draggingOutlineId  = null;      // for outline merge or folder move
  let isMergeDrag        = false;

  // ---------- helpers ----------
  const escapeHtml = (s)=> (s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtMins = (n)=> String(Number(n || 0)).replace(/\.0+$/,'');
  const escSel = (s)=> (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');
  const debounce = (fn,ms=400)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms);} };

  const isFolder = (it)=> it && it.type === 'folder';
  const byIdDeep = (list, id)=>{
    for(let i=0;i<(list||[]).length;i++){
      const item = list[i];
      if(!item) continue;
      if(!isFolder(item) && item.id===id) return { type:'outline', parent:list, index:i, item };
      if(isFolder(item)){
        // a folder could also have same id, but we only search outlines here
        const children = item.children || [];
        for(let j=0;j<children.length;j++){
          if(children[j]?.id===id) return { type:'outline', parent:children, index:j, item:children[j], folder:item };
        }
      }
    }
    return null;
  };
  const getList = ()=> (getSavedOutlines && getSavedOutlines()) || [];

  const persist = (changedOutlineId)=>{
    if (typeof saveOutlinesLocal === 'function') saveOutlinesLocal();
    if (typeof renderHomeSavedBar === 'function') renderHomeSavedBar();
    if (typeof touchCloud === 'function') touchCloud();

    // Live sync Saved → Home if the active outline changed
    const activeId = (typeof getActiveOutlineId === 'function') ? getActiveOutlineId() : null;
    if (activeId && changedOutlineId && activeId === changedOutlineId && typeof syncCurrentFromSaved === 'function') {
      const list = getList();
      // locate outline (possibly in folder)
      const ref = byIdDeep(list, activeId);
      if (ref?.item) {
        syncCurrentFromSaved(structuredClone(ref.item));
      }
    }
  };

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
  function parsePayload(dt){
    let str=''; const types = dt?.types ? Array.from(dt.types) : [];
    if(types.includes('text/plain')) str = dt.getData('text/plain');
    if(!str && types.includes('text')) str = dt.getData('text');
    if(!str) str = dt.getData('application/json') || dt.getData('Text') || '';
    try{ return JSON.parse(str); }catch{ return null; }
  }

  // ---------- small modals ----------
  function openWidgetEditor(widget, onSave, onCancel){
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
            <input id="wUrl" class="input mt-1" value="${escapeHtml(widget.url || '')}" placeholder="https://… or aimchess.com"/>
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
    modal.addEventListener('click', (e)=>{ if(e.target.dataset.close==='1'){ onCancel && onCancel(); close(); } });
    const onEsc = (e)=>{ if(e.key==='Escape'){ onCancel && onCancel(); close(); document.removeEventListener('keydown', onEsc);} };
    document.addEventListener('keydown', onEsc);

    modal.querySelector('#wSave').onclick = ()=>{
      const label = modal.querySelector('#wLabel').value.trim() || 'Untitled';
      let url     = modal.querySelector('#wUrl').value.trim() || '';
      url = normalizeUrl(url);
      const icon  = iconSel.value==='img' ? 'img' : 'emoji';
      let emoji='', img='';
      if(icon==='img') img = modal.querySelector('#wImg').value.trim();
      else emoji = modal.querySelector('#wEmoji').value.trim() || '🔗';
      onSave({ label, url, icon, emoji, img });
      onCancel = null;
      close();
    };
  }

  function openSectionCreateModal(onCreate){
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-backdrop" data-close="1"></div>
      <div class="modal-panel max-w-[420px]">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-lg font-semibold">New section</h3>
          <button class="btn-xxs" data-close="1">✕</button>
        </div>
        <div class="grid gap-2">
          <label class="text-sm">Title
            <input id="secTitle" class="input mt-1" placeholder="Opening drills"/>
          </label>
          <label class="text-sm">Minutes
            <input id="secMins" class="input mt-1" type="number" min="0.25" step="0.25" value="5"/>
          </label>
        </div>
        <div class="mt-3 flex items-center justify-end gap-2">
          <button class="px-3 py-2 rounded-xl border border-[var(--border)]" data-close="1">Cancel</button>
          <button id="secCreate" class="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white">Add section</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const close = ()=>{ modal.classList.add('hidden'); setTimeout(()=>modal.remove(), 140); };
    modal.addEventListener('click', (e)=>{ if(e.target.dataset.close==='1') close(); });
    const onEsc = (e)=>{ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', onEsc);} };
    document.addEventListener('keydown', onEsc);

    const titleEl = modal.querySelector('#secTitle');
    const minsEl  = modal.querySelector('#secMins');
    titleEl?.focus();

    modal.querySelector('#secCreate').onclick = ()=>{
      const title = (titleEl?.value || '').trim() || 'New section';
      const minutes = Math.max(0.25, Number(minsEl?.value || 5));
      onCreate({ title, minutes });
      close();
    };
  }

  // ---------- HTML builders ----------
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

  function inlineShelfHtml(shelf){
    const add = `<button class="add-pill" data-act="add-shelf" title="Add widget"> Add</button>`;
    const items = (shelf||[]).map(w=>{
      const iconHtml = (w.icon==='img' && w.img)
        ? `<img src="${escapeHtml(w.img)}" alt="" class="rounded-[4px] object-cover" draggable="false" style="width:18px;height:18px;"/>`
        : `<span class="link-icon">${escapeHtml(w.emoji || '🔗')}</span>`;
      return `
        <div class="widget" data-wid="${escapeHtml(w.id)}">
          <div class="link-card draggable-shelf" draggable="true" data-wid="${escapeHtml(w.id)}" title="${escapeHtml(w.url || '')}" style="cursor:grab">
            ${iconHtml}
            <div class="min-w-0">
              <div class="truncate" style="font-size:.95rem">${escapeHtml(w.label || 'Untitled')}</div>
              <div class="text-xs muted truncate">${escapeHtml(w.url || '')}</div>
            </div>
          </div>
          <button class="bin" data-act="del-shelf" title="Delete from shelf">🗑️</button>
        </div>`;
    }).join('');
    return `
      <div data-role="inline-shelf">
        <div class="text-xs muted mb-1" style="font-weight:600">Widget shelf</div>
        <div class="editor-shelf" data-role="shelf-row">${add}${items || ''}</div>
        <div class="text-xs muted mt-1">Drag from shelf → drop into the “Links” bar below. Click any shelf item to edit.</div>
      </div>`;
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

        <div class="row">
          <label class="text-sm" style="font-weight:600">Description</label>
          <textarea class="input w-full" data-role="edit-desc">${desc}</textarea>
        </div>

        ${inlineShelfHtml((getWidgetShelf && getWidgetShelf()) || [])}

        <div class="row">
          <div class="text-sm font-bold">Links</div>
          <div class="section-links-bar" data-role="links-bar">${linksBarInnerHtml(s.links)}</div>
        </div>

        <div class="row" style="justify-content:end; display:flex;">
          <button class="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white" data-act="save-section">Save</button>
        </div>
      </div>`;
  }

  function outlineCardHtml(o, isExpanded){
    const chevron = isExpanded ? '▾' : '▸';
    return `
      <div class="card p-4" data-oid="${escapeHtml(o.id)}">
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
              const k = o.id + '|' + s.id;
              return editingSections.has(k)
                ? `<li class="outline-row editing" data-sid="${escapeHtml(s.id)}" data-view="edit">${sectionEditCardInnerHtml(s)}</li>`
                : sectionPreviewRowHtml(s);
            }).join('')}
          </ul>` : ''}
      </div>`;
  }

  function folderCardHtml(f, isExpanded){
    const chevron = isExpanded ? '▾' : '▸';
    return `
      <div class="card p-4 folder-card" data-fid="${escapeHtml(f.id)}">
        <div class="flex items-center gap-2" data-role="folder-head">
          <div class="flex-1 font-bold text-lg truncate" data-role="folder-title">${escapeHtml(f.title || 'New folder')}</div>
          <button class="btn-xs" data-act="add-outline">+ Outline</button>
          <button class="btn-xs" data-act="rename-folder">Rename</button>
          <button class="btn-xs" data-act="delete-folder">Delete</button>
          <button class="btn-xxs" data-act="toggle-folder" aria-expanded="${isExpanded ? 'true':'false'}" title="${isExpanded?'Collapse':'Expand'}">${chevron}</button>
        </div>
        <div class="text-xs muted mt-1">Drag outlines onto this card to move them into the folder.</div>
        ${isExpanded ? `
          <div class="mt-3" data-role="folder-body">
            ${(f.children||[]).map(child=> outlineCardHtml(child, expandedOutlines.has(child.id))).join('')}
          </div>` : ''}
      </div>`;
  }

  // ---------- renderer ----------
  function renderSavedOutlines(){
    if(!savedListEl) return;
    const outlinesOrFolders = getList();
    savedListEl.innerHTML = (outlinesOrFolders||[]).map(item=>{
      if(isFolder(item)){
        return folderCardHtml(item, expandedFolders.has(item.id));
      } else {
        return outlineCardHtml(item, expandedOutlines.has(item.id));
      }
    }).join('');

    // Wire folder cards
    (outlinesOrFolders||[]).forEach(item=>{
      if(!isFolder(item)) return;
      const card = savedListEl.querySelector(`[data-fid="${escSel(item.id)}"]`);
      if(!card) return;

      // Header actions
      card.querySelector('[data-act="toggle-folder"]')?.addEventListener('click', ()=>{
        if(expandedFolders.has(item.id)) expandedFolders.delete(item.id);
        else expandedFolders.add(item.id);
        renderSavedOutlines();
      });
      card.querySelector('[data-act="rename-folder"]')?.addEventListener('click', ()=>{
        const t = prompt('Folder name:', item.title||'New folder');
        if(t==null) return;
        item.title = t.trim() || 'Untitled folder';
        setSavedOutlines(outlinesOrFolders);
        saveOutlinesLocal?.(); renderHomeSavedBar?.(); touchCloud?.();
        renderSavedOutlines();
      });
      card.querySelector('[data-act="delete-folder"]')?.addEventListener('click', ()=>{
        if(!confirm('Delete this folder? (Outlines inside will move to root.)')) return;
        const idx = outlinesOrFolders.findIndex(x=>x?.id===item.id);
        if(idx>=0){
          // move children to root
          const children = (item.children||[]);
          outlinesOrFolders.splice(idx,1);
          children.forEach(c=> outlinesOrFolders.push(c));
          setSavedOutlines(outlinesOrFolders);
          saveOutlinesLocal?.(); renderHomeSavedBar?.(); touchCloud?.();
          renderSavedOutlines();
        }
      });
      card.querySelector('[data-act="add-outline"]')?.addEventListener('click', ()=>{
        const t = prompt('Outline title:', 'New outline');
        const child = { id:'O'+Date.now().toString(36), title:(t||'New outline'), sections:[] };
        item.children = item.children || [];
        item.children.push(child);
        setSavedOutlines(outlinesOrFolders);
        saveOutlinesLocal?.(); renderHomeSavedBar?.(); touchCloud?.();
        expandedFolders.add(item.id);
        renderSavedOutlines();
      });

      // Card is a drop target for moving outlines into folder
      const onOverCard = (e)=>{
        if(draggingOutlineId){ e.preventDefault(); card.style.outline='2px dashed var(--accent)'; card.style.outlineOffset='4px'; }
      };
      const onLeaveCard = ()=>{ card.style.outline=''; card.style.outlineOffset=''; };
      const onDropCard = (e)=>{
        card.style.outline=''; card.style.outlineOffset='';
        if(!draggingOutlineId) return;
        e.preventDefault();
        const list = getList();
        const ref = byIdDeep(list, draggingOutlineId);
        if(!ref?.item) return;
        // remove from old parent
        ref.parent.splice(ref.index,1);
        // add to folder
        item.children = item.children || [];
        item.children.push(ref.item);
        setSavedOutlines(list);
        saveOutlinesLocal?.(); renderHomeSavedBar?.(); touchCloud?.();
        expandedFolders.add(item.id);
        renderSavedOutlines();
      };
      card.addEventListener('dragover', onOverCard, true);
      card.addEventListener('dragleave', onLeaveCard, true);
      card.addEventListener('drop', onDropCard, true);

      // Wire nested outline cards inside folder (if expanded)
      if(!expandedFolders.has(item.id)) return;
      const body = card.querySelector('[data-role="folder-body"]');
      if(!body) return;
      (item.children||[]).forEach(child=>{
        wireOutlineCard(body, child, item);
      });
    });

    // Wire root-level outline cards
    (outlinesOrFolders||[]).forEach(item=>{
      if(isFolder(item)) return;
      wireOutlineCard(savedListEl, item, null);
    });
  }

  function wireOutlineCard(container, o, parentFolder){
    const card = container.querySelector(`[data-oid="${escSel(o.id)}"]`);
    if(!card) return;

    // Header actions
    card.querySelector('[data-act="load"]')?.addEventListener('click', ()=>{
      applyOutline && applyOutline(o);
      goHome();
    });
    card.querySelector('[data-act="duplicate"]')?.addEventListener('click', ()=>{
      const list = getList();
      const copy = structuredClone(o);
      copy.id = 'O'+Date.now().toString(36);
      copy.title = prompt('Duplicate title:', `Copy of ${o.title || 'Outline'}`)?.trim() || `Copy of ${o.title || 'Outline'}`;
      copy.sections = (copy.sections||[]).map((s, i)=> ({...s, id: 'S'+Date.now().toString(36)+i}));
      if(parentFolder){
        parentFolder.children = parentFolder.children || [];
        parentFolder.children.push(copy);
      }else{
        list.push(copy);
      }
      setSavedOutlines(list);
      saveOutlinesLocal?.(); renderHomeSavedBar?.(); touchCloud?.();
      renderSavedOutlines();
    });
    card.querySelector('[data-act="delete"]')?.addEventListener('click', ()=>{
      if(!confirm('Delete this outline?')) return;
      const list = getList();
      if(parentFolder){
        const idx = (parentFolder.children||[]).findIndex(x=>x.id===o.id);
        if(idx>=0) parentFolder.children.splice(idx,1);
      }else{
        const idx = list.findIndex(x=>x?.id===o.id);
        if(idx>=0) list.splice(idx,1);
      }
      setSavedOutlines(list);
      saveOutlinesLocal?.(); renderHomeSavedBar?.(); touchCloud?.();
      renderSavedOutlines();
    });
    card.querySelector('[data-act="toggle-expand"]')?.addEventListener('click', ()=>{
      if(expandedOutlines.has(o.id)) expandedOutlines.delete(o.id);
      else expandedOutlines.add(o.id);
      renderSavedOutlines();
    });
    card.querySelector('[data-act="add-section"]')?.addEventListener('click', ()=>{
      openSectionCreateModal(({title, minutes})=>{
        const list = getList();
        const ref = byIdDeep(list, o.id);
        if(!ref?.item) return;
        ref.item.sections = ref.item.sections || [];
        ref.item.sections.push({ id:'S'+Date.now().toString(36), name:title, minutes, desc:'', links:[] });
        setSavedOutlines(list);
        persist(o.id); // sync to Home if active
        expandedOutlines.add(o.id);
        renderSavedOutlines();
      });
    });

    // Drag-to-merge using outline title drag
    const titleEl = card.querySelector('[data-role="outline-title"]');
    if(titleEl){
      titleEl.setAttribute('draggable','true');
      titleEl.addEventListener('dragstart', (e)=>{
        draggingOutlineId = o.id;
        isMergeDrag = true;
        document.body.classList.add('is-merge-drag');
        try{ e.dataTransfer.setData('text/plain', JSON.stringify({type:'merge', id:o.id})); }catch{}
        e.dataTransfer.effectAllowed='move';
        card.classList.add('drag-ghost');
      });
      titleEl.addEventListener('dragend', ()=>{
        draggingOutlineId = null;
        isMergeDrag = false;
        document.body.classList.remove('is-merge-drag');
        card.classList.remove('drag-ghost');
        document.querySelectorAll('[data-oid]').forEach(el=>{ el.style.outline=''; el.style.outlineOffset=''; });
      });

      const onDragOverCard = (e)=>{
        const incoming = draggingOutlineId;
        if(incoming && incoming !== o.id){
          e.preventDefault(); // allow drop for merge
          card.style.outline='2px dashed var(--accent)'; card.style.outlineOffset='4px';
        }
      };
      const onDragLeaveCard = ()=>{
        card.style.outline=''; card.style.outlineOffset='';
      };
      const onDropCard = (e)=>{
        card.style.outline=''; card.style.outlineOffset='';
        if(!draggingOutlineId || draggingOutlineId===o.id) return;
        e.preventDefault();

        const list = getList();
        const srcRef = byIdDeep(list, draggingOutlineId);
        const tgtRef = byIdDeep(list, o.id);
        const src = srcRef?.item, tgt = tgtRef?.item;
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
            if(tgtRef.folder){
              tgtRef.folder.children = tgtRef.folder.children || [];
              tgtRef.folder.children.push(merged);
            }else{
              list.push(merged);
            }
            setSavedOutlines(list);
            saveOutlinesLocal?.(); renderHomeSavedBar?.(); touchCloud?.();
            mergeBar.style.display='none';
            renderSavedOutlines();
          };
          mergeCancel.onclick = ()=>{ mergeBar.style.display='none'; };
        }
      };

      // Use capture = true so children (buttons) can’t swallow the events
      card.addEventListener('dragover', onDragOverCard, true);
      card.addEventListener('dragleave', onDragLeaveCard, true);
      card.addEventListener('drop', onDropCard, true);
    }

    // Sections wiring (only if expanded)
    if(!expandedOutlines.has(o.id)) return;
    const sectionsList = card.querySelector('[data-role="sections"]');
    if(!sectionsList) return;

    // --- Subsection reorder (Home-like) ---
    let dragging = null; // { from, el, placeholder }
    const makePh = (h, titleText)=>{ 
      const ph = document.createElement('li'); 
      ph.className='outline-row drop-placeholder'; 
      ph.style.setProperty('--ph', `${Math.max(36,h)}px`); 
      ph.innerHTML = `<div class="text-xs muted px-2 truncate">${escapeHtml(titleText||'')}</div>`; 
      return ph; 
    };

    // Per-row wiring
    sectionsList.querySelectorAll('li.section-row[data-sid]').forEach((li, idx)=>{
      // Select row → open inline editor (ignore bin)
      li.addEventListener('click', (e)=>{
        if(e.target.closest('[data-act="del-sec"], .link-card, .bin, input, textarea, select, button')) return;
        editingSections.add(o.id + '|' + li.dataset.sid);
        renderSavedOutlines();
      });

      // Delete
      li.querySelector('[data-act="del-sec"]')?.addEventListener('click', (e)=>{
        e.stopPropagation();
        const list = getList();
        const ref  = byIdDeep(list, o.id); if(!ref?.item) return;
        const sidx = ref.item.sections.findIndex(se => se.id === li.dataset.sid);
        if(sidx>=0 && confirm('Delete this section?')){
          ref.item.sections.splice(sidx,1);
          setSavedOutlines(list);
          persist(o.id); // sync to Home if active
          renderSavedOutlines();
        }
      });

      // DnD: drag the row
      li.addEventListener('dragstart', (e)=>{
        if(li.classList.contains('editing')){ e.preventDefault(); return; }
        const titleText = (li.querySelector('.title')?.textContent || '').trim();
        dragging = { from: idx, el: li, placeholder: makePh(li.offsetHeight, titleText) };
        li.classList.add('dragging');
        li.after(dragging.placeholder);
        try{ e.dataTransfer.setData('text/plain', JSON.stringify({type:'sec-move', from: idx, oid:o.id})); }catch{}
        e.dataTransfer.effectAllowed='move';
      });
      li.addEventListener('dragend', ()=>{
        li.classList.remove('dragging');
        dragging?.placeholder?.remove();
        dragging = null;
      });

      // Reposition placeholder when hovering other rows
      const over = (e)=>{
        if(!dragging) return;
        e.preventDefault();
        const r = li.getBoundingClientRect();
        const before = e.clientY < (r.top + r.height/2);
        const ph = dragging.placeholder;
        if(!ph) return;
        if(before){
          if(li.previousSibling !== ph) li.parentElement.insertBefore(ph, li);
        }else{
          if(li.nextSibling !== ph) li.after(ph);
        }
      };
      li.addEventListener('dragover', over);
      li.addEventListener('dragenter', over);
    });

    // Container allows dropping anywhere (including end)
    sectionsList.addEventListener('dragover', (e)=>{
      if(!dragging) return;
      e.preventDefault();
      if(!sectionsList.contains(dragging.placeholder)) sectionsList.appendChild(dragging.placeholder);
    });

    sectionsList.addEventListener('drop', (e)=>{
      if(!dragging) return;
      e.preventDefault();
      const from = dragging.from;

      const rows = Array.from(sectionsList.querySelectorAll('li.outline-row'));
      const phIndex = rows.indexOf(dragging.placeholder);
      const to = phIndex < 0 ? rows.length-1 : phIndex;

      const finalTo = (to > from) ? to - 1 : to;

      if(from !== finalTo && from >= 0 && finalTo >= 0){
        const list = getList();
        const ref  = byIdDeep(list, o.id); if(!ref?.item) return;

        const [moved] = ref.item.sections.splice(from,1);
        ref.item.sections.splice(finalTo,0,moved);

        setSavedOutlines(list);
        persist(o.id); // sync to Home if active
      }

      dragging?.placeholder?.remove();
      dragging = null;
      renderSavedOutlines();
    });

    // ---- Wire edit cards inside <li class="outline-row editing"> ----
    (o.sections || []).forEach(sec=>{
      const secKey = o.id + '|' + sec.id;
      if(!editingSections.has(secKey)) return;
      const li = sectionsList.querySelector(`li.editing[data-sid="${escSel(sec.id)}"]`);
      if(!li) return;

      const secEl = li.querySelector('.section-edit');
      const linksBar = secEl?.querySelector('[data-role="links-bar"]');
      if (linksBar) linksBar.innerHTML = linksBarInnerHtml(sec.links || []);

      // Save button (title, minutes, desc)
      secEl?.querySelector('[data-act="save-section"]')?.addEventListener('click', (ev)=>{
        ev.stopPropagation();
        const list = getList();
        const ref  = byIdDeep(list, o.id); if(!ref?.item) return;
        const s    = ref.item.sections?.find(x=>x.id===sec.id); if(!s) return;
        const titleEl = secEl.querySelector('[data-role="edit-title"]');
        const descEl  = secEl.querySelector('[data-role="edit-desc"]');
        const minsEl  = secEl.querySelector('[data-role="edit-mins"]');
        s.name    = titleEl ? (titleEl.value || 'Untitled section') : s.name;
        s.desc    = descEl ? descEl.value : s.desc;
        s.minutes = minsEl ? Math.max(0.25, Number(minsEl.value || 0)) : s.minutes;
        setSavedOutlines(list);
        persist(o.id); // SYNC if active
        editingSections.delete(secKey);
        renderSavedOutlines();
      });

      // Debounced description autosave (live sync while editing) + auto-grow
      const descEl = secEl?.querySelector('[data-role="edit-desc"]');
      const autoGrow = (ta)=>{
        if(!ta) return;
        ta.style.height='auto';
        ta.style.height=Math.min(240, ta.scrollHeight) + 'px';
      };
      if (descEl) {
        autoGrow(descEl);
        const autoSaveDesc = debounce(()=>{
          const list = getList();
          const ref  = byIdDeep(list, o.id); if(!ref?.item) return;
          const s    = ref.item.sections?.find(x=>x.id===sec.id); if(!s) return;
          s.desc = descEl.value;
          setSavedOutlines(list);
          persist(o.id); // SYNC if active
        }, 400);
        descEl.addEventListener('input', ()=>{ autoGrow(descEl); autoSaveDesc(); });
      }

      // Links bar DnD (copy from shelf + reorder)
      if(linksBar){
        let over=0;
        linksBar.addEventListener('dragenter', ()=>{ over++; linksBar.classList.add('drag-over-outline'); });
        linksBar.addEventListener('dragleave', ()=>{ over=Math.max(0,over-1); if(!over) linksBar.classList.remove('drag-over-outline'); });
        linksBar.addEventListener('dragover', (e)=>{ e.preventDefault(); e.dataTransfer.dropEffect='copy'; });
        linksBar.addEventListener('drop', (e)=>{
          e.preventDefault(); over=0; linksBar.classList.remove('drag-over-outline');
          const payload = parsePayload(e.dataTransfer);
          const list = getList();
          const ref  = byIdDeep(list, o.id); if(!ref?.item) return;
          const s    = ref.item.sections?.find(x=>x.id===sec.id); if(!s) return;
          s.links = s.links || [];
          if(payload?.type==='shelf'){
            const shelf = (getWidgetShelf && getWidgetShelf()) || [];
            const w = shelf.find(x=>x.id===payload.id);
            if(!w) return;
            s.links.push({ id:'l'+Date.now().toString(36), label:w.label, url:w.url, icon:w.icon, emoji:w.emoji||'', img:w.img||'' });
            setSavedOutlines(list);
            persist(o.id); // SYNC if active
            renderSavedOutlines();
          }else if(payload?.type==='reorder'){
            const from = payload.index;
            const cards = [...linksBar.querySelectorAll('.section-link')];
            let to = cards.length;
            for(let i=0;i<cards.length;i++){
              const r = cards[i].getBoundingClientRect();
              if(e.clientY < r.top + r.height/2){ to=i; break; }
            }
            if(from==null || to==null || from===to) return;
            const [moved] = s.links.splice(from,1);
            s.links.splice(to,0,moved);
            setSavedOutlines(list);
            persist(o.id); // SYNC if active
            renderSavedOutlines();
          }
        });

        // link pill: reorder + edit + delete
        linksBar.querySelectorAll('.section-link').forEach(pill=>{
          pill.addEventListener('dragstart', (e)=>{
            const index = Number(pill.dataset.idx);
            try{ e.dataTransfer.setData('text/plain', JSON.stringify({type:'reorder', index})); }catch{}
            e.dataTransfer.effectAllowed='move';
            pill.classList.add('drag-ghost');
          });
          pill.addEventListener('dragend', ()=> pill.classList.remove('drag-ghost'));
          pill.addEventListener('click', (e)=>{
            e.stopPropagation();
            const list = getList();
            const ref  = byIdDeep(list, o.id); if(!ref?.item) return;
            const s    = ref.item.sections?.find(x=>x.id===sec.id); if(!s) return;
            const i    = Number(pill.dataset.idx);
            const w    = s.links?.[i]; if(!w) return;
            openWidgetEditor(w, (upd)=>{ 
              upd.url = normalizeUrl(upd.url);
              Object.assign(w, upd); 
              setSavedOutlines(list);
              persist(o.id); // SYNC if active
              renderSavedOutlines(); 
            });
          });
        });
        linksBar.querySelectorAll('[data-act="del-link"]').forEach(bin=>{
          bin.addEventListener('click', (e)=>{
            e.stopPropagation();
            const list = getList();
            const ref  = byIdDeep(list, o.id); if(!ref?.item) return;
            const s    = ref.item.sections?.find(x=>x.id===sec.id); if(!s) return;
            const pill = bin.closest('.widget')?.querySelector('.section-link');
            const i    = Number(pill?.dataset.idx ?? -1);
            if(i>=0){ s.links.splice(i,1); setSavedOutlines(list); persist(o.id); renderSavedOutlines(); }
          });
        });
      }

      // Inline shelf actions (drag & edit & delete + ADD)
      const shelfWrap = secEl?.querySelector('[data-role="inline-shelf"]');
      if(shelfWrap){
        shelfWrap.querySelector('[data-act="add-shelf"]')?.addEventListener('click', ()=>{
          if(!setWidgetShelf) return alert('setWidgetShelf not wired in index.html');
          const shelf = (getWidgetShelf && getWidgetShelf()) || [];
          const wid = 'W'+Date.now().toString(36);
          const placeholder = { id: wid, label:'', url:'', icon:'emoji', emoji:'🔗', img:'' };
          setWidgetShelf([...shelf, placeholder]);
          const onCancel = ()=>{
            const s2 = (getWidgetShelf && getWidgetShelf()) || [];
            const i  = s2.findIndex(x=>x.id===wid);
            if(i>=0){ s2.splice(i,1); setWidgetShelf([...s2]); }
            renderSavedOutlines();
          };
          openWidgetEditor(placeholder, (upd)=>{
            const s2 = (getWidgetShelf && getWidgetShelf()) || [];
            const it = s2.find(x=>x.id===wid);
            if(it){
              upd.url = normalizeUrl(upd.url);
              Object.assign(it, upd);
              setWidgetShelf([...s2]);
            }
            renderSavedOutlines();
          }, onCancel);
        });

        // draggable shelf cards
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
            openWidgetEditor(w, (upd)=>{
              upd.url = normalizeUrl(upd.url);
              Object.assign(w, upd); 
              setWidgetShelf([...shelf]); 
              renderSavedOutlines(); 
            });
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
  }

  function goHome(){
    const tabBtn = document.querySelector('.tab-link[data-tab="homeTab"]');
    if (tabBtn && typeof tabBtn.click === 'function') { tabBtn.click(); return; }
    const cand = ['[data-tab="home"]','[data-route="home"]','[data-nav="home"]','a[href="#home"]','#navHome','#homeTab','#tab-home'];
    for(const sel of cand){
      const el = document.querySelector(sel);
      if(el && typeof el.click==='function'){ el.click(); return; }
    }
    const home = document.getElementById('homeTab');
    if (home) {
      document.getElementById('savedTab')?.classList.add('hidden');
      document.getElementById('helpTab')?.classList.add('hidden');
      home.classList.remove('hidden');
      home.scrollIntoView({ behavior:'smooth', block:'start' });
      return;
    }
    if(location.hash !== '#home') location.hash = '#home';
  }

  // ---------- create outline wiring ----------
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
      const list = getList();
      list.push({ id:'O'+Date.now().toString(36), title:t, sections:[] });
      setSavedOutlines(list);
      saveOutlinesLocal?.(); renderHomeSavedBar?.(); touchCloud?.();
      createForm?.classList.add('hidden');
      renderSavedOutlines();
    };
  }

  // ---------- create folder wiring ----------
  if(createFolderBtn){
    createFolderBtn.onclick = ()=>{
      const name = prompt('Folder name:', 'New folder') || 'New folder';
      const list = getList();
      list.push({ id:'F'+Date.now().toString(36), type:'folder', title:name.trim()||'New folder', children:[] });
      setSavedOutlines(list);
      saveOutlinesLocal?.(); renderHomeSavedBar?.(); touchCloud?.();
      renderSavedOutlines();
    };
  }

  // initial render
  renderSavedOutlines();

  return { renderSavedOutlines };
}
