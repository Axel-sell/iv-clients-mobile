/* IV Clients — « paquet de données » pour un téléphone ou une tablette (06/10/2026).
   Commun au PC (qui le prépare) et à la version mobile (qui l'importe) : un seul code.

   Le paquet contient data.json TEL QUEL (fiches, corbeille, réglages, mot de passe
   administrateur), chiffré avec un code tiré au sort par le PC :
   AES-GCM 256 bits, clé tirée du code par PBKDF2-SHA-256 (TOURS ci-dessous), sel et IV
   tirés au hasard à chaque paquet. Sans le code, le fichier ne livre rien ; un octet
   modifié et le déchiffrement est refusé (GCM authentifie le contenu).
   Le jeton du site n'y entre jamais : il est retiré avant le chiffrement.

   1.38.3 (audit de sécurité du 27/10/2026) : le code n'est plus choisi par
   l'utilisateur — six lettres se devinaient. Le PC le tire au sort sous la forme du
   code de secours (20 signes en 4 groupes) et le paquet porte la marque « tire ».
   À l'import, la saisie tolère tirets, espaces et minuscules. Un paquet plus ancien
   (code choisi, sans la marque) s'ouvre toujours avec son code exact. */
'use strict';

const PAQUET = (() => {
  const FORMAT = 'iv-clients-paquet';
  const TOURS = 250000;
  const CODE_TIRE = /^[A-HJKMNP-Z2-9]{5}(-[A-HJKMNP-Z2-9]{5}){3}$/;   // alphabet du code de secours

  const enB64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const deB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  /* « abcde fghjk-mnpqr stuvw » → « ABCDE-FGHJK-MNPQR-STUVW » ; '' si ce n'est pas la forme. */
  const formeCode = (saisie) => {
    const s = String(saisie || '').toUpperCase().replace(/[\s-]/g, '');
    return s.length === 20 ? s.match(/.{5}/g).join('-') : '';
  };

  async function cle(code, sel, tours) {
    const brut = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sel, iterations: tours, hash: 'SHA-256' },
      brut, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  /* db → texte du fichier .ivpaquet. Le code est celui tiré au sort par le PC. */
  async function chiffrer(db, code, version) {
    if (!CODE_TIRE.test(String(code || ''))) throw new Error('code du paquet mal formé');
    const copie = JSON.parse(JSON.stringify(db));
    if (copie.settings) copie.settings.syncRefreshToken = '';
    const sel = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const k = await cle(code, sel, TOURS);
    const clair = new TextEncoder().encode(JSON.stringify(copie));
    const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, clair));
    return JSON.stringify({
      format: FORMAT, version: 1, logiciel: version || '', cree: new Date().toISOString(),
      tours: TOURS, tire: true, sel: enB64(sel), iv: enB64(iv), donnees: enB64(chiffre)
    });
  }

  /* texte du fichier → db. Deux refus distincts, chacun avec sa phrase. */
  async function dechiffrer(texte, code) {
    let p;
    try {
      p = JSON.parse(texte);
      if (!p || p.format !== FORMAT || p.version !== 1 || !p.sel || !p.iv || !p.donnees) throw 0;
      p = { tours: Number(p.tours), tire: p.tire === true, sel: deB64(p.sel), iv: deB64(p.iv), donnees: deB64(p.donnees), cree: p.cree };
      if (!(p.tours >= 100000) || p.sel.length !== 16 || p.iv.length !== 12 || p.donnees.length < 17) throw 0;
    } catch (_) {
      throw new Error('Ce fichier n\'est pas un paquet de données IV Clients, ou il est abîmé.');
    }
    let clair;
    try {
      const k = await cle(p.tire ? formeCode(code) : String(code || ''), p.sel, p.tours);
      clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: p.iv }, k, p.donnees);
    } catch (_) {
      throw new Error('Code incorrect — ou le fichier a été modifié en route. Rien n\'a été changé.');
    }
    const db = JSON.parse(new TextDecoder().decode(clair));
    if (!db || !Array.isArray(db.clients) || !db.settings) throw new Error('Le paquet ne contient pas de données IV Clients.');
    return { db, cree: p.cree };
  }

  return { chiffrer, dechiffrer, EXTENSION: '.ivpaquet' };
})();
