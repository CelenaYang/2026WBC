// slot-detector.js
// 偵測底圖中接近特定顏色 (#ecf8f9) 的區塊並繪製 slot overlay
(function () {
  // 設定區（集中常數，方便調整）
  console.log('[slot-detector] loaded v20260209-1');
  const TARGET_HEX = '#ecf8f9';
  const TOL = 12; // 建議 10~14
  const MIN_AREA = 40;   // 最小像素面積（調小以捕捉小框）
  const MAX_AREA = 20000; // 最大像素面積，排除大片背景
  const MIN_W = 6;       // 最小寬度 (px)
  const MIN_H = 6;       // 最小高度 (px)
  const MAX_W = 600;     // 最大寬度 (px) - 以原圖像素為單位
  const MAX_H = 600;     // 最大高度 (px)
  const ASPECT_MIN = 0.25; // 寬高比下限
  const ASPECT_MAX = 4.0;  // 寬高比上限
  const ERODE_NEIGHBOR_THRESHOLD = 4; // 3x3 中至少有多少相近色
  const ANCHOR = 'center'; // center | top-center | top-left
  const DENSITY_MIN = 0.4; // 從 0.3~0.4 開始
  const CHAMPION_WIDTH_SCALE = 0.92; // (legacy) scale applied to mirrored right slot width
  const CHAMPION_W_SCALE = 0.90; // final shrink scale applied to both champion slots (center-preserving)


  // utility: hex -> rgb
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
  }

  const targetRgb = hexToRgb(TARGET_HEX || '#ecf8f9');
  const tol2 = (TOL || 12) * (TOL || 12);

  // DOM refs (will be resolved later)
  let canvasEl = null, placedLayer = null, baseImage = null;
  let STAGE_W = 1200, STAGE_H = 490;

  // slot state
  let slots = [];
  let autoPlaceEnabled = false;
  let selectedSlotId = null;

  // create overlay layer
  function ensureSlotLayer() {
    canvasEl = canvasEl || document.getElementById('canvas');
    placedLayer = placedLayer || document.getElementById('placed-layer');
    baseImage = baseImage || document.getElementById('base-image');
    if (!canvasEl) return null;
    let layer = document.getElementById('slot-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'slot-layer';
      Object.assign(layer.style, {
        position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9998
      });
      // append above placedLayer so slots overlay on top
      if (placedLayer && placedLayer.parentElement) placedLayer.parentElement.appendChild(layer);
      else canvasEl.appendChild(layer);

      // basic CSS for slot boxes
      const style = document.createElement('style');
      style.textContent = `
        #slot-layer .slot-box{ position:absolute; box-sizing:border-box; border:2px dashed rgba(30,64,175,0.9); border-radius:6px; background: rgba(255,255,255,0.02); }
        #slot-layer .slot-box:hover{ box-shadow: 0 0 0 3px rgba(96,165,250,0.08); }
        #slot-layer .slot-selected{ outline: 3px solid rgba(250,204,21,0.95); box-shadow: 0 4px 20px rgba(250,204,21,0.12); }
      `;
      document.head.appendChild(style);
    }
    return layer;
  }

  // color distance squared
  function colorMatch(r, g, b) {
    const dr = r - targetRgb.r;
    const dg = g - targetRgb.g;
    const db = b - targetRgb.b;
    return (dr * dr + dg * dg + db * db) <= tol2;
  }

  // helper: convert pixel-based bbox to model slot
  function pxToModelSlot(id, pxBox, imgW, imgH) {
    const minXm = (pxBox.x / imgW) * STAGE_W;
    const minYm = (pxBox.y / imgH) * STAGE_H;
    const mw = (pxBox.w / imgW) * STAGE_W;
    const mh = (pxBox.h / imgH) * STAGE_H;
    const cx = minXm + mw / 2; const cy = minYm + mh / 2;
    return { id: id, minX: minXm, minY: minYm, width: mw, height: mh, cx: cx, cy: cy };
  }

  // detect color blocks: returns slots in model coords
  async function detectColorBlocks(img) {
    if (!img || !img.naturalWidth) return [];
    // update stage info via window.__wbc if available
    try { const st = window.__wbc && window.__wbc.getStage && window.__wbc.getStage(); if (st) { STAGE_W = st.STAGE_W || STAGE_W; STAGE_H = st.STAGE_H || STAGE_H; } } catch (e) { }

    // If stage is Msite square (800x800 or near-square), return a fixed template of slots
    try {
      const st = (window.__wbc && window.__wbc.getStage && window.__wbc.getStage()) || { STAGE_W, STAGE_H };
      const curW = st.STAGE_W || STAGE_W;
      const curH = st.STAGE_H || STAGE_H;
      const isMsite = (curW === 800 && curH === 800) || (Math.abs(curW - curH) <= 2) || (curW > 0 && curH > 0 && (curW / curH >= 0.98 && curW / curH <= 1.02));
      if (isMsite) {
        // percentage templates
        const T = (x, y, w, h) => {
          const minX = Math.round(curW * x);
          const minY = Math.round(curH * y);
          const width = Math.round(curW * w);
          const height = Math.round(curH * h);
          const cx = minX + width / 2;
          const cy = minY + height / 2;
          return { minX, minY, width, height, cx, cy };
        };
        const templates = [
          // champions shifted right by +0.02
          ['champion-left',  0.19, 0.13, 0.22, 0.07],
          ['champion-right', 0.63, 0.13, 0.22, 0.07],
          // semis: top and bottom slots (aligned to date blue bands)
          // left: x -0.03, y +0.02
          ['semi-left-T',   0.10, 0.35, 0.27, 0.07],
          ['semi-left-B',   0.10, 0.48, 0.27, 0.07],
          // right: x +0.03, y +0.02
          ['semi-right-T',  0.63, 0.35, 0.27, 0.07],
          ['semi-right-B',  0.63, 0.48, 0.27, 0.07],
          // qf: four columns, each with top and bottom slots
          // qf adjustments: left columns move left (-0.03), rightmost column move right (+0.03), all y +0.03 except qf-3 x unchanged
          ['qf-1-T', 0.02, 0.69, 0.21, 0.07],
          ['qf-1-B', 0.02, 0.82, 0.21, 0.07],
          ['qf-2-T', 0.27, 0.69, 0.21, 0.07],
          ['qf-2-B', 0.27, 0.82, 0.21, 0.07],
          ['qf-3-T', 0.52, 0.69, 0.21, 0.07],
          ['qf-3-B', 0.52, 0.82, 0.21, 0.07],
          ['qf-4-T', 0.77, 0.69, 0.21, 0.07],
          ['qf-4-B', 0.77, 0.82, 0.21, 0.07]
        ];
        const outSlots = templates.map(t => {
          const id = t[0]; const x = t[1]; const y = t[2]; const wPerc = t[3]; const hPerc = t[4];
          const s = T(x, y, wPerc, hPerc);
          return { id: id, minX: s.minX, minY: s.minY, width: s.width, height: s.height, cx: Math.round(s.cx), cy: Math.round(s.cy) };
        });
        return outSlots;
      }
    } catch (e) { console.warn('slot-detector: msitemplate check failed', e); }

    const w = img.naturalWidth; const h = img.naturalHeight;
    const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // build raw mask based on colorMatch
    const rawMask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x; const off = i * 4;
        const a = data[off + 3];
        if (a === 0) { rawMask[i] = 0; continue; }
        if (colorMatch(data[off], data[off + 1], data[off + 2])) rawMask[i] = 1;
      }
    }

    // erode: require enough neighbors in 3x3 to be valid
    const eroded = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!rawMask[i]) { eroded[i] = 0; continue; }
        let cnt = 0;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
            if (rawMask[yy * w + xx]) cnt++;
          }
        }
        eroded[i] = (cnt >= ERODE_NEIGHBOR_THRESHOLD) ? 1 : 0;
      }
    }

    const visited = new Uint8Array(w * h);
    const out = [];

    function idx(x, y) { return (y * w + x); }

    // flood-fill on eroded mask
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = idx(x, y);
        if (visited[i] || !eroded[i]) continue;

        // BFS
        let minX = x, maxX = x, minY = y, maxY = y, count = 0;
        const stack = [i]; visited[i] = 1;
        while (stack.length) {
          const cur = stack.pop();
          const cx = cur % w; const cy = Math.floor(cur / w);
          count++;
          if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
          // neighbors 4-neigh
          const nb = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
          for (const [nx, ny] of nb) {
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = idx(nx, ny);
            if (visited[ni]) continue;
            if (eroded[ni]) { visited[ni] = 1; stack.push(ni); }
            else visited[ni] = 1;
          }
        }

        const bw = maxX - minX + 1; const bh = maxY - minY + 1; const area = count;
        const aspect = bw / Math.max(1, bh);

        // apply stricter filters: area and size must be within min..max, and aspect ratio reasonable
        if (area >= MIN_AREA && area <= MAX_AREA && bw >= MIN_W && bw <= MAX_W && bh >= MIN_H && bh <= MAX_H && aspect >= ASPECT_MIN && aspect <= ASPECT_MAX) {
          // map to model coords
          const minXm = (minX / w) * STAGE_W;
          const minYm = (minY / h) * STAGE_H;
          const maxXm = (maxX / w) * STAGE_W;
          const maxYm = (maxY / h) * STAGE_H;
          const mw = maxXm - minXm; const mh = maxYm - minYm;
          const cxm = minXm + mw / 2; const cym = minYm + mh / 2;
          out.push({ id: 'big-' + out.length + '-' + Date.now(), pxMinX: minX, pxMinY: minY, pxW: bw, pxH: bh, area: area, minX: minXm, minY: minYm, width: mw, height: mh, cx: cxm, cy: cym });
        }
      }
    }

    // At this stage `out` contains detected bigBoxes (in model coords and px coords)
    console.log('slot-detector: bigBoxes detected:', out.length);

    function pickChampionBox(boxes) {
      // 只在 boxes 裡挑：必須在畫面中央且靠上
      const centerX = STAGE_W / 2;
      let best = null;
      for (const b of boxes) {
        // STRICT FILTER: 必須在水平中央 15% 範圍內
        if (Math.abs(b.cx - centerX) > STAGE_W * 0.15) continue;
        // STRICT FILTER: 必須在垂直上方 25% 範圍內
        if (b.minY > STAGE_H * 0.25) continue;

        const wScore = b.width;                 // 越寬越像冠軍框
        const yScore = 1 / (1 + b.minY);        // 越上面越好
        const cxScore = 1 / (1 + Math.abs(b.cx - centerX)); // 越靠中越好
        const score = wScore * 1.2 + yScore * 200 + cxScore * 200;
        if (!best || score > best.score) best = { b, score };
      }
      return best ? best.b : null;
    }

    // normalize champion slot: only applied to champion-derived model slots
    // This version does NOT change horizontal position (keeps px->model mapping),
    // only applies a small vertical nudge so anchor/offset matches other slots.
    function normalizeChampionSlot(slot, champ, ctx) {
      try {
        // keep horizontal (minX) as produced by px->model mapping to avoid shifting left slot
        // apply small upward nudge to better align visually
        const nudge = -Math.round(slot.height * 0.06); // move up 6% of slot height
        slot.minY = Math.max(0, slot.minY + nudge);
        if (slot.minY < champ.minY) slot.minY = champ.minY;
        // recompute center
        slot.cx = slot.minX + slot.width / 2;
        slot.cy = slot.minY + slot.height / 2;
      } catch (e) { console.warn('normalizeChampionSlot failed', e); }
    }

    // 用偵測到的 bigBoxes 找冠軍框
    let finalSlotsFixed = [];
    const champ = pickChampionBox(out);
    if (champ) {
      // --- Champion-only: merge nearby top-row blocks and expand the union box ---
      try {
        // find global top-most y among all detected big boxes (px coords)
        const topY = out.reduce((m, b) => Math.min(m, b.pxMinY), Infinity);
        const topRowThreshold = Math.max(6, Math.round((champ.pxH || 0) * 0.3));
        const centerPx = Math.round(w / 2);
        // candidate: top row (y small) and horizontally close to center region
        const centerRangePx = Math.round(w * 0.18);
        const topCandidates = out.filter(b => (b.pxMinY <= topY + topRowThreshold) && (Math.abs((b.pxMinX + b.pxW / 2) - centerPx) <= centerRangePx));

        if (topCandidates.length >= 2) {
          // record before entries for console.table
          const beforeRows = topCandidates.map(b => ({ stage: 'before', id: b.id, x: b.pxMinX, y: b.pxMinY, w: b.pxW, h: b.pxH }));
          // compute union bbox in px
          let minX = Math.min(...topCandidates.map(b => b.pxMinX));
          let minY = Math.min(...topCandidates.map(b => b.pxMinY));
          let maxX = Math.max(...topCandidates.map(b => (b.pxMinX + b.pxW - 1)));
          let maxY = Math.max(...topCandidates.map(b => (b.pxMinY + b.pxH - 1)));
          // expand padding (左右各 +12px，上下各 +8px)
          const padX = 12; const padY = 8;
          minX = Math.max(0, minX - padX); minY = Math.max(0, minY - padY);
          maxX = Math.min(w - 1, maxX + padX); maxY = Math.min(h - 1, maxY + padY);
          const mergedW = maxX - minX + 1; const mergedH = maxY - minY + 1;

          // create merged champion box in same shape as out entries
          const merged = { id: 'champ-merged-' + Date.now(), pxMinX: minX, pxMinY: minY, pxW: mergedW, pxH: mergedH };
          // compute model coords mapping (similar to earlier mapping)
          merged.minX = (merged.pxMinX / w) * STAGE_W; merged.minY = (merged.pxMinY / h) * STAGE_H;
          merged.width = (merged.pxW / w) * STAGE_W; merged.height = (merged.pxH / h) * STAGE_H;
          merged.cx = merged.minX + merged.width / 2; merged.cy = merged.minY + merged.height / 2;

          // replace champ with merged for downstream finalSlotsFixed creation
          console.table(beforeRows.concat([{ stage: 'after', id: merged.id, x: merged.pxMinX, y: merged.pxMinY, w: merged.pxW, h: merged.pxH }]));
          // overwrite champ reference
          champ.pxMinX = merged.pxMinX; champ.pxMinY = merged.pxMinY; champ.pxW = merged.pxW; champ.pxH = merged.pxH;
          champ.minX = merged.minX; champ.minY = merged.minY; champ.width = merged.width; champ.height = merged.height; champ.cx = merged.cx; champ.cy = merged.cy;
        }
      } catch (e) { console.warn('slot-detector: champ merge/expand failed', e); }

      // champ 的 px 座標（用 px 切才精準）
      // If stage is square (e.g., 800x800), disable PC-specific champion corrections
      const _st = (window.__wbc && window.__wbc.getStage && window.__wbc.getStage()) || { STAGE_W, STAGE_H };
      const _curW = _st.STAGE_W || STAGE_W;
      const _curH = _st.STAGE_H || STAGE_H;
      const isSquareStage = (Math.abs(_curW - _curH) <= 2) || (_curW === 800 && _curH === 800);
      const champWidthScaleLocal = isSquareStage ? 1 : CHAMPION_WIDTH_SCALE;
      const champWScaleLocal = isSquareStage ? 1 : CHAMPION_W_SCALE;

      const inX = champ.pxMinX;
      const inY = champ.pxMinY;
      const inW = champ.pxW;
      const inH = champ.pxH;

      const gapPx = Math.max(2, Math.round(inW * 0.08));
      const padPx = Math.max(6, Math.round(inW * 0.02));

      const contentX = inX + padPx;
      const contentY = inY + padPx;
      const contentW = Math.max(4, inW - padPx * 2);
      const contentH = Math.max(4, inH - padPx * 2);

      const leftW = Math.max(2, Math.floor((contentW - gapPx) / 2));
      const rightW = Math.max(2, contentW - gapPx - leftW);

      const slotL_px = { x: contentX, y: contentY, w: leftW, h: contentH };
      const slotR_px = { x: contentX + leftW + gapPx, y: contentY, w: rightW, h: contentH };

      // produce model slots from px mapping (these are the "before" values)
      const beforeL = pxToModelSlot('before-L', slotL_px, w, h);
      const beforeR = pxToModelSlot('before-R', slotR_px, w, h);

      // Champion-left: use left logic (keep px->model mapping), then normalize vertically only
      const championLeft = beforeL;
      championLeft.id = 'champion-left';
      normalizeChampionSlot(championLeft, champ, { imgW: w, imgH: h });

      // Champion-right: mirror the left slot across STAGE_W, allow small offset if needed
      const championRightOffsetX = 0; // tuneable small tweak, only for right slot
      const championRightOffsetY = 0;
      // mirror and then scale width to avoid overly wide mirrored slot
      const centerX_left = championLeft.minX + championLeft.width / 2;
      const desiredW = Math.max(2, Math.round(championLeft.width * champWidthScaleLocal));
      let minX_right = Math.round(STAGE_W - (centerX_left + championLeft.width / 2)) + championRightOffsetX; // initial mirror by centers
      // center-align to left's center
      minX_right = Math.round((STAGE_W - (centerX_left)) - desiredW / 2) + championRightOffsetX;
      minX_right = Math.max(0, Math.min(STAGE_W - desiredW, minX_right));
      const championRight = {
        id: 'champion-right',
        minX: minX_right,
        minY: championLeft.minY + championRightOffsetY,
        width: desiredW,
        height: championLeft.height
      };
      championRight.cx = championRight.minX + championRight.width / 2;
      championRight.cy = championRight.minY + championRight.height / 2;

      // shrink championLeft and championRight around their centers by CHAMPION_W_SCALE
      try {
        function shrinkCenter(slot) {
          const oldX = slot.minX; const oldW = slot.width;
          const newW = Math.max(2, Math.round(oldW * champWScaleLocal));
          const centerX = oldX + oldW / 2;
          const newX = Math.round(centerX - newW / 2);
          slot.minX = newX; slot.width = newW; slot.cx = slot.minX + slot.width / 2;
          return { oldX: Math.round(oldX), oldW: Math.round(oldW), newX: Math.round(newX), newW: Math.round(newW) };
        }
        const leftInfo = shrinkCenter(championLeft);
        const rightInfo = shrinkCenter(championRight);
        console.log('slot-detector: champion shrink left/right', { left: leftInfo, right: rightInfo });
      } catch (e) { console.warn('slot-detector: champion shrink failed', e); }

      // expose final fixed slots (only these two for champion)
      // adjust champion positions slightly to avoid overlap
      // nudge values scaled to stage width so alignment works for various sizes
      const leftNudge = isSquareStage ? 0 : Math.round(_curW * 0.013); // ~16px when STAGE_W=1200
      const rightNudge = isSquareStage ? 0 : Math.round(_curW * 0.055); // ~66px when STAGE_W=1200 — moved further right to align with right column
      championLeft.minX = Math.max(0, championLeft.minX - leftNudge);
      championRight.minX = Math.min(Math.max(0, championRight.minX + rightNudge), _curW - championRight.width);
      finalSlotsFixed.push(championLeft);
      finalSlotsFixed.push(championRight);

      // console.table: before vs after for left/right (px for before, model for after)
      try {
        console.table([
          { side: 'left', stage: 'before', x: beforeL.minX, y: beforeL.minY, w: beforeL.width, h: beforeL.height },
          { side: 'right', stage: 'before', x: beforeR.minX, y: beforeR.minY, w: beforeR.width, h: beforeR.height },
          { side: 'left', stage: 'after', x: championLeft.minX, y: championLeft.minY, w: championLeft.width, h: championLeft.height },
          { side: 'right', stage: 'after', x: championRight.minX, y: championRight.minY, w: championRight.width, h: championRight.height }
        ]);
      } catch (e) { console.warn('slot-detector: champ console.table failed', e); }

      // also debug champion px box and canvas rect for context
      try { console.log('slot-detector: champion px box', { pxMinX: champ.pxMinX, pxMinY: champ.pxMinY, pxW: champ.pxW, pxH: champ.pxH }); } catch (e) {}
      try { console.log('slot-detector: canvas/baseImage rect', canvasEl ? canvasEl.getBoundingClientRect() : null, baseImage ? baseImage.getBoundingClientRect() : null); } catch (e) {}
    }

    // helper: find largest connected component inside rect on a given mask
    function findLargestComponentInRect(mask, rx0, ry0, rx1, ry1) {
      const rw = rx1 - rx0 + 1; const rh = ry1 - ry0 + 1;
      const visitedLocal = new Uint8Array(w * h); // reuse full-size visited flags for simplicity
      let best = null;
      for (let yy = ry0; yy <= ry1; yy++) {
        for (let xx = rx0; xx <= rx1; xx++) {
          const ai = yy * w + xx;
          if (visitedLocal[ai] || !mask[ai]) continue;
          // BFS
          let minX = xx, maxX = xx, minY = yy, maxY = yy, count = 0;
          const stack = [ai]; visitedLocal[ai] = 1;
          while (stack.length) {
            const cur = stack.pop();
            const cx = cur % w; const cy = Math.floor(cur / w);
            count++;
            if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
            const nb = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
            for (const [nx, ny] of nb) {
              if (nx < rx0 || ny < ry0 || nx > rx1 || ny > ry1) continue;
              const ni = ny * w + nx;
              if (visitedLocal[ni]) continue;
              if (mask[ni]) { visitedLocal[ni] = 1; stack.push(ni); }
              else visitedLocal[ni] = 1;
            }
          }
          if (!best || count > best.count) best = { minX, minY, maxX, maxY, count };
        }
      }
      return best;
    }

    // For each bigBox, generate exactly two TB slots according to rules
    // FILTER OUT the champion box from normal processing
    const normalTargets = out.filter(b => !champ || (b.id !== champ.id));
    const normalSlots = [];
    for (let i = 0; i < normalTargets.length; i++) {
      const b = normalTargets[i];
      const matchId = 'match-' + i;

      // try detect inner container within bigBox using eroded mask; if not found, fallback to shrink
      const rx0 = Math.max(0, b.pxMinX); const ry0 = Math.max(0, b.pxMinY);
      const rx1 = Math.min(w - 1, b.pxMinX + b.pxW - 1); const ry1 = Math.min(h - 1, b.pxMinY + b.pxH - 1);
      let inner = findLargestComponentInRect(eroded, rx0, ry0, rx1, ry1);
      let inX, inY, inW, inH;
      if (inner && inner.count >= MIN_AREA) {
        // use inner bbox
        inX = inner.minX; inY = inner.minY; inW = inner.maxX - inner.minX + 1; inH = inner.maxY - inner.minY + 1;
      } else {
        // fallback: shrink bigBox by padding 6px
        const pad = 6;
        inX = rx0 + pad; inY = ry0 + pad;
        inW = Math.max(4, (rx1 - rx0 + 1) - pad * 2); inH = Math.max(4, (ry1 - ry0 + 1) - pad * 2);
      }

      // apply inner padding and compute content area
      const padL = 6, padT = 6, padR = 6, padB = 6;
      const gapLR = Math.max(2, Math.round(inW * 0.06));
      const gapTB = Math.max(2, Math.round(inH * 0.04));

      const contentX = inX + padL; const contentY = inY + padT;
      const contentW = Math.max(2, inW - (padL + padR));
      const contentH = Math.max(2, inH - (padT + padB));

      // normal: avoid the center date band when splitting TB (always use normal behavior)
      const bandCenterY = contentY + Math.floor(contentH * 0.5);
      const bandH = Math.max(4, Math.round(contentH * 0.18));
      const bandTop = Math.max(contentY, bandCenterY - Math.floor(bandH / 2));
      const bandBottom = Math.min(contentY + contentH, bandCenterY + Math.floor(bandH / 2));
      const topH = Math.max(2, bandTop - contentY);
      const bottomH = Math.max(2, (contentY + contentH) - bandBottom);
      const slotT_px = { x: contentX, y: contentY, w: contentW, h: topH };
      const slotB_px = { x: contentX, y: bandBottom, w: contentW, h: bottomH };
      const sT = pxToModelSlot(matchId + '-T', slotT_px, w, h);
      const sB = pxToModelSlot(matchId + '-B', slotB_px, w, h);
      normalSlots.push(sT, sB);
      console.log('slot-detector:', matchId, 'TB slots =', [sT.id, sB.id]);

      // safety check
      const produced = 2; // by design
      if (produced !== 2) { console.warn('slot-detector: match produced !=2 slots', matchId); }
    }

    // combine final fixed slots (if any) with normalSlots
    let combined = finalSlotsFixed.concat(normalSlots);
    // If we have a champion selected, enforce only championLeft/championRight remain inside the champion top band
    try {
      if (finalSlotsFixed && finalSlotsFixed.length >= 2) {
        // find champion left/right from finalSlotsFixed by id
        const champLeft = finalSlotsFixed.find(s => s.id === 'champion-left');
        const champRight = finalSlotsFixed.find(s => s.id === 'champion-right');
        if (champLeft && champRight) {
          // define champion band area in model coords
          const bandY = STAGE_H * 0.25;
          const bandX0 = STAGE_W * 0.15; const bandX1 = STAGE_W * 0.85;
          // filter out any slot that lies within champion band AND is not champLeft/champRight
          combined = combined.filter(s => {
            const centerX = (s.minX || 0) + (s.width || 0) / 2;
            const topY = (s.minY || 0);
            const withinBand = (topY < bandY) && (centerX >= bandX0 && centerX <= bandX1);
            if (withinBand && s.id !== 'champion-left' && s.id !== 'champion-right') return false;
            return true;
          });

          // ensure championLeft/championRight are present (replace any duplicates)
          combined = combined.filter(s => s.id !== 'champion-left' && s.id !== 'champion-right');
          combined = [champLeft, champRight].concat(combined);

          // final debug log: championLeft / championRight
          console.log('slot-detector: final champion slots:', {
            left: { id: champLeft.id, x: Math.round(champLeft.minX), y: Math.round(champLeft.minY), w: Math.round(champLeft.width), h: Math.round(champLeft.height) },
            right: { id: champRight.id, x: Math.round(champRight.minX), y: Math.round(champRight.minY), w: Math.round(champRight.width), h: Math.round(champRight.height) }
          });
        }
      }
    } catch (e) { console.warn('slot-detector: champion final filter failed', e); }
    const ids = combined.map(s => s.id);
    const dup = ids.filter((v, i, a) => a.indexOf(v) !== i);
    if (dup.length) console.warn('slot-detector: duplicate slot ids detected', dup);
    return combined;
  }

  // render overlay from slots array (model coords)
  function renderSlotOverlay(newSlots) {
    slots = newSlots || [];
    const layer = ensureSlotLayer();
    if (!layer) return;
    layer.innerHTML = '';
    // no pointer events unless enabled
    layer.style.pointerEvents = autoPlaceEnabled ? 'auto' : 'none';

    const st = (window.__wbc && window.__wbc.getStage && window.__wbc.getStage()) || { STAGE_W, STAGE_H, canvasEl, baseImage };
    canvasEl = canvasEl || st.canvasEl || document.getElementById('canvas');
    const rect = canvasEl.getBoundingClientRect();

    newSlots.forEach(s => {
      // map model bbox corners to display
      const p1 = (window.__wbc && window.__wbc.modelToDisplay) ? window.__wbc.modelToDisplay(s.minX, s.minY) : null;
      const p2 = (window.__wbc && window.__wbc.modelToDisplay) ? window.__wbc.modelToDisplay(s.minX + s.width, s.minY + s.height) : null;
      let left = 0, top = 0, w = 0, h = 0;
      if (p1 && p2) { left = Math.round(p1.dispX); top = Math.round(p1.dispY); w = Math.max(4, Math.round(p2.dispX - p1.dispX)); h = Math.max(4, Math.round(p2.dispY - p1.dispY)); }
      else {
        left = Math.round((s.minX / STAGE_W) * rect.width);
        top = Math.round((s.minY / STAGE_H) * rect.height);
        w = Math.max(4, Math.round((s.width / STAGE_W) * rect.width));
        h = Math.max(4, Math.round((s.height / STAGE_H) * rect.height));
      }

      const el = document.createElement('div');
      el.className = 'slot-box';
      el.dataset.slotId = s.id;
      el.dataset.modelCx = s.cx; el.dataset.modelCy = s.cy;
      Object.assign(el.style, { left: left + 'px', top: top + 'px', width: w + 'px', height: h + 'px', zIndex: 9999 });

      // click handler
      el.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        setSelectedSlot(s.id);
      });

      // hover visual only
      el.addEventListener('mouseenter', () => { if (!el.classList.contains('slot-selected')) el.style.opacity = '0.95'; });
      el.addEventListener('mouseleave', () => { if (!el.classList.contains('slot-selected')) el.style.opacity = '1'; });

      layer.appendChild(el);
    });

    // apply selected highlight if any
    updateSlotHighlight();
  }

  function updateSlotHighlight() {
    const layer = document.getElementById('slot-layer'); if (!layer) return;
    const children = Array.from(layer.children);
    children.forEach(ch => {
      if (ch.dataset && ch.dataset.slotId === selectedSlotId) ch.classList.add('slot-selected');
      else ch.classList.remove('slot-selected');
    });
  }

  function setSelectedSlot(id) {
    selectedSlotId = id;
    updateSlotHighlight();
  }

  // toggle auto place
  function setAutoPlace(on) {
    autoPlaceEnabled = !!on;
    const layer = ensureSlotLayer(); if (layer) layer.style.pointerEvents = autoPlaceEnabled ? 'auto' : 'none';
    const btn = document.getElementById('toggle-auto-place'); if (btn) btn.textContent = '自動放置：' + (autoPlaceEnabled ? 'ON' : 'OFF');
    if (!autoPlaceEnabled) { selectedSlotId = null; updateSlotHighlight(); }
  }

  // card click delegation: when enabled and a slot selected, click a list card to auto-place
  function onCardsClick(e) {
    if (!autoPlaceEnabled) return; // do nothing
    const cardEl = findCardElement(e.target);
    if (!cardEl) return;
    if (!selectedSlotId) return;
    e.preventDefault(); e.stopPropagation();

    // reconstruct item from card element
    const img = cardEl.querySelector('img');
    const name = (cardEl.innerText || '').trim();
    const item = { name: name, flag: img ? (img.src || '') : '', manual: img ? false : true };

    // find selected slot
    const s = slots.find(x => x.id === selectedSlotId);
    if (!s) return;
    // Use the slot's center (compute from minX/minY + width/height) for placement
    const targetModelX = Number(s.minX || 0) + Number(s.width || 0) / 2;
    const targetModelY = Number(s.minY || 0) + Number(s.height || 0) / 2;

    // convert to display coords using exposed API
    if (window.__wbc && window.__wbc.modelToDisplay) {
      const d = window.__wbc.modelToDisplay(targetModelX, targetModelY);
      try {
        console.log('slot-detector: placing into selectedSlotId=', selectedSlotId, 'display coords=', { x: d.dispX, y: d.dispY });
        window.__wbc.addPlacedCard(item, d.dispX, d.dispY);
      } catch (e) { console.warn('addPlacedCard failed', e); }
    }
    // after placing, clear selected slot so the next click won't reuse it
    selectedSlotId = null;
    updateSlotHighlight();
    console.log('slot-detector: placed item', name, 'into slot', s.id);

  }

  function findCardElement(node) {
    let cur = node;
    while (cur && cur !== document.body) {
      if (cur.parentElement && cur.parentElement.id === 'cards') return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  // base image change handler
  async function onBaseImageChanged() {
    // ensure refs
    const st = (window.__wbc && window.__wbc.getStage && window.__wbc.getStage()) || {};
    canvasEl = canvasEl || st.canvasEl || document.getElementById('canvas');
    baseImage = baseImage || st.baseImage || document.getElementById('base-image');
    if (!baseImage) return;
    // wait until image has intrinsic size
    if (!baseImage.naturalWidth) {
      // try again shortly
      setTimeout(onBaseImageChanged, 200);
      return;
    }
    // run detection
    const found = await detectColorBlocks(baseImage);
    slots = found;
    renderSlotOverlay(slots);
  }

  // init bindings
  function init() {
    // create layer
    ensureSlotLayer();
    // bind toggle button
    const btn = document.getElementById('toggle-auto-place');
    if (btn) { btn.addEventListener('click', () => setAutoPlace(!autoPlaceEnabled)); }

    // card click delegation
    const cards = document.getElementById('cards');
    if (cards) { cards.addEventListener('click', onCardsClick, true); }

    // listen to base image changes
    window.addEventListener('wbc:baseImageChanged', onBaseImageChanged);

    // initial attempt
    document.addEventListener('DOMContentLoaded', () => {
      // small timeout to allow main.js to initialize
      setTimeout(() => {
        try { const st = window.__wbc && window.__wbc.getStage && window.__wbc.getStage(); if (st) { canvasEl = st.canvasEl; baseImage = st.baseImage; STAGE_W = st.STAGE_W || STAGE_W; STAGE_H = st.STAGE_H || STAGE_H; } } catch (e) { }
        if (baseImage && baseImage.naturalWidth) onBaseImageChanged();
      }, 150);
    });
  }

  // start now
  init();

})();
