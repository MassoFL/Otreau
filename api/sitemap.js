// Plan du site dynamique : pages fixes + fiches des produits publiés dans Shopify.
// Un produit passé en brouillon ou archivé disparaît automatiquement du plan.
const SHOP = 'https://pcbvi7-ea.myshopify.com/api/2026-10/graphql.json';
const TOKEN = '454c67e9623c56f1a73831ea0a3e76bf'; // jeton Storefront public
const SITE = 'https://www.otreau.com/';
const PAGES = {
  'veste-otreau': 'veste-otreau', 'doudoune': 'doudoune-otreau', 'gilet': 'gilet-otreau',
  'gilet-ultra-fin': 'gilet-ultra-fin-otreau', 'gilet-avec-capuche': 'gilet-avec-capuche-otreau',
  'gilet-camouflage': 'gilet-camouflage-otreau', 'softshell': 'softshell-otreau', 'sweet': 'sweat-otreau',
  'sweat-fin': 'sweat-fin-otreau', 'parka': 'parka-homme-otreau', 'parka-femme': 'parka-femme-otreau',
  'veste-polaire': 'parka-polaire-otreau', 'gants-chauffants': 'gants-chauffants-otreau',
  'chaussettes-chauffantes': 'chaussettes-chauffantes-otreau', 'chauffe-mains': 'chauffe-mains-otreau'
};
const FIXED = ['', 'collection.html', 'blog.html',
  'article.html?a=tourisme-dhiver-4-destinations-incontournables-pour-voyager-dans-les-pays-froids',
  'a-propos.html', 'contact.html', 'livraison.html', 'politique-de-retour.html', 'politique-de-paiement.html',
  'politique-de-confidentialite.html', 'politique-de-cookies.html', 'conditions-generales.html',
  'mentions-legales.html', 'suivi-commande.html'];
const xmlEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

module.exports = async function handler(req, res) {
  let products = [];
  try {
    const r = await fetch(SHOP, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': TOKEN },
      body: JSON.stringify({ query: '{ products(first: 100) { nodes { handle updatedAt } } }' }) });
    const j = await r.json();
    products = (j.data && j.data.products.nodes) || [];
  } catch (e) { console.error(e); }
  const urls = FIXED.map((p) => ({ loc: SITE + p }));
  products.forEach((p) => { if (PAGES[p.handle]) urls.push({ loc: SITE + PAGES[p.handle] + '.html', lastmod: (p.updatedAt || '').slice(0, 10) }); });
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => '  <url><loc>' + xmlEsc(u.loc) + '</loc>' + (u.lastmod ? '<lastmod>' + u.lastmod + '</lastmod>' : '') + '</url>').join('\n') +
    '\n</urlset>\n';
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(xml);
};
