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
    'options { name optionValues { name } } ' +
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
      d.products.nodes.forEach(function (p) { map[p.handle] = p; });
      return map;
    });
  }
  // « VESTE’Otreau » → type en gras, « ’Otreau » fin et gris (même style que le site)
  function titleHtml(t) {
    var m = String(t || '').match(/^(.*?)([’'].*)$/);
    if (!m) return '<span style="font-weight: 600">' + esc(t) + '</span>';
    return '<span style="font-weight: 600">' + esc(m[1]) + '</span><span style="font-weight: 300; color: #8A949B">' + esc(m[2].replace("'", '’')) + '</span>';
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
    '.oc-img{width:76px;height:92px;background:#EFEFEF;object-fit:cover;display:block}' +
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
        '<div><p class="oc-name">' + esc(m.product.title) + '</p>' + (variant ? '<p class="oc-var">' + esc(variant) + '</p>' : '') +
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
      var media = mediaList(p)[0], vid = el.querySelector('video'), ph = vid || el.querySelector('.pc-media-ph') || (h3 && h3.parentNode.previousElementSibling);
      if (media && ph) {
        if (media.type === 'video' && vid) {
          vid.src = media.src; if (media.poster) vid.poster = sized(media.poster, 800); vid.removeAttribute('aria-label'); vid.setAttribute('aria-label', media.alt);
        } else if (media.type === 'image') {
          var img = document.createElement('img');
          img.src = sized(media.src, 900); img.alt = media.alt; img.loading = 'lazy';
          img.setAttribute('style', 'width: 100%; aspect-ratio: 4 / 5; object-fit: cover; object-position: center; background: #EFEFEF; display: block');
          ph.replaceWith(img);
        } else if (media.type === 'video') {
          var v2 = document.createElement('video');
          v2.src = media.src; v2.muted = true; v2.loop = true; v2.autoplay = true; v2.playsInline = true; if (media.poster) v2.poster = sized(media.poster, 800);
          v2.setAttribute('style', 'width: 100%; aspect-ratio: 4 / 5; object-fit: cover; background: #EFEFEF; display: block');
          ph.replaceWith(v2);
        }
      }
      var price = el.querySelector('.pc-price');
      if (!price && h3) { price = document.createElement('p'); price.className = 'pc-price'; h3.insertAdjacentElement('afterend', price); }
      if (price) {
        var multi = p.variants.nodes.some(function (v) { return v.price.amount !== p.priceRange.minVariantPrice.amount; });
        price.textContent = (multi ? 'Dès ' : '') + money(p.priceRange.minVariantPrice);
      }
      var sizes = el.querySelector('.pc-sizes'), opt = optionOf(p, 'Taille');
      if (sizes && opt) {
        sizes.innerHTML = opt.optionValues.map(function (v) {
          var ok = valueAvailable(p, opt.name, v.name);
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
    if (h1 && p.title) { h1.innerHTML = titleHtml(p.title); document.title = p.title + ' · Otreau'; }
    var crumb = document.querySelector('.pd-crumb [aria-current="page"]');
    if (crumb && p.title) crumb.textContent = p.title;
    if (p.descriptionHtml && p.descriptionHtml.trim()) {
      [].slice.call(document.querySelectorAll('.pd-acc')).forEach(function (d) {
        var s = d.querySelector('summary span');
        if (s && norm(s.textContent) === 'description') d.querySelector('.pd-acc-body').innerHTML = p.descriptionHtml;
      });
    }
    var gallery = buildGallery(mediaList(p));

    // Associe chaque groupe d'options de la page à une option Shopify (Taille, Batterie, Couleur…)
    var groups = [];
    document.querySelectorAll('.pd-info .pd-opts').forEach(function (box) {
      var label = box.getAttribute('aria-label'), opt = optionOf(p, label), field = box.closest('.pd-field');
      if (!opt) { field.hidden = true; return; }
      var old = [].slice.call(box.children), isSwatch = old.some(function (b) { return b.classList.contains('pd-swatch'); });
      box.innerHTML = '';
      opt.optionValues.forEach(function (v, i) {
        var tpl = old.filter(function (b) { return norm(b.dataset.name || b.textContent) === norm(v.name); })[0];
        var b;
        if (isSwatch && tpl) { b = tpl.cloneNode(true); }
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
          b.classList.toggle('is-out', !ok);
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

  // Galerie de la page produit reconstruite avec les photos/vidéos Shopify
  function buildGallery(items) {
    var main = document.querySelector('.pd-main'), thumbsBox = document.querySelector('.pd-thumbs');
    if (!main || !thumbsBox || !items.length) return null;
    var count = document.getElementById('pd-count');
    function render(i) {
      var it = items[i];
      [].slice.call(main.children).forEach(function (c) { if (c !== count) c.remove(); });
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
      main.insertBefore(node, count);
      if (it.type === 'video') { var pr = node.play(); if (pr && pr.catch) pr.catch(function () {}); }
      if (count) { count.textContent = (i + 1) + ' / ' + items.length; count.hidden = items.length < 2; }
      [].slice.call(thumbsBox.children).forEach(function (b, j) { b.classList.toggle('is-active', j === i); });
    }
    thumbsBox.innerHTML = '';
    items.forEach(function (it, i) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'pd-thumb';
      b.setAttribute('aria-label', (it.type === 'video' ? 'Vidéo : ' : 'Photo : ') + it.alt);
      var src = it.type === 'video' ? it.poster : it.src;
      b.innerHTML = src ? '<img src="' + esc(sized(src, 300)) + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block">' : '<span>Vidéo</span>';
      b.addEventListener('click', function () { render(i); });
      thumbsBox.appendChild(b);
    });
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
