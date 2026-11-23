import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { parseRich, plainToDoc, richToPlain, sanitizeRich, serializeRich } from '../lib/richtext';
import { applyPara, applyStyle, clearFormat, replaceRange, selectionFormat, toggleBold, toggleFlag } from '../lib/richedit';
import { RichEditor, RichView, linearize, type RichChange } from '../components/RichText';

describe('rich text: bộ làm sạch / chuỗi hoá', () => {
  it('chuẩn hoá HTML do trình duyệt sinh ra và loại phần tử nguy hiểm', () => {
    const h = '<div>Một<br></div><div><span style="font-weight: bold; color: rgb(220, 38, 38);">Hai</span></div><img src=x onerror=alert(1)><script>x</script>';
    expect(sanitizeRich(h)).toBe('<p>Một</p><p><span style="color:#DC2626"><b>Hai</b></span></p>');
  });
  it('khứ hồi ổn định (idempotent)', () => {
    const h = '<p style="text-align:right;line-height:1.5"><span style="color:#FF0000;font-size:30px;font-family:Georgia;letter-spacing:2px;font-weight:300"><i><u><s>x</s></u></i></span><br>y</p><p><br></p>';
    const once = sanitizeRich(h);
    expect(sanitizeRich(once)).toBe(once);
    expect(once).toContain('font-weight:300');
    expect(once).toContain('text-align:right');
  });
});

describe('rich text: thao tác định dạng trên mô hình', () => {
  const doc = plainToDoc('Xin chào\nThế giới');
  it('in đậm / bật tắt cờ trên vùng chọn xuyên đoạn', () => {
    const d = toggleBold(doc, 4, 12); // "chào\nThế"
    expect(serializeRich(d)).toBe('<p>Xin <b>chào</b></p><p><b>Thế</b> giới</p>');
    const back = toggleBold(d, 4, 12);
    expect(serializeRich(back)).toBe('<p>Xin chào</p><p>Thế giới</p>');
    expect(serializeRich(toggleFlag(doc, 0, 3, 'u'))).toBe('<p><u>Xin</u> chào</p><p>Thế giới</p>');
  });
  it('màu, cỡ, nền, độ đậm, phông; chỉ phần được chọn', () => {
    const d = applyStyle(applyStyle(doc, 0, 3, { color: '#FF0000', size: 40, w: 900 }), 4, 8, { bg: '#FDE047', fam: 'Georgia', w: 300 });
    expect(serializeRich(d)).toBe('<p><span style="color:#FF0000;font-size:40px;font-weight:900">Xin</span> <span style="background-color:#FDE047;font-family:Georgia;font-weight:300">chào</span></p><p>Thế giới</p>');
    expect(richToPlain(d)).toBe('Xin chào\nThế giới');
  });
  it('căn lề và giãn dòng theo đoạn; xoá định dạng', () => {
    const d = applyPara(doc, 10, 10, { align: 'center', lh: 1.5 });
    expect(serializeRich(d)).toBe('<p>Xin chào</p><p style="text-align:center;line-height:1.5">Thế giới</p>');
    expect(selectionFormat(d, 10, 10).align).toBe('center');
    expect(selectionFormat(d, 0, 12).align).toBe('mixed');
    expect(serializeRich(clearFormat(applyStyle(d, 0, 20, { color: '#FF0000' }), 0, 20))).toBe('<p>Xin chào</p><p>Thế giới</p>');
    expect(serializeRich(applyPara(d, 10, 10, { align: 'left', lh: undefined }))).toBe('<p>Xin chào</p><p>Thế giới</p>');
  });
  it('dán văn bản nhiều dòng thay vùng chọn và kế thừa kiểu', () => {
    const b = toggleBold(doc, 0, 3);
    const r = replaceRange(b, 1, 3, 'a\nb');
    expect(serializeRich(r.doc)).toBe('<p><b>Xa</b></p><p><b>b</b> chào</p><p>Thế giới</p>');
    expect(r.caret).toBe(4);
    expect(serializeRich(replaceRange(doc, 3, 4, '\n').doc)).toBe('<p>Xin</p><p>chào</p><p>Thế giới</p>');
    expect(richToPlain(replaceRange(doc, 0, 20, 'x\ny', true).doc)).toBe('x y');
  });
});

describe('rich text: ánh xạ DOM <-> vị trí ký tự', () => {
  it('linearize khớp richToPlain với <div>, <br> giữ chỗ, dòng trống và khối lồng nhau', () => {
    for (const h of ['<div>a</div><div><br></div><div>bc<br>d<br></div>', '<p>x</p><p><br></p><p>y</p>', 'đầu<div>sau</div>', '<div><div>lồng</div></div><div>b</div>', '<p>a<br><br></p>']) {
      const host = document.createElement('div');
      host.innerHTML = h;
      expect(linearize(host).len, h).toBe(richToPlain(parseRich(h)).length);
    }
  });
});

function Host({ line = false, init = '', onOut }: { line?: boolean; init?: string; onOut: (v: RichChange) => void }) {
  const [v, setV] = useState<RichChange>({ rich: '', text: init });
  return <RichEditor label="Nội dung" line={line} rich={v.rich} text={v.text} onChange={(x) => { setV(x); onOut(x); }} />;
}
function select(el: HTMLElement, a: number, b: number) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let pos = 0;
  const pt: Record<number, [Node, number]> = {};
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const len = n.nodeValue!.length;
    for (const o of [a, b]) if (pt[o] === undefined && o >= pos && o <= pos + len) pt[o] = [n, o - pos];
    pos += len;
  }
  const r = document.createRange();
  r.setStart(...pt[a]!);
  r.setEnd(...pt[b]!);
  const s = window.getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
  act(() => { document.dispatchEvent(new Event('selectionchange')); });
}

describe('RichEditor', () => {
  it('toolbar: in đậm, gạch chân, màu và căn giữa áp dụng cho vùng chọn', async () => {
    const out = vi.fn();
    render(<Host init="Xin chào" onOut={out} />);
    const ed = screen.getByRole('textbox', { name: 'Nội dung' });
    select(ed, 0, 3);
    await userEvent.click(screen.getByRole('button', { name: 'In đậm' }));
    expect(out).toHaveBeenLastCalledWith({ rich: '<p><b>Xin</b> chào</p>', text: 'Xin chào' });
    expect(ed.innerHTML).toBe('<p><b>Xin</b> chào</p>');
    expect(screen.getByRole('button', { name: 'In đậm' })).toHaveAttribute('aria-pressed', 'true');
    select(ed, 4, 8);
    await userEvent.click(screen.getByRole('button', { name: 'Gạch chân' }));
    fireEvent.change(screen.getByLabelText('Màu chữ'), { target: { value: '#00ff00' } });
    await userEvent.selectOptions(screen.getByLabelText('Độ đậm nhạt'), '300');
    await userEvent.click(screen.getByRole('button', { name: 'Căn giữa' }));
    expect(out).toHaveBeenLastCalledWith({ rich: '<p style="text-align:center"><b>Xin</b> <span style="color:#00FF00;font-weight:300"><u>chào</u></span></p>', text: 'Xin chào' });
  });
  it('không bôi đen thì nhắc người dùng và không đổi nội dung', async () => {
    const out = vi.fn();
    render(<Host init="abc" onOut={out} />);
    select(screen.getByRole('textbox'), 1, 1);
    await userEvent.click(screen.getByRole('button', { name: 'In nghiêng' }));
    expect(out).not.toHaveBeenCalled();
    expect(screen.getByText('Hãy bôi đen đoạn chữ cần định dạng.')).toBeInTheDocument();
  });
  it('gõ nhiều dòng (Enter) tạo đoạn mới; chữ chạy chặn Enter và ẩn căn lề', async () => {
    const out = vi.fn();
    const { unmount } = render(<Host onOut={out} />);
    const ed = screen.getByRole('textbox');
    ed.innerHTML = '<div>Dòng 1</div><div>Dòng 2</div>';
    fireEvent.input(ed);
    expect(out).toHaveBeenLastCalledWith({ rich: '<p>Dòng 1</p><p>Dòng 2</p>', text: 'Dòng 1\nDòng 2' });
    expect(screen.getByRole('button', { name: 'Căn phải' })).toBeInTheDocument();
    unmount();
    render(<Host line onOut={out} />);
    const m = screen.getByRole('textbox');
    expect(fireEvent.keyDown(m, { key: 'Enter' })).toBe(false); // preventDefault
    expect(screen.queryByRole('button', { name: 'Căn phải' })).toBeNull();
    expect(screen.getByRole('button', { name: 'In đậm' })).toBeInTheDocument();
  });
  it('dán chỉ nhận văn bản thuần (không chèn HTML)', () => {
    const out = vi.fn();
    render(<Host init="ab" onOut={out} />);
    const ed = screen.getByRole('textbox');
    select(ed, 1, 1);
    fireEvent.paste(ed, { clipboardData: { getData: () => '<img src=x onerror=1>\nz' } });
    expect(out).toHaveBeenLastCalledWith({ rich: '<p>a&lt;img src=x onerror=1&gt;</p><p>zb</p>', text: 'a<img src=x onerror=1>\nzb' });
    expect(ed.querySelector('img')).toBeNull();
  });
});

describe('RichView', () => {
  it('vẽ bằng phần tử React (không innerHTML), tỉ lệ cỡ chữ và căn lề', () => {
    const { container } = render(<RichView html={'<p style="text-align:center"><span style="font-size:40px;color:#FF0000"><b>Hi</b></span><br>x</p><script>1</script>'} k={0.5} />);
    const p = container.querySelector('[data-rich] > div') as HTMLElement;
    expect(p.style.textAlign).toBe('center');
    const span = container.querySelector('span') as HTMLElement;
    expect(span.style.fontSize).toBe('20px');
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toBe('Hix');
  });
  it('rơi về văn bản thuần khi chưa có rich; chữ chạy gộp thành một dòng', () => {
    const { container, rerender } = render(<RichView text={'a\nb'} />);
    expect(container.querySelectorAll('[data-rich] > div')).toHaveLength(2);
    rerender(<RichView html="<p>a</p><p>b</p>" line />);
    expect(container.textContent).toBe('a b');
    expect(container.querySelector('div')).toBeNull();
  });
});
