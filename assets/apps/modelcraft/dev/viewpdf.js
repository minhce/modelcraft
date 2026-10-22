/* SPDX-License-Identifier: Apache-2.0 */
/**
 * viewpdf.js — a one-page PDF of the 3D view (0.4 M13). DOM-free: bin/test-modelcraft.mjs runs it (and checks the file
 * with poppler's pdfinfo when it is installed). The view comes in as a JPEG (the canvas encodes it); the PDF embeds it
 * as is (DCTDecode), fitted to a landscape page with a margin, and writes a caption line under it in Helvetica.
 *
 *   viewPdf({ jpeg, width, height, caption, paper }) → Uint8Array (application/pdf)
 *     jpeg           the image's bytes; width, height its size in pixels
 *     caption        one line of text (Latin-1; other characters print as "?")
 *     paper          'a4' (842 × 595 pt) or 'letter' (792 × 612 pt), landscape
 */
const PAPER = { a4: [842, 595], letter: [792, 612] };

export function viewPdf({ jpeg, width, height, caption = '', paper = 'a4' }) {
  const [W, H] = PAPER[paper] || PAPER.a4;
  const margin = 36, capH = caption ? 20 : 0;
  const k = Math.min((W - 2 * margin) / width, (H - 2 * margin - capH) / height);
  const iw = width * k, ih = height * k, ix = (W - iw) / 2, iy = margin + capH + (H - 2 * margin - capH - ih) / 2;
  const f = (x) => (Math.round(x * 100) / 100).toString();
  // PDF text: Latin-1, with ( ) \ escaped
  const text = String(caption).replace(/[^\x20-\x7e\xa0-\xff]/g, '?').replace(/[\\()]/g, (c) => '\\' + c);
  const content = `q ${f(iw)} 0 0 ${f(ih)} ${f(ix)} ${f(iy)} cm /Im1 Do Q` + (caption ? `\nBT /F1 9 Tf ${f(margin)} ${f(margin + 4)} Td (${text}) Tj ET` : '');   // i18n-ignore: PDF drawing operators
  const enc = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
  const parts = [], offsets = [];
  let size = 0;
  const put = (b) => { parts.push(b); size += b.length; };
  const obj = (n, head, stream = null) => {
    offsets[n] = size;
    put(enc(`${n} 0 obj\n${head}\n`));
    if (stream) { put(enc('stream\n')); put(stream); put(enc('\nendstream\n')); }
    put(enc('endobj\n'));
  };
  put(enc('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im1 4 0 R >> /Font << /F1 5 0 R >> >> /Contents 6 0 R >>`);
  obj(4, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const cs = enc(content);
  obj(6, `<< /Length ${cs.length} >>`, cs);
  const xref = size;
  let x = 'xref\n0 7\n0000000000 65535 f \n';
  for (let n = 1; n <= 6; n++) x += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
  put(enc(x + 'trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'));
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
