import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function createServiceReceiptPdf({ title, ticketNumber, referenceLabel = 'No. tiket', organization, branch, details, logo, qr, trackingCode, trackingUrl, barcodes = [] }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logoResponse = await fetch(logo);
  if (!logoResponse.ok) throw new Error('Logo bukti servis gagal dimuat.');
  const logoImage = await pdf.embedPng(await logoResponse.arrayBuffer());
  const qrImage = qr ? await pdf.embedPng(qr) : null;
  const ink = rgb(.11, .23, .18);
  const muted = rgb(.29, .38, .34);
  const background = rgb(.93, .96, .93);
  const rule = rgb(.79, .84, .80);
  const width = 595;
  const height = 842;
  const margin = 42;
  const contentWidth = width - 2 * margin;
  const characters = new Set(regular.getCharacterSet());
  let page;
  let y;

  const lines = (value, font, size, maxWidth) => {
    const safe = Array.from(String(value || '-'), (character) =>
      character === '\n' || characters.has(character.codePointAt(0)) ? character : '?').join('');
    return safe.split('\n').flatMap((paragraph) => {
      const wrapped = [];
      let line = '';
      for (const word of paragraph.trim().split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
          line = candidate;
          continue;
        }
        if (line) wrapped.push(line);
        line = '';
        for (const character of word) {
          if (font.widthOfTextAtSize(line + character, size) > maxWidth) {
            wrapped.push(line);
            line = '';
          }
          line += character;
        }
      }
      return [...wrapped, line];
    });
  };
  const draw = (text, x, baseline, size, font = regular, color = ink) => {
    page.drawText(text, { x, y: baseline, size, font, color });
  };
  const newPage = () => {
    page = pdf.addPage([width, height]);
    page.drawRectangle({ x: margin, y: 723, width: contentWidth, height: 77, color: background });
    const scale = Math.min(48 / logoImage.width, 48 / logoImage.height);
    page.drawImage(logoImage, { x: margin + 14, y: 737, ...logoImage.scale(scale) });
    draw(organization, margin + 75, 767, 15, bold);
    draw(branch, margin + 75, 747, 11, regular, muted);
    draw(title, margin, 692, 20, bold);
    draw(`${referenceLabel} ${ticketNumber}`, margin, 671, 11, regular, muted);
    y = 646;
  };
  newPage();

  for (const [label, value] of details) {
    if (y < margin + 42) newPage();
    draw(label, margin, y, 10, bold, muted);
    y -= 17;
    const wrapped = lines(value, regular, 12, contentWidth);
    for (const line of wrapped) {
      if (y < margin + 18) {
        newPage();
        draw(`${label} (lanjutan)`, margin, y, 10, bold, muted);
        y -= 17;
      }
      draw(line, margin, y, 12);
      y -= 15;
    }
    page.drawLine({ start: { x: margin, y: y + 5 }, end: { x: width - margin, y: y + 5 }, color: rule, thickness: .6 });
    y -= 10;
  }

  for (const barcode of barcodes) {
    const image = await pdf.embedPng(barcode.image);
    const scaled = image.scale(Math.min(300 / image.width, 85 / image.height));
    const labels = lines(barcode.label, bold, 10, contentWidth);
    const needed = scaled.height + labels.length * 13 + 20;
    if (y < margin + needed) newPage();
    for (const label of labels) { draw(label, margin, y, 10, bold); y -= 13; }
    page.drawImage(image, { x: margin, y: y - scaled.height, ...scaled });
    y -= scaled.height + 16;
  }

  if (qrImage) {
    if (y < margin + 122) newPage();
    page.drawRectangle({ x: margin, y: y - 108, width: contentWidth, height: 112, color: background });
    page.drawImage(qrImage, { x: margin + 10, y: y - 100, width: 96, height: 96 });
    draw('Lacak servis', margin + 122, y - 24, 12, bold);
    draw(trackingCode, margin + 122, y - 45, 12, bold);
    draw('Pindai QR atau masukkan kode di halaman lacak servis.', margin + 122, y - 65, 10);
    draw(trackingUrl, margin + 122, y - 83, 10, regular, muted);
  }
  const pages = pdf.getPages();
  pages.forEach((sheet, index) => {
    sheet.drawText(`${index + 1} / ${pages.length}`, { x: width - margin - 30, y: 24, size: 9, font: regular, color: muted });
  });
  return pdf.save();
}
