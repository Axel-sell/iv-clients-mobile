/* IV Clients — pont MOBILE (téléphone et tablette), 06/10/2026.
   Chargé AVANT renderer.js dans la version mobile seulement. Il fournit le même
   `window.api` que preload.js sur Windows, avec les moyens du navigateur :
   l'interface (index.html, renderer.js, styles.css) reste UNE seule et même copie.

   - Données : IndexedDB de l'appareil (stockage demandé « persistant »). Une
     nouvelle version de l'application ne touche qu'aux fichiers du service
     worker, jamais à IndexedDB : les fiches saisies ici restent.
   - Premier lancement : base vide + réglages d'usine, comme le PC (demande
     d'Alex du 19/10/2026 : il saisit lui-même, plus d'import obligatoire). Le
     paquet du PC ou une copie exportée s'importent dans Paramètres → Remplacer.
   - Copies de sécurité : 10 copies gardées dans l'appareil (lancement + 10 min).
   - Le jeton du site est rangé à part, jamais dans les données ni les copies. */
'use strict';

(() => {
  const VERSION = '1.37.0';          // posée par fabriquer-mobile.py
  const MISE_A_JOUR = '24/10/2026';
  const USINE = {"rates": {"CAD": 406.14, "EUR": 655.96, "USD": 563.29}, "fraisPaiementPct": 4, "fraisChargeFixe": 834, "fraisChargePct": 0, "feeCatalog": [{"label": "Frais RP (RPRF)", "amount": 600, "forfait": false, "site": "drp"}, {"label": "Frais de traitement", "amount": 990, "forfait": false, "site": "traitement"}, {"label": "Biométrie (1 personne)", "amount": 85, "forfait": true, "site": "biometrie"}, {"label": "Biométrie (couple / famille)", "amount": 170, "forfait": true, "site": "biometrieMax"}, {"label": "Frais enfant à charge", "amount": 270, "forfait": false, "site": "enfant"}], "preuveFonds": {"maj": "2025-07-07", "paliers": [{"personnes": 1, "cad": 15263}, {"personnes": 2, "cad": 19001}, {"personnes": 3, "cad": 23360}, {"personnes": 4, "cad": 28362}, {"personnes": 5, "cad": 32168}, {"personnes": 6, "cad": 36280}, {"personnes": 7, "cad": 40392}], "parPersonneEnPlus": 4112}, "visiteMedicale": {"mois": "2026-10", "tranches": [{"id": "enfant", "label": "De 0 à 10 ans", "min": 0, "max": 10, "fcfa": 63625}, {"id": "jeune", "label": "De 11 à 14 ans", "min": 11, "max": 14, "fcfa": 89650}, {"id": "adulte", "label": "15 ans et plus", "min": 15, "max": null, "fcfa": 114520}]}, "customTemplate": [], "baremeSite": {"auto": true, "luLe": "", "echec": ""}, "theme": "clair", "triClients": "nom", "groupeEtape": false};        // reglages-usine.json, filtré comme main.js
  const COPIES_GARDEES = 10;
  const ECART_COPIES = 10 * 60 * 1000;

  document.documentElement.classList.add('mobile');

  /* ---------- IndexedDB : une table clé → valeur ---------- */
  let base = null;
  function ouvrirBase() {
    if (base) return base;
    base = new Promise((ok, ko) => {
      const r = indexedDB.open('iv-clients', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
    return base;
  }
  async function lire(cle) {
    const b = await ouvrirBase();
    return new Promise((ok, ko) => {
      const r = b.transaction('kv').objectStore('kv').get(cle);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
  }
  async function ecrire(cle, valeur) {
    const b = await ouvrirBase();
    return new Promise((ok, ko) => {
      const t = b.transaction('kv', 'readwrite');
      t.objectStore('kv').put(valeur, cle);
      t.oncomplete = () => ok(true);
      t.onerror = () => ko(t.error);
    });
  }

  const sansJeton = (obj) => (obj && obj.settings && obj.settings.syncRefreshToken)
    ? Object.assign({}, obj, { settings: Object.assign({}, obj.settings, { syncRefreshToken: '' }) })
    : obj;
  const horodate = (d = new Date()) => {
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}-${z(d.getHours())}h${z(d.getMinutes())}`;
  };

  /* ---------- copies de sécurité dans l'appareil ---------- */
  async function copier(db, suffixe) {
    if (!db) return;
    const liste = (await lire('copies')) || [];
    liste.unshift({ nom: `donnees-${horodate()}${suffixe || ''}.json`, t: Date.now(), db: sansJeton(db) });
    await ecrire('copies', liste.slice(0, COPIES_GARDEES));
  }
  async function copieSiEcart(db) {
    const liste = (await lire('copies')) || [];
    if (!liste.length || Date.now() - liste[0].t > ECART_COPIES) await copier(db);
  }

  /* ---------- fenêtres de l'application (jamais confirm() brut) ---------- */
  function fenetre(titre, detail, boutons) {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'modal-overlay mobile-dialogue';
      ov.innerHTML = '<div class="modal-card" role="dialog" aria-modal="true"><h3></h3><p class="mobile-detail"></p><div class="modal-actions"></div></div>';
      ov.querySelector('h3').textContent = titre || 'IV Clients';
      const p = ov.querySelector('.mobile-detail');
      if (detail) p.textContent = detail; else p.remove();
      const zone = ov.querySelector('.modal-actions');
      boutons.forEach(([libelle, valeur, classe]) => {
        const b = document.createElement('button');
        b.className = 'btn ' + classe; b.textContent = libelle;
        b.onclick = () => { ov.remove(); resolve(valeur); };
        zone.appendChild(b);
      });
      document.body.appendChild(ov);
      zone.lastChild.focus();
    });
  }

  /* ---------- donner un fichier : partage du système, sinon téléchargement ---------- */
  async function donnerFichier(fichier) {
    if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
      try { await navigator.share({ files: [fichier] }); return true; }
      catch (e) { if (e && e.name === 'AbortError') return false; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(fichier); a.download = fichier.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return true;
  }

  /* ---------- page HTML → image PNG (partage de la fiche de suivi) ---------- */
  async function htmlEnPng(html, largeur) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const css = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n')
      .replace(/(^|[}\s,])body(?=[\s{,])/g, '$1.ivc-corps');
    const hote = document.createElement('div');
    hote.style.cssText = `position:fixed;left:-10000px;top:0;width:${largeur}px`;
    document.body.appendChild(hote);
    const ombre = hote.attachShadow({ mode: 'open' });
    ombre.innerHTML = `<style>${css}</style><div class="ivc-corps">${doc.body.innerHTML}</div>`;
    const corps = ombre.querySelector('.ivc-corps');
    await new Promise((r) => setTimeout(r, 60));
    const h = Math.min(6000, Math.max(200, Math.ceil(corps.getBoundingClientRect().height) + 2));
    const xhtml = new XMLSerializer().serializeToString(corps);
    const style = new XMLSerializer().serializeToString(Object.assign(document.createElementNS('http://www.w3.org/1999/xhtml', 'style'), { textContent: css }));
    hote.remove();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${style}${xhtml}</div></foreignObject></svg>`;
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const k = 2;
    const cv = document.createElement('canvas');
    cv.width = largeur * k; cv.height = h * k;
    const ctx = cv.getContext('2d');
    ctx.scale(k, k); ctx.drawImage(img, 0, 0);
    return new Promise((ok, ko) => cv.toBlob((b) => (b ? ok(b) : ko(new Error('image impossible'))), 'image/png'));
  }

  /* ---------- écran d'import du paquet ---------- */
  function choisirFichier() {
    return new Promise((resolve) => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = '.ivpaquet,application/json,text/plain,*/*';
      i.onchange = () => resolve(i.files && i.files[0] ? i.files[0] : null);
      i.click();
    });
  }

  /* Une copie faite par « Exporter mes données » : du JSON en clair, sans code. */
  function copieExportee(texte) {
    try {
      const d = JSON.parse(texte);
      return d && Array.isArray(d.clients) && d.settings && !d.donnees ? d : null;
    } catch (_) { return null; }
  }

  /* Fenêtre « Remplacer les données » (Paramètres). Résout avec la base importée,
     ou null si l'utilisateur renonce. Rien n'est écrit ici. */
  function ecranImport() {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'modal-overlay mobile-import';
      ov.innerHTML = `<div class="modal-card">
        <h3>Remplacer les données</h3>
        <p class="mobile-import-texte">Choisissez une copie exportée de cet appareil, ou un paquet préparé sur l'ordinateur. Les données actuelles sont d'abord mises de côté dans les copies de sécurité.</p>
        <button type="button" class="btn btn-ghost mobile-choisir">Choisir le fichier…</button>
        <p class="mobile-nom-fichier muted" hidden></p>
        <input type="password" class="mobile-code" placeholder="Code du paquet" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button type="button" class="btn btn-primary mobile-ouvrir">Ouvrir les données</button>
        <p class="lock-err mobile-err" role="alert" hidden></p>
        <button type="button" class="lien-retour mobile-annuler">Annuler</button>
      </div>`;
      document.body.appendChild(ov);
      let texte = null, copie = null;
      const $ = (s) => ov.querySelector(s);
      const erreur = (m) => { const e = $('.mobile-err'); e.textContent = m; e.hidden = !m; };
      $('.mobile-choisir').onclick = async () => {
        const f = await choisirFichier();
        if (!f) return;
        texte = await f.text(); copie = copieExportee(texte); erreur('');
        const n = $('.mobile-nom-fichier');
        n.textContent = copie ? `${f.name} — copie exportée, ${copie.clients.length} fiche${copie.clients.length > 1 ? 's' : ''}` : f.name;
        n.hidden = false;
        $('.mobile-code').hidden = !!copie;            // une copie exportée n'a pas de code
        (copie ? $('.mobile-ouvrir') : $('.mobile-code')).focus();
      };
      const ouvrir = async () => {
        if (texte === null) { erreur('Choisissez d\'abord le fichier.'); return; }
        if (copie) { ov.remove(); resolve(copie); return; }
        const b = $('.mobile-ouvrir'); b.disabled = true; b.textContent = 'Ouverture…';
        try {
          const { db } = await PAQUET.dechiffrer(texte, $('.mobile-code').value);
          ov.remove(); resolve(db);
        } catch (e) {
          erreur(e.message);
          b.disabled = false; b.textContent = 'Ouvrir les données';
        }
      };
      $('.mobile-ouvrir').onclick = ouvrir;
      $('.mobile-code').onkeydown = (e) => { if (e.key === 'Enter') ouvrir(); };
      $('.mobile-annuler').onclick = () => { ov.remove(); resolve(null); };
    });
  }

  /* Stockage « persistant » : l'appareil ne l'efface plus de lui-même pour faire
     de la place. Chrome l'accorde à une application installée sur l'écran
     d'accueil ; on redemande à chaque lancement et au premier enregistrement. */
  let protege = false;
  async function proteger() {
    if (protege || !(navigator.storage && navigator.storage.persist)) return protege;
    try { protege = (await navigator.storage.persisted()) || (await navigator.storage.persist()); } catch (_) {}
    return protege;
  }

  /* ---------- le pont ---------- */
  window.api = {
    mobile: true,

    async loadData() {
      proteger();
      let db = await lire('db');
      // tout premier lancement : base vide, renderer.js y pose les réglages d'usine
      if (!db) return { db: null, corrompu: '', sauvegardes: [], usine: USINE };
      await copier(db);                                   // copie de lancement, comme sur le PC
      db = JSON.parse(JSON.stringify(db));
      db.settings.syncRefreshToken = (await lire('jeton')) || '';
      return { db, corrompu: '', sauvegardes: [] };
    },
    async saveData(obj) {
      await ecrire('db', sansJeton(JSON.parse(JSON.stringify(obj))));
      proteger();
      copieSiEcart(obj).catch(() => {});
      return true;
    },
    ecrireJeton: (v) => ecrire('jeton', String(v || '')),
    etatCloud: async () => null,

    async listerSauvegardes() {
      return ((await lire('copies')) || []).map((x) => ({
        nom: x.nom, date: new Date(x.t).toLocaleString('fr-FR'),
        avantRestauration: x.nom.includes('avant-')
      }));
    },
    async restaurerSauvegarde(nom) {
      const x = ((await lire('copies')) || []).find((c) => c.nom === nom);
      if (!x) return null;
      await copier(await lire('db'), '-avant-restauration');
      await ecrire('db', x.db);
      return JSON.parse(JSON.stringify(x.db));
    },

    appInfo: async () => ({ version: VERSION, updated: MISE_A_JOUR, dataDir: 'cet appareil' }),
    async appLogo() {
      try {
        const b = await (await fetch('assets/icon.png')).blob();
        return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); });
      } catch (_) { return ''; }
    },

    confirmDialog: (message, detail, okLabel) =>
      fenetre(message, detail, [['Annuler', false, 'btn-ghost'], [okLabel || 'Confirmer', true, 'btn-primary']]),
    messageDialog: (titre, message) => fenetre(titre, message, [['Fermer', true, 'btn-primary']]),
    chooseDir: async () => null,                        // pas de dossier sur un téléphone

    /* PDF : la fiche s'ouvre dans un onglet et la fenêtre d'impression du système
       propose « Enregistrer en PDF ». */
    async exportPdf(_nom, html) {
      const page = html.replace(/<\/body>/i, '<script>addEventListener("load",()=>setTimeout(()=>print(),300))<\/script></body>');
      const url = URL.createObjectURL(new Blob([page], { type: 'text/html' }));
      const w = window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 120000);
      if (!w) throw new Error('l\'appareil a bloqué l\'ouverture de la fiche');
      return true;
    },

    /* WhatsApp : l'image de suivi part par le partage du système (on y choisit
       WhatsApp puis le client). Si l'appareil ne sait pas partager une image, elle
       est enregistrée et la conversation s'ouvre avec le message. */
    async partagerWhatsapp(nomFichier, html, largeur, tel, message) {
      const png = new File([await htmlEnPng(html, largeur || 900)], nomFichier, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [png] })) {
        try { await navigator.share({ files: [png], text: message || '' }); return { partage: true, copieFichier: true }; }
        catch (e) { if (e && e.name === 'AbortError') return { annule: true }; }
      }
      await donnerFichier(png);
      const t = String(tel || '').replace(/\D/g, '');
      if (t) window.open(`https://wa.me/${t}${message ? '?text=' + encodeURIComponent(message) : ''}`, '_blank');
      return { copieFichier: false };
    },

    saveText: (nom, contenu) => donnerFichier(new File([contenu], nom, { type: 'text/plain' })),

    /* propres à la version mobile (carte « Données de cet appareil ») */
    async remplacerDonnees() {
      const db = await ecranImport();
      if (!db) return false;
      await copier(await lire('db'), '-avant-remplacement');
      await ecrire('db', sansJeton(db));
      location.reload();
      return true;
    },
    async exporterDonnees() {
      const db = await lire('db');
      if (!db) throw new Error('rien n\'est encore enregistré sur cet appareil');
      const nom = `IV-Clients-donnees-${horodate()}.json`;
      const donne = await donnerFichier(new File([JSON.stringify(db, null, 1)], nom, { type: 'application/json' }));
      if (donne) await ecrire('dernierExport', Date.now());
      return donne;
    },
    etatAppareil: async () => ({ protege: await proteger(), dernierExport: (await lire('dernierExport')) || 0 })
  };

  /* hors ligne : les fichiers de l'application restent dans l'appareil */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(() => {}));
  }
})();
