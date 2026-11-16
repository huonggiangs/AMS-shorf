// Xuat hop dong ra PDF (A4) bang pdf-lib + font Be Vietnam Pro nhung san (thuan JS: chay duoc tren Node va Cloudflare Workers).
// Hinh mo logo cheo o giua MOI trang, ve TRUOC noi dung (nam duoi chu); ban nhap co dong "BẢN NHÁP" tren dau moi trang va con dau do.
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import type { PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { PriceTable, RenderedArticle } from '@ams/shared';
import { BE_VIETNAM_PRO_BOLD_B64, BE_VIETNAM_PRO_REGULAR_B64 } from './fonts.gen.js';

export interface PdfParty {
  name: string;
  rep: string;
  title: string;
}
export interface ContractPdfInput {
  title: string;
  /** dong phu duoi tieu de (ten hop dong), co the rong */
  subtitle?: string;
  contractNo: string;
  docVersion: number;
  status: 'draft' | 'final';
  /** mau da duoc luat su duyet chua (hien trong dong "BAN NHAP") */
  templateApproved: boolean;
  articles: RenderedArticle[];
  price: PriceTable;
  seller: { name: string; tax_code: string; address: string; phone: string; email: string };
  partyA: PdfParty;
  partyB: PdfParty;
  contentHash: string;
  /** moc thoi gian ghi vao metadata (ISO) */
  stampIso: string;
  logo?: { bytes: Uint8Array; type: 'png' | 'jpg' } | null;
  watermarkText?: string;
  /** do mo watermark 0..1 (mac dinh 0.09) */
  watermarkOpacity?: number;
}

export const WATERMARK_OPACITY = 0.09;
export const WATERMARK_ANGLE = 40;
const W = 595.28;
const H = 841.89;
const ML = 56;
const MR = 56;
const CW = W - ML - MR;
const TOP = 62;
const BOTTOM = 58;
const BODY = 10.5;
const LEAD = 1.5;
const INK = rgb(0.08, 0.08, 0.1);
const GREY = rgb(0.4, 0.4, 0.45);
const RED = rgb(0.75, 0.1, 0.1);

const b64 = (s: string): Uint8Array => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

interface Word {
  t: string;
  bold: boolean;
}
/** Tach chuoi co `**dam**` thanh cac tu (giu thong tin dam). */
function words(text: string): Word[] {
  const out: Word[] = [];
  let bold = false;
  for (const part of text.split('**')) {
    for (const w of part.split(/\s+/)) if (w) out.push({ t: w, bold });
    bold = !bold;
  }
  return out;
}

/** Toa do goc duoi-trai de hop (w x h) xoay `deg` do quanh goc do co tam o (cx, cy). */
export function rotatedOrigin(cx: number, cy: number, w: number, h: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: cx - ((w / 2) * Math.cos(a) - (h / 2) * Math.sin(a)), y: cy - ((w / 2) * Math.sin(a) + (h / 2) * Math.cos(a)) };
}

class Writer {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  constructor(
    readonly doc: PDFDocument,
    readonly reg: PDFFont,
    readonly bold: PDFFont,
    readonly inp: ContractPdfInput,
    readonly logo: PDFImage | null,
  ) {}

  newPage(): void {
    this.page = this.doc.addPage([W, H]);
    this.pages.push(this.page);
    this.watermark(this.page); // truoc tien: nam duoi moi noi dung
    if (this.inp.status === 'draft') this.draftStamp(this.page);
    this.y = H - TOP;
    if (this.pages.length > 1) this.runningHeader();
    else this.firstHeader();
  }

  watermark(p: PDFPage): void {
    const op = this.inp.watermarkOpacity ?? WATERMARK_OPACITY;
    const cx = W / 2;
    const cy = H / 2;
    if (this.logo) {
      const maxW = W * 0.66;
      const maxH = H * 0.4;
      const s = Math.min(maxW / this.logo.width, maxH / this.logo.height);
      const w = this.logo.width * s;
      const h = this.logo.height * s;
      const o = rotatedOrigin(cx, cy, w, h, WATERMARK_ANGLE);
      p.drawImage(this.logo, { x: o.x, y: o.y, width: w, height: h, rotate: degrees(WATERMARK_ANGLE), opacity: op });
      return;
    }
    const text = this.inp.watermarkText ?? 'ANIO';
    const size = (W * 0.62) / this.bold.widthOfTextAtSize(text, 1);
    const w = this.bold.widthOfTextAtSize(text, size);
    const h = this.bold.heightAtSize(size, { descender: false });
    const o = rotatedOrigin(cx, cy, w, h, WATERMARK_ANGLE);
    p.drawText(text, { x: o.x, y: o.y, size, font: this.bold, color: rgb(0.1, 0.25, 0.45), rotate: degrees(WATERMARK_ANGLE), opacity: op });
  }

  draftStamp(p: PDFPage): void {
    const text = 'BẢN NHÁP';
    const size = 64;
    const w = this.bold.widthOfTextAtSize(text, size);
    const h = this.bold.heightAtSize(size, { descender: false });
    const o = rotatedOrigin(W / 2 + 40, H * 0.2, w, h, WATERMARK_ANGLE);
    p.drawText(text, { x: o.x, y: o.y, size, font: this.bold, color: RED, rotate: degrees(WATERMARK_ANGLE), opacity: 0.12 });
    const note = this.inp.templateApproved ? 'BẢN NHÁP: chưa chốt, chưa dùng để ký.' : 'BẢN NHÁP: chưa chốt, mẫu chưa được luật sư duyệt, chưa có giá trị pháp lý.';
    p.drawText(note, { x: ML, y: H - 28, size: 8.5, font: this.bold, color: RED });
  }

  firstHeader(): void {
    const s = this.inp.seller;
    this.text(s.name, { size: 11, bold: true });
    const lines = [s.address && `Địa chỉ: ${s.address}`, [s.tax_code && `MST: ${s.tax_code}`, s.phone && `ĐT: ${s.phone}`, s.email && `Email: ${s.email}`].filter(Boolean).join(' · ')].filter(Boolean) as string[];
    for (const l of lines) this.text(l, { size: 8.5, color: GREY });
    this.y -= 4;
    this.page.drawLine({ start: { x: ML, y: this.y }, end: { x: W - MR, y: this.y }, thickness: 0.6, color: GREY });
    this.y -= 18;
    this.center('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', 11, true);
    this.center('Độc lập - Tự do - Hạnh phúc', 10.5, true);
    this.y -= 12;
    this.center(this.inp.title.toUpperCase(), 15, true);
    if (this.inp.subtitle) this.center(this.inp.subtitle, 10.5, false);
    this.center(`Số: ${this.inp.contractNo}`, 11, false);
    this.y -= 12;
  }

  runningHeader(): void {
    this.page.drawText(this.inp.seller.name, { x: ML, y: H - 38, size: 8.5, font: this.reg, color: GREY });
    const r = `Hợp đồng số ${this.inp.contractNo}`;
    this.page.drawText(r, { x: W - MR - this.reg.widthOfTextAtSize(r, 8.5), y: H - 38, size: 8.5, font: this.reg, color: GREY });
    this.page.drawLine({ start: { x: ML, y: H - 44 }, end: { x: W - MR, y: H - 44 }, thickness: 0.4, color: GREY });
  }

  ensure(h: number): void {
    if (this.y - h < BOTTOM) this.newPage();
  }

  center(t: string, size: number, bold: boolean): void {
    const f = bold ? this.bold : this.reg;
    this.ensure(size * LEAD);
    this.y -= size * 1.1;
    this.page.drawText(t, { x: (W - f.widthOfTextAtSize(t, size)) / 2, y: this.y, size, font: f, color: INK });
    this.y -= size * 0.4;
  }

  /** Ngat dong theo do rong; moi dong la mang tu (de ve duoc doan dam xen ke). */
  wrap(text: string, size: number, maxW: number, baseBold = false): Word[][] {
    const lines: Word[][] = [];
    let cur: Word[] = [];
    let curW = 0;
    const sp = (b: boolean) => (b ? this.bold : this.reg).widthOfTextAtSize(' ', size);
    for (const raw of words(text)) {
      const w = { t: raw.t, bold: raw.bold || baseBold };
      const ww = (w.bold ? this.bold : this.reg).widthOfTextAtSize(w.t, size);
      if (cur.length && curW + sp(w.bold) + ww > maxW) {
        lines.push(cur);
        cur = [];
        curW = 0;
      }
      curW += (cur.length ? sp(w.bold) : 0) + ww;
      cur.push(w);
    }
    if (cur.length) lines.push(cur);
    return lines.length ? lines : [[]];
  }

  drawLineWords(p: PDFPage, ws: Word[], x: number, y: number, size: number, color = INK): void {
    let cx = x;
    for (const w of ws) {
      const f = w.bold ? this.bold : this.reg;
      p.drawText(w.t, { x: cx, y, size, font: f, color });
      cx += f.widthOfTextAtSize(w.t + ' ', size);
    }
  }

  text(t: string, o: { size?: number; bold?: boolean; indent?: number; color?: ReturnType<typeof rgb>; gap?: number; bullet?: boolean } = {}): void {
    const size = o.size ?? BODY;
    const indent = o.indent ?? 0;
    const lines = this.wrap(t, size, CW - indent - (o.bullet ? 12 : 0), o.bold);
    const lh = size * LEAD;
    for (let i = 0; i < lines.length; i++) {
      this.ensure(lh);
      this.y -= lh;
      if (o.bullet && i === 0) this.page.drawText('•', { x: ML + indent + 2, y: this.y, size, font: this.reg, color: INK });
      this.drawLineWords(this.page, lines[i]!, ML + indent + (o.bullet ? 12 : 0), this.y, size, o.color);
    }
    this.y -= o.gap ?? 0;
  }

  heading(t: string): void {
    this.ensure(BODY * LEAD * 4);
    this.y -= 6;
    this.text(t, { size: 11.5, bold: true, gap: 3 });
  }

  priceTable(price: PriceTable): void {
    const cols = [
      { h: 'STT', w: 26, align: 'c' },
      { h: 'Loại màn hình', w: 70, align: 'l' },
      { h: 'Khu vực', w: 62, align: 'l' },
      { h: 'Khung giờ', w: 62, align: 'l' },
      { h: 'Tần suất', w: 48, align: 'r' },
      { h: 'Thời lượng (giây)', w: 54, align: 'r' },
      { h: 'SL', w: 30, align: 'r' },
      { h: 'Đơn giá/lượt (VND)', w: CW - 352, align: 'r' },
    ] as const;
    const size = 8.5;
    const pad = 3;
    const row = (cells: string[], bold: boolean, fill: boolean) => {
      const wrapped = cells.map((c, i) => this.wrap(c, size, cols[i]!.w - pad * 2, bold));
      const rows = Math.max(...wrapped.map((w) => w.length));
      const rh = rows * size * 1.35 + pad * 2;
      if (this.y - rh < BOTTOM) {
        this.newPage();
        if (!fill) header();
      }
      const top = this.y;
      if (fill) this.page.drawRectangle({ x: ML, y: top - rh, width: CW, height: rh, color: rgb(0.92, 0.94, 0.97) });
      let x = ML;
      cols.forEach((c, i) => {
        this.page.drawRectangle({ x, y: top - rh, width: c.w, height: rh, borderColor: GREY, borderWidth: 0.4 });
        wrapped[i]!.forEach((ln, li) => {
          const lw = ln.reduce((s, w) => s + (w.bold ? this.bold : this.reg).widthOfTextAtSize(w.t + ' ', size), 0) - this.reg.widthOfTextAtSize(' ', size);
          const tx = c.align === 'r' ? x + c.w - pad - lw : c.align === 'c' ? x + (c.w - lw) / 2 : x + pad;
          this.drawLineWords(this.page, ln, tx, top - pad - size * 1.05 - li * size * 1.35, size);
        });
        x += c.w;
      });
      this.y = top - rh;
    };
    const header = () => row(cols.map((c) => c.h), true, true);
    this.y -= 4;
    this.ensure(70);
    header();
    price.lines.forEach((l, i) => row([String(i + 1), l.screen_type, l.region, l.daypart, l.frequency, l.duration_s, String(l.qty), l.impression_price_vnd || '—'], false, false));
    if (!price.lines.length) row(['', 'Chưa có dòng giá. Giá trị theo Điều khoản bên dưới.', '', '', '', '', '', ''], false, false);
    const sum = (label: string, v: string, bold = false) => {
      const lh = size * 1.35 + pad * 2;
      if (this.y - lh < BOTTOM) this.newPage();
      const top = this.y;
      const lw = CW - cols[7]!.w;
      this.page.drawRectangle({ x: ML, y: top - lh, width: lw, height: lh, borderColor: GREY, borderWidth: 0.4 });
      this.page.drawRectangle({ x: ML + lw, y: top - lh, width: cols[7]!.w, height: lh, borderColor: GREY, borderWidth: 0.4 });
      const f = bold ? this.bold : this.reg;
      this.page.drawText(label, { x: ML + lw - pad - f.widthOfTextAtSize(label, size), y: top - pad - size * 1.05, size, font: f, color: INK });
      this.page.drawText(v, { x: ML + CW - pad - f.widthOfTextAtSize(v, size), y: top - pad - size * 1.05, size, font: f, color: INK });
      this.y = top - lh;
    };
    const fmt = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    sum('Giá trị trước thuế', fmt(price.value_vnd));
    sum(`Thuế GTGT ${price.vat_rate}%`, fmt(price.vat_vnd));
    sum('Tổng thanh toán', fmt(price.total_vnd), true);
    this.y -= 8;
  }

  signatures(): void {
    this.ensure(150);
    this.y -= 14;
    const colW = CW / 2;
    const top = this.y;
    const draw = (x: number, label: string, p: PdfParty) => {
      const c = (t: string, yy: number, bold: boolean, size: number) => {
        const f = bold ? this.bold : this.reg;
        this.page.drawText(t, { x: x + (colW - f.widthOfTextAtSize(t, size)) / 2, y: yy, size, font: f, color: INK });
      };
      c(label, top - 12, true, 10.5);
      c('(Ký, ghi rõ họ tên, đóng dấu)', top - 25, false, 8.5);
      const lines = this.wrap(`${p.name}`, 9, colW - 20, false);
      lines.slice(0, 3).forEach((ln, i) => {
        const lw = ln.reduce((s, w) => s + this.reg.widthOfTextAtSize(w.t + ' ', 9), 0);
        this.drawLineWords(this.page, ln, x + (colW - lw) / 2, top - 100 - i * 12, 9, GREY);
      });
      c(p.rep ? `${p.rep}${p.title ? ' - ' + p.title : ''}` : '', top - 100 - Math.min(lines.length, 3) * 12 - 2, false, 9);
    };
    draw(ML, 'ĐẠI DIỆN BÊN A', this.inp.partyA);
    draw(ML + colW, 'ĐẠI DIỆN BÊN B', this.inp.partyB);
    this.y = top - 140;
    this.ensure(50);
    this.y -= 6;
    this.page.drawLine({ start: { x: ML, y: this.y }, end: { x: W - MR, y: this.y }, thickness: 0.4, color: GREY });
    this.y -= 4;
    this.text('Mã băm nội dung (SHA-256), dùng để đối chiếu bản điện tử này với bản đã chốt trên hệ thống:', { size: 8, color: GREY });
    this.text(this.inp.contentHash, { size: 8, bold: true });
  }
}

export async function renderContractPdf(inp: ContractPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const reg = await doc.embedFont(b64(BE_VIETNAM_PRO_REGULAR_B64), { subset: true });
  const bold = await doc.embedFont(b64(BE_VIETNAM_PRO_BOLD_B64), { subset: true });
  let logo: PDFImage | null = null;
  if (inp.logo) {
    try {
      logo = inp.logo.type === 'png' ? await doc.embedPng(inp.logo.bytes) : await doc.embedJpg(inp.logo.bytes);
    } catch {
      logo = null; // logo hong: dung logo chu mac dinh thay vi that bai
    }
  }
  const t = new Date(inp.stampIso);
  const when = Number.isNaN(t.getTime()) ? new Date(0) : t;
  doc.setTitle(`${inp.title} ${inp.contractNo}`);
  doc.setAuthor(inp.seller.name);
  doc.setSubject(`Hợp đồng ${inp.contractNo} phiên bản ${inp.docVersion} (${inp.status === 'final' ? 'bản chốt' : 'BẢN NHÁP'})`);
  doc.setKeywords([`sha256:${inp.contentHash}`, `status:${inp.status}`, logo ? 'watermark:logo' : 'watermark:text']);
  doc.setProducer('AMS contract-doc');
  doc.setCreator('AMS');
  doc.setCreationDate(when);
  doc.setModificationDate(when);

  const w = new Writer(doc, reg, bold, inp, logo);
  w.newPage();
  for (const a of inp.articles) {
    if (a.title) w.heading(a.no === null ? a.title : `Điều ${a.no}. ${a.title}`);
    for (const b of a.blocks) {
      if (b.type === 'p') w.text(b.text, { gap: 4 });
      else if (b.type === 'bullet') w.text(b.text, { bullet: true, indent: 8, gap: 2 });
      else w.priceTable(inp.price);
    }
  }
  w.signatures();

  const total = w.pages.length;
  w.pages.forEach((p, i) => {
    const label = `Trang ${i + 1}/${total}`;
    p.drawLine({ start: { x: ML, y: BOTTOM - 10 }, end: { x: W - MR, y: BOTTOM - 10 }, thickness: 0.4, color: GREY });
    p.drawText(label, { x: W - MR - reg.widthOfTextAtSize(label, 8.5), y: BOTTOM - 24, size: 8.5, font: reg, color: GREY });
    const left = `${inp.contractNo} · phiên bản ${inp.docVersion} · ${inp.status === 'final' ? 'bản chốt' : 'BẢN NHÁP'} · SHA-256 ${inp.contentHash.slice(0, 16)}…`;
    p.drawText(left, { x: ML, y: BOTTOM - 24, size: 8, font: reg, color: inp.status === 'final' ? GREY : RED });
  });
  return doc.save({ useObjectStreams: false });
}
