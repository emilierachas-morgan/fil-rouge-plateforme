// =============================================================================
// Fil Rouge Apprenants — lecture et contrôle des fichiers d'apprenants (CSV)
// =============================================================================
// Fonctions « pures » (sans écran) : elles transforment le texte d'un fichier
// en lignes prêtes à enregistrer. Testées avec node : tests/import.test.js
//
// Le fichier n'est jamais envoyé tel quel : il est lu dans le navigateur, et
// seules les colonnes choisies sont enregistrées dans la base.
// =============================================================================

(function (racine) {
  "use strict";

  // Les champs de la plateforme, dans l'ordre de l'écran de correspondance.
  // « motsCles » sert à deviner la bonne colonne du fichier du client.
  const CHAMPS = [
    { cle: "identifiant_externe", libelle: "Identifiant de l'apprenant", motsCles: ["identifiant", "id apprenant", "id", "matricule", "numero", "numéro", "code apprenant", "ref", "référence", "reference", "n° dossier", "dossier"] },
    { cle: "prenom", libelle: "Prénom", motsCles: ["prenom", "prénom", "first name", "firstname"] },
    { cle: "nom", libelle: "Nom", motsCles: ["nom", "nom de famille", "last name", "lastname", "name"] },
    { cle: "telephone", libelle: "Téléphone", motsCles: ["telephone", "téléphone", "tel", "tél", "portable", "mobile", "phone", "gsm"] },
    { cle: "email", libelle: "Email", motsCles: ["email", "e-mail", "mail", "courriel", "adresse mail", "adresse email"] },
    { cle: "parcours", libelle: "Parcours / formation", motsCles: ["parcours", "formation", "cursus", "programme", "titre", "diplome", "diplôme", "intitule", "intitulé"] },
    { cle: "date_inscription", libelle: "Date d'inscription", motsCles: ["inscription", "date inscription", "date d'inscription", "entree", "entrée", "date de debut", "date de début", "debut", "début", "start"] },
    { cle: "avancement_pct", libelle: "Avancement (%)", motsCles: ["avancement", "progression", "progress", "% realise", "% réalisé", "taux", "completion", "complétion"] },
    { cle: "derniere_connexion", libelle: "Dernière connexion", motsCles: ["derniere connexion", "dernière connexion", "last login", "derniere activite", "dernière activité", "last activity", "connexion"] },
    { cle: "date_dernier_contact", libelle: "Date du dernier contact", motsCles: ["dernier contact", "date du dernier contact", "date dernier contact", "contact"] },
    { cle: "statut", libelle: "Statut", motsCles: ["statut", "etat", "état", "status", "situation"] },
  ];

  const CHAMPS_DATE = ["date_inscription", "derniere_connexion", "date_dernier_contact"];

  // ---------------------------------------------------------------------------
  // Texte : enlever accents, minuscules — pour comparer des en-têtes.
  // ---------------------------------------------------------------------------
  function normaliser(texte) {
    return String(texte || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
  }

  // ---------------------------------------------------------------------------
  // Décodage : UTF-8 si possible, sinon Windows-1252 (exports Excel français).
  // ---------------------------------------------------------------------------
  function decoder(octets) {
    let texte = new TextDecoder("utf-8").decode(octets);
    if (texte.includes("�")) {
      try { texte = new TextDecoder("windows-1252").decode(octets); } catch (e) { /* garde l'UTF-8 */ }
    }
    return texte.replace(/^﻿/, "");
  }

  // ---------------------------------------------------------------------------
  // Lecture CSV : séparateur deviné (; , tabulation), guillemets, retours à la
  // ligne dans les cellules.
  // ---------------------------------------------------------------------------
  function devinerSeparateur(texte) {
    const premiereLigne = texte.split(/\r?\n/).find((l) => l.trim()) || "";
    const candidats = [";", ",", "\t", "|"];
    let meilleur = ";", max = -1;
    for (const c of candidats) {
      const n = premiereLigne.split(c).length - 1;
      if (n > max) { max = n; meilleur = c; }
    }
    return meilleur;
  }

  function lireCsv(texte) {
    const sep = devinerSeparateur(texte);
    const lignes = [];
    let ligne = [], cellule = "", guillemets = false;
    for (let i = 0; i < texte.length; i++) {
      const c = texte[i];
      if (guillemets) {
        if (c === '"') {
          if (texte[i + 1] === '"') { cellule += '"'; i++; } else { guillemets = false; }
        } else { cellule += c; }
      } else if (c === '"') {
        guillemets = true;
      } else if (c === sep) {
        ligne.push(cellule); cellule = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && texte[i + 1] === "\n") i++;
        ligne.push(cellule); cellule = "";
        if (ligne.some((v) => v.trim() !== "")) lignes.push(ligne);
        ligne = [];
      } else {
        cellule += c;
      }
    }
    ligne.push(cellule);
    if (ligne.some((v) => v.trim() !== "")) lignes.push(ligne);

    if (!lignes.length) return { entetes: [], lignes: [], separateur: sep };
    const entetes = lignes[0].map((e, i) => e.trim() || `Colonne ${i + 1}`);
    const donnees = lignes.slice(1).map((l) => entetes.map((_, i) => (l[i] || "").trim()));
    return { entetes, lignes: donnees, separateur: sep };
  }

  // ---------------------------------------------------------------------------
  // Correspondance automatique : pour chaque champ, la colonne la plus probable.
  // ---------------------------------------------------------------------------
  function devinerCorrespondance(entetes) {
    const norm = entetes.map(normaliser);
    const prises = new Set();
    const resultat = {};
    // Deux passes : égalité exacte d'abord, puis « contient ».
    for (const passe of ["exact", "contient"]) {
      for (const champ of CHAMPS) {
        if (resultat[champ.cle] !== undefined) continue;
        const mots = champ.motsCles.map(normaliser);
        const index = norm.findIndex((e, i) => !prises.has(i) && mots.some((m) =>
          passe === "exact" ? e === m : (m.length > 3 && e.includes(m))));
        if (index >= 0) { resultat[champ.cle] = index; prises.add(index); }
      }
    }
    return resultat; // { prenom: 2, nom: 3, ... }
  }

  // ---------------------------------------------------------------------------
  // Conversions de valeurs
  // ---------------------------------------------------------------------------
  function iso(a, m, j) {
    const d = new Date(Date.UTC(a, m - 1, j));
    if (d.getUTCFullYear() !== a || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== j) return null;
    if (a < 1990 || a > 2100) return null;
    return d.toISOString().slice(0, 10);
  }

  function lireDate(valeur) {
    const v = String(valeur || "").trim();
    if (!v) return { ok: true, valeur: null };
    let m;
    if ((m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return resultatDate(iso(+m[1], +m[2], +m[3]), v);
    if ((m = v.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/))) {
      const annee = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      return resultatDate(iso(annee, +m[2], +m[1]), v); // format français jj/mm/aaaa
    }
    if (/^\d{5}(\.\d+)?$/.test(v)) { // date Excel (nombre de jours depuis 1899-12-30)
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+v) * 86400000);
      return resultatDate(d.toISOString().slice(0, 10), v);
    }
    return { ok: false, erreur: `date illisible « ${v} »` };
  }
  function resultatDate(d, brut) {
    return d ? { ok: true, valeur: d } : { ok: false, erreur: `date impossible « ${brut} »` };
  }

  // Avancement : « 35 », « 35 % », « 35,5 », « 0,35 » (si toute la colonne ≤ 1).
  function lireNombre(valeur) {
    const v = String(valeur || "").replace("%", "").replace(/\s/g, "").replace(",", ".");
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }

  function lireStatut(valeur) {
    const v = normaliser(valeur);
    if (!v) return { ok: true, valeur: null };
    if (/abandon|desist|demission|annul|arret|stop|sorti/.test(v)) return { ok: true, valeur: "abandon" };
    if (/termin|fini|diplom|certifi|valide|achev|complet/.test(v)) return { ok: true, valeur: "termine" };
    if (/actif|en cours|cours|inscrit|active|ouvert/.test(v)) return { ok: true, valeur: "actif" };
    return { ok: false, erreur: `statut inconnu « ${valeur} » (attendu : actif, terminé ou abandon)` };
  }

  function nettoyerTelephone(valeur) {
    const v = String(valeur || "").trim();
    if (!v) return null;
    // Excel supprime souvent le 0 initial : 612345678 → 0612345678
    const chiffres = v.replace(/[^\d+]/g, "");
    if (/^[1-9]\d{8}$/.test(chiffres)) return "0" + chiffres;
    return v;
  }

  // ---------------------------------------------------------------------------
  // Préparer les lignes à enregistrer
  // correspondance : { champ: indexColonne | undefined }
  // Retour : { valides: [...], erreurs: [{ ligne, message }], doublons }
  // ---------------------------------------------------------------------------
  function preparer(lignes, correspondance, organismeId) {
    const valides = [];
    const erreurs = [];
    const champsUtilises = CHAMPS.filter((c) => Number.isInteger(correspondance[c.cle]));
    const val = (ligne, cle) => (Number.isInteger(correspondance[cle]) ? ligne[correspondance[cle]] : "");

    // Avancement exprimé en fraction (0,35) si toutes les valeurs sont ≤ 1.
    let enFraction = false;
    if (Number.isInteger(correspondance.avancement_pct)) {
      const nombres = lignes.map((l) => lireNombre(val(l, "avancement_pct"))).filter((n) => n !== null && !Number.isNaN(n));
      enFraction = nombres.length > 0 && nombres.every((n) => n >= 0 && n <= 1) && nombres.some((n) => n > 0 && n < 1);
    }

    const vus = new Map();
    let doublons = 0;

    lignes.forEach((ligne, i) => {
      const numero = i + 2; // ligne 1 = en-têtes
      const problemes = [];
      const sortie = { organisme_id: organismeId };

      for (const champ of champsUtilises) {
        const brut = val(ligne, champ.cle);
        if (CHAMPS_DATE.includes(champ.cle)) {
          const r = lireDate(brut);
          if (r.ok) sortie[champ.cle] = r.valeur; else problemes.push(`${champ.libelle} : ${r.erreur}`);
        } else if (champ.cle === "avancement_pct") {
          let n = lireNombre(brut);
          if (n === null) sortie.avancement_pct = null;
          else if (Number.isNaN(n)) problemes.push(`Avancement : « ${brut} » n'est pas un nombre`);
          else {
            if (enFraction) n = n * 100;
            if (n < 0 || n > 100) problemes.push(`Avancement : ${brut} doit être entre 0 et 100`);
            else sortie.avancement_pct = Math.round(n * 100) / 100;
          }
        } else if (champ.cle === "statut") {
          const r = lireStatut(brut);
          if (!r.ok) problemes.push(r.erreur);
          else if (r.valeur) sortie.statut = r.valeur;
        } else if (champ.cle === "telephone") {
          sortie.telephone = nettoyerTelephone(brut);
        } else if (champ.cle === "email") {
          sortie.email = brut ? brut.toLowerCase() : null;
        } else {
          sortie[champ.cle] = brut || null;
        }
      }

      // Identifiant : colonne choisie, sinon email, sinon prénom + nom.
      let identifiant = sortie.identifiant_externe;
      if (!identifiant) identifiant = sortie.email || null;
      if (!identifiant && (sortie.prenom || sortie.nom)) identifiant = normaliser(`${sortie.prenom || ""} ${sortie.nom || ""}`);
      if (!identifiant) problemes.push("ni identifiant, ni email, ni nom : impossible de reconnaître l'apprenant");
      sortie.identifiant_externe = identifiant;

      if (problemes.length) {
        erreurs.push({ ligne: numero, message: problemes.join(" ; ") });
        return;
      }
      if (vus.has(identifiant)) {
        // Même apprenant deux fois dans le fichier : la dernière ligne l'emporte.
        valides[vus.get(identifiant)] = sortie;
        doublons++;
        return;
      }
      vus.set(identifiant, valides.length);
      valides.push(sortie);
    });

    return { valides, erreurs, doublons };
  }

  const api = { CHAMPS, normaliser, decoder, lireCsv, devinerSeparateur, devinerCorrespondance, lireDate, lireNombre, lireStatut, nettoyerTelephone, preparer };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.FilRougeImport = api;
})(typeof window !== "undefined" ? window : globalThis);
