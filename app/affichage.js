// =============================================================================
// Fil Rouge Apprenants — garder le fond blanc quand le téléphone noircit les sites
// =============================================================================
// Certains navigateurs (navigateur Mi de Xiaomi, Edge sur Android…) noircissent
// de force toutes les pages quand le téléphone est en mode sombre, sans tenir
// compte de la consigne « toujours clair » du site.
//
// Parade : on retourne une seconde fois les couleurs de toute la page
// (inversion + rotation de teinte). Noirci puis retourné = de nouveau clair.
//
// - Activée automatiquement sur le navigateur Mi et Edge Android quand le
//   téléphone est en mode sombre.
// - Un lien en bas de page permet de l'activer ou de la couper à la main ;
//   ce choix est mémorisé sur l'appareil.
// Ce fichier est chargé avant tout le reste pour éviter un flash noir.
// =============================================================================

(function () {
  "use strict";

  var CLE = "filrouge-affichage"; // "redresse" | "normal"
  var racine = document.documentElement;

  function lireChoix() {
    try { return window.localStorage.getItem(CLE); } catch (e) { return null; }
  }

  function ecrireChoix(valeur) {
    try { window.localStorage.setItem(CLE, valeur); } catch (e) { /* stockage indisponible : choix non mémorisé */ }
  }

  function navigateurQuiNoircit() {
    var ua = navigator.userAgent || "";
    var sombre = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    return sombre && /MiuiBrowser|XiaoMi|EdgA\//i.test(ua);
  }

  function appliquer(redresser) {
    racine.classList.toggle("affichage-redresse", redresser);
    var lien = document.getElementById("bouton-affichage");
    if (lien) {
      lien.textContent = redresser
        ? "Affichage inversé ? Revenir à l'affichage normal"
        : "Le fond s'affiche en noir ? Afficher en clair";
    }
  }

  var choix = lireChoix();
  var redresser = choix ? choix === "redresse" : navigateurQuiNoircit();
  appliquer(redresser);

  document.addEventListener("DOMContentLoaded", function () {
    appliquer(redresser);
    var lien = document.getElementById("bouton-affichage");
    if (!lien) return;
    lien.addEventListener("click", function () {
      redresser = !redresser;
      ecrireChoix(redresser ? "redresse" : "normal");
      appliquer(redresser);
    });
  });
})();
