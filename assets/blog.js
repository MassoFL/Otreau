/* Otreau — Blog
   Les articles viennent du blog Shopify (Boutique en ligne › Articles de blog).
   blog.html  : liste des articles (le plus récent mis en avant, filtres par étiquette)
   article.html?a=<identifiant> : un article + 3 autres à lire */
(function () {
  var SHOP = {
    domain: 'pcbvi7-ea.myshopify.com',
    token: '454c67e9623c56f1a73831ea0a3e76bf',   // jeton PUBLIC Storefront
    version: '2026-10'
  };

  function gql(query, variables) {
    return fetch('https://' + SHOP.domain + '/api/' + SHOP.version + '/graphql.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': SHOP.token },
      body: JSON.stringify({ query: query, variables: variables || {} })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.errors) throw new Error(j.errors[0].message);
      return j.data;
    });
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function date(iso) { try { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return ''; } }
  function minutes(html) {
    var words = String(html || '').replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 220));
  }
  function img(url, w) { return url ? url + (url.indexOf('?') < 0 ? '?' : '&') + 'width=' + w : ''; }
  function link(a) { return 'article.html?a=' + encodeURIComponent(a.handle); }
  function excerpt(a) {
    var t = a.excerpt || String(a.content || '').replace(/\s+/g, ' ').trim();
    return t.length > 180 ? t.slice(0, 177).replace(/\s+\S*$/, '') + '…' : t;
  }

  var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h11a3 3 0 0 1 3 3v11H7a3 3 0 0 1-3-3z"/><path d="M18 8h2v9a2 2 0 0 1-2 2"/><path d="M8 9h6M8 12.5h6M8 16h4"/></svg>';

  function card(a, featured) {
    var pic = a.image
      ? '<img src="' + esc(img(a.image.url, featured ? 1100 : 700)) + '" alt="' + esc(a.image.altText || a.title) + '" loading="lazy">'
      : '<span class="bl-noimg">' + ICON + '</span>';
    return '<a class="bl-card' + (featured ? ' is-featured' : '') + '" href="' + link(a) + '">' +
      '<span class="bl-pic">' + pic + '</span>' +
      '<span class="bl-txt">' +
        '<span class="bl-meta">' + esc(date(a.publishedAt)) + ' · ' + minutes(a.content) + ' min de lecture</span>' +
        '<span class="bl-title">' + esc(a.title) + '</span>' +
        '<span class="bl-ex">' + esc(excerpt(a)) + '</span>' +
        '<span class="bl-more">Lire l’article<span aria-hidden="true">→</span></span>' +
      '</span></a>';
  }

  function empty(box, title, text) {
    box.innerHTML = '<div class="bl-empty">' + ICON + '<h2>' + esc(title) + '</h2><p>' + esc(text) + '</p>' +
      '<a class="bl-btn" href="index.html#collection">Découvrir la collection</a></div>';
  }

  var FIELDS = 'handle title excerpt content publishedAt tags image { url altText }';

  /* ---------- Liste des articles ---------- */
  var grid = document.getElementById('blog-list');
  if (grid) {
    var tagsBox = document.getElementById('blog-tags');
    gql('{ articles(first: 60, sortKey: PUBLISHED_AT, reverse: true) { nodes { ' + FIELDS + ' } } }').then(function (d) {
      var all = d.articles.nodes;
      if (!all.length) { empty(grid, 'Les premiers articles arrivent bientôt', 'Conseils pour bien choisir, porter et entretenir vos vêtements chauffants : revenez nous voir très vite.'); return; }
      var tags = [];
      all.forEach(function (a) { a.tags.forEach(function (t) { if (tags.indexOf(t) < 0) tags.push(t); }); });
      var current = '';
      function render() {
        var list = current ? all.filter(function (a) { return a.tags.indexOf(current) >= 0; }) : all;
        grid.innerHTML = (list[0] ? card(list[0], true) : '') +
          (list.length > 1 ? '<div class="bl-grid">' + list.slice(1).map(function (a) { return card(a, false); }).join('') + '</div>' : '');
      }
      if (tags.length && tagsBox) {
        tagsBox.innerHTML = ['Tous'].concat(tags).map(function (t, i) {
          return '<button type="button" class="bl-tag" aria-pressed="' + (i === 0) + '" data-tag="' + esc(i ? t : '') + '">' + esc(t) + '</button>';
        }).join('');
        tagsBox.hidden = false;
        tagsBox.addEventListener('click', function (e) {
          var b = e.target.closest('.bl-tag'); if (!b) return;
          current = b.dataset.tag;
          tagsBox.querySelectorAll('.bl-tag').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
          render();
        });
      }
      render();
    }).catch(function () {
      empty(grid, 'Le blog est momentanément indisponible', 'Merci de réessayer dans quelques instants.');
    });
  }

  /* ---------- Un article ---------- */
  var art = document.getElementById('article');
  if (art) {
    var handle = new URLSearchParams(location.search).get('a') || '';
    var q = 'query($h: String!) { blogs(first: 10) { nodes { articleByHandle(handle: $h) { title contentHtml excerpt publishedAt tags image { url altText } authorV2 { name } seo { title description } } } } ' +
            'articles(first: 4, sortKey: PUBLISHED_AT, reverse: true) { nodes { ' + FIELDS + ' } } }';
    gql(q, { h: handle }).then(function (d) {
      var a = null;
      d.blogs.nodes.forEach(function (b) { if (!a && b.articleByHandle) a = b.articleByHandle; });
      if (!handle || !a) { empty(art, 'Article introuvable', 'Cet article n’existe pas ou n’est plus en ligne.'); return; }
      document.title = ((a.seo && a.seo.title) || a.title) + ' · Blog Otreau';
      var desc = (a.seo && a.seo.description) || a.excerpt;
      if (desc) { var m = document.querySelector('meta[name="description"]'); if (!m) { m = document.createElement('meta'); m.name = 'description'; document.head.appendChild(m); } m.content = desc; }
      var crumb = document.getElementById('article-crumb'); if (crumb) crumb.textContent = a.title;
      art.innerHTML =
        '<header class="ar-head">' +
          (a.tags.length ? '<p class="ar-tags">' + a.tags.map(esc).join(' · ') + '</p>' : '') +
          '<h1>' + esc(a.title) + '</h1>' +
          '<p class="ar-meta">' + esc(date(a.publishedAt)) + ' · ' + minutes(a.contentHtml) + ' min de lecture' + (a.authorV2 && a.authorV2.name ? ' · ' + esc(a.authorV2.name) : '') + '</p>' +
        '</header>' +
        (a.image ? '<figure class="ar-cover"><img src="' + esc(img(a.image.url, 1600)) + '" alt="' + esc(a.image.altText || a.title) + '"></figure>' : '') +
        '<div class="ar-body">' + a.contentHtml + '</div>' +
        '<p class="ar-back"><a class="bl-btn line" href="blog.html"><span aria-hidden="true">←</span>Tous les articles</a></p>';
      var others = d.articles.nodes.filter(function (x) { return x.handle !== handle; }).slice(0, 3);
      var more = document.getElementById('article-more');
      if (more && others.length) {
        more.innerHTML = '<h2 class="bl-h2">À lire aussi</h2><div class="bl-grid">' + others.map(function (x) { return card(x, false); }).join('') + '</div>';
        more.hidden = false;
      }
    }).catch(function () {
      empty(art, 'Le blog est momentanément indisponible', 'Merci de réessayer dans quelques instants.');
    });
  }
})();
