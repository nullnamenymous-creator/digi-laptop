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
  const box = (x, y, w, h, fill, border, radius = 8) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    if (border) { ctx.strokeStyle = border; ctx.stroke(); }
  };
  const text = (value, x, y, maxWidth, size, color, min = 9) => {
    ctx.fillStyle = color;
    ctx.font = `700 ${size}px Arial`;
    while (size > min && ctx.measureText(value).width > maxWidth) {
      ctx.font = `700 ${--size}px Arial`;
    }
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
  const ink = '#273d33';
  const sage = '#dce9d7';
  const muted = '#476558';
  const border = '#000000';

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 596, 420);
  box(11, 11, 574, 398, '#faf8ee', border, 16);

  const logoScale = Math.min(35 / logo.naturalWidth, 35 / logo.naturalHeight);
  ctx.drawImage(logo, 31, 24, logo.naturalWidth * logoScale, logo.naturalHeight * logoScale);
  text(store, 77, 48, 480, 16, ink);
  ctx.strokeStyle = border;
  line(31, 70, 565, 70);
  text(name, 31, 120, 534, 35, ink, 17);

  box(31, 137, 534, 74, sage, border, 11);
  box(41, 147, 4, 54, border, null, 2);
  text('HARGA JUAL', 57, 157, 126, 10, muted);

  // Fit both the digits and the descender of "Rp" inside the price panel.
  const priceTop = 163;
  const priceHeight = 39;
  const priceWidth = 493;
  let fontSize = 43;
  let priceMetrics;
  let ascent;
  let descent;
  let left;
  do {
    ctx.font = `700 ${fontSize}px Georgia, "Times New Roman", serif`;
    priceMetrics = ctx.measureText(price);
    ascent = priceMetrics.actualBoundingBoxAscent ?? fontSize * 0.8;
    descent = priceMetrics.actualBoundingBoxDescent ?? fontSize * 0.2;
    left = Math.max(0, priceMetrics.actualBoundingBoxLeft ?? 0);
    const right = Math.max(priceMetrics.width, priceMetrics.actualBoundingBoxRight ?? 0);
    if (left + right <= priceWidth && ascent + descent <= priceHeight) break;
  } while (--fontSize > 1);
  ctx.fillStyle = ink;
  ctx.fillText(price, 57 + left, priceTop + (priceHeight + ascent - descent) / 2, priceWidth - left);

  pamphletSpecs.forEach(([key, label], index) => {
    const x = 31 + (index % 3) * 181;
    const y = 225 + Math.floor(index / 3) * 51;
    box(x, y, 172, 44, '#fffefa', border);
    box(x + 8, y + 9, 26, 26, '#edf3e9', null, 6);
    ctx.save();
    ctx.translate(x + 11, y + 12);
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1.25;
    icons[index]();
    ctx.restore();
    text(label.toUpperCase(), x + 42, y + 16, 122, 9, muted);
    text(specifications?.[key] || '-', x + 42, y + 33, 122, 13, ink);
  });

  ctx.strokeStyle = border;
  line(31, 337, 565, 337);
  if (warranty > 0) {
    box(31, 350, 141, 33, sage, border, 16);
    text(`Garansi ${warranty} bulan`, 44, 371, 116, 13, muted);
  }
  text('KODE UNIT', 331, 369, 64, 10, muted);
  ctx.textAlign = 'right';
  text(barcode, 555, 372, 150, 19, ink, 11);
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
