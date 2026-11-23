const specRows = [
  ['processor', 'Prosesor'], ['ram', 'RAM'], ['storage', 'Penyimpanan'],
];

function printableText(value) {
  return String(value ?? '')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-').replace(/[·•]/g, '|')
    .replace(/[^\x20-\xFF]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function fitLines(text, font, size, maxWidth, maxLines = 1) {
  const words = printableText(text).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
    else if (!line) {
      let clipped = word;
      while (clipped.length && font.widthOfTextAtSize(`${clipped}...`, size) > maxWidth) clipped = clipped.slice(0, -1);
      lines.push(`${clipped}...`);
      line = '';
    } else {
      lines.push(line);
      line = word;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (words.length && lines.length === maxLines) {
    const full = printableText(text);
    const rendered = lines.join(' ');
    if (full.length > rendered.length && !lines.at(-1).endsWith('...')) {
      let clipped = lines.at(-1);
      while (clipped.length && font.widthOfTextAtSize(`${clipped}...`, size) > maxWidth) clipped = clipped.slice(0, -1);
      lines[lines.length - 1] = `${clipped}...`;
    }
  }
  return lines;
}

async function fetchImage(pdf, url) {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const type = response.headers.get('content-type')?.toLowerCase() || '';
    if (type.includes('png') || (bytes[0] === 0x89 && bytes[1] === 0x50)) return await pdf.embedPng(bytes);
    if (type.includes('jpeg') || type.includes('jpg') || (bytes[0] === 0xff && bytes[1] === 0xd8)) return await pdf.embedJpg(bytes);
  } catch { /* Missing or inaccessible photos keep the catalog usable. */ }
  return null;
}

function drawContainedImage(page, image, x, y, width, height) {
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  page.drawImage(image, { x: x + (width - drawWidth) / 2, y: y + (height - drawHeight) / 2, width: drawWidth, height: drawHeight });
}

export async function downloadProductCatalog({ store, branch, products }) {
  if (!products?.length) throw new Error('Pilih setidaknya satu produk untuk katalog.');
  const { PDFDocument, PageSizes, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Katalog Laptop - ${store}`);
  pdf.setAuthor(store);
  pdf.setSubject(`Laptop siap jual di ${branch}`);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [width, height] = PageSizes.A4;
  const colors = {
    green: rgb(0.07, 0.27, 0.18),
    greenMid: rgb(0.16, 0.43, 0.28),
    pale: rgb(0.94, 0.97, 0.93),
    border: rgb(0.83, 0.88, 0.83),
    ink: rgb(0.12, 0.18, 0.14),
    muted: rgb(0.38, 0.44, 0.39),
    white: rgb(1, 1, 1),
  };
  const margin = 28;
  const gapX = 10;
  const gapY = 9;
  const columns = 3;
  const rows = 4;
  const perPage = columns * rows;
  const cardWidth = (width - margin * 2 - gapX * (columns - 1)) / columns;
  const cardHeight = (height - 28 - 66 - 32 - gapY * (rows - 1)) / rows;
  const pageCount = Math.ceil(products.length / perPage);
  const today = new Intl.DateTimeFormat('id-ID', { dateStyle: 'long' }).format(new Date());

  let logo = null;
  try {
    const response = await fetch('/store-logo-transparent.png');
    if (response.ok) logo = await pdf.embedPng(new Uint8Array(await response.arrayBuffer()));
  } catch { /* The catalog header remains branded with the store name. */ }

  const images = new Map();
  for (let start = 0; start < products.length; start += 6) {
    const batch = products.slice(start, start + 6);
    const fetched = await Promise.all(batch.map(async (product) => [product.id, await fetchImage(pdf, product.image_url || '')]));
    fetched.forEach(([id, image]) => { if (image) images.set(id, image); });
  }

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = pdf.addPage(PageSizes.A4);
    const top = height - 28;
    if (logo) drawContainedImage(page, logo, margin, top - 31, 34, 30);
    page.drawText(printableText(store || 'DIGITAL LAPTOP JOMBANG').toUpperCase(), {
      x: margin + (logo ? 42 : 0), y: top - 13, size: 8, font: bold, color: colors.greenMid,
    });
    page.drawText('KATALOG LAPTOP', {
      x: margin + (logo ? 42 : 0), y: top - 31, size: 17, font: bold, color: colors.green,
    });
    const branchText = `Cabang ${printableText(branch)}  |  ${products.length} pilihan laptop`;
    const branchWidth = regular.widthOfTextAtSize(branchText, 8);
    page.drawText(branchText, { x: width - margin - branchWidth, y: top - 15, size: 8, font: regular, color: colors.muted });
    const dateWidth = regular.widthOfTextAtSize(today, 8);
    page.drawText(today, { x: width - margin - dateWidth, y: top - 30, size: 8, font: regular, color: colors.muted });
    page.drawLine({ start: { x: margin, y: top - 43 }, end: { x: width - margin, y: top - 43 }, thickness: 1.3, color: colors.greenMid });

    const pageProducts = products.slice(pageIndex * perPage, (pageIndex + 1) * perPage);
    pageProducts.forEach((product, localIndex) => {
      const column = localIndex % columns;
      const row = Math.floor(localIndex / columns);
      const x = margin + column * (cardWidth + gapX);
      const cardTop = top - 54 - row * (cardHeight + gapY);
      const y = cardTop - cardHeight;
      page.drawRectangle({ x, y, width: cardWidth, height: cardHeight, color: colors.white, borderColor: colors.border, borderWidth: 0.8 });

      const imageX = x + 7;
      const imageY = cardTop - 76;
      const imageWidth = cardWidth - 14;
      const imageHeight = 66;
      page.drawRectangle({ x: imageX, y: imageY, width: imageWidth, height: imageHeight, color: colors.pale });
      const image = images.get(product.id);
      if (image) drawContainedImage(page, image, imageX + 4, imageY + 3, imageWidth - 8, imageHeight - 6);
      else {
        const placeholder = 'FOTO PRODUK';
        const placeholderWidth = regular.widthOfTextAtSize(placeholder, 8);
        page.drawText(placeholder, { x: imageX + (imageWidth - placeholderWidth) / 2, y: imageY + 29, size: 8, font: regular, color: colors.muted });
      }

      const title = [product.brand, product.model].filter(Boolean).join(' ') || product.name;
      const nameLines = fitLines(title, bold, 9.2, cardWidth - 14, 2);
      nameLines.forEach((line, index) => page.drawText(line, { x: x + 7, y: cardTop - 89 - index * 11, size: 9.2, font: bold, color: colors.green }));
      const secondary = product.brand && product.model ? product.name : product.sku;
      const secondaryLines = fitLines(secondary, regular, 7.2, cardWidth - 14, 1);
      if (secondaryLines[0]) page.drawText(secondaryLines[0], { x: x + 7, y: cardTop - 112, size: 7.2, font: regular, color: colors.muted });

      const specValues = specRows.map(([key, label]) => {
        const value = printableText(product.specifications?.[key]);
        return value ? `${label}: ${value}` : '';
      }).filter(Boolean).slice(0, 3);
      specValues.forEach((line, index) => {
        const wrapped = fitLines(line, regular, 7, cardWidth - 14, 1)[0];
        if (wrapped) page.drawText(wrapped, { x: x + 7, y: cardTop - 123 - index * 9, size: 7, font: regular, color: colors.ink });
      });

      page.drawRectangle({ x: x + 7, y: y + 7, width: cardWidth - 14, height: 21, color: colors.pale });
      const price = `Rp ${Number(product.retail_price || 0).toLocaleString('id-ID')}`;
      let priceSize = 12;
      while (priceSize > 8 && bold.widthOfTextAtSize(price, priceSize) > cardWidth - 28) priceSize -= 0.5;
      page.drawText(price, { x: x + 13, y: y + 13, size: priceSize, font: bold, color: colors.green });
      const readyText = 'SIAP JUAL';
      const readySize = 6.2;
      const readyWidth = bold.widthOfTextAtSize(readyText, readySize);
      page.drawText(readyText, { x: x + cardWidth - 14 - readyWidth, y: y + 14, size: readySize, font: bold, color: colors.greenMid });
    });

    const footerY = 17;
    page.drawLine({ start: { x: margin, y: footerY + 8 }, end: { x: width - margin, y: footerY + 8 }, thickness: 0.6, color: colors.border });
    const footer = 'Digital Laptop Jombang  |  Harga dan ketersediaan dapat berubah';
    page.drawText(footer, { x: margin, y: footerY - 1, size: 7, font: regular, color: colors.muted });
    const pageText = `${pageIndex + 1} / ${pageCount}`;
    const pageTextWidth = regular.widthOfTextAtSize(pageText, 7);
    page.drawText(pageText, { x: width - margin - pageTextWidth, y: footerY - 1, size: 7, font: regular, color: colors.muted });
  }

  const bytes = await pdf.save();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `Katalog-Laptop-${String(branch || 'Cabang').replace(/[^\w-]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

