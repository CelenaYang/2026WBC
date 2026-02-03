// 圖片編排工具 main.js
(function(){
  const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTHz9Co4woY4xFfOQakyHVTBdVPzPpFEN4AotZPIc2fQP4Koli5Ru8Uk06qxSbi6P292c8phIFyptVe/pub?output=csv';  
  const FLAG_BASE = 'https://raw.githubusercontent.com/CelenaYang/2026WBC/main/teamPIC/';
  const CANVAS_W = 1200;
  let CANVAS_H = 490; // 當載入不同長寬比的底圖時，可能會更新此值
  let STAGE_W = CANVAS_W; // ← 真正使用的工作座標
  let STAGE_H = CANVAS_H;

  // 座標換算 helper：client -> 設計座標（model），以及 model -> 顯示座標
function clientToModel(clientX, clientY){
  const rect = canvasEl.getBoundingClientRect();
  const x = Math.round((clientX - rect.left) * (STAGE_W / rect.width));
  const y = Math.round((clientY - rect.top)  * (STAGE_H / rect.height));
  return { x, y };
}

function modelToDisplay(modelX, modelY){
  const rect = canvasEl.getBoundingClientRect();
  const dispX = (Number(modelX) / STAGE_W) * rect.width;
  const dispY = (Number(modelY) / STAGE_H) * rect.height;
  return { dispX, dispY };
}


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
  const basePresetSelect = document.getElementById('base-preset');  //0203新增
  const flagScaleInput = document.getElementById('flag-scale');
  const flagScaleLabel = document.getElementById('flag-scale-label');



  // 在畫布上方加入提示 overlay（DOM 元素），不會影響互動
  (function createCanvasHint(){
    if(document.getElementById('canvas-hint-overlay')) return;
    try{
      const overlay = document.createElement('div');
      overlay.id = 'canvas-hint-overlay';
      overlay.textContent = '可以拖曳圖片至此';
      overlay.style.position = 'absolute';
      overlay.style.left = '50%';
      overlay.style.top = '50%';
      overlay.style.transform = 'translate(-50%, -50%)';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '9999';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.fontSize = '22px';
      overlay.style.fontWeight = '600';
      overlay.style.color = 'rgba(0,0,0,0.45)';
      overlay.style.userSelect = 'none';
      if(canvasEl) canvasEl.appendChild(overlay);
    }catch(e){ console.warn('createCanvasHint failed', e); }
  })();
  // 隱藏 overlay 的輔助函式，會在 dragenter / drop / 放置卡片時呼叫
  function hideCanvasHint(){
    try{
      const o = document.getElementById('canvas-hint-overlay');
      if(o) o.style.display = 'none';
    }catch(e){ /* ignore */ }
  }
  // 當使用者把東西拖到畫布上方時，移除提示（避免遮擋視覺）
  if(canvasEl){
    canvasEl.addEventListener('dragenter', ()=> hideCanvasHint());
    canvasEl.addEventListener('drop', ()=> hideCanvasHint());
  }

  let placedIdCounter = 1;
  // 卡片寬度固定計算：fixedW = paddingLR + flagBlockW + gap + measureText(四字樣本)
  const CARD_PADDING_LR = 40; // left+right padding (px)
  const FLAG_BLOCK_W = 36; // 預留給旗幟圖示的區塊寬度 (px)
  const FLAG_TEXT_GAP = 10; // 圖片與文字間隔 (px)
  // 放置在舞台上的旗幟卡固定縮放比例（非手動文字卡）
  let PLACED_CARD_SCALE = 0.8;
  // canvas 上下文供 measureText 使用
  const _textMeasureCanvas = (()=>{ const c = document.createElement('canvas'); return c.getContext('2d'); })();
  // 計算以「4字基準」的卡片固定寬度 — 傳入 fontSize 即可（text 參數不使用）
  function computeCardWidthByChars(fontSize){
    const sample = '一二三四五'; // 4 個字樣本
    const fontFamily = (document.body && window.getComputedStyle(document.body).fontFamily) || 'sans-serif';
    _textMeasureCanvas.font = `${fontSize}px ${fontFamily}`;
    const textW = Math.round(_textMeasureCanvas.measureText(sample).width || (fontSize * 4));
    const fixedW = Math.round(CARD_PADDING_LR + FLAG_BLOCK_W + FLAG_TEXT_GAP + textW);
    return Math.max(80, fixedW);
  }

  // 當底圖改變時，根據影像 natural size 更新 CANVAS_H 並調整畫布顯示高度
  function updateCanvasSizeFromBase(img){
    try{
      if(!img || !img.naturalWidth || !img.naturalHeight) return;
      const newH = Math.round(CANVAS_W * (img.naturalHeight / img.naturalWidth));
      CANVAS_H = newH || CANVAS_H;
      // 根據目前畫面中 canvas 的顯示寬度，計算對應的顯示高度
      const displayW = canvasEl.clientWidth || canvasEl.getBoundingClientRect().width || CANVAS_W;
      const displayH = Math.round(displayW * (CANVAS_H / CANVAS_W));
      canvasEl.style.height = displayH + 'px';
      // update base image intrinsic attributes for clarity
      baseImage.width = CANVAS_W;
      baseImage.height = CANVAS_H;
      // 重新計算所有放置元素的顯示位置以配合新的顯示尺寸
      Array.from(placedLayer.children).forEach(ch => {
        try{ updateDisplayPos(ch); }catch(e){}
      });
    }catch(e){ console.warn('updateCanvasSizeFromBase failed', e); }
  }

  // 注入少量 CSS 以修正控制器手機版排版（不改動現有功能）
  (function injectResponsiveControlsCSS(){
    try{
      const css = `
      @media (max-width:640px){
        /* 容器避免寬度溢出 */
        .max-w-5xl { max-width:100%; }
        /* 控制器內的定位區改為兩欄網格，按鈕可換行 */
        #pos-controls{ display:grid; grid-template-columns: 1fr 1fr; gap:8px; align-items:center; }
        #pos-controls .flex{ grid-column: 1 / -1; display:flex; gap:8px; flex-wrap:wrap; }
        #pos-controls input{ width:100%; min-width:0; }
        .flex.items-center.gap-2 > .text-sm{ flex:0 0 auto; }
        /* 狀態按鈕列：允許換行並避免單一按鈕撐開整行 */
        .flex.gap-2.items-center{ flex-wrap:wrap; gap:8px; }
        .flex.gap-2.items-center > .flex.items-center.gap-2{ flex-wrap:wrap; gap:6px; }
        .flex.gap-2.items-center > .flex.items-center.gap-2 > button{ flex:0 0 auto; }
      }
      `;
      const s = document.createElement('style'); s.type = 'text/css'; s.appendChild(document.createTextNode(css));
      document.head.appendChild(s);
    }catch(e){ /* ignore */ }
  })();

  // 監聽 base image 載入事件
  baseImage.addEventListener('load', ()=> updateCanvasSizeFromBase(baseImage));

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

  // 建立清單卡片（可拖曳）
  function makeListCard(item){
    // 手動建立的卡片：純文字（無外框、無底圖）
    if(item.manual){
      const elm = document.createElement('div');
      // 明確指定為 inline-flex，並重設可能從父層繼承的樣式
      elm.style.display = 'inline-flex';
      elm.style.alignItems = 'center';
      elm.style.width = 'auto';
      elm.style.flex = '0 0 auto';
      elm.draggable = true;

      // 明確指定「完全透明、無視覺容器」
      elm.style.background = 'transparent';
      elm.style.border = 'none';
      elm.style.boxShadow = 'none';

      elm.style.padding = '0';
      elm.style.margin = '0 6px';
      elm.style.cursor = 'grab';

      // 👉 字體調整：放大並加粗
      elm.style.fontWeight = '600';
      elm.style.fontSize = '20px';

      elm.textContent = item.name || '';

      elm.addEventListener('dragstart', (ev)=>{
        try{ ev.dataTransfer.setData('application/json', JSON.stringify(item)); }catch(e){}
        try{ ev.dataTransfer.effectAllowed = 'copy'; }catch(e){}
        console.log('list: dragstart (manual)', item && item.name);
      });

      // 手機觸控處理：雙擊或長按以將卡片放在畫布中央
      (function(){
        let lastTap = 0, longPressTimer = null, moved = false;
        const dblThreshold = 300; const longPressDelay = 500;
        function placeCenter(){
          try{ const rect = canvasEl.getBoundingClientRect(); addPlacedCard(item, rect.width/2, rect.height/2); }catch(e){ console.warn('placeCenter failed', e); }
        }
        elm.addEventListener('touchstart', (ev)=>{ moved = false; if(longPressTimer) clearTimeout(longPressTimer); longPressTimer = setTimeout(()=>{ placeCenter(); longPressTimer = null; }, longPressDelay); }, {passive:true});
        elm.addEventListener('touchmove', (ev)=>{ moved = true; if(longPressTimer){ clearTimeout(longPressTimer); longPressTimer = null; } }, {passive:true});
        elm.addEventListener('touchend', (ev)=>{ if(longPressTimer){ clearTimeout(longPressTimer); longPressTimer = null; } const now = Date.now(); if(now - lastTap <= dblThreshold && !moved){ placeCenter(); lastTap = 0; } else lastTap = now; });
      })();

      return elm;
    }

    const el = document.createElement('div');
    el.className = 'bg-white border border-slate-200 rounded-xl shadow-sm p-3 inline-flex items-center gap-3';
    // 固定寬度的清單卡片以保持版面一致（使用四字基準）
    const baseFont = 18;
    const stdW = computeCardWidthByChars(baseFont);
    el.style.width = stdW + 'px';
    el.style.flex = '0 0 ' + stdW + 'px';
    el.draggable = true;
    // 只有在有旗幟網址時才建立圖像（隊伍卡）；純文字卡片則不建立 img
    let img = null;
    if(item.flag){
      img = document.createElement('img');
      img.src = item.flag || '';
      img.alt = '';
      img.style.height = '30px';
      img.style.width = 'auto';
      img.style.marginRight = '8px';
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
    // when flag exists, ensure text does not expand the card: set maxWidth for span
    if(item.flag){
      const textMax = stdW - (CARD_PADDING_LR + FLAG_BLOCK_W + FLAG_TEXT_GAP);
      span.style.maxWidth = (textMax > 20 ? textMax : 20) + 'px';
    }
    el.appendChild(span);

    el.addEventListener('dragstart', (ev)=>{
      try{ ev.dataTransfer.setData('application/json', JSON.stringify(item)); }catch(e){}
      try{ ev.dataTransfer.effectAllowed = 'copy'; }catch(e){}
      console.log('list: dragstart', item && item.name);
    });

    // 手機觸控處理：雙擊或長按以將卡片放在畫布中央
    (function(){
      let lastTap = 0, longPressTimer = null, moved = false;
      const dblThreshold = 300; const longPressDelay = 500;
      function placeCenter(){
        try{ const rect = canvasEl.getBoundingClientRect(); addPlacedCard(item, rect.width/2, rect.height/2); }catch(e){ console.warn('placeCenter failed', e); }
      }
      el.addEventListener('touchstart', (ev)=>{ moved = false; if(longPressTimer) clearTimeout(longPressTimer); longPressTimer = setTimeout(()=>{ placeCenter(); longPressTimer = null; }, longPressDelay); }, {passive:true});
      el.addEventListener('touchmove', (ev)=>{ moved = true; if(longPressTimer){ clearTimeout(longPressTimer); longPressTimer = null; } }, {passive:true});
      el.addEventListener('touchend', (ev)=>{ if(longPressTimer){ clearTimeout(longPressTimer); longPressTimer = null; } const now = Date.now(); if(now - lastTap <= dblThreshold && !moved){ placeCenter(); lastTap = 0; } else lastTap = now; });
    })();

    return el;
  }

  // 統一的畫布放置處理：支援拖放清單卡片（application/json）與放入圖片檔以設定底圖。
  // 在 dragover 時務必呼叫 preventDefault 以允許放置。
  // 此處為較為穩健的拖放處理，並包含除錯用日誌。
  canvasEl.addEventListener('dragenter', (e)=>{ e.preventDefault(); e.dataTransfer && (e.dataTransfer.dropEffect = 'copy'); });
  canvasEl.addEventListener('dragover', (e)=>{ e.preventDefault(); e.dataTransfer && (e.dataTransfer.dropEffect = 'copy'); });
  canvasEl.addEventListener('drop', async (e)=>{
    e.preventDefault(); e.stopPropagation();
    try{
      console.log('canvas: drop event', e.dataTransfer && { items: e.dataTransfer.items && e.dataTransfer.items.length, files: e.dataTransfer.files && e.dataTransfer.files.length });
      // 若有檔案，視為更換底圖（將檔案放到畫布上）
      if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length){
        const f = e.dataTransfer.files[0];
        console.log('canvas: dropped file', f && f.type);
        if(f && f.type && f.type.startsWith('image/')){
          const url = URL.createObjectURL(f);
          baseImage.src = url;
          return;
        }
      }

      // 否則嘗試處理來自清單卡片的拖放（application/json 負載）
      let data = e.dataTransfer && (e.dataTransfer.getData && e.dataTransfer.getData('application/json'));
      if(!data && e.dataTransfer && e.dataTransfer.items){
          // 嘗試從 DataTransferItemList 提取字串負載（對不同瀏覽器更穩健）
        for(let i=0;i<e.dataTransfer.items.length;i++){
          const it = e.dataTransfer.items[i];
          if(it.kind === 'string'){
            try{
              data = await new Promise(res=> it.getAsString(str=>res(str)));
              if(data) break;
            }catch(_){ /* ignore */ }
          }
        }
      }
      if(data){
        try{
          const obj = JSON.parse(data);
          // 以 client 座標轉為設計座標，並以顯示像素傳入 addPlacedCard
          const model = clientToModel(e.clientX, e.clientY);
          // convert model back to display so addPlacedCard receives display coords
          const disp = modelToDisplay(model.x, model.y);
          addPlacedCard(obj, disp.dispX, disp.dispY);
          return;
        }catch(jsonErr){ console.warn('canvas: drop json parse failed', jsonErr); }
      }
      console.log('canvas: drop - nothing handled');
    }catch(err){ console.warn('canvas drop handling error', err); }
  });

  // 將放置卡加入圖層；x,y 為相對於 canvasEl 外框的顯示像素座標
  function addPlacedCard(item, dispX, dispY){
    // dispX/dispY 為畫面顯示像素（client 參考系），轉換為設計座標存入 dataset
    const rect = canvasEl.getBoundingClientRect();
    const modelX = Math.round(dispX * (STAGE_W / rect.width));
    const modelY = Math.round(dispY * (STAGE_H / rect.height));


    const el = document.createElement('div');
    // 若為手動文字卡，呈現為透明且置中（無外框）
    if(item.manual){
      // 僅保留最小的 `placed-card` 鉤子類別（負責定位）；避免加入任何 UI/卡片樣式類別
      el.className = 'placed-card';
      el.style.background = 'transparent';
      el.style.border = 'none';
      el.style.boxShadow = 'none';
      el.style.padding = '0';
      el.style.minWidth = '40px';
      el.style.maxWidth = '400px';
      el.style.display = 'inline-block';
      el.style.textAlign = 'center';
    } else {
      el.className = 'placed-card bg-white border border-slate-200 rounded-xl shadow-sm p-3 flex items-center gap-3';
      const placedStdW = computeCardWidthByChars(18);
      el.style.minWidth = placedStdW + 'px';
      el.style.maxWidth = placedStdW + 'px';
    }
   
    // 直接以顯示座標設定位置（元素會用 translate(-50%,-50%) 置中）
    el.style.left = dispX + 'px';
    el.style.top  = dispY + 'px';

    // apply display-aware scaling so cards visually follow the stage zoom
    try{
      const displayScale = rect.width / CANVAS_W;
      if (!item.manual) {
        el.style.transform = `translate(-50%, -50%) scale(${PLACED_CARD_SCALE * displayScale})`;
      } else {
        el.style.transform = 'translate(-50%, -50%)';
      }
    }catch(e){ if(!item.manual) el.style.transform = `translate(-50%, -50%) scale(${PLACED_CARD_SCALE})`; else el.style.transform = 'translate(-50%, -50%)'; }
    el.style.transformOrigin = 'center center';
    el.style.position = 'absolute';

// 已放置的卡片：若 item.flag 存在則顯示圖片；否則僅顯示文字
    let img = null;
    if(item.flag){
      img = document.createElement('img');
      img.src = item.flag || '';
      img.style.height = '30px';
      img.style.width = 'auto';
      img.style.objectFit = 'cover';
      img.style.marginRight = '8px';
    }

    const span = document.createElement('div');
    span.className = 'font-semibold tracking-wide';
    span.textContent = item.name || '';
    span.style.fontSize = item.manual ? '20px' : '18px';
    span.style.textShadow = '0 1px 2px rgba(0,0,0,0.35)';

    if(item.manual){
      span.style.fontWeight = '600';
      span.style.textAlign = 'center';
      span.style.whiteSpace = 'nowrap';
      span.style.overflow = 'visible';
      span.style.margin = '0';
    }

    if(img) el.appendChild(img);
    if(!item.manual && item.flag){
      const textMax = (parseInt(el.style.minWidth||el.style.width||160) - (CARD_PADDING_LR + FLAG_BLOCK_W + FLAG_TEXT_GAP));
      span.style.maxWidth = (textMax > 20 ? textMax : 20) + 'px';
      span.style.overflow = 'hidden';
      span.style.textOverflow = 'ellipsis';
      span.style.whiteSpace = 'nowrap';
    }
    el.appendChild(span);
    if(item.manual){
      span.style.fontWeight = '600';
      span.style.textAlign = 'center';
      span.style.whiteSpace = 'nowrap';
      span.style.overflow = 'visible';
      span.style.margin = '0';
    }

    if(img) el.appendChild(img);
    if(!item.manual && item.flag){
      // apply ellipsis limits for placed flag cards
      const textMax = (parseInt(el.style.minWidth||el.style.width||stdW) - (CARD_PADDING_LR + FLAG_BLOCK_W + FLAG_TEXT_GAP));
      span.style.maxWidth = (textMax > 20 ? textMax : 20) + 'px';
      span.style.overflow = 'hidden';
      span.style.textOverflow = 'ellipsis';
      span.style.whiteSpace = 'nowrap';
    }
    el.appendChild(span);

    // reflect status visually on placed card
    el.dataset.status = item.status || '';
    // mark manual on placed element for export logic
    if(item.manual) el.dataset.manual = '1';
    applyStatusStyleToPlaced(el, item.status || null);

    // store model coordinates (in 1200x490 space)
    el.dataset.modelX = modelX;
    el.dataset.modelY = modelY;
    const scale = CANVAS_W / rect.width;
    el.dataset.width = Math.round((el.getBoundingClientRect().width||160)*scale);

    // enable pointer dragging
    el.addEventListener('pointerdown', onPointerDown);
    // select on click
    el.addEventListener('click', ()=> setSelected(el));
    el.tabIndex = 0;
    el.addEventListener('dblclick', ()=> el.remove());

placedLayer.appendChild(el);

// 新卡片一出生就套用目前的縮放比例
try { ensurePlacedScale(el); } catch (e) {}

// 放置卡片後也隱藏提示文字
try { hideCanvasHint(); } catch (e) {}

  }

  // 套用清單卡片的樣式
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

  // 套用已放置卡片的樣式
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
  let dragStartPointer = null; // {x,y} model
  let dragStartEl = null;      // {x,y} model

  function onPointerDown(e){
    e.preventDefault();
    dragEl = e.currentTarget;

    dragStartPointer = clientToModel(e.clientX, e.clientY);
    dragStartEl = {
      x: Number(dragEl.dataset.modelX || 0),
      y: Number(dragEl.dataset.modelY || 0),
    };

    dragEl.setPointerCapture(e.pointerId);
    const rect = canvasEl.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    const elRect = dragEl.getBoundingClientRect();
    // element center in display coords (relative to canvas left/top)
    origLeft = elRect.left - rect.left + elRect.width/2; // center-based because of translate(-50%,-50%)
    origTop = elRect.top - rect.top + elRect.height/2;
    // pointer -> center offset (display pixels)
   //0203待刪掉 const pointerToCenterX = origLeft - startX;
   //0203待刪掉 const pointerToCenterY = origTop - startY;

function move(ev){
  if(!dragEl) return;

  const p = clientToModel(ev.clientX, ev.clientY);
  const dx = p.x - dragStartPointer.x;
  const dy = p.y - dragStartPointer.y;

  const nx = dragStartEl.x + dx;
  const ny = dragStartEl.y + dy;

  dragEl.dataset.modelX = String(nx);
  dragEl.dataset.modelY = String(ny);

  updateDisplayPos(dragEl);

  // 你原本的縮放（可留）
  try{
    const displayScale = canvasEl.getBoundingClientRect().width / STAGE_W;
    if(dragEl.dataset && dragEl.dataset.manual) dragEl.style.transform = 'translate(-50%, -50%)';
    else dragEl.style.transform = `translate(-50%, -50%) scale(${PLACED_CARD_SCALE * displayScale})`;
  }catch(e){}
}


    function up(ev){
      if(!dragEl) return;
      dragEl.releasePointerCapture(ev.pointerId);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      dragEl = null;
      dragStartPointer = null;
      dragStartEl = null;

    }

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  downloadBtn.addEventListener('click', async ()=>{
    try{
      console.log('export: start');

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
        // 從 transform（若有）計算元素的 CSS 縮放，以確保匯出結果與畫面一致
        const csEl = window.getComputedStyle(el);
        let cssScaleX = 1, cssScaleY = 1;
        try{
          const tr = csEl.transform || csEl.webkitTransform || csEl.msTransform;
          if(tr && tr !== 'none'){
            const m = tr.match(/matrix\(([^)]+)\)/);
            if(m){
              const vals = m[1].split(',').map(Number);
              const a = vals[0], b = vals[1], c = vals[2], d = vals[3];
              cssScaleX = Math.hypot(a, b) || 1;
              cssScaleY = Math.hypot(c, d) || 1;
            } else {
              const m3 = tr.match(/matrix3d\(([^)]+)\)/);
              if(m3){
                const vals = m3[1].split(',').map(Number);
                // matrix3d scaleX at [0], scaleY at [5]
                cssScaleX = Math.hypot(vals[0], vals[1]) || 1;
                cssScaleY = Math.hypot(vals[4], vals[5]) || 1;
              }
            }
          }
        }catch(e){ /* ignore */ }

        const unscaledW = el.offsetWidth || r.width;
        const unscaledH = el.offsetHeight || r.height;
        const exportW = unscaledW * cssScaleX * sx;
        const exportH = unscaledH * cssScaleY * sy;
        // 使用 element 的 model 座標作為中心點，避免 transform(-50%,-50%) 導致的位移差異
        const modelX = Number(el.dataset.modelX) || Math.round(((r.left - originLeft) + r.width/2) * sx);
        const modelY = Number(el.dataset.modelY) || Math.round(((r.top  - originTop)  + r.height/2) * sy);
        const exportCenterX = modelX;
        const exportCenterY = modelY;
        const exportX = exportCenterX - exportW/2;
        const exportY = exportCenterY - exportH/2;

        const status = el.dataset.status || '';
        const isManual = !!el.dataset.manual;

        // 對於旗幟卡：繪製圓角半透明底、邊框與淡陰影
        if(!isManual){
          const radius = Math.min(24, Math.max(8, exportH * 0.12));
          // choose background based on status
          let bgFill = 'rgba(255,255,255,0.9)';
          if(status === 'adv') bgFill = '#0aa35a';
          if(status === 'elim') bgFill = '#9fb6bf';
          const strokeCol = 'rgba(255,255,255,0.9)';

          // 繪製帶陰影的圓角矩形
          g.save();
          g.beginPath();
          const x0 = exportX, y0 = exportY, w0 = exportW, h0 = exportH, r0 = radius;
          g.moveTo(x0 + r0, y0);
          g.arcTo(x0 + w0, y0, x0 + w0, y0 + h0, r0);
          g.arcTo(x0 + w0, y0 + h0, x0, y0 + h0, r0);
          g.arcTo(x0, y0 + h0, x0, y0, r0);
          g.arcTo(x0, y0, x0 + w0, y0, r0);
          g.closePath();
          g.shadowColor = 'rgba(0,0,0,0.12)';
          g.shadowBlur = Math.max(4, exportH * 0.03);
          g.shadowOffsetX = 0;
          g.shadowOffsetY = 2;
          g.fillStyle = bgFill;
          g.fill();
          g.shadowColor = 'transparent';
          g.lineWidth = Math.max(2, exportH * 0.02);
          g.strokeStyle = strokeCol;
          g.stroke();
          g.restore();
        }

        // 若卡片內有圖片，繪製該圖片在相對位置與大小
        const imgEl = el.querySelector('img');
        if(imgEl && imgEl.src){
          try{
            const childRect = imgEl.getBoundingClientRect();
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

        // 繪製文字：手動卡片僅繪製文字（置中），旗幟卡繪製在與畫面一致的位置
        const nameNode = el.querySelector('div');
        if(nameNode){
          const cs = window.getComputedStyle(nameNode);
          const baseFontSize = parseFloat(cs.fontSize) || 18;
          // 考慮元素的 CSS transform 縮放（cssScaleX）與舞台顯示->設計縮放 (sx,sy)
          const drawFontSize = Math.max(10, Math.round(baseFontSize * (cssScaleX || 1) * ((sx+sy)/2)));
          g.font = `600 ${drawFontSize}px ${cs.fontFamily || 'sans-serif'}`;
          g.textBaseline = 'middle';
          g.shadowColor = 'rgba(0,0,0,0.28)';
          g.shadowOffsetX = 0; g.shadowOffsetY = 1; g.shadowBlur = 2;
          if(isManual){
            g.textAlign = 'center';
            const textX = exportX + exportW/2;
            const textY = exportY + exportH/2;
            g.fillStyle = 'rgba(0,0,0,0.85)';
            g.fillText((nameNode.textContent||'').trim(), textX, textY);
            g.textAlign = 'start';
          } else {
            const nameRect = nameNode.getBoundingClientRect();
            const nameOffsetX = nameRect.left - r.left;
            const nameOffsetY = nameRect.top - r.top + nameRect.height / 2; // middle

            g.textAlign = 'center';

            const textX = exportX + (nameOffsetX + nameRect.width / 2) * sx; // 文字區中心
            const textY = exportY + nameOffsetY * sy;                        // 垂直位置跟畫面一致

            g.fillStyle = (el.dataset.status==='adv') ? '#ffffff'
                      : (el.dataset.status==='elim') ? '#0e7f86'
                      : 'rgba(0,0,0,0.85)';

            g.fillText((nameNode.textContent||'').trim(), textX, textY);
            g.textAlign = 'start';
          }
        }
      }

      // 輔助：將來源元素的計算樣式內嵌到目標元素（遞迴）
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

      // 輔助：透過 SVG foreignObject 將元素序列化為影像
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
  if(!baseImage.src) return;
  const img = await loadImage(baseImage.src);
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
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

  // 選取與微調位置
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
    const dispX = (Number(el.dataset.modelX) / STAGE_W) * rect.width;
    const dispY = (Number(el.dataset.modelY) / STAGE_H) * rect.height;
    el.style.left = dispX + 'px';
    el.style.top = dispY + 'px';
    // apply display-aware scaling so cards follow stage zoom on mobile
    try{ ensurePlacedScale(el); }catch(e){}
  }

  function nudgeSelected(dx, dy){
    if(!selectedEl) return;
    let nx = Number(selectedEl.dataset.modelX)||0;
    let ny = Number(selectedEl.dataset.modelY)||0;
    nx = Math.max(0, Math.min(STAGE_W, nx + dx));
    ny = Math.max(0, Math.min(STAGE_H, ny + dy));
    selectedEl.dataset.modelX = nx;
    selectedEl.dataset.modelY = ny;
    posXInput.value = nx;
    posYInput.value = ny;
    updateDisplayPos(selectedEl);
  }

  // 綁定輸入欄位與微移按鈕
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

  // 使用鍵盤方向鍵進行微移
  document.addEventListener('keydown', (e)=>{
    if(!selectedEl) return;
    const step = e.shiftKey ? 10 : 1;
    if(e.key === 'ArrowLeft'){ e.preventDefault(); nudgeSelected(-step,0); }
    if(e.key === 'ArrowRight'){ e.preventDefault(); nudgeSelected(step,0); }
    if(e.key === 'ArrowUp'){ e.preventDefault(); nudgeSelected(0,-step); }
    if(e.key === 'ArrowDown'){ e.preventDefault(); nudgeSelected(0,step); }
  });

  // 在畫布空白處點擊以取消選取
  canvasEl.addEventListener('click', (e)=>{
    if(e.target === canvasEl || e.target === baseImage) setSelected(null);
  });

  // 在清除畫布時一併取消選取
  clearBtn.addEventListener('click', ()=>{ placedLayer.innerHTML = ''; setSelected(null); });

// 底圖尺寸版本（只 log，不影響功能）
if (basePresetSelect) {
  basePresetSelect.addEventListener('change', () => {
    if (basePresetSelect.value === 'pc') {
      STAGE_W = 1200; STAGE_H = 490;
    } else {
      STAGE_W = 800;  STAGE_H = 800;
    }

    // 重算所有卡片顯示位置
    Array.from(placedLayer.children).forEach(updateDisplayPos);
  });
}

if (flagScaleInput) {
  const applyScaleToAll = () => {
    const pct = Number(flagScaleInput.value || 70);
    PLACED_CARD_SCALE = pct / 100;

    if (flagScaleLabel) flagScaleLabel.textContent = `${pct}%`;

    Array.from(placedLayer.children).forEach(el => {
      try { ensurePlacedScale(el); } catch (e) {}
    });
  };

  flagScaleInput.addEventListener('input', applyScaleToAll);
  flagScaleInput.addEventListener('change', applyScaleToAll);

  applyScaleToAll(); // 初始化同步一次
}


  // 底圖選擇
  chooseBaseBtn.addEventListener('click', ()=> baseFile.click());
  baseFile.addEventListener('change', (e)=>{
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    const url = URL.createObjectURL(f);
    baseImage.src = url;
  });

  // 注意：canvas 的放置處理已在前面統一實作

  clearBtn.addEventListener('click', ()=>{ placedLayer.innerHTML = ''; });

  // 取得 CSV 並產生卡片
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
          // 若只是檔名，則加上 base 前綴
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
      // 若有需要，仍允許使用者操作手動卡片
    }
  }

  // start
  init();

  // 確保既有的已放置卡片使用正確的縮放轉換（以防 UI 保留了舊的元素）
function ensurePlacedScale(el){
  const displayScale = canvasEl.getBoundingClientRect().width / STAGE_W;

  if (el.dataset && el.dataset.manual) {
    el.style.transform = 'translate(-50%, -50%)';
  } else {
    el.style.transform = `translate(-50%, -50%) scale(${PLACED_CARD_SCALE * displayScale})`;
  }

  el.style.transformOrigin = 'center center';
}


  Array.from(placedLayer.children).forEach(ch => { try{ ensurePlacedScale(ch); }catch(e){} });

    // manual card creation (e.g., 日期卡)
    createManualBtn.addEventListener('click', ()=>{
      const txt = (manualText.value||'').trim();
      if(!txt) return;
      const item = { name: txt, flag: '', status: null, manual: true };
      const card = makeListCard(item);
      cardsRoot.appendChild(card);
      manualText.value = '';
    });
    manualText.addEventListener('keydown', (e)=>{ if(e.key === 'Enter'){ createManualBtn.click(); e.preventDefault(); } });

    // 已選取之已放置卡片的狀態按鈕
    setAdvBtn.addEventListener('click', ()=>{
      if(!selectedEl) return; selectedEl.dataset.status = 'adv'; applyStatusStyleToPlaced(selectedEl,'adv');
    });
    setElimBtn.addEventListener('click', ()=>{
      if(!selectedEl) return; selectedEl.dataset.status = 'elim'; applyStatusStyleToPlaced(selectedEl,'elim');
    });
    setClearBtn.addEventListener('click', ()=>{
      if(!selectedEl) return; selectedEl.dataset.status = ''; applyStatusStyleToPlaced(selectedEl,null);
    });

    // 繪製 CSV 表格作為參考
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
