import sharp from 'sharp';

const maxSourceBytes = 10 * 1024 * 1024;

export async function serveProductPhoto(req, res, backend) {
  const path = new URL(req.url, 'http://localhost').searchParams.get('path');
  const segments = path?.split('/');
  if (!segments?.length || path.length > 1024 || segments.some(part => !part || part === '.' || part === '..' || part.includes('\\'))) {
    res.writeHead(400).end();
    return;
  }
  if (!backend) {
    res.writeHead(503).end();
    return;
  }

  try {
    const source = new URL('/storage/v1/object/public/product-images/' + segments.map(encodeURIComponent).join('/'), backend);
    const response = await fetch(source, { signal: AbortSignal.timeout(6000), redirect: 'error' });
    if (!response.ok) {
      res.writeHead(response.status === 404 ? 404 : 502).end();
      return;
    }
    if (Number(response.headers.get('content-length')) > maxSourceBytes) {
      await response.body?.cancel();
      res.writeHead(413).end();
      return;
    }
    const input = await response.arrayBuffer();
    if (input.byteLength > maxSourceBytes) {
      res.writeHead(413).end();
      return;
    }

    const { data, info } = await sharp(input)
      .autoOrient()
      .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    const fontSize = Math.min(width * 0.047, height * 0.13);
    const watermark = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <g transform="translate(${width / 2} ${height * 0.60}) rotate(-14)">
        <text x="0" y="0" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="bold"
          font-size="${fontSize}" fill="#fff" stroke="#102b21" stroke-width="${fontSize * 0.055}"
          paint-order="stroke" opacity="0.62">DIGITAL LAPTOP JOMBANG</text>
      </g>
    </svg>`);
    const photo = await sharp(data).composite([{ input: watermark }]).jpeg({ quality: 84 }).toBuffer();
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': photo.length,
      'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
    }).end(photo);
  } catch (error) {
    console.warn('Product photo unavailable', error.message);
    res.writeHead(502).end();
  }
}

export default function handler(req, res) {
  return serveProductPhoto(req, res, process.env.VITE_SUPABASE_URL);
}
