// Animatic, an internal quick-mode template made by pre-production (lib/productions.mjs): each scene is one shot's
// storyboard frame (an SVG sketch, with the real product photo placed into its box), held for the shot's length while
// the camera move written on the board is suggested, its on-screen text in a lower third and its label in the corner.
// Cuts are hard, as in an edit; narration and music come from the usual quick pipeline.
// A rough cut is the same film with real video: a scene with a clip (a chosen take, WebM) plays it, seeked to each frame,
// and the slate goes, since it's no longer a storyboard.
import { boot, fit, seg, sceneAt, drawPhoto, drawLogo } from './runtime.js';

let ctx, W, H, S, tl, cues, portrait, BOARDS = [], MEDIA = [], LOGO = null, CUT = false;
let FD = 'Inter', FB = 'Inter', ACCENT = '#0a84ff';
const F = (w, s, face = FB) => `${w} ${s}px ${face}`;
const MONO = s => `500 ${s}px "JetBrains Mono"`;
const ease = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// the move a board asks for, as zoom and offset (fractions of the frame) from the shot's progress q
function camera(move, q, t) {
  const e = ease(q);
  switch (move) {
    case 'Push in': return [1 + 0.1 * e, 0, 0];
    case 'Pull out': return [1.1 - 0.1 * e, 0, 0];
    case 'Pan left': return [1.08, -0.035 + 0.07 * e, 0];
    case 'Pan right': return [1.08, 0.035 - 0.07 * e, 0];
    case 'Tilt up': return [1.08, 0, -0.035 + 0.07 * e];
    case 'Tilt down': return [1.08, 0, 0.035 - 0.07 * e];
    case 'Tracking': return [1.1, 0.045 - 0.09 * e, 0];
    case 'Orbit': return [1.06 + 0.03 * e, 0.03 - 0.06 * e, 0];
    case 'Crane up': return [1.1 - 0.06 * e, 0, -0.03 + 0.06 * e];
    case 'Handheld': return [1.05, 0.006 * Math.sin(t * 2.3) + 0.004 * Math.sin(t * 5.1), 0.005 * Math.sin(t * 1.7 + 1)];
    default: return [1.0, 0, 0];
  }
}

function pill(text, x, y, size, align = 'left') {
  ctx.font = MONO(size);
  ctx.letterSpacing = 0.08 * size + 'px';
  const w = ctx.measureText(text).width, pad = size * 0.7, h = size * 2;
  const x0 = align === 'right' ? x - w - pad * 2 : x;
  ctx.fillStyle = 'rgba(16,18,22,0.72)';
  ctx.beginPath();
  ctx.roundRect(x0, y, w + pad * 2, h, h / 2);
  ctx.fill();
  ctx.fillStyle = '#f2f4f8';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x0 + pad, y + h / 2);
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = '0px';
}

// move a clip to time t and wait until that frame can be drawn
const seek = (v, t) => new Promise(res => {
  if (Math.abs(v.currentTime - t) < 1e-3 && v.readyState >= 2) return res();
  v.addEventListener('seeked', res, { once: true });
  v.currentTime = t;
});

async function draw(t) {
  const s = sceneAt(tl, t), lt = t - s.t0, q = s.dur ? Math.min(1, lt / s.dur) : 0;
  const b = BOARDS[s.i];
  // a held last frame when the scene runs longer than its clip
  if (b?.video) await seek(b.video, Math.min(lt, b.dur - 1 / 48));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = b?.video ? '#000' : '#fbfaf7';
  ctx.fillRect(0, 0, W, H);
  const [z, ox, oy] = b?.video ? [1, 0, 0] : camera(s.move, q, t);
  ctx.save();
  ctx.translate(W / 2 + ox * W, H / 2 + oy * H);
  ctx.scale(z, z);
  ctx.translate(-W / 2, -H / 2);
  if (b?.video) {
    // the clip covers the frame (it is made at the film's aspect; any difference is cropped, not squeezed)
    const k = Math.max(W / b.vw, H / b.vh);
    ctx.drawImage(b.video, (W - b.vw * k) / 2, (H - b.vh * k) / 2, b.vw * k, b.vh * k);
  } else if (b) {
    ctx.drawImage(b.src, 0, 0, W, H);
    const m = MEDIA[s.image];
    if (m && s.box) { const k = W / b.w; drawPhoto(ctx, m, s.box.x * k, s.box.y * k, s.box.w * k, s.box.h * k, { fit: 'cover', radius: 6 * S }); }
  } else {
    ctx.fillStyle = '#9a9a9a';
    ctx.font = F(500, 34 * S);
    ctx.textAlign = 'center';
    ctx.fillText('Frame not drawn yet', W / 2, H / 2);
    ctx.textAlign = 'left';
  }
  ctx.restore();
  // the slate: shot number, size and move, and where we are in the cut
  const m = 28 * S;
  if (!CUT) pill(`SHOT ${String(s.n || s.i + 1).padStart(2, '0')}  ${String(s.size || '').toUpperCase()} · ${String(s.move || '').toUpperCase()}`, m, m, 17 * S);
  if (!CUT) pill(`${lt.toFixed(1)} / ${s.dur.toFixed(1)} s`, W - m, m, 17 * S, 'right');
  // on-screen text, as it would be supered: a lower third sized to its words, moved to the top when the shot shows the product
  if (s.text) {
    const a = Math.min(1, seg(lt, 0.1, 0.35)), mx = (portrait ? 64 : 96) * S, maxW = W - 2 * mx;
    if (!s.L) {
      s.L = fit(ctx, s.text, z => F(700, z, FD), maxW - 68 * S, 2, (portrait ? 54 : 46) * S, 24 * S, -0.01);
      ctx.font = F(700, s.L.size, FD);
      ctx.letterSpacing = -0.01 * s.L.size + 'px';
      s.L.w = Math.min(maxW, Math.max(...s.L.lines.map(l => ctx.measureText(l).width)) + 68 * S);
      ctx.letterSpacing = '0px';
    }
    const { size, lines, w } = s.L, bh = lines.length * size * 1.15 + 40 * S, by = s.box ? 96 * S : H * (portrait ? 0.7 : 0.66);
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(16,18,22,0.78)';
    ctx.beginPath();
    ctx.roundRect(mx, by, w, bh, 14 * S);
    ctx.fill();
    ctx.fillStyle = ACCENT;
    ctx.fillRect(mx, by + 16 * S, 6 * S, bh - 32 * S);
    ctx.fillStyle = '#ffffff';
    ctx.font = F(700, size, FD);
    ctx.letterSpacing = -0.01 * size + 'px';
    lines.forEach((line, k) => ctx.fillText(line, mx + 34 * S, by + 20 * S + size * 0.9 + k * size * 1.15));
    ctx.letterSpacing = '0px';
    ctx.globalAlpha = 1;
  }
  caption(t);
  if (LOGO && s.engine === 'code' && s.i === tl.scenes.length - 1) drawLogo(ctx, LOGO, W / 2, H * 0.12, 70 * S, 360 * S, 'center', seg(lt, 0.2, 0.6));
}

// the spoken line, at the foot of the frame
function caption(t) {
  const c = cues.find(c => t >= c.t0 && t < c.t1);
  if (!c) return;
  const w = W * (portrait ? 0.86 : 0.7);
  if (!c.L) c.L = fit(ctx, c.text, z => F(500, z), w - 48 * S, 2, 30 * S, 18 * S);
  const { size, lines } = c.L, bh = lines.length * size * 1.25 + 26 * S, by = H - bh - 36 * S;
  ctx.fillStyle = 'rgba(16,18,22,0.72)';
  ctx.beginPath();
  ctx.roundRect(W / 2 - w / 2, by, w, bh, bh / 2.4);
  ctx.fill();
  ctx.fillStyle = '#f2f4f8';
  ctx.font = F(500, size);
  ctx.textAlign = 'center';
  lines.forEach((line, k) => ctx.fillText(line, W / 2, by + 13 * S + size * 0.95 + k * size * 1.25));
  ctx.textAlign = 'left';
}

boot({
  fonts: ['700 100px Inter', '500 100px Inter', '500 20px "JetBrains Mono"'],
  // the boards, one after another (a render runs several pages at once, so memory is shared); a sketch (SVG) is
  // rasterised once at a little over frame size so the camera moves stay sharp, a generated frame is used as it is.
  // A board that will not load fails the render rather than leaving a gap in the cut.
  async load(content, { W, H }) {
    const decode = async src => {
      for (let k = 0; ; k++) {
        const img = new Image();
        img.src = src;
        try { await img.decode(); return img; }
        catch { if (k === 2) throw new Error('could not load ' + src); await new Promise(r => setTimeout(r, 400 * (k + 1))); }
      }
    };
    const out = [];
    for (const s of content.scenes) {
      if (s.clip) {
        // the clip in memory (a blob), so seeking never waits on the network
        const blob = await (await fetch(s.clip)).blob(), v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.preload = 'auto';
        v.src = URL.createObjectURL(blob);
        await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('could not load ' + s.clip)); });
        out.push({ video: v, vw: v.videoWidth, vh: v.videoHeight, dur: v.duration || s.clipDur || s.dur });
        continue;
      }
      if (!s.board) { out.push(null); continue; }
      const img = await decode(s.board);
      if (!/\.svg$/i.test(s.board)) { out.push({ src: img, w: img.naturalWidth }); continue; }
      const c = document.createElement('canvas');
      c.width = Math.round(W * 1.15);
      c.height = Math.round(H * 1.15);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      out.push({ src: c, w: img.naturalWidth || (H > W ? 900 : 1600) });
    }
    return out;
  },
  setup(o) {
    ({ ctx, W, H, tl, cues } = o);
    S = Math.min(W, H) / 1080;
    portrait = H > W * 1.1;
    BOARDS = o.assets || [];
    CUT = BOARDS.some(b => b?.video);
    MEDIA = (o.media || []).filter(Boolean);
    const b = o.brand;
    if (b) {
      if (b.display) FD = `${b.display.family}, Inter`;
      if (b.body) FB = `${b.body.family}, Inter`;
      ACCENT = b.colors?.accent || ACCENT;
      LOGO = b.logo;
    }
  },
  events: () => [],
  draw,
});
