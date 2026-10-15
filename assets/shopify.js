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
    var q = handles.map(function (h) { return 'handle:' + h; }).join(' OR ');
    function run(fields) {
      return gql('query P($q: String!) { products(first: 50, query: $q) { nodes { ' + fields + ' } } }', { q: q });
    }
    return run(PRODUCT_FIELDS).then(function (d) {
      var map = {};
      d.products.nodes.forEach(function (p) { sortSizes(p); map[p.handle] = p; });
      return map;
    });
  }
  // Titre Shopify « Veste » ou « Gilet fin » → « VESTE’Otreau » / « GILET FIN’Otreau »
  // (type en majuscules + ’Otreau ajouté à la fin ; un « Otreau » déjà présent n'est pas doublé)
  function baseTitle(t) {
    return String(t || '').replace(/[\s’'-]*otreau\s*$/i, '').trim().toLocaleUpperCase('fr-FR');
  }
  function plainTitle(t) { return baseTitle(t) + '’Otreau'; }
  function titleHtml(t) {
    return '<span style="font-weight: 600">' + esc(baseTitle(t)) + '</span><span style="font-weight: 300; color: #8A949B">’Otreau</span>';
  }
  function sized(url, w) { return url ? url + (url.indexOf('?') > -1 ? '&' : '?') + 'width=' + w : url; }
  // médias Shopify → liste simple {type, src, poster, alt}
  function mediaList(p) {
    var out = [];
    ((p.media && p.media.nodes) || []).forEach(function (m) {
      if (m.mediaContentType === 'IMAGE' && m.image) out.push({ type: 'image', src: m.image.url, alt: m.image.altText || m.alt || p.title });
      else if (m.mediaContentType === 'VIDEO' && m.sources && m.sources.length) {
        var mp4 = m.sources.filter(function (s) { return /mp4/.test(s.mimeType); }).sort(function (a, b) { return (b.height || 0) - (a.height || 0); });
        var best = mp4.filter(function (s) { return (s.height || 0) <= 1080; })[0] || mp4[mp4.length - 1] || m.sources[0];
        out.push({ type: 'video', src: best.url, poster: m.previewImage && m.previewImage.url, alt: m.alt || p.title });
      }
    });
    if (!out.length && p.featuredImage) out.push({ type: 'image', src: p.featuredImage.url, alt: p.featuredImage.altText || p.title });
    return out;
  }
  // Pastilles de couleur : couleur/image définie dans Shopify, sinon couleurs courantes
  var COLORS = { blanc: '#F4F3EF', ecru: '#EDE6D6', beige: '#D8C7A8', camel: '#B8875A', marron: '#6B4A35', noir: '#1A1A1A',
    gris: '#9AA0A6', 'gris clair': '#C9CDD1', 'gris fonce': '#4A4F55', anthracite: '#3A3D42', bleu: '#2F5D9E', 'bleu marine': '#1F2A44', marine: '#1F2A44',
    vert: '#4E6B4A', kaki: '#6B6B3E', 'vert kaki': '#6B6B3E', rouge: '#B3312C', bordeaux: '#6D1F2A', rose: '#E7A9B8', orange: '#E8641F', jaune: '#E9C46A', violet: '#6A4C93' };
  function swatchStyle(v) {
    var sw = v.swatch || {};
    if (sw.image && sw.image.previewImage) return 'background:url(' + JSON.stringify(sw.image.previewImage.url) + ') center/cover';
    var c = sw.color || COLORS[norm(v.name)];
    return c ? 'background:' + c : '';
  }
  // tailles toujours dans l'ordre XS → 3XL, quel que soit l'ordre saisi dans Shopify
  var SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL', '4XL'];
  function sortSizes(p) {
    (p.options || []).forEach(function (o) {
      if (norm(o.name) !== 'taille') return;
      o.optionValues.sort(function (a, b) {
        var ia = SIZE_ORDER.indexOf(String(a.name).toUpperCase()), ib = SIZE_ORDER.indexOf(String(b.name).toUpperCase());
        if (ia < 0 && ib < 0) return 0; if (ia < 0) return 1; if (ib < 0) return -1; return ia - ib;
      });
    });
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
    '.oc-drawer{font-family:\'DM Sans\',system-ui,-apple-system,sans-serif;position:fixed;top:0;right:0;bottom:0;width:min(420px,100%);background:#F8F6F1;color:#14212B;z-index:201;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .35s cubic-bezier(.65,0,.35,1);box-shadow:-20px 0 60px -30px rgba(0,0,0,.4)}' +
    '.oc-drawer.is-open{transform:none}' +
    '.oc-head{display:flex;align-items:center;justify-content:space-between;padding:22px 24px;border-bottom:1px solid #E4DFD5}' +
    '.oc-head h2{margin:0;font:300 22px/1.1 Manrope,sans-serif;text-transform:uppercase;letter-spacing:.01em}' +
    '.oc-close{width:40px;height:40px;border:0;background:transparent;font-size:26px;line-height:1;cursor:pointer;color:#14212B}' +
    '.oc-body{flex:1;overflow-y:auto;padding:8px 24px}' +
    '.oc-empty{padding:48px 0;text-align:center;color:#55616B;display:flex;flex-direction:column;align-items:center;gap:20px}' +
    '.oc-line{display:grid;grid-template-columns:76px 1fr auto;gap:14px;padding:18px 0;border-bottom:1px solid #E4DFD5}' +
    '.oc-img{width:76px;height:92px;background:transparent;object-fit:cover;display:block}' +
    '.oc-name{font:600 15px/1.25 Manrope,sans-serif;margin:0 0 4px}' +
    '.oc-var{font-size:13px;color:#8A949B;margin:0 0 10px}' +
    '.oc-qty{display:inline-flex;align-items:center;border:1px solid #C9C2B4;border-radius:999px;background:#fff}' +
    '.oc-qty button{width:32px;height:32px;border:0;background:transparent;font-size:17px;cursor:pointer;color:#14212B}' +
    '.oc-qty span{min-width:22px;text-align:center;font:700 14px Manrope,sans-serif}' +
    '.oc-price{font:700 15px Manrope,sans-serif;text-align:right;white-space:nowrap}' +
    '.oc-rm{display:block;margin-top:8px;border:0;background:none;padding:0;font-size:12px;color:#8A949B;text-decoration:underline;cursor:pointer}' +
    '.oc-foot{padding:20px 24px 24px;border-top:1px solid #E4DFD5;display:flex;flex-direction:column;gap:12px;background:#F8F6F1}' +
    '.oc-sub{display:flex;justify-content:space-between;font:700 17px Manrope,sans-serif}' +
    '.oc-note{margin:0;font-size:12.5px;color:#8A949B}' +
    '.oc-btn{display:flex;align-items:center;justify-content:center;min-height:54px;border:0;border-radius:999px;background:#14212B;color:#fff;font:700 16px Manrope,sans-serif;cursor:pointer;text-decoration:none;padding:0 28px}' +
    '.oc-btn[disabled]{opacity:.5;cursor:default}' +
    '.oc-busy{opacity:.55;pointer-events:none}' +
    '.oc-msg{margin:8px 0 0;font-size:13px;color:#C2361F}' +
    '.pc-car{position:relative;width:100%;aspect-ratio:4/5;overflow:hidden;background:var(--section-bg,#F8F6F1)}' +
    '.pc-car > video,.pc-car > .pc-car-base{position:absolute;inset:0;width:100% !important;height:100% !important;aspect-ratio:auto !important;object-fit:cover;display:block}' +
    '.pc-car-slide{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .35s ease;pointer-events:none}' +
    '.pc-car-slide.is-on{opacity:1}' +
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
    '.pd-pack-items div.is-off{opacity:1 !important}' +
    '.pd-pack-items div.is-off > svg,.pd-pack-items div.is-off > span{opacity:.35}' +
    '.pd-pack-add{display:none;margin-top:4px;min-height:34px;padding:0 14px;border:0;border-radius:999px;background:#14212B;color:#fff;font:700 12.5px Manrope,sans-serif;cursor:pointer;white-space:nowrap}' +
    '.pd-pack-add:hover{background:#2A3A46}' +
    '.pd-pack-items div.is-off .pd-pack-add{display:inline-flex;align-items:center}' +
    '.pd-arrow{position:absolute;top:50%;z-index:2;width:40px;height:40px;margin-top:-20px;border:0;border-radius:50%;background:rgba(255,255,255,.85);box-shadow:0 2px 10px rgba(0,0,0,.12);display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:.85;transition:opacity .2s,background .2s}' +
    '.pd-arrow:hover{opacity:1;background:#fff}' +
    '.pd-arrow svg{width:18px;height:18px;fill:none;stroke:#14212B;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '.pd-arrow-prev{left:12px}.pd-arrow-next{right:12px}' +
    '.pd-thumbs{display:flex !important;flex-wrap:nowrap;gap:8px;overflow:hidden}' +
    '.pd-thumbs .pd-thumb{position:relative;flex:0 0 auto;width:68px;height:68px;aspect-ratio:auto}' +
    '.pd-thumb-more{font:700 20px/1 Manrope,sans-serif;letter-spacing:.05em;color:#14212B;background:transparent !important;border:1.5px solid #E4DFD5 !important}' +
    '.pd-thumb-more:hover{border-color:#14212B !important}' +
    '.pd-thumb-play{position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(0,0,0,.55)}' +
    '.pd-thumb-play::after{content:"";position:absolute;left:8px;top:6px;border-left:8px solid #fff;border-top:5px solid transparent;border-bottom:5px solid transparent}' +
    '@media (max-width:480px){.pd-thumbs .pd-thumb{width:56px;height:56px}}' +
    '.pd-thumb.has-img{background:transparent;border-color:#E4DFD5}' +
    '.pd-thumb.has-img.is-active{border-color:#14212B}' +
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
    foot.innerHTML = '<div class="oc-sub"><span>Sous-total</span><span>' + money(cart.cost.subtotalAmount) + '</span></div>' +
      '<p class="oc-note">Livraison et taxes calculées à l’étape du paiement.</p>' +
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
  var cardEls = document.querySelectorAll('[data-handle]');
  var handles = [];
  cardEls.forEach(function (el) { if (handles.indexOf(el.dataset.handle) < 0) handles.push(el.dataset.handle); });

  /* ---------- page produit ---------- */
  var pdInfo = document.querySelector('[data-shopify-handle]');
  if (pdInfo && handles.indexOf(pdInfo.dataset.shopifyHandle) < 0) handles.push(pdInfo.dataset.shopifyHandle);

  fetchProducts(handles).then(function (map) {
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
      if (shopVid && ph) {
        if (!vid) {
          vid = document.createElement('video'); vid.muted = true; vid.playsInline = true; vid.loop = true; vid.autoplay = true; vid.preload = 'metadata';
          vid.setAttribute('style', 'width: 100%; aspect-ratio: 4 / 5; object-fit: cover; background: transparent; display: block');
          ph.replaceWith(vid); ph = vid;
        }
        vid.src = shopVid.src; if (shopVid.poster) vid.poster = sized(shopVid.poster, 800);
        vid.setAttribute('aria-label', shopVid.alt);
      }
      if (imgs.length && ph) cardCarousel(ph, imgs, !!vid);
      var price = el.querySelector('.pc-price');
      if (!price && h3) { price = document.createElement('p'); price.className = 'pc-price'; h3.insertAdjacentElement('afterend', price); }
      if (price) {
        var multi = p.variants.nodes.some(function (v) { return v.price.amount !== p.priceRange.minVariantPrice.amount; });
        price.textContent = (multi ? 'Dès ' : '') + money(p.priceRange.minVariantPrice);
      }
      var sizes = el.querySelector('.pc-sizes'), opt = optionOf(p, 'Taille');
      if (sizes && !opt) sizes.hidden = true;   // produit sans option Taille dans Shopify
      if (sizes && opt) {
        sizes.innerHTML = opt.optionValues.map(function (v) {
          var ok = !p.availableForSale || valueAvailable(p, opt.name, v.name);
          return '<li' + (ok ? '' : ' class="is-out" title="Épuisé"') + '>' + esc(v.name) + '</li>';
        }).join('');
      }
    });
    if (pdInfo) initProductPage(map[pdInfo.dataset.shopifyHandle]);
  }).catch(function (e) {
    if (window.console) console.warn('[Otreau] Shopify indisponible :', e.message);
    if (pdInfo) initProductPage(null);
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

    // Associe chaque groupe d'options de la page à une option Shopify (Taille, Batterie, Couleur…)
    var groups = [];
    document.querySelectorAll('.pd-info .pd-opts').forEach(function (box) {
      var label = box.getAttribute('aria-label'), opt = optionOf(p, label), field = box.closest('.pd-field');
      if (!opt) { field.hidden = true; return; }
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
        else { b = document.createElement('button'); b.type = 'button'; b.className = 'pd-opt'; b.textContent = v.name; }
        b.dataset.value = v.name; b.removeAttribute('data-group');
        b.setAttribute('aria-pressed', 'false');
        box.appendChild(b);
      });
      groups.push({ name: opt.name, box: box, field: field, selected: null, count: opt.optionValues.length });
    });

    function pick(g, value) {
      g.selected = value;
      g.box.querySelectorAll('[data-value]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.value === value ? 'true' : 'false'); });
      if (norm(g.name) === 'couleur') { var c = document.getElementById('pd-color'); if (c) c.textContent = value; }
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
        inc.textContent = '+ Inclure la batterie';
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
      if (v && v.image && gallery) gallery.showUrl(v.image.url);
      if (v) priceEl.textContent = money(v.price);
      else {
        // prix le plus bas parmi les variantes compatibles avec les choix déjà faits
        var pool = p.variants.nodes.filter(function (x) {
          return groups.every(function (g) { return !g.selected || x.selectedOptions.some(function (o) { return norm(o.name) === norm(g.name) && o.value === g.selected; }); });
        });
        if (!pool.length) pool = p.variants.nodes;
        var min = pool.reduce(function (a, b) { return parseFloat(b.price.amount) < parseFloat(a.price.amount) ? b : a; });
        var same = pool.every(function (x) { return x.price.amount === min.price.amount; });
        priceEl.textContent = (same ? '' : 'Dès ') + money(min.price);
      }
      addBtn.querySelector('span').textContent = v && !v.availableForSale ? 'Épuisé' : 'Ajouter au panier';
      addBtn.disabled = !!(v && !v.availableForSale);
    }

    // présélection : la 1re valeur disponible pour les options autres que la taille
    groups.forEach(function (g) {
      if (norm(g.name) === 'taille' && g.count > 1) return;
      var first = [].slice.call(g.box.querySelectorAll('[data-value]')).filter(function (b) { return valueAvailable(p, g.name, b.dataset.value); })[0]
        || g.box.querySelector('[data-value]');
      if (first) { g.selected = first.dataset.value; }
    });
    groups.forEach(function (g) { if (g.selected) pick(g, g.selected); });
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
  function cardCarousel(first, imgs, hasVideo) {
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
    if (slides.length < 2) return;
    var cur = 0, dots = document.createElement('div'); dots.className = 'pc-dots'; dots.setAttribute('aria-hidden', 'true');
    slides.forEach(function (_, k) { var d = document.createElement('span'); if (!k) d.className = 'is-on'; dots.appendChild(d); });
    function show(i) {
      cur = (i + slides.length) % slides.length;
      slides.forEach(function (sl, k) { if (k) sl.classList.toggle('is-on', k === cur); });
      [].slice.call(dots.children).forEach(function (d, k) { d.classList.toggle('is-on', k === cur); });
      if (hasVideo) { if (cur === 0) { var pr = first.play(); if (pr && pr.catch) pr.catch(function () {}); } else first.pause(); }
    }
    ['prev', 'next'].forEach(function (dir) {
      var a = document.createElement('button'); a.type = 'button'; a.className = 'pc-arrow pc-arrow-' + dir;
      a.setAttribute('aria-label', dir === 'prev' ? 'Visuel précédent' : 'Visuel suivant');
      a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + (dir === 'prev' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7') + '"/></svg>';
      a.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); manual(); show(cur + (dir === 'prev' ? -1 : 1)); });
      box.appendChild(a);
    });
    box.appendChild(dots);

    // Défilement automatique tant que l'utilisateur ne touche à rien :
    // la vidéo joue jusqu'au bout, puis chaque photo ~2,5 s, puis retour à la vidéo… en boucle.
    var PHOTO_MS = 2500, timer = 0, auto = true, running = false;
    function schedule() {
      clearTimeout(timer); if (!auto || !running) return;
      if (hasVideo && cur === 0) {
        first.loop = false;
        var d = first.duration;
        // filet de sécurité si l'évènement « ended » n'arrive pas
        timer = setTimeout(advance, (isFinite(d) && d > 0 ? (d - first.currentTime) * 1000 + 600 : 12000));
      } else timer = setTimeout(advance, PHOTO_MS);
    }
    function advance() { if (!auto || !running) return; show(cur + 1); if (hasVideo && cur === 0) { try { first.currentTime = 0; } catch (e) {} } schedule(); }
    function manual() { auto = false; clearTimeout(timer); if (hasVideo) first.loop = true; }
    if (hasVideo) {
      first.addEventListener('ended', function () { if (auto && running && cur === 0) advance(); });
      // le survol ne doit pas bloquer la boucle : on relance la vidéo si elle est à l'écran
      var card = box.closest('a') || box;
      card.addEventListener('mouseleave', function () {
        if (auto && running && cur === 0) setTimeout(function () { var pr = first.play(); if (pr && pr.catch) pr.catch(function () {}); }, 0);
      });
    }
    function start() { running = true; auto = true; if (hasVideo && cur === 0) { var pr = first.play(); if (pr && pr.catch) pr.catch(function () {}); } schedule(); }
    function stop() { running = false; clearTimeout(timer); if (hasVideo) first.pause(); }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting && e.intersectionRatio >= 0.5) start(); else stop(); });
      }, { threshold: [0, 0.5] }).observe(box);
    } else start();
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
        node.setAttribute('style', 'width:100%;height:100%;object-fit:cover;display:block');
      }
      main.classList.add('has-media');
      main.insertBefore(node, main.firstChild);
      if (it.type === 'video') { var pr = node.play(); if (pr && pr.catch) pr.catch(function () {}); }
      if (count) { count.textContent = (i + 1) + ' / ' + items.length; count.hidden = items.length < 2; }
      cur = i; if (i < start || i >= start + PER) { start = Math.floor(i / PER) * PER; drawThumbs(); }
      [].slice.call(thumbsBox.querySelectorAll('[data-i]')).forEach(function (b) { b.classList.toggle('is-active', +b.dataset.i === i); });
    }
    // une seule ligne de miniatures ; s'il y en a trop, une case « … » affiche les suivantes
    var MAX = 5, PER = items.length > MAX ? MAX - 1 : MAX, start = 0, cur = 0;
    function drawThumbs() {
      thumbsBox.innerHTML = '';
      items.slice(start, start + PER).forEach(function (it, k) {
        var i = start + k;
        var b = document.createElement('button'); b.type = 'button'; b.className = 'pd-thumb'; b.dataset.i = i;
        b.setAttribute('aria-label', (it.type === 'video' ? 'Vidéo : ' : 'Photo : ') + it.alt);
        var src = it.type === 'video' ? it.poster : it.src;
        if (src) b.classList.add('has-img');
        b.innerHTML = (src ? '<img src="' + esc(sized(src, 200)) + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block">' : '<span>Vidéo</span>') +
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
    thumbsBox.hidden = items.length < 2;
    render(0);
    return {
      showUrl: function (url) {
        var base = String(url).split('?')[0];
        for (var i = 0; i < items.length; i++) if (String(items[i].src).split('?')[0] === base) { render(i); return; }
      }
    };
  }

  window.OtreauCart = { open: function () { renderCart(); openCart(); }, close: closeCart };
})();
