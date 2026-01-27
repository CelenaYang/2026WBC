// 圖片編排工具 main.js
(function(){
  const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTHz9Co4woY4xFfOQakyHVTBdVPzPpFEN4AotZPIc2fQP4Koli5Ru8Uk06qxSbi6P292c8phIFyptVe/pub?output=csv';  
  const FLAG_BASE = 'https://raw.githubusercontent.com/CelenaYang/2026WBC/main/teamPIC/';
  const CANVAS_W = 1200, CANVAS_H = 490;

  const baseImage = document.getElementById('base-image');
  const chooseBaseBtn = document.getElementById('choose-base');
  const baseFile = document.getElementById('base-file');
  const cardsRoot = document.getElementById('cards');
  const placedLayer = document.getElementById('placed-layer');
  const canvasEl = document.getElementById('canvas');
  const downloadBtn = document.getElementById('download-btn');
  const clearBtn = document.getElementById('clear-all');
  const selectedInfo = document.getElementById('selected-info');
  const posXInput = document.getElementById('pos-x');
  const posYInput = document.getElementById('pos-y');
  const nudgeLeft = document.getElementById('nudge-left');
  const nudgeRight = document.getElementById('nudge-right');
  const nudgeUp = document.getElementById('nudge-up');
  const nudgeDown = document.getElementById('nudge-down');
  const nudgeLeft10 = document.getElementById('nudge-left10');
  const nudgeRight10 = document.getElementById('nudge-right10');
  const manualText = document.getElementById('manual-text');
  const createManualBtn = document.getElementById('create-manual');
  const setAdvBtn = document.getElementById('set-adv');
  const setElimBtn = document.getElementById('set-elim');
  const setClearBtn = document.getElementById('set-clear');
  const csvTable = document.getElementById('csv-table');

  let placedIdCounter = 1;

  // Helper: parse simple CSV
  function parseCSV(text){
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if(!lines.length) return [];
    const headers = lines[0].split(',').map(h=>h.trim());
    const rows = lines.slice(1).map(l=>{
      const cols = l.split(',');
      const obj = {};
      headers.forEach((h,i)=> obj[h]= (cols[i]||'').trim());
      return obj;
    });
    return {headers, rows};
  }

  function detectNameField(headers){
    const keys = headers.map(h=>h.toLowerCase());
    const candidates = ['team','隊','name','teamname','隊名','隊伍'];
    for(const c of candidates){
      const idx = keys.findIndex(k=>k.includes(c));
      if(idx>=0) return headers[idx];
    }
    return headers[0];
  }

  function detectFlagField(headers){
    const keys = headers.map(h=>h.toLowerCase());
    const candidates = ['flag','image','img','pic','圖片','圖檔','檔名','filename'];
    for(const c of candidates){
      const idx = keys.findIndex(k=>k.includes(c));
      if(idx>=0) return headers[idx];
    }
    return null;
  }

  // create list card (draggable)
  function makeListCard(item){
    const el = document.createElement('div');
    el.className = 'bg-white border border-slate-200 rounded-xl shadow-sm p-3 inline-flex items-center gap-3';
    // fixed width for list cards for consistent layout
    el.style.width = '220px';
    el.style.flex = '0 0 220px';
    el.draggable = true;
    // only create image if a flag URL exists (team cards); text-only cards skip the img
    let img = null;
    if(item.flag){
      img = document.createElement('img');
      img.src = item.flag || '';
      img.alt = '';
      img.style.height = '30px';
      img.style.width = 'auto';
      img.style.objectFit = 'cover';
    }

    const span = document.createElement('div');
    span.className = 'font-semibold tracking-wide';
    span.style.fontSize = '18px';
    span.style.textShadow = '0 1px 2px rgba(0,0,0,0.35)';
    span.style.overflow = 'hidden';
    span.style.textOverflow = 'ellipsis';
    span.style.whiteSpace = 'nowrap';
    span.textContent = item.name || '';

    if(img) el.appendChild(img);
    el.appendChild(span);

    // status badge area
    const statusWrap = document.createElement('div');
    statusWrap.className = 'ml-2 flex gap-1';
    const advBtn = document.createElement('button'); advBtn.textContent = '晉級'; advBtn.title='設為晉級'; advBtn.className='text-xs px-2 py-1 rounded bg-white border border-slate-200 text-slate-700 hover:bg-slate-50';
    const elimBtn = document.createElement('button'); elimBtn.textContent = '未晉級'; elimBtn.title='設為未晉級'; elimBtn.className='text-xs px-2 py-1 rounded bg-white border border-slate-200 text-slate-700 hover:bg-slate-50';
    const clearBtn = document.createElement('button'); clearBtn.textContent = '清除'; clearBtn.title='清除狀態'; clearBtn.className='text-xs px-2 py-1 rounded bg-white border border-slate-200 text-slate-700 hover:bg-slate-50';
    statusWrap.appendChild(advBtn); statusWrap.appendChild(elimBtn); statusWrap.appendChild(clearBtn);
    el.appendChild(statusWrap);

    // apply initial status style
    applyStatusStyleToList(el, item.status || null);

    advBtn.addEventListener('click',(e)=>{ e.stopPropagation(); item.status='adv'; applyStatusStyleToList(el,'adv'); });
    elimBtn.addEventListener('click',(e)=>{ e.stopPropagation(); item.status='elim'; applyStatusStyleToList(el,'elim'); });
    clearBtn.addEventListener('click',(e)=>{ e.stopPropagation(); item.status=null; applyStatusStyleToList(el,null); });

    el.addEventListener('dragstart', (ev)=>{
      ev.dataTransfer.setData('application/json', JSON.stringify(item));
    });

    return el;
  }

  // Unified drop handling on canvas: support both dragging list-cards (application/json)
  // and dropping image files to set base image. Always preventDefault on dragover
  // so the browser allows drop.
  canvasEl.addEventListener('dragover', (e)=>{ e.preventDefault(); });
  canvasEl.addEventListener('drop', (e)=>{
    e.preventDefault();
    try{
      // If files present, treat as base image change (drop a file onto canvas)
      if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length){
        const f = e.dataTransfer.files[0];
        if(f && f.type && f.type.startsWith('image/')){
          const url = URL.createObjectURL(f);
          baseImage.src = url;
          return;
        }
      }

      // Otherwise, try to handle drag from list cards (application/json payload)
      const data = e.dataTransfer.getData('application/json');
      if(data){
        const obj = JSON.parse(data);
        const rect = canvasEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        addPlacedCard(obj, x, y);
      }
    }catch(err){ console.warn('canvas drop handling error', err); }
  });

  // add placed card to layer; x,y in display pixels relative to canvasEl bounding box
  function addPlacedCard(item, dispX, dispY){
    const rect = canvasEl.getBoundingClientRect();
    const scale = CANVAS_W / rect.width;
    const x = Math.round(dispX * scale);
    const y = Math.round(dispY * scale);

    const el = document.createElement('div');
    el.className = 'placed-card bg-white border border-slate-200 rounded-xl shadow-sm p-3 flex items-center gap-3';
    el.style.left = (dispX)+'px';
    el.style.top = (dispY)+'px';
    el.style.transform = 'translate(-50%,-50%)';
    el.style.position = 'absolute';
    el.style.minWidth = '120px';
    el.style.maxWidth = '220px';

    // placed card: if item.flag exists, show image; otherwise show text-only
    let img = null;
    if(item.flag){
      img = document.createElement('img');
      img.src = item.flag || '';
      img.style.height = '30px';
      img.style.width = 'auto';
      img.style.objectFit = 'cover';
    }

    const span = document.createElement('div');
    span.className = 'font-semibold tracking-wide';
    span.textContent = item.name || '';
    span.style.fontSize = '18px';
    span.style.textShadow = '0 1px 2px rgba(0,0,0,0.35)';

    if(img) el.appendChild(img);
    el.appendChild(span);

    // reflect status visually on placed card
    el.dataset.status = item.status || '';
    applyStatusStyleToPlaced(el, item.status || null);

    // store model coordinates (in 1200x490 space)
    el.dataset.modelX = x;
    el.dataset.modelY = y;
    el.dataset.width = Math.round((el.getBoundingClientRect().width||160)*scale);

    // enable pointer dragging
    el.addEventListener('pointerdown', onPointerDown);
    // select on click
    el.addEventListener('click', ()=> setSelected(el));
    el.tabIndex = 0;
    el.addEventListener('dblclick', ()=> el.remove());

    placedLayer.appendChild(el);
  }

  // Apply styles for list card
  function applyStatusStyleToList(el, status){
    const btns = el.querySelectorAll('button');
    if(status === 'adv'){
      el.style.background = '#0aa35a';
      el.style.color = '#ffffff';
      el.style.opacity = '1';
      btns.forEach(b=>{ b.style.background = 'rgba(255,255,255,0.12)'; b.style.borderColor = 'rgba(255,255,255,0.18)'; b.style.color = '#ffffff'; });
    } else if(status === 'elim'){
      el.style.background = '#9fb6bf';
      el.style.color = '#0e7f86';
      el.style.opacity = '0.8';
      btns.forEach(b=>{ b.style.background = 'rgba(255,255,255,0.12)'; b.style.borderColor = 'rgba(0,0,0,0.06)'; b.style.color = '#0e7f86'; });
    } else {
      el.style.background = '';
      el.style.color = '';
      el.style.opacity = '1';
      btns.forEach(b=>{ b.style.background = ''; b.style.borderColor = ''; b.style.color = ''; });
    }
  }

  // Apply styles for placed card
  function applyStatusStyleToPlaced(el, status){
    if(status === 'adv'){
      el.style.background = '#0aa35a';
      el.style.color = '#ffffff';
      el.style.opacity = '1';
    } else if(status === 'elim'){
      el.style.background = '#9fb6bf';
      el.style.color = '#0e7f86';
      el.style.opacity = '0.8';
    } else {
      el.style.background = 'rgba(255,255,255,0.9)';
      el.style.color = '';
      el.style.opacity = '1';
    }
  }

  let dragEl = null;
  let startX=0, startY=0, origLeft=0, origTop=0;
  function onPointerDown(e){
    e.preventDefault();
    dragEl = e.currentTarget;
    dragEl.setPointerCapture(e.pointerId);
    const rect = canvasEl.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    const elRect = dragEl.getBoundingClientRect();
    origLeft = elRect.left - rect.left + elRect.width/2; // center-based because of translate(-50%,-50%)
    origTop = elRect.top - rect.top + elRect.height/2;

    function move(ev){
      if(!dragEl) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const newX = origLeft + dx;
      const newY = origTop + dy;
      dragEl.style.left = newX + 'px';
      dragEl.style.top = newY + 'px';
      // update model coords
      const rect = canvasEl.getBoundingClientRect();
      const scale = CANVAS_W / rect.width;
      dragEl.dataset.modelX = Math.round(newX * scale);
      dragEl.dataset.modelY = Math.round(newY * scale);
    }

    function up(ev){
      if(!dragEl) return;
      dragEl.releasePointerCapture(e.pointerId);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      dragEl = null;
    }

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  downloadBtn.addEventListener('click', async ()=>{
    try{
      console.log('export: start');
      const STAGE_W = CANVAS_W, STAGE_H = CANVAS_H;

      // 等字型就緒
      if(document.fonts && document.fonts.ready) try{ await document.fonts.ready; }catch(e){}

      const stageEl = canvasEl;
      // 等舞台內所有圖片就緒（包含放置卡片內的 img 與底圖）
      const imgs = Array.from(new Set([...(stageEl.querySelectorAll('img')||[]), baseImage].filter(Boolean)));
      await Promise.all(imgs.map(async (img)=>{
        if(!img) return;
        if(!img.complete){ await new Promise(res=>{ const onDone=()=>{ img.onload=null; img.onerror=null; res(); }; img.onload = onDone; img.onerror = onDone; }); }
        if(img.decode) await img.decode().catch(()=>{});
      }));

      // 使用放置層 (`placedLayer`) 作為精準的 content-box 原點，避免包含其他 UI 元素
      const layerRect = placedLayer.getBoundingClientRect();
      const originLeft = layerRect.left + placedLayer.clientLeft;
      const originTop = layerRect.top + placedLayer.clientTop;
      // 對齊放置層的 client 大小（不含 border）來計算縮放
      const sx = STAGE_W / placedLayer.clientWidth;
      const sy = STAGE_H / placedLayer.clientHeight;

      // 建立離屏 canvas（固定真實尺寸）
      const offscreen = document.createElement('canvas');
      offscreen.width = STAGE_W;
      offscreen.height = STAGE_H;
      const g = offscreen.getContext('2d');

      // 畫底圖，若失敗則清空白底
      try{
        await drawBaseToCtx(g);
      }catch(e){ console.warn('drawBaseToCtx failed', e); g.clearRect(0,0,STAGE_W,STAGE_H); }

      // 依照 DOM 當下 rect（左上角）繪製每張卡片
      const placedEls = Array.from(placedLayer.children);
      for(const el of placedEls){
        const r = el.getBoundingClientRect();
        const exportW = r.width * sx;
        const exportH = r.height * sy;
        // 使用 element 的 model 座標作為中心點，避免 transform(-50%,-50%) 導致的位移差異
        const modelX = Number(el.dataset.modelX) || Math.round(((r.left - originLeft) + r.width/2) * sx);
        const modelY = Number(el.dataset.modelY) || Math.round(((r.top  - originTop)  + r.height/2) * sy);
        const exportCenterX = modelX * (STAGE_W / CANVAS_W);
        const exportCenterY = modelY * (STAGE_H / CANVAS_H);
        const exportX = exportCenterX - exportW/2;
        const exportY = exportCenterY - exportH/2;

        // 先繪製卡片的外框（圓角背景 + 邊框），保持與畫面預覽一致
        const status = el.dataset.status || '';
        let bgFill = 'rgba(255,255,255,0.9)';
        if(status === 'adv') bgFill = '#0aa35a';
        if(status === 'elim') bgFill = '#9fb6bf';
        const strokeCol = 'rgba(0,0,0,0.06)';
        const radius = Math.min(24, Math.max(8, exportH * 0.12));
        // draw rounded rect at exportX,exportY,exportW,exportH
        g.beginPath();
        const x0 = exportX, y0 = exportY, w0 = exportW, h0 = exportH, r0 = radius;
        g.moveTo(x0 + r0, y0);
        g.arcTo(x0 + w0, y0, x0 + w0, y0 + h0, r0);
        g.arcTo(x0 + w0, y0 + h0, x0, y0 + h0, r0);
        g.arcTo(x0, y0 + h0, x0, y0, r0);
        g.arcTo(x0, y0, x0 + w0, y0, r0);
        g.closePath();
        g.fillStyle = bgFill;
        g.fill();
        g.lineWidth = 1;
        g.strokeStyle = strokeCol;
        g.stroke();

        // 若卡片內有圖片，繪製該圖片在相對位置與大小
        const imgEl = el.querySelector('img');
        if(imgEl && imgEl.src){
          try{  
            const childRect = imgEl.getBoundingClientRect();
            // use offsets relative to card rect so they align with new exportX/exportY
            const childOffsetX = childRect.left - r.left;
            const childOffsetY = childRect.top - r.top;
            const childX = exportX + childOffsetX * sx;
            const childY = exportY + childOffsetY * sy;
            const childW = childRect.width * sx;
            const childH = childRect.height * sy;
            const img = await loadImage(imgEl.src);
            g.drawImage(img, childX, childY, childW, childH);
          }catch(e){ console.warn('placed img draw failed', e); }
        }

        // 繪製文字：使用卡片中文本節點的 rect 來定位，並以其計算文字大小
        const nameNode = el.querySelector('div');
        if(nameNode){
          const nameRect = nameNode.getBoundingClientRect();
          const nameOffsetX = nameRect.left - r.left;
          const nameOffsetY = nameRect.top - r.top + nameRect.height/2; // middle
          const textX = exportX + nameOffsetX * sx;
          const textY = exportY + nameOffsetY * sy;
          const cs = window.getComputedStyle(nameNode);
          const baseFontSize = parseFloat(cs.fontSize) || 18;
          const drawFontSize = Math.max(10, Math.round(baseFontSize * ((sx+sy)/2)));
          g.font = `${drawFontSize}px ${cs.fontFamily || 'sans-serif'}`;
          g.fillStyle = (el.dataset.status==='adv') ? '#ffffff' : (el.dataset.status==='elim' ? '#0e7f86' : 'rgba(0,0,0,0.85)');
          g.textBaseline = 'middle';
          g.shadowColor = 'rgba(0,0,0,0.35)';
          g.shadowOffsetX = 0; g.shadowOffsetY = 1; g.shadowBlur = 2;
          g.fillText((nameNode.textContent||'').trim(), textX, textY);
          g.shadowColor = 'transparent';
        }
      }
      // helper: inline computed styles from source -> target (deep)
      function inlineComputedStyles(srcRoot, dstRoot){
        const srcAll = [srcRoot].concat(Array.from(srcRoot.querySelectorAll('*')));
        const dstAll = [dstRoot].concat(Array.from(dstRoot.querySelectorAll('*')));
        for(let i=0;i<srcAll.length && i<dstAll.length;i++){
          const s = srcAll[i];
          const d = dstAll[i];
          try{
            const cs = window.getComputedStyle(s);
            for(let j=0;j<cs.length;j++){
              const prop = cs[j];
              const val = cs.getPropertyValue(prop);
              const prio = cs.getPropertyPriority(prop);
              d.style.setProperty(prop, val, prio);
            }
          }catch(e){ /* ignore */ }
        }
      }

      // helper: serialize element to image via SVG foreignObject
      async function domToRaster(el){
        const r = el.getBoundingClientRect();
        const w = Math.max(1, Math.round(r.width));
        const h = Math.max(1, Math.round(r.height));
        const clone = el.cloneNode(true);
        // inline styles to clone to preserve appearance
        inlineComputedStyles(el, clone);
        // ensure images keep src attributes (cloned)
        // wrap in XHTML foreignObject
        const svg = `<?xml version="1.0" encoding="utf-8"?>\n<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>\n  <foreignObject width='100%' height='100%'>\n    <div xmlns='http://www.w3.org/1999/xhtml' style='width:${w}px;height:${h}px'>${clone.outerHTML}</div>\n  </foreignObject>\n</svg>`;
        const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        const img = await loadImage(url);
        return img;
      }

      
      const url = offscreen.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'composed.png';
      a.click();
      console.log('export: done');
    }catch(err){
      console.error('export failed', err);
      try{ alert('匯出過程發生錯誤，請查看 console'); }catch(e){}
    }
  });

  async function drawBaseToCtx(ctx){
    // baseImage may be loaded from file input; ensure it's fully decoded
    if(!baseImage.src) return;
    const img = await loadImage(baseImage.src);
    ctx.clearRect(0,0,CANVAS_W,CANVAS_H);
    ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
  }

  function loadImage(src){
    return new Promise((resolve, reject)=>{
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = ()=>resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // Selection & fine-positioning
  let selectedEl = null;
  function setSelected(el){
    if(selectedEl) selectedEl.classList.remove('ring-2','ring-blue-500','ring-slate-300');
    selectedEl = el;
    if(el){
      el.classList.add('ring-2','ring-slate-300');
      const name = el.querySelector('div')? el.querySelector('div').textContent : '';
      selectedInfo.textContent = name || '--';
      posXInput.value = Number(el.dataset.modelX) || 0;
      posYInput.value = Number(el.dataset.modelY) || 0;
      // reflect current status in selected info area via simple marker
      const curStatus = el.dataset.status || null;
      // no extra visual here; status buttons below will apply
    } else {
      selectedInfo.textContent = '--';
      posXInput.value = '';
      posYInput.value = '';
    }
  }

  function updateDisplayPos(el){
    const rect = canvasEl.getBoundingClientRect();
    const dispX = (Number(el.dataset.modelX) / CANVAS_W) * rect.width;
    const dispY = (Number(el.dataset.modelY) / CANVAS_H) * rect.height;
    el.style.left = dispX + 'px';
    el.style.top = dispY + 'px';
  }

  function nudgeSelected(dx, dy){
    if(!selectedEl) return;
    let nx = Number(selectedEl.dataset.modelX)||0;
    let ny = Number(selectedEl.dataset.modelY)||0;
    nx = Math.max(0, Math.min(CANVAS_W, nx + dx));
    ny = Math.max(0, Math.min(CANVAS_H, ny + dy));
    selectedEl.dataset.modelX = nx;
    selectedEl.dataset.modelY = ny;
    posXInput.value = nx;
    posYInput.value = ny;
    updateDisplayPos(selectedEl);
  }

  // wire up inputs and nudge buttons
  posXInput.addEventListener('change', ()=>{
    if(!selectedEl) return; selectedEl.dataset.modelX = Number(posXInput.value)||0; updateDisplayPos(selectedEl);
  });
  posYInput.addEventListener('change', ()=>{
    if(!selectedEl) return; selectedEl.dataset.modelY = Number(posYInput.value)||0; updateDisplayPos(selectedEl);
  });

  nudgeLeft.addEventListener('click', ()=> nudgeSelected(-1,0));
  nudgeRight.addEventListener('click', ()=> nudgeSelected(1,0));
  nudgeUp.addEventListener('click', ()=> nudgeSelected(0,-1));
  nudgeDown.addEventListener('click', ()=> nudgeSelected(0,1));
  nudgeLeft10.addEventListener('click', ()=> nudgeSelected(-10,0));
  nudgeRight10.addEventListener('click', ()=> nudgeSelected(10,0));

  // keyboard arrows to nudge
  document.addEventListener('keydown', (e)=>{
    if(!selectedEl) return;
    const step = e.shiftKey ? 10 : 1;
    if(e.key === 'ArrowLeft'){ e.preventDefault(); nudgeSelected(-step,0); }
    if(e.key === 'ArrowRight'){ e.preventDefault(); nudgeSelected(step,0); }
    if(e.key === 'ArrowUp'){ e.preventDefault(); nudgeSelected(0,-step); }
    if(e.key === 'ArrowDown'){ e.preventDefault(); nudgeSelected(0,step); }
  });

  // deselect when clicking empty area on canvas
  canvasEl.addEventListener('click', (e)=>{
    if(e.target === canvasEl || e.target === baseImage) setSelected(null);
  });

  // clear selection when clearing canvas
  clearBtn.addEventListener('click', ()=>{ placedLayer.innerHTML = ''; setSelected(null); });

  // base image selection
  chooseBaseBtn.addEventListener('click', ()=> baseFile.click());
  baseFile.addEventListener('change', (e)=>{
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    const url = URL.createObjectURL(f);
    baseImage.src = url;
  });

  // also support drag&drop on canvas to change base
  canvasEl.addEventListener('dragover', (e)=> e.dataTransfer && e.dataTransfer.items && e.preventDefault());
  canvasEl.addEventListener('drop', (e)=>{
    // if files present, treat as base image change
    if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length){
      const f = e.dataTransfer.files[0];
      if(f.type && f.type.startsWith('image/')){
        e.preventDefault();
        const url = URL.createObjectURL(f);
        baseImage.src = url;
        return;
      }
    }
  });

  clearBtn.addEventListener('click', ()=>{ placedLayer.innerHTML = ''; });

  // fetch CSV and populate cards
  async function init(){
    try{
      const res = await fetch(CSV_URL);
      const txt = await res.text();
      const parsed = parseCSV(txt);
      const nameField = detectNameField(parsed.headers);
      const flagField = detectFlagField(parsed.headers);

      for(const row of parsed.rows){
        const name = row[nameField] || '';
        let flag = flagField? row[flagField] : '';
        if(flag) {
          // if it's just a filename, prefix base
          if(!flag.startsWith('http')) flag = FLAG_BASE + flag;
        } else {
          // fallback: try teamname.png
          const fname = encodeURIComponent(name.replace(/\s+/g,'_')) + '.png';
          flag = FLAG_BASE + fname;
        }
        const item = {name, flag};
        const card = makeListCard(item);
        cardsRoot.appendChild(card);
      }
      // render CSV table for reference
      renderCSVTable(parsed);
    }catch(e){
      console.error('CSV 載入失敗', e);
      // still allow user to work with manual cards if needed
    }
  }

  // start
  init();

    // manual card creation (e.g., 日期卡)
    createManualBtn.addEventListener('click', ()=>{
      const txt = (manualText.value||'').trim();
      if(!txt) return;
      const item = { name: txt, flag: '', status: null };
      const card = makeListCard(item);
      cardsRoot.appendChild(card);
      manualText.value = '';
    });
    manualText.addEventListener('keydown', (e)=>{ if(e.key === 'Enter'){ createManualBtn.click(); e.preventDefault(); } });

    // status buttons for selected placed card
    setAdvBtn.addEventListener('click', ()=>{
      if(!selectedEl) return; selectedEl.dataset.status = 'adv'; applyStatusStyleToPlaced(selectedEl,'adv');
    });
    setElimBtn.addEventListener('click', ()=>{
      if(!selectedEl) return; selectedEl.dataset.status = 'elim'; applyStatusStyleToPlaced(selectedEl,'elim');
    });
    setClearBtn.addEventListener('click', ()=>{
      if(!selectedEl) return; selectedEl.dataset.status = ''; applyStatusStyleToPlaced(selectedEl,null);
    });

    // render CSV table for reference
    function renderCSVTable(parsed){
      if(!csvTable) return;
      const headers = parsed.headers || [];
      const rows = parsed.rows || [];
      const tbl = document.createElement('table');
      tbl.className = 'w-full table-auto text-sm';
      const thead = document.createElement('thead');
      const trh = document.createElement('tr');
      headers.forEach(h=>{ const th = document.createElement('th'); th.textContent = h; th.className='px-2 py-1 text-left font-medium'; trh.appendChild(th); });
      thead.appendChild(trh); tbl.appendChild(thead);
      const tbo = document.createElement('tbody');
      rows.forEach(r=>{
        const tr = document.createElement('tr');
        headers.forEach(h=>{ const td = document.createElement('td'); td.textContent = r[h]||''; td.className='px-2 py-1 border-t'; tr.appendChild(td); });
        tbo.appendChild(tr);
      });
      tbl.appendChild(tbo);
      csvTable.innerHTML = '';
      csvTable.appendChild(tbl);
    }
})();
