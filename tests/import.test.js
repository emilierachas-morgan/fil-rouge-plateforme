// Tests de la lecture des fichiers d'apprenants. Lancement : node tests/import.test.js
"use strict";
const assert = require("node:assert/strict");
const I = require("../app/import.js");

let n = 0;
function test(nom, fn) { fn(); n++; console.log("OK   " + nom); }

test("séparateur point-virgule (Excel français)", () => {
  assert.equal(I.devinerSeparateur("Nom;Prénom;Email\nA;B;C"), ";");
});
test("séparateur virgule", () => {
  assert.equal(I.devinerSeparateur("nom,prenom,email\na,b,c"), ",");
});

test("guillemets, point-virgule et retour à la ligne dans une cellule", () => {
  const r = I.lireCsv('Nom;Note\n"Martin";"ligne 1\nligne 2; suite"\n');
  assert.deepEqual(r.entetes, ["Nom", "Note"]);
  assert.equal(r.lignes[0][1], "ligne 1\nligne 2; suite");
});

test("lignes vides ignorées, fins de ligne Windows", () => {
  const r = I.lireCsv("a;b\r\n1;2\r\n\r\n3;4\r\n");
  assert.equal(r.lignes.length, 2);
});

test("décodage Windows-1252 (accents d'un export Excel)", () => {
  const octets = Uint8Array.from([0x50, 0x72, 0xe9, 0x6e, 0x6f, 0x6d]); // « Prénom » en Windows-1252
  assert.equal(I.decoder(octets), "Prénom");
});
test("décodage UTF-8 avec BOM", () => {
  const octets = new TextEncoder().encode("﻿Prénom");
  assert.equal(I.decoder(octets), "Prénom");
});

test("correspondance devinée sur des en-têtes réalistes", () => {
  const c = I.devinerCorrespondance(["N° dossier", "Prénom", "NOM", "Tél. portable", "E-mail", "Formation", "Date d'entrée", "Progression", "Dernière connexion", "Statut"]);
  assert.equal(c.identifiant_externe, 0);
  assert.equal(c.prenom, 1);
  assert.equal(c.nom, 2);
  assert.equal(c.telephone, 3);
  assert.equal(c.email, 4);
  assert.equal(c.parcours, 5);
  assert.equal(c.date_inscription, 6);
  assert.equal(c.avancement_pct, 7);
  assert.equal(c.derniere_connexion, 8);
  assert.equal(c.statut, 9);
});

test("« Nom » n'est pas confondu avec « Prénom »", () => {
  const c = I.devinerCorrespondance(["Prénom", "Nom"]);
  assert.equal(c.prenom, 0);
  assert.equal(c.nom, 1);
});

test("dates : français, ISO, Excel, vide, impossible", () => {
  assert.equal(I.lireDate("05/03/2026").valeur, "2026-03-05");
  assert.equal(I.lireDate("5.3.26").valeur, "2026-03-05");
  assert.equal(I.lireDate("2026-03-05").valeur, "2026-03-05");
  assert.equal(I.lireDate("46086").valeur, "2026-03-05");
  assert.equal(I.lireDate("").valeur, null);
  assert.equal(I.lireDate("31/02/2026").ok, false);
  assert.equal(I.lireDate("demain").ok, false);
});

test("statuts reconnus", () => {
  assert.equal(I.lireStatut("En cours").valeur, "actif");
  assert.equal(I.lireStatut("Terminé").valeur, "termine");
  assert.equal(I.lireStatut("Abandon").valeur, "abandon");
  assert.equal(I.lireStatut("Désisté").valeur, "abandon");
  assert.equal(I.lireStatut("???").ok, false);
});

test("téléphone : le 0 supprimé par Excel est remis", () => {
  assert.equal(I.nettoyerTelephone("612345678"), "0612345678");
  assert.equal(I.nettoyerTelephone("06 12 34 56 78"), "06 12 34 56 78");
});

test("préparation complète : conversion, erreurs, doublons, fraction d'avancement", () => {
  const csv = [
    "ID;Prénom;Nom;Email;Progression;Inscription;Statut",
    "A1;Julie;Martin;JULIE@EX.TEST;0,35;05/03/2026;En cours",
    "A2;Karim;Benali;karim@ex.test;0,5;2026-01-10;Terminé",
    "A3;Sans;Date;s@ex.test;0,1;bientôt;En cours",
    "A1;Julie;Martin;julie@ex.test;0,4;05/03/2026;En cours",
  ].join("\n");
  const { entetes, lignes } = I.lireCsv(csv);
  const corr = I.devinerCorrespondance(entetes);
  const r = I.preparer(lignes, corr, "org-1");
  assert.equal(r.valides.length, 2, "2 apprenants valides (A1 dédoublonné, A3 en erreur)");
  assert.equal(r.doublons, 1);
  assert.equal(r.erreurs.length, 1);
  assert.equal(r.erreurs[0].ligne, 4);
  const julie = r.valides.find((v) => v.identifiant_externe === "A1");
  assert.equal(julie.avancement_pct, 40, "0,4 compris comme 40 % et dernière ligne retenue");
  assert.equal(julie.email, "julie@ex.test");
  assert.equal(julie.date_inscription, "2026-03-05");
  assert.equal(julie.statut, "actif");
  assert.equal(julie.organisme_id, "org-1");
});

test("colonne non choisie : le champ n'est pas envoyé (rien n'est effacé)", () => {
  const { entetes, lignes } = I.lireCsv("Email;Prénom\na@ex.test;Ana");
  const r = I.preparer(lignes, { email: 0, prenom: 1 }, "org-1");
  assert.equal("telephone" in r.valides[0], false);
  assert.equal("statut" in r.valides[0], false);
  assert.equal(r.valides[0].identifiant_externe, "a@ex.test", "l'email sert d'identifiant");
});

test("sans identifiant ni email : prénom + nom", () => {
  const r = I.preparer([["Émilie", "Roux"]], { prenom: 0, nom: 1 }, "org-1");
  assert.equal(r.valides[0].identifiant_externe, "emilie roux");
});

test("examen : colonnes devinées sans confusion", () => {
  const { entetes } = I.lireCsv("ID;Résultat examen;Présence examen;Date examen;Date inscription");
  const corr = I.devinerCorrespondance(entetes);
  assert.equal(corr.resultat_examen, 1);
  assert.equal(corr.presence_examen, 2);
  assert.equal(corr.date_examen, 3);
  assert.equal(corr.date_inscription, 4);
});

test("examen : présence et résultat lus en français", () => {
  assert.equal(I.lirePresence("Présent").valeur, "present");
  assert.equal(I.lirePresence("absente").valeur, "absent");
  assert.equal(I.lirePresence("oui").valeur, "present");
  assert.equal(I.lirePresence("").valeur, null);
  assert.equal(I.lirePresence("peut-être").ok, false);
  assert.equal(I.lireResultat("Non admis").valeur, "echoue", "« non admis » n'est pas une réussite");
  assert.equal(I.lireResultat("Admis").valeur, "reussi");
  assert.equal(I.lireResultat("Validé").valeur, "reussi");
  assert.equal(I.lireResultat("Ajourné").valeur, "echoue");
  assert.equal(I.lireResultat("En attente").valeur, null);
});

test("examen : cohérence des lignes importées", () => {
  const csv = [
    "ID;Date examen;Présence;Résultat",
    "E1;12/11/2026;;Admis",
    "E2;12/11/2026;Absent;Admis",
    "E3;;Présent;",
    "E4;20/11/2026;;",
  ].join("\n");
  const { entetes, lignes } = I.lireCsv(csv);
  const r = I.preparer(lignes, I.devinerCorrespondance(entetes), "org-1");
  const e1 = r.valides.find((v) => v.identifiant_externe === "E1");
  assert.equal(e1.presence_examen, "present", "un résultat implique la présence");
  assert.equal(e1.resultat_examen, "reussi");
  assert.equal(e1.date_examen, "2026-11-12");
  assert.deepEqual(r.erreurs.map((e) => e.ligne), [3, 4], "absent avec résultat, et présence sans date : refusés");
  assert.equal("presence_examen" in r.valides.find((v) => v.identifiant_externe === "E4"), false,
    "cellule vide : la présence déjà saisie dans la plateforme n'est pas effacée");
});

console.log(`\n${n} tests de lecture de fichier réussis`);
