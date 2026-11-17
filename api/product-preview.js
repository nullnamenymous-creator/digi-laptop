const storefront = 'https://www.digital-laptop.com';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export default async function handler(req, res) {
  const { id, harga } = req.query;
  if (typeof id !== 'string' || !uuid.test(id)) {
    res.writeHead(302, { Location: '/catalog' });
    res.end();
    return;
  }

  const destination = new URL('/catalog', storefront);
  destination.searchParams.set('produk', id);
  if (typeof harga === 'string' && /^\d{1,14}(?:\.\d{1,2})?$/.test(harga)) destination.searchParams.set('harga', harga);
  const backend = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  let product;
  if (backend && key) {
    try {
      const response = await fetch(new URL('/rest/v1/rpc/customer_catalog_storefront', backend), {
        method: 'POST',
        headers: { apikey: key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ _product_id: id }),
        signal: AbortSignal.timeout(2500),
      });
      if (response.ok) [product] = await response.json();
    } catch (error) {
      console.warn('Product preview unavailable', error.message);
    }
  }

  const title = product ? `${product.name} | Digital Laptop Jombang` : 'Katalog Digital Laptop Jombang';
  const description = product
    ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
      .format(Number(product.retail_price) - Number(product.catalog_discount || 0))
    : 'Lihat ketersediaan laptop dan pilihan lainnya di katalog.';
  const image = product?.image_path
    ? `${storefront}/foto-produk?${new URLSearchParams({ path: product.image_path, v: '2' })}`
    : `${storefront}/login-laptops.webp`;
  const details = destination.pathname + destination.search;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', product ? 'public, s-maxage=60' : 'no-store');
  res.end(`<!doctype html><html lang="id"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta property="og:type" content="website">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:image" content="${escapeHtml(image)}">
    <meta property="og:url" content="${storefront}/produk/${escapeHtml(id)}">
    </head><body><a id="catalog-link" href="${escapeHtml(details)}">Buka detail produk di katalog</a>
    <script>location.replace(document.getElementById('catalog-link').href)</script></body></html>`);
}
