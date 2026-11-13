// Formulaire de rétractation en ligne : envoie la demande au service client
// et un accusé de réception au client (article L221-21 du Code de la consommation).
// Variables à définir dans Vercel › Settings › Environment Variables :
//   RESEND_API_KEY  clé d'API Resend (jamais dans le code)
//   RESEND_FROM     expéditeur vérifié dans Resend, ex. « Otreau <retours@otreau.com> »
//   CONTACT_TO      (facultatif) destinataire interne, par défaut contact@otreau.com

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clean = (v, max) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function send(key, payload) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error('Resend ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return r.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'Méthode non autorisée.' }); }
  const key = process.env.RESEND_API_KEY, from = process.env.RESEND_FROM;
  const to = process.env.CONTACT_TO || 'contact@otreau.com';
  if (!key || !from) return res.status(503).json({ ok: false, error: 'Le formulaire n’est pas encore configuré. Écrivez-nous à contact@otreau.com.' });

  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  if (b.website) return res.status(200).json({ ok: true }); // champ piège anti-robots

  const d = {
    nom: clean(b.nom, 120), email: clean(b.email, 160), commande: clean(b.commande, 40),
    produits: clean(b.produits, 600), commandeLe: clean(b.commandeLe, 20), recuLe: clean(b.recuLe, 20),
    adresse: clean(b.adresse, 300), message: String(b.message || '').trim().slice(0, 2000)
  };
  if (!d.nom || !EMAIL.test(d.email) || !d.commande || !d.produits || b.declaration !== true) {
    return res.status(400).json({ ok: false, error: 'Merci de remplir les champs obligatoires et de cocher la déclaration.' });
  }

  const now = new Date();
  const quand = now.toLocaleString('fr-FR', { timeZone: 'Etc/GMT-1', dateStyle: 'long', timeStyle: 'short' }) + ' (GMT+1)';
  const ref = 'R-' + now.getTime().toString(36).toUpperCase();
  const lignes = [
    ['Référence de la demande', ref], ['Reçue le', quand], ['Nom', d.nom], ['E-mail', d.email],
    ['N° de commande', d.commande], ['Produit(s) concerné(s)', d.produits],
    ['Commandé le', d.commandeLe || '—'], ['Reçu le', d.recuLe || '—'], ['Adresse', d.adresse || '—'],
    ['Message', d.message || '—']
  ];
  const table = '<table cellpadding="6" style="border-collapse:collapse;font:14px/1.5 Arial,sans-serif">' +
    lignes.map(([k, v]) => '<tr><td style="color:#666;vertical-align:top">' + esc(k) + '</td><td><strong>' + esc(v).replace(/\n/g, '<br>') + '</strong></td></tr>').join('') + '</table>';
  const texte = lignes.map(([k, v]) => k + ' : ' + v).join('\n');

  try {
    await send(key, {
      from, to: [to], reply_to: d.email,
      subject: 'Rétractation ' + ref + ' · commande ' + d.commande,
      html: '<p>Nouvelle demande de rétractation reçue depuis otreau.com :</p>' + table, text: texte
    });
    await send(key, {
      from, to: [d.email], reply_to: to,
      subject: 'Accusé de réception de votre rétractation · commande ' + d.commande,
      html: '<div style="font:15px/1.6 Arial,sans-serif;color:#14212B">' +
        '<p>Bonjour ' + esc(d.nom) + ',</p>' +
        '<p>Nous accusons réception de votre demande de rétractation, reçue le <strong>' + esc(quand) + '</strong>. Voici le récapitulatif :</p>' + table +
        '<p><strong>Prochaine étape :</strong> renvoyez le ou les produits au plus tard <strong>14 jours</strong> après cette demande, à l’adresse suivante :<br>' +
        'Otreau – Service retours<br>2 allée des Grandes Maisons<br>94110 Arcueil<br>France</p>' +
        '<p>Glissez votre numéro de commande dans le colis. Les frais de retour sont à votre charge, sauf produit défectueux ou non conforme. ' +
        'Nous vous remboursons au plus tard 14 jours après votre demande, par le moyen de paiement utilisé lors de la commande ; ' +
        'nous pouvons attendre la réception du colis ou une preuve de son expédition.</p>' +
        '<p>Notre service client en français reste à votre disposition à contact@otreau.com ou au +33 7 53 86 26 68, du lundi au vendredi, de 10h00 à 18h00 (GMT+1).</p>' +
        '<p>L’équipe Otreau<br><span style="color:#666">Otreau est une marque de Massoali OÜ, Ahtri tn 12, 15551 Tallinn, Estonie.</span></p></div>',
      text: 'Bonjour ' + d.nom + ',\n\nNous accusons réception de votre demande de rétractation, reçue le ' + quand + '.\n\n' + texte +
        '\n\nRenvoyez le ou les produits au plus tard 14 jours après cette demande à : Otreau – Service retours, 2 allée des Grandes Maisons, 94110 Arcueil, France.' +
        '\nNous vous remboursons au plus tard 14 jours après votre demande, par le moyen de paiement utilisé lors de la commande.\n\nL’équipe Otreau'
    });
    return res.status(200).json({ ok: true, ref });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ ok: false, error: 'L’envoi a échoué. Écrivez-nous à contact@otreau.com en précisant votre numéro de commande.' });
  }
};
