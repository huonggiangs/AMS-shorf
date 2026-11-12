// Nhan dien dinh dang theo magic bytes (khong tin Content-Type / duoi tep do client khai).
export type Sniffed = 'png' | 'jpeg' | 'mp4' | 'webm' | null;

const at = (b: Uint8Array, off: number, s: string): boolean => {
  if (b.length < off + s.length) return false;
  for (let i = 0; i < s.length; i++) if (b[off + i] !== s.charCodeAt(i)) return false;
  return true;
};

export function sniff(b: Uint8Array): Sniffed {
  if (b.length >= 8 && b[0] === 0x89 && at(b, 1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (at(b, 4, 'ftyp')) return 'mp4'; // ISO BMFF (mp4/mov)
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm'; // EBML
  return null;
}

/** Ho MIME khai bao khop voi dinh dang that? */
export function mimeMatches(mime: string, kind: Sniffed): boolean {
  const m = mime.toLowerCase().split(';')[0]!.trim();
  switch (kind) {
    case 'png': return m === 'image/png';
    case 'jpeg': return m === 'image/jpeg';
    case 'mp4': return m === 'video/mp4' || m === 'video/quicktime';
    case 'webm': return m === 'video/webm';
    default: return false;
  }
}
