/* IV Clients — renderer. 100 % local. Shim navigateur (localStorage) quand window.api est absent. */
'use strict';

const HAS_API = !!(window.api && window.api.loadData);
const LS_KEY = 'ivclients';
/* Version téléphone / tablette (mobile.js remplace le pont Windows) — 06/10/2026 */
const MOBILE = !!(window.api && window.api.mobile);

/* ================= Helpers ================= */

const $ = (sel) => document.querySelector(sel);
/* Accord au pluriel : le reste de l'application accorde correctement, seuls
   quelques messages gardaient des « (s) » (audit du 23/08/2026). */
const plur = (n, singulier, pluriel) => `${n} ${n > 1 ? (pluriel || singulier + 's') : singulier}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const fmt = (n) => {
  n = Math.round(Number(n) || 0);
  const neg = n < 0;
  const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (neg ? '-' : '') + s;
};
const fmtCad = (n) => (Number(n) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
/* Lecture d'un montant saisi ou COLLÉ. L'ancienne version supprimait tout ce qui
   n'était pas un chiffre : « 1 500 000,00 » collé depuis Excel devenait
   150 000 000 F — cent fois trop, sans alerte (audit du 23/08/2026).
   On coupe donc d'abord les décimales, puis on ne garde que les chiffres.
   Les centimes n'existent pas en francs CFA : on arrondit au franc. */
function parseMoney(s) {
  let t = String(s == null ? '' : s).trim();
  const negatif = /^-/.test(t) || /^\(.*\)$/.test(t);   // « -250 000 » ou « (250 000) » des tableurs
  // décimales finales : « ,50 » ou « .50 » (1 ou 2 chiffres) — jamais un séparateur de milliers
  const dec = t.match(/[.,](\d{1,2})\s*$/);
  if (dec) t = t.slice(0, dec.index);
  const entier = parseInt(t.replace(/\D/g, ''), 10) || 0;
  const arrondi = dec && Number(dec[1].padEnd(2, '0')) >= 50 ? entier + 1 : entier;
  return negatif ? -arrondi : arrondi;
}

const todayMid = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };

/* Tous les compteurs de jours se comptent de MINUIT À MINUIT (demande d'Alex,
   06/09/2026). Un compteur ne doit pas changer en milieu de journée selon
   l'heure à laquelle la chose s'est produite : il tombe d'un cran à 00 h 00,
   et pas autrement. */
const minuitDe = (v) => { const d = new Date(v); if (isNaN(d.getTime())) return NaN; d.setHours(0, 0, 0, 0); return d.getTime(); };
const joursDeMinuit = (de, a) => {
  const x = minuitDe(de), y = minuitDe(a);
  return (isNaN(x) || isNaN(y)) ? null : Math.round((y - x) / 86400000);
};
/* Une date illisible ne doit pas produire une DATE INVALIDE, qui a l'air d'une
   date et contamine tous les calculs en « NaN » : une fiche reçue du site avec
   une date abîmée affichait « Soumission J-NaN ». On rend null, que tous les
   appelants savent déjà traiter. */
const parseISO = (iso) => {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
};
/* « cette date est-elle passée ? » — null n'est PAS une date passée. Sans ce
   garde, une date absente se comparerait comme le 1ᵉʳ janvier 1970. */
const dateDepassee = (iso, t) => { const d = parseISO(iso); return !!d && d < t; };
const frDate = (iso) => { const d = parseISO(iso); return d ? d.toLocaleDateString('fr-FR') : ''; };
const isoDe = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const todayISO = () => isoDe(new Date());

function ageOf(iso) {
  const d = parseISO(iso); if (!d) return null;
  const t = new Date();
  let a = t.getFullYear() - d.getFullYear();
  const m = t.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < d.getDate())) a--;
  return a;
}

const bissextile = (a) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;

/* Un 29 février tombait le 1er mars les années ordinaires : JavaScript déborde
   silencieusement. L'usage retient le 28 février (audit du 23/08/2026). */
function anniversaireDans(annee, d) {
  const jour = (d.getMonth() === 1 && d.getDate() === 29 && !bissextile(annee)) ? 28 : d.getDate();
  return new Date(annee, d.getMonth(), jour);
}

function daysToBirthday(iso) {
  const d = parseISO(iso); if (!d) return null;
  const t = todayMid();
  let next = anniversaireDans(t.getFullYear(), d);
  if (next < t) next = anniversaireDans(t.getFullYear() + 1, d);
  return Math.round((next - t) / 86400000);
}

function daysSince(iso) {
  const d = parseISO(iso); if (!d) return null;
  return Math.floor((todayMid() - d) / 86400000);
}

function toTitleCase(s) {
  return String(s || '').toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase()).trim();
}

/* ================= Icônes au trait (remplacent les emojis) ================= */

const ICONES = {
  identite: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  dossier: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
  etudes: '<path d="M22 10 12 5 2 10l10 5z"/><path d="M6 12v5c3 2.5 9 2.5 12 0v-5"/>',
  notes: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  champs: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  calendrier: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  versement: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  depense: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 2V2l-1 2-3-2-3 2-3-2-3 2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="14" x2="13" y2="14"/>',
  change: '<polyline points="17 2 21 6 17 10"/><path d="M3 6h18"/><polyline points="7 22 3 18 7 14"/><path d="M21 18H3"/>',
  feuille: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/>',
  imprimante: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  calculatrice: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="11" x2="8" y2="11"/><line x1="12" y1="11" x2="12" y2="11"/><line x1="16" y1="11" x2="16" y2="11"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="12" y1="16" x2="12" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/>',
  boussole: '<circle cx="12" cy="12" r="10"/><polygon points="16.2 7.8 14.1 14.1 7.8 16.2 9.9 9.9"/>',
  banque: '<line x1="3" y1="21" x2="21" y2="21"/><path d="M4 21V10h16v11"/><path d="M12 3 2 8h20z"/><line x1="9" y1="14" x2="9" y2="18"/><line x1="15" y1="14" x2="15" y2="18"/>',
  sauvegarde: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  cadenas: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  partager: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>',
  archive: '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><line x1="10" y1="13" x2="14" y2="13"/>',
  corbeille: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  fleche: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  gateau: '<path d="M4 20h16"/><path d="M5 20v-6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6"/><line x1="8" y1="8" x2="8" y2="4"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="16" y1="8" x2="16" y2="4"/>',
  soleil: '<circle cx="12" cy="12" r="4.5"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4" y1="12" x2="2" y2="12"/><line x1="22" y1="12" x2="20" y2="12"/><line x1="5.6" y1="5.6" x2="4.2" y2="4.2"/><line x1="19.8" y1="19.8" x2="18.4" y2="18.4"/><line x1="18.4" y1="5.6" x2="19.8" y2="4.2"/><line x1="4.2" y1="19.8" x2="5.6" y2="18.4"/>',
  lune: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  vide: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  maj: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  fermer: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
};

const ico = (nom, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONES[nom] || ''}</svg>`;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

function confirm2(message, detail, okLabel) {
  if (HAS_API) return window.api.confirmDialog(message, detail, okLabel);
  return Promise.resolve(window.confirm(message + (detail ? '\n' + detail : '')));
}

function askText(title, type = 'text') {
  return new Promise((resolve) => {
    const ov = $('#modal'), inp = $('#modal-input');
    $('#modal-title').textContent = title;
    inp.type = type; inp.value = '';
    ov.hidden = false; inp.focus();
    const done = (val) => {
      ov.hidden = true;
      $('#modal-ok').onclick = $('#modal-cancel').onclick = inp.onkeydown = null;
      resolve(val);
    };
    $('#modal-ok').onclick = () => done(inp.value);
    $('#modal-cancel').onclick = () => done(null);
    inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value); if (e.key === 'Escape') done(null); };
  });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/* Empreinte du mot de passe administrateur.
   Un simple SHA-256 du mot de passe se retrouve tel quel dans les tables toutes
   faites qui circulent : « douala2026 » y figure, et l'empreinte est visible
   dans le fichier de données. On y ajoute donc un grain de sel propre à ce poste
   et 210 000 tours (PBKDF2) : essayer les mots de passe un à un devient lent, et
   aucune table toute faite ne sert plus à rien. */
async function empreinteMdp(mdp, selHex) {
  const sel = new Uint8Array(selHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const cle = await crypto.subtle.importKey('raw', new TextEncoder().encode(mdp), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: sel, iterations: 210000, hash: 'SHA-256' }, cle, 256);
  return hex(bits);
}

async function poserMdp(mdp) {
  const sel = hex(crypto.getRandomValues(new Uint8Array(16)));
  db.settings.lockSalt = sel;
  db.settings.lockHash = await empreinteMdp(mdp, sel);
}

/* Vérification. Le sel absent = empreinte posée par une version antérieure
   (simple SHA-256) : on l'accepte, puis on la remplace par la nouvelle forme. */
async function mdpCorrect(saisie) {
  const s = db.settings;
  if (!s.lockHash) return true;
  if (s.lockSalt) return await empreinteMdp(saisie, s.lockSalt) === s.lockHash;
  if (await sha256(saisie) !== s.lockHash) return false;
  await poserMdp(saisie); save();
  return true;
}

/* ---- Code de secours ----
   Un mot de passe sans double des clés est un piège : l'oublier fermerait le
   mode administrateur pour toujours, sur un fichier qu'on ne peut pas forcer.
   Un code est donc tiré au sort en même temps que le mot de passe, montré UNE
   fois, et rangé sous la même forme que lui — le logiciel ne le connaît plus.
   L'alphabet écarte les caractères qui se confondent à la lecture (O et 0,
   I, 1 et L) : ce code sera recopié à la main sur un papier. */
const ALPHABET_SECOURS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // 31 signes, aucun ambigu

function genererCodeSecours() {
  const lettres = [];
  const plafond = Math.floor(256 / ALPHABET_SECOURS.length) * ALPHABET_SECOURS.length;
  while (lettres.length < 20) {
    for (const v of crypto.getRandomValues(new Uint8Array(32))) {
      // au-delà du plafond, l'octet est jeté : sans cela certaines lettres
      // sortiraient un peu plus souvent que les autres
      if (v < plafond && lettres.length < 20) lettres.push(ALPHABET_SECOURS[v % ALPHABET_SECOURS.length]);
    }
  }
  return lettres.join('').match(/.{5}/g).join('-');
}

let codeSecoursAffiche = '';   // en clair À L'ÉCRAN seulement, jamais enregistré

async function poserCodeSecours() {
  const code = genererCodeSecours();
  const sel = hex(crypto.getRandomValues(new Uint8Array(16)));
  db.settings.lockSecoursSalt = sel;
  db.settings.lockSecoursHash = await empreinteMdp(code.replace(/-/g, ''), sel);
  codeSecoursAffiche = code;
  return code;
}

/* Saisie tolérante : tirets, espaces et minuscules sont sans importance —
   c'est un code recopié d'un papier, pas un mot de passe. */
async function codeSecoursCorrect(saisie) {
  const s = db.settings;
  if (!s.lockSecoursHash || !s.lockSecoursSalt) return false;
  const propre = String(saisie || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (propre.length < 20) return false;
  return await empreinteMdp(propre, s.lockSecoursSalt) === s.lockSecoursHash;
}

/* ================= Données ================= */

let db = null;
let APP_INFO = { version: '1.31.2', updated: '', dataDir: '' };

function defaultDb() {
  return {
    settings: {
      rates: { CAD: 465, EUR: 655.96, USD: 600 },       // 1 unité = X FCFA
      fraisPaiementPct: 0,                               // % prélevé au paiement IRCC
      fraisChargeFixe: 0,                                // frais fixes (FCFA) au chargement de la carte
      // forfait: true = montant global, aucune quantité à saisir (cas de la biométrie)
      // `site` : l'identifiant du même frais dans les réglages publiés par le site.
      // C'est lui qui fait le lien, PAS l'intitulé — pour qu'un renommage ici ne
      // casse pas le relevé automatique.
      feeCatalog: [
        { site: 'drp', label: 'Frais RP (RPRF)', amount: 600, forfait: false },
        { site: 'traitement', label: 'Frais de traitement', amount: 990, forfait: false },
        { site: 'biometrie', label: 'Biométrie (1 personne)', amount: 85, forfait: true },
        { site: 'biometrieMax', label: 'Biométrie (couple / famille)', amount: 170, forfait: true },
        { site: 'enfant', label: 'Frais enfant à charge', amount: 270, forfait: false }
      ],
      // Les trois barèmes (frais IRCC, preuve de fonds, visite médicale) sont
      // publiés dans /gestion → Outils du site. Tant que « auto » est vrai, ils
      // sont relevés là-bas et les champs restent en lecture seule : un même
      // chiffre à deux endroits finit toujours par ne plus dire la même chose.
      baremeSite: { auto: true, luLe: '', echec: '' },
      // étapes du dossier suivies en champs personnalisés (date + délai depuis l'AOR)
      // ordre voulu par l'utilisateur, identique dans chaque fiche
      customTemplate: [
        { label: 'DI', type: 'date', frise: true },
        { label: 'ITA', type: 'date', frise: true },
        { label: 'AOR', type: 'date', frise: true },
        { label: 'VMF', type: 'date', frise: true },
        { label: 'IBIO', type: 'date', frise: true },
        { label: 'BIO', type: 'date', frise: true }
      ],
      // Taux du jour relevé via l'euro (voir tauxDuJour plus bas). Vide tant
      // qu'aucun relevé n'a abouti : on retombe alors sur le taux de la banque.
      tauxJour: { taux: {}, dateBCE: '', releveLe: '' },
      // Preuve de fonds — barème d'IRCC, en $ CAD, indexé chaque année sur 50 %
      // du seuil de faible revenu. Ce n'est PAS une dépense : c'est la somme que
      // le client doit MONTRER. Au-delà du dernier palier, on ajoute un montant
      // par personne supplémentaire.
      preuveFonds: {
        maj: '2025-07-07',
        paliers: [
          { personnes: 1, cad: 15263 },
          { personnes: 2, cad: 19001 },
          { personnes: 3, cad: 23360 },
          { personnes: 4, cad: 28362 },
          { personnes: 5, cad: 32168 },
          { personnes: 6, cad: 36280 },
          { personnes: 7, cad: 40392 }
        ],
        parPersonneEnPlus: 4112
      },
      // Visite médicale (OIM Cameroun) : tarif NATIF en francs, payé au guichet,
      // qui dépend de l'âge et que l'OIM révise chaque mois — d'où le mois affiché.
      // Montants d'origine relevés sur le site (barème OIM d'août 2026).
      visiteMedicale: {
        mois: '2026-08',
        tranches: [
          { id: 'enfant', label: 'De 0 à 10 ans', min: 0, max: 10, fcfa: 62715 },
          { id: 'jeune', label: 'De 11 à 14 ans', min: 11, max: 14, fcfa: 88375 },
          { id: 'adulte', label: '15 ans et plus', min: 15, max: null, fcfa: 112890 }
        ]
      },
      cloudBackupDir: '',
      theme: 'clair',
      fichesSupprimees: [],   // fiches supprimées ici, tant que le site ne l'a pas confirmé
      triClients: 'nom',      // ordre d'affichage de la liste des clients
      groupeEtape: false,     // regrouper la liste par étape du dossier
      lockHash: '',        // mot de passe du mode administrateur (empreinte)
      lockSalt: '',        // grain de sel propre à ce poste (voir empreinteMdp)
      lockSecoursHash: '', // code de secours, si le mot de passe est oublié
      lockSecoursSalt: '',
      aFaireFait: {},      // points du jour cochés : clé -> date du jour
      doublonsIgnores: [], // paires de fiches que vous avez déclarées distinctes
      syncEmail: '',
      syncRefreshToken: '',
      syncAuto: false,
      syncLastAt: '',
      syncAlerte: ''
    },
    clients: [],
    corbeille: []          // fiches supprimées, gardées 30 jours avant l'effacement définitif
  };
}

function migrate(d) {
  const def = defaultDb();
  d.settings = Object.assign({}, def.settings, d.settings || {});
  d.settings.rates = Object.assign({}, def.settings.rates, d.settings.rates || {});
  if (!Array.isArray(d.settings.feeCatalog)) d.settings.feeCatalog = def.settings.feeCatalog;
  // les biométries deviennent des forfaits (sans quantité) sur les données déjà en place,
  // sans écraser un choix fait par l'utilisateur dans les Paramètres
  d.settings.feeCatalog.forEach((f) => {
    if (f.forfait === undefined) f.forfait = /biom[eé]tr/i.test(f.label || '');
    // rattachement au réglage du site, une fois, d'après l'intitulé d'origine
    if (f.site === undefined) {
      const memeLabel = def.settings.feeCatalog.find((x) => x.label === f.label);
      f.site = memeLabel ? memeLabel.site : '';
    }
  });
  if (!d.settings.baremeSite || typeof d.settings.baremeSite !== 'object') d.settings.baremeSite = { auto: true, luLe: '', echec: '' };
  if (!Array.isArray(d.settings.customTemplate)) d.settings.customTemplate = [];
  // barème de la visite médicale : repris tel quel s'il existe, sinon celui d'origine
  const vm = d.settings.visiteMedicale;
  if (!vm || !Array.isArray(vm.tranches) || !vm.tranches.length) d.settings.visiteMedicale = def.settings.visiteMedicale;
  else vm.tranches.forEach((t) => { if (!t.id) t.id = uid(); });
  // idem pour la preuve de fonds
  const pf = d.settings.preuveFonds;
  if (!pf || !Array.isArray(pf.paliers) || !pf.paliers.length) d.settings.preuveFonds = def.settings.preuveFonds;
  if (!Array.isArray(d.clients)) d.clients = [];
  // une entrée nulle ou mal typée (fiche reçue abîmée) plantait migrate() et
  // laissait une fenêtre blanche sans message (audit du 23/08/2026)
  d.clients = d.clients.filter((c) => c && typeof c === 'object');
  /* Corbeille : les fiches supprimées y attendent JOURS_CORBEILLE jours. La purge
     se fait ici, au chargement, et JAMAIS sur une entrée sans date — une donnée
     abîmée ne doit pas se traduire par un effacement. */
  if (!Array.isArray(d.corbeille)) d.corbeille = [];
  /* La purge compte elle aussi de minuit à minuit, exactement comme le décompte
     affiché : sans quoi une fiche annoncée « dans 1 j » disparaissait six heures
     plus tard, à l'heure où elle avait été supprimée. */
  const maintenant = Date.now();
  d.corbeille = d.corbeille.filter((x) => {
    if (!x || !x.fiche || typeof x.fiche !== 'object') return false;
    const ecoules = joursDeMinuit(Date.parse(x.supprimeeLe), maintenant);
    return ecoules === null ? true : ecoules <= JOURS_CORBEILLE;
  });
  // pense-bête du jour : on ne garde que les cases cochées AUJOURD'HUI,
  // sinon la liste du matin resterait vide
  if (!d.settings.aFaireFait || typeof d.settings.aFaireFait !== 'object') d.settings.aFaireFait = {};
  if (!Array.isArray(d.settings.doublonsIgnores)) d.settings.doublonsIgnores = [];
  const auj = todayISO();
  for (const k of Object.keys(d.settings.aFaireFait)) {
    if (d.settings.aFaireFait[k] !== auj) delete d.settings.aFaireFait[k];
  }
  if (!Array.isArray(d.settings.feeCatalog)) d.settings.feeCatalog = def.settings.feeCatalog;
  d.settings.feeCatalog = d.settings.feeCatalog.filter((f) => f && typeof f === 'object');
  d.settings.customTemplate = d.settings.customTemplate.filter((t) => t && typeof t === 'object');
  // les six étapes du dossier figurent dans la frise ; les autres dates, non — sauf choix contraire
  const ETAPES_DOSSIER = ['DI', 'ITA', 'AOR', 'VMF', 'IBIO', 'BIO'];
  const estEtape = (label) => ETAPES_DOSSIER.some((n) => normEtape(n) === normEtape(label));
  d.settings.customTemplate.forEach((t) => { if (t.frise === undefined) t.frise = t.type === 'date' && estEtape(t.label); });

  d.clients.forEach((c) => {
    if (!c.custom) c.custom = [];
    c.custom.forEach((f) => { if (f.frise === undefined) f.frise = f.type === 'date' && estEtape(f.label); });
    if (!c.finance) c.finance = {};
    for (const k of ['echeancier', 'versements', 'depenses']) if (!Array.isArray(c.finance[k])) c.finance[k] = [];

    // ITA et DI ne sont plus des champs fixes : ils deviennent des champs personnalisés
    // (avec IBIO et BIO). Les dates déjà saisies sont RECOPIÉES, rien n'est perdu.
    if (!c.etapesEnChamps) {
      const ETAPES = [['DI', c.dateDI], ['ITA', c.dateITA], ['AOR', c.dateAOR], ['VMF', ''], ['IBIO', ''], ['BIO', '']];
      ETAPES.forEach(([nom, valeur]) => {
        const f = c.custom.find((x) => normEtape(x.label) === normEtape(nom));
        if (!f) { c.custom.push({ id: uid(), label: nom, type: 'date', value: valeur || '' }); return; }
        if (!valeur) return;
        if (!f.value) { f.value = valeur; f.type = 'date'; return; }
        /* Le champ homonyme existe déjà et il est REMPLI d'autre chose. La date
           d'origine était alors jetée (audit du 23/08/2026) : on créait un champ
           « ITA » texte contenant « reçue », puis on effaçait c.dateITA — la date
           disparaissait de la frise, du PDF et des délais, sans un mot.
           On crée donc un second champ daté, et rien ne se perd. */
        if (f.type === 'date' && f.value === valeur) return;
        c.custom.push({ id: uid(), label: nom + ' (date)', type: 'date', value: valeur, frise: true });
      });
      // les étapes passent en tête, dans l'ordre DI · ITA · AOR · VMF · IBIO · BIO ;
      // les champs que l'utilisateur a créés lui-même restent à la suite
      ETAPES.forEach(([nom]) => {
        const f = c.custom.find((x) => normEtape(x.label) === normEtape(nom));
        if (f && f.frise === undefined) f.frise = true;   // les 6 étapes sont dans la frise par défaut
      });
      const rang = (f) => { const i = ETAPES.findIndex(([n]) => normEtape(n) === normEtape(f.label)); return i < 0 ? ETAPES.length : i; };
      c.custom = c.custom
        .map((f, i) => ({ f, i }))
        .sort((a, b) => (rang(a.f) - rang(b.f)) || (a.i - b.i))
        .map((x) => x.f);
      delete c.dateITA; delete c.dateDI; delete c.dateAOR;   // recopiées, plus de doublon
      c.etapesEnChamps = true;
    }
  });
  return d;
}

const normEtape = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/* Date d'une étape (ITA, DI, AOR…) : lue dans les champs personnalisés,
   avec repli sur l'ancien champ fixe pour les fiches pas encore migrées. */
function dateEtape(c, nom) {
  if (!c) return '';
  const f = (c.custom || []).find((x) => normEtape(x.label) === normEtape(nom) && x.type === 'date');
  if (f && f.value) return f.value;
  return c['date' + nom.toUpperCase()] || '';
}
const dateAorDe = (c) => dateEtape(c, 'AOR');

/* ---------- Délai de soumission : 60 jours à partir du lendemain de l'ITA ----------
   C'est le seul délai que le logiciel surveille, et le plus lourd de
   conséquences : passé ce terme, l'invitation est perdue et le client repart
   dans le bassin. Le décompte part de la date d'ITA de la fiche.

   Règle des Instructions ministérielles d'Entrée express (section 6) : la
   période commence le LENDEMAIN de l'ITA et se termine le 60e jour après ce
   lendemain. ITA le 1er octobre → dernier jour le 1er décembre. Lecture
   littérale retenue par Alex le 05/10/2026 ; le texte peut aussi se lire
   « 30 novembre » et aucune page d'IRCC ne tranche. La date affichée dans le
   compte IRCC du client reste celle qui fait foi.

   Il s'ARRÊTE dès qu'une date d'AOR est saisie : l'accusé de réception ne peut
   exister que si le dossier a été déposé. Une fiche archivée ne compte plus non
   plus — archiver, c'est avoir tourné la page.

   Si IRCC changeait ce délai, c'est ce seul chiffre à corriger. */
const JOURS_SOUMISSION = 60;
const JOURS_CORBEILLE = 30;      // durée de séjour d'une fiche à la corbeille

function delaiSoumission(c) {
  if (!c || c.archive) return null;
  const ita = dateEtape(c, 'ITA');
  if (!ita || dateAorDe(c)) return null;
  const d = parseISO(ita); if (!d) return null;
  const t = todayMid();
  if (d > t) return { ita, futur: true };            // date saisie dans le futur : à vérifier
  // + 1 : la période commence le lendemain de l'ITA, puis 60 jours
  const limite = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1 + JOURS_SOUMISSION);
  return { ita, futur: false, limite: isoDe(limite), reste: Math.round((limite - t) / 86400000) };
}

let saveTimer = null;
function ecrireMaintenant() {
  clearTimeout(saveTimer); saveTimer = null;
  if (lectureSeule) return;   // fichier illisible au démarrage : on n'écrase rien
  if (HAS_API) window.api.saveData(db);
  else localStorage.setItem(LS_KEY, JSON.stringify(db));
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    ecrireMaintenant();
    scheduleAutoPush();
  }, 350);
}

/* L'enregistrement est différé de 350 ms pour ne pas écrire à chaque frappe.
   Fermer la fenêtre pendant ce délai perdait la saisie : rien ne vidait le
   tampon (audit du 23/08/2026). On l'écrit donc avant que la page ne parte. */
window.addEventListener('beforeunload', () => {
  // un champ encore actif n'a pas forcément émis son « change » : on le récupère
  const el = document.activeElement;
  if (el && estChampSaisie(el)) { try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {} }
  if (saveTimer) ecrireMaintenant();
});

/* horodate la fiche pour la synchronisation (résolution des conflits entre postes) */
const touch = (c) => { if (c) c.updatedAt = new Date().toISOString(); };

/* Vrai si le fichier de données était illisible : l'application se met alors en
   LECTURE SEULE au lieu de démarrer vide et d'écraser tout au premier geste. */
let fichierCorrompu = null;
let lectureSeule = false;

async function loadDb() {
  let d = null;
  if (HAS_API) {
    const r = await window.api.loadData();
    // ancienne forme (l'objet seul) ou nouvelle forme { db, corrompu, sauvegardes }
    if (r && Object.prototype.hasOwnProperty.call(r, 'db')) {
      d = r.db;
      if (r.corrompu) fichierCorrompu = { chemin: r.corrompu, sauvegardes: r.sauvegardes || [] };
      // tout premier lancement : on part des réglages livrés avec l'installateur
      if (!d && r.usine) { d = defaultDb(); Object.assign(d.settings, r.usine); }
    } else d = r;
  } else {
    try { d = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (_) { d = null; }
  }
  db = migrate(d || defaultDb());
}

function newClientObj() {
  return {
    id: uid(), createdAt: todayISO(),
    nom: '', prenom: '', dateNaissance: '', paysNaissance: '', villeNaissance: '', telephone: '', numPasseport: '', statutMatrimonial: '', niu: '',
    cnp: '', residenceIrcc: '', iuc: '', numDemande: '', mailIrcc: '', accesPersonnels: '', scoreCrs: '',
    etapesEnChamps: true,   // ITA/DI/IBIO/BIO vivent dans les champs personnalisés
    diplomesIrcc: '', domainesEtudes: '', employeurIrcc: '', posteIrcc: '', debutEmploi: '', tachesIrcc: '',
    notes: '',
    custom: (db.settings.customTemplate || []).map((t) => ({ id: uid(), label: t.label, type: t.type, value: '', frise: !!t.frise })),
    finance: { echeancier: [], versements: [], depenses: [] }
  };
}

// Affichage : PRÉNOM puis NOM (demande utilisateur du 30/07/2026)
const fullName = (c) => `${c.prenom || ''} ${c.nom || ''}`.trim() || '(Sans nom)';
const getClient = (id) => db.clients.find((c) => c.id === id);

/* Finances */
const sumM = (arr, k = 'montant') => arr.reduce((s, x) => s + (Number(x[k]) || 0), 0);

/* Règlement de l'échéancier PAR LES VERSEMENTS réellement encaissés : les versements
   couvrent les tranches dans l'ordre, une tranche peut donc être réglée PARTIELLEMENT
   (cas signalé par l'utilisateur : 3 550 000 versés sur une tranche de 3 700 000).
   Une tranche cochée « réglé » à la main reste comptée comme payée. */
function reglementEcheancier(c) {
  const verse = sumM(c.finance.versements);
  const manuel = sumM(c.finance.echeancier.filter((e) => e.paye));
  let dispo = Math.max(0, verse - manuel); // les versements déjà attribués aux tranches cochées ne comptent qu'une fois
  const lignes = c.finance.echeancier.map((e) => {
    const montant = Number(e.montant) || 0;
    let regle;
    if (e.paye) regle = montant;
    else { regle = Math.min(montant, dispo); dispo -= regle; }
    const statut = montant > 0 && regle >= montant ? 'paye' : regle > 0 ? 'partiel' : 'attente';
    return { e, montant, regle, solde: Math.max(0, montant - regle), statut };
  });
  return { lignes, verse, surplus: Math.max(0, dispo) };
}
function finTotals(c) {
  const verse = sumM(c.finance.versements);
  const depenses = sumM(c.finance.depenses);
  const echTotal = sumM(c.finance.echeancier);
  // ce qui est réglé sur l'échéancier vient des versements (partiels compris), jamais d'une simple case cochée
  const reg = reglementEcheancier(c);
  const echPaye = Math.min(echTotal, reg.lignes.reduce((s, l) => s + l.regle, 0));
  return { verse, depenses, benefice: verse - depenses, echTotal, echPaye, echRestant: Math.max(0, echTotal - echPaye), surplus: reg.surplus };
}

/* ================= Export PDF d'une fiche ================= */

let LOGO_DATA = ''; // logo en dataURL, fourni par le processus principal

function pdfRow(label, val) {
  if (val === null || val === undefined || val === '') return '';
  return `<div class="row"><span class="lbl">${esc(label)}</span><span class="val">${esc(val)}</span></div>`;
}
function pdfBloc(label, texte) {
  if (!texte) return '';
  return `<div class="row bloc"><span class="lbl">${esc(label)}</span><span class="val">${esc(texte).replace(/\n/g, '<br>')}</span></div>`;
}

/* PDF volontairement limité aux onglets Informations + Champs personnalisés
   (PAS de finances — demande utilisateur : le PDF peut être partagé avec le client) */
function buildFichePdf(c) {
  const age = ageOf(c.dateNaissance);
  const j = daysToBirthday(c.dateNaissance);
  const dAOR = daysSince(dateAorDe(c));
  const genLe = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const chips = [
    age !== null ? age + ' ans' : '',
    j !== null ? 'anniversaire dans ' + j + ' j' : '',
    dAOR !== null ? 'AOR il y a ' + dAOR + ' j' : '',
    c.scoreCrs ? 'CRS ' + c.scoreCrs : ''
  ].filter(Boolean).map((x) => `<span class="chip">${esc(x)}</span>`).join('');

  const CF_VAL = (cf) => cf.type === 'check' ? (cf.value ? 'Oui' : 'Non') : String(cf.value ?? '');

  const sec = (titre, contenu) => contenu ? `<h2>${titre}</h2><div class="rows">${contenu}</div>` : '';

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Fiche ${esc(fullName(c))}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, sans-serif; font-size: 12px; color: #1B2733; padding: 4px 10px 40px; }
  .header { display: flex; align-items: center; gap: 12px; border-bottom: 3px solid #1E3F76; padding-bottom: 10px; }
  .header img { width: 46px; height: 46px; }
  .header .sur { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: #1E3F76; font-weight: 700; }
  .header h1 { font-size: 21px; color: #1E3F76; }
  .chips { margin: 8px 0 2px; }
  .chip { display: inline-block; background: #E8EEF8; color: #1E3F76; border-radius: 999px; padding: 2px 10px; font-size: 10.5px; font-weight: 600; margin-right: 6px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 1.2px; color: #1E3F76; border-bottom: 1px solid #DDE5EE; margin: 14px 0 6px; padding-bottom: 3px; }
  .rows { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 24px; }
  .row { display: flex; gap: 8px; break-inside: avoid; }
  .row .lbl { color: #5B6B7B; min-width: 118px; flex: 0 0 118px; font-size: 10.5px; padding-top: 1px; }
  .row .val { font-weight: 600; }
  .row.bloc { grid-column: 1 / -1; }
  .tbl-titre { font-weight: 700; font-size: 11px; margin: 10px 0 3px; color: #1B2733; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; break-inside: avoid; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .8px; color: #5B6B7B; border-bottom: 1.5px solid #DDE5EE; padding: 3px 6px; }
  td { padding: 4px 6px; border-bottom: 1px solid #EDF2F8; }
  th.num, td.num { text-align: right; white-space: nowrap; }
  td .late, .late { color: #B3261E; }
  .fin-tots { display: flex; gap: 22px; margin: 6px 0 2px; font-size: 12px; }
  .fin-tots b { font-size: 13px; }
  .fin-tots .ok b { color: #0F6E56; }
  .fin-tots .ko b { color: #B3261E; }
  .tfoot td { font-weight: 700; color: #1E3F76; border-top: 1.5px solid #DDE5EE; }
  .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-28deg); text-align: center; opacity: .06; z-index: -1; }
  .watermark img { width: 130px; }
  .watermark div { font-size: 26px; font-weight: 800; color: #1E3F76; letter-spacing: 3px; white-space: nowrap; }
  .footer { position: fixed; bottom: 4px; left: 0; right: 0; text-align: center; font-size: 8.5px; color: #8A99A8; }
</style></head><body>
  <div class="watermark">${LOGO_DATA ? `<img src="${LOGO_DATA}" alt="">` : ''}<div>IMMIGRATION VOYAGES — CONFIDENTIEL</div></div>
  <div class="header">
    ${LOGO_DATA ? `<img src="${LOGO_DATA}" alt="">` : ''}
    <div>
      <div class="sur">IV Clients — Fiche client</div>
      <h1>${esc(fullName(c))}</h1>
    </div>
  </div>
  <div class="chips">${chips}</div>

  ${sec('Identité &amp; naissance',
    pdfRow('Date de naissance', c.dateNaissance ? frDate(c.dateNaissance) + (age !== null ? ` (${age} ans)` : '') : '') +
    pdfRow('Pays de naissance', c.paysNaissance) +
    pdfRow('Ville de naissance', c.villeNaissance) +
    pdfRow('Téléphone', c.telephone) +
    pdfRow('N° de passeport', c.numPasseport) +
    pdfRow('Statut matrimonial', c.statutMatrimonial) +
    pdfRow('NIU', c.niu))}

  ${sec('Dossier IRCC',
    pdfRow("Date de l'AOR", dateAorDe(c) ? frDate(dateAorDe(c)) + (dAOR !== null ? ` (il y a ${dAOR} j)` : '') : '') +
    pdfRow('IUC', c.iuc) +
    pdfRow('N° de demande', c.numDemande) +
    pdfRow('CNP', c.cnp) +
    pdfRow('Score CRS', c.scoreCrs) +
    pdfRow('Résidence IRCC', c.residenceIrcc) +
    pdfRow('Mail IRCC', c.mailIrcc))}

  ${sec('Études &amp; emploi (IRCC)',
    pdfBloc('Diplômes IRCC', c.diplomesIrcc) +
    pdfRow("Domaines d'études", c.domainesEtudes) +
    pdfRow('Employeur IRCC', c.employeurIrcc) +
    pdfRow('Poste occupé', c.posteIrcc) +
    pdfRow("Début d'emploi", c.debutEmploi ? frDate(c.debutEmploi) + (dureeDepuis(c.debutEmploi) ? ` (depuis ${dureeDepuis(c.debutEmploi)})` : '') : '') +
    pdfBloc('Tâches IRCC', c.tachesIrcc))}

  ${sec('Champs personnalisés', (c.custom || []).map((cf) => cf.type === 'long' ? pdfBloc(cf.label, CF_VAL(cf)) : pdfRow(cf.label, cf.type === 'date' ? frDate(cf.value) : CF_VAL(cf))).join(''))}

  ${sec('Notes', pdfBloc('Notes internes', c.notes))}

  <div class="footer">Fiche générée le ${genLe} — IV Clients · Immigration Voyages · Document confidentiel</div>
</body></html>`;
}

/* ================= Synchronisation avec le site (/gestion — Supabase) ================= */

/* Clés PUBLIQUES du projet Supabase du site immigration-voyages.com
   (les mêmes que gestion.js ; la sécurité repose sur la connexion + les règles RLS) */
const SB_URL = 'https://uhfjegbrodjlcmgjicfo.supabase.co';
const SB_KEY = 'sb_publishable_HtJiHb8I9Bl8YlUmQnIzEw_2haEckGz';

let sbToken = null, sbTokenExp = 0, autoPushTimer = null;

const syncOn = () => !!(db && db.settings.syncRefreshToken);

/* Efface le jeton du coffre chiffré (déconnexion, ou session refusée par le site) */
const oublierJeton = () => { try { if (HAS_API) window.api.ecrireJeton(''); } catch (_) {} };

async function sbAuth(body, grant) {
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SB_KEY },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error_description || j.msg || j.error || ('HTTP ' + r.status));
    e.authRefusee = r.status === 400 || r.status === 401 || r.status === 403;
    throw e;
  }
  await poserSession(j);
  return j;
}

/* Range une session délivrée par le site — qu'elle vienne du mot de passe, du
   renouvellement, ou du code de vérification. */
async function poserSession(j) {
  if (!j || !j.access_token) return;
  sbToken = j.access_token;
  sbTokenExp = Date.now() + ((j.expires_in || 3600) - 120) * 1000;
  if (j.refresh_token) {
    // Le site remplace le jeton à chaque renouvellement et invalide l'ancien.
    // Il DOIT être écrit sur le disque immédiatement : avec l'enregistrement
    // différé (350 ms), fermer l'application juste après le perdait et la
    // session tombait — cause des déconnexions répétées du 30/07/2026.
    db.settings.syncRefreshToken = j.refresh_token;
    try {
      // Le jeton part dans le coffre chiffré, JAMAIS dans data.json : ce
      // fichier-là est recopié dans les sauvegardes et le dossier cloud.
      if (HAS_API) await window.api.ecrireJeton(j.refresh_token);
      else localStorage.setItem(LS_KEY, JSON.stringify(db));
    } catch (_) { /* l'écriture réessaiera au prochain enregistrement */ }
  }
}

/* ---- Code de vérification du site (constaté le 06/09/2026) ----
   Le compte d'Alex a un code de vérification (application d'authentification).
   Le site n'ouvre ses fiches QU'À une session qui a donné ce code : sans lui,
   une lecture répond « 0 fiche » SANS erreur — c'est ce qui bloquait l'envoi
   depuis le 29/08. L'application ne savait envoyer que l'email et le mot de
   passe ; elle sait maintenant demander le code et le présenter au site.

   Le niveau de la session se lit dans le jeton lui-même : « aal2 » = code donné. */
function niveauSession() {
  if (!sbToken) return '';
  try {
    const charge = sbToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(charge)).aal || 'aal1';
  } catch (_) { return ''; }
}

/* Le facteur à vérifier, s'il y en a un et que la session n'est pas encore au
   niveau voulu. Rend null quand il n'y a rien à faire. */
async function facteurAVerifier() {
  if (!sbToken || niveauSession() === 'aal2') return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + sbToken }
  });
  if (!r.ok) return null;
  const u = await r.json().catch(() => ({}));
  const f = (u.factors || []).find((x) => x.status === 'verified');
  return f ? { id: f.id, nom: f.friendly_name || 'votre application d\'authentification' } : null;
}

/* Présente le code au site. En cas de succès, le site délivre une nouvelle
   session — au niveau « aal2 » cette fois — que l'on range comme les autres. */
async function presenterCodeMfa(factorId, code) {
  const propre = String(code || '').replace(/\D/g, '');
  if (propre.length < 6) throw new Error('Le code compte 6 chiffres.');
  const entete = { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: 'Bearer ' + sbToken };

  const rc = await fetch(`${SB_URL}/auth/v1/factors/${encodeURIComponent(factorId)}/challenge`, { method: 'POST', headers: entete });
  const jc = await rc.json().catch(() => ({}));
  if (!rc.ok) throw new Error(jc.msg || jc.error_description || 'le site n\'a pas accepté la demande de code');

  const rv = await fetch(`${SB_URL}/auth/v1/factors/${encodeURIComponent(factorId)}/verify`, {
    method: 'POST', headers: entete,
    body: JSON.stringify({ challenge_id: jc.id, code: propre })
  });
  const jv = await rv.json().catch(() => ({}));
  if (!rv.ok) {
    const e = new Error(jv.msg || jv.error_description || 'code refusé');
    e.codeRefuse = true;
    throw e;
  }
  await poserSession(jv);
  return true;
}

async function sbSession() {
  if (sbToken && Date.now() < sbTokenExp) return;
  if (!db.settings.syncRefreshToken) throw new Error('connectez-vous dans Paramètres → Site Immigration Voyages');
  try {
    await sbAuth({ refresh_token: db.settings.syncRefreshToken }, 'refresh_token');
    save();
  } catch (e) {
    // Jeton jeté UNIQUEMENT sur refus explicite du serveur — jamais sur une
    // coupure internet (réseau instable : on réessaie au prochain cycle).
    if (e && e.authRefusee) {
      db.settings.syncRefreshToken = ''; sbToken = null; oublierJeton(); save();
      throw new Error('session expirée — reconnectez-vous dans les Paramètres');
    }
    throw new Error('connexion internet indisponible — nouvel essai à la prochaine synchronisation');
  }
}

/* « Failed to fetch » ne veut rien dire pour l'utilisateur : le relevé des
   barèmes traduisait déjà ce cas, pas la synchronisation (audit du 23/08/2026). */
function messageReseau(e) {
  const m = (e && e.message) || '';
  if (/failed to fetch|networkerror|load failed/i.test(m)) return 'site injoignable — vérifiez la connexion internet';
  if (/^HTTP 401$/.test(m) || /jwt|token/i.test(m)) return 'accès refusé par le site — reconnectez-vous dans les Paramètres';
  if (/^HTTP 403$/.test(m)) return 'ce compte n\'a pas le droit de faire cette opération';
  if (/^HTTP 5\d\d$/.test(m)) return 'le site rencontre un problème — réessayez dans un moment';
  return m || 'erreur inconnue';
}

async function sbRest(path, opts = {}) {
  await sbSession();
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: 'Bearer ' + sbToken, ...(opts.headers || {}) }
  });
  // ⚠ Un envoi réussi avec « Prefer: return=minimal » répond 201 avec un corps VIDE :
  // r.json() lançait alors « Unexpected end of JSON input » et l'app annonçait un échec
  // alors que les fiches étaient bien enregistrées (bug vu le 30/07/2026).
  const texte = await r.text();
  let corps = null;
  if (texte) { try { corps = JSON.parse(texte); } catch (_) { corps = null; } }
  if (!r.ok) throw new Error((corps && (corps.message || corps.error_description)) || ('HTTP ' + r.status));
  return corps;
}

async function pushFiches(silencieux) {
  if (!db.clients.length) { if (!silencieux) toast('Aucune fiche à envoyer.'); return; }
  const tous = db.clients.map((c) => ({ id: c.id, nom: fullName(c), data: c, app_updated_at: c.updatedAt || c.createdAt || null }));
  // Garde « le plus récent gagne » : ne jamais écraser une version du site plus
  // fraîche que la mienne (modifiée depuis un autre poste — ex. l'assistante).
  let fraicheurSite = {};
  let fraicheurLue = false;
  try {
    (await sbRest('fiches_ircc?select=id,app_updated_at') || [])
      .forEach((r) => { if (r.app_updated_at) fraicheurSite[r.id] = r.app_updated_at; });
    fraicheurLue = true;
  } catch (_) { /* lecture impossible : voir le refus ci-dessous */ }

  /* GARDE-FOU (audit du 23/08/2026). Depuis que la lecture des fiches est
     réservée à l'administrateur, un compte assistant reçoit une liste VIDE sans
     erreur : la garde « le plus récent gagne » tombait, et ses copies écrasaient
     toutes les fiches du site, même plus anciennes. On refuse donc d'envoyer en
     aveugle dès qu'on a déjà synchronisé une fois. */
  const dejaSynchronise = !!db.settings.syncLastAt;
  if (dejaSynchronise && (!fraicheurLue || !Object.keys(fraicheurSite).length)) {
    /* Cause la plus fréquente, et la seule qui se répare en dix secondes : le
       site attend le code de vérification. Tant qu'il ne l'a pas, il répond
       « 0 fiche » sans erreur. On le dit, au lieu d'accuser les droits du
       compte, et on ouvre la saisie du code. */
    let f = null;
    try { f = await facteurAVerifier(); } catch (_) {}
    if (f) {
      MFA.factorId = f.id; MFA.nom = f.nom; MFA.erreur = '';
      const m = 'Envoi en attente : le site demande votre code de vérification. Saisissez-le ci-dessous, puis renvoyez.';
      db.settings.syncAlerte = m;
      if (!silencieux) { save(); render(); toast(m); }
      throw new Error(m);
    }
    const msg = 'Envoi refusé : impossible de lire l\'état du site (compte sans droit de lecture, ou site injoignable). '
      + 'Envoyer maintenant écraserait les fiches du site par vos copies, même plus anciennes.';
    db.settings.syncAlerte = msg;
    if (!silencieux) { save(); render(); toast(msg); }
    throw new Error(msg);
  }

  const rows = tous.filter((r) => !fraicheurSite[r.id] || !r.app_updated_at || r.app_updated_at >= fraicheurSite[r.id]);
  const ignorees = tous.length - rows.length;
  // En envoi AUTOMATIQUE, les fiches ignorées ne se signalaient nulle part : le
  // poste croyait ses saisies parties, et elles disparaissaient au « Récupérer ».
  if (silencieux && ignorees) {
    db.settings.syncAlerte = `${ignorees} fiche${ignorees > 1 ? 's' : ''} plus récente${ignorees > 1 ? 's' : ''} sur le site n'${ignorees > 1 ? 'ont' : 'a'} pas été remplacée${ignorees > 1 ? 's' : ''}. Cliquez « Récupérer les fiches du site » avant de continuer, sinon vos modifications locales seront perdues.`;
  }
  if (rows.length) {
    await sbRest('fiches_ircc?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows)
    });
  }
  db.settings.syncLastAt = new Date().toISOString();
  if (!silencieux) {
    save();
    toast(`${plur(rows.length, 'fiche envoyée', 'fiches envoyées')} sur le site ✓` +
      (ignorees ? ` · ${plur(ignorees, 'plus récente', 'plus récentes')} sur le site — cliquez « Récupérer » pour les rapatrier` : ''));
    renderSiLibre();
  }
  // en mode silencieux (envoi auto), pas de save() ici : il re-déclencherait un envoi en boucle
}

/* Un identifiant de fiche est fabriqué par uid() : uniquement des lettres et
   des chiffres. Tout le reste est refusé À LA RÉCEPTION — la table du site est
   écrite par n'importe quel compte équipe, et un identifiant piégé s'exécutait
   dans les boutons de la liste (audit du 23/08/2026). */
const idFicheValide = (v) => typeof v === 'string' && /^[a-z0-9]{6,40}$/i.test(v);

async function pullFiches() {
  const rows = await sbRest('fiches_ircc?select=id,data,app_updated_at') || [];
  let ajoutees = 0, maj = 0, refusees = 0;
  rows.forEach((r) => {
    const fiche = r.data || {};
    if (!fiche.id) return;
    // l'identifiant de la LIGNE fait foi, et il doit être de forme attendue
    if (!idFicheValide(r.id) || !idFicheValide(fiche.id) || fiche.id !== r.id) { refusees++; return; }
    // une fiche supprimée ici ne doit pas revenir par la porte du site
    if ((db.settings.fichesSupprimees || []).includes(r.id)) return;
    const local = getClient(r.id);
    if (!local) { db.clients.push(fiche); ajoutees++; }
    else if (r.app_updated_at && (!local.updatedAt || r.app_updated_at > local.updatedAt)) {
      Object.assign(local, fiche); maj++;
    }
  });
  if (refusees) {
    db.settings.syncAlerte = `${refusees} fiche${refusees > 1 ? 's' : ''} du site ${refusees > 1 ? 'ont' : 'a'} été refusée${refusees > 1 ? 's' : ''} : identifiant anormal. Signalez-le — une fiche saine n'a jamais ce défaut.`;
  }
  migrate(db); // normalise la structure des fiches reçues
  db.settings.syncLastAt = new Date().toISOString();
  save(); renderSiLibre();
  toast(`Site → app : ${plur(ajoutees, 'nouvelle fiche', 'nouvelles fiches')}, ${plur(maj, 'mise à jour', 'mises à jour')}.`);
}

/* L'envoi automatique échouait EN SILENCE quand la session du site expirait :
   les fiches restaient sur le poste sans que rien ne le signale (constaté le 30/07/2026,
   plus aucun envoi depuis le 23/07). On prévient désormais l'utilisateur. */
let syncAlerteAffichee = false;

function signalerEchecSync(e) {
  const msg = messageReseau(e);
  const deconnecte = /session|connectez-vous/i.test(msg);
  db.settings.syncAlerte = (deconnecte
    ? 'Envoi automatique interrompu : la connexion au site a expiré. Reconnectez-vous ci-dessous, puis cliquez « Envoyer les fiches vers le site ».'
    : 'Envoi automatique interrompu : ' + msg) + ' (' + new Date().toLocaleString('fr-FR') + ')';
  if (HAS_API) window.api.saveData(db);           // écriture directe : ne relance pas l'envoi auto
  else localStorage.setItem(LS_KEY, JSON.stringify(db));
  if (!syncAlerteAffichee) {
    syncAlerteAffichee = true;
    toast(deconnecte ? '⚠ Site déconnecté : vos fiches ne sont plus envoyées (voir Paramètres).' : '⚠ Envoi vers le site impossible : ' + msg);
  }
  if (view === 'settings') renderSiLibre();
}

function scheduleAutoPush() {
  if (!db || !db.settings.syncAuto || !syncOn()) return;
  clearTimeout(autoPushTimer);
  autoPushTimer = setTimeout(() => {
    pushFiches(true).then(() => {
      if (db.settings.syncAlerte) { db.settings.syncAlerte = ''; if (HAS_API) window.api.saveData(db); }
    }).catch(signalerEchecSync);
  }, 8000);
}

/* ================= État UI ================= */

let view = 'dashboard';
let curId = null;
let curTab = 'infos';
let search = '';
let showArchived = false;
let showCorbeille = false;   // troisième onglet de la liste : les fiches supprimées

/* Mode d'ouverture. Il est choisi À CHAQUE lancement sur l'écran d'ouverture et
   n'est JAMAIS enregistré : fermer puis rouvrir l'application repose la question.
   « assistant » retire le volet financier — échéancier, versements, dépenses,
   bénéfice — et rien d'autre. Le reste du logiciel est identique.
   Ce cloisonnement empêche de VOIR par mégarde, il ne remplace pas une serrure :
   le fichier de données reste lisible sur le poste (voir Paramètres → Ouverture). */
let role = 'admin';                       // 'admin' | 'assistant'
const estAdmin = () => role === 'admin';

/* Filtres de la liste des clients. Ils sont volontairement remis à zéro à chaque
   lancement : personne ne doit ouvrir l'application et croire des fiches disparues.
   Le tri et le regroupement, eux, ne cachent personne : ils sont mémorisés. */
const FILTRE = { etape: '', delaiAor: '', paiement: '', crs: '', anniv: '' };
// le filtre « paiement » ne compte pas en mode assistant(e) : il n'y est pas affiché
// et il ne cache personne, il ne doit donc pas déclencher « Effacer les filtres »
const filtreActif = () => Object.entries(FILTRE).some(([k, v]) => v && (k !== 'paiement' || estAdmin()));

let cfDragIdx = null;   // index du champ personnalisé en cours de glissement
let finDrag = null;     // { liste, i } ligne de finances en cours de glissement

/* Écran « Revenir en arrière » : l'explication est repliée, et seules les trois
   copies les plus récentes sont montrées — ce sont les seules qu'on cherche en
   pratique. La liste complète reste à un clic. */
const SAUVEGARDES_MONTREES = 3;
/* Code de vérification du site : renseigné le temps de la saisie, jamais gardé. */
const MFA = { factorId: '', nom: '', erreur: '' };
const SAUV = { liste: null, ouvert: false, toutes: false };

/* transitoires (outils) */
const CV = { cur: 'CAD', dir: 'to', amount: '' };
const IR = { sel: {} };            // idx -> qté (frais IRCC cochés)
const VM = { sel: {} };            // id de tranche -> nombre de personnes (visite médicale)
const PF = { n: '', bareme: false };   // personnes du dossier (vide par défaut) + barème replié
const CALC = { expr: '' };

/* ================= Rendu ================= */

function render() {
  renderPending = false;
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view || (view === 'client' && b.dataset.view === 'clients'));
  });
  const main = $('#main');
  if (view === 'dashboard') main.innerHTML = vDashboard();
  else if (view === 'clients') main.innerHTML = vClients();
  else if (view === 'client') main.innerHTML = vClient();
  else if (view === 'settings') main.innerHTML = vSettings();
  // en lecture seule, on le dit EN HAUT DE CHAQUE ÉCRAN : travailler une heure
  // en croyant que tout s'enregistre serait pire que le fichier abîmé lui-même
  if (lectureSeule) {
    main.insertAdjacentHTML('afterbegin',
      `<div class="banner-alarm">${ico('cadenas')} <b>Lecture seule</b> — vos données n'ont pas pu être lues au démarrage.
       Rien de ce que vous saisissez ne sera enregistré. Fermez l'application et restaurez une sauvegarde
       (dossier <code>%APPDATA%\\IV Clients\\sauvegardes</code>) avant de reprendre.</div>`);
  }
  afterRender();
}

/* Frise du dossier : les étapes suivies en champs personnalisés, dans l'ordre.
   Verte = franchie (date renseignée), en surbrillance = prochaine à venir. */
const ETAPES_FRISE = ['DI', 'ITA', 'AOR', 'VMF', 'IBIO', 'BIO'];

/* Les étapes d'une fiche : ses champs de type date cochés « frise », dans leur ordre. */
function etapesDe(c) {
  return (c.custom || [])
    .filter((f) => f.type === 'date' && f.frise)
    .map((f) => ({ nom: (f.label || '—').trim(), date: f.value || '' }));
}

/* Où en est le dossier : la première étape sans date est celle que l'on attend.
   C'est exactement l'étape mise en avant dans la frise de la fiche. */
function avancement(c) {
  const es = etapesDe(c);
  const faites = es.filter((e) => e.date).length;
  if (!es.length) return { code: '__aucune', titre: 'Aucune étape suivie', etat: 'aucune', faites: 0, total: 0 };
  const i = es.findIndex((e) => !e.date);
  if (i < 0) return { code: '__complet', titre: 'Dossier complet', etat: 'complet', faites, total: es.length };
  return { code: normEtape(es[i].nom), titre: 'En attente : ' + es[i].nom, etat: 'attente', faites, total: es.length };
}

/* Une étape est franchie dès qu'une date lui est associée dans la fiche */
const etapeFaite = (c, code) => (c.custom || []).some((f) => f.type === 'date' && normEtape(f.label) === code && f.value);

/* Toutes les étapes rencontrées : les six officielles d'abord, puis celles
   que l'utilisateur a ajoutées lui-même, dans leur ordre d'apparition. */
function etapesConnues() {
  const vues = new Map();
  ETAPES_FRISE.forEach((n) => vues.set(normEtape(n), n));
  db.clients.forEach((c) => etapesDe(c).forEach((e) => { if (!vues.has(normEtape(e.nom))) vues.set(normEtape(e.nom), e.nom); }));
  return [...vues.entries()].map(([code, nom]) => ({ code, nom }));
}

function friseHtml(c) {
  // la frise reprend les champs de type date QUE VOUS avez cochés, dans leur ordre
  const etapes = etapesDe(c);
  if (!etapes.length) return '';
  const prochaine = etapes.findIndex((e) => !e.date);
  return `<div class="frise">${etapes.map((e, i) => {
    const etat = e.date ? 'faite' : (i === prochaine ? 'encours' : 'attente');
    const pastille = e.date ? '✓' : String(i + 1);
    return `<div class="frise-etape ${etat}">
      <div class="frise-pastille">${pastille}</div>
      <div class="frise-nom">${esc(e.nom)}</div>
      <div class="frise-date">${e.date ? frDate(e.date) : '—'}</div>
    </div>`;
  }).join('')}</div>${compareDelaiHabituel(c)}`;
}

/* Ce dossier, comparé à vos autres dossiers.
   La phrase n'apparaît QUE si l'attente dépasse déjà le délai habituel : le
   reste du temps, il n'y a rien à dire et une ligne de plus n'aiderait personne.
   C'est aussi ce qui permet de répondre à un client par un chiffre à vous. */
function compareDelaiHabituel(c) {
  if (!c || c.archive) return '';        // un dossier archivé n'« attend » plus rien
  const av = avancement(c);
  if (av.etat !== 'attente') return '';
  const etapes = etapesDe(c);
  const i = etapes.findIndex((e) => !e.date);
  if (i <= 0) return '';                                   // la première étape n'a pas de « depuis »
  const precedente = etapes[i - 1];
  if (!precedente.date) return '';
  const attend = daysSince(precedente.date);
  if (attend === null || attend < 0) return '';
  const h = delaiHabituel(precedente.nom, etapes[i].nom);
  if (h.median === null || attend <= h.median) return '';
  return `<div class="comparaison-delai">${ico('boussole', 'ico ico-sm')}
    Ce dossier attend <b>${esc(etapes[i].nom)}</b> depuis ${esc(dureeJours(attend))}.
    Entre ${esc(precedente.nom)} et ${esc(etapes[i].nom)}, vos dossiers mettent d'habitude
    ${esc(dureeJours(h.median))} <span class="muted">(sur ${h.n} dossier${h.n > 1 ? 's' : ''}, du plus court ${esc(dureeJours(h.min))} au plus long ${esc(dureeJours(h.max))})</span>.</div>`;
}

/* Couleur d'avatar stable, dérivée du nom */
function couleurAvatar(nom) {
  const palette = ['#1E3F76', '#0F6E56', '#A96410', '#7A3E9D', '#B3261E', '#0E6B8A', '#8A5A2B'];
  let h = 0;
  for (const ch of String(nom || '')) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return palette[h % palette.length];
}
const initiales = (c) => ((c.prenom || '').trim()[0] || '') + ((c.nom || '').trim()[0] || '') || '?';

function chipBirthday(c, blink = true) {
  const j = daysToBirthday(c.dateNaissance);
  if (j === null) return '';
  const g = ico('gateau', 'ico ico-sm');
  if (j <= 5) return `<span class="chip red ${blink ? 'alarm-blink' : ''}">${g} ${j === 0 ? "C'est aujourd'hui !" : 'J-' + j}</span>`;
  if (j <= 30) return `<span class="chip amber">${g} J-${j}</span>`;
  return `<span class="chip">${g} J-${j}</span>`;
}

/* Pastille du délai de soumission. Le rouge clignotant est réservé au dernier
   palier — les dix derniers jours — pour qu'il veuille encore dire quelque chose.
   Un délai DÉPASSÉ ne clignote pas : il reste rouge, en toutes lettres. */
function chipSoumission(c, blink = true) {
  const s = delaiSoumission(c);
  if (!s) return '';
  const g = ico('calendrier', 'ico ico-sm');
  if (s.futur) return `<span class="chip amber" title="Cette date d'ITA est dans le futur — vérifiez la saisie">${g} ITA à vérifier</span>`;
  const info = `Dossier à déposer au plus tard le ${frDate(s.limite)} — ${JOURS_SOUMISSION} jours comptés à partir du lendemain de l'ITA du ${frDate(s.ita)}. La date du compte IRCC du client fait foi.`;
  // la date d'expiration s'affiche à côté du décompte (demande d'Alex du 06/10/2026)
  const date = `<span class="chip-date">${s.reste < 0 ? 'expiré' : 'expire'} le ${frDate(s.limite)}</span>`;
  if (s.reste < 0) return `<span class="chip red" title="${esc(info)}">${g} Soumission en retard de ${-s.reste} j ${date}</span>`;
  if (s.reste === 0) return `<span class="chip red ${blink ? 'alarm-blink' : ''}" title="${esc(info)}">${g} Soumission : dernier jour ! ${date}</span>`;
  if (s.reste <= 10) return `<span class="chip red ${blink ? 'alarm-blink' : ''}" title="${esc(info)}">${g} Soumission J-${s.reste} ${date}</span>`;
  if (s.reste <= 25) return `<span class="chip amber" title="${esc(info)}">${g} Soumission J-${s.reste} ${date}</span>`;
  return `<span class="chip" title="${esc(info)}">${g} Soumission J-${s.reste} ${date}</span>`;
}

/* ---------- Tableau de bord ---------- */

/* Une durée dite comme on la dit à l'oral. « environ » est là exprès : au-delà
   de six semaines, personne ne compte en jours et un chiffre précis ferait
   croire à une précision qu'on n'a pas. */
function dureeJours(n) {
  if (n === null || n === undefined) return '—';
  const j = Math.abs(Math.round(n));
  if (j === 0) return 'le jour même';
  if (j < 45) return j + ' jour' + (j > 1 ? 's' : '');
  const mois = Math.round(j / 30.44);
  if (mois < 18) return 'environ ' + mois + ' mois';
  const ans = Math.floor(mois / 12), reste = mois % 12;
  return 'environ ' + ans + ' an' + (ans > 1 ? 's' : '') + (reste ? ' et ' + reste + ' mois' : '');
}

/* ---------- « À faire aujourd'hui » ----------
   Une seule liste, tous motifs confondus, la plus urgente en tête : c'est ce
   qu'on vient chercher en ouvrant le logiciel le matin. Cocher une ligne la
   retire pour la journée seulement — elle revient demain si le motif tient
   toujours. RIEN n'est modifié dans la fiche : c'est un pense-bête, pas une
   action sur le dossier. */
const JOURS_SANS_NOUVELLE = 240;   // 8 mois après l'AOR sans l'étape suivante

function tachesDuJour() {
  const cs = db.clients.filter((c) => !c.archive);
  const t = todayMid();
  const faites = db.settings.aFaireFait || {};
  const auj = todayISO();
  const taches = [];

  cs.forEach((c) => {
    // 1. le délai de soumission — le seul qui fait perdre l'invitation
    const s = delaiSoumission(c);
    if (s && !s.futur && s.reste <= 25) {
      taches.push({
        cle: 'soumission:' + c.id, c, rang: s.reste < 0 ? -10000 + s.reste : s.reste,
        urgence: s.reste <= 10 ? 'rouge' : 'orange',
        quoi: s.reste < 0 ? `Dossier non déposé — délai dépassé de ${-s.reste} j`
          : s.reste === 0 ? 'Dernier jour pour déposer le dossier'
          : `Déposer le dossier sous ${s.reste} j`,
        detail: `ITA du ${frDate(s.ita)} — au plus tard le ${frDate(s.limite)}`
      });
    }
    if (s && s.futur) {
      taches.push({ cle: 'ita-futur:' + c.id, c, rang: 30, urgence: 'orange',
        quoi: 'Date d\'ITA à vérifier', detail: `Elle est saisie au ${frDate(s.ita)}, dans le futur` });
    }

    // 2. anniversaire imminent
    const j = daysToBirthday(c.dateNaissance);
    if (j !== null && j <= 5) {
      taches.push({ cle: 'anniv:' + c.id, c, rang: -100 + j, urgence: j === 0 ? 'rouge' : 'orange',
        quoi: j === 0 ? 'Anniversaire aujourd\'hui' : `Anniversaire dans ${j} j`,
        detail: `${frDate(c.dateNaissance)} — ${j === 0 ? `${ageOf(c.dateNaissance)} ans` : `${(ageOf(c.dateNaissance) ?? 0) + 1} ans`}` });
    }

    // 3. dossier sans nouvelle depuis longtemps
    const dAor = daysSince(dateAorDe(c));
    const av = avancement(c);
    if (dAor !== null && dAor >= JOURS_SANS_NOUVELLE && av.etat === 'attente') {
      taches.push({ cle: 'relance:' + c.id, c, rang: 200 - Math.min(dAor, 190), urgence: 'calme',
        quoi: 'Dossier sans nouvelle — à relancer',
        detail: `${av.titre} · AOR reçu il y a ${dureeJours(dAor)}` });
    }

    // 4. échéances de paiement — motif financier, donc administrateur seulement
    if (estAdmin()) {
      reglementEcheancier(c).lignes.forEach((l, i) => {
        if (l.statut === 'paye' || !l.e.date) return;
        const dEch = parseISO(l.e.date); if (!dEch) return;
        const jours = Math.round((dEch - t) / 86400000);
        if (jours > 7) return;
        taches.push({ cle: 'echeance:' + c.id + ':' + (l.e.id || i), c,
          rang: jours < 0 ? -5000 + jours : jours, urgence: jours < 0 ? 'rouge' : 'orange',
          quoi: jours < 0 ? `Échéance impayée depuis ${-jours} j` : jours === 0 ? 'Échéance à encaisser aujourd\'hui' : `Échéance dans ${jours} j`,
          detail: `${l.e.label || 'Échéance'} — ${fmt(l.solde)} F à percevoir` });
      });
    }
  });

  taches.sort((a, b) => a.rang - b.rang || fullName(a.c).localeCompare(fullName(b.c), 'fr'));
  return { taches, restantes: taches.filter((x) => faites[x.cle] !== auj) };
}

function carteAFaire() {
  const { taches, restantes } = tachesDuJour();
  const faites = taches.length - restantes.length;
  const puce = { rouge: 'red', orange: 'amber', calme: '' };
  return `<div class="card">
    <h2>${ico('notes')} À faire aujourd'hui${restantes.length ? ` <span class="hint">${restantes.length} point${restantes.length > 1 ? 's' : ''}</span>` : ''}</h2>
    ${restantes.length ? `<div class="a-faire">${restantes.map((x) => `
      <label class="a-faire-ligne ${esc(x.urgence)}">
        <input type="checkbox" data-tache="${esc(x.cle)}">
        <span class="a-faire-texte">
          <b>${esc(fullName(x.c))}</b> — ${esc(x.quoi)}
          <span class="muted">${esc(x.detail)}</span>
        </span>
        <button class="btn btn-ghost btn-small" data-agir="ouvrir" data-id="${esc(x.c.id)}">Ouvrir</button>
      </label>`).join('')}</div>`
    : `<div class="empty">${ico('dossier','ico big')}${taches.length ? 'Tout est coché pour aujourd\'hui.' : 'Rien qui presse aujourd\'hui.'}</div>`}
    ${faites ? `<p class="help-text" style="margin-top:10px">${faites} point${faites > 1 ? 's' : ''} coché${faites > 1 ? 's' : ''} aujourd'hui — ${faites > 1 ? 'ils reviendront' : 'il reviendra'} demain si la raison tient toujours.
      <button class="lien-effacer" style="margin-left:6px" onclick="A.rendreTaches()"><span class="croix">↺</span> Tout réafficher</button></p>` : ''}
  </div>`;
}

/* ---------- Vos délais habituels ----------
   Tirés de VOS dossiers, pas d'une moyenne trouvée ailleurs : c'est ce qui vous
   permet de répondre à un client par un chiffre qui vous appartient.
   On retient la MÉDIANE et non la moyenne — un seul dossier bloqué deux ans ne
   doit pas déformer le chiffre. En dessous de trois dossiers on n'affiche rien :
   un « délai habituel » tiré de deux cas n'est pas un délai habituel. */
const MIN_DOSSIERS_DELAI = 3;
const PAIRES_ETAPES = [['DI', 'ITA'], ['ITA', 'AOR'], ['AOR', 'VMF'], ['VMF', 'IBIO'], ['IBIO', 'BIO']];

function delaiHabituel(de, vers) {
  const jours = db.clients.map((c) => {
    const a = parseISO(dateEtape(c, de)), b = parseISO(dateEtape(c, vers));
    if (!a || !b) return null;
    const n = Math.round((b - a) / 86400000);
    return n >= 0 ? n : null;          // deux dates inversées : saisie douteuse, écartée
  }).filter((n) => n !== null).sort((x, y) => x - y);
  if (jours.length < MIN_DOSSIERS_DELAI) return { de, vers, n: jours.length, median: null };
  const m = jours.length % 2
    ? jours[(jours.length - 1) / 2]
    : Math.round((jours[jours.length / 2 - 1] + jours[jours.length / 2]) / 2);
  return { de, vers, n: jours.length, median: m, min: jours[0], max: jours[jours.length - 1] };
}

function carteDelaisHabituels() {
  const lignes = PAIRES_ETAPES.map(([de, vers]) => delaiHabituel(de, vers));
  const exploitables = lignes.filter((l) => l.median !== null);
  return `<div class="card">
    <h2>${ico('boussole')} Vos délais habituels <span class="hint">d'après vos propres dossiers</span></h2>
    ${exploitables.length ? `<table>
      <thead><tr><th>Étape</th><th>Délai habituel</th><th class="num">Le plus court</th><th class="num">Le plus long</th><th class="num">Dossiers</th></tr></thead>
      <tbody>${exploitables.map((l) => `<tr>
        <td><b>${esc(l.de)} → ${esc(l.vers)}</b></td>
        <td>${esc(dureeJours(l.median))}</td>
        <td class="num muted">${esc(dureeJours(l.min))}</td>
        <td class="num muted">${esc(dureeJours(l.max))}</td>
        <td class="num muted">${l.n}</td>
      </tr>`).join('')}</tbody></table>
      <p class="help-text">« Délai habituel » = la moitié de vos dossiers ont mis moins que ce temps, l'autre moitié davantage. Une seule affaire bloquée ne déforme donc pas le chiffre. Les étapes suivies par moins de ${MIN_DOSSIERS_DELAI} dossiers ne sont pas affichées : le chiffre ne voudrait rien dire.</p>`
    : `<div class="empty">${ico('boussole','ico big')}Pas encore assez de dossiers pour dégager un délai habituel. Il en faut au moins ${MIN_DOSSIERS_DELAI} ayant franchi les deux étapes.</div>`}
  </div>`;
}

/* Carte des anniversaires : identique dans les deux modes (rien de financier) */
function carteAnniversaires(cs) {
  const bdays = cs.filter((c) => daysToBirthday(c.dateNaissance) !== null)
    .map((c) => ({ c, j: daysToBirthday(c.dateNaissance) }))
    .filter((x) => x.j <= 30).sort((a, b) => a.j - b.j);
  return `<div class="card">
      <h2>Prochains anniversaires <span class="hint">30 jours</span></h2>
      ${bdays.length ? `<table><tbody>${bdays.map(({ c, j }) => `
        <tr class="tr-click" data-agir="ouvrir" data-id="${esc(c.id)}">
          <td><b>${esc(fullName(c))}</b><br><span class="muted">${frDate(c.dateNaissance)} — ${j === 0 ? `fête ses ${ageOf(c.dateNaissance)} ans aujourd'hui` : `fêtera ${(ageOf(c.dateNaissance) ?? 0) + 1} ans`}</span></td>
          <td class="right">${chipBirthday(c, true)}</td>
        </tr>`).join('')}</tbody></table>`
      : `<div class="empty">${ico('gateau','ico big')}Aucun anniversaire dans les 30 prochains jours.</div>`}
    </div>`;
}

/* Dossiers dont une étape est attendue, la plus vieille attente en tête.
   C'est la contrepartie non financière des « échéances à surveiller » : en mode
   assistant(e), c'est ce qui doit occuper la deuxième colonne. */
function carteEtapesAttendues(cs) {
  const items = cs
    .map((c) => ({ c, av: avancement(c), j: daysSince(dateAorDe(c)) }))
    .filter((x) => x.av.etat === 'attente')
    .sort((a, b) => {
      const ja = a.j === null || a.j < 0 ? -1 : a.j;
      const jb = b.j === null || b.j < 0 ? -1 : b.j;
      return jb - ja || fullName(a.c).localeCompare(fullName(b.c), 'fr');
    });
  return `<div class="card">
      <h2>Étapes attendues <span class="hint">la plus longue attente d'abord</span></h2>
      ${items.length ? `<table><tbody>${items.slice(0, 10).map(({ c, av, j }) => `
        <tr class="tr-click" data-agir="ouvrir" data-id="${esc(c.id)}">
          <td><b>${esc(fullName(c))}</b><br><span class="muted">${esc(av.titre)} — ${av.faites} sur ${av.total} franchie${av.faites > 1 ? 's' : ''}</span></td>
          <td class="right">${j !== null && j >= 0 ? `<span class="chip ${j >= 180 ? 'amber' : ''}">AOR +${j} j</span>` : '<span class="chip">AOR non renseigné</span>'}</td>
        </tr>`).join('')}</tbody></table>`
      : `<div class="empty">${ico('dossier','ico big')}Aucune étape en attente : tous les dossiers suivis sont complets.</div>`}
    </div>`;
}

function vDashboard() {
  const cs = db.clients.filter((c) => !c.archive); // les archivés ne génèrent plus d'alertes
  const alarms = cs.filter((c) => { const j = daysToBirthday(c.dateNaissance); return j !== null && j <= 5; });

  /* Bandeau du délai de soumission. Il passe AVANT les anniversaires : un
     anniversaire oublié est un désagrément, une invitation périmée fait perdre
     au client sa chance et le renvoie dans le bassin. */
  const soum = cs.map((c) => ({ c, s: delaiSoumission(c) }))
    .filter((x) => x.s && !x.s.futur && x.s.reste <= 10)
    .sort((a, b) => a.s.reste - b.s.reste);
  const depasses = soum.filter((x) => x.s.reste < 0);
  const imminents = soum.filter((x) => x.s.reste >= 0);

  const enTete = `
  <div class="page-head"><h1>Tableau de bord</h1><span class="spacer"></span>
    <button class="btn btn-primary" onclick="A.newClient()">+ Nouveau client</button>
  </div>
  ${depasses.length ? `<div class="banner-alarm">${ico('calendrier')} <b>Délai de soumission dépassé</b> —
      ${depasses.map((x) => `${esc(fullName(x.c))} (${-x.s.reste} j de retard, expiré le ${frDate(x.s.limite)})`).join(' · ')}.
      Si le dossier a bien été déposé, saisissez la date d'AOR : le décompte s'arrêtera.</div>` : ''}
  ${imminents.length ? `<div class="banner-alarm">${ico('calendrier')} Dossier${imminents.length > 1 ? 's' : ''} à déposer sous 10 jours :
      ${imminents.map((x) => `${esc(fullName(x.c))} (${x.s.reste === 0 ? "dernier jour !" : 'J-' + x.s.reste}, expire le ${frDate(x.s.limite)})`).join(' · ')}</div>` : ''}
  ${alarms.length ? `<div class="banner-alarm">${ico('gateau')} Anniversaire${alarms.length > 1 ? 's' : ''} imminent${alarms.length > 1 ? 's' : ''} :
      ${alarms.map((c) => `${esc(fullName(c))} (${daysToBirthday(c.dateNaissance) === 0 ? "aujourd'hui" : 'J-' + daysToBirthday(c.dateNaissance)})`).join(' · ')}</div>` : ''}`;

  /* Mode assistant(e) : ni bénéfice, ni échéances, ni montants — et rien n'est
     seulement masqué à l'écran, les totaux ne sont même pas calculés. */
  if (!estAdmin()) {
    const complets = cs.filter((c) => avancement(c).etat === 'complet').length;
    const attente = cs.filter((c) => avancement(c).etat === 'attente').length;
    return `${enTete}
  <div class="stats">
    <div class="stat"><div class="label">Clients actifs</div><div class="value">${cs.length}</div></div>
    <div class="stat ${soum.length ? 'red' : ''}"><div class="label">Soumissions ≤ 10 j</div><div class="value">${soum.length}</div><div class="sub">délai dépassé compris</div></div>
    <div class="stat"><div class="label">Dossiers en attente</div><div class="value">${attente}</div><div class="sub">une étape reste à franchir</div></div>
    <div class="stat teal"><div class="label">Dossiers complets</div><div class="value">${complets}</div><div class="sub">toutes les étapes franchies</div></div>
  </div>
  ${carteAFaire()}
  <div class="cards-row">
    ${carteAnniversaires(cs)}
    ${carteEtapesAttendues(cs)}
  </div>
  ${carteDelaisHabituels()}`;
  }

  const benefTous = db.clients.reduce((s, c) => s + finTotals(c).benefice, 0);
  const t = todayMid();
  const lateEch = [];
  const nextEch = [];
  cs.forEach((c) => reglementEcheancier(c).lignes.forEach((l) => {
    if (l.statut === 'paye' || !l.e.date) return;   // une tranche partiellement réglée reste à surveiller
    const d = parseISO(l.e.date); if (!d) return;
    const item = { c, e: l.e, solde: l.solde, days: Math.round((d - t) / 86400000) };
    if (d < t) lateEch.push(item); else if (item.days <= 30) nextEch.push(item);
  }));
  lateEch.sort((a, b) => a.days - b.days); nextEch.sort((a, b) => a.days - b.days);

  return `${enTete}
  <div class="stats">
    <div class="stat ${soum.length ? 'red' : ''}"><div class="label">Soumissions ≤ 10 j</div><div class="value">${soum.length}</div><div class="sub">délai dépassé compris</div></div>
    <div class="stat ${alarms.length ? 'red' : ''}"><div class="label">Anniversaires ≤ 5 j</div><div class="value">${alarms.length}</div></div>
    <div class="stat ${lateEch.length ? 'amber' : ''}"><div class="label">Échéances en retard</div><div class="value">${lateEch.length}</div></div>
    <div class="stat teal"><div class="label">Bénéfice total</div><div class="value">${fmt(benefTous)}</div><div class="sub">FCFA — tous clients, archivés compris</div></div>
  </div>
  ${carteAFaire()}
  <div class="cards-row">
    ${carteAnniversaires(cs)}
    <div class="card">
      <h2>Échéances à surveiller</h2>
      ${(lateEch.length + nextEch.length) ? `<table><tbody>${[...lateEch, ...nextEch].slice(0, 10).map(({ c, e, solde, days }) => `
        <tr class="tr-click" data-agir="ouvrir" data-id="${esc(c.id)}">
          <td><b>${esc(fullName(c))}</b><br><span class="muted">${esc(e.label || 'Échéance')} — ${frDate(e.date)}${solde < (Number(e.montant) || 0) ? ' · partiellement réglée' : ''}</span></td>
          <td class="num">${fmt(solde)} F</td>
          <td class="right">${days < 0 ? `<span class="chip red">Retard ${-days} j</span>` : `<span class="chip ${days <= 7 ? 'amber' : ''}">J-${days}</span>`}</td>
        </tr>`).join('')}</tbody></table>`
      : `<div class="empty">${ico('calendrier','ico big')}Aucune échéance impayée à moins de 30 jours.</div>`}
    </div>
  </div>
  ${carteDelaisHabituels()}`;
}

/* ---------- Liste clients ---------- */

/* Tri de la liste. Une fiche sans valeur (pas d'AOR, pas de CRS…) part toujours
   à la fin, jamais en tête : sinon les dossiers vides masquent les autres. */
function trierClients(list) {
  const nom = (a, b) => fullName(a).localeCompare(fullName(b), 'fr');
  const nb = (v) => { const n = Number(v); return v === '' || v === null || v === undefined || isNaN(n) ? null : n; };
  // les « null » (valeur absente) descendent en bas, quel que soit le sens du tri
  const parVal = (val, sens) => (a, b) => {
    const x = val(a), y = val(b);
    if (x === null && y === null) return nom(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    return (x === y ? nom(a, b) : (x - y) * sens);
  };
  const tris = {
    nom,
    'nom-desc': (a, b) => nom(b, a),
    'etape-plus': parVal((c) => avancement(c).faites, -1),
    'etape-moins': parVal((c) => avancement(c).faites, 1),
    aor: parVal((c) => daysSince(dateAorDe(c)), -1),
    crs: parVal((c) => nb(c.scoreCrs), -1),
    anniv: parVal((c) => daysToBirthday(c.dateNaissance), 1),
    reste: parVal((c) => finTotals(c).echRestant || null, -1),
    recent: (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || nom(a, b),
    maj: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || nom(a, b)
  };
  // « Reste à payer » est un tri financier : en mode assistant(e) il n'existe pas,
  // même si le réglage enregistré le demande encore (choix fait en mode admin).
  let choisi = db.settings.triClients;
  if (!estAdmin() && choisi === 'reste') choisi = 'nom';
  return list.slice().sort(tris[choisi] || nom);
}

/* La liste réellement affichée : recherche + filtres + tri */
function clientsFiltres() {
  const q = search.toLowerCase().trim();
  const t = todayMid();
  const list = db.clients
    .filter((c) => !!c.archive === showArchived)
    .filter((c) => !q || [c.nom, c.prenom, c.iuc, c.numDemande, c.telephone, c.mailIrcc, c.numPasseport, c.niu, c.cnp, c.posteIrcc, c.employeurIrcc].join(' ').toLowerCase().includes(q))
    .filter((c) => {
      if (!FILTRE.etape) return true;
      const [mode, code] = FILTRE.etape.split(':');
      if (mode === 'cours') return avancement(c).code === code;
      if (mode === 'faite') return etapeFaite(c, code);
      if (mode === 'manque') return !etapeFaite(c, code);
      return true;
    })
    .filter((c) => {
      if (!FILTRE.delaiAor) return true;
      const j = daysSince(dateAorDe(c));
      if (FILTRE.delaiAor === 'sans') return j === null || j < 0;   // date future : à vérifier, donc pas un délai
      if (j === null || j < 0) return false;
      if (FILTRE.delaiAor === '0') return j < 90;
      if (FILTRE.delaiAor === '90') return j >= 90 && j < 180;
      if (FILTRE.delaiAor === '180') return j >= 180 && j < 365;
      if (FILTRE.delaiAor === '365') return j >= 365;
      return true;
    })
    .filter((c) => {
      if (!FILTRE.paiement || !estAdmin()) return true;   // filtre financier : sans objet en mode assistant(e)
      const f = finTotals(c);
      if (FILTRE.paiement === 'aucun') return f.echTotal === 0;
      if (FILTRE.paiement === 'solde') return f.echTotal > 0 && f.echRestant === 0;
      if (FILTRE.paiement === 'reste') return f.echRestant > 0;
      if (FILTRE.paiement === 'retard') return reglementEcheancier(c).lignes.some((l) => l.statut !== 'paye' && dateDepassee(l.e.date, t));
      return true;
    })
    .filter((c) => {
      if (!FILTRE.crs) return true;
      const n = Number(c.scoreCrs);
      const a = !(c.scoreCrs === '' || c.scoreCrs === null || c.scoreCrs === undefined || isNaN(n));
      if (FILTRE.crs === 'sans') return !a;
      if (!a) return false;
      if (FILTRE.crs === '500') return n >= 500;
      if (FILTRE.crs === '470') return n >= 470 && n < 500;
      if (FILTRE.crs === '450') return n >= 450 && n < 470;
      if (FILTRE.crs === 'bas') return n < 450;
      return true;
    })
    .filter((c) => {
      if (!FILTRE.anniv) return true;
      const j = daysToBirthday(c.dateNaissance);
      return j !== null && j <= Number(FILTRE.anniv);
    });
  return trierClients(list);
}

function ligneClient(c) {
  const age = ageOf(c.dateNaissance);
  const dAOR = daysSince(dateAorDe(c));
  const av = avancement(c);
  const sous = [
    age !== null ? age + ' ans' : '',
    esc([c.villeNaissance, c.paysNaissance].filter(Boolean).join(', ')),
    esc(c.telephone),
    c.iuc ? 'IUC ' + esc(c.iuc) : ''
  ].filter(Boolean).map((x) => `<span>${x}</span>`).join('<span>·</span>');
  const chipEtape = av.etat === 'aucune' ? ''
    : `<span class="chip ${av.etat === 'complet' ? 'teal' : ''}" title="${av.faites} étape${av.faites > 1 ? 's' : ''} sur ${av.total} franchie${av.faites > 1 ? 's' : ''}">${ico('dossier', 'ico ico-sm')} ${esc(av.titre)}</span>`;
  return `<div class="client-row" data-agir="ouvrir" data-id="${esc(c.id)}">
      <span class="avatar" style="background:${couleurAvatar(fullName(c))}">${esc(initiales(c))}</span>
      <div>
        <div class="nom">${esc(fullName(c))}</div>
        <div class="sous">${sous || '<span>Fiche à compléter</span>'}</div>
      </div>
      <div class="droite">
        ${chipSoumission(c)}
        ${chipEtape}
        ${chipBirthday(c)}
        ${c.scoreCrs ? `<span class="chip teal">CRS ${esc(c.scoreCrs)}</span>` : ''}
        ${dAOR !== null ? (dAOR < 0
          ? `<span class="chip amber" title="Cette date d'AOR est dans le futur — vérifiez la saisie">AOR dans ${-dAOR} j ?</span>`
          : `<span class="chip">AOR +${dAOR} j</span>`) : ''}
      </div>
    </div>`;
}

function clientRows() {
  const list = clientsFiltres();
  const q = search.trim();
  if (!list.length) {
    const raison = q && filtreActif() ? 'Aucun client ne correspond à cette recherche et à ces filtres.'
      : q ? 'Aucun résultat pour cette recherche.'
      : filtreActif() ? 'Aucun client ne correspond à ces filtres.'
      : showArchived ? 'Aucun client archivé.'
      : db.clients.length ? 'Tous vos clients sont archivés.' : 'Aucun client pour le moment. Créez votre premier fichier client !';
    const bouton = (q || filtreActif()) ? `<button class="btn btn-ghost btn-small" style="margin-top:12px" onclick="A.resetFiltres()">Tout réafficher</button>` : '';
    return `<div class="empty">${ico(showArchived ? 'archive' : 'vide', 'ico big')}${raison}${bouton}</div>`;
  }
  if (!db.settings.groupeEtape) return list.map(ligneClient).join('');

  // regroupement par étape attendue, dans l'ordre du dossier
  const ordre = ['__aucune', ...etapesConnues().map((e) => e.code), '__complet'];
  const rang = (code) => { const i = ordre.indexOf(code); return i < 0 ? ordre.length : i; };
  const groupes = new Map();
  list.forEach((c) => {
    const av = avancement(c);
    if (!groupes.has(av.code)) groupes.set(av.code, { titre: av.titre, items: [] });
    groupes.get(av.code).items.push(c);
  });
  return [...groupes.entries()]
    .sort((x, y) => rang(x[0]) - rang(y[0]))
    .map(([, g]) => `<div class="groupe-etape"><span>${esc(g.titre)}</span><b>${g.items.length}</b></div>${g.items.map(ligneClient).join('')}`)
    .join('');
}

/* ----- barre de filtres ----- */

function optSel(valeurCourante, liste) {
  return liste.map(([v, t]) => `<option value="${esc(v)}"${valeurCourante === v ? ' selected' : ''}>${esc(t)}</option>`).join('');
}

function champFiltre(cle, libelle, optionsHtml, large) {
  return `<label class="filtre${large ? ' large' : ''}"><span>${esc(libelle)}</span>
    <select class="${FILTRE[cle] ? 'actif' : ''}" onchange="A.setFiltre('${cle}', this.value, this)">${optionsHtml}</select></label>`;
}

function optionsEtape() {
  const es = etapesConnues();
  const v = FILTRE.etape;
  return optSel(v, [['', 'Toutes les étapes']])
    + `<optgroup label="Là où en est le dossier">`
    + optSel(v, es.map((e) => ['cours:' + e.code, 'En attente : ' + e.nom])
        .concat([['cours:__complet', 'Dossier complet'], ['cours:__aucune', 'Aucune étape suivie']]))
    + `</optgroup><optgroup label="Étape déjà franchie">`
    + optSel(v, es.map((e) => ['faite:' + e.code, e.nom + ' — faite']))
    + `</optgroup><optgroup label="Étape pas encore franchie">`
    + optSel(v, es.map((e) => ['manque:' + e.code, e.nom + ' — pas encore']))
    + `</optgroup>`;
}

/* Ce qui CACHE des fiches (les filtres) est réuni dans un panneau à part.
   Ce qui ne fait que RANGER (tri, regroupement) reste sous la liste. */
function barreFiltres() {
  return `<div class="filtres">
    ${champFiltre('etape', 'Étape du dossier', optionsEtape(), true)}
    ${champFiltre('delaiAor', "Délai depuis l'AOR", optSel(FILTRE.delaiAor, [
      ['', 'Peu importe'], ['0', 'Moins de 3 mois'], ['90', 'De 3 à 6 mois'],
      ['180', 'De 6 à 12 mois'], ['365', 'Plus de 12 mois'], ['sans', 'AOR non renseigné']]))}
    ${estAdmin() ? champFiltre('paiement', 'Paiement', optSel(FILTRE.paiement, [
      ['', 'Peu importe'], ['retard', 'Échéance en retard'], ['reste', 'Reste à payer'],
      ['solde', 'Entièrement soldé'], ['aucun', 'Aucun échéancier']])) : ''}
    ${champFiltre('crs', 'Score CRS', optSel(FILTRE.crs, [
      ['', 'Peu importe'], ['500', '500 et plus'], ['470', 'De 470 à 499'],
      ['450', 'De 450 à 469'], ['bas', 'Moins de 450'], ['sans', 'Non renseigné']]))}
    ${champFiltre('anniv', 'Anniversaire', optSel(FILTRE.anniv, [
      ['', 'Peu importe'], ['5', 'Dans 5 jours ou moins'], ['30', 'Dans le mois']]))}
  </div>`;
}

/* Nombre de fiches affichées + bouton d'effacement : les deux seules parties
   qui changent à chaque frappe. Tout le reste de la barre est laissé intact. */
function compteFiltres() {
  const n = clientsFiltres().length;
  const total = db.clients.filter((c) => !!c.archive === showArchived).length;
  const s = n > 1 ? 's' : '';
  return `${n} fiche${s} affichée${s}${n !== total ? ` <span class="sur">sur ${total}</span>` : ''}`;
}

function boutonEffacer() {
  const q = search.trim();
  if (!q && !filtreActif()) return '';
  const quoi = q && filtreActif() ? 'la recherche et les filtres' : q ? 'la recherche' : 'les filtres';
  return `<button class="lien-effacer" onclick="A.resetFiltres()"><span class="croix">×</span> Effacer ${quoi}</button>`;
}

function barreAffichage() {
  let tri = db.settings.triClients || 'nom';
  if (!estAdmin() && tri === 'reste') tri = 'nom';
  const ordres = [
    ['nom', 'Nom (A → Z)'], ['nom-desc', 'Nom (Z → A)'],
    ['etape-plus', "Avancement — les plus avancés d'abord"], ['etape-moins', "Avancement — les moins avancés d'abord"],
    ['aor', "Délai depuis l'AOR — le plus long d'abord"], ['crs', 'Score CRS — du plus élevé'],
    ['anniv', 'Anniversaire — le plus proche'],
    ...(estAdmin() ? [['reste', 'Reste à payer — du plus élevé']] : []),
    ['recent', 'Ajout récent'], ['maj', 'Modification récente']];
  return `<div class="filtres-pied">
    <span class="compte" id="filtres-compte">${compteFiltres()}</span>
    <span id="filtres-effacer">${boutonEffacer()}</span>
    <span class="pied-spacer"></span>
    <label class="tri-inline"><span>Trier par</span>
      <select onchange="A.setTri(this.value)">${optSel(tri, ordres)}</select></label>
    <label class="chk-inline"><input type="checkbox" ${db.settings.groupeEtape ? 'checked' : ''} onchange="A.setGroupe(this.checked)"> Grouper par étape</label>
  </div>`;
}

/* Rafraîchit la liste et le compteur SANS toucher au reste de l'écran :
   la recherche en cours de frappe et les menus déroulants gardent le focus. */
function majListeClients() {
  const tb = $('#clients-tbody'); if (tb) tb.innerHTML = clientRows();
  const cpt = $('#filtres-compte'); if (cpt) cpt.innerHTML = compteFiltres();
  const eff = $('#filtres-effacer'); if (eff) eff.innerHTML = boutonEffacer();
}

/* ---------- Doublons possibles ----------
   Deux fiches pour la même personne finissent toujours par arriver : deux postes
   qui se synchronisent, une fiche recopiée sur une autre pour aller plus vite.
   On ne fusionne RIEN et on ne supprime RIEN : on signale, vous tranchez.

   Le téléphone n'est VOLONTAIREMENT pas un critère : un couple partage souvent
   le même numéro, et une alerte qui se trompe toutes les semaines finit par ne
   plus être lue. Ne sont retenus que des identifiants propres à une personne. */
function doublonsPossibles() {
  const net = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const netNom = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  const groupes = new Map();
  const ajouter = (cle, raison, c) => {
    if (!groupes.has(cle)) groupes.set(cle, { raison, fiches: [] });
    groupes.get(cle).fiches.push(c);
  };

  db.clients.forEach((c) => {          // actifs ET archivés : un doublon reste un doublon
    const p = net(c.numPasseport); if (p.length >= 5) ajouter('passeport:' + p, 'même numéro de passeport', c);
    const niu = net(c.niu);        if (niu.length >= 5) ajouter('niu:' + niu, 'même NIU', c);
    const u = net(c.iuc);          if (u.length >= 5) ajouter('iuc:' + u, 'même IUC', c);
    const d = net(c.numDemande);   if (d.length >= 5) ajouter('demande:' + d, 'même n° de demande', c);
    const nom = netNom(c.nom), prenom = netNom(c.prenom);
    if (nom.length >= 2 && prenom.length >= 2) ajouter('nom:' + nom + '|' + prenom, 'même nom et prénom', c);
    if (nom.length >= 2 && c.dateNaissance) ajouter('nomdn:' + nom + '|' + c.dateNaissance, 'même nom et même date de naissance', c);
  });

  /* Une même paire déclenche souvent plusieurs critères à la fois (IUC + nom +
     date de naissance). On regroupe donc par ENSEMBLE DE FICHES, et on cumule
     les raisons : une seule ligne, avec tout ce qui coïncide. */
  const paires = new Map();
  for (const g of groupes.values()) {
    const ids = [...new Set(g.fiches.map((c) => c.id))].sort();
    if (ids.length < 2) continue;
    const cle = ids.join('+');
    if (!paires.has(cle)) paires.set(cle, { cle, fiches: ids.map((i) => getClient(i)).filter(Boolean), raisons: [] });
    if (!paires.get(cle).raisons.includes(g.raison)) paires.get(cle).raisons.push(g.raison);
  }
  const ignores = db.settings.doublonsIgnores || [];
  return [...paires.values()].filter((p) => p.fiches.length >= 2 && !ignores.includes(p.cle));
}

function bandeauDoublons() {
  const paires = doublonsPossibles();
  const ecartes = (db.settings.doublonsIgnores || []).length;
  // rien à signaler, mais des rapprochements écartés : on garde le moyen de revenir
  if (!paires.length) {
    return ecartes ? `<p class="help-text" style="margin:-8px 0 14px">
      ${plur(ecartes, 'rapprochement écarté', 'rapprochements écartés')} par vous.
      <button class="lien-effacer" data-agir="doublons-reafficher"><span class="croix">↺</span> Les réafficher</button></p>` : '';
  }
  return `<div class="card doublons">
    <h2>${ico('identite')} Doublon${paires.length > 1 ? 's' : ''} possible${paires.length > 1 ? 's' : ''} <span class="hint">${paires.length} à vérifier</span></h2>
    <p class="help-text" style="margin-top:0">Ces fiches partagent une information qui n'appartient normalement qu'à une seule personne. <b>Rien n'a été modifié</b> : à vous de dire s'il s'agit de la même personne, d'une recopie malheureuse, ou de deux dossiers bien distincts.</p>
    ${ecartes ? `<p class="help-text" style="margin-top:0">${plur(ecartes, 'rapprochement écarté', 'rapprochements écartés')} par vous.
      <button class="lien-effacer" data-agir="doublons-reafficher"><span class="croix">↺</span> Les réafficher</button></p>` : ''}
    ${paires.map((p) => `<div class="doublon-ligne">
      <div class="doublon-fiches">
        ${p.fiches.map((c) => `<button class="btn btn-ghost btn-small" data-agir="ouvrir" data-id="${esc(c.id)}">${esc(fullName(c))}${c.archive ? ' (archivée)' : ''}</button>`).join('<span class="doublon-vs">et</span>')}
      </div>
      <div class="doublon-raisons">${p.raisons.map((r) => `<span class="chip amber">${esc(r)}</span>`).join(' ')}</div>
      <button class="lien-effacer" data-agir="doublon-ignorer" data-cle="${esc(p.cle)}"><span class="croix">×</span> Ce ne sont pas des doublons</button>
    </div>`).join('')}
  </div>`;
}

/* ---------- Corbeille ---------- */

function vCorbeille() {
  const items = (db.corbeille || []).slice().sort((a, b) => String(b.supprimeeLe).localeCompare(String(a.supprimeeLe)));
  const t = Date.now();
  return `
    <p class="help-text" style="margin-top:0">Une fiche supprimée attend ici ${JOURS_CORBEILLE} jours avant d'être effacée pour de bon. La remettre restaure <b>tout</b> : informations, étapes, champs personnalisés et finances.</p>
    ${items.length ? `<table>
      <thead><tr><th>Fiche</th><th>Supprimée le</th><th>Effacement définitif</th><th style="width:210px"></th></tr></thead>
      <tbody>${items.map((x) => {
        const d = Date.parse(x.supprimeeLe);
        // décompte de minuit à minuit : « dans 12 j » reste « dans 12 j » toute
        // la journée, et passe à 11 au coup de minuit
        const ecoules = joursDeMinuit(d, t);
        const reste = ecoules === null ? null : JOURS_CORBEILLE - ecoules;
        return `<tr>
          <td><b>${esc(fullName(x.fiche))}</b>${x.fiche.iuc ? `<br><span class="muted">IUC ${esc(x.fiche.iuc)}</span>` : ''}</td>
          <td>${isNaN(d) ? '<span class="muted">date inconnue</span>' : new Date(d).toLocaleString('fr-FR')}</td>
          <td>${reste === null ? '<span class="muted">conservée</span>'
            : `<span class="chip ${reste <= 5 ? 'amber' : ''}">dans ${reste} j</span>`}</td>
          <td style="text-align:right">
            <button class="btn btn-primary btn-small" data-agir="corbeille-remettre" data-id="${esc(x.fiche.id)}">Remettre</button>
            <button class="btn btn-danger btn-small" data-agir="corbeille-effacer" data-id="${esc(x.fiche.id)}">Effacer</button>
          </td>
        </tr>`;
      }).join('')}</tbody></table>`
    : `<div class="empty">${ico('corbeille','ico big')}La corbeille est vide.</div>`}`;
}

function vClients() {
  const nbActifs = db.clients.filter((c) => !c.archive).length;
  const nbArchives = db.clients.length - nbActifs;
  const nbCorbeille = (db.corbeille || []).length;
  return `
  <div class="page-head"><h1>Clients</h1><span class="spacer"></span>
    <button class="btn btn-ghost" onclick="A.exportCsv()">${ico('sauvegarde','ico ico-sm')} Export CSV</button>
    <button class="btn btn-primary" onclick="A.newClient()">+ Nouveau client</button>
  </div>
  ${bandeauDoublons()}
  <div class="card">
    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
      <div class="field search-box" style="margin-bottom:8px;flex:1;min-width:240px"><input type="text" id="clients-search" placeholder="Rechercher (nom, IUC, n° demande, passeport, téléphone…)" value="${esc(search)}"></div>
      <div class="tabs" style="margin:0 0 8px;border-bottom:none">
        <button class="tab-btn ${!showCorbeille && !showArchived ? 'active' : ''}" onclick="A.setArchived(false)">Actifs (${nbActifs})</button>
        <button class="tab-btn ${!showCorbeille && showArchived ? 'active' : ''}" onclick="A.setArchived(true)">Archivés (${nbArchives})</button>
        ${estAdmin() ? `<button class="tab-btn ${showCorbeille ? 'active' : ''}" onclick="A.setCorbeille()">Corbeille (${nbCorbeille})</button>` : ''}
      </div>
    </div>
    ${showCorbeille ? vCorbeille()
      : barreFiltres() + barreAffichage() + `<div class="client-list" id="clients-tbody">${clientRows()}</div>`}
  </div>`;
}

/* ---------- Fiche client ---------- */

function fieldInput(c, k, type, placeholder, rows) {
  const v = c[k] ?? '';
  if (type === 'textarea') return `<textarea data-field="${k}" rows="${rows || 3}" placeholder="${esc(placeholder || '')}">${esc(v)}</textarea>`;
  return `<input type="${type}" data-field="${k}" value="${esc(v)}" placeholder="${esc(placeholder || '')}">`;
}

/* ancienneté depuis une date : « 2 ans et 3 mois » */
function dureeDepuis(iso) {
  const d = parseISO(iso); if (!d) return null;
  const t = todayMid();
  if (d > t) return null;
  let mois = (t.getFullYear() - d.getFullYear()) * 12 + (t.getMonth() - d.getMonth());
  if (t.getDate() < d.getDate()) mois--;
  const ans = Math.floor(mois / 12); mois = mois % 12;
  if (ans === 0 && mois === 0) return 'moins d\'un mois';
  const p = [];
  if (ans) p.push(ans + ' an' + (ans > 1 ? 's' : ''));
  if (mois) p.push(mois + ' mois');
  return p.join(' et ');
}

function vClient() {
  const c = getClient(curId);
  if (!c) { view = 'clients'; return vClients(); }
  const age = ageOf(c.dateNaissance);
  const dAOR = daysSince(dateAorDe(c));
  // en mode assistant(e) l'onglet Finances n'existe pas — et si le réglage était
  // resté sur cet onglet (changement de mode en cours de route), on revient aux infos
  if (!estAdmin() && curTab === 'finance') curTab = 'infos';
  const tabs = [['infos', 'Informations'], ['custom', 'Champs personnalisés'],
    ...(estAdmin() ? [['finance', 'Finances']] : []), ['tools', 'Outils']];
  return `
  <button class="btn btn-ghost btn-small" style="margin-bottom:12px" onclick="A.goto('clients')">${ico('fleche', 'ico ico-sm')} Retour aux clients</button>
  <div class="client-head">
    <div class="page-head" style="margin-bottom:0">
      <div class="name">${esc(fullName(c))}</div><span class="spacer"></span>
      <button class="btn btn-ghost btn-small" onclick="A.exportPdf()">${ico('imprimante','ico ico-sm')} Exporter en PDF</button>
      <button class="btn btn-ghost btn-small" data-agir="archiver" data-id="${esc(c.id)}">${ico('archive','ico ico-sm')} ${c.archive ? 'Désarchiver' : 'Archiver'}</button>
      ${/* Supprimer une fiche est le seul geste sans retour : réservé à
            l'administrateur. L'assistant(e) archive, ce qui range sans détruire. */
        estAdmin() ? `<button class="btn btn-danger btn-small" data-agir="supprimer" data-id="${esc(c.id)}">${ico('corbeille','ico ico-sm')} Supprimer la fiche</button>` : ''}
    </div>
    <div class="client-chips">
      ${c.archive ? `<span class="chip amber">${ico('archive', 'ico ico-sm')} Fiche archivée</span>` : ''}
      ${chipSoumission(c)}
      ${age !== null ? `<span class="chip">${age} ans</span>` : ''}
      ${chipBirthday(c)}
      ${dAOR !== null ? `<span class="chip">AOR reçu il y a ${dAOR} j</span>` : ''}
      ${c.scoreCrs ? `<span class="chip teal">CRS ${esc(c.scoreCrs)}</span>` : ''}
      ${estAdmin() ? (() => { const f = finTotals(c); return `<span class="chip ${f.benefice >= 0 ? 'teal' : 'red'}">Bénéfice : ${fmt(f.benefice)} F</span>`; })() : ''}
    </div>
  </div>
  ${friseHtml(c)}
  <div class="tabs">${tabs.map(([k, l]) => `<button class="tab-btn ${curTab === k ? 'active' : ''}" onclick="A.setTab('${k}')">${l}</button>`).join('')}</div>
  ${curTab === 'infos' ? vTabInfos(c) : curTab === 'custom' ? vTabCustom(c) : curTab === 'finance' ? vTabFinance(c) : vTabTools(c)}`;
}

function vTabInfos(c) {
  const j = daysToBirthday(c.dateNaissance);
  const age = ageOf(c.dateNaissance);
  const dAOR = daysSince(dateAorDe(c));
  const birthNote = c.dateNaissance
    ? `<div class="computed ${j <= 5 ? 'alarm' : j <= 30 ? 'warn' : ''}">${age} ans — anniversaire ${j === 0 ? "AUJOURD'HUI" : 'dans ' + j + ' jour' + (j > 1 ? 's' : '')}</div>` : '';
  return `
  <div class="cards-row infos-grid">
    <div class="card-stack">
    <div class="card">
      <h2>${ico('identite')} Identité &amp; naissance</h2>
      <div class="grid-2">
        <div class="field"><label>Prénom(s)</label>${fieldInput(c, 'prenom', 'text')}</div>
        <div class="field"><label>Nom(s)</label>${fieldInput(c, 'nom', 'text')}</div>
      </div>
      <div class="field"><label>Date de naissance</label>${fieldInput(c, 'dateNaissance', 'date')}${birthNote}</div>
      <div class="grid-2">
        <div class="field"><label>Pays de naissance</label>${fieldInput(c, 'paysNaissance', 'text')}</div>
        <div class="field"><label>Ville de naissance</label>${fieldInput(c, 'villeNaissance', 'text')}</div>
      </div>
      <div class="grid-2">
        <div class="field"><label>Téléphone</label>${fieldInput(c, 'telephone', 'tel')}</div>
        <div class="field"><label>N° de passeport</label>${fieldInput(c, 'numPasseport', 'text')}</div>
      </div>
      <div class="grid-2">
        <div class="field"><label>Statut matrimonial</label>
          <select data-field="statutMatrimonial">${STATUTS_MATRIMONIAUX.map((s) => `<option value="${esc(s)}" ${(c.statutMatrimonial || '') === s ? 'selected' : ''}>${s || '—'}</option>`).join('')}</select>
        </div>
        <div class="field"><label>NIU</label>${fieldInput(c, 'niu', 'text')}</div>
      </div>
    </div>
    <div class="card">
      <h2>${ico('notes')} Notes</h2>
      <textarea data-field="notes" rows="8" placeholder="Notes libres sur le dossier…">${esc(c.notes)}</textarea>
    </div>
    </div>
    <div class="card-stack">
    <div class="card">
      <h2>${ico('dossier')} Dossier IRCC</h2>
      <div class="grid-2">
        <div class="field"><label>IUC</label>${fieldInput(c, 'iuc', 'text')}</div>
        <div class="field"><label>N° de demande</label>${fieldInput(c, 'numDemande', 'text')}</div>
      </div>
      <div class="grid-2">
        <div class="field"><label>CNP (profession)</label>${fieldInput(c, 'cnp', 'text')}</div>
        <div class="field"><label>Score CRS</label>${fieldInput(c, 'scoreCrs', 'number')}</div>
      </div>
      <div class="field"><label>Résidence IRCC</label>${fieldInput(c, 'residenceIrcc', 'text')}</div>
      <div class="field"><label>Mail IRCC</label>${fieldInput(c, 'mailIrcc', 'email')}</div>
      <div class="field"><label>Accès personnels</label>${fieldInput(c, 'accesPersonnels', 'textarea', 'Accès du client (portail IRCC, courriel, questions de sécurité…)', 6)}</div>
    </div>
    </div>
    <div class="card-stack">
    <div class="card">
      <h2>${ico('etudes')} Études &amp; emploi (IRCC)</h2>
      <div class="field"><label>Diplômes IRCC</label>${fieldInput(c, 'diplomesIrcc', 'textarea', 'Diplômes déclarés à IRCC (un par ligne)')}</div>
      <div class="field"><label>Domaines d'études</label>${fieldInput(c, 'domainesEtudes', 'text')}</div>
      <div class="grid-2">
        <div class="field"><label>Employeur IRCC</label>${fieldInput(c, 'employeurIrcc', 'text')}</div>
        <div class="field"><label>Poste occupé</label>${fieldInput(c, 'posteIrcc', 'text')}</div>
      </div>
      <div class="field"><label>Début d'emploi</label>${fieldInput(c, 'debutEmploi', 'date')}${dureeDepuis(c.debutEmploi) ? `<div class="computed">en poste depuis ${dureeDepuis(c.debutEmploi)}</div>` : ''}</div>
      <div class="field"><label>Tâches IRCC</label>${fieldInput(c, 'tachesIrcc', 'textarea', 'Tâches principales déclarées (une par ligne)', 6)}</div>
    </div>
    </div>
  </div>`;
}

/* Champs personnalisés */

const CF_TYPES = [['short', 'Réponse courte'], ['long', 'Réponse longue'], ['number', 'Nombre'], ['date', 'Date'], ['check', 'Case à cocher']];
const CF_TYPE_DEFAUT = 'date';   // le plus fréquent dans les dossiers IRCC (demande utilisateur)

/* statuts matrimoniaux reconnus par IRCC */
const STATUTS_MATRIMONIAUX = ['', 'Célibataire', 'Marié(e)', 'Conjoint(e) de fait', 'Séparé(e)', 'Divorcé(e)', 'Veuf(ve)', 'Mariage annulé'];

function cfValueInput(f) {
  if (f.type === 'long') return `<textarea rows="2" data-cfid="${f.id}" data-cfprop="value">${esc(f.value)}</textarea>`;
  if (f.type === 'check') return `<label style="display:flex;align-items:center;gap:8px;padding-top:8px"><input type="checkbox" style="width:18px;height:18px" data-cfid="${f.id}" data-cfprop="value" ${f.value ? 'checked' : ''}> <span class="muted">${f.value ? 'Oui' : 'Non'}</span></label>`;
  const t = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
  return `<input type="${t}" data-cfid="${f.id}" data-cfprop="value" value="${esc(f.value)}">`;
}

/* Numéro au format international sans « + » (un 6xxxxxxxx camerounais reçoit l'indicatif 237) */
function telWhatsapp(tel) {
  const n = String(tel || '').replace(/\D/g, '').replace(/^0+/, '');   // le 0 de tête n'existe pas à l'international
  if (!n) return '';
  return (n.length === 9 && n.startsWith('6')) ? '237' + n : n;        // 6xxxxxxxx = Cameroun
}

/* Image partageable de la SEULE rubrique « Champs personnalisés » */
function buildChampsImage(c) {
  const lignes = (c.custom || []).map((f) => {
    const val = f.type === 'check' ? (f.value ? 'Oui' : 'Non') : f.type === 'date' ? frDate(f.value) : String(f.value ?? '');
    const j = f.type === 'date' ? joursDepuisAor(c, f.value) : null;
    const delai = j === null ? '' : j === 0 ? "le jour de l'AOR" : j > 0 ? `J+${j} après l'AOR` : `J−${-j} avant l'AOR`;
    return `<tr><td class="lbl">${esc(f.label)}</td><td class="val">${esc(val) || '<span class="vide">—</span>'}</td><td class="del">${esc(delai)}</td></tr>`;
  }).join('');
  const genLe = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:"Segoe UI",system-ui,sans-serif; background:#F4F7FB; padding:26px 30px; color:#1B2733; width:900px; }
    .carte { background:#fff; border-radius:16px; padding:24px 28px; box-shadow:0 2px 10px rgba(12,68,124,.10); }
    .tete { display:flex; align-items:center; gap:14px; border-bottom:3px solid #1E3F76; padding-bottom:12px; margin-bottom:16px; }
    .tete img { width:44px; height:44px; }
    .sur { font-size:10.5px; letter-spacing:2px; text-transform:uppercase; color:#1E3F76; font-weight:700; }
    .tete h1 { font-size:22px; color:#1E3F76; }
    table { width:100%; border-collapse:collapse; font-size:15px; }
    td { padding:9px 6px; border-bottom:1px solid #EDF2F8; vertical-align:top; }
    tr:last-child td { border-bottom:none; }
    .lbl { color:#5B6B7B; width:38%; padding-right:14px; overflow-wrap:anywhere; }
    .val { font-weight:700; overflow-wrap:anywhere; padding-right:14px; }
    .del { text-align:right; color:#0F6E56; font-size:13px; font-weight:600; white-space:nowrap; }
    .vide { color:#B7C4D2; font-weight:400; }
    .pied { margin-top:14px; font-size:11px; color:#8A99A8; text-align:center; }
  </style></head><body><div class="carte">
    <div class="tete">${LOGO_DATA ? `<img src="${LOGO_DATA}" alt="">` : ''}
      <div><div class="sur">Suivi du dossier</div><h1>${esc(fullName(c))}</h1></div></div>
    <table>${lignes || '<tr><td class="lbl">Aucun champ personnalisé</td><td></td><td></td></tr>'}</table>
    <div class="pied">Immigration Voyages · situation au ${genLe}</div>
  </div></body></html>`;
}

function vTabCustom(c) {
  return `
  <div class="card">
    <h2>${ico('champs')} Champs personnalisés <span class="hint">ajoutez vos propres intitulés, comme dans un formulaire Google</span>
      <span class="spacer" style="flex:1"></span>
      <button class="btn btn-ghost btn-small" onclick="A.partagerChampsImage()">${ico('partager','ico ico-sm')} Partager</button>
    </h2>
    ${c.custom.length ? c.custom.map((f, i) => `
      <div class="cf-row" data-cfrow="${i}" ondragover="A.cfDragOver(event,${i})" ondragleave="A.cfDragLeave(event)" ondrop="A.cfDrop(event,${i})">
        <span class="cf-poignee" draggable="true" title="Glisser pour déplacer ce champ"
              ondragstart="A.cfDragStart(event,${i})" ondragend="A.cfDragEnd(event)">⠿</span>
        <div><label class="muted" style="font-size:11px">Intitulé</label><input type="text" data-cfid="${f.id}" data-cfprop="label" value="${esc(f.label)}"></div>
        <div><label class="muted" style="font-size:11px">Type</label><select data-cfid="${f.id}" data-cfprop="type">${CF_TYPES.map(([v, l]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label class="muted" style="font-size:11px">Valeur</label>${cfValueInput(f)}${f.type === 'date' ? noteAor(c, f.value) : ''}</div>
        <div>${f.type === 'date' ? `<label class="cf-frise" title="Afficher cette étape dans la frise du dossier">
          <input type="checkbox" data-cfid="${f.id}" data-cfprop="frise" ${f.frise ? 'checked' : ''}> Frise</label>` : ''}</div>
        <button class="btn-x" title="Supprimer ce champ" data-agir="champ-supprimer" data-id="${esc(f.id)}" style="margin-top:18px;background:none;border:none;color:#B7C4D2;font-size:16px;cursor:pointer">✕</button>
      </div>`).join('') : `<div class="empty">${ico('champs','ico big')}Aucun champ personnalisé sur cette fiche.</div>`}
    <div class="cf-add">
      <input type="text" id="cf-new-label" placeholder="Intitulé du nouveau champ (ex. : N° de passeport)">
      <select id="cf-new-type">${CF_TYPES.map(([v, l]) => `<option value="${v}" ${v === CF_TYPE_DEFAUT ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn btn-primary" onclick="A.addCustom()">+ Ajouter</button>
    </div>
    <p class="help-text">Cochez <b>Frise</b> sur un champ de type date pour qu'il apparaisse dans la chronologie en haut de la fiche — les six étapes du dossier le sont déjà. Pour changer l'ordre, saisissez la poignée <b>⠿</b> à gauche d'un champ et glissez-la où vous voulez (comme les désignations dans IV Devis). Astuce : dans <b>Paramètres → Modèle de champs</b>, vous pouvez définir des champs qui seront ajoutés automatiquement à chaque nouveau client.</p>
  </div>`;
}

/* Finances */

/* Nombre de jours entre l'AOR et une autre date de la fiche (VMF, biométrie, tranches…) */
function joursDepuisAor(c, iso) {
  const aorIso = dateAorDe(c);
  if (!c || !aorIso || !iso) return null;
  const aor = parseISO(aorIso), d = parseISO(iso);
  if (!aor || !d || isNaN(aor) || isNaN(d)) return null;
  return Math.round((d - aor) / 86400000);
}

function noteAor(c, iso) {
  const j = joursDepuisAor(c, iso);
  if (j === null) return '';
  const txt = j === 0 ? "le jour de l'AOR" : j > 0 ? `J+${j} après l'AOR` : `J−${-j} avant l'AOR`;
  return `<div class="computed" style="font-weight:500">${txt}</div>`;
}

/* poignée de déplacement pour une ligne de finances (même principe que les champs personnalisés) */
function finPoignee(liste, i) {
  return `<td style="width:22px;padding-right:0">
    <span class="fin-poignee" draggable="true" title="Glisser pour déplacer cette ligne"
          ondragstart="A.finDragStart(event,'${liste}',${i})" ondragend="A.finDragEnd(event)">⠿</span></td>`;
}
const finRowAttrs = (liste, i) => `ondragover="A.finDragOver(event,'${liste}',${i})" ondragleave="A.finDragLeave(event)" ondrop="A.finDrop(event,'${liste}',${i})"`;

function moneyInput(attrs, val) {
  return `<input type="text" inputmode="numeric" class="table-input" data-money ${attrs} value="${val ? fmt(val) : ''}" placeholder="0">`;
}

function vTabFinance(c) {
  const f = finTotals(c);
  const t = todayMid();
  const reg = reglementEcheancier(c);
  return `
  <div class="fin-summary">
    <div class="stat teal"><div class="label">Total versé par le client</div><div class="value">${fmt(f.verse)}</div><div class="sub">FCFA</div></div>
    <div class="stat amber"><div class="label">Dépenses effectuées</div><div class="value">${fmt(f.depenses)}</div><div class="sub">FCFA</div></div>
    <div class="stat ${f.benefice >= 0 ? 'teal' : 'red'}"><div class="label">Bénéfice</div><div class="value">${fmt(f.benefice)}</div><div class="sub">versements − dépenses</div></div>
    <div class="stat"><div class="label">Échéancier : reste à payer</div><div class="value">${fmt(f.echRestant)}</div><div class="sub">${fmt(f.echPaye)} réglés sur ${fmt(f.echTotal)} prévus</div></div>
  </div>
  <div class="card">
    <h2>${ico('calendrier')} Échéancier de paiement <span class="hint">les versements enregistrés règlent les tranches dans l'ordre</span></h2>
    ${c.finance.echeancier.length ? `<table>
      <thead><tr><th></th><th style="width:28%">Libellé</th><th>Date prévue</th><th class="num">Montant (FCFA)</th><th style="width:190px">Règlement</th><th></th></tr></thead>
      <tbody>${reg.lignes.map((l, i) => {
        const e = l.e;
        const late = l.statut !== 'paye' && dateDepassee(e.date, t);
        const etat = l.statut === 'paye'
          ? `<span class="chip teal">✓ réglé${e.paye && frDate(e.datePaiement) ? ' le ' + frDate(e.datePaiement) : ''}</span>`
          : l.statut === 'partiel'
            ? `<span class="chip amber">Partiel : ${fmt(l.regle)} F</span><div class="computed warn">reste ${fmt(l.solde)} F</div>`
            : `<span class="chip">À payer</span>`;
        return `<tr ${finRowAttrs('echeancier', i)}>
        ${finPoignee('echeancier', i)}
        <td><input type="text" class="table-input" data-fin="echeancier" data-idx="${i}" data-prop="label" value="${esc(e.label)}" placeholder="Ex. : Ouverture du dossier"></td>
        <td><input type="date" class="table-input" data-fin="echeancier" data-idx="${i}" data-prop="date" value="${esc(e.date)}">${late ? '<div class="computed alarm">En retard</div>' : ''}</td>
        <td class="num">${moneyInput(`data-fin="echeancier" data-idx="${i}" data-prop="montant"`, e.montant)}</td>
        <td>${etat}</td>
        <td><button class="btn-x" aria-label="Supprimer cette ligne" title="Supprimer" onclick="A.delFin('echeancier',${i})">✕</button></td>
      </tr>`;
      }).join('')}
      <tr class="tfoot-line"><td></td><td>Total</td><td></td><td class="num">${fmt(f.echTotal)} F</td><td colspan="2">réglé : ${fmt(f.echPaye)} F${f.echRestant ? ` · reste ${fmt(f.echRestant)} F` : ''}</td></tr>
      </tbody></table>` : `<div class="empty">Aucune étape de paiement définie.</div>`}
    <button class="btn btn-ghost btn-small" style="margin-top:10px" onclick="A.addFin('echeancier')">+ Ajouter une étape</button>
  </div>
  <div class="cards-row">
    <div class="card">
      <h2>${ico('versement')} Versements du client <span class="hint">ce qu'il vous a réellement payé</span></h2>
      ${c.finance.versements.length ? `<table>
        <thead><tr><th></th><th>Date</th><th class="num">Montant (FCFA)</th><th>Note</th><th></th></tr></thead>
        <tbody>${c.finance.versements.map((v, i) => `<tr ${finRowAttrs('versements', i)}>
          ${finPoignee('versements', i)}
          <td><input type="date" class="table-input" data-fin="versements" data-idx="${i}" data-prop="date" value="${esc(v.date)}"></td>
          <td class="num">${moneyInput(`data-fin="versements" data-idx="${i}" data-prop="montant"`, v.montant)}</td>
          <td><input type="text" class="table-input" data-fin="versements" data-idx="${i}" data-prop="note" value="${esc(v.note)}" placeholder="Ex. : acompte"></td>
          <td><button class="btn-x" aria-label="Supprimer cette ligne" title="Supprimer" onclick="A.delFin('versements',${i})">✕</button></td>
        </tr>`).join('')}
        <tr class="tfoot-line"><td></td><td>Total versé</td><td class="num">${fmt(f.verse)} F</td><td colspan="2"></td></tr>
        </tbody></table>` : `<div class="empty">Aucun versement enregistré.</div>`}
      <button class="btn btn-ghost btn-small" style="margin-top:10px" onclick="A.addFin('versements')">+ Ajouter un versement</button>
    </div>
    <div class="card">
      <h2>${ico('depense')} Dépenses sur ce client <span class="hint">frais que vous avez engagés</span></h2>
      ${c.finance.depenses.length ? `<table>
        <thead><tr><th></th><th>Date</th><th>Désignation</th><th class="num">Montant (FCFA)</th><th></th></tr></thead>
        <tbody>${c.finance.depenses.map((d, i) => `<tr ${finRowAttrs('depenses', i)}>
          ${finPoignee('depenses', i)}
          <td><input type="date" class="table-input" data-fin="depenses" data-idx="${i}" data-prop="date" value="${esc(d.date)}"></td>
          <td><input type="text" class="table-input" data-fin="depenses" data-idx="${i}" data-prop="designation" value="${esc(d.designation)}" placeholder="Ex. : frais de traitement IRCC"></td>
          <td class="num">${moneyInput(`data-fin="depenses" data-idx="${i}" data-prop="montant"`, d.montant)}</td>
          <td><button class="btn-x" aria-label="Supprimer cette ligne" title="Supprimer" onclick="A.delFin('depenses',${i})">✕</button></td>
        </tr>`).join('')}
        <tr class="tfoot-line"><td></td><td>Total dépenses</td><td></td><td class="num">${fmt(f.depenses)} F</td><td></td></tr>
        </tbody></table>` : `<div class="empty">Aucune dépense enregistrée.</div>`}
      <button class="btn btn-ghost btn-small" style="margin-top:10px" onclick="A.addFin('depenses')">+ Ajouter une dépense</button>
    </div>
  </div>`;
}

/* Outils : convertisseur, paiement IRCC, calculatrice */

function convResultHtml() {
  // le convertisseur donne la VRAIE valeur d'une devise : taux du jour, obtenu
  // par l'euro, et non le taux que votre banque vous applique (qui, lui, sert
  // à calculer ce que vous paierez réellement pour les frais IRCC)
  const t = tauxUtilise(CV.cur);
  const rate = t.fcfa;
  const amt = parseFloat(String(CV.amount).replace(',', '.')) || 0;
  const ligneTaux = `<div class="line muted2"><span>1 ${esc(CV.cur)} = ${fmtCad(rate)} FCFA</span><span>${origineTaux(t)}</span></div>`;
  if (!amt || !rate) return ligneTaux;
  const res = CV.dir === 'to' ? amt * rate : amt / rate;
  return `
    ${ligneTaux}
    <div class="line total"><span>${CV.dir === 'to' ? `${fmtCad(amt)} ${esc(CV.cur)}` : `${fmt(amt)} FCFA`}</span>
    <span>= ${CV.dir === 'to' ? `${fmt(res)} FCFA` : `${fmtCad(res)} ${esc(CV.cur)}`}</span></div>`;
}

/* ---- Calcul des frais IRCC : mémorisé DANS la fiche du client ----
   Exigence utilisateur : le calcul d'un client ne doit jamais apparaître chez un autre.
   Il est donc enregistré dans c.calculIrcc et rechargé à l'ouverture de SA fiche. */

function calculIrccActuel() {
  const s = db.settings;
  const lignes = Object.entries(IR.sel).map(([i, q]) => {
    const fee = s.feeCatalog[i];
    if (!fee) return null;
    const qte = fee.forfait ? 1 : (Number(q) || 0);
    // on garde l'identifiant EN PLUS du libellé : renommer un frais ne doit pas
    // faire disparaître la ligne du calcul enregistré (audit du 23/08/2026)
    return { site: fee.site || '', label: fee.label, amount: Number(fee.amount) || 0, qte, forfait: !!fee.forfait };
  }).filter((l) => l && l.qte > 0);
  if (!lignes.length) return null;
  const totalCad = lignes.reduce((t, l) => t + l.amount * l.qte, 0);
  const taux = Number(s.rates.CAD) || 0;
  const pPct = Number(s.fraisPaiementPct) || 0;
  const cFixe = Number(s.fraisChargeFixe) || 0;
  const debiteCad = totalCad * (1 + pPct / 100);
  return {
    lignes, totalCad, debiteCad, tauxCad: taux, fraisPaiementPct: pPct, fraisChargeFixe: cFixe,
    totalFcfa: Math.round(debiteCad * taux + cFixe), date: new Date().toISOString()
  };
}

function enregistrerCalculIrcc() {
  const c = getClient(curId);
  if (!c) return;
  const calc = calculIrccActuel();
  if (calc) c.calculIrcc = calc; else delete c.calculIrcc;
  touch(c); save();
}

/* Recharge la sélection du client (par libellé : résiste à une réorganisation du catalogue) */
function restaurerCalculIrcc(c) {
  IR.sel = {};
  const calc = c && c.calculIrcc;
  if (!calc || !Array.isArray(calc.lignes)) return;
  const perdues = [];
  calc.lignes.forEach((l) => {
    // d'abord par identifiant (stable), puis par libellé (fiches d'avant 1.25)
    let i = l.site ? db.settings.feeCatalog.findIndex((f) => f.site && f.site === l.site) : -1;
    if (i < 0) i = db.settings.feeCatalog.findIndex((f) => (f.label || '') === l.label);
    if (i >= 0) IR.sel[i] = db.settings.feeCatalog[i].forfait ? 1 : Math.max(1, Number(l.qte) || 1);
    else perdues.push(l.label || 'frais sans nom');
  });
  // une ligne introuvable ne disparaît plus en silence : on la nomme
  calc.lignesPerdues = perdues;
}

function libelleCalculIrcc(lignes) {
  return 'Frais IRCC : ' + lignes.map((l) => l.label + (l.qte > 1 ? ' ×' + l.qte : '')).join(' + ');
}

function irccResultHtml() {
  const s = db.settings;
  const rate = Number(s.rates.CAD) || 0;
  let totalCad = 0;
  Object.entries(IR.sel).forEach(([i, q]) => {
    const fee = s.feeCatalog[i];
    if (fee) totalCad += (Number(fee.amount) || 0) * (fee.forfait ? 1 : (Number(q) || 0));
  });
  const c = getClient(curId);
  const calc = c && c.calculIrcc;
  // une ligne du calcul qui n'existe plus dans le catalogue est NOMMÉE, pas tue
  const perdues = (calc && calc.lignesPerdues && calc.lignesPerdues.length)
    ? `<div class="line" style="color:var(--red);font-weight:600"><span>⚠ Absent du catalogue : ${esc(calc.lignesPerdues.join(', '))}</span><span>non compté</span></div>`
    : '';
  const trace = calc ? `<div class="line muted2"><span>Calcul enregistré le ${new Date(calc.date).toLocaleDateString('fr-FR')} (taux ${fmtCad(calc.tauxCad)})</span><span>${fmt(calc.totalFcfa)} F</span></div>` : '';
  if (!totalCad) return `${perdues}<div class="line muted2"><span>Cochez des frais ci-dessus pour calculer.</span><span></span></div>${trace}`;
  const pPct = Number(s.fraisPaiementPct) || 0;
  const cFixe = Number(s.fraisChargeFixe) || 0;
  const debite = totalCad * (1 + pPct / 100);
  const fcfa = debite * rate;
  const aCharger = fcfa + cFixe;
  // le taux ou les frais ont pu changer depuis l'enregistrement : on le signale au lieu de laisser croire à une erreur
  const ecart = calc && calc.totalFcfa !== Math.round(aCharger);
  /* Le total à prévoir reste calculé au taux de VOTRE banque : c'est elle qui
     vous débite. Mais on affiche à côté ce que donnerait le taux du jour (par
     l'euro) : l'écart entre les deux, c'est exactement la marge de la banque. */
  const tj = tauxJourPour('CAD');
  const comparaison = (tj && rate && Math.abs(tj - rate) / rate > 0.01)
    ? `<div class="line muted2"><span>Au taux du jour (${fmtCad(tj)} F — ${origineTaux({ source: 'bce', date: (s.tauxJour || {}).dateBCE })})</span><span>${fmt(debite * tj + cFixe)} F</span></div>
       <div class="line muted2"><span>Écart avec votre banque</span><span>${rate > tj ? '+' : '−'} ${fmt(Math.abs(debite * (rate - tj)))} F (${fmtCad(Math.abs(rate - tj) / tj * 100)} %)</span></div>`
    : '';
  return `${perdues}
    <div class="line"><span>Frais IRCC sélectionnés</span><span>${fmtCad(totalCad)} $ CAD</span></div>
    ${pPct ? `<div class="line"><span>+ frais au paiement (${pPct} %)</span><span>${fmtCad(debite - totalCad)} $ CAD</span></div>
    <div class="line"><span>Total débité sur la carte</span><span><b>${fmtCad(debite)} $ CAD</b></span></div>` : ''}
    <div class="line"><span>Équivalent FCFA (taux banque ${fmtCad(rate)})</span><span>${fmt(fcfa)} F</span></div>
    ${cFixe ? `<div class="line"><span>+ frais de chargement carte</span><span>${fmt(cFixe)} F</span></div>` : ''}
    <div class="line total"><span>Total FCFA à prévoir</span><span>${fmt(aCharger)} F</span></div>
    ${comparaison}
    ${calc ? `<div class="line muted2"><span>Enregistré le ${new Date(calc.date).toLocaleDateString('fr-FR')}${ecart ? ' — taux ou frais modifiés depuis' : ''}</span><span>${fmt(calc.totalFcfa)} F</span></div>` : ''}`;
}

/* ---- Visite médicale (OIM) : tarif par tranche d'âge, en FCFA ----
   Ces montants ne se convertissent PAS : la visite se paie ici, au guichet, en
   francs. L'OIM révise sa grille chaque mois, d'où le mois affiché partout —
   sans lui, on prendrait un tarif de l'an dernier pour le tarif du jour. */

const medSettings = () => (db.settings.visiteMedicale || { mois: '', tranches: [] });

function moisMedicalLisible(mois) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(mois || ''));
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

/* « d'août 2026 » et non « de août 2026 » : l'élision se voit partout */
function deMois(mois) {
  const m = moisMedicalLisible(mois);
  if (!m) return '';
  return (/^[aeiouyâàéèêîôû]/i.test(m) ? "d'" : 'de ') + m;
}

/* La tranche qui correspond à un âge (max vide = « et plus ») */
function tranchePourAge(age) {
  if (age === null || age === undefined || isNaN(age)) return null;
  return medSettings().tranches.find((t) => {
    const min = Number(t.min) || 0;
    const max = (t.max === null || t.max === undefined || t.max === '') ? Infinity : Number(t.max);
    return age >= min && age <= max;
  }) || null;
}

const bornesTranche = (t) => {
  const min = Number(t.min) || 0;
  return (t.max === null || t.max === undefined || t.max === '') ? `${min} ans et plus` : `${min} à ${Number(t.max)} ans`;
};

function calculMedicalActuel() {
  const lignes = medSettings().tranches
    .map((t) => ({ id: t.id, label: t.label || bornesTranche(t), fcfa: Number(t.fcfa) || 0, qte: Math.max(0, Number(VM.sel[t.id]) || 0) }))
    .filter((l) => l.qte > 0);
  if (!lignes.length) return null;
  return {
    mois: medSettings().mois, lignes,
    total: lignes.reduce((s, l) => s + l.fcfa * l.qte, 0),
    date: new Date().toISOString()
  };
}

function enregistrerCalculMedical() {
  const c = getClient(curId);
  if (!c) return;
  const calc = calculMedicalActuel();
  if (calc) c.calculMedical = calc; else delete c.calculMedical;
  touch(c); save();
}

/* Rappel du calcul de CETTE fiche. Sans calcul enregistré, la tranche du client
   est pré-remplie à partir de sa date de naissance : la donnée est déjà saisie,
   on ne la redemande pas. */
function restaurerCalculMedical(c) {
  VM.sel = {};
  if (!c) return;
  const calc = c.calculMedical;
  if (calc && Array.isArray(calc.lignes) && calc.lignes.length) {
    calc.lignes.forEach((l) => {
      const t = medSettings().tranches.find((x) => x.id === l.id) ||
                medSettings().tranches.find((x) => (x.label || '') === l.label);
      if (t) VM.sel[t.id] = Math.max(1, Number(l.qte) || 1);
    });
    return;
  }
  const t = tranchePourAge(ageOf(c.dateNaissance));
  if (t) VM.sel[t.id] = 1;
}

/* Pose la dépense d'un calcul (frais IRCC, visite médicale) dans la fiche.
   Cliquer deux fois empilait deux lignes identiques et faussait le bénéfice
   sans rien dire (audit du 23/08/2026) : une dépense du même type est
   désormais MISE À JOUR, jamais dupliquée. */
function poserDepenseCalcul(c, famille, designation, montant) {
  const marque = famille === 'Frais IRCC' ? /^Frais IRCC\s*:/ : /^Visite médicale\s*\(/;
  const existante = c.finance.depenses.find((d) => marque.test(d.designation || ''));
  if (existante) {
    const memeMontant = Number(existante.montant) === Number(montant);
    const memeLigne = (existante.designation || '') === designation;
    existante.designation = designation;
    existante.montant = montant;
    existante.date = todayISO();
    toast(memeMontant && memeLigne
      ? `${famille} : cette dépense était déjà là — rien n'a été ajouté en double.`
      : `${famille} : la dépense existante a été mise à jour (${fmt(montant)} F).`);
    return;
  }
  c.finance.depenses.push({ id: uid(), date: todayISO(), designation, montant });
  toast(`Dépense de ${fmt(montant)} F ajoutée aux dépenses de ce client.`);
}

const libelleCalculMedical = (calc) =>
  'Visite médicale (OIM' + (calc.mois ? ' — ' + moisMedicalLisible(calc.mois) : '') + ') : ' +
  calc.lignes.map((l) => l.label + (l.qte > 1 ? ' ×' + l.qte : '')).join(' + ');

function medicalResultHtml() {
  const c = getClient(curId);
  const calc = c && c.calculMedical;
  const actuel = calculMedicalActuel();
  const rappel = calc
    ? `<div class="line muted2"><span>Enregistré le ${new Date(calc.date).toLocaleDateString('fr-FR')}${calc.mois && calc.mois !== medSettings().mois ? ` — barème d'alors : ${moisMedicalLisible(calc.mois)}` : ''}</span><span>${fmt(calc.total)} F</span></div>`
    : '';
  if (!actuel) return `<div class="line muted2"><span>Indiquez le nombre de personnes par tranche.</span><span></span></div>${rappel}`;
  const personnes = actuel.lignes.reduce((s, l) => s + l.qte, 0);
  return actuel.lignes.map((l) =>
      `<div class="line"><span>${esc(l.label)}${l.qte > 1 ? ` × ${l.qte}` : ''}</span><span>${fmt(l.fcfa * l.qte)} F</span></div>`).join('') +
    `<div class="line total"><span>Total à prévoir — ${personnes} personne${personnes > 1 ? 's' : ''}</span><span>${fmt(actuel.total)} F</span></div>` +
    rappel;
}

/* ---- Taux du jour, relevé PAR L'EURO (méthode du site Immigration Voyages) ----
   Le franc CFA n'est pas une monnaie flottante : sa parité avec l'euro est FIXE
   et légale — 1 EUR = 655,957 XAF, ce chiffre ne bouge pas. On ne relève donc
   que la seule chose qui varie vraiment, le cours du dollar canadien en euro,
   et le taux CAD → FCFA se déduit par multiplication. C'est la méthode d'une
   banque, et c'est bien plus sûr qu'un taux XAF trouvé on ne sait où.
   Source : Banque centrale européenne via api.frankfurter.dev (une publication
   par jour ouvré), avec un service de secours. En cas d'échec, RIEN n'est
   inventé : on garde le dernier relevé, ou à défaut votre taux de banque. */

const PARITE_EUR_XAF = 655.957;   // parité fixe, inscrite dans les accords monétaires
// affichée avec ses trois décimales : c'est un chiffre légal, pas un arrondi
const pariteLisible = () => PARITE_EUR_XAF.toLocaleString('fr-FR', { minimumFractionDigits: 3 });

/* Les deux services renvoient la même forme : combien vaut 1 EUR dans chaque
   devise. On en déduit la valeur en francs : 655,957 ÷ (devise par euro).
   ⚠️ api.frankfurter.APP ne convient pas (redirection 301 sans en-tête CORS). */
const SERVICES_TAUX = [
  (codes) => `https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${codes.join(',')}`,
  () => 'https://open.er-api.com/v6/latest/EUR'
];

/* Bornes de vraisemblance : elles n'attrapent qu'une absurdité (1 CAD a oscillé
   entre 380 et 520 F sur la dernière décennie). Un taux aberrant vaut mieux
   non relevé qu'affiché. */
/* Bornes de vraisemblance. Les bornes absolues (50 à 5 000 F) rendaient
   IMPOSSIBLE le relevé de toute devise « faible » ajoutée par l'utilisateur —
   le naira ou le yen valent moins d'un franc — et le tableau affichait
   « non relevé » pour toujours, sans explication (audit du 23/08/2026).
   On juge donc par rapport au taux déjà saisi quand il existe. */
function tauxPlausible(f, manuel) {
  if (!(f > 0) || !isFinite(f)) return false;
  if (manuel > 0) return f / manuel > 0.5 && f / manuel < 2;   // écart de moins du simple au double
  return f < 100000;   // aucun repère : on n'écarte que l'absurde
}

async function releverTauxJour() {
  const codes = Object.keys(db.settings.rates).filter((c) => c !== 'EUR');
  if (!codes.length) return null;
  for (const faireUrl of SERVICES_TAUX) {
    try {
      const r = await fetch(faireUrl(codes), { cache: 'no-store' });
      if (!r.ok) continue;
      const d = await r.json();
      if (!d || !d.rates) continue;
      const taux = {};
      const refuses = [];
      codes.forEach((code) => {
        const parEuro = Number(d.rates[code]);
        if (parEuro > 0) {
          const f = PARITE_EUR_XAF / parEuro;
          if (tauxPlausible(f, Number(db.settings.rates[code]) || 0)) taux[code] = f;
          else refuses.push(code + ' (' + fmtCad(f) + ' F)');
        }
      });
      if (!Object.keys(taux).length) continue;
      const date = d.date || (d.time_last_update_utc ? new Date(d.time_last_update_utc).toISOString().slice(0, 10) : '');
      // un taux écarté n'est plus tu : on dit lequel et pourquoi
      db.settings.tauxRefuses = refuses;
      db.settings.tauxJour = { taux, dateBCE: date, releveLe: new Date().toISOString() };
      save();
      return db.settings.tauxJour;
    } catch (_) { /* on essaie le service suivant */ }
  }
  return null;
}

/* ---- Les barèmes viennent du site ----
   Les frais IRCC, la preuve de fonds et la visite médicale sont publiés dans
   /gestion → Outils du site, et c'est de là que le site public les lit. Les
   relever ici aussi évite qu'un même chiffre existe à deux endroits et finisse
   par ne plus dire la même chose. La lecture est publique : aucune connexion
   n'est nécessaire, et rien de vos clients ne transite. */

const baremeSite = () => (db.settings.baremeSite || (db.settings.baremeSite = { auto: true, luLe: '', echec: '' }));

/* Applique les réglages du site. On ne prend QUE ce qui est exploitable :
   un montant absent ou aberrant laisse la valeur en place au lieu de l'écraser. */
function appliquerBaremeSite(d) {
  const s = db.settings;
  let touche = 0;

  if (Array.isArray(d.ircc)) {
    d.ircc.forEach((f) => {
      const m = Number(f && f.montant);
      // un 0 saisi par erreur dans /gestion remplaçait les 990 $ de traitement
      if (!(m > 0) || m > 20000 || !f.id) return;
      s.feeCatalog.forEach((local) => { if (local.site === f.id) { local.amount = m; touche++; } });
    });
  }

  if (Array.isArray(d.preuveFonds) && d.preuveFonds.length) {
    const paliers = d.preuveFonds
      .filter((p) => p && Number(p.personnes) > 0 && Number(p.montant) >= 0)
      .map((p) => ({ personnes: Number(p.personnes), cad: Number(p.montant) }))
      .sort((a, b) => a.personnes - b.personnes);
    if (paliers.length) { s.preuveFonds.paliers = paliers; touche++; }
  }
  if (Number(d.fondsParPersonneEnPlus) >= 0) { s.preuveFonds.parPersonneEnPlus = Number(d.fondsParPersonneEnPlus); touche++; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(d.majFonds || '')) s.preuveFonds.maj = d.majFonds;

  const v = d.visiteMedicale;
  if (v) {
    if (/^\d{4}-\d{2}$/.test(v.mois || '')) { s.visiteMedicale.mois = v.mois; touche++; }
    s.visiteMedicale.tranches.forEach((tr) => {
      const m = Number(v[tr.id]);
      if (m >= 5000 && m <= 1000000) { tr.fcfa = m; touche++; }   // bornes de vraisemblance
    });
  }
  return touche;
}

/* Photographie des trois barèmes : sert à savoir si le relevé a VRAIMENT changé
   quelque chose, pour ne le dire que dans ce cas. */
function empreinteBaremes() {
  const s = db.settings;
  return JSON.stringify([
    s.feeCatalog.map((f) => [f.site, f.amount]),
    s.preuveFonds.paliers.map((p) => [p.personnes, p.cad]), s.preuveFonds.parPersonneEnPlus, s.preuveFonds.maj,
    s.visiteMedicale.mois, s.visiteMedicale.tranches.map((t) => [t.id, t.fcfa])
  ]);
}

async function releverBaremesDuSite() {
  const b = baremeSite();
  try {
    const r = await fetch(`${SB_URL}/rest/v1/catalog?select=data&key=eq.fraisReglages`, {
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, cache: 'no-store'
    });
    if (!r.ok) throw new Error('le site a répondu ' + r.status);
    const rows = await r.json();
    const d = rows && rows[0] && rows[0].data;
    if (!d) throw new Error('aucun barème publié sur le site');
    const avant = empreinteBaremes();
    const n = appliquerBaremeSite(d);
    if (!n) throw new Error('le barème publié ne contient aucun montant exploitable');
    const change = empreinteBaremes() !== avant;
    b.luLe = new Date().toISOString(); b.echec = '';
    if (change) b.changeLe = b.luLe;   // date du dernier CHANGEMENT, pas de la dernière lecture
    save();
    return { data: d, change };
  } catch (e) {
    // on ne touche à rien : les montants du dernier relevé réussi restent en place
    const brut = e && e.message ? e.message : '';
    // « Failed to fetch » ne veut rien dire pour l'utilisateur : on nomme la cause réelle
    b.echec = /failed to fetch|networkerror|load failed/i.test(brut)
      ? 'site injoignable — vérifiez la connexion internet'
      : brut || 'site injoignable';
    save();
    throw new Error(b.echec);
  }
}

/* Comme pour le taux : au-delà d'une demi-journée, on retourne voir le site */
/* Un barème ne change pas selon un calendrier : il change quand Alex le décide
   dans /gestion. On retourne donc voir le site TOUTES LES HEURES — et de toute
   façon à chaque ouverture de l'application (voir init) : relancer le logiciel
   doit suffire à voir sa modification, c'est le geste que tout le monde fait. */
const baremeSitePerime = () => {
  const b = baremeSite();
  if (!b.auto) return false;
  if (!b.luLe) return true;
  return (Date.now() - new Date(b.luLe).getTime()) > 55 * 60 * 1000;
};

/* Taux du jour d'une devise, ou null s'il n'a pas pu être relevé.
   L'euro n'a jamais besoin d'être relevé : sa parité est fixe. */
function tauxJourPour(code) {
  if (code === 'EUR') return PARITE_EUR_XAF;
  const tj = db.settings.tauxJour;
  const v = tj && tj.taux && Number(tj.taux[code]);
  return v > 0 ? v : null;
}

/* Le taux réellement utilisé pour convertir, et D'OÙ il vient — on ne montre
   jamais un chiffre muet dont on ignorerait la provenance. */
function tauxUtilise(code) {
  const jour = tauxJourPour(code);
  if (jour) {
    const tj = db.settings.tauxJour || {};
    return { fcfa: jour, source: code === 'EUR' ? 'parite' : 'bce', date: tj.dateBCE || '' };
  }
  return { fcfa: Number(db.settings.rates[code]) || 0, source: 'manuel', date: '' };
}

function origineTaux(t) {
  if (t.source === 'parite') return 'parité fixe euro / franc CFA';
  if (t.source === 'bce') return 'taux du jour BCE' + (t.date ? ' du ' + frDate(t.date) : '') + ', via l\'euro';
  return 'taux saisi dans les Paramètres';
}

const tauxJourPerime = () => {
  const tj = db.settings.tauxJour;
  if (!tj || !tj.taux || !tj.releveLe) return true;
  return (Date.now() - new Date(tj.releveLe).getTime()) > 12 * 3600 * 1000;
};

/* ---- Preuve de fonds : combien le client doit MONTRER, selon la taille de sa famille ----
   ⚠️ Ce n'est PAS une dépense : cet argent n'est pas dépensé, il doit être
   disponible et prouvé. C'est pourquoi cette carte n'a aucun bouton
   « Ajouter aux dépenses » — l'y verser fausserait le bénéfice du dossier.
   Montants en $ CAD (contrairement à la visite médicale) : ils sont convertis
   avec VOTRE taux CAD des Paramètres, celui que la banque vous applique. */

const pfSettings = () => (db.settings.preuveFonds || { maj: '', paliers: [], parPersonneEnPlus: 0 });

/* Montant exigé pour n personnes : le palier exact, sinon le dernier palier
   plus le montant par personne supplémentaire. */
function preuveFondsPour(n) {
  const pf = pfSettings();
  const paliers = (pf.paliers || []).slice().sort((a, b) => (Number(a.personnes) || 0) - (Number(b.personnes) || 0));
  if (!paliers.length || !n || n < 1) return null;
  const exact = paliers.find((p) => Number(p.personnes) === n);
  if (exact) return { cad: Number(exact.cad) || 0, extra: 0, base: null };
  // avec une liste à trou, on repart du plus grand palier ATTEINT : sinon le
  // supplément devenait négatif et le montant faux (audit du 23/08/2026)
  const atteints = paliers.filter((p) => Number(p.personnes) <= n);
  const dernier = atteints.length ? atteints[atteints.length - 1] : paliers[paliers.length - 1];
  if (n < Number(paliers[0].personnes)) return { cad: Number(paliers[0].cad) || 0, extra: 0, base: null };
  const enPlus = n - Number(dernier.personnes);
  const parPers = Number(pf.parPersonneEnPlus) || 0;
  return { cad: (Number(dernier.cad) || 0) + enPlus * parPers, extra: enPlus, base: dernier };
}

/* Suggestion tirée du statut matrimonial : marié ou en union de fait, il faut
   compter le conjoint. C'est un RAPPEL, pas une valeur pré-remplie — le champ
   reste vide tant qu'Alex n'a pas saisi le nombre lui-même. */
const personnesParDefaut = (c) => (/mari|conjoint/i.test(c && c.statutMatrimonial || '') ? 2 : 1);

/* Aucun chiffre par défaut (demande d'Alex, 01/09/2026) : on ne rappelle QUE le
   nombre qu'il a saisi et enregistré sur CETTE fiche. Une fiche neuve, ou un
   dossier jamais chiffré, s'ouvre avec le champ vide et sans aucun calcul. */
function restaurerPreuveFonds(c) {
  PF.n = c && c.preuveFonds && Number(c.preuveFonds.personnes) > 0
    ? Number(c.preuveFonds.personnes)
    : '';
}

function enregistrerPreuveFonds() {
  const c = getClient(curId);
  if (!c) return;
  const m = preuveFondsPour(PF.n);
  if (!m) { delete c.preuveFonds; touch(c); save(); return; }
  const t = tauxUtilise('CAD');
  c.preuveFonds = {
    personnes: PF.n, cad: m.cad, taux: t.fcfa, origineTaux: t.source, fcfa: Math.round(m.cad * t.fcfa),
    maj: pfSettings().maj, date: new Date().toISOString()
  };
  touch(c); save();
}

function preuveFondsResultHtml() {
  const m = preuveFondsPour(PF.n);
  if (!m) return `<div class="line muted2"><span>Indiquez le nombre de personnes du dossier.</span><span></span></div>`;
  // valeur de RÉFÉRENCE : c'est le taux du jour qui a un sens ici, pas celui de
  // votre banque — le client ne rachète pas des dollars, il doit prouver qu'il
  // dispose de l'équivalent.
  const t = tauxUtilise('CAD');
  const fcfa = m.cad * t.fcfa;
  return `
    <div class="line"><span>${PF.n} personne${PF.n > 1 ? 's' : ''} dans le dossier</span><span>${fmtCad(m.cad)} $ CAD</span></div>
    ${m.extra ? `<div class="line muted2"><span>dont ${fmtCad(Number(m.base.cad) || 0)} $ pour ${m.base.personnes} personnes + ${m.extra} × ${fmtCad(pfSettings().parPersonneEnPlus)} $</span><span></span></div>` : ''}
    ${t.fcfa ? `<div class="line total"><span>Équivalent en francs</span><span>${fmt(fcfa)} F</span></div>
       <div class="line muted2"><span>1 CAD = ${fmtCad(t.fcfa)} F</span><span>${origineTaux(t)}</span></div>`
      : `<div class="line muted2"><span>Renseignez le taux CAD dans les Paramètres pour voir l'équivalent en francs.</span><span></span></div>`}`;
}

function cartePreuveFonds(c) {
  const pf = pfSettings();
  const maj = pf.maj ? frDate(pf.maj) : '';
  const auto = personnesParDefaut(c);
  return `
    <div class="card">
      <h2>${ico('banque')} Preuve de fonds <span class="hint">IRCC${maj ? ' — barème du ' + esc(maj) : ''}</span></h2>
      <p class="help-text" style="margin:0 0 10px">Somme que le client doit <b>prouver</b> à l'appui de sa demande. Rien ne se calcule tant que vous n'avez pas saisi le nombre de personnes.${c.statutMatrimonial && auto > 1 ? ` <b>Rappel</b> : statut « ${esc(c.statutMatrimonial)} » — le conjoint compte, plus les enfants à charge.` : ' Comptez le demandeur, son conjoint s\'il y en a un, et les enfants à charge.'}</p>
      <div class="field"><label>Nombre de personnes dans le dossier</label>
        <input type="number" min="1" max="30" step="1" value="${esc(PF.n)}" placeholder="à saisir" onchange="A.pfPersonnes(this.value)"></div>
      ${/* Le barème complet est REPLIÉ : ces neuf montants sont les mêmes sur
            toutes les fiches et n'ont rien à voir avec ce client-ci. Tant qu'un
            nombre n'est pas saisi, la carte n'affiche AUCUN chiffre. */''}
      ${pf.paliers.length ? `<button class="lien-deplier" data-agir="pf-bareme">
          <span class="chevron">${PF.bareme ? '▾' : '▸'}</span> ${PF.bareme ? 'Masquer le barème IRCC' : 'Voir le barème IRCC'}
        </button>
        ${PF.bareme ? `<table style="margin-top:8px">
          <thead><tr><th>Personnes</th><th class="num">Fonds exigés</th></tr></thead>
          <tbody>
          ${pf.paliers.map((p) => `<tr${Number(p.personnes) === PF.n ? ' style="font-weight:700"' : ''}>
            <td>${esc(p.personnes)}</td>
            <td class="num muted">${fmtCad(p.cad)} $</td>
          </tr>`).join('')}
          <tr><td class="muted">Chaque personne en plus</td><td class="num muted">+ ${fmtCad(pf.parPersonneEnPlus)} $</td></tr>
        </tbody></table>` : ''}`
        : '<p class="muted">Aucun palier défini — ajoutez-les dans Paramètres → Preuve de fonds.</p>'}
      ${PF.n ? `<div class="tool-result" id="pf-result">${preuveFondsResultHtml()}</div>` : ''}
      <p class="help-text"><b>Ce n'est pas une dépense</b> : cet argent n'est pas payé, il doit être disponible et justifié — il n'a donc rien à faire dans les dépenses du dossier. Montants et date du barème dans <b>Paramètres → Preuve de fonds</b>.</p>
    </div>`;
}

/* Conversion d'un export .chronova → objet chronologie de la fiche */
function mapperChronova(data) {
  if (data.format !== 'chronova' || !Array.isArray(data.events)) throw new Error('ce fichier n’est pas un export Chronova (.chronova)');
  const cats = {};
  (data.categories || []).forEach((k) => { cats[k.id] = k.name; });
  const evenements = data.events
    .filter((e) => !e.deletedAt)
    .map((e) => ({
      titre: e.title || '',
      note: e.description || '',
      categorie: cats[e.categoryId] || '',
      debut: String(e.start || '').slice(0, 10),
      fin: String(e.end || '').slice(0, 10),
      enCours: !!e.ongoing,
    }))
    .sort((a, b) => a.debut.localeCompare(b.debut));
  if (!evenements.length) throw new Error('aucun événement dans cet export');
  return {
    profil: (data.profile && data.profile.name) || '',
    exporteLe: data.exportedAt || '',
    importeLe: new Date().toISOString(),
    evenements,
  };
}

// Les mots sont TRIÉS avant comparaison : « Nom Prénom » et « Prénom Nom » se
// reconnaissent quel que soit l'ordre (indispensable depuis l'inversion de l'affichage).
const normNomComplet = (s) => (s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z0-9]+/).filter(Boolean).sort().join('');

/* Explique NOMMÉMENT pourquoi un profil Chronova ne trouve pas sa fiche
   (demande utilisateur : un message clair, pas un simple « sans fiche au même nom »). */
const motsNom = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean);

/* Carte « Chronologie Chronova » : chronologie des antécédents attachée à la fiche
   (import du fichier .chronova exporté par l'app Chronova ; part sur le site avec la fiche) */
function chronovaCardHtml(c) {
  const ch = c.chronova;
  const input = `<input type="file" id="chronova-file" accept=".chronova,.json" style="display:none" onchange="A.chronovaFichier(this)">`;
  if (!ch || !Array.isArray(ch.evenements) || !ch.evenements.length) {
    return `<p class="help-text" style="margin:0 0 12px">Attachez ici la chronologie des antécédents du client (adresses, emplois, études, voyages…) préparée dans <b>Chronova</b> : ouvrez son profil dans Chronova → <b>Exporter → JSON (.chronova)</b>, puis importez le fichier. La chronologie est enregistrée dans la fiche et <b>envoyée sur le site avec elle</b>.</p>
    ${input}
    <button class="btn btn-primary" onclick="A.chronovaChoisir()">${ico('boussole','ico ico-sm')} Importer un fichier .chronova</button>`;
  }
  const evs = ch.evenements;
  const enCours = evs.some((e) => e.enCours);
  const finMax = evs.reduce((m, e) => (!e.enCours && e.fin > m ? e.fin : m), '');
  return `<p class="help-text" style="margin:0 0 8px">Profil <b>${esc(ch.profil || '?')}</b> — <b>${evs.length}</b> événement(s)${evs[0] && evs[0].debut ? `, de ${frDate(evs[0].debut)} à ${enCours ? 'aujourd&rsquo;hui' : frDate(finMax)}` : ''}.<br>
  Export Chronova du ${ch.exporteLe ? new Date(ch.exporteLe).toLocaleDateString('fr-FR') : '?'} · importé le ${new Date(ch.importeLe).toLocaleDateString('fr-FR')}.</p>
  <div style="max-height:260px;overflow:auto;margin:0 0 10px;border:1px solid var(--line,#e5e5e5);border-radius:8px">
    <table><tbody>
      ${evs.slice().reverse().map((e) => `<tr>
        <td class="muted" style="white-space:nowrap">${frDate(e.debut)} → ${e.enCours ? 'en cours' : frDate(e.fin)}</td>
        <td class="muted">${esc(e.categorie || '')}</td>
        <td>${esc(e.titre || '')}</td>
      </tr>`).join('')}
    </tbody></table>
  </div>
  ${input}
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <button class="btn btn-ghost" onclick="A.chronovaChoisir()">${ico('change','ico ico-sm')} Remplacer (nouvel import)</button>
    <button class="btn btn-danger" onclick="A.chronovaRetirer()">✕ Retirer</button>
  </div>`;
}

/* Carte « Visite médicale » de l'onglet Outils.
   L'âge du client vient de SA date de naissance : on ne redemande jamais une
   donnée déjà saisie. Les autres personnes du dossier (conjoint, enfants) se
   comptent tranche par tranche. */
function carteVisiteMedicale(c) {
  const v = medSettings();
  const age = ageOf(c.dateNaissance);
  const sienne = tranchePourAge(age);
  const mois = deMois(v.mois);
  const entete = age === null
    ? `<p class="help-text" style="margin:0 0 10px">Renseignez la <b>date de naissance</b> du client dans l'onglet Informations pour que sa tranche se coche d'elle-même.</p>`
    : sienne
      ? `<p class="help-text" style="margin:0 0 10px">${esc(fullName(c))} a <b>${age} ans</b> → tranche <b>${esc(sienne.label || bornesTranche(sienne))}</b>, soit <b>${fmt(sienne.fcfa)} F</b>. Ajoutez les personnes à charge sur les autres lignes.</p>`
      : `<p class="help-text" style="margin:0 0 10px">${esc(fullName(c))} a <b>${age} ans</b> — aucune tranche du barème ne couvre cet âge. Vérifiez les tranches dans les Paramètres.</p>`;
  return `
    <div class="card">
      <h2>${ico('feuille')} Visite médicale <span class="hint">OIM${mois ? ' — barème ' + esc(mois) : ''}</span></h2>
      ${entete}
      ${v.tranches.length ? `<table>
        <thead><tr><th>Tranche d'âge</th><th class="num">Tarif</th><th style="width:92px">Personnes</th></tr></thead>
        <tbody>
        ${v.tranches.map((t) => `<tr${sienne && sienne.id === t.id ? ' style="font-weight:700"' : ''}>
          <td>${esc(t.label || bornesTranche(t))}</td>
          <td class="num muted">${fmt(t.fcfa)} F</td>
          <td><input type="number" min="0" step="1" class="table-input" value="${esc(VM.sel[t.id] || 0)}" data-tranche="${esc(t.id)}"></td>
        </tr>`).join('')}
      </tbody></table>` : '<p class="muted">Aucune tranche définie — ajoutez-les dans Paramètres → Visite médicale.</p>'}
      <div class="tool-result" id="med-result">${medicalResultHtml()}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        ${estAdmin() ? `<button class="btn btn-primary btn-small" onclick="A.medVersDepense()">${ico('depense','ico ico-sm')} Ajouter aux dépenses</button>` : ''}
        ${c.calculMedical ? `<button class="btn btn-ghost btn-small" onclick="A.effacerCalculMedical()">${ico('corbeille','ico ico-sm')} Effacer le calcul</button>` : ''}
      </div>
      <p class="help-text">Tarif payé <b>en francs, au guichet</b> : jamais converti. L'OIM revoit sa grille chaque mois — montants et mois dans <b>Paramètres → Visite médicale</b>.</p>
    </div>`;
}

function vTabTools(c) {
  const s = db.settings;
  return `
  <div class="cards-row">
    <div class="card-stack">
    <div class="card">
      <h2>${ico('feuille')} Paiement des frais IRCC <span class="hint">avec frais bancaires</span></h2>
      <table><tbody>
        ${s.feeCatalog.map((fee, i) => `<tr>
          <td style="width:26px"><input type="checkbox" style="width:17px;height:17px" ${IR.sel[i] ? 'checked' : ''} onchange="A.irToggle(${i}, this.checked)"></td>
          <td>${esc(fee.label)}</td>
          <td class="num muted">${fmtCad(fee.amount)} $</td>
          <td style="width:74px">${fee.forfait
            ? '<span class="muted" style="font-size:12px" title="Montant forfaitaire : pas de quantité">forfait</span>'
            : `<input type="number" min="1" class="table-input" value="${IR.sel[i] || 1}" onchange="A.irQty(${i}, this.value)" ${IR.sel[i] ? '' : 'disabled'}>`}</td>
        </tr>`).join('')}
      </tbody></table>
      <div class="tool-result" id="ircc-result">${irccResultHtml()}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        ${estAdmin() ? `<button class="btn btn-primary btn-small" onclick="A.calcVersDepense()">${ico('depense','ico ico-sm')} Ajouter aux dépenses</button>` : ''}
        ${c.calculIrcc ? `<button class="btn btn-ghost btn-small" onclick="A.effacerCalculIrcc()">${ico('corbeille','ico ico-sm')} Effacer le calcul</button>` : ''}
      </div>
      <p class="help-text">Votre sélection est enregistrée dans cette fiche : vous la retrouverez en revenant sur ce client (et elle n'apparaît chez aucun autre). Frais appliqués : paiement ${s.fraisPaiementPct || 0} % · chargement carte ${fmt(s.fraisChargeFixe)} F (modifiables dans les Paramètres).</p>
    </div>
    <div class="card">
      <h2>${ico('calculatrice')} Calculatrice</h2>
      <div class="calc">
        <input type="text" id="calc-display" class="calc-display" value="${esc(CALC.expr)}" placeholder="0" readonly>
        <div class="calc-grid">
          ${['C', '⌫', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '(', ')'].map((k) => {
            const cls = ['C', '⌫'].includes(k) ? 'danger' : ['÷', '×', '−', '+', '(', ')', '%'].includes(k) ? 'op' : '';
            return `<button class="${cls}" onclick="A.calcKey('${k}')">${k}</button>`;
          }).join('')}
          <button class="eq" onclick="A.calcKey('=')">=</button>
        </div>
      </div>
    </div>
    </div>
    <div class="card-stack">
    ${carteVisiteMedicale(c)}
    <div class="card">
      <h2>${ico('imprimante')} Fiche en PDF</h2>
      <p class="help-text" style="margin:0 0 12px">Exporte les onglets <b>Informations</b> et <b>Champs personnalisés</b> de cette fiche (identité, dossier IRCC, études &amp; emploi, notes) en PDF avec filigrane Immigration Voyages. Les finances ne figurent jamais sur le PDF.</p>
      <button class="btn btn-primary" onclick="A.exportPdf()">${ico('imprimante', 'ico ico-sm')} Exporter la fiche en PDF</button>
    </div>
    <div class="card">
      <h2>${ico('boussole')} Chronologie Chronova <span class="hint">antécédents 10 ans</span></h2>
      ${chronovaCardHtml(c)}
    </div>
    </div>
    <div class="card-stack">
    ${cartePreuveFonds(c)}
    </div>
  </div>`;
}

/* Bandeau commun aux trois barèmes réglés sur le site.
   Le même interrupteur apparaît dans les trois cartes : ces barèmes sont publiés
   au même endroit, ils se suivent donc ensemble. */
function bandeauBaremeSite() {
  const b = baremeSite();
  const etat = b.auto
    ? (b.luLe
        ? `Relevé sur le site le <b>${new Date(b.luLe).toLocaleString('fr-FR')}</b> — puis à chaque ouverture de l'application et toutes les heures.` +
          (b.changeLe ? ` Dernier changement reçu le <b>${new Date(b.changeLe).toLocaleString('fr-FR')}</b>.` : '')
        : 'Pas encore relevé — le site sera consulté à la prochaine ouverture.')
    : 'Vous réglez ces montants vous-même : le site n\'y touche plus.';
  return `<div class="bareme-site${b.auto ? ' suivi' : ''}">
    <label class="chk-inline"><input type="checkbox" ${b.auto ? 'checked' : ''} onchange="A.suivreBaremeSite(this.checked)"> Suivre les barèmes du site</label>
    <span class="pied-spacer"></span>
    ${b.auto ? `<button class="lien-effacer" onclick="A.releverBaremes()">${ico('change','ico ico-sm')} Relever maintenant</button>` : ''}
    <span class="etat">${etat}</span>
    ${b.echec ? `<span class="echec">⚠ Dernier relevé impossible : ${esc(b.echec)} — les montants affichés sont ceux du dernier relevé réussi.</span>` : ''}
  </div>`;
}

/* ---------- Paramètres ---------- */

function vSettings() {
  const s = db.settings;
  return `
  <div class="page-head"><h1>Paramètres</h1></div>
  <div class="masonry">
    <div class="card">
      <h2>${ico('change')} Taux de change <span class="hint">1 devise = X FCFA</span></h2>
      <table><tbody>
        ${Object.entries(s.rates).map(([code, val]) => code === 'EUR' ? `<tr>
          <td><b>EUR</b></td>
          <td class="num">${pariteLisible()} F</td>
          <td><span class="muted" style="font-size:12px" title="Parité fixe et légale : ce chiffre ne bouge pas">parité fixe</span></td>
        </tr>` : `<tr>
          <td><b>${esc(code)}</b></td>
          <td><input type="number" step="0.01" class="table-input" data-rate="${esc(code)}" value="${esc(val)}"></td>
          <td>${code !== 'CAD' ? `<button class="btn-x" aria-label="Supprimer cette ligne" title="Supprimer" data-agir="taux-supprimer" data-code="${esc(code)}">✕</button>` : ''}</td>
        </tr>`).join('')}
      </tbody></table>
      <button class="btn btn-ghost btn-small" style="margin-top:10px" onclick="A.addRate()">+ Ajouter une devise</button>
      <p class="help-text">Ces taux sont ceux que <b>votre banque</b> vous applique : ce sont eux qui calculent ce que vous paierez réellement pour les frais IRCC.</p>
      <hr class="sep">
      <h2 style="margin-bottom:10px">${ico('globe')} Taux du jour <span class="hint">relevé par l'euro</span></h2>
      ${(() => {
        const tj = s.tauxJour || {};
        const codes = Object.keys(s.rates).filter((c) => c !== 'EUR');
        const lignes = codes.map((code) => {
          const j = tauxJourPour(code);
          const mien = Number(s.rates[code]) || 0;
          const dif = (j && mien) ? (mien - j) / j * 100 : null;
          return `<tr>
            <td><b>${esc(code)}</b></td>
            <td class="num">${j ? fmtCad(j) + ' F' : '<span class="muted">non relevé</span>'}</td>
            <td class="num muted">${dif === null ? '' : (dif >= 0 ? '+' : '−') + fmtCad(Math.abs(dif)) + ' %'}</td>
            <td>${j ? `<button class="btn btn-ghost btn-small" data-agir="taux-utiliser" data-code="${esc(code)}">Utiliser</button>` : ''}</td>
          </tr>`;
        }).join('');
        return `<table><tbody>
          <tr><td><b>EUR</b></td><td class="num">${pariteLisible()} F</td><td class="num muted">parité fixe</td><td></td></tr>
          ${lignes}
        </tbody></table>
        <p class="help-text" style="margin-top:8px">${tj.releveLe
          ? `Dernier relevé le ${new Date(tj.releveLe).toLocaleString('fr-FR')}${tj.dateBCE ? ` — cours BCE du ${frDate(tj.dateBCE)}` : ''}.` +
            ((s.tauxRefuses || []).length ? `<br><span style="color:var(--amber);font-weight:600">⚠ Taux jugé aberrant, non retenu : ${esc((s.tauxRefuses || []).join(', '))} — votre taux saisi reste utilisé.</span>` : '')
          : 'Aucun relevé pour le moment.'}</p>`;
      })()}
      <button class="btn btn-primary btn-small" onclick="A.releverTaux()">${ico('change','ico ico-sm')} Relever le taux du jour</button>
      <hr class="sep">
      <h2 style="margin-bottom:10px">${ico('change')} Convertisseur <span class="hint">au taux du jour</span></h2>
      <div class="grid-2">
        <div class="field"><label>Devise</label>
          <select id="conv-cur">${Object.keys(s.rates).map((k) => `<option ${CV.cur === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
        <div class="field"><label>Sens</label>
          <select id="conv-dir"><option value="to" ${CV.dir === 'to' ? 'selected' : ''}>Devise → FCFA</option><option value="from" ${CV.dir === 'from' ? 'selected' : ''}>FCFA → Devise</option></select></div>
      </div>
      <div class="field"><label>Montant</label><input type="text" inputmode="decimal" id="conv-amount" value="${esc(CV.amount)}" placeholder="0"></div>
      <div class="tool-result" id="conv-result">${convResultHtml()}</div>
      <p class="help-text">Le franc CFA a une <b>parité fixe et légale</b> avec l'euro : 1 € = ${pariteLisible()} F, ce chiffre ne bouge jamais. On ne relève donc que le cours de la devise en euros, auprès de la <b>Banque centrale européenne</b> (une publication par jour ouvré), et le taux en francs s'en déduit. C'est la méthode du site Immigration Voyages. Le convertisseur et la preuve de fonds utilisent ce taux ; les frais IRCC restent calculés au taux de votre banque, avec l'écart affiché à côté. La colonne du milieu montre de combien votre taux dépasse le cours réel.</p>
    </div>
    <div class="card">
      <h2>${ico('banque')} Frais bancaires</h2>
      <div class="field"><label>Frais au paiement IRCC (%) — pourcentage prélevé quand vous payez en ligne</label>
        <input type="number" step="0.01" data-cfg="fraisPaiementPct" value="${esc(s.fraisPaiementPct)}"></div>
      <div class="field"><label>Frais de chargement de la carte (montant fixe en FCFA)</label>
        <input type="number" step="1" data-cfg="fraisChargeFixe" value="${esc(s.fraisChargeFixe)}"></div>
      <p class="help-text">Ces frais sont utilisés par l'outil « Paiement des frais IRCC » de chaque fiche client.</p>
    </div>
    <div class="card">
      <h2>${ico('feuille')} Catalogue des frais IRCC <span class="hint">montants en $ CAD</span></h2>
      ${bandeauBaremeSite()}
      ${baremeSite().auto ? `<table class="lecture">
        <thead><tr><th>Désignation</th><th class="num">Montant</th><th style="width:78px">Forfait</th></tr></thead>
        <tbody>
        ${s.feeCatalog.map((f) => `<tr>
          <td>${esc(f.label)}</td>
          <td class="num"><b>${fmtCad(f.amount)} $</b></td>
          <td class="muted" style="text-align:center">${f.forfait ? 'oui' : '—'}</td>
        </tr>`).join('')}
      </tbody></table>`
      : `<table>
        <thead><tr><th>Désignation</th><th style="width:104px">Montant</th><th style="width:78px">Forfait</th><th style="width:34px"></th></tr></thead>
        <tbody>
        ${s.feeCatalog.map((f, i) => `<tr>
          <td><input type="text" class="table-input" data-fee-idx="${i}" data-fee-prop="label" value="${esc(f.label)}"></td>
          <td style="width:104px"><input type="number" step="0.01" class="table-input" data-fee-idx="${i}" data-fee-prop="amount" value="${esc(f.amount)}"></td>
          <td style="text-align:center"><input type="checkbox" style="width:17px;height:17px" data-fee-idx="${i}" data-fee-prop="forfait" ${f.forfait ? 'checked' : ''}></td>
          <td><button class="btn-x" aria-label="Supprimer cette ligne" title="Supprimer" onclick="A.delFee(${i})">✕</button></td>
        </tr>`).join('')}
      </tbody></table>
      <button class="btn btn-ghost btn-small" style="margin-top:10px" onclick="A.addFee()">+ Ajouter un frais</button>`}
      <p class="help-text">Cochez <b>Forfait</b> pour un frais qui ne se multiplie pas (la biométrie, par exemple) : aucune quantité n'est alors demandée dans la fiche client.</p>
    </div>
    <div class="card">
      <h2>${ico('banque')} Preuve de fonds <span class="hint">montants en $ CAD</span></h2>
      ${bandeauBaremeSite()}
      ${baremeSite().auto ? `<table class="lecture">
        <thead><tr><th style="width:96px">Personnes</th><th class="num">Fonds exigés</th></tr></thead>
        <tbody>
        ${pfSettings().paliers.map((p) => `<tr>
          <td>${esc(p.personnes)}</td><td class="num"><b>${fmtCad(p.cad)} $</b></td>
        </tr>`).join('')}
        <tr><td class="muted">Par personne en plus</td><td class="num"><b>+ ${fmtCad(pfSettings().parPersonneEnPlus)} $</b></td></tr>
        <tr><td class="muted">Barème du</td><td class="num muted">${frDate(pfSettings().maj) || '—'}</td></tr>
      </tbody></table>`
      : `<div class="field"><label>Date du barème IRCC — réindexé chaque année</label>
        <input type="date" data-pf-maj value="${esc(pfSettings().maj)}"></div>
      <table>
        <thead><tr><th style="width:96px">Personnes</th><th>Fonds exigés ($ CAD)</th><th style="width:34px"></th></tr></thead>
        <tbody>
        ${pfSettings().paliers.map((p, i) => `<tr>
          <td><input type="number" min="1" step="1" class="table-input" data-pf-idx="${i}" data-pf-prop="personnes" value="${esc(p.personnes)}"></td>
          <td><input type="number" min="0" step="1" class="table-input" data-pf-idx="${i}" data-pf-prop="cad" value="${esc(p.cad)}"></td>
          <td><button class="btn-x" aria-label="Supprimer cette ligne" title="Supprimer" onclick="A.delPalierPf(${i})">✕</button></td>
        </tr>`).join('')}
      </tbody></table>
      <button class="btn btn-ghost btn-small" style="margin:10px 0" onclick="A.addPalierPf()">+ Ajouter un palier</button>
      <div class="field" style="margin-top:10px"><label>Par personne supplémentaire, au-delà du dernier palier ($ CAD)</label>
        <input type="number" min="0" step="1" data-pf-extra value="${esc(pfSettings().parPersonneEnPlus)}"></div>`}
      <p class="help-text">Somme que le client doit <b>prouver</b> — ce n'est pas une dépense. Elle s'affiche en francs dans chaque fiche, convertie au <b>taux du jour</b> (par l'euro), pas au taux de votre banque : le client ne rachète pas des dollars, il doit justifier qu'il dispose de l'équivalent.</p>
    </div>
    <div class="card">
      <h2>${ico('feuille')} Visite médicale (OIM) <span class="hint">montants en FCFA</span></h2>
      ${bandeauBaremeSite()}
      ${baremeSite().auto ? `<table class="lecture">
        <thead><tr><th>Tranche d'âge</th><th class="num">Tarif</th></tr></thead>
        <tbody>
        ${medSettings().tranches.map((t) => `<tr>
          <td>${esc(t.label || bornesTranche(t))}</td><td class="num"><b>${fmt(t.fcfa)} F</b></td>
        </tr>`).join('')}
        <tr><td class="muted">Barème du mois</td><td class="num muted">${esc(moisMedicalLisible(medSettings().mois) || '—')}</td></tr>
      </tbody></table>`
      : `<div class="field"><label>Mois du barème — l'OIM révise sa grille chaque mois</label>
        <input type="month" data-med-mois value="${esc(medSettings().mois)}"></div>
      <table>
        <thead><tr><th>Tranche</th><th style="width:62px">De</th><th style="width:62px">À</th><th style="width:104px">Tarif</th><th style="width:34px"></th></tr></thead>
        <tbody>
        ${medSettings().tranches.map((t, i) => `<tr>
          <td><input type="text" class="table-input" data-med-idx="${i}" data-med-prop="label" value="${esc(t.label)}"></td>
          <td><input type="number" min="0" step="1" class="table-input" data-med-idx="${i}" data-med-prop="min" value="${esc(t.min)}"></td>
          <td><input type="number" min="0" step="1" class="table-input" data-med-idx="${i}" data-med-prop="max" value="${t.max === null || t.max === undefined || t.max === '' ? '' : esc(t.max)}" placeholder="∞"></td>
          <td><input type="text" inputmode="numeric" data-money class="table-input" data-med-idx="${i}" data-med-prop="fcfa" value="${fmt(t.fcfa)}"></td>
          <td><button class="btn-x" aria-label="Supprimer cette ligne" title="Supprimer" onclick="A.delTrancheMed(${i})">✕</button></td>
        </tr>`).join('')}
      </tbody></table>
      <button class="btn btn-ghost btn-small" style="margin-top:10px" onclick="A.addTrancheMed()">+ Ajouter une tranche</button>`}
      <p class="help-text">Laissez la colonne <b>À</b> vide pour la dernière tranche : elle signifie « et plus ». Le tarif de la tranche qui correspond à l'âge du client s'applique tout seul dans sa fiche (onglet Outils). <b>Ces montants ne sont jamais convertis</b> : la visite se paie en francs, sur place.</p>
    </div>
    <div class="card">
      <h2>${ico('champs')} Modèle de champs personnalisés <span class="hint">ajoutés à chaque NOUVEAU client</span></h2>
      ${s.customTemplate.length ? `<table><tbody>${s.customTemplate.map((t, i) => `<tr>
        <td><input type="text" class="table-input" data-tpl-idx="${i}" data-tpl-prop="label" value="${esc(t.label)}"></td>
        <td style="width:170px"><select class="table-input" data-tpl-idx="${i}" data-tpl-prop="type">${CF_TYPES.map(([v, l]) => `<option value="${v}" ${t.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td><button class="btn-x" aria-label="Supprimer cette ligne" title="Supprimer" onclick="A.delTpl(${i})">✕</button></td>
      </tr>`).join('')}</tbody></table>` : '<p class="muted">Aucun champ modèle.</p>'}
      <button class="btn btn-ghost btn-small" style="margin-top:10px" onclick="A.addTpl()">+ Ajouter un champ modèle</button>
    </div>
    <div class="card">
      <h2>${ico('sauvegarde')} Sauvegardes</h2>
      ${MOBILE ? `<p class="help-text">Vos données sont enregistrées automatiquement dans cet appareil, avec une copie de sécurité à chaque ouverture puis toutes les 10 minutes. <b>Les 10 copies les plus récentes</b> sont conservées.</p>` : `<p class="help-text">Vos données sont enregistrées automatiquement, avec une copie de sécurité à chaque lancement puis toutes les 10 minutes. <b>Les 10 copies les plus récentes</b> sont conservées sur cet ordinateur ; le dossier cloud, lui, en garde 30.</p>
      <hr class="sep">
      <div class="field"><label>Dossier de sauvegarde cloud (ex. : dossier MEGA)</label>
        <div style="display:flex;gap:8px">
          <input type="text" readonly value="${esc(s.cloudBackupDir || 'Aucun dossier choisi')}">
          <button class="btn btn-ghost" onclick="A.chooseCloud()">Choisir…</button>
          ${s.cloudBackupDir ? `<button class="btn btn-danger" onclick="A.clearCloud()">✕</button>` : ''}
        </div>
        ${s.cloudBackupDir ? `<div id="etat-cloud" class="computed">Vérification de la dernière copie…</div>` : ''}
      </div>`}
      ${/* Restaurer sur demande. Jusqu'ici les 30 sauvegardes n'apparaissaient
            QUE si le fichier était abîmé : une fiche vidée par mégarde ne se
            rattrapait pas. Réservé à l'administrateur — restaurer remplace tout,
            finances comprises. */
        estAdmin() ? `
      <hr class="sep">
      <h2 style="margin-bottom:8px">${ico('fleche')} Revenir en arrière</h2>
      <p class="help-text" style="margin-top:0">Une fiche effacée par mégarde, un champ vidé sans s'en rendre compte : choisissez une copie et le logiciel repart de là. <b>Tout</b> est remplacé par l'état de ce moment-là — les modifications faites depuis seront perdues. Une copie de vos données actuelles est prise juste avant, par sécurité.</p>
      ${/* Les archives restent REPLIÉES : on ne restaure presque jamais, et une
            longue liste de dates n'a pas à occuper la carte tous les jours. */''}
      <button class="lien-deplier" data-agir="sauvegardes-ouvrir" style="margin-top:4px">
        <span class="chevron">${SAUV.ouvert ? '▾' : '▸'}</span> ${SAUV.ouvert ? 'Masquer les sauvegardes' : 'Voir les sauvegardes'}
      </button>
      ${SAUV.ouvert ? `<div id="liste-sauvegardes" class="computed" style="margin-top:10px">Lecture des sauvegardes…</div>` : ''}` : ''}
    </div>
    <div class="card">
      <h2>${ico('globe')} Site Immigration Voyages <span class="hint">stockage sur votre espace /gestion</span></h2>
      ${s.syncAlerte ? `<p class="help-text" style="background:var(--red-bg);color:var(--red);font-weight:600;padding:10px 12px;border-radius:9px;margin:0 0 12px">⚠ ${esc(s.syncAlerte)}</p>` : ''}
      ${s.syncRefreshToken ? `
        <p class="help-text">Connecté en tant que <b>${esc(s.syncEmail)}</b>.${s.syncLastAt ? '<br>Dernière synchronisation : ' + new Date(s.syncLastAt).toLocaleString('fr-FR') + '.' : ''}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
          <button class="btn btn-primary" onclick="A.syncPush()">${ico('globe','ico ico-sm')} Envoyer les fiches vers le site</button>
          <button class="btn btn-ghost" onclick="A.syncPull()">${ico('sauvegarde','ico ico-sm')} Récupérer les fiches du site</button>
          <button class="btn btn-danger" onclick="A.syncLogout()">Se déconnecter</button>
        </div>
        <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--muted)">
          <input type="checkbox" style="width:17px;height:17px" ${s.syncAuto ? 'checked' : ''} onchange="A.syncAutoToggle(this.checked)">
          Envoyer automatiquement mes fiches après chaque modification
        </label>`
      : `
        <p class="help-text">Connectez-vous avec votre compte de l'<b>espace de gestion du site</b> (le même email/mot de passe que sur immigration-voyages.com/gestion) pour stocker vos fiches en ligne et les consulter depuis le site.</p>
        <div class="field"><label>Email</label><input type="email" id="sync-email" value="${esc(s.syncEmail)}" autocomplete="off"></div>
        <div class="field"><label>Mot de passe</label><input type="password" id="sync-pass" autocomplete="off"></div>
        <p id="sync-err" class="help-text" style="color:var(--red);font-weight:600"></p>
        <button class="btn btn-primary" onclick="A.syncLogin()">Se connecter au site</button>`}
      ${/* Deuxième étape : le code de vérification. Le site ne montre ses fiches
            qu'à une session qui l'a donné — sans lui, il répond « 0 fiche »
            sans un mot, et l'envoi reste bloqué (constaté le 06/09/2026). */
        MFA.factorId ? `<div class="bloc-secours" style="margin-top:0">
        <div class="secours-titre">${ico('cadenas','ico ico-sm')} Le site demande votre code de vérification</div>
        <p>Ouvrez votre application d'authentification (${esc(MFA.nom)}) et recopiez le code à 6 chiffres.
          Sans lui, le site ne vous montre <b>aucune fiche</b> — et l'envoi est refusé pour ne pas écraser
          ce qui est en ligne.</p>
        <div class="field" style="margin-bottom:10px">
          <input type="text" id="sync-code" inputmode="numeric" maxlength="7" placeholder="000000"
                 autocomplete="one-time-code" style="text-align:center;letter-spacing:6px;font-size:20px">
        </div>
        ${MFA.erreur ? `<p style="color:var(--red);font-weight:600;font-size:var(--t-sm);margin:0 0 10px">${esc(MFA.erreur)}</p>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-small" onclick="A.syncCode()">Valider le code</button>
          <button class="btn btn-ghost btn-small" onclick="A.annulerCode()">Annuler</button>
        </div>
      </div>` : ''}
    </div>
    ${estAdmin() ? vCarteAppareil() : ''}
    <div class="card">
      <h2>${ico('soleil')} Apparence <span class="hint">clair ou sombre</span></h2>
      <div class="theme-switch">
        <button class="${s.theme !== 'sombre' ? 'actif' : ''}" onclick="A.setTheme('clair')">${ico('soleil', 'ico ico-sm')} Clair</button>
        <button class="${s.theme === 'sombre' ? 'actif' : ''}" onclick="A.setTheme('sombre')">${ico('lune', 'ico ico-sm')} Sombre</button>
      </div>
      <p class="help-text">Le thème sombre repose les yeux le soir. Votre choix est conservé d'une session à l'autre.</p>
    </div>
    ${/* Cette carte n'existe QUE dans l'ouverture en mode administrateur :
          l'assistant(e) ne voit ni le mot de passe, ni son existence. */
      estAdmin() ? `<div class="card">
      <h2>${ico('cadenas')} Ouverture de l'application <span class="hint">administrateur / assistant(e)</span></h2>
      <p class="help-text">À chaque lancement, l'application demande le mode d'ouverture.
        <b>Administrateur</b> donne tout, finances comprises. <b>Assistant(e)</b> donne le suivi
        des dossiers <b>sans le volet financier</b> — pas d'échéancier, pas de versements,
        pas de dépenses, pas de bénéfice. Tout le reste est identique.
        L'ouverture en assistant(e) ne demande aucun mot de passe.</p>
      <hr class="sep">
      <p class="help-text" style="margin-top:0"><b>Mot de passe administrateur</b> — ${s.lockHash
        ? 'il est demandé dès que quelqu\'un choisit « Administrateur ».'
        : '<span style="color:var(--amber);font-weight:700">aucun mot de passe n\'est défini : n\'importe qui peut ouvrir en mode administrateur et voir vos finances.</span>'}</p>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        ${s.lockHash
          ? `<button class="btn btn-ghost" onclick="A.lockChange()">Changer le mot de passe</button>
             <button class="btn btn-danger" onclick="A.lockDisable()">Retirer le mot de passe</button>`
          : `<button class="btn btn-primary" onclick="A.lockEnable()">Définir un mot de passe</button>`}
      </div>
      ${codeSecoursAffiche ? `<div class="bloc-secours">
        <div class="secours-titre">${ico('cadenas','ico ico-sm')} Votre code de secours — notez-le maintenant</div>
        <div class="secours-code">${esc(codeSecoursAffiche)}</div>
        <p>Il rouvre le mode administrateur si vous oubliez le mot de passe. <b>Il n'est affiché qu'une fois</b> :
          le logiciel ne le conserve pas en clair, personne ne pourra vous le redonner. Rangez-le ailleurs que
          sur cet ordinateur — un papier dans vos dossiers suffit.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-small" onclick="A.copierCodeSecours()">Copier</button>
          <button class="btn btn-ghost btn-small" onclick="A.enregistrerCodeSecours()">Enregistrer dans un fichier</button>
          <button class="btn btn-primary btn-small" onclick="A.codeSecoursNote()">J'ai noté ce code</button>
        </div>
      </div>` : (s.lockHash && s.lockSecoursHash ? `<p class="help-text">Un <b>code de secours</b> a été délivré à la création de ce mot de passe. Il rouvre le mode administrateur en cas d'oubli. Si vous l'avez perdu, changez le mot de passe : un nouveau code sera délivré.</p>`
        : s.lockHash ? `<p class="help-text" style="color:var(--amber);font-weight:600">⚠ Ce mot de passe n'a pas de code de secours (il date d'une version antérieure). Changez-le une fois pour en obtenir un — sans quoi l'oublier fermerait le mode administrateur définitivement.</p>` : '')}
      <p class="help-text" style="background:var(--amber-bg);color:var(--amber);font-weight:600;padding:10px 12px;border-radius:9px;margin-top:14px">
        ⚠ Ce mot de passe protège <b>l'écran, pas le fichier</b>. Vos fiches — finances comprises —
        restent lisibles en clair ${MOBILE ? 'dans cet appareil' : 'dans <code>%APPDATA%\\IV Clients\\data</code>'} par toute personne ayant
        accès à cet ${MOBILE ? 'appareil' : 'ordinateur'}, sans lancer l'application. Les deux modes évitent qu'on voie vos chiffres
        <b>par mégarde</b> ; ils n'arrêtent pas quelqu'un de déterminé. Pour une vraie protection, comptez
        sur le mot de passe de votre session Windows et sur le chiffrement du disque (BitLocker).
      </p>
    </div>` : ''}
    ${HAS_API && window.api.maj ? vCarteMaj() : ''}
    <div class="card">
      <h2>${ico('info')} À propos</h2>
      <div class="about-box">
        <img src="assets/icon.png" alt="">
        <div>
          <b>IV Clients</b> — v<span id="about-version">${esc(APP_INFO.version)}</span><br>
          <span class="muted">Gestion des fichiers clients d'Immigration Voyages<br>
          Conçu par <b>Alex NGASSA</b> pour Immigration Voyages<br>
          © Immigration Voyages — Tous droits réservés${APP_INFO.updated ? '<br>Mis à jour le ' + esc(APP_INFO.updated) : ''}</span>
        </div>
      </div>
    </div>
  </div>`;
}

/* ================= Actions ================= */

/* Barrage des actions financières en mode assistant(e). Masquer un bouton ne
   suffit pas : une action peut être déclenchée par un raccourci, un reste
   d'écran non redessiné ou un changement de mode en cours de route. */
function refusAssistant(message) {
  if (estAdmin()) return false;
  toast(message || 'Le volet financier n\'est pas accessible en mode assistant(e).');
  return true;
}
// refus des réglages réservés à l'administrateur : le message ne parle pas de finances
const refusReglageAdmin = () => refusAssistant('Réglage réservé à l\'ouverture en mode administrateur.');

const A = {
  goto(v) { view = v; render(); },
  setTab(t) { if (t === 'finance' && refusAssistant()) return; curTab = t; render(); },

  /* Pense-bête du jour : cocher ne touche PAS la fiche, la ligne revient demain
     si la raison tient toujours. On ne redessine que la carte, pour ne pas faire
     sauter l'écran sous la souris à chaque case cochée. */
  tacheFaite(cle, coche) {
    if (!db.settings.aFaireFait) db.settings.aFaireFait = {};
    if (coche) db.settings.aFaireFait[cle] = todayISO();
    else delete db.settings.aFaireFait[cle];
    save();
    setTimeout(() => { if (view === 'dashboard') render(); }, 220);
  },
  rendreTaches() { db.settings.aFaireFait = {}; save(); render(); },
  setTheme(t) {
    db.settings.theme = t === 'sombre' ? 'sombre' : 'clair';
    appliquerTheme();
    save(); render();
    toast(db.settings.theme === 'sombre' ? 'Thème sombre activé.' : 'Thème clair activé.');
  },

  setArchived(v) { showArchived = v; showCorbeille = false; render(); },

  ignorerDoublon(cle) {
    if (!cle) return;
    if (!Array.isArray(db.settings.doublonsIgnores)) db.settings.doublonsIgnores = [];
    if (!db.settings.doublonsIgnores.includes(cle)) db.settings.doublonsIgnores.push(cle);
    save(); render();
    toast('Signalement écarté — ces fiches ne seront plus rapprochées.');
  },
  /* Un signalement écarté par erreur était perdu pour toujours : rien ne le
     ramenait. On peut désormais tout remettre en place d'un clic. */
  reafficherDoublons() {
    db.settings.doublonsIgnores = [];
    save(); render();
    toast('Les rapprochements écartés sont de nouveau affichés.');
  },
  setCorbeille() { if (refusReglageAdmin()) return; showCorbeille = true; render(); },

  restaurerFiche(id) {
    if (refusReglageAdmin()) return;
    const i = (db.corbeille || []).findIndex((x) => x.fiche && x.fiche.id === id);
    if (i < 0) return;
    const [x] = db.corbeille.splice(i, 1);
    // une fiche remise n'est plus « supprimée » : la trace qui empêchait le site
    // de la réintroduire doit tomber, sinon elle ne repartirait jamais en ligne
    db.settings.fichesSupprimees = (db.settings.fichesSupprimees || []).filter((v) => v !== id);
    if (!getClient(id)) { touch(x.fiche); db.clients.push(x.fiche); }
    migrate(db); save(); showCorbeille = false; showArchived = !!x.fiche.archive; render();
    toast(`Fiche de ${fullName(x.fiche)} remise.`);
  },

  async effacerDefinitif(id) {
    if (refusReglageAdmin()) return;
    const x = (db.corbeille || []).find((y) => y.fiche && y.fiche.id === id);
    if (!x) return;
    const ok = await confirm2(`Effacer définitivement la fiche de ${fullName(x.fiche)} ?`,
      'Cette fois, rien ne la ramènera : ni la corbeille, ni le site.', 'Effacer pour de bon');
    if (!ok) return;
    db.corbeille = db.corbeille.filter((y) => !(y.fiche && y.fiche.id === id));
    save(); render(); toast('Fiche effacée définitivement.');
  },

  /* Filtres : on ne re-dessine QUE la liste, pour ne pas refermer le menu déroulant
     que l'utilisateur vient d'utiliser. */
  setFiltre(cle, v, el) { FILTRE[cle] = v; if (el) el.classList.toggle('actif', !!v); majListeClients(); },
  setTri(v) { db.settings.triClients = v; save(); majListeClients(); },
  setGroupe(v) { db.settings.groupeEtape = !!v; save(); majListeClients(); },
  resetFiltres() {
    Object.keys(FILTRE).forEach((k) => { FILTRE[k] = ''; });
    search = '';
    render();
    toast('Tous les clients sont de nouveau affichés.');
  },

  toggleArchive(id) {
    const c = getClient(id); if (!c) return;
    c.archive = !c.archive;
    touch(c); save();
    if (c.archive) {
      showArchived = false; view = 'clients'; render();
      toast(`Fiche de ${fullName(c)} archivée — retrouvez-la dans Clients → Archivés.`);
    } else {
      render();
      toast(`Fiche de ${fullName(c)} désarchivée ✓`);
    }
  },

  openClient(id) {
    // rien d'un client ne doit se retrouver chez un autre : on repart de zéro,
    // puis on recharge le calcul de frais IRCC propre à CETTE fiche
    if (curId !== id) { CV.amount = ''; CALC.expr = ''; }
    curId = id; curTab = 'infos'; view = 'client';
    restaurerCalculIrcc(getClient(id));
    restaurerCalculMedical(getClient(id));
    restaurerPreuveFonds(getClient(id));
    render();
  },

  newClient() {
    const c = newClientObj();
    touch(c);
    IR.sel = {}; VM.sel = {}; CV.amount = ''; CALC.expr = ''; PF.n = '';
    db.clients.push(c); save();
    curId = c.id; curTab = 'infos'; view = 'client'; render();
    toast('Nouveau fichier client créé — remplissez ses informations.');
  },

  async delClient(id) {
    if (refusAssistant('Supprimer une fiche est réservé à l\'ouverture en mode administrateur. Vous pouvez l\'archiver.')) return;
    const c = getClient(id); if (!c) return;
    const ok = await confirm2(`Supprimer la fiche de ${fullName(c)} ?`,
      `Elle part à la corbeille et y reste ${JOURS_CORBEILLE} jours : vous pouvez la remettre pendant ce délai (Clients → Corbeille). Passé ce délai, elle est effacée pour de bon.`,
      'Mettre à la corbeille');
    if (!ok) return;
    /* La fiche n'est plus DÉTRUITE : elle est mise de côté avec sa date. Un clic
       de trop ne coûte plus un dossier entier — finances, étapes et champs
       personnalisés compris. */
    if (!Array.isArray(db.corbeille)) db.corbeille = [];
    db.corbeille.push({ fiche: JSON.parse(JSON.stringify(c)), supprimeeLe: new Date().toISOString() });
    db.clients = db.clients.filter((x) => x.id !== id);
    /* Trace de suppression (audit du 23/08/2026). Si l'effacement sur le site
       échoue — hors ligne, ou compte sans droit de suppression, qui reçoit un
       « tout va bien » sans rien supprimer — la fiche revenait au prochain
       « Récupérer ». On retient donc l'identifiant tant que le site ne l'a pas
       confirmé, et pullFiches refuse de la réintroduire. */
    if (!Array.isArray(db.settings.fichesSupprimees)) db.settings.fichesSupprimees = [];
    if (!db.settings.fichesSupprimees.includes(id)) db.settings.fichesSupprimees.push(id);
    save(); view = 'clients'; render();
    toast(`Fiche mise à la corbeille — récupérable pendant ${JOURS_CORBEILLE} jours.`);
    if (syncOn()) {
      sbRest('fiches_ircc?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
        .then(async () => {
          // on ne lève la trace QUE si le site ne renvoie plus la fiche
          try {
            const reste = await sbRest('fiches_ircc?select=id&id=eq.' + encodeURIComponent(id));
            if (Array.isArray(reste) && reste.length === 0) {
              db.settings.fichesSupprimees = db.settings.fichesSupprimees.filter((x) => x !== id);
              save();
            } else {
              db.settings.syncAlerte = 'Le site n\'a pas supprimé cette fiche (droit réservé à l\'administrateur). Elle reste masquée ici, mais elle est toujours en ligne.';
              save(); renderSiLibre();
            }
          } catch (_) { /* on garde la trace : elle protège du retour */ }
        })
        .catch(() => { /* hors ligne : la trace reste, la fiche ne reviendra pas */ });
    }
  },

  /* champs personnalisés */
  /* Réordonner les champs personnalisés par glissement (même principe qu'IV Devis) */
  cfDragStart(e, i) {
    cfDragIdx = i;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(i)); } catch (_) {}
    const row = e.target.closest('.cf-row'); if (row) row.classList.add('cf-drag');
  },
  cfDragOver(e, i) {
    if (cfDragIdx === null || cfDragIdx === i) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const row = e.currentTarget;
    const avant = (e.clientY - row.getBoundingClientRect().top) < row.offsetHeight / 2;
    row.classList.toggle('drop-avant', avant);
    row.classList.toggle('drop-apres', !avant);
  },
  cfDragLeave(e) { e.currentTarget.classList.remove('drop-avant', 'drop-apres'); },
  cfDragEnd() {
    cfDragIdx = null;
    document.querySelectorAll('.cf-row').forEach((r) => r.classList.remove('cf-drag', 'drop-avant', 'drop-apres'));
  },
  cfDrop(e, i) {
    e.preventDefault();
    const row = e.currentTarget;
    const avant = row.classList.contains('drop-avant');
    row.classList.remove('drop-avant', 'drop-apres');
    const c = getClient(curId);
    if (!c || cfDragIdx === null || cfDragIdx === i) { A.cfDragEnd(); return; }
    const depuis = cfDragIdx;
    const champ = c.custom[depuis];
    c.custom.splice(depuis, 1);
    let cible = i + (avant ? 0 : 1);
    if (depuis < cible) cible--;              // l'élément retiré décale les suivants
    c.custom.splice(Math.max(0, Math.min(cible, c.custom.length)), 0, champ);
    cfDragIdx = null;
    touch(c); save(); render();
    toast(`« ${champ.label || 'Champ'} » déplacé.`);
  },

  /* Réordonner les lignes de finances (échéancier, versements, dépenses) */
  finDragStart(e, liste, i) {
    finDrag = { liste, i };
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', liste + ':' + i); } catch (_) {}
    const tr = e.target.closest('tr'); if (tr) tr.classList.add('fin-drag');
  },
  finDragOver(e, liste, i) {
    if (!finDrag || finDrag.liste !== liste || finDrag.i === i) return;  // pas de mélange entre tableaux
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const tr = e.currentTarget;
    const avant = (e.clientY - tr.getBoundingClientRect().top) < tr.offsetHeight / 2;
    tr.classList.toggle('drop-avant', avant);
    tr.classList.toggle('drop-apres', !avant);
  },
  finDragLeave(e) { e.currentTarget.classList.remove('drop-avant', 'drop-apres'); },
  finDragEnd() {
    finDrag = null;
    document.querySelectorAll('tr').forEach((r) => r.classList.remove('fin-drag', 'drop-avant', 'drop-apres'));
  },
  finDrop(e, liste, i) {
    e.preventDefault();
    const tr = e.currentTarget;
    const avant = tr.classList.contains('drop-avant');
    tr.classList.remove('drop-avant', 'drop-apres');
    const c = getClient(curId);
    if (!c || !finDrag || finDrag.liste !== liste || finDrag.i === i) { A.finDragEnd(); return; }
    const arr = c.finance[liste];
    const depuis = finDrag.i;
    const ligne = arr[depuis];
    arr.splice(depuis, 1);
    let cible = i + (avant ? 0 : 1);
    if (depuis < cible) cible--;
    arr.splice(Math.max(0, Math.min(cible, arr.length)), 0, ligne);
    finDrag = null;
    touch(c); save(); render();
    toast(liste === 'echeancier' ? 'Tranche déplacée — les versements se réappliquent dans le nouvel ordre.' : 'Ligne déplacée.');
  },

  addCustom() {
    const label = $('#cf-new-label').value.trim();
    if (!label) { toast('Donnez un intitulé au champ.'); return; }
    const type = $('#cf-new-type').value;
    const c = getClient(curId);
    c.custom.push({ id: uid(), label, type, value: type === 'check' ? false : '', frise: false });
    touch(c); save(); render();
  },
  async delCustom(fid) {
    const c = getClient(curId);
    const f = c.custom.find((x) => x.id === fid);
    const ok = await confirm2(`Supprimer le champ « ${f ? f.label : ''} » ?`, '', 'Supprimer');
    if (!ok) return;
    c.custom = c.custom.filter((x) => x.id !== fid);
    touch(c); save(); render();
  },

  /* finances */
  addFin(list) {
    if (refusAssistant()) return;
    const c = getClient(curId);
    if (list === 'echeancier') c.finance.echeancier.push({ id: uid(), label: '', date: '', montant: 0, paye: false, datePaiement: '' });
    if (list === 'versements') c.finance.versements.push({ id: uid(), date: todayISO(), montant: 0, note: '' });
    if (list === 'depenses') c.finance.depenses.push({ id: uid(), date: todayISO(), designation: '', montant: 0 });
    touch(c); save(); render();
  },
  async delFin(list, i) {
    if (refusAssistant()) return;
    const ok = await confirm2('Supprimer cette ligne ?', '', 'Supprimer');
    if (!ok) return;
    const c = getClient(curId);
    c.finance[list].splice(i, 1);
    touch(c); save(); render();
  },

  /* outils */
  irToggle(i, checked) {
    if (checked) {
      IR.sel[i] = IR.sel[i] || 1;
      /* Règle IRCC : 85 $ par personne, PLAFONNÉ à 170 $ par famille. Les deux
         lignes ne peuvent donc jamais s'additionner (elles montaient à 255 $). */
      const moi = db.settings.feeCatalog[i];
      if (moi && /^biometrie/i.test(moi.site || '')) {
        db.settings.feeCatalog.forEach((f, j) => {
          if (j !== i && f && /^biometrie/i.test(f.site || '')) delete IR.sel[j];
        });
      }
    } else delete IR.sel[i];
    enregistrerCalculIrcc();   // le calcul reste attaché à la fiche ouverte
    render();
  },
  irQty(i, v) {
    if (db.settings.feeCatalog[i] && db.settings.feeCatalog[i].forfait) { IR.sel[i] = 1; return; }
    IR.sel[i] = Math.max(1, parseInt(v, 10) || 1);
    enregistrerCalculIrcc();
    const r = $('#ircc-result'); if (r) r.innerHTML = irccResultHtml();
  },

  effacerCalculIrcc() {
    const c = getClient(curId); if (!c) return;
    delete c.calculIrcc;
    IR.sel = {};
    touch(c); save(); render();
    toast('Calcul effacé de cette fiche.');
  },

  /* preuve de fonds */
  // le barème IRCC est le même pour tous : on le déplie quand on en a besoin
  voirBaremePf() { PF.bareme = !PF.bareme; render(); },
  pfPersonnes(v) {
    // champ vidé : on revient à « rien », et le chiffre enregistré sur la fiche
    // est effacé — aucun montant ne doit survivre à l'effacement du nombre
    const n = parseInt(v, 10);
    PF.n = (String(v).trim() === '' || isNaN(n) || n < 1) ? '' : Math.min(30, n);
    enregistrerPreuveFonds();
    render();   // le palier mis en gras dans le tableau change aussi
  },
  addPalierPf() {
    const pf = pfSettings();
    const dernier = pf.paliers[pf.paliers.length - 1];
    pf.paliers.push({
      personnes: dernier ? (Number(dernier.personnes) || 0) + 1 : 1,
      cad: dernier ? (Number(dernier.cad) || 0) + (Number(pf.parPersonneEnPlus) || 0) : 0
    });
    save(); render();
  },
  async delPalierPf(i) {
    const ok = await confirm2('Supprimer ce palier du barème ?', '', 'Supprimer');
    if (!ok) return;
    pfSettings().paliers.splice(i, 1); save(); render();
  },

  /* taux du jour */
  async releverBaremes() {
    toast('Lecture des barèmes sur le site…');
    try {
      const r = await releverBaremesDuSite();
      render();
      toast(r && r.change ? 'Barèmes mis à jour depuis le site ✓' : 'Déjà à jour : le site affiche les mêmes montants.');
    } catch (e) {
      render();
      toast('Relevé impossible : ' + e.message + ' — vos montants sont conservés.');
    }
  },
  async suivreBaremeSite(v) {
    baremeSite().auto = !!v;
    save();
    if (v) { try { await releverBaremesDuSite(); } catch (_) {} }
    render();
    toast(v ? 'Les barèmes suivent désormais le site.' : 'Vous réglez ces montants vous-même.');
  },

  async releverTaux() {
    toast('Relevé du taux du jour…');
    const t = await releverTauxJour();
    render();
    toast(t ? `Taux du jour relevé${t.dateBCE ? ' (cours BCE du ' + frDate(t.dateBCE) + ')' : ''}.`
            : 'Taux du jour indisponible — vérifiez votre connexion. Vos taux saisis restent utilisés.');
  },
  utiliserTauxJour(code) {
    const j = tauxJourPour(code);
    if (!j) return;
    db.settings.rates[code] = Math.round(j * 100) / 100;
    save(); render();
    toast(`Taux ${code} aligné sur le taux du jour : ${fmtCad(db.settings.rates[code])} F.`);
  },

  /* visite médicale */
  vmQty(id, v) {
    const n = Math.max(0, parseInt(v, 10) || 0);
    if (n) VM.sel[id] = n; else delete VM.sel[id];
    enregistrerCalculMedical();
    const r = $('#med-result'); if (r) r.innerHTML = medicalResultHtml();
  },

  effacerCalculMedical() {
    const c = getClient(curId); if (!c) return;
    delete c.calculMedical;
    restaurerCalculMedical(c);   // on retombe sur la tranche déduite de son âge
    touch(c); save(); render();
    toast('Calcul de la visite médicale effacé de cette fiche.');
  },

  medVersDepense() {
    if (refusAssistant()) return;
    const c = getClient(curId); if (!c) return;
    const calc = calculMedicalActuel();
    if (!calc) { toast('Indiquez d\'abord le nombre de personnes.'); return; }
    poserDepenseCalcul(c, 'Visite médicale', libelleCalculMedical(calc), calc.total);
    c.calculMedical = calc;
    touch(c); save();
    curTab = 'finance'; render();
  },

  calcVersDepense() {
    if (refusAssistant()) return;
    const c = getClient(curId); if (!c) return;
    const calc = calculIrccActuel();
    if (!calc) { toast('Cochez d\'abord les frais à calculer.'); return; }
    poserDepenseCalcul(c, 'Frais IRCC', libelleCalculIrcc(calc.lignes), calc.totalFcfa);
    c.calculIrcc = calc;
    touch(c); save();
    curTab = 'finance'; render();   // on montre le résultat dans le volet financier
  },
  calcKey(k) {
    if (k === 'C') CALC.expr = '';
    else if (k === '⌫') CALC.expr = CALC.expr.slice(0, -1);
    else if (k === '=') {
      const raw = CALC.expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '.');
      if (/^[0-9+\-*/().%\s]*$/.test(raw) && raw.trim()) {
        try {
          const expr = raw.replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');
          const r = Function('"use strict";return (' + expr + ')')();
          CALC.expr = (typeof r === 'number' && isFinite(r)) ? String(Math.round(r * 1e6) / 1e6) : 'Erreur';
        } catch (_) { CALC.expr = 'Erreur'; }
      }
    } else {
      if (CALC.expr === 'Erreur') CALC.expr = '';
      CALC.expr += k;
    }
    const d = $('#calc-display'); if (d) d.value = CALC.expr;
  },

  /* paramètres */
  async addRate() {
    const code = (await askText('Code de la devise (ex. : GBP)') || '').trim().toUpperCase();
    if (!code) return;
    if (db.settings.rates[code] !== undefined) { toast('Cette devise existe déjà.'); return; }
    db.settings.rates[code] = 0;
    save(); render();
  },
  async delRate(code) {
    const ok = await confirm2(`Supprimer la devise ${code} ?`, '', 'Supprimer');
    if (!ok) return;
    delete db.settings.rates[code];
    save(); render();
  },
  addTrancheMed() {
    const v = medSettings();
    const dernier = v.tranches[v.tranches.length - 1];
    const min = dernier ? (Number(dernier.max) || Number(dernier.min) || 0) + 1 : 0;
    v.tranches.push({ id: uid(), label: 'Nouvelle tranche', min, max: null, fcfa: 0 });
    save(); render();
  },
  async delTrancheMed(i) {
    const ok = await confirm2('Supprimer cette tranche du barème ?', 'Les calculs déjà enregistrés dans les fiches ne changent pas.', 'Supprimer');
    if (!ok) return;
    const t = db.settings.visiteMedicale.tranches[i];
    if (t) delete VM.sel[t.id];
    db.settings.visiteMedicale.tranches.splice(i, 1);
    save(); render();
  },
  addFee() { db.settings.feeCatalog.push({ label: 'Nouveau frais', amount: 0, forfait: false }); save(); render(); },
  async delFee(i) {
    const ok = await confirm2('Supprimer ce frais du catalogue ?', '', 'Supprimer');
    if (!ok) return;
    db.settings.feeCatalog.splice(i, 1); IR.sel = {}; save(); render();
  },
  addTpl() { db.settings.customTemplate.push({ label: 'Nouveau champ', type: 'short' }); save(); render(); },
  async delTpl(i) { db.settings.customTemplate.splice(i, 1); save(); render(); },

  async chooseCloud() {
    if (!HAS_API) { toast('Disponible uniquement dans l\'application de bureau.'); return; }
    const dir = await window.api.chooseDir();
    if (dir) { db.settings.cloudBackupDir = dir; save(); render(); toast('Dossier cloud enregistré.'); }
  },
  clearCloud() { db.settings.cloudBackupDir = ''; save(); render(); },

  /* Mot de passe du mode administrateur. Ces trois actions ne sont proposées
     QUE dans une ouverture administrateur (la carte n'existe pas ailleurs), et
     elles refusent quand même de s'exécuter en assistant(e). */
  async lockEnable() {
    if (refusReglageAdmin()) return;
    const p1 = await askText('Choisissez un mot de passe', 'password'); if (!p1) return;
    const p2 = await askText('Confirmez le mot de passe', 'password');
    if (p1 !== p2) { toast('Les deux saisies ne correspondent pas.'); return; }
    await poserMdp(p1);
    await poserCodeSecours();      // le double des clés naît avec la serrure
    save(); render(); toast('Mot de passe défini — notez le code de secours affiché.');
  },
  async lockChange() {
    if (refusReglageAdmin()) return;
    const cur = await askText('Mot de passe actuel', 'password'); if (cur === null) return;
    if (!(await mdpCorrect(cur))) { toast('Mot de passe incorrect.'); return; }
    const p1 = await askText('Nouveau mot de passe', 'password'); if (!p1) return;
    const p2 = await askText('Confirmez le nouveau mot de passe', 'password');
    if (p1 !== p2) { toast('Les deux saisies ne correspondent pas.'); return; }
    await poserMdp(p1);
    // nouveau mot de passe, nouveau code : l'ancien papier ne doit plus ouvrir
    await poserCodeSecours();
    save(); render(); toast('Mot de passe modifié — un nouveau code de secours est affiché.');
  },
  async lockDisable() {
    if (refusReglageAdmin()) return;
    const cur = await askText('Mot de passe actuel', 'password'); if (cur === null) return;
    if (!(await mdpCorrect(cur))) { toast('Mot de passe incorrect.'); return; }
    const ok = await confirm2('Retirer le mot de passe administrateur ?',
      'Sans mot de passe, n\'importe qui pourra choisir « Administrateur » à l\'ouverture et voir vos échéanciers, versements, dépenses et bénéfices.',
      'Retirer');
    if (!ok) return;
    db.settings.lockHash = ''; db.settings.lockSalt = '';
    db.settings.lockSecoursHash = ''; db.settings.lockSecoursSalt = '';
    codeSecoursAffiche = '';
    save(); render(); toast('Mot de passe retiré.');
  },

  /* Le code de secours n'est montré qu'une fois. Ces trois gestes existent pour
     qu'il finisse sur un papier ou dans un coffre, pas dans un souvenir. */
  async copierCodeSecours() {
    if (!codeSecoursAffiche) return;
    try { await navigator.clipboard.writeText(codeSecoursAffiche); toast('Code copié.'); }
    catch (_) { toast('Copie impossible — recopiez le code à la main.'); }
  },
  async enregistrerCodeSecours() {
    if (!codeSecoursAffiche) return;
    const texte = `IV Clients — code de secours du mode administrateur\r\n` +
      `Créé le ${new Date().toLocaleString('fr-FR')}\r\n\r\n` +
      `    ${codeSecoursAffiche}\r\n\r\n` +
      `Ce code rouvre le mode administrateur si le mot de passe est oublié.\r\n` +
      `Il ne sert qu'une fois : après usage, un nouveau code est délivré.\r\n` +
      `Rangez ce papier ailleurs que sur cet ordinateur.\r\n`;
    if (HAS_API) { if (await window.api.saveText('IV-Clients-code-de-secours.txt', texte)) toast('Code enregistré.'); }
    else toast('Disponible dans l\'application de bureau.');
  },
  codeSecoursNote() { codeSecoursAffiche = ''; render(); toast('Code masqué. Il ne sera plus affiché.'); },

  /* Déplier / replier les archives. Replier remet aussi la liste à ses trois
     dernières : rouvrir doit toujours donner la même vue courte. */
  ouvrirSauvegardes() {
    if (refusReglageAdmin()) return;
    SAUV.ouvert = !SAUV.ouvert;
    if (!SAUV.ouvert) SAUV.toutes = false;
    render();
  },
  // on ne redessine QUE la liste : déplier ne doit pas faire sauter l'écran
  voirToutesSauvegardes() { SAUV.toutes = !SAUV.toutes; peindreSauvegardes(); },

  /* Restauration demandée. On force D'ABORD l'écriture de l'état actuel : la
     sauvegarde de sécurité prise au lancement ne contiendrait pas le travail de
     la matinée, et se tromper de copie ne doit pas coûter une deuxième fois. */
  async restaurerSauvegarde(nom, date) {
    if (refusReglageAdmin()) return;
    if (!HAS_API || !window.api.restaurerSauvegarde) { toast('Disponible dans l\'application de bureau.'); return; }
    const ok = await confirm2(`Revenir à la copie du ${date} ?`,
      'Toutes vos fiches et vos réglages seront remplacés par leur état de ce moment-là. Ce qui a été saisi depuis sera perdu.\n\nVos données actuelles sont copiées juste avant, dans le dossier des sauvegardes.',
      'Restaurer');
    if (!ok) return;
    /* On ATTEND que l'état actuel soit écrit sur le disque avant de lancer la
       restauration : c'est ce fichier-là que le filet « avant-restauration »
       recopie. Sans l'attente, le filet contiendrait l'état d'il y a dix minutes. */
    clearTimeout(saveTimer); saveTimer = null;
    if (!lectureSeule) await window.api.saveData(db);
    const d = await window.api.restaurerSauvegarde(nom);
    if (!d) { toast('Cette sauvegarde n\'a pas pu être lue — rien n\'a été touché.'); return; }
    db = migrate(d);
    appliquerTheme(); curId = null; view = 'clients'; showCorbeille = false;
    render();
    toast(`Données du ${date} restaurées — ${plur(db.clients.length, 'fiche', 'fiches')}.`);
  },

  /* Revenir à l'écran d'ouverture sans fermer l'application : indispensable
     quand on laisse le poste à quelqu'un d'autre. Repasser en administrateur
     redemande le mot de passe, exactement comme au lancement. */
  async changerMode() {
    // même précaution qu'à la fermeture : un champ encore actif n'a pas forcément
    // émis son « change », et l'écran va disparaître sous les doigts
    const el = document.activeElement;
    if (el && estChampSaisie(el)) { try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {} }
    if (saveTimer) ecrireMaintenant();       // rien ne doit rester en attente d'écriture
    $('#shell').hidden = true;
    await ouvertureFlow();
    $('#shell').hidden = false;
    // un filtre ou un onglet financier laissé par le mode précédent n'a plus lieu d'être
    if (!estAdmin()) { FILTRE.paiement = ''; if (curTab === 'finance') curTab = 'infos'; }
    majPiedRole();
    render();
    toast(estAdmin() ? 'Mode administrateur.' : 'Mode assistant(e) — le volet financier est retiré.');
  },

  async partagerChampsImage() {
    const c = getClient(curId); if (!c) return;
    if (!HAS_API || !window.api.partagerWhatsapp) { toast('Disponible dans l\'application de bureau.'); return; }
    const nom = `Suivi-${(fullName(c).replace(/[^\p{L}\p{N}]+/gu, '-') || 'client')}-${todayISO()}.png`;
    const message = `Bonjour ${c.prenom || ''}, voici le point sur votre dossier.`.replace('  ', ' ');
    try {
      const r = await window.api.partagerWhatsapp(nom, buildChampsImage(c), 900, telWhatsapp(c.telephone), message);
      if (MOBILE) { if (r && !r.annule) toast(r.partage ? 'Image partagée.' : 'Image enregistrée — joignez-la dans WhatsApp.'); return; }
      toast(r && r.copieFichier
        ? 'WhatsApp ouvert — collez l\'image avec Ctrl+V puis envoyez.'
        : 'WhatsApp ouvert — image copiée, collez-la avec Ctrl+V.');
    } catch (e) { toast('Partage impossible : ' + e.message); }
  },

  async exportPdf() {
    const c = getClient(curId);
    if (!c) return;
    if (!HAS_API) { toast('Export PDF disponible dans l\'application de bureau.'); return; }
    const nomFichier = `Fiche-${(fullName(c).replace(/[^\p{L}\p{N}]+/gu, '-') || 'client')}-${todayISO()}.pdf`;
    try {
      const ok = await window.api.exportPdf(nomFichier, buildFichePdf(c));
      if (ok) toast('Fiche exportée en PDF ✓');
    } catch (e) {
      toast('Export impossible : ' + e.message);
    }
  },

  /* chronologie Chronova */
  chronovaChoisir() { const i = $('#chronova-file'); if (i) i.click(); },
  async chronovaFichier(input) {
    const c = getClient(curId); if (!c) return;
    const f = input.files && input.files[0]; input.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const chrono = mapperChronova(data);
      // Garde-fou : le profil Chronova doit porter le même nom que la fiche.
      // Sinon on explique la différence et on demande confirmation (risque d'attacher
      // la chronologie d'un client à la fiche d'un autre).
      if (chrono.profil && normNomComplet(chrono.profil) !== normNomComplet(fullName(c))) {
        const mProfil = motsNom(chrono.profil), mFiche = motsNom(fullName(c));
        const enTrop = mProfil.filter((x) => !mFiche.includes(x));
        const manquants = mFiche.filter((x) => !mProfil.includes(x));
        const detail = [
          enTrop.length ? `dans Chronova seulement : ${enTrop.join(', ')}` : '',
          manquants.length ? `dans la fiche seulement : ${manquants.join(', ')}` : ''
        ].filter(Boolean).join(' ; ');
        const ok = await confirm2(
          `Les noms ne correspondent pas`,
          `Profil Chronova : « ${chrono.profil} »\nFiche ouverte : « ${fullName(c)} »\n\nDifférence — ${detail}.\n\n` +
          `Vérifiez qu'il s'agit bien du même client : attacher la chronologie d'une autre personne fausserait son dossier.\n\n` +
          `Attacher quand même cette chronologie à ${fullName(c)} ?`,
          'Attacher quand même');
        if (!ok) { toast('Import annulé — aucune chronologie attachée.'); return; }
      }
      c.chronova = chrono;
      touch(c); save(); render();
      toast(`Chronologie importée : ${c.chronova.evenements.length} événement(s) ✓`);
    } catch (e) { toast('Import impossible : ' + e.message); }
  },
  async chronovaRetirer() {
    const c = getClient(curId); if (!c || !c.chronova) return;
    const ok = await confirm2('Retirer la chronologie Chronova de cette fiche ?',
      'Elle sera aussi retirée de la copie du site au prochain envoi.', 'Retirer');
    if (!ok) return;
    delete c.chronova;
    touch(c); save(); render();
    toast('Chronologie retirée.');
  },

  /* synchronisation site */
  async syncLogin() {
    const email = ($('#sync-email').value || '').trim();
    const pass = $('#sync-pass').value;
    const err = $('#sync-err');
    if (!email || !pass) { if (err) err.textContent = 'Saisissez votre email et votre mot de passe.'; return; }
    try {
      await sbAuth({ email, password: pass }, 'password');
      db.settings.syncEmail = email;
      db.settings.syncAlerte = '';
      // Le site réclame-t-il en plus le code de vérification ? Sans lui, il
      // répondrait « 0 fiche » sans un mot et l'envoi resterait bloqué.
      const f = await facteurAVerifier();
      if (f) { MFA.factorId = f.id; MFA.nom = f.nom; MFA.erreur = ''; save(); render(); return; }
      save(); render();
      toast('Connecté au site ✓ Vous pouvez maintenant envoyer vos fiches.');
    } catch (e) {
      if (err) err.textContent = /invalid/i.test(e.message) ? 'Email ou mot de passe incorrect.' : 'Connexion impossible : ' + e.message;
    }
  },

  /* Code de vérification à 6 chiffres, lu dans l'application d'authentification. */
  async syncCode() {
    const champ = $('#sync-code');
    const code = champ ? champ.value : '';
    try {
      await presenterCodeMfa(MFA.factorId, code);
      MFA.factorId = ''; MFA.erreur = '';
      db.settings.syncAlerte = '';
      save(); render();
      toast('Code accepté ✓ Le site vous ouvre vos fiches.');
    } catch (e) {
      MFA.erreur = e.codeRefuse ? 'Code refusé. Il change toutes les 30 secondes — reprenez celui affiché maintenant.' : e.message;
      render();
    }
  },
  annulerCode() { MFA.factorId = ''; MFA.erreur = ''; A.syncLogout(); },
  syncLogout() {
    db.settings.syncRefreshToken = ''; sbToken = null; oublierJeton();
    save(); render(); toast('Déconnecté du site (vos fiches locales sont conservées).');
  },
  async syncPush() {
    try { await pushFiches(false); db.settings.syncAlerte = ''; save(); render(); }
    catch (e) { signalerEchecSync(e); toast('Envoi impossible : ' + messageReseau(e)); }
  },
  async syncPull() { try { await pullFiches(); } catch (e) { toast('Récupération impossible : ' + messageReseau(e)); } },
  syncAutoToggle(v) { db.settings.syncAuto = !!v; save(); },

  async exportCsv() {
    // les trois colonnes d'argent ne sortent pas d'une ouverture en assistant(e) :
    // un fichier exporté circule, il ne doit pas contourner le cloisonnement
    const argent = estAdmin();
    const cols = ['Prénom', 'Nom', 'Date de naissance', 'Âge', 'Pays de naissance', 'Ville de naissance', 'Téléphone', 'N° de passeport', 'Statut matrimonial', 'NIU', 'Mail IRCC', 'CNP', 'Résidence IRCC', 'Date AOR', 'Jours depuis AOR', 'Étape en cours', 'IUC', 'N° demande', 'Score CRS', 'Champs personnalisés', 'Diplômes IRCC', "Domaines d'études", 'Employeur IRCC', 'Poste occupé', "Début d'emploi", 'Tâches IRCC',
      ...(argent ? ['Total versé', 'Total dépenses', 'Bénéfice'] : []), 'Archivé'];
    const rows = db.clients.map((c) => {
      const f = argent ? finTotals(c) : null;
      // les champs personnalisés (ITA, DI, IBIO, BIO…) tiennent dans une seule colonne
      const perso = (c.custom || []).map((f) => `${f.label} : ${f.type === 'check' ? (f.value ? 'oui' : 'non') : f.type === 'date' ? frDate(f.value) : (f.value ?? '')}`).join(' · ');
      return [c.prenom, c.nom, frDate(c.dateNaissance), ageOf(c.dateNaissance) ?? '', c.paysNaissance, c.villeNaissance, c.telephone, c.numPasseport, c.statutMatrimonial, c.niu, c.mailIrcc, c.cnp, c.residenceIrcc, frDate(dateAorDe(c)), daysSince(dateAorDe(c)) ?? '', avancement(c).titre, c.iuc, c.numDemande, c.scoreCrs, perso, c.diplomesIrcc, c.domainesEtudes, c.employeurIrcc, c.posteIrcc, frDate(c.debutEmploi), c.tachesIrcc,
        ...(argent ? [f.verse, f.depenses, f.benefice] : []), c.archive ? 'oui' : 'non'];
    });
    const csv = '﻿' + [cols, ...rows].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    if (HAS_API) {
      const ok = await window.api.saveText(`clients-iv-${todayISO()}.csv`, csv);
      if (ok) toast('Export CSV enregistré.');
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `clients-iv-${todayISO()}.csv`; a.click();
    }
  }
};
window.A = A;

/* ================= Liaison des champs (délégation) ================= */

/* Re-dessin « doux » : tant que l'utilisateur est DANS un champ de saisie (date, texte,
   nombre…), on ne re-dessine PAS l'écran — sinon le champ perd le focus en pleine frappe
   (bug « 0001 » sur les années) et la touche Tab ne permet plus d'enchaîner les champs.
   Le re-dessin (chips, âges, totaux…) se fait dès que le focus quitte le formulaire.
   Ce mécanisme est GLOBAL : il couvre tous les champs actuels et futurs (délégation),
   y compris les champs personnalisés de type date créés plus tard. */
let renderPending = false;

function estChampSaisie(el) {
  if (!el || !el.closest || !el.closest('#main')) return false;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && ['date', 'month', 'number', 'text', 'tel', 'email'].includes(el.type);
}

/* Le focus est-il encore SUR UN ELEMENT du formulaire ? (audit du 23/08/2026)
   Ne compter que les champs de texte ne suffisait pas : passer d'un champ a une
   liste deroulante, une case a cocher ou un bouton redessinait l'ecran et
   detruisait l'element qui venait de recevoir le focus — la touche Tab
   s'arretait net, et le premier clic sur un bouton etait avale. */
function focusDansFormulaire(el) {
  return !!(el && el !== document.body && el.closest && el.closest('#main'));
}

/* Re-dessin qui attend poliment que l'utilisateur ait quitte le formulaire */
function renderSiLibre() {
  if (focusDansFormulaire(document.activeElement)) { renderPending = true; return; }
  render();
}

function renderSoft() {
  // TOUJOURS différé : au moment d'un « change », le focus peut être en transit
  // entre deux champs (ex. : on modifie le montant puis on clique sur le libellé) —
  // décider immédiatement re-dessinait l'écran et détruisait le champ fraîchement cliqué.
  renderPending = true;
  clearTimeout(renderSoft._t);
  renderSoft._t = setTimeout(() => {
    if (renderPending && !focusDansFormulaire(document.activeElement)) render();
  }, 120);
}

function handleChange(e) {
  const el = e.target;
  const c = view === 'client' ? getClient(curId) : null;

  /* Valeurs enregistrées lues comme des DONNÉES, jamais recollées dans du code :
     une clé de tâche contient un identifiant de fiche, et un identifiant de
     tranche vient du fichier de réglages (audit du 23/08/2026). */
  if (el.dataset.tache !== undefined) { A.tacheFaite(el.dataset.tache, el.checked); return; }
  if (el.dataset.tranche !== undefined) { A.vmQty(el.dataset.tranche, el.value); return; }

  if (el.dataset.field !== undefined && c) {
    let v = el.value;
    if (el.dataset.field === 'nom' || el.dataset.field === 'prenom') v = toTitleCase(v);
    c[el.dataset.field] = v;
    // tant qu'aucun calcul n'est enregistré, la tranche du client suit sa date de naissance
    if (el.dataset.field === 'dateNaissance' && !c.calculMedical) restaurerCalculMedical(c);
    touch(c); save(); renderSoft(el); return;
  }

  if (el.dataset.cfid && c) {
    const f = c.custom.find((x) => x.id === el.dataset.cfid);
    if (!f) return;
    const p = el.dataset.cfprop;
    if (p === 'value') f.value = f.type === 'check' ? el.checked : el.value;
    else if (p === 'frise') f.frise = el.checked;
    else if (p === 'type') {
      // Changer le type effaçait la valeur SUR-LE-CHAMP, sans confirmation — un
      // coup de molette sur la liste suffisait (audit du 23/08/2026).
      // On convertit ce qui peut l'être, on ne jette que l'impossible.
      const ancien = f.type, valeur = f.value;
      f.type = el.value;
      if (f.type === 'check') f.value = !!valeur && valeur !== 'false' && valeur !== '0';
      else if (ancien === 'check') f.value = valeur ? 'oui' : '';
      else if (f.type === 'date') f.value = /^\d{4}-\d{2}-\d{2}$/.test(String(valeur)) ? valeur : '';
      else if (f.type === 'number') f.value = String(valeur).replace(',', '.').match(/-?\d+(\.\d+)?/) ? String(valeur).replace(',', '.').match(/-?\d+(\.\d+)?/)[0] : '';
      else f.value = valeur == null ? '' : String(valeur);   // texte court <-> texte long : rien ne se perd
      if (f.type !== 'date') f.frise = false;
      if (valeur && !f.value) toast('La valeur « ' + String(valeur).slice(0, 30) + ' » ne se convertit pas dans ce type : elle a été retirée.');
    }
    else f.label = el.value;
    touch(c); save(); renderSoft(el); return;
  }

  if (el.dataset.fin && c) {
    const row = c.finance[el.dataset.fin][Number(el.dataset.idx)];
    if (!row) return;
    const p = el.dataset.prop;
    if (p === 'montant') row.montant = parseMoney(el.value);
    else if (p === 'paye') { row.paye = el.checked; row.datePaiement = el.checked ? todayISO() : ''; }
    else row[p] = el.value;
    touch(c); save(); renderSoft(el); return;
  }

  if (el.dataset.rate !== undefined) { db.settings.rates[el.dataset.rate] = parseFloat(el.value) || 0; save(); renderSoft(el); return; }
  if (el.dataset.cfg !== undefined) { db.settings[el.dataset.cfg] = parseFloat(el.value) || 0; save(); renderSoft(el); return; }
  if (el.dataset.feeIdx !== undefined) {
    const f = db.settings.feeCatalog[Number(el.dataset.feeIdx)];
    if (f) {
      if (el.dataset.feeProp === 'amount') f.amount = parseFloat(el.value) || 0;
      else if (el.dataset.feeProp === 'forfait') { f.forfait = el.checked; if (f.forfait && IR.sel[Number(el.dataset.feeIdx)]) IR.sel[Number(el.dataset.feeIdx)] = 1; }
      else f.label = el.value;
    }
    save(); renderSoft(el); return;
  }
  if (el.dataset.pfMaj !== undefined) { pfSettings().maj = el.value; save(); renderSoft(el); return; }
  if (el.dataset.pfExtra !== undefined) { pfSettings().parPersonneEnPlus = Math.max(0, parseInt(el.value, 10) || 0); save(); renderSoft(el); return; }
  if (el.dataset.pfIdx !== undefined) {
    const p = pfSettings().paliers[Number(el.dataset.pfIdx)];
    if (p) {
      if (el.dataset.pfProp === 'personnes') p.personnes = Math.max(1, parseInt(el.value, 10) || 1);
      else p.cad = Math.max(0, parseInt(el.value, 10) || 0);
    }
    save(); renderSoft(el); return;
  }
  if (el.dataset.medMois !== undefined) { medSettings().mois = el.value; save(); renderSoft(el); return; }
  if (el.dataset.medIdx !== undefined) {
    const t = medSettings().tranches[Number(el.dataset.medIdx)];
    if (t) {
      const p = el.dataset.medProp;
      if (p === 'fcfa') t.fcfa = parseMoney(el.value);
      else if (p === 'min') t.min = Math.max(0, parseInt(el.value, 10) || 0);
      else if (p === 'max') t.max = el.value === '' ? null : Math.max(0, parseInt(el.value, 10) || 0);
      else t.label = el.value;
    }
    save(); renderSoft(el); return;
  }
  if (el.dataset.tplIdx !== undefined) {
    const t = db.settings.customTemplate[Number(el.dataset.tplIdx)];
    if (t) { if (el.dataset.tplProp === 'type') t.type = el.value; else t.label = el.value; }
    save(); return;
  }
}

function handleInput(e) {
  const el = e.target;
  if (el.id === 'clients-search') { search = el.value; majListeClients(); return; }
  if (el.id === 'conv-amount') { CV.amount = el.value; const r = $('#conv-result'); if (r) r.innerHTML = convResultHtml(); return; }
  if (el.dataset.money !== undefined) {
    // On passe par parseMoney : un montant COLLÉ avec ses centimes
    // (« 1 500 000,00 ») était sinon recopié en 150 000 000.
    // Tant que l'utilisateur est en train de taper une virgule, on le laisse faire.
    if (/[.,]\d?$/.test(el.value)) return;
    const v = parseMoney(el.value);
    el.value = v ? fmt(v) : (el.value.trim() === '' ? '' : el.value.replace(/[^\d\s-]/g, ''));
    return;
  }
}

/* Page Paramètres : toutes les colonnes de cartes finissent à la même hauteur
   (demande d'Alex du 06/10/2026). Les cartes gardent l'ordre de lecture, colonne
   par colonne, comme avant ; on choisit seulement les coupures qui rendent les
   colonnes les plus égales possible, puis la dernière carte de chaque colonne
   s'allonge jusqu'au bas commun. L'alignement est tenu par la grille CSS : il
   reste juste quand une carte grandit après coup (liste des sauvegardes…). */
const COLONNE_LARGEUR = 320, COLONNE_ECART = 18;   // les valeurs de .masonry dans styles.css

function equilibrerColonnes() {
  document.querySelectorAll('#main .masonry').forEach((m) => {
    const n = getComputedStyle(m).columnCount === '1' ? 1
      : Math.max(1, Math.floor((m.clientWidth + COLONNE_ECART) / (COLONNE_LARGEUR + COLONNE_ECART)));
    // même nombre de colonnes (clavier du téléphone qui s'ouvre, par exemple) : on ne touche à rien
    if (m.classList.contains('equilibree') && Number(m.dataset.colonnes) === n) return;
    const actif = document.activeElement;
    if (m.classList.contains('equilibree')) {
      m.replaceChildren(...m.querySelectorAll(':scope > .masonry-col > .card'));
      m.classList.remove('equilibree');
    }
    const cartes = [...m.children];
    const nb = Math.min(n, cartes.length);
    if (nb < 2) return;

    // hauteurs mesurées dans la disposition en colonnes d'origine (même largeur)
    const h = cartes.map((c) => c.offsetHeight);
    const cumul = [0];
    h.forEach((x, i) => cumul.push(cumul[i] + x));
    const haut = (de, a) => cumul[a] - cumul[de] + COLONNE_ECART * (a - de - 1);
    // meil[j][i] : la plus petite « plus haute colonne » pour les i premières cartes en j colonnes
    const meil = [[]], coupe = [[]];
    for (let j = 1; j <= nb; j++) {
      meil[j] = []; coupe[j] = [];
      for (let i = j; i <= cartes.length; i++) {
        if (j === 1) { meil[1][i] = haut(0, i); coupe[1][i] = 0; continue; }
        meil[j][i] = Infinity;
        for (let p = j - 1; p < i; p++) {
          const v = Math.max(meil[j - 1][p], haut(p, i));
          if (v < meil[j][i]) { meil[j][i] = v; coupe[j][i] = p; }
        }
      }
    }
    const bornes = [cartes.length];
    for (let j = nb, i = cartes.length; j > 1; j--) { i = coupe[j][i]; bornes.unshift(i); }
    bornes.unshift(0);

    const colonnes = [];
    for (let j = 0; j < nb; j++) {
      const col = document.createElement('div');
      col.className = 'masonry-col';
      col.append(...cartes.slice(bornes[j], bornes[j + 1]));
      colonnes.push(col);
    }
    m.style.setProperty('--colonnes', nb);
    m.dataset.colonnes = n;
    m.replaceChildren(...colonnes);
    m.classList.add('equilibree');
    if (actif && m.contains(actif)) actif.focus({ preventScroll: true });
  });
}
addEventListener('resize', () => { clearTimeout(equilibrerColonnes._t); equilibrerColonnes._t = setTimeout(equilibrerColonnes, 150); });

function afterRender() {
  equilibrerColonnes();
  const cc = $('#conv-cur'), cd = $('#conv-dir');
  if (cc) cc.onchange = () => { CV.cur = cc.value; const r = $('#conv-result'); if (r) r.innerHTML = convResultHtml(); };
  if (cd) cd.onchange = () => { CV.dir = cd.value; const r = $('#conv-result'); if (r) r.innerHTML = convResultHtml(); };

  // état réel de la copie cloud : un échec ne doit plus rester invisible
  // la calculatrice ne répondait qu'à la souris : taper au pavé ne faisait rien
  const calc = $('#calc-display');
  if (calc) {
    calc.onkeydown = (e) => {
      const k = e.key;
      let touche = null;
      if (/^[0-9]$/.test(k)) touche = k;
      else if (k === '.' || k === ',') touche = '.';
      else if (k === '+') touche = '+';
      else if (k === '-') touche = '−';
      else if (k === '*') touche = '×';
      else if (k === '/') touche = '÷';
      else if (k === '%') touche = '%';
      else if (k === '(' || k === ')') touche = k;
      else if (k === 'Enter' || k === '=') touche = '=';
      else if (k === 'Backspace') touche = '⌫';
      else if (k === 'Escape' || k === 'Delete') touche = 'C';
      if (touche === null) return;
      e.preventDefault();
      A.calcKey(touche);
    };
  }

  const zone = $('#etat-cloud');
  if (zone && HAS_API && window.api.etatCloud) {
    window.api.etatCloud().then((e) => {
      const z = $('#etat-cloud'); if (!z) return;
      if (e && e.ok === true) {
        z.className = 'computed';
        z.textContent = 'Dernière copie réussie le ' + new Date(e.quand).toLocaleString('fr-FR') + '.';
      } else if (e && e.ok === false) {
        z.className = 'computed alarm';
        z.textContent = '⚠ Copie impossible depuis le ' + new Date(e.quand).toLocaleString('fr-FR') + ' : ' + e.erreur;
      } else {
        z.className = 'computed warn';
        z.textContent = 'Aucune copie tentée depuis l\'ouverture de l\'application.';
      }
    }).catch(() => {});
  }

  const zoneSauv = $('#liste-sauvegardes');
  if (zoneSauv) {
    if (!HAS_API || !window.api.listerSauvegardes) {
      zoneSauv.textContent = 'Disponible dans l\'application de bureau.';
    } else {
      peindreSauvegardes();          // affichage immédiat si la liste est déjà connue
      window.api.listerSauvegardes()
        .then((liste) => { SAUV.liste = liste || []; peindreSauvegardes(); })
        .catch(() => { const z = $('#liste-sauvegardes'); if (z) z.textContent = 'Lecture des sauvegardes impossible.'; });
    }
  }
}

/* Dessine la liste des sauvegardes SANS refaire tout l'écran : déplier ou
   replier ne doit pas relancer une lecture du disque ni faire sauter la page. */
function peindreSauvegardes() {
  const z = $('#liste-sauvegardes'); if (!z) return;
  const liste = SAUV.liste;
  if (!liste) return;                                   // lecture en cours
  if (!liste.length) { z.className = 'computed'; z.textContent = 'Aucune sauvegarde pour le moment.'; return; }

  const montrees = SAUV.toutes ? liste : liste.slice(0, SAUVEGARDES_MONTREES);
  const reste = liste.length - montrees.length;
  z.className = '';
  z.innerHTML = `<table><thead><tr><th>Copie du</th><th style="width:150px"></th></tr></thead><tbody>` +
    montrees.map((x) => `<tr>
      <td>${esc(x.date)}${x.avantRestauration ? ' <span class="chip amber">état d\'avant une restauration</span>' : ''}</td>
      <td style="text-align:right"><button class="btn btn-ghost btn-small" data-agir="sauvegarde-restaurer" data-nom="${esc(x.nom)}" data-date="${esc(x.date)}">Restaurer</button></td>
    </tr>`).join('') + `</tbody></table>` +
    (liste.length > SAUVEGARDES_MONTREES
      ? `<button class="lien-deplier" data-agir="sauvegardes-toutes" style="margin-top:10px">
           <span class="chevron">${SAUV.toutes ? '▴' : '▾'}</span>
           ${SAUV.toutes ? 'Ne montrer que les ' + SAUVEGARDES_MONTREES + ' dernières' : 'Voir ' + plur(reste, 'copie plus ancienne', 'copies plus anciennes')}
         </button>`
      : '');
}

function appliquerTheme() {
  const sombre = db && db.settings && db.settings.theme === 'sombre';
  document.documentElement.setAttribute('data-theme', sombre ? 'sombre' : 'clair');
}

/* ================= Écran d'ouverture + démarrage ================= */

/* Rappel permanent du mode en cours, en bas de la barre latérale. Sans lui, on
   peut travailler une heure en croyant être dans l'autre mode — et s'étonner de
   ne pas trouver les finances, ou pire, les laisser à l'écran devant quelqu'un. */
function majPiedRole() {
  const el = $('#foot-role'); if (!el) return;
  el.innerHTML = `<span class="puce">${estAdmin() ? 'Administrateur' : 'Assistant(e)'}</span>
    <button type="button" onclick="A.changerMode()">Changer de mode</button>`;
}

/* Écran d'ouverture : le mode est demandé à chaque lancement.
   Administrateur → mot de passe s'il en existe un. Assistant(e) → entrée directe. */
function ouvertureFlow() {
  return new Promise((resolve) => {
    const ecran = $('#ouverture'), choix = $('#ouv-choix');
    const panMdp = $('#ouv-mdp'), panSec = $('#ouv-secours');
    const input = $('#lock-input'), err = $('#lock-err');
    const inputSec = $('#secours-input'), errSec = $('#secours-err');

    /* Aucun texte ne décrit ici ce que contient le mode administrateur, ni même
       s'il est protégé : cet écran s'affiche devant tout le monde. Le rappel
       « aucun mot de passe défini » reste dans les Paramètres, où vous seul le
       lisez, en ouverture administrateur. */

    const panneau = (quel) => {
      choix.hidden = quel !== 'choix';
      panMdp.hidden = quel !== 'mdp';
      panSec.hidden = quel !== 'secours';
      err.hidden = true; errSec.hidden = true;
      input.value = ''; inputSec.value = '';
    };
    const entrer = (r) => {
      role = r;
      ecran.hidden = true;
      input.value = ''; inputSec.value = '';
      err.hidden = true; errSec.hidden = true;
      resolve();
    };
    const voirChoix = () => { panneau('choix'); $('#ouv-admin').focus(); };
    const voirMdp = () => { panneau('mdp'); input.focus(); };

    const valider = async () => {
      if (await mdpCorrect(input.value)) entrer('admin');
      else { err.hidden = false; input.value = ''; input.focus(); }
    };

    /* Code de secours. Il ne sert QU'UNE FOIS : après usage on impose un nouveau
       mot de passe et un nouveau code — le papier qui traînait ne rouvre plus
       rien. Tant que le nouveau mot de passe n'est pas posé, on n'entre pas. */
    const validerSecours = async () => {
      if (!(await codeSecoursCorrect(inputSec.value))) {
        errSec.hidden = false; inputSec.value = ''; inputSec.focus(); return;
      }
      const p1 = await askText('Code accepté — choisissez un nouveau mot de passe', 'password');
      if (!p1) { inputSec.focus(); return; }
      const p2 = await askText('Confirmez le nouveau mot de passe', 'password');
      if (p1 !== p2) { toast('Les deux saisies ne correspondent pas — recommencez.'); inputSec.focus(); return; }
      await poserMdp(p1);
      await poserCodeSecours();          // l'ancien code est aussitôt périmé
      ecrireMaintenant();
      entrer('admin');
      view = 'settings';                 // le nouveau code y est affiché, à noter
      toast('Mot de passe remplacé — notez le nouveau code de secours.');
    };

    $('#ouv-admin').onclick = () => {
      if (!db.settings.lockHash) { entrer('admin'); return; }
      voirMdp();
    };
    $('#ouv-assist').onclick = () => entrer('assistant');
    $('#ouv-retour').onclick = voirChoix;
    $('#lock-btn').onclick = valider;
    $('#ouv-oubli').onclick = () => {
      if (!db.settings.lockSecoursHash) {
        toast('Aucun code de secours n\'a été délivré pour ce mot de passe.');
        return;
      }
      panneau('secours'); inputSec.focus();
    };
    $('#secours-btn').onclick = validerSecours;
    $('#secours-retour').onclick = voirMdp;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') valider();
      if (e.key === 'Escape') voirChoix();
    };
    inputSec.onkeydown = (e) => {
      if (e.key === 'Enter') validerSecours();
      if (e.key === 'Escape') voirMdp();
    };

    voirChoix();
    ecran.hidden = false;
    $('#ouv-admin').focus();
  });
}

/* Fichier de données illisible : jusqu'ici l'application démarrait VIDE sans un
   mot, puis la première action réécrivait un fichier vide par-dessus — réglages,
   jeton, barèmes et mot de passe perdus (audit du 23/08/2026). On bloque
   désormais toute écriture et on propose de restaurer une sauvegarde. */
async function traiterFichierCorrompu() {
  if (!fichierCorrompu) return;
  lectureSeule = true;
  const sauv = fichierCorrompu.sauvegardes || [];
  const detail =
    'Vos données n\'ont pas pu être lues. Le fichier abîmé a été mis de côté, il n\'a PAS été effacé :\n' +
    fichierCorrompu.chemin + '\n\n' +
    (sauv.length
      ? `La sauvegarde la plus récente date du ${sauv[0].date}.\n\nLa restaurer maintenant ?`
      : 'Aucune sauvegarde n\'a été trouvée.\n\nL\'application va rester en lecture seule pour ne rien écraser.');

  if (!sauv.length) {
    if (HAS_API && window.api.messageDialog) await window.api.messageDialog('Données illisibles', detail);
    return;
  }
  const ok = await confirm2('Vos données n\'ont pas pu être lues', detail, 'Restaurer');
  if (!ok) return;   // on reste en lecture seule : rien ne sera écrasé
  const restaure = HAS_API ? await window.api.restaurerSauvegarde(sauv[0].nom) : null;
  if (restaure) {
    db = migrate(restaure);
    lectureSeule = false; fichierCorrompu = null;
    toast(`Sauvegarde du ${sauv[0].date} restaurée — ${db.clients.length} fiche(s).`);
  } else if (HAS_API && window.api.messageDialog) {
    await window.api.messageDialog('Restauration impossible',
      'La sauvegarde n\'a pas pu être lue non plus. L\'application reste en lecture seule ; le dossier des sauvegardes se trouve dans %APPDATA%\\IV Clients\\sauvegardes.');
  }
}

/* ================= Mises à jour (04/10/2026) =================
   Une seule question part : « y a-t-il une nouvelle version ? ». La bulle ne
   bloque rien ; le travail continue dessous. Tout le contrôle (signature,
   empreinte, reprise) se fait dans le processus principal (mise-a-jour.js). */
const MAJ = { info: null, etat: '', progres: null, erreur: '', echec: null, portable: false, verif: null, enVerif: false };

const fmtMo = (o) => (o / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: o < 10485760 ? 1 : 0 }) + ' Mo';

function vCarteMaj() {
  const auto = !!db.settings.majAuto;
  const v = MAJ.verif;
  let point = '', texte = 'Pas encore vérifié depuis l\'ouverture.';
  if (MAJ.enVerif) texte = 'Vérification en cours…';
  else if (MAJ.etat === 'programmee' || MAJ.etat === 'prete') { point = 'neuf'; texte = `La version ${esc(MAJ.info.version)} est téléchargée${MAJ.etat === 'programmee' ? ' — elle s\'installera à la fermeture' : ''}.`; }
  else if (v) {
    const h = new Date(v.quand).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (v.r.etat === 'a-jour') { point = 'ok'; texte = `À jour — vérifié à ${h}.`; }
    else if (v.r.etat === 'nouvelle') { point = 'neuf'; texte = `Version ${esc(v.r.version)} disponible — vérifié à ${h}.`; }
    else if (v.r.etat === 'inactif') texte = 'Vérification désactivée dans cette copie de développement.';
    else { point = 'alerte'; texte = `Vérification impossible à ${h} : ${esc(v.r.raison || 'erreur inconnue')}.`; }
  }
  return `<div class="card">
      <h2>${ico('maj')} Mises à jour <span class="hint">version ${esc(APP_INFO.version)}</span></h2>
      <label class="maj-reglage${MAJ.portable ? ' inactif' : ''}">
        <input type="checkbox" ${auto && !MAJ.portable ? 'checked' : ''} ${MAJ.portable ? 'disabled' : ''} onchange="A.majAuto(this.checked)">
        <span>Installer les mises à jour automatiquement<br><span class="muted" style="font-size:var(--t-sm)">${MAJ.portable
          ? 'Indisponible dans la version portable : elle ne s\'installe pas, elle se remplace. Téléchargez la nouvelle depuis la page quand elle est annoncée.'
          : 'La nouvelle version est téléchargée en arrière-plan et s\'installe quand vous fermez le logiciel.'}</span></span>
      </label>
      <div class="maj-etat"><span class="point ${point}"></span><span>${texte}</span></div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-small" onclick="A.majVerifier()" ${MAJ.enVerif ? 'disabled' : ''}>${ico('maj', 'ico ico-sm')} Vérifier maintenant</button>
      </div>
      <p class="help-text">À l'ouverture, le logiciel demande une fois au serveur des mises à jour (GitHub) s'il existe une nouvelle version. <b>Aucune de vos données ne part</b> : ni fiche, ni réglage, ni nom. Chaque version publiée est signée ; un fichier dont la signature ou l'empreinte ne correspond pas est refusé.</p>
    </div>`;
}

function majBulle(etat) {
  MAJ.etat = etat || '';
  const el = $('#maj-bulle');
  if (!etat) { el.hidden = true; el.innerHTML = ''; return; }
  const i = MAJ.info || {};
  const tete = (cls, titre, sous) => `<div class="maj-tete">
      <div class="maj-pastille ${cls}">${ico(cls === 'alerte' ? 'info' : 'maj')}</div>
      <div class="maj-titre"><b>${titre}</b>${sous ? `<span>${sous}</span>` : ''}</div>
      <button class="maj-fermer" data-maj="plus-tard" aria-label="Fermer" title="Fermer">${ico('fermer', 'ico ico-sm')}</button>
    </div>`;
  const nouveautes = () => {
    const j = (i.journal || []).filter((x) => x && Array.isArray(x.entrees) && x.entrees.length);
    if (!j.length) return '';
    const plusieurs = j.length > 1;
    return `<ul class="maj-nouveautes">${j.map((x) => (plusieurs ? `<li class="maj-v">Version ${esc(x.version)}</li>` : '') +
      x.entrees.map((e) => `<li>${esc(e)}</li>`).join('')).join('')}</ul>`;
  };
  const btn = (action, libelle, primaire) => `<button class="btn ${primaire ? 'btn-primary' : 'btn-ghost'} btn-small" data-maj="${action}">${libelle}</button>`;
  let h = '';
  if (etat === 'annonce') {
    h = tete('', `IV Clients ${esc(i.version)} est disponible`, `Vous avez la ${esc(i.actuelle)}${i.taille ? ' · ' + fmtMo(i.taille) : ''}`) + nouveautes() +
      (i.portable
        ? `<p class="maj-texte">Vous utilisez la version portable : téléchargez la nouvelle depuis la page, puis remplacez l'ancien fichier.</p>
           <div class="maj-actions">${btn('plus-tard', 'Plus tard')}${btn('page', 'Ouvrir la page de téléchargement', true)}</div>`
        : `<div class="maj-actions">${btn('plus-tard', 'Plus tard')}${btn(i.telechargee ? 'pret' : 'telecharger', 'Mettre à jour', true)}</div>`);
  } else if (etat === 'telechargement') {
    const p = MAJ.progres, pct = p && p.total ? Math.floor(p.recu / p.total * 100) : 0;
    h = tete('', `Téléchargement de la ${esc(i.version)}`, 'Vous pouvez continuer à travailler') +
      `<div class="maj-barre"><i style="width:${pct}%"></i></div>
       <div class="maj-chiffres">${p ? `${pct} % — ${fmtMo(p.recu)} sur ${fmtMo(p.total)}` : 'Connexion…'}</div>`;
  } else if (etat === 'prete') {
    h = tete('ok', `La ${esc(i.version)} est prête`, 'Téléchargée et vérifiée') +
      `<p class="maj-texte">L'installation ferme IV Clients une minute, puis le rouvre tout seul. Vos données ne sont pas touchées.</p>
       <div class="maj-actions">${btn('fermeture', 'À la fermeture')}${btn('installer', 'Installer maintenant', true)}</div>`;
  } else if (etat === 'programmee') {
    h = tete('ok', `La ${esc(i.version)} s'installera à la fermeture`, 'Rien d\'autre à faire') +
      `<p class="maj-texte">Continuez votre travail : quand vous fermerez IV Clients, la nouvelle version s'installera. Elle sera là à la prochaine ouverture.</p>
       <div class="maj-actions">${btn('plus-tard', 'Compris')}${btn('installer', 'Installer maintenant', true)}</div>`;
  } else if (etat === 'saisie') {
    h = tete('alerte', 'Une saisie est en cours', '') +
      `<p class="maj-texte">Une fenêtre de saisie est ouverte : l'installer maintenant la ferait perdre. Terminez-la, ou laissez la mise à jour se faire quand vous fermerez le logiciel.</p>
       <div class="maj-actions">${btn('prete', 'Retour')}${btn('fermeture', 'À la fermeture', true)}</div>`;
  } else if (etat === 'installation') {
    h = tete('ok', 'Installation de la mise à jour', 'IV Clients va se fermer puis se rouvrir');
  } else if (etat === 'erreur') {
    h = tete('alerte', 'La mise à jour n\'a pas pu se faire', i.version ? 'Version ' + esc(i.version) : '') +
      `<p class="maj-texte erreur">${esc(MAJ.erreur)}.</p>
       <div class="maj-actions">${btn('plus-tard', 'Plus tard')}${btn('telecharger', 'Réessayer', true)}</div>`;
  } else if (etat === 'echec') {
    const e = MAJ.echec || {};
    h = tete('alerte', `La mise à jour vers la ${esc(e.cible)} n'a pas abouti`, `Vous êtes toujours en ${esc(APP_INFO.version)}`) +
      `<p class="maj-texte">${e.detail === 'occupe'
        ? 'IV Clients était encore ouvert quand l\'installation a voulu démarrer.'
        : 'L\'installation s\'est arrêtée avant la fin. Un antivirus l\'a peut-être bloquée.'} Vos données n'ont pas été touchées. « Réessayer » relance l'installation en la montrant à l'écran.</p>
       <div class="maj-actions">${btn('oublier', 'Plus tard')}${btn('reessayer', 'Réessayer', true)}</div>`;
  }
  el.innerHTML = h;
  el.hidden = false;
}

async function majVerifier(manuel) {
  if (MAJ.enVerif) return;
  MAJ.enVerif = true; if (view === 'settings') renderSiLibre();
  let r;
  try { r = await window.api.maj.verifier(); } catch (_) { r = { etat: 'erreur', raison: 'vérification impossible' }; }
  MAJ.enVerif = false;
  MAJ.verif = { quand: Date.now(), r };
  if (view === 'settings') renderSiLibre();
  if (r.etat === 'nouvelle') {
    MAJ.info = r;
    if (db.settings.majAuto && !r.portable) majTelecharger(true);
    else if (!['telechargement', 'prete', 'programmee', 'installation'].includes(MAJ.etat)) majBulle('annonce');
  } else if (manuel) {
    toast(r.etat === 'a-jour' ? `Vous avez la dernière version (${APP_INFO.version}).`
      : r.etat === 'inactif' ? 'Vérification désactivée dans cette copie de développement.'
      : 'Vérification impossible : ' + (r.raison || 'erreur inconnue') + '.');
  }
  return r;
}

async function majTelecharger(silencieux) {
  MAJ.progres = null;
  if (!silencieux) majBulle('telechargement');
  const r = await window.api.maj.telecharger();
  if (!r.ok) {
    MAJ.erreur = r.raison || 'erreur inconnue';
    if (!silencieux || !r.reprise) majBulle('erreur');   // une simple coupure en arrière-plan reprendra à la prochaine ouverture
    return false;
  }
  if (silencieux) { await window.api.maj.fermeture(true); majBulle('programmee'); }
  else majBulle('prete');
  if (view === 'settings') renderSiLibre();
  return true;
}

/* « Rien ne se perd » : les saisies de l'écran s'enregistrent seules (350 ms) ;
   seule une fenêtre de saisie ouverte (nom d'un champ, d'une devise…) perdrait
   son texte. Dans ce cas on refuse et on propose l'installation à la fermeture. */
async function majInstallerMaintenant() {
  const modal = $('#modal');
  if (modal && !modal.hidden) { majBulle('saisie'); return; }
  const el = document.activeElement;
  if (el && estChampSaisie(el)) { try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {} el.blur(); }
  if (saveTimer) ecrireMaintenant();
  majBulle('installation');
  const r = await window.api.maj.installer({});
  if (!r.ok) { MAJ.erreur = r.raison; majBulle('erreur'); }
}

async function majReessayer() {
  majBulle('telechargement');
  const r = await majVerifier(false);
  if (!r || r.etat !== 'nouvelle') {
    await window.api.maj.oublier();
    MAJ.erreur = r && r.etat === 'a-jour' ? 'vous avez déjà la dernière version' : (r && r.raison) || 'vérification impossible';
    majBulle(r && r.etat === 'a-jour' ? '' : 'erreur');
    return;
  }
  if (!(await majTelecharger(false))) return;
  if (saveTimer) ecrireMaintenant();
  majBulle('installation');
  const res = await window.api.maj.installer({ avecFenetre: true });
  if (!res.ok) { MAJ.erreur = res.raison; majBulle('erreur'); }
}

async function majDemarrage() {
  if (!HAS_API || !window.api.maj) return;
  window.api.maj.surProgres((p) => {
    MAJ.progres = p;
    if (MAJ.etat !== 'telechargement') return;
    const barre = document.querySelector('#maj-bulle .maj-barre i'), ch = document.querySelector('#maj-bulle .maj-chiffres');
    const pct = p.total ? Math.floor(p.recu / p.total * 100) : 0;
    if (barre) barre.style.width = pct + '%';
    if (ch) ch.textContent = `${pct} % — ${fmtMo(p.recu)} sur ${fmtMo(p.total)}`;
  });
  $('#maj-bulle').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-maj]');
    if (!b) return;
    const a = b.dataset.maj;
    if (a === 'plus-tard') majBulle('');
    else if (a === 'telecharger') majTelecharger(false);
    else if (a === 'pret' || a === 'prete') majBulle('prete');
    else if (a === 'installer') majInstallerMaintenant();
    else if (a === 'fermeture') { if (await window.api.maj.fermeture(true)) majBulle('programmee'); }
    else if (a === 'page') { window.api.maj.page(); majBulle(''); }
    else if (a === 'oublier') { await window.api.maj.oublier(); majBulle(''); }
    else if (a === 'reessayer') majReessayer();
  });
  try { MAJ.portable = await window.api.maj.portable(); } catch (_) {}
  const bilan = await window.api.maj.bilan().catch(() => null);
  if (bilan && bilan.reussi) toast(`IV Clients est à jour : version ${bilan.version}.`);
  else if (bilan) { MAJ.echec = bilan; majBulle('echec'); return; }
  majVerifier(false);
}

A.majAuto = (oui) => {
  db.settings.majAuto = !!oui; save();
  // une version déjà téléchargée suit le nouveau choix
  if (MAJ.info) window.api.maj.fermeture(!!oui).then((p) => {
    if (MAJ.etat === 'prete' || MAJ.etat === 'programmee') majBulle(p ? 'programmee' : 'prete');
  });
};
A.majVerifier = () => majVerifier(true);

/* ================= Données pour un téléphone ou une tablette (06/10/2026) =================
   Le PC prépare un « paquet » : toutes les données telles quelles (fiches, réglages,
   mot de passe administrateur), chiffrées avec un code choisi à l'instant (paquet.js).
   L'appareil l'importe et s'ouvre identique au PC. Réservé à l'administrateur :
   le paquet contient les finances. */
function vCarteAppareil() {
  if (MOBILE) return `<div class="card">
      <h2>${ico('sauvegarde')} Données de cet appareil <span class="hint">copie venue de l'ordinateur</span></h2>
      <p class="help-text">Ces données sont une copie du PC au moment où le paquet a été préparé. Ce qui est saisi ensuite sur l'ordinateur n'arrive ici qu'avec un nouveau paquet — et inversement.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn btn-primary" onclick="A.paquetRemplacer()">Remplacer les données…</button>
        <button class="btn btn-ghost" onclick="A.exporterDonnees()">Exporter mes données</button>
      </div>
    </div>`;
  if (!HAS_API || typeof PAQUET === 'undefined') return '';
  return `<div class="card">
      <h2>${ico('sauvegarde')} Données pour un appareil <span class="hint">téléphone ou tablette de l'entreprise</span></h2>
      <p class="help-text">Prépare un fichier qui contient <b>toutes</b> vos données telles qu'elles sont maintenant — fiches, finances, réglages et mot de passe administrateur —, chiffré avec un code que vous choisissez. Faites passer le fichier sur l'appareil (câble, clé USB, WhatsApp) et donnez le code de vive voix : sans lui, le fichier est illisible.</p>
      <button class="btn btn-primary" style="margin-top:8px" onclick="A.paquetPreparer()">Préparer les données pour un appareil…</button>
    </div>`;
}

A.paquetPreparer = async () => {
  if (refusReglageAdmin()) return;
  const code = await askText(`Choisissez le code du paquet (${PAQUET.CODE_MIN} caractères au moins)`, 'text');
  if (code === null) return;
  if (code.length < PAQUET.CODE_MIN) { toast(`Code trop court : ${PAQUET.CODE_MIN} caractères au moins.`); return; }
  try {
    const texte = await PAQUET.chiffrer(db, code, APP_INFO.version);
    if (await window.api.saveText(`IV-Clients-donnees-${todayISO()}${PAQUET.EXTENSION}`, texte))
      toast(`Paquet prêt : ${plur(db.clients.length, 'fiche', 'fiches')}. Donnez le code à part.`);
  } catch (e) { toast('Paquet impossible : ' + e.message); }
};
A.paquetRemplacer = async () => {
  if (refusReglageAdmin()) return;
  try { await window.api.remplacerDonnees(); } catch (e) { toast('Remplacement impossible : ' + e.message); }
};
A.exporterDonnees = async () => {
  if (refusReglageAdmin()) return;
  try { if (await window.api.exporterDonnees()) toast('Données exportées.'); } catch (e) { toast('Export impossible : ' + e.message); }
};

async function init() {
  await loadDb();
  await traiterFichierCorrompu();
  appliquerTheme();
  if (HAS_API) {
    try { APP_INFO = await window.api.appInfo(); } catch (_) {}
    try { LOGO_DATA = await window.api.appLogo(); } catch (_) {}
  }
  $('#foot-version').textContent = 'v' + APP_INFO.version;

  // le mode d'ouverture est demandé à CHAQUE lancement, mot de passe ou non
  await ouvertureFlow();
  majPiedRole();

  $('#shell').hidden = false;
  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; render(); }));
  const main = $('#main');
  main.addEventListener('change', handleChange);
  main.addEventListener('input', handleInput);

  /* Actions portant un identifiant de fiche : elles passent par un attribut
     `data-`, JAMAIS par un onclick. Un identifiant glissé dans un onclick est
     recollé au code du bouton puis exécuté — et protéger les apostrophes n'y
     change rien, le navigateur les décode avant d'exécuter (vérifié le
     23/08/2026 : le code étranger passait quand même). Ici la valeur reste une
     donnée, jamais du code. */
  main.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-agir]');
    if (!el) return;
    const id = el.dataset.id || '';
    const agir = el.dataset.agir;
    if (agir === 'ouvrir') A.openClient(id);
    else if (agir === 'archiver') A.toggleArchive(id);
    else if (agir === 'supprimer') A.delClient(id);
    else if (agir === 'champ-supprimer') A.delCustom(id);
    else if (agir === 'corbeille-remettre') A.restaurerFiche(id);
    else if (agir === 'corbeille-effacer') A.effacerDefinitif(id);
    else if (agir === 'pf-bareme') A.voirBaremePf();
    else if (agir === 'sauvegardes-ouvrir') A.ouvrirSauvegardes();
    else if (agir === 'sauvegardes-toutes') A.voirToutesSauvegardes();
    else if (agir === 'doublon-ignorer') A.ignorerDoublon(el.dataset.cle || '');
    else if (agir === 'doublons-reafficher') A.reafficherDoublons();
    else if (agir === 'sauvegarde-restaurer') A.restaurerSauvegarde(el.dataset.nom || '', el.dataset.date || '');
    else if (agir === 'taux-utiliser') A.utiliserTauxJour(el.dataset.code || '');
    else if (agir === 'taux-supprimer') A.delRate(el.dataset.code || '');
  });
  // déclenche le re-dessin différé quand le focus quitte les champs de saisie
  main.addEventListener('focusout', () => {
    setTimeout(() => {
      if (renderPending && !focusDansFormulaire(document.activeElement)) render();
    }, 0);
  });
  render();

  // une seule vérification des mises à jour, une fois l'écran posé
  setTimeout(() => { majDemarrage().catch(() => {}); }, 4000);

  // relevé du taux du jour (par l'euro) : une fois par demi-journée, en fond.
  // Rien ne bloque : sans réseau, les taux saisis restent utilisés.
  if (tauxJourPerime()) {
    setTimeout(() => {
      releverTauxJour().then((t) => { if (t && (view === 'settings' || view === 'client')) renderSiLibre(); }).catch(() => {});
    }, 1200);
  }

  // relevé des barèmes publiés par le site (frais IRCC, preuve de fonds, visite
  // médicale). Même règle : une fois par demi-journée, en fond, et si le site ne
  // répond pas les derniers montants relevés restent en place.
  // À CHAQUE ouverture, sans condition de délai : relancer le logiciel après avoir
  // modifié un montant dans /gestion doit suffire à le voir arriver ici.
  if (baremeSite().auto) {
    setTimeout(() => {
      releverBaremesDuSite().then((r) => {
        if (r && r.change) toast('Barèmes mis à jour depuis le site.');
        renderSiLibre();
      }).catch(() => {});
    }, 1800);
  }

  /* PASSAGE DE MINUIT. Les compteurs se calculent de minuit à minuit, encore
     faut-il que l'écran soit redessiné À MINUIT. Le rafraîchissement horaire
     ci-dessous ne garantissait rien : une application laissée ouverte la nuit
     affichait « J-10 » jusqu'à une heure après le changement de jour.
     On vise donc 00 h 00 pile (plus 5 secondes de marge), puis on se replace
     pour la nuit suivante. */
  const passageDeMinuit = () => {
    const t = new Date();
    t.setHours(24, 0, 5, 0);                       // le prochain minuit
    setTimeout(() => {
      renderSiLibre();                             // jamais en pleine saisie
      passageDeMinuit();
    }, Math.max(1000, t - Date.now()));
  };
  passageDeMinuit();

  // rafraîchit les compteurs (âges, J-x…) si l'app reste ouverte longtemps — jamais pendant une saisie.
  // L'application peut rester ouverte plusieurs jours : le taux du jour est donc
  // RE-relevé ici dès qu'il a plus d'une demi-journée, sans quoi la date affichée
  // resterait figée à celle du jour où l'application a été ouverte.
  setInterval(() => {
    if (focusDansFormulaire(document.activeElement)) return;
    const travaux = [];
    let bouge = false;
    if (tauxJourPerime()) travaux.push(releverTauxJour().catch(() => {}));
    if (baremeSitePerime()) travaux.push(releverBaremesDuSite().then((r) => { if (r && r.change) bouge = true; }).catch(() => {}));
    if (travaux.length) Promise.all(travaux).then(() => { renderSiLibre(); if (bouge) toast('Barèmes mis à jour depuis le site.'); });
    else renderSiLibre();
  }, 60 * 60 * 1000);
}

init();
