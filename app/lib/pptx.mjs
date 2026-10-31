// Editable PowerPoint from a deck: the shared layout engine's elements become native text boxes, shapes and charts.
import PptxGenJS from 'pptxgenjs';
import { layoutSlide, W, H } from '../public/js/deck-render.js';

const IN = px => px / 96;          // the 1280×720 canvas maps onto a 13.33×7.5 in widescreen slide
const PT = px => +(px * 0.75).toFixed(1);
const hex = c => String(c || '#000000').replace('#', '').toUpperCase();

// theme: deck theme; logo: { data: 'image/png;base64,…', w, h } already rasterised, or null
export async function writePptx(deck, theme, { proof = {}, logo = null, file, draft = false }) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = deck.title || 'Deck';
  pptx.company = theme.name || '';
  const face = { display: theme.fonts.display, body: theme.fonts.body, mono: theme.fonts.body };

  deck.slides.forEach((slide, index) => {
    const s = pptx.addSlide();
    const els = layoutSlide(slide, theme, { index, proof, draft });
    // the first full-bleed rectangle is the slide background
    if (els[0]?.type === 'rect' && els[0].w >= W && els[0].h >= H) s.background = { color: hex(els.shift().fill) };
    for (const e of els) {
      const box = { x: IN(e.x), y: IN(e.y), w: IN(e.w), h: IN(e.h) };
      if (e.type === 'rect') {
        const round = e.radius > 0, circle = round && e.radius * 2 >= Math.min(e.w, e.h) - 1;
        s.addShape(circle ? pptx.ShapeType.ellipse : round ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
          ...box, fill: e.fill ? { color: hex(e.fill) } : { type: 'none' },
          line: e.line ? { color: hex(e.line), width: (e.lineWidth || 1) * 0.75 } : { type: 'none' },
          ...(round && !circle ? { rectRadius: IN(e.radius) } : {}),
        });
      } else if (e.type === 'text') {
        const base = { fontFace: face[e.font], fontSize: PT(e.size), bold: e.weight >= 600, color: hex(e.color), align: e.align, valign: e.valign,
          lineSpacingMultiple: e.lh, margin: 0, charSpacing: e.spacing ? +(e.spacing * PT(e.size)).toFixed(1) : undefined, fit: 'none' };
        if (e.bullets) {
          s.addText(e.bullets.map(b => ({ text: b, options: { bullet: { characterCode: '25CF', indent: PT(e.size) * 1.1 }, paraSpaceAfter: PT(e.size) * 0.6, breakLine: true } })), { ...box, ...base });
        } else if (e.text) s.addText(e.text, { ...box, ...base });
      } else if (e.type === 'image' && logo) {
        // fit the logo inside the box, aligned left like the preview
        const r = logo.w / logo.h;
        let w = e.w, hgt = e.w / r;
        if (hgt > e.h) { hgt = e.h; w = hgt * r; }
        s.addImage({ data: logo.data, x: IN(e.x), y: IN(e.y + (e.h - hgt) / 2), w: IN(w), h: IN(hgt) });
      } else if (e.type === 'chart') addChart(pptx, s, e, box, face);
    }
    if (slide.notes) s.addNotes(slide.notes);
  });
  await pptx.writeFile({ fileName: file });
  return file;
}

function addChart(pptx, s, e, box, face) {
  const ch = e.chart, cats = ch.categories || [];
  const series = (ch.series || []).filter(sr => Array.isArray(sr.values) && sr.values.length);
  if (!series.length || !cats.length) return;
  const data = series.map(sr => ({ name: sr.name || '', labels: cats, values: sr.values.map(Number) }));
  const unit = ch.unit || '', fmt = unit === '%' ? '0.##"%"' : unit ? `#,##0.##"${unit.replace(/"/g, '')}"` : '#,##0.##';
  const common = {
    ...box, chartColors: e.colors.map(hex), showLegend: series.length > 1 || ch.type === 'donut', legendPos: ch.type === 'donut' ? 'r' : 't',
    legendFontFace: face.body, legendFontSize: 11, legendColor: hex(e.ink),
  };
  if (ch.type === 'donut') {
    s.addChart(pptx.ChartType.doughnut, data.slice(0, 1), { ...common, holeSize: 60, showPercent: false, showValue: true, dataLabelColor: 'FFFFFF', dataLabelFontSize: 11, dataLabelFormatCode: fmt });
    return;
  }
  const axes = {
    catAxisLabelColor: hex(e.muted), catAxisLabelFontFace: face.body, catAxisLabelFontSize: 11, catAxisLineShow: false,
    valAxisLabelColor: hex(e.muted), valAxisLabelFontFace: face.body, valAxisLabelFontSize: 10, valAxisLabelFormatCode: fmt, valAxisLineShow: false,
    valGridLine: { color: hex(e.grid), size: 0.75 }, catGridLine: { style: 'none' },
  };
  if (ch.type === 'line') {
    s.addChart(pptx.ChartType.line, data, { ...common, ...axes, lineSize: 3, lineDataSymbol: 'circle', lineDataSymbolSize: 7 });
  } else {
    s.addChart(pptx.ChartType.bar, data, { ...common, ...axes, barDir: ch.type === 'bar' ? 'bar' : 'col', barGapWidthPct: 60,
      showValue: series.length === 1, dataLabelColor: hex(e.ink), dataLabelFontSize: 11, dataLabelFontFace: face.body, dataLabelFormatCode: fmt, dataLabelPosition: 'outEnd' });
  }
}
