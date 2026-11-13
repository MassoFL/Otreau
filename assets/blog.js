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
    return t.length > 180 ? t.slice(0, 177).replace(/\s+\S*$/, '').replace(/[\s.,;:!?…]+$/, '') + '…' : t;
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
      // partage (réseaux sociaux) + données structurées pour Google
      function meta(attr, key, val) { if (!val) return; var m = document.querySelector('meta[' + attr + '="' + key + '"]'); if (!m) { m = document.createElement('meta'); m.setAttribute(attr, key); document.head.appendChild(m); } m.content = val; }
      var url = location.origin + location.pathname + '?a=' + encodeURIComponent(handle);
      meta('property', 'og:type', 'article'); meta('property', 'og:title', a.title); meta('property', 'og:description', desc);
      meta('property', 'og:url', url); if (a.image) meta('property', 'og:image', img(a.image.url, 1200));
      meta('name', 'twitter:card', a.image ? 'summary_large_image' : 'summary');
      var can = document.querySelector('link[rel="canonical"]'); if (!can) { can = document.createElement('link'); can.rel = 'canonical'; document.head.appendChild(can); } can.href = url;
      var ld = document.createElement('script'); ld.type = 'application/ld+json';
      ld.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'BlogPosting', headline: a.title, description: desc || undefined,
        image: a.image ? [img(a.image.url, 1600)] : undefined, datePublished: a.publishedAt, mainEntityOfPage: url,
        author: { '@type': 'Organization', name: (a.authorV2 && a.authorV2.name) || 'Otreau' }, publisher: { '@type': 'Organization', name: 'Otreau' } });
      document.head.appendChild(ld);
      var crumb = document.getElementById('article-crumb'); if (crumb) crumb.textContent = a.title;
      // ---- mise en page magazine ----
      var tmp = document.createElement('div'); tmp.innerHTML = a.contentHtml || '';
      // nettoyage de l'éditeur Shopify : titres/paragraphes vides, <span> inutiles
      [].slice.call(tmp.querySelectorAll('h1,h2,h3,h4,p,li')).forEach(function (e) { if (!e.textContent.trim() && !e.querySelector('img,iframe,video')) e.remove(); });
      [].slice.call(tmp.querySelectorAll('span')).forEach(function (sp) { if (!sp.attributes.length) sp.replaceWith.apply(sp, [].slice.call(sp.childNodes)); });
      [].slice.call(tmp.querySelectorAll('h1')).forEach(function (h) { var h2 = document.createElement('h2'); h2.innerHTML = h.innerHTML; h.replaceWith(h2); });
      [].slice.call(tmp.querySelectorAll('li > p:only-child')).forEach(function (pp) { pp.replaceWith.apply(pp, [].slice.call(pp.childNodes)); });
      // chapô : l'extrait Shopify, sinon le premier paragraphe du texte
      var lead = a.excerpt ? esc(a.excerpt) : '';
      if (!lead) { var p1 = tmp.querySelector(':scope > p'); if (p1 && p1 === tmp.firstElementChild) { lead = p1.innerHTML; p1.remove(); } }
      // intertitres : numéro mis en valeur, ancre pour le sommaire ; bloc « Sources » à part
      var toc = [], n = 0;
      [].slice.call(tmp.querySelectorAll(':scope > h2')).forEach(function (h) {
        var t = h.textContent.trim();
        if (/^sources?\s*:?$/i.test(t)) {
          var box = document.createElement('section'); box.className = 'ar-sources'; h.parentNode.insertBefore(box, h);
          var nx = h; while (nx && (nx === h || nx.tagName !== 'H2')) { var nn = nx.nextElementSibling; box.appendChild(nx); nx = nn; }
          return;
        }
        n++; h.id = 'partie-' + n;
        var m = /^(\d{1,2})[.)]\s*(.+)$/.exec(t), label = m ? m[2] : t;
        if (m) h.innerHTML = '<span class="ar-num">' + ('0' + m[1]).slice(-2) + '</span><span class="ar-h2t">' + esc(m[2]) + '</span>';
        else h.innerHTML = '<span class="ar-h2t">' + h.innerHTML + '</span>';
        toc.push({ id: h.id, num: m ? ('0' + m[1]).slice(-2) : '', t: label.replace(/\s*:.*$/, '') });
      });
      // lettrine sur le premier paragraphe du texte
      var first = tmp.querySelector(':scope > p'); if (first) first.classList.add('ar-drop');
      // photos du texte : en grand format, légende = texte alternatif
      [].slice.call(tmp.querySelectorAll('img')).forEach(function (im) {
        var host = im.closest('p') || im; if (host.closest('figure')) return;
        var fg = document.createElement('figure'); fg.className = 'ar-fig'; host.parentNode.insertBefore(fg, host); fg.appendChild(im);
        if (host !== im && !host.textContent.trim()) host.remove();
        if (im.alt) { var fc = document.createElement('figcaption'); fc.textContent = im.alt; fg.appendChild(fc); }
        im.loading = 'lazy';
      });
      [].slice.call(tmp.querySelectorAll('a[href]')).forEach(function (l) {
        var m = /^https?:\/\/(?:www\.)?(?:claudeusercontent\.com|otreau\.com)\/(.*)$/i.exec(l.getAttribute('href'));
        if (m) { l.setAttribute('href', m[1] || 'index.html'); return; }
        if (/^https?:/.test(l.getAttribute('href')) && l.hostname !== location.hostname) { l.target = '_blank'; l.rel = 'noopener'; }
      });
      // typographie française : espace insécable avant : ; ! ? et à l'intérieur des guillemets
      function frTypo(root) {
        var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), t;
        while ((t = w.nextNode())) t.nodeValue = t.nodeValue.replace(/ ([:;!?»])/g, '\u00A0$1').replace(/« /g, '«\u00A0');
      }
      frTypo(tmp);
      function frStr(x) { return String(x).replace(/ ([:;!?»])/g, '\u00A0$1').replace(/« /g, '«\u00A0'); }
      a.title = frStr(a.title); lead = frStr(lead); toc.forEach(function (x) { x.t = frStr(x.t); });
      var kicker = a.tags.length ? a.tags.map(esc).join(' · ') : 'Le journal Otreau';
      art.classList.add('is-mag'); art.classList.add('is-hz');
      // ---- lecture horizontale continue : le texte coule en colonnes de la hauteur de l'écran ----
      var tocHtml = toc.length > 1 ? '<nav class="ah-toc" aria-label="Sommaire"><p>Au sommaire</p><ol>' + toc.map(function (x) {
        return '<li><a href="#' + x.id + '">' + (x.num ? '<span>' + x.num + '</span>' : '') + esc(x.t) + '</a></li>'; }).join('') + '</ol></nav>' : '';
      art.innerHTML =
        '<div class="ar-progress" aria-hidden="true"><i></i></div>' +
        '<div class="ah-flow ar-body" tabindex="0" aria-label="Article, défilement horizontal">' +
          '<div class="ah-cover">' +
            '<header class="ar-head">' +
              '<p class="ar-tags">' + kicker + '</p>' +
              '<h1>' + esc(a.title) + '</h1>' +
              '<p class="ar-meta"><span>Par ' + esc((a.authorV2 && a.authorV2.name) || 'Otreau') + '</span><span>' + esc(date(a.publishedAt)) + '</span><span>' + minutes(a.contentHtml) + ' min de lecture</span></p>' +
            '</header>' +
          '</div>' +
          (a.image ? '<figure class="ah-photo"><img src="' + esc(img(a.image.url, 1400)) + '" alt="' + esc(a.image.altText || a.title) + '"></figure>' : '') +
          '<div class="ah-open">' + (lead ? '<p class="ar-lead">' + lead + '</p>' : '') + tocHtml + '</div>' +
          tmp.innerHTML +
          '<aside class="ar-cta"><p>Envie de garder la chaleur pendant vos sorties d’hiver ? Découvrez nos vêtements chauffants.</p><a href="collection.html">Voir la collection</a></aside>' +
          '<p class="ar-back"><a class="bl-btn line" href="blog.html"><span aria-hidden="true">←</span>Tous les articles</a></p>' +
        '</div>' +
        '<nav class="ah-nav" aria-label="Défilement de l’article">' +
          '<button type="button" class="ah-prev" aria-label="Reculer"><span aria-hidden="true">←</span></button>' +
          '<span class="ah-where" aria-live="polite"></span>' +
          '<button type="button" class="ah-next" aria-label="Avancer"><span aria-hidden="true">→</span></button>' +
        '</nav>';
      (function () {
        var flow = art.querySelector('.ah-flow'), bar = art.querySelector('.ar-progress i'), where = art.querySelector('.ah-where'),
            prev = art.querySelector('.ah-prev'), next = art.querySelector('.ah-next'), nav = art.querySelector('.ah-nav'),
            heads = [].slice.call(flow.querySelectorAll('h2[id]')), rq = 0;
        // hauteur : tout l'espace visible sous l'en-tête du site, moins la barre de navigation
        // colonnes calculées pour qu'un nombre entier tienne exactement dans la largeur visible
        var colStep = 0;
        function size() {
          var top = flow.getBoundingClientRect().top + scrollY;
          var h = innerHeight - top - nav.offsetHeight - 30;
          art.style.setProperty('--ah-h', Math.max(380, Math.round(h)) + 'px');
          var W = flow.clientWidth, gap = W < 700 ? 40 : 64, n = Math.max(1, Math.floor((W + gap) / (400 + gap))), cw = (W - (n - 1) * gap) / n - .5;
          flow.style.columnWidth = cw + 'px'; flow.style.columnGap = gap + 'px'; colStep = cw + .5 + gap;
          upd();
        }
        function step() { return colStep || flow.clientWidth; }
        // à la fin d'un défilement, on se cale sur le début d'une colonne
        var snapT = 0;
        function snap() { var k = Math.round(flow.scrollLeft / step()), x = Math.min(flow.scrollWidth - flow.clientWidth, Math.round(k * step())); if (Math.abs(x - flow.scrollLeft) > 1) flow.scrollTo({ left: x, behavior: 'smooth' }); }
        flow.addEventListener('scroll', function () { clearTimeout(snapT); snapT = setTimeout(snap, 160); }, { passive: true });
        function upd() {
          rq = 0; var max = flow.scrollWidth - flow.clientWidth, x = flow.scrollLeft;
          if (bar) bar.style.transform = 'scaleX(' + (max > 0 ? x / max : 1) + ')';
          prev.disabled = x <= 2; next.disabled = x >= max - 2;
          var fr = flow.getBoundingClientRect(), cur = x > step() * 1.5 ? 'Introduction' : 'Couverture';
          heads.forEach(function (h) { if (h.getBoundingClientRect().left < fr.left + fr.width * .5) cur = (h.querySelector('.ar-h2t') || h).textContent.replace(/\s*:.*$/, ''); });
          where.textContent = cur;
        }
        flow.addEventListener('scroll', function () { if (!rq) rq = requestAnimationFrame(upd); }, { passive: true });
        prev.addEventListener('click', function () { flow.scrollBy({ left: -step(), behavior: 'smooth' }); });
        next.addEventListener('click', function () { flow.scrollBy({ left: step(), behavior: 'smooth' }); });
        // la molette fait avancer le texte à l'horizontale ; aux deux bouts, la page reprend son défilement normal
        flow.addEventListener('wheel', function (e) {
          if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
          var max = flow.scrollWidth - flow.clientWidth, x = flow.scrollLeft, d = e.deltaY * (e.deltaMode === 1 ? 32 : 1);
          if ((d > 0 && x < max - 1) || (d < 0 && x > 1)) { e.preventDefault(); flow.scrollLeft = x + d; }
        }, { passive: false });
        flow.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); flow.scrollBy({ left: step(), behavior: 'smooth' }); }
          else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); flow.scrollBy({ left: -step(), behavior: 'smooth' }); }
        });
        // liens du sommaire et liens internes : on glisse jusqu'à la partie
        function goTo(el, smooth) { var fr = flow.getBoundingClientRect(), r = el.getBoundingClientRect(); flow.scrollTo({ left: flow.scrollLeft + r.left - fr.left - (parseFloat(getComputedStyle(flow).paddingLeft) || 0), behavior: smooth ? 'smooth' : 'auto' }); }
        art.addEventListener('click', function (e) {
          var l = e.target.closest('a[href^="#"]'); if (!l) return;
          var t = document.getElementById(l.getAttribute('href').slice(1)); if (!t || !flow.contains(t)) return;
          e.preventDefault(); goTo(t, true); history.replaceState(null, '', location.pathname + location.search + l.getAttribute('href'));
        });
        addEventListener('resize', size); addEventListener('load', size);
        [].forEach.call(flow.querySelectorAll('img'), function (im) { im.addEventListener('load', upd); });
        size();
        if (location.hash) { var t0 = document.getElementById(location.hash.slice(1)); if (t0 && flow.contains(t0)) setTimeout(function () { goTo(t0, false); }, 60); }
      })();
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
