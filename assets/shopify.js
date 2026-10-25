/* ==========================================================================
   Otreau × Shopify (Storefront API, headless)
   - Cartes produit : prix + tailles disponibles depuis Shopify (attribut data-handle)
   - Page produit : options, prix, disponibilité, ajout au panier (data-shopify-handle)
   - Panier latéral + paiement sécurisé Shopify (checkoutUrl)
   Le jeton ci-dessous est le jeton PUBLIC du canal Headless : il est fait pour être visible.
   ========================================================================== */
(function () {
  var SHOP = {
    domain: 'pcbvi7-ea.myshopify.com',
    token: '454c67e9623c56f1a73831ea0a3e76bf',
    version: '2026-10'
  };
  var CART_KEY = 'otreau_cart_id';
  var ENDPOINT = 'https://' + SHOP.domain + '/api/' + SHOP.version + '/graphql.json';

  /* ---------- utilitaires ---------- */
  function gql(query, variables) {
    var headers = { 'Content-Type': 'application/json' };
    if (SHOP.token) headers['X-Shopify-Storefront-Access-Token'] = SHOP.token;
    return fetch(ENDPOINT, { method: 'POST', headers: headers, body: JSON.stringify({ query: query, variables: variables || {} }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.errors && j.errors.length) throw new Error(j.errors.map(function (e) { return e.message; }).join(' / '));
        return j.data;
      });
  }
  function money(m) {
    if (!m) return '';
    try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: m.currencyCode }).format(parseFloat(m.amount)); }
    catch (e) { return m.amount + ' ' + m.currencyCode; }
  }
  // prix affichés toutes taxes comprises (les prix Shopify sont saisis TTC)
  var TTC = '<span class="ttc">TTC</span>';
  function ttc(m) { return esc(money(m)) + ' ' + TTC; }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase(); }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- produits ---------- */
  var PRODUCT_FIELDS = 'id handle title availableForSale ' +
    'priceRange { minVariantPrice { amount currencyCode } } ' +
    'options { name optionValues { name swatch { color image { previewImage { url } } } } } ' +
    'variants(first: 100) { nodes { id title availableForSale price { amount currencyCode } compareAtPrice { amount currencyCode } selectedOptions { name value } image { url altText } } } ' +
    'descriptionHtml featuredImage { url altText } ' +
    'media(first: 20) { nodes { mediaContentType alt previewImage { url } ' +
    '... on MediaImage { image { url altText } } ' +
    '... on Video { sources { url mimeType height } } } }';

  function fetchProducts(handles) {
    if (!handles.length) return Promise.resolve({});
    // Un produit est retrouvé que son identifiant Shopify soit « doudoune » ou « doudoune-otreau »
    function alt(h) { return /-otreau$/.test(h) ? h.replace(/-otreau$/, '') : h + '-otreau'; }
    var all = [];
    handles.forEach(function (h) { [h, alt(h)].forEach(function (x) { if (all.indexOf(x) < 0) all.push(x); }); });
    var q = all.map(function (h) { return 'handle:' + h; }).join(' OR ');
    function run(fields) {
      return gql('query P($q: String!) { products(first: 50, query: $q) { nodes { ' + fields + ' } } }', { q: q });
    }
    return run(PRODUCT_FIELDS).then(function (d) {
      var map = {};
      d.products.nodes.forEach(function (p) { sortSizes(p); map[p.handle] = p; });
      handles.forEach(function (h) { if (!map[h] && map[alt(h)]) map[h] = map[alt(h)]; });
      return map;
    });
  }
  // Titre Shopify « Veste » ou « Gilet fin » → « VESTE » / « GILET FIN »
  // (type en majuscules, sans suffixe ; un « Otreau » déjà présent n'est pas doublé)
  function baseTitle(t) {
    return String(t || '').replace(/[\s’'-]*otreau\s*$/i, '').trim().toLocaleUpperCase('fr-FR');
  }
  function plainTitle(t) { return baseTitle(t); }
  function titleHtml(t) {
    return '<span style="font-weight: 600">' + esc(baseTitle(t)) + '</span>';
  }
  function sized(url, w) { return url ? url + (url.indexOf('?') > -1 ? '&' : '?') + 'width=' + w : url; }
  // médias Shopify → liste simple {type, src, poster, alt}
  // Photo « portée » (mannequin) ou visuel technique (infographie, détails) ?
  // D'après le texte alternatif saisi dans Shopify, sinon le nom du fichier.
  var MODEL_RE = /portrait|mod[eè]le|homme|femme|couple|duo|senior|souriant|port[eé]e?\b|lifestyle/i;
  var TECH_RE = /infograph|guide|zone|niveau|fonctionnal|d[eé]tail|finition|lavable|lavage|poche|bouton|taille|captur|sch[eé]ma/i;
  // Photo prise en caméra thermique : défile avec les autres, avec la mention « Carte thermique »
  var THERMAL_RE = /thermique|thermal|infrarouge/i;
  function isThermalPhoto(src, alt) {
    var f = ''; try { f = decodeURIComponent(String(src || '').split('?')[0].split('/').pop()); } catch (e) { f = String(src || ''); }
    return THERMAL_RE.test((alt || '') + ' ' + f.replace(/[_-]+/g, ' '));
  }
  function isModelPhoto(src, alt) {
    var f = ''; try { f = decodeURIComponent(String(src || '').split('?')[0].split('/').pop()); } catch (e) { f = String(src || ''); }
    var t = (alt || '') + ' ' + f.replace(/[_-]+/g, ' ');
    return MODEL_RE.test(t) && !TECH_RE.test(t);
  }
  function isTechPhoto(src, alt) {
    var f = ''; try { f = decodeURIComponent(String(src || '').split('?')[0].split('/').pop()); } catch (e) { f = String(src || ''); }
    return TECH_RE.test((alt || '') + ' ' + f.replace(/[_-]+/g, ' '));
  }
  // Photo du produit seul : fond transparent sur les bords, et pas de peau dans le haut (pas de mannequin).
  var cutCache = {};
  function isCutout(url) {
    var key = String(url).split('?')[0]; if (cutCache[key]) return cutCache[key];
    return (cutCache[key] = new Promise(function (res) {
      var im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = function () {
        try {
          var N = 64, c = document.createElement('canvas'); c.width = c.height = N; var x = c.getContext('2d'); x.drawImage(im, 0, 0, N, N);
          var d = x.getImageData(0, 0, N, N).data, t = 0, n = 0;
          for (var i = 0; i < N; i++) [[i, 0], [i, N - 1], [0, i], [N - 1, i]].forEach(function (q) { var k = (q[1] * N + q[0]) * 4; n++; if (d[k + 3] < 20) t++; });
          if (t / n <= 0.5) return res(false);
          // détourée, mais portée ? On cherche la peau (visage, cou) dans le haut de la silhouette.
          var op = 0, sk = 0;
          for (var y = 0; y < N * 0.4; y++) for (var X = 0; X < N; X++) {
            var k = (y * N + X) * 4, r = d[k], g = d[k + 1], b = d[k + 2];
            if (d[k + 3] < 128) continue; op++;
            if (r > 95 && g > 40 && b > 20 && r > g && r > b && r - g > 15 && Math.max(r, g, b) - Math.min(r, g, b) > 15) sk++;
          }
          res(!op || sk / op < 0.15);
        } catch (e) { res(false); }
      };
      im.onerror = function () { res(false); };
      im.src = sized(url, 96);
    }));
  }
  function mediaList(p) {
    var out = [];
    ((p.media && p.media.nodes) || []).forEach(function (m) {
      if (m.mediaContentType === 'IMAGE' && m.image) out.push({ type: 'image', src: m.image.url, alt: m.image.altText || m.alt || p.title, model: isModelPhoto(m.image.url, m.image.altText || m.alt), thermal: isThermalPhoto(m.image.url, m.image.altText || m.alt) && !isTechPhoto(m.image.url, m.image.altText || m.alt), rawAlt: m.image.altText || m.alt || '' });
      else if (m.mediaContentType === 'VIDEO' && m.sources && m.sources.length) {
        var mp4 = m.sources.filter(function (s) { return /mp4/.test(s.mimeType); }).sort(function (a, b) { return (b.height || 0) - (a.height || 0); });
        var best = mp4.filter(function (s) { return (s.height || 0) <= 1080; })[0] || mp4[mp4.length - 1] || m.sources[0];
        out.push({ type: 'video', src: best.url, poster: m.previewImage && m.previewImage.url, alt: m.alt || p.title });
      }
    });
    // photos thermiques : vue de devant / vue de dos (d'après le nom ou le texte alternatif, sinon l'ordre : 1re devant, 2e dos)
    var th = out.filter(function (x) { return x.thermal; });
    th.forEach(function (x, k) {
      var t = (x.rawAlt || '') + ' ' + String(x.src).split('?')[0].split('/').pop().replace(/[_-]+/g, ' ');
      x.view = /\b(dos|arri[eè]re|back)\b/i.test(t) ? 'Vue de dos' : /\b(devant|face|front)\b/i.test(t) ? 'Vue de devant' : (k % 2 ? 'Vue de dos' : 'Vue de devant');
    });
    if (!out.length && p.featuredImage) out.push({ type: 'image', src: p.featuredImage.url, alt: p.featuredImage.altText || p.title });
    return out;
  }
  // Pastilles de couleur : couleur/image définie dans Shopify, sinon couleurs courantes
  var COLORS = { blanc: '#F4F3EF', ecru: '#EDE6D6', beige: '#D8C7A8', camel: '#B8875A', marron: '#6B4A35', noir: '#1A1A1A',
    gris: '#9AA0A6', 'gris clair': '#C9CDD1', 'gris fonce': '#4A4F55', anthracite: '#3A3D42', bleu: '#2F5D9E', 'bleu marine': '#1F2A44', marine: '#1F2A44',
    vert: '#4E6B4A', kaki: '#6B6B3E', 'vert kaki': '#6B6B3E', rouge: '#B3312C', bordeaux: '#6D1F2A', rose: '#E7A9B8', orange: '#E8641F', jaune: '#E9C46A', violet: '#6A4C93',
    black: '#1A1A1A', white: '#F4F3EF', blue: '#2F5D9E', navy: '#1F2A44', red: '#B3312C', green: '#4E6B4A', grey: '#9AA0A6', gray: '#9AA0A6', pink: '#E7A9B8', khaki: '#6B6B3E', camouflage: 'linear-gradient(135deg,#4E5B3A 0 30%,#7A7450 30% 55%,#2F3526 55% 75%,#8C8460 75%)' };
  function swatchStyle(v) {
    var sw = v.swatch || {};
    if (sw.image && sw.image.previewImage) return 'background:url(' + JSON.stringify(sw.image.previewImage.url) + ') center/cover';
    var c = sw.color || COLORS[norm(v.name)];
    return c ? 'background:' + c : '';
  }
  // tailles toujours dans l'ordre XS → 3XL, quel que soit l'ordre saisi dans Shopify
  var SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL', '4XL'];
  function isBlack(n) { n = norm(n); return n === 'noir' || n === 'black' || n.indexOf('noir') === 0 || n.indexOf('black') === 0; }
  function sortSizes(p) {
    (p.options || []).forEach(function (o) {
      // couleur : le noir est placé au milieu des pastilles
      if (norm(o.name) === 'couleur') {
        var bi = -1; o.optionValues.forEach(function (v, i) { if (bi < 0 && isBlack(v.name)) bi = i; });
        if (bi > -1 && o.optionValues.length > 2) { var bk = o.optionValues.splice(bi, 1)[0]; o.optionValues.splice(Math.floor(o.optionValues.length / 2), 0, bk); }
        return;
      }
      if (norm(o.name) !== 'taille') return;
      o.optionValues.sort(function (a, b) {
        var ia = SIZE_ORDER.indexOf(String(a.name).toUpperCase()), ib = SIZE_ORDER.indexOf(String(b.name).toUpperCase());
        if (ia < 0 && ib < 0) return 0; if (ia < 0) return 1; if (ib < 0) return -1; return ia - ib;
      });
    });
  }
  // variantes « avec batterie » (toutes si le produit n'a pas d'option Batterie)
  function withBattery(p) {
    var opt = optionOf(p, 'Batterie'); if (!opt) return p.variants.nodes;
    var out = p.variants.nodes.filter(function (v) {
      return v.selectedOptions.some(function (o) { return norm(o.name) === 'batterie' && norm(o.value).indexOf('sans') !== 0; });
    });
    return out.length ? out : p.variants.nodes;
  }
  function optionOf(p, name) {
    var n = norm(name);
    return (p.options || []).filter(function (o) { return norm(o.name) === n; })[0];
  }
  function valueAvailable(p, optName, value) {
    return p.variants.nodes.some(function (v) {
      return v.availableForSale && v.selectedOptions.some(function (o) { return norm(o.name) === norm(optName) && o.value === value; });
    });
  }

  /* ---------- panier (Cart API) ---------- */
  var CART_FIELDS = 'id checkoutUrl totalQuantity cost { subtotalAmount { amount currencyCode } } ' +
    'lines(first: 50) { nodes { id quantity cost { totalAmount { amount currencyCode } } ' +
    'merchandise { ... on ProductVariant { id title image { url altText } price { amount currencyCode } product { title handle featuredImage { url altText } } } } } }';
  var cart = null;

  function getCart() {
    var id = load(CART_KEY);
    if (!id) return Promise.resolve(null);
    return gql('query C($id: ID!) { cart(id: $id) { ' + CART_FIELDS + ' } }', { id: id }).then(function (d) {
      if (!d.cart) { store(CART_KEY, null); return null; }
      return d.cart;
    });
  }
  function checkErrors(res) {
    if (res.userErrors && res.userErrors.length) throw new Error(res.userErrors.map(function (e) { return e.message; }).join(' / '));
    return res.cart;
  }
  function createCart(lines) {
    return gql('mutation M($input: CartInput!) { cartCreate(input: $input) { cart { ' + CART_FIELDS + ' } userErrors { message } } }',
      { input: { lines: lines } }).then(function (d) { var c = checkErrors(d.cartCreate); store(CART_KEY, c.id); return c; });
  }
  function addLines(lines) {
    var id = load(CART_KEY);
    if (!id) return createCart(lines);
    return gql('mutation M($id: ID!, $lines: [CartLineInput!]!) { cartLinesAdd(cartId: $id, lines: $lines) { cart { ' + CART_FIELDS + ' } userErrors { message } } }',
      { id: id, lines: lines }).then(function (d) {
        if (!d.cartLinesAdd.cart) { store(CART_KEY, null); return createCart(lines); }
        return checkErrors(d.cartLinesAdd);
      });
  }
  function updateLine(lineId, qty) {
    var id = load(CART_KEY);
    if (qty <= 0) {
      return gql('mutation M($id: ID!, $ids: [ID!]!) { cartLinesRemove(cartId: $id, lineIds: $ids) { cart { ' + CART_FIELDS + ' } userErrors { message } } }',
        { id: id, ids: [lineId] }).then(function (d) { return checkErrors(d.cartLinesRemove); });
    }
    return gql('mutation M($id: ID!, $lines: [CartLineUpdateInput!]!) { cartLinesUpdate(cartId: $id, lines: $lines) { cart { ' + CART_FIELDS + ' } userErrors { message } } }',
      { id: id, lines: [{ id: lineId, quantity: qty }] }).then(function (d) { return checkErrors(d.cartLinesUpdate); });
  }

  /* ---------- panier latéral (UI) ---------- */
  var css = '' +
    '.oc-badge{position:absolute;top:4px;right:2px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#14212B;color:#fff;font:700 11px/18px Manrope,sans-serif;text-align:center;pointer-events:none}' +
    '.oc-badge[hidden]{display:none}' +
    '.oc-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);opacity:0;pointer-events:none;transition:opacity .3s;z-index:200}' +
    '.oc-overlay.is-open{opacity:1;pointer-events:auto}' +
    '.oc-drawer{font-family:\'DM Sans\',system-ui,-apple-system,sans-serif;position:fixed;top:0;right:0;bottom:0;width:min(420px,100%);background:#F8F6F1;color:#14212B;z-index:201;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .35s cubic-bezier(.65,0,.35,1),visibility 0s .35s;visibility:hidden}' +
    '.oc-drawer.is-open{transform:none;visibility:visible;transition:transform .35s cubic-bezier(.65,0,.35,1);box-shadow:-20px 0 60px -30px rgba(0,0,0,.4)}' +
    '.oc-head{display:flex;align-items:center;justify-content:space-between;padding:22px 24px;border-bottom:1px solid #E4DFD5}' +
    '.oc-head h2{margin:0;font:300 22px/1.1 Manrope,sans-serif;text-transform:uppercase;letter-spacing:.01em}' +
    '.oc-close{width:40px;height:40px;border:0;background:transparent;font-size:26px;line-height:1;cursor:pointer;color:#14212B}' +
    '.oc-body{flex:1;overflow-y:auto;padding:8px 24px}' +
    '.oc-empty{padding:48px 0;text-align:center;color:#55616B;display:flex;flex-direction:column;align-items:center;gap:20px}' +
    '.oc-line{display:grid;grid-template-columns:76px 1fr auto;gap:14px;padding:18px 0;border-bottom:1px solid #E4DFD5}' +
    '.oc-img{width:76px;height:76px;background:transparent;object-fit:cover;display:block}' +
    '.oc-name{font:600 15px/1.25 Manrope,sans-serif;margin:0 0 4px}' +
    '.oc-var{font-size:13px;color:#8A949B;margin:0 0 10px}' +
    '.oc-qty{display:inline-flex;align-items:center;border:1px solid #C9C2B4;border-radius:999px;background:#fff}' +
    '.oc-qty button{width:32px;height:32px;border:0;background:transparent;font-size:17px;cursor:pointer;color:#14212B}' +
    '.oc-qty span{min-width:22px;text-align:center;font:700 14px Manrope,sans-serif}' +
    '.oc-price{font:700 15px Manrope,sans-serif;text-align:right;white-space:nowrap}' +
    '.oc-rm{display:block;margin-top:8px;border:0;background:none;padding:0;font-size:12px;color:#8A949B;text-decoration:underline;cursor:pointer}' +
    '.oc-foot{padding:20px 24px 24px;border-top:1px solid #E4DFD5;display:flex;flex-direction:column;gap:12px;background:#F8F6F1}' +
    '.oc-sub{display:flex;justify-content:space-between;font:700 17px Manrope,sans-serif}' +
    '.oc-ship{display:flex;justify-content:space-between;font-size:14px;color:#55616B;margin-top:-4px}' +
    '.oc-note{margin:0;font-size:12.5px;color:#8A949B}' +
    '.oc-btn{display:flex;align-items:center;justify-content:center;min-height:54px;border:0;border-radius:999px;background:#14212B;color:#fff;font:700 16px Manrope,sans-serif;cursor:pointer;text-decoration:none;padding:0 28px}' +
    '.oc-btn[disabled]{opacity:.5;cursor:default}' +
    '.oc-busy{opacity:.55;pointer-events:none}' +
    '.oc-msg{margin:8px 0 0;font-size:13px;color:#C2361F}' +
    '.pc-car{position:relative;width:100%;aspect-ratio:1/1;overflow:hidden;background:transparent}' +
    '.pc-car > video,.pc-car > .pc-car-base{position:absolute;inset:0;width:100% !important;height:100% !important;aspect-ratio:auto !important;object-fit:cover;display:block}' +
    '.pc-car > .pc-car-base{object-fit:contain !important;object-position:center}' +
    '.pc-car > video,.pc-car > .pc-car-base{transition:opacity .35s ease}' +
    '.pc-car > .is-off{opacity:0 !important}' +
    '.pc-thermal{position:absolute;left:50%;bottom:0;margin-left:0;white-space:nowrap;translate:-50% 0;z-index:4;display:inline-flex;align-items:center;gap:6px;padding:3px 9px;background:#FFD23F;color:#14212B;font:700 9.5px/1.2 Manrope,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;pointer-events:none;opacity:0;transition:opacity .15s ease}' +
    '.pc-thermal::before{content:"";width:7px;height:7px;border-radius:50%;background:linear-gradient(135deg,#FFE14D,#FF7A1A 45%,#D61F6B 75%,#5A1FA8)}' +
    '.pc-thermal.is-on{opacity:1}' +
    '.pc-view{position:absolute;left:10px;top:10px;z-index:4;padding:4px 9px;background:rgba(14,20,26,.78);color:#fff;font:500 10.5px/1.2 Manrope,Arial,sans-serif;letter-spacing:.04em;pointer-events:none;opacity:0;transition:opacity .15s ease}' +
    '.pc-view.is-on{opacity:1}' +
    '.pc-car-slide{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center;opacity:0;transition:opacity .35s ease;pointer-events:none}' +
    '.pc-car-slide.is-on{opacity:1}' +
    '.pc-dots{display:none !important}' +
    '.pc-arrow{background:transparent !important;box-shadow:none !important;border:0 !important;border-radius:0 !important;width:28px !important}.pc-arrow:hover{background:transparent !important}.pc-arrow svg{width:18px !important;height:18px !important;stroke:#000000 !important;stroke-width:2.2 !important;filter:drop-shadow(0 0 1px #FFFFFF) drop-shadow(0 0 3px #FFFFFF) drop-shadow(0 0 8px rgba(255,255,255,.95)) drop-shadow(0 0 16px rgba(255,255,255,.8))}.pc-arrow-prev{left:2px !important}.pc-arrow-next{right:2px !important}' +
    '.pc-car::after{content:"\\2019Otreau";position:absolute;top:10px;right:12px;z-index:3;font:300 13px/1 Manrope,sans-serif;letter-spacing:.01em;color:#8A949B;pointer-events:none}' +
    '.pc-car{perspective:1100px}.pc-car.is-swing > img{visibility:hidden}.pc-swing{position:absolute;inset:0;z-index:1;pointer-events:none;perspective:1100px;overflow:hidden}.pc-swing img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;backface-visibility:hidden;-webkit-backface-visibility:hidden;transform-origin:50% 50%;transition:transform 1s cubic-bezier(.45,0,.2,1),opacity 1s cubic-bezier(.45,0,.2,1),filter 1s ease}.pc-swing-out{transform:rotateY(0) scale(1);opacity:1}.pc-swing-in{transform:rotateY(calc(var(--d) * 70deg)) scale(.86);opacity:0;filter:brightness(.85)}.pc-swing.is-go .pc-swing-out{transform:rotateY(calc(var(--d) * -70deg)) scale(.86);opacity:0;filter:brightness(.85)}.pc-swing.is-go .pc-swing-in{transform:rotateY(0) scale(1);opacity:1;filter:none}' +
    '.pc-arrow{position:absolute;top:50%;z-index:2;width:32px;height:32px;margin-top:-16px;border:0;border-radius:50%;background:rgba(255,255,255,.88);box-shadow:0 2px 8px rgba(0,0,0,.12);display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;transition:opacity .2s,background .2s}' +
    '.pc-arrow svg{width:15px;height:15px;fill:none;stroke:#14212B;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}' +
    '.pc-arrow:hover{background:#fff}' +
    '.pc-arrow-prev{left:10px}.pc-arrow-next{right:10px}' +
    'a:hover .pc-arrow,.pc-car:focus-within .pc-arrow{opacity:1}' +
    '@media (hover:none){.pc-arrow{opacity:.9}}' +
    '.pc-dots{position:absolute;left:0;right:0;bottom:12px;z-index:2;display:flex;justify-content:center;gap:6px;opacity:0;transition:opacity .3s}' +
    'a:hover .pc-dots{opacity:1}' +
    '@media (hover:none){.pc-dots{opacity:1}}' +
    '.pc-dots span{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.55);box-shadow:0 0 2px rgba(0,0,0,.3);transition:background .3s,transform .3s}' +
    '.pc-dots span.is-on{background:#fff;transform:scale(1.25)}' +
    '.pd-main.has-media{background:transparent}' +
    '.pc-colors{display:flex;justify-content:center;flex-wrap:wrap;gap:12px;margin-top:6px;padding:4px}' +
    '.pc-color{width:22px;height:22px;padding:0;border-radius:50%;border:0;box-shadow:0 0 0 1px rgba(20,33,43,.12);cursor:pointer;font:700 10px Manrope,sans-serif;color:#14212B;background:#F4F3EF;transition:transform .15s,box-shadow .15s}' +
    '.pc-color:hover{transform:scale(1.12)}' +
    '.pc-color[aria-pressed="true"]{transform:scale(1.08);box-shadow:0 0 0 3px #FFFFFF,0 0 0 5px #1F6342,0 4px 10px rgba(20,33,43,.25)}' +
    '.pc-arrow[hidden]{display:none !important}' +
    'html.shop-pending [data-handle],html.shop-pending .pd-x[data-shop-handle]{visibility:hidden}' +
    '@media (min-width:561px){.product-grid.is-few{grid-template-columns:repeat(var(--n),minmax(0,300px)) !important;justify-content:center}}' +
    '.pd-info .pd-size-row{position:relative;justify-content:flex-start !important;gap:10px !important;padding:10px calc(50% - 30px) !important;scroll-snap-type:x mandatory;' +
      '-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 22%,#000 78%,transparent 100%);mask-image:linear-gradient(90deg,transparent 0,#000 22%,#000 78%,transparent 100%)}' +
    '.pd-info .pd-size-row > *{margin:0 !important;scroll-snap-align:center;scroll-snap-stop:normal;transition:transform .12s ease-out,opacity .12s ease-out,background .1s,color .1s}' +
    '.pd-info .pd-size-row.has-pick > :not([aria-pressed="true"]){transform:scale(.9);opacity:.7}' +
    '.pd-info .pd-size-row > [aria-pressed="true"]{transform:scale(1.22);opacity:1;z-index:1}' +
    '.pd-pack-items div.is-off{opacity:1 !important}' +
    '.pd-pack-items div.is-off > svg,.pd-pack-items div.is-off > span{opacity:.35}' +
    '.pd-pack-add{display:none;margin-top:4px;min-height:34px;padding:0 14px;border:0;border-radius:999px;background:#14212B;color:#fff;font:700 12.5px Manrope,sans-serif;cursor:pointer;white-space:nowrap}' +
    '.pd-pack-add:hover{background:#2A3A46}' +
    '.pd-pack-items div.is-off .pd-pack-add{display:inline-flex;align-items:center}' +
    '.pd-arrow{position:absolute;top:50%;z-index:2;width:40px;height:40px;margin-top:-20px;border:0;border-radius:50%;background:rgba(255,255,255,.85);box-shadow:0 2px 10px rgba(0,0,0,.12);display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:.85;transition:opacity .2s,background .2s}' +
    '.pd-arrow:hover{opacity:1;background:#fff}' +
    '.pd-arrow svg{width:18px;height:18px;fill:none;stroke:#14212B;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '.pd-arrow-prev{left:12px}.pd-arrow-next{right:12px}' +
    '.pd-main .pd-arrow,.pd-main .pd-count{opacity:0;pointer-events:none;transition:opacity .25s}' +
    '.pd-main.is-ui .pd-arrow,.pd-main.is-ui .pd-count{opacity:.9;pointer-events:auto}' +
    '@media (hover:hover){.pd-main:hover .pd-arrow,.pd-main:hover .pd-count{opacity:.9;pointer-events:auto}}' +
    '.pd-main .pd-arrow:hover{opacity:1}' +
    '.pd-thumbs{display:flex !important;flex-wrap:nowrap;gap:8px;overflow:hidden}' +
    '.pd-thumbs .pd-thumb{position:relative;flex:0 0 auto;width:68px;height:68px;aspect-ratio:auto}' +
    '.pd-thumb-more{font:700 20px/1 Manrope,sans-serif;letter-spacing:.05em;color:#14212B;background:transparent !important;border:1.5px solid #E4DFD5 !important}' +
    '.pd-thumb-more:hover{border-color:#14212B !important}' +
    '.pd-thumb-play{position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(0,0,0,.55)}' +
    '.pd-thumb-play::after{content:"";position:absolute;left:8px;top:6px;border-left:8px solid #fff;border-top:5px solid transparent;border-bottom:5px solid transparent}' +
    '@media (max-width:480px){.pd-thumbs .pd-thumb{width:56px;height:56px}}' +
    '.pd-thumb.has-img{background:transparent;border-color:#E4DFD5}' +
    '.pd-thumb.has-img.is-active{border-color:#14212B}' +
    '.ttc{font-size:.62em;font-weight:600;letter-spacing:.04em;opacity:.7;margin-left:2px}' +
    '.is-out{position:relative;opacity:.45;text-decoration:line-through}' +
    'body.oc-lock{overflow:hidden}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var overlay = document.createElement('div'); overlay.className = 'oc-overlay';
  var drawer = document.createElement('aside');
  drawer.className = 'oc-drawer'; drawer.setAttribute('aria-label', 'Panier'); drawer.setAttribute('aria-hidden', 'true');
  drawer.innerHTML = '<div class="oc-head"><h2>Votre panier</h2><button type="button" class="oc-close" aria-label="Fermer le panier">×</button></div>' +
    '<div class="oc-body"></div><div class="oc-foot"></div>';
  document.body.appendChild(overlay); document.body.appendChild(drawer);
  var body = drawer.querySelector('.oc-body'), foot = drawer.querySelector('.oc-foot');

  function openCart() { overlay.classList.add('is-open'); drawer.classList.add('is-open'); drawer.setAttribute('aria-hidden', 'false'); document.body.classList.add('oc-lock'); }
  function closeCart() { overlay.classList.remove('is-open'); drawer.classList.remove('is-open'); drawer.setAttribute('aria-hidden', 'true'); document.body.classList.remove('oc-lock'); }
  overlay.addEventListener('click', closeCart);
  drawer.querySelector('.oc-close').addEventListener('click', closeCart);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeCart(); });

  // icône panier du menu
  var badges = [];
  document.querySelectorAll('a[aria-label="Panier"]').forEach(function (a) {
    a.style.position = 'relative';
    var b = document.createElement('span'); b.className = 'oc-badge'; b.hidden = true; a.appendChild(b); badges.push(b);
    a.addEventListener('click', function (e) { e.preventDefault(); renderCart(); openCart(); });
  });

  function renderCart(err) {
    var n = cart ? cart.totalQuantity : 0;
    badges.forEach(function (b) { b.textContent = n; b.hidden = !n; });
    if (!cart || !cart.lines.nodes.length) {
      body.innerHTML = '<div class="oc-empty"><p style="margin:0">Votre panier est vide.</p>' +
        '<a class="oc-btn" href="index.html#collection">Voir la collection</a></div>' + (err ? '<p class="oc-msg">' + esc(err) + '</p>' : '');
      foot.innerHTML = ''; foot.hidden = true;
      body.querySelector('.oc-btn').addEventListener('click', closeCart);
      return;
    }
    foot.hidden = false;
    body.innerHTML = cart.lines.nodes.map(function (l) {
      var m = l.merchandise, img = (m.image || m.product.featuredImage || {}).url;
      var variant = m.title && m.title !== 'Default Title' ? m.title : '';
      return '<div class="oc-line" data-line="' + esc(l.id) + '">' +
        (img ? '<img class="oc-img" src="' + esc(img + (img.indexOf('?') > -1 ? '&' : '?') + 'width=200') + '" alt="">' : '<div class="oc-img"></div>') +
        '<div><p class="oc-name">' + titleHtml(m.product.title) + '</p>' + (variant ? '<p class="oc-var">' + esc(variant) + '</p>' : '') +
        '<div class="oc-qty"><button type="button" data-d="-1" aria-label="Retirer un">−</button><span>' + l.quantity + '</span><button type="button" data-d="1" aria-label="Ajouter un">+</button></div></div>' +
        '<div><div class="oc-price">' + money(l.cost.totalAmount) + '</div><button type="button" class="oc-rm">Retirer</button></div></div>';
    }).join('') + (err ? '<p class="oc-msg">' + esc(err) + '</p>' : '');
    foot.innerHTML = '<div class="oc-sub"><span>Sous-total</span><span>' + ttc(cart.cost.subtotalAmount) + '</span></div>' +
      '<div class="oc-ship"><span>Livraison</span><span>3,20 € ' + TTC + '</span></div>' +
      '<p class="oc-note">Prix TTC. Les frais de livraison sont ajoutés à l’étape du paiement.</p>' +
      '<a class="oc-btn" href="' + esc(cart.checkoutUrl) + '">Paiement sécurisé</a>';
    body.querySelectorAll('.oc-line').forEach(function (row) {
      var id = row.dataset.line, line = cart.lines.nodes.filter(function (l) { return l.id === id; })[0];
      function change(q) {
        row.classList.add('oc-busy');
        updateLine(id, q).then(function (c) { cart = c; renderCart(); })
          .catch(function (e) { row.classList.remove('oc-busy'); renderCart('Impossible de modifier le panier. ' + e.message); });
      }
      row.querySelectorAll('[data-d]').forEach(function (b) { b.addEventListener('click', function () { change(line.quantity + parseInt(b.dataset.d, 10)); }); });
      row.querySelector('.oc-rm').addEventListener('click', function () { change(0); });
    });
  }

  getCart().then(function (c) { cart = c; renderCart(); }).catch(function () { renderCart(); });

  /* ---------- cartes produit (accueil) ---------- */
  var cardEls = document.querySelectorAll('[data-handle],[data-shop-handle]');
  var handles = [];
  cardEls.forEach(function (el) { var h = el.dataset.handle || el.dataset.shopHandle; if (handles.indexOf(h) < 0) handles.push(h); });
  // tant que Shopify n'a pas répondu, on masque les cartes (évite d'afficher des produits qui n'existent pas)
  document.documentElement.classList.add('shop-pending');
  var pendingTimer = setTimeout(function () { document.documentElement.classList.remove('shop-pending'); }, 5000);
  function shopDone() { clearTimeout(pendingTimer); document.documentElement.classList.remove('shop-pending'); }

  // Retire du site tout produit qui n'existe pas (ou plus) dans Shopify :
  // cartes de l'accueil, lignes mobiles, liens du menu, suggestions de la page produit.
  function removeMissing(map) {
    document.querySelectorAll('[data-handle],[data-shop-handle]').forEach(function (el) {
      var h = el.dataset.handle || el.dataset.shopHandle; if (!map[h]) el.remove();
    });
    document.querySelectorAll('.cat-row').forEach(function (r) {
      var n = r.querySelectorAll('[data-handle]').length;
      if (!n) r.remove(); else if (n < 2) { var sm = r.querySelector('.cat-title small'); if (sm) sm.remove(); }
    });
    var grid = document.querySelector('.product-grid');
    if (grid) {
      // après le retrait des produits absents de Shopify : toujours 4 produits sur la première ligne
      [].slice.call(grid.querySelectorAll(':scope > a[data-handle]')).forEach(function (a, i) { a.classList.toggle('product-extra', i >= 4); });
      var n = grid.querySelectorAll(':scope > a').length;
      if (!grid.querySelector('.product-extra')) { var w = document.querySelector('.show-all-wrap'); if (w) w.style.display = 'none'; }
      if (n && n < 4) { grid.classList.add('is-few'); grid.style.setProperty('--n', n); }
      // filtres par type inutiles tant qu'il n'y a qu'un produit
      if (n < 2) { var tf = document.querySelector('.type-filters'); if (tf) tf.style.display = 'none'; }
    }
    document.querySelectorAll('.pd-cross-grid').forEach(function (g) { if (!g.querySelector('.pd-x')) { var sec = g.closest('section'); if (sec) sec.remove(); } });
  }

  /* ---------- page produit ---------- */
  var pdInfo = document.querySelector('[data-shopify-handle]');
  // retire l'écran d'attente (logo) une fois la page produit remplie avec les vraies données
  function pdReady() {
    var h = document.documentElement; if (!h.classList.contains('pd-loading')) return;
    requestAnimationFrame(function () { h.classList.add('pd-ready'); setTimeout(function () { h.classList.remove('pd-loading', 'pd-ready'); }, 450); });
  }
  if (pdInfo && handles.indexOf(pdInfo.dataset.shopifyHandle) < 0) handles.push(pdInfo.dataset.shopifyHandle);

  // Accueil : toute la collection vient de Shopify. Chaque produit publié reçoit sa carte
  // (les cartes déjà écrites dans la page sont réutilisées), avec une catégorie pour les filtres.
  function catOf(p) {
    var c = ((p.category && p.category.name) || '') + ' ' + (p.productType || '') + ' ' + (p.title || '');
    if (/vest\b|vests|gilet/i.test(c)) return 'gilet';
    if (/parka/i.test(c)) return 'parka';
    if (/glove|mitten|sock|gant|chaussette/i.test(c)) return 'accessoire';
    return 'veste';
  }
  function pageOf(h) { return PRODUCT_PAGES[h] || ('produit.html?p=' + encodeURIComponent(h)); }
  function buildCollection() {
    var grid = document.querySelector('.product-grid');
    if (!grid) return Promise.resolve();
    return gql('{ products(first: 100) { nodes { handle title productType category { name } } } }').then(function (d) {
      var tpl = grid.querySelector(':scope > a[data-handle]');
      var all = d.products.nodes;
      function strip(h) { return h.replace(/-otreau$/, ''); }
      all.forEach(function (p) {
        var card = [].slice.call(grid.querySelectorAll(':scope > a[data-handle]')).filter(function (a) { return strip(a.dataset.handle) === strip(p.handle); })[0];
        if (!card && tpl) {
          card = tpl.cloneNode(true);
          var v = card.querySelector('video');
          if (v) { var ph = document.createElement('div'); ph.className = 'pc-ph'; ph.setAttribute('style', 'width: 100%; aspect-ratio: 1 / 1; background: transparent'); v.replaceWith(ph); }
          card.querySelectorAll('.pc-car').forEach(function (c) { c.remove(); });
          card.dataset.handle = p.handle;
          var h3 = card.querySelector('h3'); if (h3) h3.innerHTML = titleHtml(p.title);
          var pr = card.querySelector('.pc-price'); if (pr) pr.textContent = '';
          grid.appendChild(card);
        }
        if (!card) return;
        card.dataset.cat = catOf(p);
        card.href = pageOf(p.handle);
        if (handles.indexOf(card.dataset.handle) < 0) handles.push(card.dataset.handle);
      });
      // les 4 premiers produits sont visibles, les suivants s'affichent avec « Voir toute la collection »
      [].slice.call(grid.querySelectorAll(':scope > a[data-handle]')).forEach(function (a, i) { a.classList.toggle('product-extra', i >= 4); });
      document.dispatchEvent(new CustomEvent('otreau:collection'));
    }).catch(function () {});
  }

  buildCollection().then(function () { return fetchProducts(handles); }).then(function (map) {
    removeMissing(map);
    shopDone();
    // cartes (y compris les copies des lignes mobiles)
    document.querySelectorAll('[data-handle]').forEach(function (el) {
      var p = map[el.dataset.handle]; if (!p) return;
      var h3 = el.querySelector('h3');
      if (h3 && p.title) h3.innerHTML = titleHtml(p.title);
      // Accueil : la vidéo du site (dossier assets) reste toujours en premier,
      // puis les photos Shopify, accessibles avec les petites flèches.
      // Règle : la vidéo Shopify du produit sert UNIQUEMENT ici (accueil), en premier ;
      // à défaut, on garde la vidéo du dossier assets.
      var list = mediaList(p), shopVid = list.filter(function (x) { return x.type === 'video'; })[0];
      var imgs = list.filter(function (x) { return x.type === 'image'; });
      var vid = el.querySelector('video'), ph = vid || (h3 && h3.parentNode.previousElementSibling);
      // Accueil : pas de vidéo dans les cartes produit, uniquement les photos
      if (false && shopVid && ph) {
        if (!vid) {
          vid = document.createElement('video'); vid.muted = true; vid.playsInline = true; vid.loop = true; vid.autoplay = true; vid.preload = 'metadata';
          vid.setAttribute('style', 'width: 100%; aspect-ratio: 1 / 1; object-fit: cover; background: transparent; display: block');
          ph.replaceWith(vid); ph = vid;
        }
        vid.src = shopVid.src; if (shopVid.poster) vid.poster = sized(shopVid.poster, 800);
        vid.setAttribute('aria-label', shopVid.alt);
      }
      // Accueil : le défilement automatique ne montre que les photos du produit seul (détouré, sans mannequin ni fond) ;
      // au clic, toutes les photos sont accessibles
      if (imgs.length && ph) {
        if (vid) { var hold = document.createElement('div'); hold.className = 'pc-ph'; hold.setAttribute('style', 'width:100%;aspect-ratio:1/1'); vid.replaceWith(hold); ph = hold; vid = null; }
        (function (ph, imgs) {
          var cand = imgs.filter(function (x) { return !x.model && !isTechPhoto(x.src, x.rawAlt); });
          Promise.all(cand.map(function (x) { return isCutout(x.src); })).then(function (ok) {
            var packs = cand.filter(function (_, k) { return ok[k]; });
            var pick = packs.length ? packs : imgs.filter(function (x) { return !isTechPhoto(x.src, x.rawAlt); });
            if (!pick.length) pick = imgs;
            // toutes les photos restent accessibles aux flèches ; seules celles retenues défilent toutes seules
            var all = imgs.map(function (x) { return Object.assign({}, x, { auto: pick.indexOf(x) > -1 || !!x.thermal }); });
            var first = 0; all.some(function (x, k) { if (x.auto) { first = k; return true; } });
            if (ph.isConnected) cardCarousel(ph, all, false, first ? { start: first } : undefined);
          });
        })(ph, imgs);
      }
      else if (vid) { var ph2 = document.createElement('div'); ph2.className = 'pc-ph'; ph2.setAttribute('style', 'width:100%;aspect-ratio:1/1;background:#EFEFEF'); vid.replaceWith(ph2); }
      var price = el.querySelector('.pc-price');
      if (!price && h3) { price = document.createElement('p'); price.className = 'pc-price'; h3.insertAdjacentElement('afterend', price); }
      if (price) {
        // prix affiché = version AVEC batterie
        var pv = withBattery(p), lo = pv.reduce(function (a, b) { return parseFloat(b.price.amount) < parseFloat(a.price.amount) ? b : a; });
        var multi = pv.some(function (v) { return v.price.amount !== lo.price.amount; });
        price.innerHTML = (multi ? 'Dès ' : '') + ttc(lo.price);
      }
      cardColors(el, p);
      var sizes = el.querySelector('.pc-sizes'), opt = optionOf(p, 'Taille');
      if (sizes && !opt) sizes.hidden = true;   // produit sans option Taille dans Shopify
      if (sizes && opt) {
        sizes.innerHTML = opt.optionValues.map(function (v) {
          var ok = !p.availableForSale || valueAvailable(p, opt.name, v.name);
          return '<li' + (ok ? '' : ' class="is-out" title="Épuisé"') + '>' + esc(v.name) + '</li>';
        }).join('');
      }
    });
    if (pdInfo) { try { initProductPage(map[pdInfo.dataset.shopifyHandle]); } finally { pdReady(); } }
  }).catch(function (e) {
    shopDone();
    if (window.console) console.warn('[Otreau] Shopify indisponible :', e.message);
    if (pdInfo) { try { initProductPage(null); } finally { pdReady(); } }
  });

  function initProductPage(p) {
    var addBtn = document.querySelector('.pd-add'), priceEl = document.getElementById('pd-price'), qtyEl = document.getElementById('pd-qty');
    var msg = document.createElement('p'); msg.className = 'oc-msg'; msg.hidden = true;
    addBtn.parentNode.insertAdjacentElement('afterend', msg);
    function say(t) { msg.textContent = t; msg.hidden = !t; }

    if (!p) {
      addBtn.addEventListener('click', function () { say('La boutique ouvre très bientôt : ce produit n’est pas encore disponible à la commande.'); });
      return;
    }

    // Titre, description et galerie depuis Shopify
    var h1 = document.querySelector('.pd-title');
    if (h1 && p.title) { h1.innerHTML = titleHtml(p.title); document.title = plainTitle(p.title) + ' · Otreau'; }
    var crumb = document.querySelector('.pd-crumb [aria-current="page"]');
    if (crumb && p.title) crumb.textContent = plainTitle(p.title);
    if (p.descriptionHtml && p.descriptionHtml.trim()) {
      [].slice.call(document.querySelectorAll('.pd-acc')).forEach(function (d) {
        var s = d.querySelector('summary span');
        if (s && norm(s.textContent) === 'description') d.querySelector('.pd-acc-body').innerHTML = p.descriptionHtml;
      });
    }
    // Règle : pas de vidéo sur la page produit (la vidéo est réservée à la page d'accueil)
    var gallery = buildGallery(mediaList(p).filter(function (x) { return x.type !== 'video'; }));
    // « Puis-je laver la veste / le gilet ? » selon le produit
    var packItem = document.getElementById('pd-pack-item');
    if (packItem && p.title) packItem.textContent = '1 ' + baseTitle(p.title).toLocaleLowerCase('fr-FR');
    var washQ = document.getElementById('pd-wash-q');
    if (washQ && p.title) {
      var base = baseTitle(p.title), first = base.split(' ')[0];
      var art = { VESTE: 'la ', DOUDOUNE: 'la ', PARKA: 'la ', GILET: 'le ', GANTS: 'les ', CHAUSSETTES: 'les ' }[first];
      washQ.textContent = 'Puis-je laver ' + (art ? art + base.toLocaleLowerCase('fr-FR') : 'ce vêtement') + '\u00a0?';
    }

    // Associe chaque groupe d'options de la page à une option Shopify (Taille, Batterie, Couleur…)
    var groups = [];
    document.querySelectorAll('.pd-info .pd-opts').forEach(function (box) {
      var label = box.getAttribute('aria-label'), opt = optionOf(p, label), field = box.closest('.pd-field');
      if (!opt) {
        field.hidden = true;
        // pas d’option Batterie dans Shopify : on retire aussi la question « La batterie est-elle incluse ? »
        if (norm(label) === 'batterie') { var bq = document.querySelector('.pd-faq-row .pd-faq-field:not(.pd-wash)'); if (bq) bq.hidden = true; }
        return;
      }
      var old = [].slice.call(box.children), isSwatch = old.some(function (b) { return b.classList.contains('pd-swatch'); });
      box.innerHTML = '';
      opt.optionValues.forEach(function (v, i) {
        var tpl = old.filter(function (b) { return norm(b.dataset.name || b.textContent) === norm(v.name); })[0];
        var b, sw = isSwatch && swatchStyle(v);
        if (isSwatch && tpl) { b = tpl.cloneNode(true); }
        else if (sw) {
          b = document.createElement('button'); b.type = 'button'; b.className = 'pd-swatch';
          b.setAttribute('aria-label', v.name); b.title = v.name; b.dataset.name = v.name; b.setAttribute('style', sw);
        }
        else {
          b = document.createElement('button'); b.type = 'button'; b.className = 'pd-opt'; b.textContent = v.name;
          // batterie : présentée comme une réponse (« Inclure » / « Ne pas inclure »)
          if (norm(opt.name) === 'batterie') b.textContent = norm(v.name).indexOf('sans') === 0 ? 'Sans batterie' : 'Avec batterie';
        }
        b.dataset.value = v.name; b.removeAttribute('data-group');
        b.setAttribute('aria-pressed', 'false');
        box.appendChild(b);
      });
      groups.push({ name: opt.name, box: box, field: field, selected: null, count: opt.optionValues.length });
    });

    function pick(g, value, noCenter) {
      g.selected = value;
      g.box.querySelectorAll('[data-value]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.value === value ? 'true' : 'false'); });
      if (norm(g.name) === 'couleur') { var c = document.getElementById('pd-color'); if (c) c.textContent = value; }
      if (norm(g.name) === 'taille') { g.box.classList.add('has-pick'); if (!noCenter) { g.lock = Date.now() + 450; centerSize(g.box, g.box.querySelector('[aria-pressed="true"]'), true); } }
      if (norm(g.name) === 'batterie') { var pk = document.getElementById('pd-pack-batt'); if (pk) pk.classList.toggle('is-off', norm(value).indexOf('sans') === 0); }
      refresh(); say('');
    }
    // Contenu du pack : bouton « Inclure la batterie » quand le client a choisi « Sans batterie »
    var battGroup = groups.filter(function (g) { return norm(g.name) === 'batterie'; })[0];
    var packBatt = document.getElementById('pd-pack-batt');
    if (battGroup && packBatt) {
      var withValue = [].slice.call(battGroup.box.querySelectorAll('[data-value]')).map(function (b) { return b.dataset.value; })
        .filter(function (v) { return norm(v).indexOf('sans') !== 0; })[0];
      if (withValue) {
        var inc = document.createElement('button'); inc.type = 'button'; inc.className = 'pd-pack-add';
        inc.textContent = '+ Inclure';
        inc.addEventListener('click', function () { pick(battGroup, withValue); });
        packBatt.appendChild(inc);
      }
    }
    groups.forEach(function (g) {
      g.box.addEventListener('click', function (e) { var b = e.target.closest('[data-value]'); if (b) pick(g, b.dataset.value); });
    });

    function current() {
      return p.variants.nodes.filter(function (v) {
        return groups.every(function (g) {
          if (!g.selected) return false;
          return v.selectedOptions.some(function (o) { return norm(o.name) === norm(g.name) && o.value === g.selected; });
        });
      })[0];
    }
    function refresh() {
      // valeurs disponibles compte tenu des autres choix
      groups.forEach(function (g) {
        g.box.querySelectorAll('[data-value]').forEach(function (b) {
          var ok = p.variants.nodes.some(function (v) {
            if (!v.availableForSale) return false;
            return v.selectedOptions.every(function (o) {
              if (norm(o.name) === norm(g.name)) return o.value === b.dataset.value;
              var other = groups.filter(function (x) { return norm(x.name) === norm(o.name); })[0];
              return !other || !other.selected || other.selected === o.value;
            });
          });
          b.classList.toggle('is-out', !ok && p.availableForSale);
        });
      });
      var v = current();
      if (gallery && !skipJump) {
        var cst = colorG && colorInfo && colorInfo.starts.filter(function (x) { return x.name === colorG.selected; })[0];
        if (cst) { if (lastColor !== colorG.selected) gallery.show(cst.idx); }
        else if (v && v.image) gallery.showUrl(v.image.url);
      }
      if (colorG) lastColor = colorG.selected;
      if (v) priceEl.innerHTML = ttc(v.price);
      else {
        // prix le plus bas parmi les variantes compatibles avec les choix déjà faits
        var pool = p.variants.nodes.filter(function (x) {
          return groups.every(function (g) { return !g.selected || x.selectedOptions.some(function (o) { return norm(o.name) === norm(g.name) && o.value === g.selected; }); });
        });
        if (!pool.length) pool = p.variants.nodes;
        var min = pool.reduce(function (a, b) { return parseFloat(b.price.amount) < parseFloat(a.price.amount) ? b : a; });
        var same = pool.every(function (x) { return x.price.amount === min.price.amount; });
        priceEl.innerHTML = (same ? '' : 'Dès ') + ttc(min.price);
      }
      addBtn.querySelector('span').textContent = v && !v.availableForSale ? 'Épuisé' : 'Ajouter au panier';
      addBtn.disabled = !!(v && !v.availableForSale);
    }

    // présélection : la 1re valeur disponible pour les options autres que la taille
    // Couleur ↔ photos : choisir une couleur montre ses photos ; en faisant défiler, on passe à la couleur suivante
    var colorG = groups.filter(function (g) { return norm(g.name) === 'couleur'; })[0];
    var colorInfo = colorG ? colorStarts(p, optionOf(p, colorG.name)) : null, lastColor = null, skipJump = false;
    if (gallery && colorInfo && colorInfo.starts.length) gallery.onChange = function (i) {
      var c = null; colorInfo.starts.forEach(function (x) { if (x.idx <= i) c = x; });
      if (!c) c = colorInfo.starts[colorInfo.starts.length - 1];
      if (c && c.name !== colorG.selected) { skipJump = true; lastColor = c.name; pick(colorG, c.name); skipJump = false; }
    };
    groups.forEach(function (g) {
      var cands = [].slice.call(g.box.querySelectorAll('[data-value]'));
      // taille : celle du milieu est sélectionnée par défaut (la plus proche disponible)
      if (norm(g.name) === 'taille' && cands.length > 1) {
        var mid = Math.floor(cands.length / 2), pos = cands.slice();
        cands.sort(function (a, b) { return Math.abs(pos.indexOf(a) - mid) - Math.abs(pos.indexOf(b) - mid); });
      }
      // couleur : le noir est sélectionné par défaut
      if (norm(g.name) === 'couleur') cands.sort(function (a, b) { return isBlack(b.dataset.value) - isBlack(a.dataset.value); });
      // batterie : « avec batterie » sélectionnée par défaut
      if (norm(g.name) === 'batterie') cands.sort(function (a, b) { return (norm(a.dataset.value).indexOf('sans') === 0) - (norm(b.dataset.value).indexOf('sans') === 0); });
      var first = cands.filter(function (b) { return valueAvailable(p, g.name, b.dataset.value); })[0] || cands[0];
      var wanted = new URLSearchParams(location.search).get('couleur');
      if (wanted && norm(g.name) === 'couleur') { var w = cands.filter(function (b) { return norm(b.dataset.value) === norm(wanted); })[0]; if (w) first = w; }
      if (first) { g.selected = first.dataset.value; }
    });
    groups.forEach(function (g) { if (g.selected) pick(g, g.selected); });
    // Tailles : rangée centrée sur la taille du milieu (ou la taille choisie), les autres dépassent sur les côtés
    groups.forEach(function (g) {
      if (norm(g.name) !== 'taille') return;
      g.box.classList.add('pd-size-row');
      var btns = g.box.querySelectorAll('[data-value]');
      var target = g.box.querySelector('[aria-pressed="true"]') || btns[Math.floor(btns.length / 2)];
      requestAnimationFrame(function () { centerSize(g.box, target, false); });
      // la taille au centre devient la taille choisie EN DIRECT pendant le défilement (comme une roue)
      var raf = 0;
      function nearest() {
        var r = g.box.getBoundingClientRect(), mid = r.left + r.width / 2, best = null, bd = 1e9;
        g.box.querySelectorAll('[data-value]').forEach(function (b) {
          var bb = b.getBoundingClientRect(), d = Math.abs(bb.left + bb.width / 2 - mid);
          if (d < bd) { bd = d; best = b; }
        });
        return best;
      }
      g.box.addEventListener('scroll', function () {
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0; if (g.lock && Date.now() < g.lock) return; var best = nearest();
          if (best && best.dataset.value !== g.selected) pick(g, best.dataset.value, true);
        });
      }, { passive: true });
      window.addEventListener('resize', function () { centerSize(g.box, g.box.querySelector('[aria-pressed="true"]') || target, false); });
    });
    refresh();

    addBtn.addEventListener('click', function () {
      var missing = groups.filter(function (g) { return !g.selected; })[0];
      if (missing) { say('Choisissez une ' + missing.name.toLowerCase() + '.'); missing.field.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      var v = current() || (groups.length ? null : p.variants.nodes[0]);
      if (!v) { say('Cette combinaison n’est pas disponible.'); return; }
      if (!v.availableForSale) { say('Cette taille est épuisée.'); return; }
      var q = Math.max(1, parseInt(qtyEl && qtyEl.value, 10) || 1);
      addBtn.classList.add('oc-busy');
      addLines([{ merchandiseId: v.id, quantity: q }]).then(function (c) {
        cart = c; renderCart(); openCart();
      }).catch(function (e) { say('Impossible d’ajouter au panier pour le moment. ' + e.message); })
        .then(function () { addBtn.classList.remove('oc-busy'); });
    });
  }

  // Cartes : vidéo (ou 1re photo) puis photos, avec flèches précédent / suivant

  // Index (dans les photos du produit) où commence chaque couleur
  function colorStarts(p, opt) {
    function key(u) { return String(u || '').split('?')[0]; }
    var imgs = mediaList(p).filter(function (x) { return x.type === 'image'; }), out = [];
    opt.optionValues.forEach(function (ov) {
      var vr = p.variants.nodes.filter(function (x) { return x.image && x.selectedOptions.some(function (o) { return norm(o.name) === norm(opt.name) && o.value === ov.name; }); })[0];
      if (!vr) return;
      var k = -1; imgs.forEach(function (im, n) { if (k < 0 && key(im.src) === key(vr.image.url)) k = n; });
      if (k >= 0) out.push({ name: ov.name, idx: k });
    });
    out.sort(function (a, b) { return a.idx - b.idx; });
    return { imgs: imgs, starts: out };
  }
  // Carte produit : choix de la couleur (pastilles) → la photo de la variante s'affiche et le lien la présélectionne
  function cardColors(el, p) {
    var opt = optionOf(p, 'Couleur'); if (!opt || opt.optionValues.length < 2) return;
    var old = el.querySelector('.pc-colors'); if (old) old.remove();
    var box = document.createElement('div'); box.className = 'pc-colors'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Couleur');
    var base = el.getAttribute('href') || '';
    opt.optionValues.forEach(function (v) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'pc-color';
      b.setAttribute('aria-label', v.name); b.title = v.name; b.setAttribute('aria-pressed', 'false');
      var st = swatchStyle(v); if (st) b.setAttribute('style', st); else b.textContent = v.name.charAt(0);
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        box.querySelectorAll('.pc-color').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        selectColor(v.name, true);
      });
      box.appendChild(b);
    });
    function setPressed(name) {
      box.querySelectorAll('.pc-color').forEach(function (x) { x.setAttribute('aria-pressed', x.title === name ? 'true' : 'false'); });
      var url = base.split('#')[0]; url += (url.indexOf('?') > -1 ? '&' : '?') + 'couleur=' + encodeURIComponent(name);
      el.setAttribute('href', url);
    }
    function selectColor(name, rebuild) {
      setPressed(name);
      var cs = colorStarts(p, opt), st = cs.starts.filter(function (x) { return x.name === name; })[0];
      if (!rebuild || !cs.imgs.length) return;
      var cur = el.querySelector('.pc-car') || el.querySelector('video') || el.querySelector('.pc-ph');
      if (!cur) return;
      if (cur._stop) cur._stop();
      var ph = document.createElement('div'); cur.replaceWith(ph);
      // toutes les photos du produit, en partant de la couleur choisie ; en défilant, on passe à la couleur suivante
      cardCarousel(ph, cs.imgs, false, { start: st ? st.idx : 0, noAuto: true, onChange: function (i) {
        var c = null; cs.starts.forEach(function (x) { if (x.idx <= i) c = x; });
        if (!c && cs.starts.length) c = cs.starts[cs.starts.length - 1];
        if (c) setPressed(c.name);
      } });
    }
    var price = el.querySelector('.pc-price'); (price || el.querySelector('h3')).insertAdjacentElement('afterend', box);
  }
  function cardCarousel(first, imgs, hasVideo, opts) {
    opts = opts || {};
    var box = document.createElement('div'); box.className = 'pc-car';
    first.replaceWith(box);
    var slides = [];
    if (hasVideo) { box.appendChild(first); slides.push(first); }
    imgs.forEach(function (it, k) {
      var im = document.createElement('img'); im.src = sized(it.src, 900); im.alt = (k || hasVideo) ? '' : it.alt;
      if (k || hasVideo) { im.loading = 'lazy'; im.className = 'pc-car-slide'; }
      else im.className = 'pc-car-base';
      box.appendChild(im); slides.push(im);
    });
    // mention par-dessus les photos prises en caméra thermique
    var thermTag = null, viewTag = null;
    if (imgs.some(function (it) { return it.thermal; })) {
      thermTag = document.createElement('span'); thermTag.className = 'pc-thermal'; thermTag.textContent = 'Carte thermique';
      box.appendChild(thermTag);
      viewTag = document.createElement('span'); viewTag.className = 'pc-view'; box.appendChild(viewTag);
    }
    function tagFor(k) { if (!thermTag) return; var it = imgs[k - (hasVideo ? 1 : 0)]; thermTag.classList.toggle('is-on', !!(it && it.thermal)); if (it && it.thermal) viewTag.textContent = it.view || ''; viewTag.classList.toggle('is-on', !!(it && it.thermal && it.view)); }
    tagFor(0);
    var tagTimer = 0;
    if (slides.length < 2) return box;
    var cur = 0, dots = document.createElement('div'); dots.className = 'pc-dots'; dots.setAttribute('aria-hidden', 'true');
    slides.forEach(function (_, k) { var d = document.createElement('span'); if (!k) d.className = 'is-on'; dots.appendChild(d); });
    // Effet présentoir : la photo pivote doucement sur elle-même comme sur un socle tournant,
    // la suivante arrive en pivotant de l'autre côté, avec un léger recul
    var reduceMo = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function prism(from, to, dir) {
      var a = slides[from], b = slides[to];
      if (reduceMo || !a || !b || a.tagName !== 'IMG' || b.tagName !== 'IMG') return;
      var old = box.querySelector('.pc-swing'); if (old) old.remove();
      var wrap = document.createElement('div'); wrap.className = 'pc-swing'; wrap.setAttribute('aria-hidden', 'true');
      function layer(src, cls) { var im = document.createElement('img'); im.src = src; im.alt = ''; im.className = cls; wrap.appendChild(im); return im; }
      var out = layer(a.currentSrc || a.src, 'pc-swing-out'), inn = layer(b.currentSrc || b.src, 'pc-swing-in');
      wrap.style.setProperty('--d', dir > 0 ? 1 : -1);
      box.appendChild(wrap); box.classList.add('is-swing'); void wrap.offsetWidth; wrap.classList.add('is-go');
      var done = false; function end() { if (done) return; done = true; wrap.remove(); box.classList.remove('is-swing'); }
      inn.addEventListener('transitionend', end); setTimeout(end, 1400);
    }
    var autoMove = false; // effet socle tournant : seulement pour le défilement automatique
    function show(i) {
      var from = cur, dir = i > cur ? 1 : -1;
      if (!autoMove) { var sw = box.querySelector('.pc-swing'); if (sw) { sw.remove(); box.classList.remove('is-swing'); } }
      cur = opts.noLoop ? Math.max(0, Math.min(slides.length - 1, i)) : (i + slides.length) % slides.length;
      if (opts.noLoop) { var pv = box.querySelector('.pc-arrow-prev'), nx = box.querySelector('.pc-arrow-next'); if (pv) pv.hidden = cur === 0; if (nx) nx.hidden = cur === slides.length - 1; }
      slides.forEach(function (sl, k) { if (k) sl.classList.toggle('is-on', k === cur); else sl.classList.toggle('is-off', cur !== 0); });
      [].slice.call(dots.children).forEach(function (d, k) { d.classList.toggle('is-on', k === cur); });
      // pendant la rotation, les mentions changent à mi-parcours, quand la nouvelle photo prend le dessus
      clearTimeout(tagTimer);
      if (from !== cur && autoMove && !reduceMo) { var c0 = cur; tagTimer = setTimeout(function () { tagFor(c0); }, 500); } else tagFor(cur);
      if (opts.onChange) opts.onChange(cur);
      if (hasVideo) { if (cur === 0) { var pr = first.play(); if (pr && pr.catch) pr.catch(function () {}); } else first.pause(); }
      if (from !== cur && autoMove) prism(from, cur, dir);
    }
    ['prev', 'next'].forEach(function (dir) {
      var a = document.createElement('button'); a.type = 'button'; a.className = 'pc-arrow pc-arrow-' + dir;
      a.setAttribute('aria-label', dir === 'prev' ? 'Visuel précédent' : 'Visuel suivant');
      a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + (dir === 'prev' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7') + '"/></svg>';
      a.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); manual(); show(cur + (dir === 'prev' ? -1 : 1)); });
      box.appendChild(a);
    });
    box.appendChild(dots);
    if (opts.noLoop || opts.start) show(opts.start || 0);

    // Défilement automatique tant que l'utilisateur ne touche à rien :
    // la vidéo joue jusqu'au bout, puis chaque photo ~2,5 s, puis retour à la vidéo… en boucle.
    var PHOTO_MS = 2500, timer = 0, auto = true, running = false;
    // seules la vidéo et les photos portées défilent toutes seules ; les flèches montrent tout
    var autoIdx = slides.map(function (_, k) { return k; }).filter(function (k) {
      if (hasVideo && k === 0) return true; var it = imgs[k - (hasVideo ? 1 : 0)]; return it && it.auto; });
    function nextAuto() { var a = autoIdx.filter(function (k) { return k > cur; }); return a.length ? a[0] : autoIdx[0]; }
    function schedule() {
      clearTimeout(timer); if (!auto || !running) return;
      if (hasVideo && cur === 0) {
        first.loop = false;
        var d = first.duration;
        // filet de sécurité si l'évènement « ended » n'arrive pas
        timer = setTimeout(advance, (isFinite(d) && d > 0 ? (d - first.currentTime) * 1000 + 600 : 12000));
      } else timer = setTimeout(advance, PHOTO_MS);
    }
    function advance() {
      if (!auto || !running || !autoIdx.length) return;
      var n = nextAuto();
      if (n === cur) { if (hasVideo && cur === 0) { first.loop = true; var pr = first.play(); if (pr && pr.catch) pr.catch(function () {}); } return; }
      autoMove = true; show(n); autoMove = false; if (hasVideo && cur === 0) { try { first.currentTime = 0; } catch (e) {} } schedule();
    }
    function manual() { auto = false; clearTimeout(timer); if (hasVideo) first.loop = true; }
    if (hasVideo) {
      first.addEventListener('ended', function () { if (auto && running && cur === 0) advance(); });
      // le survol ne doit pas bloquer la boucle : on relance la vidéo si elle est à l'écran
      var card = box.closest('a') || box;
      card.addEventListener('mouseleave', function () {
        if (auto && running && cur === 0) setTimeout(function () { var pr = first.play(); if (pr && pr.catch) pr.catch(function () {}); }, 0);
      });
    }
    function start() { if (opts.noAuto || !autoIdx.length) return; running = true; auto = true; if (autoIdx.indexOf(cur) < 0) show(autoIdx[0]); if (hasVideo && cur === 0) { var pr = first.play(); if (pr && pr.catch) pr.catch(function () {}); } schedule(); }
    function stop() { running = false; clearTimeout(timer); if (hasVideo) first.pause(); }
    box._stop = stop;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting && e.intersectionRatio >= 0.5) start(); else stop(); });
      }, { threshold: [0, 0.5] }).observe(box);
    } else start();
    return box;
  }

  function centerSize(row, btn, smooth) {
    if (!row || !btn) return;
    var r = row.getBoundingClientRect(), b = btn.getBoundingClientRect();
    var delta = (b.left + b.width / 2) - (r.left + r.width / 2);
    row.scrollTo({ left: row.scrollLeft + delta, behavior: smooth ? 'smooth' : 'auto' });
  }

  // Galerie de la page produit reconstruite avec les photos/vidéos Shopify
  function buildGallery(items) {
    var main = document.querySelector('.pd-main'), thumbsBox = document.querySelector('.pd-thumbs');
    if (!main || !thumbsBox || !items.length) return null;
    var count = document.getElementById('pd-count');
    function render(i) {
      var it = items[i];
      [].slice.call(main.children).forEach(function (c) { if (c !== count && !c.classList.contains('pd-arrow')) c.remove(); });
      var node;
      if (it.type === 'video') {
        node = document.createElement('video');
        node.src = it.src; node.muted = true; node.loop = true; node.autoplay = true; node.playsInline = true;
        if (it.poster) node.poster = sized(it.poster, 1200);
        node.setAttribute('aria-label', it.alt);
      } else {
        node = document.createElement('img'); node.src = sized(it.src, 1400); node.alt = it.alt;
        node.setAttribute('style', 'width:100%;height:100%;object-fit:contain;object-position:center;display:block');
      }
      main.classList.add('has-media');
      main.insertBefore(node, main.firstChild);
      if (it.type === 'video') { var pr = node.play(); if (pr && pr.catch) pr.catch(function () {}); }
      if (count) { count.textContent = (i + 1) + ' / ' + items.length; count.hidden = items.length < 2; }
      cur = i; if (i < start || i >= start + PER) { start = Math.floor(i / PER) * PER; drawThumbs(); }
      if (api.onChange) api.onChange(i);
      [].slice.call(thumbsBox.querySelectorAll('[data-i]')).forEach(function (b) { b.classList.toggle('is-active', +b.dataset.i === i); });
    }
    // une seule ligne de miniatures ; s'il y en a trop, une case « … » affiche les suivantes
    var MAX = 5, PER = items.length > MAX ? MAX - 1 : MAX, start = 0, cur = 0;
    var api = { onChange: null };
    function drawThumbs() {
      thumbsBox.innerHTML = '';
      items.slice(start, start + PER).forEach(function (it, k) {
        var i = start + k;
        var b = document.createElement('button'); b.type = 'button'; b.className = 'pd-thumb'; b.dataset.i = i;
        b.setAttribute('aria-label', (it.type === 'video' ? 'Vidéo : ' : 'Photo : ') + it.alt);
        var src = it.type === 'video' ? it.poster : it.src;
        if (src) b.classList.add('has-img');
        b.innerHTML = (src ? '<img src="' + esc(sized(src, 200)) + '" alt="" style="width:100%;height:100%;object-fit:contain;display:block">' : '<span>Vidéo</span>') +
          (it.type === 'video' ? '<span class="pd-thumb-play" aria-hidden="true"></span>' : '');
        b.classList.toggle('is-active', i === cur);
        b.addEventListener('click', function () { render(i); });
        thumbsBox.appendChild(b);
      });
      if (items.length > MAX) {
        var more = document.createElement('button'); more.type = 'button'; more.className = 'pd-thumb pd-thumb-more';
        more.setAttribute('aria-label', 'Voir les autres visuels'); more.textContent = '…';
        more.addEventListener('click', function () { start = start + PER >= items.length ? 0 : start + PER; drawThumbs(); });
        thumbsBox.appendChild(more);
      }
    }
    drawThumbs();
    // flèches précédent / suivant (+ balayage au doigt sur mobile)
    if (items.length > 1) {
      ['prev', 'next'].forEach(function (dir) {
        var a = document.createElement('button'); a.type = 'button'; a.className = 'pd-arrow pd-arrow-' + dir;
        a.setAttribute('aria-label', dir === 'prev' ? 'Visuel précédent' : 'Visuel suivant');
        a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + (dir === 'prev' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7') + '"/></svg>';
        a.addEventListener('click', function () { render((cur + (dir === 'prev' ? -1 : 1) + items.length) % items.length); });
        main.appendChild(a);
      });
      var x0 = null;
      main.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
      main.addEventListener('touchend', function (e) {
        if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null;
        if (Math.abs(dx) > 40) render((cur + (dx > 0 ? -1 : 1) + items.length) % items.length);
      }, { passive: true });
    }
    // flèches et numéro : visibles quand on touche/clique la photo, masqués dès qu'on clique ailleurs
    main.addEventListener('click', function () { main.classList.add('is-ui'); });
    main.addEventListener('touchstart', function () { main.classList.add('is-ui'); }, { passive: true });
    document.addEventListener('click', function (e) { if (!main.contains(e.target) && !thumbsBox.contains(e.target)) main.classList.remove('is-ui'); });
    document.addEventListener('touchstart', function (e) { if (!main.contains(e.target) && !thumbsBox.contains(e.target)) main.classList.remove('is-ui'); }, { passive: true });
    thumbsBox.hidden = items.length < 2;
    render(0);
    api.show = function (i) { if (i >= 0 && i < items.length) render(i); };
    api.showUrl = function (url) {
      var base = String(url).split('?')[0];
      for (var i = 0; i < items.length; i++) if (String(items[i].src).split('?')[0] === base) { render(i); return; }
    };
    return api;
  }

  /* ---------- recherche (bouton loupe du menu) ---------- */
  // page dédiée de chaque produit (les autres renvoient vers la sélection de l'accueil)
  var PRODUCT_PAGES = { 'veste-otreau': 'veste-otreau.html', 'veste': 'veste-otreau.html', 'doudoune-otreau': 'doudoune-otreau.html', 'doudoune': 'doudoune-otreau.html', 'gilet-otreau': 'gilet-otreau.html', 'gilet': 'gilet-otreau.html' };
  var SEARCH_Q = 'query S($q: String!) { predictiveSearch(query: $q, limit: 10, types: [PRODUCT], ' +
    'searchableFields: [TITLE, BODY, PRODUCT_TYPE, TAG, VARIANTS_TITLE, VENDOR], unavailableProducts: LAST) { products { ' +
    'handle title availableForSale featuredImage { url altText } priceRange { minVariantPrice { amount currencyCode } } ' +
    'options { name optionValues { name } } variants(first: 100) { nodes { price { amount currencyCode } selectedOptions { name value } } } } } }';
  var sCss = document.createElement('style');
  sCss.textContent = '' +
    '.os-overlay{position:fixed;inset:0;z-index:190;background:transparent;opacity:0;pointer-events:none;transition:opacity .25s}' +
    '.os-overlay.is-open{opacity:1;pointer-events:auto}' +
    '.os-panel{position:fixed;left:0;right:0;top:0;z-index:191;background:rgba(255,255,255,.14);-webkit-backdrop-filter:blur(26px) saturate(160%);backdrop-filter:blur(26px) saturate(160%);border-bottom:1px solid rgba(255,255,255,.35);color:#14212B;max-height:88vh;overflow-y:auto;transform:translateY(-100%);transition:transform .35s cubic-bezier(.65,0,.35,1),visibility 0s .35s;visibility:hidden;box-shadow:0 30px 60px -30px rgba(0,0,0,.45);font-family:\'DM Sans\',system-ui,sans-serif}' +
    '.os-panel.is-open{transform:none;visibility:visible;transition:transform .35s cubic-bezier(.65,0,.35,1)}' +
    '.os-inner{max-width:1100px;margin:0 auto;padding:22px 24px 36px}' +
    '.os-bar{display:flex;align-items:center;gap:12px}' +
    '.os-field{flex:1;display:flex;align-items:center;gap:12px;min-height:56px;padding:0 22px;border:1.5px solid rgba(20,33,43,.18);border-radius:999px;background:rgba(255,255,255,.55)}' +
    '.os-field:focus-within{border-color:#14212B}' +
    '.os-field svg{flex:none;width:20px;height:20px;fill:none;stroke:#14212B;stroke-width:1.8;stroke-linecap:round}' +
    '.os-field input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:17px;color:#14212B}' +
    '.os-close{flex:none;width:48px;height:48px;border:0;border-radius:50%;background:transparent;font-size:28px;line-height:1;color:#14212B;cursor:pointer}' +
    '.os-close:hover{background:rgba(255,255,255,.5)}' +
    '.os-hint{margin:18px 4px 0;font-size:14px;color:#3D4A54}' +
    '.os-hint button{border:1px solid rgba(20,33,43,.18);background:rgba(255,255,255,.55);border-radius:999px;padding:6px 14px;margin:6px 6px 0 0;font:inherit;font-size:14px;color:#14212B;cursor:pointer}' +
    '.os-hint button:hover{border-color:#14212B}' +
    '.os-results{margin-top:24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}' +
    '.os-item{display:flex;flex-direction:column;gap:10px;text-decoration:none;color:#14212B}' +
    '.os-item .os-img{aspect-ratio:1/1;background:transparent;overflow:hidden;border-radius:14px}' +
    '.os-item img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .35s}' +
    '.os-item:hover img{transform:scale(1.03)}' +
    '.os-item .os-t{font-family:Manrope,sans-serif;font-size:16px;line-height:1.2}' +
    '.os-item .os-p{font-size:14px;color:#55616B;margin-top:-6px}' +
    '.os-empty{margin-top:24px;font-size:15px;color:#55616B}' +
    '.os-panel,.os-panel *{color:#000 !important}' +
    '.os-panel input::placeholder{color:rgba(0,0,0,.55) !important}' +
    '.os-field svg{stroke:#000 !important}' +
    '.os-field{border-color:rgba(0,0,0,.25) !important}.os-field:focus-within{border-color:#000 !important}' +
    '.os-hint button{border-color:rgba(0,0,0,.25) !important}.os-hint button:hover{border-color:#000 !important}' +
    '@media (max-width:560px){.os-results{grid-template-columns:repeat(2,minmax(0,1fr))}.os-field{min-height:50px;padding:0 16px}}';
  document.head.appendChild(sCss);
  var sOverlay = document.createElement('div'); sOverlay.className = 'os-overlay';
  var sPanel = document.createElement('div'); sPanel.className = 'os-panel'; sPanel.setAttribute('role', 'dialog'); sPanel.setAttribute('aria-label', 'Recherche');
  sPanel.innerHTML = '<div class="os-inner"><form class="os-bar" role="search">' +
    '<label class="os-field"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
    '<input type="search" placeholder="Rechercher un produit…" aria-label="Rechercher un produit" autocomplete="off"></label>' +
    '<button type="button" class="os-close" aria-label="Fermer la recherche">×</button></form>' +
    '<div class="os-out" aria-live="polite"></div></div>';
  document.body.appendChild(sOverlay); document.body.appendChild(sPanel);
  var sInput = sPanel.querySelector('input'), sOut = sPanel.querySelector('.os-out'), sTimer = 0, sSeq = 0;
  function openSearch() { sOverlay.classList.add('is-open'); sPanel.classList.add('is-open'); document.body.classList.add('oc-lock'); setTimeout(function () { sInput.focus(); }, 60); }
  function closeSearch() { sOverlay.classList.remove('is-open'); sPanel.classList.remove('is-open'); document.body.classList.remove('oc-lock'); }
  sOverlay.addEventListener('click', closeSearch);
  sPanel.querySelector('.os-close').addEventListener('click', closeSearch);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sPanel.classList.contains('is-open')) closeSearch(); });
  document.querySelectorAll('a[aria-label="Rechercher"]').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); openSearch(); });
  });
  function runSearch(q) {
    q = q.trim(); var my = ++sSeq;
    if (q.length < 2) { sOut.innerHTML = ''; return; }
    gql(SEARCH_Q, { q: q }).then(function (d) {
      if (my !== sSeq) return;
      var list = (d.predictiveSearch && d.predictiveSearch.products) || [];
      if (!list.length) { sOut.innerHTML = '<p class="os-empty">Aucun produit ne correspond à « ' + esc(q) + ' ».</p>'; return; }
      sOut.innerHTML = '<div class="os-results">' + list.map(function (p) {
        var pv = withBattery(p), lo = pv.length ? pv.reduce(function (a, b) { return parseFloat(b.price.amount) < parseFloat(a.price.amount) ? b : a; }).price : p.priceRange.minVariantPrice;
        var img = p.featuredImage && p.featuredImage.url;
        return '<a class="os-item" href="' + esc(PRODUCT_PAGES[p.handle] || ('produit.html?p=' + encodeURIComponent(p.handle))) + '">' +
          '<div class="os-img">' + (img ? '<img src="' + esc(sized(img, 500)) + '" alt="' + esc((p.featuredImage.altText) || plainTitle(p.title)) + '" loading="lazy">' : '') + '</div>' +
          '<div class="os-t">' + titleHtml(p.title) + '</div><div class="os-p">' + ttc(lo) + (p.availableForSale ? '' : ' · Épuisé') + '</div></a>';
      }).join('') + '</div>';
      sOut.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', closeSearch); });
    }).catch(function () { if (my === sSeq) sOut.innerHTML = '<p class="os-empty">La recherche est momentanément indisponible.</p>'; });
  }
  sInput.addEventListener('input', function () { clearTimeout(sTimer); sTimer = setTimeout(function () { runSearch(sInput.value); }, 250); });
  sPanel.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); clearTimeout(sTimer); runSearch(sInput.value); });

  window.OtreauCart = { open: function () { renderCart(); openCart(); }, close: closeCart };
})();
