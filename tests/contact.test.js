// Tests du contact multicanal. Lancement : node tests/contact.test.js
"use strict";
const assert = require("node:assert/strict");
const C = require("../app/contact.js");

let n = 0;
function test(nom, fn) { fn(); n++; console.log("OK   " + nom); }

test("numéro français avec espaces → format international", () => {
  assert.equal(C.numeroInternational("06 12 34 56 78"), "33612345678");
});
test("numéro déjà en +33 ou 0033", () => {
  assert.equal(C.numeroInternational("+33 6 12 34 56 78"), "33612345678");
  assert.equal(C.numeroInternational("0033612345678"), "33612345678");
});
test("mobiles d'outre-mer : La Réunion, Martinique", () => {
  assert.equal(C.numeroInternational("0692 12 34 56"), "262692123456");
  assert.equal(C.numeroInternational("0696123456"), "596696123456");
});
test("numéro inutilisable → pas de lien", () => {
  assert.equal(C.numeroInternational("abc"), null);
  assert.equal(C.lienWhatsApp("", "x"), null);
  assert.equal(C.lienEmail("pas-une-adresse", "o", "t"), null);
});
test("lien WhatsApp avec le texte encodé", () => {
  assert.equal(C.lienWhatsApp("0612345678", "Bonjour Julie & co"), "https://wa.me/33612345678?text=Bonjour%20Julie%20%26%20co");
});
test("lien SMS : iPhone et Android", () => {
  assert.equal(C.lienSms("0612345678", "Salut", true), "sms:+33612345678&body=Salut");
  assert.equal(C.lienSms("0612345678", "Salut", false), "sms:+33612345678?body=Salut");
});
test("lien email avec objet et texte", () => {
  assert.equal(C.lienEmail("julie@exemple.fr", "Point", "a b"), "mailto:julie@exemple.fr?subject=Point&body=a%20b");
});
test("modèle rempli avec prénom, signature et organisme", () => {
  const r = C.remplir("point_mois", { prenom: "Julie", moi: "Émilie", organisme: "Académie Horizon" });
  assert.match(r.texte, /^Bonjour Julie, c'est Émilie, votre conseillère de suivi pour Académie Horizon\./);
  assert.equal(r.objet, "Point sur votre formation");
});
test("modèle sans prénom ni signature reste propre", () => {
  const r = C.remplir("point_mois", {});
  assert.match(r.texte, /^Bonjour, c'est votre conseillère de suivi\. /);
});
test("date d'examen en toutes lettres", () => {
  assert.match(C.remplir("examen_j1", { prenom: "Léo", date_examen: "2026-11-03" }).texte, /a lieu le 3 novembre\./);
});
test("avancement dans le modèle « terminer le parcours »", () => {
  assert.match(C.remplir("progression", { prenom: "Léo", avancement_pct: 82.4 }).texte, /vous êtes à 82 % de votre formation/);
});
test("modèle conseillé selon la situation", () => {
  assert.equal(C.modeleConseille({ date_examen: "2026-10-18" }, "2026-10-17"), "examen_j1");
  assert.equal(C.modeleConseille({ date_examen: "2026-10-22" }, "2026-10-17"), "examen_j7");
  assert.equal(C.modeleConseille({ avancement_pct: 85 }, "2026-10-17"), "progression");
  assert.equal(C.modeleConseille({ avancement_pct: 30 }, "2026-10-17"), "point_mois");
  assert.equal(C.modeleConseille({ date_examen: "2026-10-18", presence_examen: "present" }, "2026-10-17"), "point_mois");
});

console.log(`\n${n} tests passés`);
