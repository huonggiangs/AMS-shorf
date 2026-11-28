// PDF bao cao luot xem (A4) cho khach hang: pdf-lib + Be Vietnam Pro nhung san (cung font/logo mo cheo nhu hop dong, xem contracts-doc/pdf.ts).
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import type { PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { BE_VIETNAM_PRO_BOLD_B64, BE_VIETNAM_PRO_REGULAR_B64 } from '../contracts-doc/fonts.gen.js';
import { WATERMARK_ANGLE, WATERMARK_OPACITY, rotatedOrigin } from '../contracts-doc/pdf.js';
import type { ReportData } from './views-report.js';
import type { ItemsReport } from './items-report.js';

const W = 595.28;
const H = 841.89;
const ML = 48;
const MR = 48;
const CW = W - ML - MR;
const INK = rgb(0.08, 0.08, 0.1);
const GREY = rgb(0.4, 0.4, 0.45);
const LINE = rgb(0.85, 0.87, 0.9);
const HEADBG = rgb(0.94, 0.96, 0.98);

const b64 = (s: string): Uint8Array => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const fmtN = (n: number): string => n.toLocaleString('vi-VN');
const dur = (s: number): string => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} giờ ${m} phút` : m > 0 ? `${m} phút ${s % 60} giây` : `${s} giây`;
};

export async function renderViewsPdf(d: ReportData, o: { external: boolean; logo: { bytes: Uint8Array; type: 'png' | 'jpg' } | null }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const reg = await doc.embedFont(b64(BE_VIETNAM_PRO_REGULAR_B64), { subset: true });
  const bold = await doc.embedFont(b64(BE_VIETNAM_PRO_BOLD_B64), { subset: true });
  let logo: PDFImage | null = null;
  if (o.logo) logo = o.logo.type === 'png' ? await doc.embedPng(o.logo.bytes).catch(() => null) : await doc.embedJpg(o.logo.bytes).catch(() => null);
  doc.setTitle('Báo cáo lượt xem quảng cáo');
  doc.setProducer('AMS');
  doc.setCreationDate(new Date(d.generated_at));

  let page!: PDFPage;
  let y = 0;
  const watermark = (p: PDFPage): void => {
    const cx = W / 2;
    const cy = H / 2;
    if (logo) {
      const s = Math.min((W * 0.66) / logo.width, (H * 0.4) / logo.height);
      const w = logo.width * s;
      const h = logo.height * s;
      const org = rotatedOrigin(cx, cy, w, h, WATERMARK_ANGLE);
      p.drawImage(logo, { x: org.x, y: org.y, width: w, height: h, rotate: degrees(WATERMARK_ANGLE), opacity: WATERMARK_OPACITY });
      return;
    }
    const size = (W * 0.62) / bold.widthOfTextAtSize('ANIO', 1);
    const w = bold.widthOfTextAtSize('ANIO', size);
    const h = bold.heightAtSize(size, { descender: false });
    const org = rotatedOrigin(cx, cy, w, h, WATERMARK_ANGLE);
    p.drawText('ANIO', { x: org.x, y: org.y, size, font: bold, color: rgb(0.1, 0.25, 0.45), rotate: degrees(WATERMARK_ANGLE), opacity: WATERMARK_OPACITY });
  };
  const newPage = (): void => {
    page = doc.addPage([W, H]);
    watermark(page); // truoc tien: nam duoi chu
    y = H - 56;
  };
  const fit = (t: string, f: PDFFont, size: number, max: number): string => {
    if (f.widthOfTextAtSize(t, size) <= max) return t;
    let s = t;
    while (s.length > 1 && f.widthOfTextAtSize(s + '…', size) > max) s = s.slice(0, -1);
    return s + '…';
  };
  const ensure = (h: number): void => {
    if (y - h < 56) newPage();
  };
  const text = (t: string, x: number, size: number, f: PDFFont = reg, color = INK): void => void page.drawText(t, { x, y, size, font: f, color });

  newPage();
  text('BÁO CÁO LƯỢT XEM QUẢNG CÁO', ML, 17, bold);
  y -= 20;
  const who = d.scope.customer ? `Khách hàng: ${d.scope.customer.name}   ·   ` : '';
  text(fit(`${who}Từ ${d.range.from} đến ${d.range.to} (giờ Việt Nam)`, reg, 10, CW), ML, 10, reg, GREY);
  y -= 14;
  text(`Xuất lúc ${d.generated_at.slice(0, 16).replace('T', ' ')} UTC`, ML, 9, reg, GREY);
  y -= 26;

  // KPI
  const kpis: [string, string][] = [
    ['Tổng lượt xem', fmtN(d.totals.views)],
    ['Tổng thời lượng phát', dur(d.totals.watched_s)],
    ['Chiến dịch', fmtN(d.totals.campaigns)],
    [o.external ? 'Địa điểm' : 'Thiết bị', fmtN(o.external ? d.totals.locations : d.totals.devices)],
  ];
  const kw = (CW - 3 * 8) / 4;
  kpis.forEach(([label, val], i) => {
    const x = ML + i * (kw + 8);
    page.drawRectangle({ x, y: y - 38, width: kw, height: 46, borderColor: LINE, borderWidth: 0.8, color: rgb(1, 1, 1), opacity: 0.85 });
    page.drawText(label, { x: x + 8, y: y - 6, size: 8, font: reg, color: GREY });
    page.drawText(fit(val, bold, 13, kw - 14), { x: x + 8, y: y - 26, size: 13, font: bold, color: INK });
  });
  y -= 62;
  text(`Hôm nay: ${fmtN(d.windows.today)}   ·   7 ngày: ${fmtN(d.windows.d7)}   ·   30 ngày: ${fmtN(d.windows.d30)} lượt xem`, ML, 9.5, reg, GREY);
  y -= 22;

  const table = (title: string, head: string[], widths: number[], rows: string[][]): void => {
    if (!rows.length) return;
    ensure(60);
    text(title, ML, 11.5, bold);
    y -= 8;
    const row = (cells: string[], f: PDFFont, bg?: ReturnType<typeof rgb>): void => {
      ensure(18);
      if (bg) page.drawRectangle({ x: ML, y: y - 14, width: CW, height: 17, color: bg });
      let x = ML;
      cells.forEach((cell, i) => {
        const w = widths[i]! * CW;
        const right = i >= cells.length - 2;
        const t = fit(cell, f, 9, w - 8);
        page.drawText(t, { x: right ? x + w - 4 - f.widthOfTextAtSize(t, 9) : x + 4, y: y - 10, size: 9, font: f, color: INK });
        x += w;
      });
      page.drawLine({ start: { x: ML, y: y - 15 }, end: { x: ML + CW, y: y - 15 }, thickness: 0.4, color: LINE });
      y -= 17;
    };
    row(head, bold, HEADBG);
    for (const r of rows) row(r, reg);
    y -= 14;
  };
  // theo ngay: chi cac ngay co so lieu neu khoang dai
  const days = d.by_day.length > 45 ? d.by_day.filter((x) => x.views > 0) : d.by_day;
  table('Theo ngày', ['Ngày', 'Lượt xem', 'Thời lượng (giây)'], [0.5, 0.25, 0.25], days.map((x) => [x.day, fmtN(x.views), fmtN(x.watched_s)]));
  table('Theo chiến dịch', ['Chiến dịch', 'Lượt xem', 'Thời lượng (giây)'], [0.6, 0.18, 0.22], d.by_campaign.map((x) => [x.name ?? x.id, fmtN(x.views), fmtN(x.watched_s)]));
  table('Quảng cáo (creative) xem nhiều nhất', ['Creative', 'Chiến dịch', 'Lượt xem', 'Thời lượng (giây)'], [0.34, 0.3, 0.14, 0.22], d.by_creative.slice(0, 20).map((x) => [x.name ?? x.id, x.campaign_name ?? '', fmtN(x.views), fmtN(x.watched_s)]));
  table('Theo địa điểm', ['Địa điểm', 'Lượt xem', 'Thời lượng (giây)'], [0.6, 0.18, 0.22], d.by_location.map((x) => [x.name, fmtN(x.views), fmtN(x.watched_s)]));
  if (!o.external) table('Theo thiết bị', ['Thiết bị', 'Địa điểm', 'Lượt xem', 'Thời lượng (giây)'], [0.34, 0.3, 0.14, 0.22], (d.by_device ?? []).map((x) => [x.name ?? x.id, x.location ?? '', fmtN(x.views), fmtN(x.watched_s)]));
  ensure(30);
  const note = d.note;
  const lines: string[] = [];
  let cur = '';
  for (const w of note.split(' ')) {
    if (reg.widthOfTextAtSize(`${cur} ${w}`, 8.5) > CW) (lines.push(cur), (cur = w));
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  for (const l of lines) {
    text(l, ML, 8.5, reg, GREY);
    y -= 12;
  }
  const pages = doc.getPages();
  pages.forEach((p, i) => p.drawText(`Trang ${i + 1}/${pages.length}`, { x: W - MR - 50, y: 28, size: 8, font: reg, color: GREY }));
  return doc.save();
}

/** PDF bao cao luot hien thi theo muc phat (A4, cung font/logo mo cheo): KPI + theo ngay + nhom da chon. */
export async function renderItemsPdf(d: ItemsReport, o: { external: boolean; groupTitle: string; logo: { bytes: Uint8Array; type: 'png' | 'jpg' } | null }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const reg = await doc.embedFont(b64(BE_VIETNAM_PRO_REGULAR_B64), { subset: true });
  const bold = await doc.embedFont(b64(BE_VIETNAM_PRO_BOLD_B64), { subset: true });
  let logo: PDFImage | null = null;
  if (o.logo) logo = o.logo.type === 'png' ? await doc.embedPng(o.logo.bytes).catch(() => null) : await doc.embedJpg(o.logo.bytes).catch(() => null);
  doc.setTitle('Báo cáo lượt hiển thị theo mục phát');
  doc.setProducer('AMS');
  doc.setCreationDate(new Date(d.generated_at));
  let page!: PDFPage;
  let y = 0;
  const newPage = (): void => {
    page = doc.addPage([W, H]);
    if (logo) {
      const s = Math.min((W * 0.66) / logo.width, (H * 0.4) / logo.height);
      const w = logo.width * s;
      const h = logo.height * s;
      const org = rotatedOrigin(W / 2, H / 2, w, h, WATERMARK_ANGLE);
      page.drawImage(logo, { x: org.x, y: org.y, width: w, height: h, rotate: degrees(WATERMARK_ANGLE), opacity: WATERMARK_OPACITY });
    } else {
      const size = (W * 0.62) / bold.widthOfTextAtSize('ANIO', 1);
      const org = rotatedOrigin(W / 2, H / 2, bold.widthOfTextAtSize('ANIO', size), bold.heightAtSize(size, { descender: false }), WATERMARK_ANGLE);
      page.drawText('ANIO', { x: org.x, y: org.y, size, font: bold, color: rgb(0.1, 0.25, 0.45), rotate: degrees(WATERMARK_ANGLE), opacity: WATERMARK_OPACITY });
    }
    y = H - 56;
  };
  const fit = (t: string, f: PDFFont, size: number, max: number): string => {
    if (f.widthOfTextAtSize(t, size) <= max) return t;
    let s = t;
    while (s.length > 1 && f.widthOfTextAtSize(s + '…', size) > max) s = s.slice(0, -1);
    return s + '…';
  };
  const ensure = (h: number): void => {
    if (y - h < 56) newPage();
  };
  const text = (t: string, x: number, size: number, f: PDFFont = reg, color = INK): void => void page.drawText(t, { x, y, size, font: f, color });
  newPage();
  text('BÁO CÁO LƯỢT HIỂN THỊ THEO MỤC PHÁT', ML, 16, bold);
  y -= 20;
  const who = d.scope.customer ? `Khách hàng: ${d.scope.customer.name}   ·   ` : '';
  text(fit(`${who}Từ ${d.range.from} đến ${d.range.to} (giờ Việt Nam)`, reg, 10, CW), ML, 10, reg, GREY);
  y -= 14;
  text(`Xuất lúc ${d.generated_at.slice(0, 16).replace('T', ' ')} UTC`, ML, 9, reg, GREY);
  y -= 26;
  const kpis: [string, string][] = [
    ['Tổng lượt hiển thị', fmtN(d.totals.impressions)],
    ['Tệp media', fmtN(d.totals.media)],
    ['Chương trình', fmtN(d.totals.programs)],
    [o.external ? 'Vùng' : 'Thiết bị', fmtN(o.external ? d.totals.zones : d.totals.devices ?? 0)],
  ];
  const kw = (CW - 3 * 8) / 4;
  kpis.forEach(([label, val], i) => {
    const x = ML + i * (kw + 8);
    page.drawRectangle({ x, y: y - 38, width: kw, height: 46, borderColor: LINE, borderWidth: 0.8, color: rgb(1, 1, 1), opacity: 0.85 });
    page.drawText(label, { x: x + 8, y: y - 6, size: 8, font: reg, color: GREY });
    page.drawText(fit(val, bold, 13, kw - 14), { x: x + 8, y: y - 26, size: 13, font: bold, color: INK });
  });
  y -= 62;
  const table = (title: string, head: string[], widths: number[], rows: string[][]): void => {
    if (!rows.length) return;
    ensure(60);
    text(title, ML, 11.5, bold);
    y -= 8;
    const row = (cells: string[], f: PDFFont, bg?: ReturnType<typeof rgb>): void => {
      ensure(18);
      if (bg) page.drawRectangle({ x: ML, y: y - 14, width: CW, height: 17, color: bg });
      let x = ML;
      cells.forEach((cell, i) => {
        const w = widths[i]! * CW;
        const t = fit(cell, f, 9, w - 8);
        page.drawText(t, { x: i >= cells.length - 2 ? x + w - 4 - f.widthOfTextAtSize(t, 9) : x + 4, y: y - 10, size: 9, font: f, color: INK });
        x += w;
      });
      page.drawLine({ start: { x: ML, y: y - 15 }, end: { x: ML + CW, y: y - 15 }, thickness: 0.4, color: LINE });
      y -= 17;
    };
    row(head, bold, HEADBG);
    for (const r of rows) row(r, reg);
    y -= 14;
  };
  const days = d.by_day.length > 45 ? d.by_day.filter((x) => x.impressions > 0) : d.by_day;
  if (d.group_by !== 'day') table('Theo ngày', ['Ngày', 'Lượt hiển thị'], [0.7, 0.3], days.map((x) => [x.day, fmtN(x.impressions)]));
  table(o.groupTitle, ['Tên', 'Tỷ lệ %', 'Lượt hiển thị'], [0.6, 0.16, 0.24], d.rows.map((x) => [x.label, String(x.share), fmtN(x.impressions)]));
  ensure(30);
  const lines: string[] = [];
  let cur = '';
  for (const w of d.note.split(' ')) {
    if (reg.widthOfTextAtSize(`${cur} ${w}`, 8.5) > CW) (lines.push(cur), (cur = w));
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  for (const l of lines) {
    text(l, ML, 8.5, reg, GREY);
    y -= 12;
  }
  const pages = doc.getPages();
  pages.forEach((p, i) => p.drawText(`Trang ${i + 1}/${pages.length}`, { x: W - MR - 50, y: 28, size: 8, font: reg, color: GREY }));
  return doc.save();
}
