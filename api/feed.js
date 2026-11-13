// Flux produits Google Merchant Center (une ligne par variante), généré en direct depuis Shopify.
// Adresse du flux : https://www.otreau.com/merchant-feed.tsv
const SHOP = 'https://pcbvi7-ea.myshopify.com/api/2026-10/graphql.json';
const TOKEN = '454c67e9623c56f1a73831ea0a3e76bf'; // jeton Storefront public (déjà présent dans assets/shopify.js)
const SITE = 'https://www.otreau.com/';
const PAGES = {
  'veste-otreau': 'veste-otreau', 'doudoune': 'doudoune-otreau', 'gilet': 'gilet-otreau',
  'gilet-ultra-fin': 'gilet-ultra-fin-otreau', 'gilet-avec-capuche': 'gilet-avec-capuche-otreau',
  'gilet-camouflage': 'gilet-camouflage-otreau', 'softshell': 'softshell-otreau', 'sweet': 'sweat-otreau',
  'sweat-fin': 'sweat-fin-otreau', 'parka': 'parka-homme-otreau', 'parka-femme': 'parka-femme-otreau',
  'veste-polaire': 'parka-polaire-otreau', 'gants-chauffants': 'gants-chauffants-otreau',
  'chaussettes-chauffantes': 'chaussettes-chauffantes-otreau', 'chauffe-mains': 'chauffe-mains-otreau'
};
// Couleur principale (utilisée si Shopify n'a pas d'option « Couleur ») — à vérifier
const COLORS = {
  'veste-otreau': 'Noir', 'doudoune': 'Noir', 'gilet': 'Noir', 'gilet-ultra-fin': 'Noir', 'gilet-avec-capuche': 'Noir',
  'gilet-camouflage': 'Camouflage gris', 'softshell': 'Noir', 'sweet': 'Noir', 'sweat-fin': 'Gris', 'parka': 'Noir',
  'parka-femme': 'Rose', 'veste-polaire': 'Kaki/Noir', 'gants-chauffants': 'Noir', 'chaussettes-chauffantes': 'Gris',
  'chauffe-mains': 'Gris'
};
// Titres du flux (les titres Shopify sont trop courts pour Google)
const TITLES = {
  'veste-otreau': 'Veste chauffante Otreau', 'doudoune': 'Doudoune chauffante Otreau', 'gilet': 'Gilet doudoune chauffant Otreau',
  'gilet-ultra-fin': 'Gilet chauffant ultra fin Otreau', 'gilet-avec-capuche': 'Gilet chauffant avec capuche Otreau',
  'gilet-camouflage': 'Gilet chauffant camouflage Otreau', 'softshell': 'Softshell chauffante Otreau', 'sweet': 'Sweat à capuche chauffant Otreau',
  'sweat-fin': 'Sweat fin chauffant Otreau', 'parka': 'Parka chauffante homme Otreau', 'parka-femme': 'Parka chauffante femme Otreau',
  'veste-polaire': 'Parka polaire chauffante Otreau', 'gants-chauffants': 'Gants chauffants Otreau',
  'chaussettes-chauffantes': 'Chaussettes chauffantes Otreau', 'chauffe-mains': 'Chauffe-mains Otreau'
};
const GENDER = { 'parka': 'male', 'parka-femme': 'female' }; // les autres : unisex
const ONE_SIZE = ['gants-chauffants', 'chaussettes-chauffantes', 'chauffe-mains'];

const Q = `query F @inContext(country: FR, language: FR) { products(first: 100) { nodes {
  handle title description
  images(first: 6) { nodes { url } }
  variants(first: 100) { nodes { id title availableForSale price { amount currencyCode } selectedOptions { name value } image { url } } }
} } }`;

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const cell = (v) => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

module.exports = async function handler(req, res) {
  try {
    const r = await fetch(SHOP, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': TOKEN }, body: JSON.stringify({ query: Q }) });
    const j = await r.json();
    if (!j.data) throw new Error(JSON.stringify(j.errors || j).slice(0, 300));
    const cols = ['id', 'item_group_id', 'title', 'description', 'link', 'image_link', 'additional_image_link', 'availability', 'price',
      'brand', 'condition', 'identifier_exists', 'gender', 'age_group', 'color', 'size', 'shipping', 'shipping_label'];
    const rows = [cols.join('\t')];
    for (const p of j.data.products.nodes) {
      const page = PAGES[p.handle]; if (!page) continue;
      const imgs = p.images.nodes.map((i) => i.url);
      for (const v of p.variants.nodes) {
        const vid = v.id.split('/').pop();
        const opt = (n) => (v.selectedOptions.find((o) => norm(o.name) === n) || {}).value || '';
        const size = ONE_SIZE.includes(p.handle) ? 'Taille unique' : opt('taille');
        const batt = opt('batterie'), color = opt('couleur') || COLORS[p.handle] || '';
        const extra = [size && size !== 'Taille unique' ? 'Taille ' + size : '', batt].filter(Boolean).join(' – ');
        const img = (v.image && v.image.url) || imgs[0] || '';
        rows.push([
          vid, p.handle, (TITLES[p.handle] || p.title) + (extra ? ' – ' + extra : ''), (p.description || TITLES[p.handle] || p.title).slice(0, 4900),
          SITE + page + '.html?variant=' + vid, img, imgs.filter((u) => u !== img).slice(0, 5).join(','),
          v.availableForSale ? 'in_stock' : 'out_of_stock', Number(v.price.amount).toFixed(2) + ' ' + v.price.currencyCode,
          'Otreau', 'new', 'no', GENDER[p.handle] || 'unisex', 'adult', color, size, 'FR:::3.20 EUR', ''
        ].map(cell).join('\t'));
      }
    }
    res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(rows.join('\n') + '\n');
  } catch (e) {
    console.error(e);
    return res.status(502).send('Flux indisponible');
  }
};
