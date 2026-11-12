import { useEffect, useState } from 'react';
import { Btn, Note, PageHead, Tabs, Tag } from '../components/ui';
import { useT } from '../i18n';

/** Static product spec (not sample data): 6 TV formats x 5 resolution modes. */
const RES = [['auto', 'Tự động', 0, 0], ['hd', 'HD', 1280, 720], ['fhd', 'Full HD', 1920, 1080], ['4k', '4K', 3840, 2160], ['8k', '8K', 7680, 4320]] as const;
interface Fmt { fr: [number, number]; id: string; n: string; d: string; ov: string; t: string }
const FMTS: Fmt[] = [
  { fr: [1, 1], id: 'full', n: 'Toàn màn hình', d: 'Video 15–30 giây chèn giữa nội dung; tính thưởng khi VCR 100%.', ov: 'inset:0', t: 'VIDEO 1920×1080' },
  { fr: [0.88, 0.28], id: 'menu', n: 'Banner menu hình ảnh', d: 'Banner ảnh trên màn hình chính của ứng dụng, cạnh lưới nội dung.', ov: 'left:6%;right:6%;top:12%;height:28%', t: 'ẢNH 1200×340' },
  { fr: [0.22, 1], id: 'l', n: 'L-banner', d: 'Nội dung thu nhỏ, quảng cáo bao quanh mép phải và dưới.', ov: 'right:0;top:0;bottom:0;width:22%;border-radius:0', t: 'L 1920×1080' },
  { fr: [0.5, 0.64], id: 'pause', n: 'Quảng cáo khi tạm dừng', d: 'Ảnh hiện giữa khi người xem bấm tạm dừng.', ov: 'left:25%;right:25%;top:18%;bottom:18%', t: 'ẢNH 960×540' },
  { fr: [0.14, 0.25], id: 'qr', n: 'QR góc màn hình', d: 'Mã QR động ở góc dưới, dẫn tới trang ưu đãi.', ov: 'right:4%;bottom:6%;width:14%;height:25%', t: 'QR' },
  { fr: [0.26, 0.15], id: 'reward', n: 'Thưởng điểm xem quảng cáo', d: 'Hiển thị bộ đếm và +20 điểm khi hoàn tất.', ov: 'left:4%;top:6%;width:26%;height:15%;border-radius:20px', t: '+20 điểm' },
];
const css = (s: string): React.CSSProperties => Object.fromEntries(s.split(';').filter(Boolean).map((p) => { const [k, v] = p.split(':'); return [k!.trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), v!.trim()]; }));

export default function Formats() {
  const t = useT();
  const [res, setRes] = useState('auto');
  const [fm, setFm] = useState('full');
  const [imgs, setImgs] = useState<Record<string, string>>({});
  useEffect(() => () => Object.values(imgs).forEach(URL.revokeObjectURL), []); // eslint-disable-line react-hooks/exhaustive-deps
  const dv = (window.devicePixelRatio || 1) * window.screen.width;
  const auto = dv >= 5000 ? RES[4] : dv >= 2800 ? RES[3] : dv >= 1600 ? RES[2] : RES[1];
  const cur = res === 'auto' ? auto : RES.find((r) => r[0] === res)!;
  const f = FMTS.find((x) => x.id === fm)!;
  const px = (r: readonly [string, string, number, number], fr: [number, number]) => `${Math.round(r[2] * fr[0])} × ${Math.round(r[3] * fr[1])}`;
  const cell = Math.max(1, Math.round((6 * 1280 / cur[2]) * 10) / 10);
  const pick = (id: string, file?: File) => { if (file) setImgs((p) => ({ ...p, [id]: URL.createObjectURL(file) })); };
  return (
    <>
      <PageHead title="Mẫu hiển thị TV" sub="Menu hình ảnh quảng cáo trên TV. Bấm vùng quảng cáo trong khung TV để thả ảnh mẫu (ví dụ ADS.png)." actions={<Btn icon="dl" onClick={() => window.print()}>{t('Xuất PDF')}</Btn>} />
      <Tabs value={res} onChange={setRes} label="Độ phân giải" items={RES.map((r) => ({ id: r[0], label: `${r[1]}${r[0] === 'auto' ? ` · ${auto[1]}` : ''}` }))} />
      <Note>Ảnh mẫu ADS.png do chủ dự án cung cấp, đặt vào /assets/formats/. Hiện các khung để trống; bấm vùng tím để chọn tệp, ảnh chỉ hiển thị trong phiên trình duyệt.</Note>
      <div className="g g21">
        <div className="card cp">
          <div className="ch"><div><h2>{f.n}</h2><p>{f.d}</p></div><Tag tone="info">{f.t}</Tag></div>
          <div className="tv"><div className="scr">
            <div className="ph">NỘI DUNG ĐANG XEM</div>
            <label className="ov slot" style={{ ...css(f.ov), ...(imgs[fm] ? { padding: 0, borderStyle: 'solid', background: '#000' } : {}) }}>
              {imgs[fm] ? <img src={imgs[fm]} alt="" /> : f.t}
              <input type="file" accept="image/*" onChange={(e) => pick(fm, e.target.files?.[0])} />
            </label>
            <div className="rpx" style={{ ['--c' as string]: `${cell}px`, opacity: cur[2] >= 7680 ? 0 : cur[2] >= 3840 ? 0.07 : cur[2] >= 1920 ? 0.12 : 0.18 }} />
            <span className="rb mono">{cur[1]} · {cur[2]}×{cur[3]}</span>
          </div></div>
        </div>
        <div className="card cp">
          <div className="ch"><div><h2>Thông số</h2></div></div>
          <dl className="kv" style={{ margin: 0 }}>
            <dt>Độ phân giải</dt><dd className="mono">{cur[1]} · {cur[2]} × {cur[3]}</dd>
            <dt>Kích thước creative</dt><dd className="mono">{px(cur, f.fr)} px</dd>
            <dt>Tự co giãn</dt><dd>Khung 16:9, ảnh cover theo vùng; HD → 8K dùng cùng một tệp</dd>
            <dt>Tỷ lệ</dt><dd>16:9</dd><dt>Định dạng</dt><dd>MP4 H.264 / PNG / JPG</dd>
            <dt>Dung lượng tối đa</dt><dd>{fm === 'full' ? '50 MB' : '5 MB'}</dd>
            <dt>Thời lượng</dt><dd>{fm === 'full' ? '15 hoặc 30 giây' : 'Hiển thị 5–10 giây'}</dd>
            <dt>Vùng an toàn</dt><dd>Lề 5% mỗi cạnh</dd><dt>Tính thưởng</dt><dd>{fm === 'full' ? 'Có, VCR 100%' : 'Không'}</dd>
          </dl>
        </div>
      </div>
      <div className="card cp" style={{ marginBottom: 18 }}>
        <div className="ch"><div><h2>Kích thước hiển thị theo độ phân giải</h2><p>{f.n}: vùng quảng cáo tự co giãn theo tỷ lệ màn hình</p></div></div>
        <div className="tw"><table><thead><tr>{RES.slice(1).map((r) => <th key={r[0]}>{r[1]}</th>)}</tr></thead>
          <tbody><tr>{RES.slice(1).map((r) => <td key={r[0]} className="mono" style={r[0] === cur[0] ? { background: 'var(--pri-t)', fontWeight: 700 } : undefined}>{px(r, f.fr)}</td>)}</tr></tbody></table></div>
      </div>
      <div className="g g3">
        {FMTS.map((x) => (
          <button key={x.id} type="button" className="card fm" onClick={() => setFm(x.id)} aria-pressed={x.id === fm} style={{ border: x.id === fm ? '2px solid var(--pri)' : '2px solid transparent', textAlign: 'left', color: 'inherit', background: 'var(--card)' }}>
            <div className="tv"><div className="scr"><div className="ph" style={{ fontSize: 9 }}>NỘI DUNG</div><div className="ov" style={{ ...css(x.ov), ...(imgs[x.id] ? { padding: 0, background: '#000' } : {}) }}>{imgs[x.id] ? <img src={imgs[x.id]} alt="" /> : x.t}</div></div></div>
            <h3>{x.n}</h3><p>{x.d}</p>
          </button>
        ))}
      </div>
    </>
  );
}
