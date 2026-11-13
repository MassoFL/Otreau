/* Bandeau cookies Otreau : choix conservé 6 mois dans le stockage local (otreau_consent).
   Aujourd'hui aucun outil de mesure ni de publicité n'est installé. Le jour où on en ajoute un,
   on le charge seulement si window.otreauConsent.analytics (ou .ads) vaut true,
   ou à l'événement « otreau:consent ». */
(function () {
  var KEY = 'otreau_consent', MAX = 182 * 24 * 3600 * 1000, VER = 2, CLARITY_ID = 'zcytttyiac';
  /* Microsoft Clarity (mesure d'audience) : chargé uniquement après accord, puis signal consentv2 */
  var clarityOn = false;
  function clarity(c) {
    if (c.analytics && !clarityOn) {
      clarityOn = true;
      (function (c2, l, a, r, i, t, y) { c2[a] = c2[a] || function () { (c2[a].q = c2[a].q || []).push(arguments); };
        t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
        y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y); })(window, document, 'clarity', 'script', CLARITY_ID);
    }
    if (window.clarity) window.clarity('consentv2', { ad_Storage: c.ads ? 'granted' : 'denied', analytics_Storage: c.analytics ? 'granted' : 'denied' });
  }
  function read() { try { var c = JSON.parse(localStorage.getItem(KEY)); if (c && c.v === VER && Date.now() - c.date < MAX) return c; } catch (e) {} return null; }
  function save(a, ads) {
    var c = { v: VER, analytics: !!a, ads: !!ads, date: Date.now() };
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {}
    window.otreauConsent = c;
    clarity(c);
    try { document.dispatchEvent(new CustomEvent('otreau:consent', { detail: c })); } catch (e) {}
    close();
  }
  window.otreauConsent = read() || { analytics: false, ads: false, date: 0 };

  var css = '#ck{position:fixed;z-index:2147483000;left:16px;right:16px;bottom:16px;margin:0 auto;max-width:640px;background:#14212B;color:#FFFFFF;border-radius:10px;border:1px solid rgba(255,255,255,.16);box-shadow:0 24px 60px -20px rgba(0,0,0,.7);padding:22px 24px;font-family:Manrope,system-ui,sans-serif;font-size:14px;line-height:1.55;opacity:0;transform:translateY(16px);transition:opacity .35s ease,transform .35s ease}' +
    '#ck.is-in{opacity:1;transform:none}#ck h2{margin:0 0 8px;font-size:16px;font-weight:700;color:#FFFFFF;letter-spacing:0}#ck p{margin:0 0 10px;color:rgba(255,255,255,.85)}#ck a{color:#FFFFFF;text-decoration:underline;text-underline-offset:3px}' +
    '#ck .ck-b{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}#ck button{flex:1 1 150px;min-height:44px;padding:0 16px;border-radius:4px;font:700 14px Manrope,system-ui,sans-serif;cursor:pointer;border:1.5px solid #FFFFFF;background:transparent;color:#FFFFFF;transition:background .2s,color .2s}' +
    '#ck button.ck-main{background:#FFFFFF;color:#14212B}#ck button:hover{background:#F5A623;border-color:#F5A623;color:#14212B}#ck button:focus-visible{outline:3px solid #F5A623;outline-offset:2px}' +
    '#ck .ck-opts{display:none;margin:12px 0 0;padding:12px 0 0;border-top:1px solid rgba(255,255,255,.15)}#ck.is-custom .ck-opts{display:block}#ck .ck-opt{display:flex;gap:12px;align-items:flex-start;margin:0 0 10px}#ck .ck-opt input{margin-top:4px;width:18px;height:18px;accent-color:#F5A623;flex:none}#ck .ck-opt small{display:block;color:rgba(255,255,255,.7)}' +
    '#ck .ck-save{display:none}#ck.is-custom .ck-save{display:block}#ck.is-custom .ck-perso{display:none}@media (max-width:520px){#ck{left:10px;right:10px;bottom:10px;padding:18px}}@media (prefers-reduced-motion:reduce){#ck{transition:none}}';

  var box = null;
  function open() {
    if (box) return;
    if (!document.getElementById('ck-css')) { var st = document.createElement('style'); st.id = 'ck-css'; st.textContent = css; document.head.appendChild(st); }
    var c = window.otreauConsent;
    box = document.createElement('div'); box.id = 'ck'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-labelledby', 'ck-t'); box.setAttribute('aria-live', 'polite');
    box.innerHTML = '<h2 id="ck-t">Vos choix concernant les cookies</h2>' +
      '<p>Aujourd’hui, otreau.com utilise uniquement ce qui est nécessaire au fonctionnement de la boutique, comme votre panier.</p>' +
      '<p>Avec votre accord, nous utilisons <strong>Microsoft Clarity</strong> pour mesurer l’audience et comprendre comment le site est utilisé, afin de l’améliorer. Nous pourrons aussi utiliser d’autres outils de mesure (comme Google Analytics) et de <strong>publicité</strong> (comme Google Ads ou Meta). Rien n’est activé sans votre accord, que vous pouvez modifier à tout moment via « Gérer les cookies » en bas de page. <a href="politique-de-cookies.html">En savoir plus</a></p>' +
      '<div class="ck-opts">' +
      '<label class="ck-opt"><input type="checkbox" checked disabled><span><strong>Nécessaires</strong><small>Panier et fonctionnement du site. Toujours actifs.</small></span></label>' +
      '<label class="ck-opt"><input type="checkbox" id="ck-a"' + (c.analytics ? ' checked' : '') + '><span><strong>Mesure d’audience</strong><small>Microsoft Clarity (cartes de chaleur, enregistrement des parcours, champs de saisie masqués) et, à l’avenir, Google Analytics.</small></span></label>' +
      '<label class="ck-opt"><input type="checkbox" id="ck-ads"' + (c.ads ? ' checked' : '') + '><span><strong>Publicité</strong><small>Par exemple Google Ads ou Meta : mesurer nos campagnes et vous montrer des publicités adaptées.</small></span></label>' +
      '</div>' +
      '<div class="ck-b"><button type="button" class="ck-no">Tout refuser</button><button type="button" class="ck-perso">Personnaliser</button><button type="button" class="ck-save">Enregistrer mes choix</button><button type="button" class="ck-main ck-yes">Tout accepter</button></div>';
    document.body.appendChild(box);
    box.querySelector('.ck-no').onclick = function () { save(false, false); };
    box.querySelector('.ck-yes').onclick = function () { save(true, true); };
    box.querySelector('.ck-perso').onclick = function () { box.classList.add('is-custom'); box.querySelector('#ck-a').focus(); };
    box.querySelector('.ck-save').onclick = function () { save(box.querySelector('#ck-a').checked, box.querySelector('#ck-ads').checked); };
    requestAnimationFrame(function () { requestAnimationFrame(function () { box && box.classList.add('is-in'); }); });
  }
  function close() { if (!box) return; var b = box; box = null; b.classList.remove('is-in'); setTimeout(function () { b.remove(); }, 350); }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-consent-open]');
    if (a) { e.preventDefault(); close(); setTimeout(open, box ? 360 : 0); }
  });
  function init() { var c = read(); if (c) clarity(c); else open(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
