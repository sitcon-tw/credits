// The dot-matrix board at the top of the page, ported from the superfile website footer.
// Every cell is a dot. Lettering dots are paper-coloured and sized by how much of the cell the
// letter covers; the rest are faint. "Energy" (0 to 1) makes a dot larger and orange: now and then
// a random dot of the lettering lights up and fades, and the pointer leaves a patch that fades too.
// Purely decorative: the board is aria-hidden and has no effect on the index itself.

const TEXT = 'SITCON';
const FONT_FAMILY = '"IBM Plex Mono", ui-monospace, monospace';
const LETTER_COLS = 96; // the lettering spans the content column in this many cells
const LETTER_ROWS = 22; // must match --board-rows / --board-cols in styles.css
const PAD_ROWS = 2; // empty rows above and below the lettering

const INK = [239, 232, 221]; // term-ink
const DIM = [78, 88, 99]; // term-line
const HOT = [119, 181, 90]; // SITCON green (#77b55a)
const LOGO = HOT; // logo dots rest in SITCON green and spark to paper
const RADIUS = [0.09, 0.2, 0.31, 0.4]; // dot radius per coverage level, in cells
const DENSITY = 1.5; // canvas pixels per CSS pixel, at most
const SPARK_EVERY = 110; // a new lettering dot lights up this often, in milliseconds
const FADE_TAKES = 1400; // and takes this long to go back to paper
const STEP = 60; // the fade moves this often, in milliseconds
const POINTER_STEP = 30; // and this often while the pointer is drawing on the board
const POINTER_REACH = 4.5; // how far the pointer's glow spreads, in cells

const mix = (from, to, t) => `rgb(${from.map((value, i) => Math.round(value + (to[i] - value) * t)).join(',')})`;

// The SITCON logo (from the official logo SVG), drawn into the board left of the lettering.
const LOGO_VIEWBOX = { x: 491, y: 145.3, width: 193.6, height: 261.6 };
const LOGO_PATHS = [
  'm617.4 172.2c12.9-9.9 28.3-6.2 28.3-6.2s-2.6 18.3-15.5 28.2-31.4 7.5-31.4 7.5 4-6 8-13.9c2.4-4.6 5.8-12 10.6-15.6z',
  'm586.3 187.1c-6-4.6-13.2-2.9-13.2-2.9s1.2 8.6 7.2 13.2 14.6 3.5 14.6 3.5-1.9-2.8-3.7-6.5c-1.1-2.2-2.7-5.6-4.9-7.3z',
  'm587.8 230.8c1.8 0 3.5 0.1 5.3 0.2-1.6-9.4-1.3-19.1 3.6-27.5-8.5 6.8-12.6 17.2-14.7 27.6 1.9-0.2 3.8-0.3 5.8-0.3z',
  'm587.8 233.9c-42.4 0-76.8 34.3-76.8 76.5 0 42.3 34.4 76.5 76.8 76.5s76.8-34.3 76.8-76.5c-0.1-42.2-34.4-76.5-76.8-76.5zm31.3 107.8-31.4-21.5-31.4 21.5 21.6-31.3-21.6-31.3 31.4 21.5 31.4-21.5-21.6 31.3z',
];
const LOGO_GAP_COLS = 4; // empty columns between the logo and the lettering

// Draws one layer on an offscreen canvas and samples it onto the cell grid: each cell gets
// 0 (none), 1 (a little), 2 (most) or 3 (all) by how much of it the drawing covers.
function sampleLayer(draw) {
  const sample = 12; // pixels per cell while sampling
  const canvas = document.createElement('canvas');
  canvas.width = LETTER_COLS * sample;
  canvas.height = LETTER_ROWS * sample;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#000';
  draw(context, sample);

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const rows = [];
  for (let row = 0; row < LETTER_ROWS; row++) {
    const line = [];
    for (let col = 0; col < LETTER_COLS; col++) {
      let sum = 0;
      for (let y = row * sample; y < (row + 1) * sample; y++) {
        for (let x = col * sample; x < (col + 1) * sample; x++) {
          sum += data[(y * canvas.width + x) * 4 + 3];
        }
      }
      const covered = sum / (255 * sample * sample);
      line.push(covered > 0.85 ? 3 : covered > 0.45 ? 2 : covered > 0.08 ? 1 : 0);
    }
    rows.push(line);
  }
  return rows;
}

// The logo is as tall as the space between the padding rows; TEXT fills the rest of the width,
// bottom-aligned with the logo.
function sampleLettering() {
  const inkRows = LETTER_ROWS - PAD_ROWS * 2;
  const logoScale = inkRows / LOGO_VIEWBOX.height; // cells per logo unit
  const logoCols = Math.ceil(LOGO_VIEWBOX.width * logoScale);
  const bottomRow = LETTER_ROWS - PAD_ROWS;

  const logo = sampleLayer((context, sample) => {
    context.translate(0, PAD_ROWS * sample);
    context.scale(logoScale * sample, logoScale * sample);
    context.translate(-LOGO_VIEWBOX.x, -LOGO_VIEWBOX.y);
    for (const data of LOGO_PATHS) {
      context.fill(new Path2D(data));
    }
  });

  const text = sampleLayer((context, sample) => {
    const left = (logoCols + LOGO_GAP_COLS) * sample;
    context.font = `700 100px ${FONT_FAMILY}`;
    const probe = context.measureText(TEXT);
    const inkWidth = probe.actualBoundingBoxLeft + probe.actualBoundingBoxRight;
    const inkHeight = probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent;
    const scale = Math.min((LETTER_COLS * sample - left) / inkWidth, (inkRows * sample) / inkHeight);
    context.font = `700 ${100 * scale}px ${FONT_FAMILY}`;
    const baseline = bottomRow * sample - probe.actualBoundingBoxDescent * scale;
    context.fillText(TEXT, left + probe.actualBoundingBoxLeft * scale, baseline);
  });

  return { text, logo };
}

export function mountBoard(board) {
  const canvas = board.querySelector('canvas');
  const column = board.querySelector('.board-column');
  const context = canvas.getContext('2d');
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  let lettering = { text: [], logo: [] };

  let ratio = 1; // canvas pixels per CSS pixel
  let cell = 1; // one cell, in CSS pixels
  let originX = 0; // where column 0 starts; it may be off the left edge
  let colCount = 0;
  let rowCount = 0;
  let coverage = []; // per cell, 0 to 3
  let isLogo = []; // per cell, whether it belongs to the logo
  let letterCells = []; // the cells that belong to the lettering
  let glow = new Float32Array(0); // per cell, the energy left
  const lit = new Set(); // the cells with energy left: the only ones a step repaints

  let visible = false;
  let moved = false;
  let timer = 0;
  let last = 0;
  let nextSpark = 0;

  // The lettering is exactly as wide as the page's content column. The faint dots carry on to both edges.
  function layout() {
    const style = getComputedStyle(column);
    const left = column.offsetLeft + parseFloat(style.paddingLeft);
    const width = column.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    cell = width / LETTER_COLS;
    const colsBefore = Math.ceil(left / cell);
    originX = left - colsBefore * cell;
    colCount = colsBefore + LETTER_COLS + Math.ceil((canvas.clientWidth - left - width) / cell);
    rowCount = Math.max(LETTER_ROWS, Math.round(canvas.clientHeight / cell));
    const rowsAbove = Math.round(column.offsetTop / cell); // the lettering sits where the content column is
    coverage = [];
    isLogo = [];
    for (let row = 0; row < rowCount; row++) {
      const textLine = lettering.text[row - rowsAbove];
      const logoLine = lettering.logo[row - rowsAbove];
      for (let col = 0; col < colCount; col++) {
        const textLevel = textLine?.[col - colsBefore] ?? 0;
        const logoLevel = logoLine?.[col - colsBefore] ?? 0;
        coverage.push(Math.max(textLevel, logoLevel));
        isLogo.push(logoLevel > textLevel);
      }
    }
    letterCells = coverage.flatMap((value, index) => (value >= 2 ? [index] : []));
    glow = new Float32Array(coverage.length);
    lit.clear();
  }

  const showing = () => visible && !document.hidden;

  const radius = (index) => RADIUS[coverage[index]] + glow[index] * (coverage[index] ? 0.06 : 0.14);

  function dot(index) {
    const size = cell * ratio;
    const col = index % colCount;
    const level = coverage[index];
    const energy = glow[index];
    context.fillStyle = !level ? mix(DIM, HOT, energy) : isLogo[index] ? mix(LOGO, INK, energy) : mix(INK, HOT, energy);
    context.globalAlpha = level ? 1 : 0.4 + energy * 0.6;
    context.beginPath();
    context.arc(originX * ratio + (col + 0.5) * size, ((index - col) / colCount + 0.5) * size, radius(index) * size, 0, Math.PI * 2);
    context.fill();
  }

  // Paints one cell again, clearing a pixel past its edges and redrawing neighbours that reach into it.
  function repaint(index) {
    const size = cell * ratio;
    const col = index % colCount;
    const row = (index - col) / colCount;
    const x = Math.floor(originX * ratio + col * size) - 1;
    const y = Math.floor(row * size) - 1;
    const width = Math.ceil(originX * ratio + (col + 1) * size) + 1 - x;
    const height = Math.ceil((row + 1) * size) + 1 - y;
    context.save();
    context.beginPath();
    context.rect(x, y, width, height);
    context.clip();
    context.clearRect(x, y, width, height);
    for (let r = Math.max(0, row - 1); r <= Math.min(rowCount - 1, row + 1); r++) {
      for (let c = Math.max(0, col - 1); c <= Math.min(colCount - 1, col + 1); c++) {
        const other = r * colCount + c;
        if (other === index || radius(other) > 0.5 - 3.5 / size) {
          dot(other);
        }
      }
    }
    context.restore();
  }

  function resize() {
    if (!canvas.clientWidth || !canvas.clientHeight) {
      return;
    }
    const density = Math.min(window.devicePixelRatio || 1, DENSITY);
    canvas.width = Math.round(canvas.clientWidth * density);
    canvas.height = Math.round(canvas.clientHeight * density);
    ratio = canvas.width / canvas.clientWidth;
    layout();
    for (let index = 0; index < coverage.length; index++) {
      dot(index);
    }
  }

  function step() {
    const now = performance.now();
    const elapsed = Math.min(STEP, now - last);
    last = now;
    for (const index of lit) {
      glow[index] = Math.max(0, glow[index] - elapsed / FADE_TAKES);
    }
    if (!calm.matches && now >= nextSpark && letterCells.length) {
      const index = letterCells[Math.floor(Math.random() * letterCells.length)];
      glow[index] = 1;
      lit.add(index);
      nextSpark = Math.max(nextSpark, now - STEP) + SPARK_EVERY * (0.5 + Math.random());
    }
    for (const index of lit) {
      repaint(index);
      if (!glow[index]) {
        lit.delete(index);
      }
    }
    timer = showing() && (lit.size || !calm.matches) ? window.setTimeout(step, moved ? POINTER_STEP : STEP) : 0;
    moved = false;
  }

  function run() {
    if (timer || !showing()) {
      return;
    }
    last = performance.now();
    timer = window.setTimeout(step);
  }

  board.addEventListener('pointermove', (event) => {
    const box = canvas.getBoundingClientRect();
    const x = (event.clientX - box.left - originX) / cell;
    const y = (event.clientY - box.top) / cell;
    for (let row = Math.max(0, Math.floor(y - POINTER_REACH)); row <= Math.min(rowCount - 1, Math.ceil(y + POINTER_REACH)); row++) {
      for (let col = Math.max(0, Math.floor(x - POINTER_REACH)); col <= Math.min(colCount - 1, Math.ceil(x + POINTER_REACH)); col++) {
        const near = 1 - Math.hypot(col + 0.5 - x, row + 0.5 - y) / POINTER_REACH;
        const index = row * colCount + col;
        if (near > glow[index]) {
          glow[index] = near;
          lit.add(index);
          moved = true;
        }
      }
    }
    run();
  });

  // Sample the lettering once the bold mono face is ready (or failed to load), then start drawing.
  const fontReady = document.fonts?.load ? document.fonts.load(`700 100px ${FONT_FAMILY}`).catch(() => null) : Promise.resolve();
  fontReady.then(() => {
    lettering = sampleLettering();
    resize();
    new ResizeObserver(resize).observe(canvas);
    document.addEventListener('visibilitychange', run);
    new IntersectionObserver((entries) => {
      visible = entries.at(-1).isIntersecting;
      run();
    }).observe(canvas);
  });
}

const board = document.querySelector('[data-board]');
if (board) {
  mountBoard(board);
}
