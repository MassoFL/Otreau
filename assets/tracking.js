/* Suivi Otreau sans application : Google Analytics 4 + Google Ads, chargés uniquement après accord (bandeau cookies).
   1. Renseigner les identifiants ci-dessous (vides = rien n'est chargé).
   2. Le paiement et l'achat sont suivis par le pixel personnalisé Shopify (Paramètres › Événements client),
      qui reçoit d'ici, par les attributs du panier, l'identifiant Google Analytics, le gclid et le choix cookies. */
(function () {
  var GA4_ID = 'G-BR4ENVJXN8'; // Google Analytics 4 (propriété otreau.com)
  var ADS_ID = 'AW-18586045570'; // Google Ads (conversion « Achat Otreau » : libellé dans le pixel Shopify)
  var ADS_ADD_TO_CART = ''; // facultatif : libellé de conversion « Ajout au panier », ex. 'AbCdEfGhIj'

  var CUR = 'EUR', QKEY = 'otreau_track_q', loaded = false;
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  function consent() { return window.otreauConsent || { analytics: false, ads: false }; }
  function wanted() { var c = consent(); return (c.analytics && GA4_ID) || (c.ads && (ADS_ID || GA4_ID)); }

  function cookie(n) { var m = document.cookie.match('(?:^|; )' + n.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'); return m ? decodeURIComponent(m[1]) : ''; }
  function gaClientId() { var v = cookie('_ga'); var m = v.match(/^GA\d\.\d\.(\d+\.\d+)$/); return m ? m[1] : ''; }
  var landingGclid = new URLSearchParams(location.search).get('gclid') || '';
  // le gclid (clic sur une annonce Google) n'est conservé qu'avec l'accord « Publicité »
  function keepGclid() { if (landingGclid && consent().ads) { try { localStorage.setItem('otreau_gclid', JSON.stringify({ v: landingGclid, t: Date.now() })); } catch (e) {} } }
  function gclid() {
    if (!consent().ads) return '';
    if (landingGclid) return landingGclid;
    try { var s = JSON.parse(localStorage.getItem('otreau_gclid')); if (s && Date.now() - s.t < 90 * 864e5) return s.v; } catch (e) {}
    var a = cookie('_gcl_aw').split('.'); return a.length >= 3 ? a.slice(2).join('.') : '';
  }
  keepGclid();

  function setConsent(type) {
    var c = consent();
    gtag('consent', type, {
      analytics_storage: c.analytics ? 'granted' : 'denied',
      ad_storage: c.ads ? 'granted' : 'denied',
      ad_user_data: c.ads ? 'granted' : 'denied',
      ad_personalization: c.ads ? 'granted' : 'denied'
    });
  }
  function load() {
    if (loaded || !wanted()) return;
    loaded = true;
    setConsent('default');
    var s = document.createElement('script'); s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA4_ID || ADS_ID);
    document.head.appendChild(s);
    gtag('js', new Date());
    if (GA4_ID && consent().analytics) { gaOn = true; gtag('config', GA4_ID, { cookie_domain: 'otreau.com' }); }
    if (ADS_ID && consent().ads) { adsOn = true; gtag('config', ADS_ID, { cookie_domain: 'otreau.com' }); }
    flush();
  }
  var adsOn = false, gaOn = false;
  document.addEventListener('otreau:consent', function () {
    keepGclid();
    if (loaded) { setConsent('update'); if (GA4_ID && consent().analytics && !gaOn) { gaOn = true; gtag('config', GA4_ID, { cookie_domain: 'otreau.com' }); } if (ADS_ID && consent().ads && !adsOn) { adsOn = true; gtag('config', ADS_ID, { cookie_domain: 'otreau.com' }); } }
    load();
  });

  /* ---------- événements ---------- */
  function num(x) { return Math.round(parseFloat(x || 0) * 100) / 100; }
  function vid(gid) { return String(gid || '').split('/').pop(); }
  function item(p, v, q) {
    return {
      item_id: vid(v && v.id), item_name: p && p.title, item_brand: 'Otreau',
      item_variant: v && v.title !== 'Default Title' ? v.title : undefined,
      price: num(v && v.price && v.price.amount), quantity: q || 1
    };
  }
  function send(name, params) {
    if (!wanted()) return;
    if (!loaded) { queue(name, params); load(); return; }
    gtag('event', name, params);
  }
  function queue(name, params) {
    try { var q = JSON.parse(sessionStorage.getItem(QKEY) || '[]'); q.push([name, params]); sessionStorage.setItem(QKEY, JSON.stringify(q.slice(-10))); } catch (e) {}
  }
  function flush() {
    try { var q = JSON.parse(sessionStorage.getItem(QKEY) || '[]'); sessionStorage.removeItem(QKEY); q.forEach(function (e) { gtag('event', e[0], e[1]); }); } catch (e) {}
  }

  // Fiche produit affichée (données Shopify chargées)
  document.addEventListener('otreau:view_item', function (e) {
    var p = e.detail; if (!p || !p.variants) return;
    var v = p.variants.nodes[0];
    send('view_item', { currency: CUR, value: num(v.price.amount), items: [item(p, v, 1)] });
  });
  // Ajout au panier : la page part ensuite vers le panier, on met l'événement en file pour la page suivante
  document.addEventListener('otreau:add_to_cart', function (e) {
    var d = e.detail || {}, value = num(d.variant && d.variant.price.amount) * (d.quantity || 1);
    var params = { currency: CUR, value: value, items: [item(d.product, d.variant, d.quantity)] };
    if (wanted()) queue('add_to_cart', params);
    if (ADS_ID && ADS_ADD_TO_CART && consent().ads) queue('conversion', { send_to: ADS_ID + '/' + ADS_ADD_TO_CART, value: value, currency: CUR });
  });
  // Page panier
  if (/\/panier\.html$/.test(location.pathname)) document.addEventListener('otreau:cart', function (e) {
    var c = e.detail; if (!c || !c.lines) return;
    send('view_cart', { currency: CUR, value: num(c.cost && c.cost.subtotalAmount.amount), items: c.lines.nodes.map(function (l) { return item(l.merchandise.product, l.merchandise, l.quantity); }) });
  }, { once: true });

  /* ---------- relais vers le pixel Shopify (attributs du panier, masqués au client grâce au « _ ») ---------- */
  window.otreauTracking = {
    cartAttributes: function () {
      var c = consent(), a = [{ key: '_consent', value: (c.analytics ? 'a' : '') + (c.ads ? 'p' : '') || '-' }];
      var cid = gaClientId(); if (cid && c.analytics) a.push({ key: '_ga_cid', value: cid });
      var g = gclid(); if (g && c.ads) a.push({ key: '_gclid', value: g });
      return a;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
})();
