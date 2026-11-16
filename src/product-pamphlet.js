export const pamphletSpecs = [
  ['processor', 'Prosesor'], ['ram', 'RAM'], ['storage', 'Penyimpanan'],
  ['display', 'Layar'], ['graphics', 'Grafis'], ['os', 'Sistem operasi'],
];

export async function renderProductPamphlet({ store, name, price, specifications, barcode, warranty }) {
  const logo = new Image();
  logo.src = '/store-logo-transparent.png';
  await logo.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 1788;
  canvas.height = 1260;
  const ctx = canvas.getContext('2d');
  ctx.scale(3, 3);
  const box = (x, y, w, h, fill, border) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fillStyle = fill;
    ctx.fill();
    if (border) { ctx.strokeStyle = border; ctx.stroke(); }
  };
  const text = (value, x, y, maxWidth, size, color, min = 9) => {
    ctx.fillStyle = color;
    do { ctx.font = `700 ${size}px Arial`; } while (ctx.measureText(value).width > maxWidth && size-- > min);
    ctx.fillText(value, x, y, maxWidth);
  };
  const line = (x, y, x2, y2) => {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
  };
  const icons = [
    () => {
      ctx.strokeRect(4, 4, 12, 12);
      ctx.strokeRect(7, 7, 6, 6);
      for (const n of [6, 10, 14]) { line(n, 1, n, 4); line(n, 16, n, 19); line(1, n, 4, n); line(16, n, 19, n); }
    },
    () => {
      ctx.strokeRect(0, 5, 20, 10);
      for (const n of [3, 8, 13]) { ctx.strokeRect(n, 8, 3, 4); line(n, 15, n, 18); }
    },
    () => { ctx.strokeRect(1, 3, 18, 14); line(1, 12, 19, 12); line(13, 15, 16, 15); },
    () => { ctx.strokeRect(1, 2, 18, 12); line(10, 14, 10, 18); line(5, 18, 15, 18); },
    () => {
      ctx.strokeRect(0, 4, 20, 12);
      for (const n of [5, 15]) { ctx.beginPath(); ctx.arc(n, 10, 3, 0, Math.PI * 2); ctx.stroke(); }
    },
    () => { ctx.strokeRect(2, 2, 16, 16); line(10, 2, 10, 18); line(2, 10, 18, 10); },
  ];
  const cream = '#fff7dc';
  const gold = '#f3d679';
  const border = '#53795f';
  ctx.fillStyle = '#edf2eb';
  ctx.fillRect(0, 0, 596, 420);
  box(14, 9, 568, 398, '#154e33', border);
  const logoScale = Math.min(31 / logo.naturalWidth, 31 / logo.naturalHeight);
  ctx.drawImage(logo, 40, 31, logo.naturalWidth * logoScale, logo.naturalHeight * logoScale);
  text(store, 81, 52, 350, 17, cream);
  ctx.textAlign = 'right';
  text('ETALASE LAPTOP', 556, 50, 113, 10, gold);
  ctx.textAlign = 'left';
  text(name, 40, 105, 516, 32, cream, 15);

  ctx.fillStyle = '#b2252a';
  ctx.fillRect(40, 119, 516, 70);
  ctx.fillStyle = gold;
  ctx.fillRect(40, 119, 7, 70);
  text(price, 61, 173, 480, 54, cream);

  pamphletSpecs.forEach(([key, label], index) => {
    const x = 40 + (index % 3) * 174;
    const y = 200 + Math.floor(index / 3) * 52;
    box(x, y, 168, 44, '#153d2c', border);
    ctx.save();
    ctx.translate(x + 8, y + 11);
    ctx.strokeStyle = gold;
    ctx.lineWidth = 1.3;
    icons[index]();
    ctx.restore();
    text(label.toUpperCase(), x + 36, y + 17, 123, 9, gold);
    text(specifications?.[key] || '-', x + 36, y + 33, 123, 13, cream);
  });

  if (warranty > 0) text(`Garansi ${warranty} bulan`, 40, 334, 170, 13, gold);
  const code = `KODE UNIT \u00b7 ${barcode}`;
  ctx.font = '700 14px Arial';
  const codeWidth = Math.max(168, Math.min(330, Math.ceil(ctx.measureText(code).width) + 18));
  box(556 - codeWidth, 316, codeWidth, 30, '#153d2c', border);
  text(code, 565 - codeWidth, 336, codeWidth - 18, 14, cream);
  return canvas.toDataURL('image/png');
}

export async function downloadProductPamphlet(image, filename) {
  const { PDFDocument, PageSizes } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const [height, width] = PageSizes.A5;
  const page = pdf.addPage([width, height]);
  const artwork = await pdf.embedPng(image);
  page.drawImage(artwork, { x: 0, y: 0, width, height });
  const url = URL.createObjectURL(new Blob([await pdf.save()], { type: 'application/pdf' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
