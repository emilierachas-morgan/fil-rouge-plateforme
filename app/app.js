// =============================================================================
// Fil Rouge Apprenants — application (étapes 2 et 3 : connexion, rôles, CRM)
// =============================================================================
// Parcours :
//   1. Adresse email  -> Supabase envoie un code à 6 chiffres
//   2. Code reçu      -> session ouverte (niveau aal1)
//   3. Profil         -> rôle : administratrice, client ou appelante
//   4. Administratrice uniquement : double authentification
//        - première fois : inscription de l'application d'authentification (QR code)
//        - ensuite : code à 6 chiffres de l'application à chaque connexion
//      La base refuse toute donnée à l'administratrice tant que ce n'est pas fait.
//   5. Accueil selon le rôle
//
// Sécurité : tout le texte venant de la base est inséré avec textContent
// (jamais innerHTML), pour qu'aucune donnée ne puisse injecter du code.
// =============================================================================

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Démarrage du client Supabase
  // ---------------------------------------------------------------------------

  const config = window.FIL_ROUGE_CONFIG;
  const contenu = document.getElementById("contenu");
  const zoneCompte = document.getElementById("zone-compte");
  const compteLibelle = document.getElementById("compte-libelle");
  const boutonDeconnexion = document.getElementById("bouton-deconnexion");

  if (!window.supabase || !config) {
    contenu.replaceChildren(
      h("p", { class: "message message-erreur" },
        "La page n'a pas pu se charger complètement. Vérifiez votre connexion internet, puis rechargez la page.")
    );
    return;
  }

  // Un lien de connexion expiré ou déjà utilisé revient avec une erreur dans l'adresse.
  const erreurLien = /(^|[#&?])error=/.test(window.location.hash + window.location.search)
    ? "Ce lien de connexion a expiré ou a déjà servi. Demandez-en un nouveau ci-dessous."
    : null;
  if (erreurLien) history.replaceState(null, "", window.location.pathname);

  // detectSessionInUrl : ouvre la session quand on arrive par le lien reçu par email.
  const sb = window.supabase.createClient(config.supabaseUrl, config.supabaseCle, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  // Adresse où renvoie le lien de l'email : la page elle-même, une fois en ligne.
  function adresseRetour() {
    return /^https?:$/.test(window.location.protocol)
      ? window.location.origin + window.location.pathname
      : undefined;
  }

  function demanderAcces(email) {
    return sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: adresseRetour() },
    });
  }

  const LIBELLES_ROLE = {
    admin: "Administratrice",
    client: "Espace client",
    appelante: "Appelante",
  };

  const LIBELLES_ETAPE = {
    prospect: "Prospects",
    contacte: "Contactés",
    test_gratuit: "Tests gratuits",
    client: "Clients",
    perdu: "Perdus",
  };

  const etat = { email: "" };

  // ---------------------------------------------------------------------------
  // Petits outils d'affichage
  // ---------------------------------------------------------------------------

  // Crée un élément : h("p", { class: "x" }, "texte", autreElement)
  function h(balise, attributs, ...enfants) {
    const el = document.createElement(balise);
    for (const [cle, valeur] of Object.entries(attributs || {})) {
      if (valeur === false || valeur === null || valeur === undefined) continue;
      if (cle.startsWith("on") && typeof valeur === "function") {
        el.addEventListener(cle.slice(2), valeur);
      } else if (valeur === true) {
        el.setAttribute(cle, "");
      } else {
        el.setAttribute(cle, String(valeur));
      }
    }
    for (const enfant of enfants.flat()) {
      if (enfant === null || enfant === undefined || enfant === false) continue;
      el.append(enfant instanceof Node ? enfant : document.createTextNode(String(enfant)));
    }
    return el;
  }

  function afficher(...elements) {
    contenu.replaceChildren(...elements);
    // Focus automatique seulement sur les écrans de connexion (pas sur les
    // fiches : sur téléphone, cela ouvrirait le clavier ou le calendrier).
    const premierChamp = contenu.querySelector(".onglets") ? null : contenu.querySelector("input");
    if (premierChamp) premierChamp.focus();
  }

  function message(type, texte) {
    return h("p", { class: `message message-${type}`, role: type === "erreur" ? "alert" : "status" }, texte);
  }

  // Place un message dans la zone prévue d'un formulaire (ou l'efface).
  function signaler(zone, type, texte) {
    zone.replaceChildren(texte ? message(type, texte) : "");
  }

  function occupe(bouton, enCours, texteEnCours) {
    if (enCours) {
      bouton.dataset.texte = bouton.textContent;
      bouton.textContent = texteEnCours;
      bouton.disabled = true;
    } else {
      bouton.textContent = bouton.dataset.texte || bouton.textContent;
      bouton.disabled = false;
    }
  }

  function codeValide(valeur) {
    return /^\d{6}$/.test(valeur);
  }

  // Ne garde que les chiffres (un code collé avec des espaces reste valable).
  function chiffresSeulement(champ) {
    champ.addEventListener("input", () => {
      champ.value = champ.value.replace(/\D/g, "").slice(0, 6);
    });
  }

  function pluriel(n, singulier, plurielTexte) {
    return `${n} ${n > 1 ? plurielTexte : singulier}`;
  }

  // Traduit les erreurs de Supabase en phrases utiles.
  function texteErreur(erreur) {
    const brut = `${erreur?.code || ""} ${erreur?.message || ""}`.toLowerCase();
    if (brut.includes("email_send_rate") || brut.includes("email rate limit")) {
      return "Trop d'emails de connexion envoyés récemment (2 par heure maximum pendant la construction). Si vous avez reçu un email il y a moins d'une heure, utilisez son lien. Sinon, réessayez dans une heure.";
    }
    if (brut.includes("rate") || erreur?.status === 429) {
      return "Trop de demandes en peu de temps. Patientez quelques minutes, puis réessayez.";
    }
    if (brut.includes("expired") || brut.includes("invalid") || brut.includes("otp")) {
      return "Ce code n'est pas valable ou a expiré. Vérifiez les 6 chiffres, ou demandez un nouveau code.";
    }
    if (brut.includes("fetch") || brut.includes("network")) {
      return "Impossible de joindre le serveur. Vérifiez votre connexion internet.";
    }
    if (erreur?.message && /[àâçéèêëîïôûù]/i.test(erreur.message)) {
      return erreur.message; // message déjà rédigé en français par la base
    }
    return "Une erreur est survenue. Réessayez dans un instant.";
  }

  // ---------------------------------------------------------------------------
  // Aiguillage : quel écran montrer ?
  // ---------------------------------------------------------------------------

  async function aiguiller() {
    const { data: sessionData } = await sb.auth.getSession();
    const session = sessionData.session;

    if (!session) {
      zoneCompte.hidden = true;
      return ecranEmail(erreurLien);
    }

    const { data: profil, error } = await sb
      .from("profils")
      .select("id, email, nom_affiche, role, organisme_id, actif")
      .eq("id", session.user.id)
      .maybeSingle();

    if (error) {
      return afficher(message("erreur", texteErreur(error)));
    }

    if (!profil || !profil.actif) {
      return ecranSansAcces(session.user.email);
    }

    zoneCompte.hidden = false;
    compteLibelle.textContent = `${profil.nom_affiche || profil.email} · ${LIBELLES_ROLE[profil.role]}`;

    if (profil.role === "admin") {
      const { data: niveau } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (niveau?.currentLevel !== "aal2") {
        const { data: facteurs } = await sb.auth.mfa.listFactors();
        const verifie = (facteurs?.totp || []).find((f) => f.status === "verified");
        return verifie ? ecranCodeApplication(verifie.id) : ecranInscriptionApplication(facteurs);
      }
      etat.profil = profil;
      return routeAdmin();
    }

    if (profil.role === "client") return accueilClient(profil);
    return accueilAppelante(profil);
  }

  // ---------------------------------------------------------------------------
  // Écran 1 : adresse email
  // ---------------------------------------------------------------------------

  function ecranEmail(infoPrealable) {
    const zone = h("div");
    const champ = h("input", {
      id: "champ-email", type: "email", name: "email", autocomplete: "email",
      required: true, inputmode: "email", value: etat.email, placeholder: "prenom@organisme.fr",
    });
    const bouton = h("button", { class: "bouton", type: "submit" }, "Recevoir mon lien de connexion");

    const formulaire = h("form", { novalidate: true },
      h("label", { for: "champ-email" }, "Adresse email", champ),
      zone,
      bouton
    );

    formulaire.addEventListener("submit", async (evenement) => {
      evenement.preventDefault();
      const email = champ.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return signaler(zone, "erreur", "Saisissez une adresse email complète, par exemple prenom@organisme.fr.");
      }
      signaler(zone);
      occupe(bouton, true, "Envoi en cours…");
      const { error } = await demanderAcces(email);
      occupe(bouton, false);

      // Une adresse sans accès reçoit le même écran qu'une adresse autorisée :
      // on ne révèle pas quelles adresses ont un compte.
      const adresseInconnue = error && /signups not allowed|otp_disabled|user not found/i.test(`${error.code} ${error.message}`);
      if (error && !adresseInconnue) {
        return signaler(zone, "erreur", texteErreur(error));
      }
      etat.email = email;
      ecranCodeEmail();
    });

    afficher(
      h("div", { class: "pile" },
        h("div", {},
          h("p", { class: "surtitre" }, "Connexion"),
          h("h1", {}, "Vos apprenants jusqu'au bout"),
          h("p", { class: "chapo" }, "Saisissez votre adresse email\u00a0: vous recevrez un email pour vous connecter. Aucun mot de passe à retenir.")
        ),
        infoPrealable ? message("info", infoPrealable) : null,
        h("div", { class: "carte" }, formulaire)
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Écran 2 : code reçu par email
  // ---------------------------------------------------------------------------

  function ecranCodeEmail() {
    const zone = h("div");
    const champ = h("input", {
      id: "champ-code-email", class: "code", type: "text", name: "code",
      autocomplete: "one-time-code", inputmode: "numeric", maxlength: "6", required: true,
    });
    chiffresSeulement(champ);
    const bouton = h("button", { class: "bouton", type: "submit" }, "Me connecter");
    const renvoyer = h("button", { class: "bouton-lien", type: "button" }, "Renvoyer l'email");
    const changer = h("button", { class: "bouton-lien", type: "button", onclick: () => ecranEmail() }, "Changer d'adresse");

    // Délai d'une minute avant de pouvoir redemander un code.
    let restant = 60;
    renvoyer.disabled = true;
    const minuteur = setInterval(() => {
      restant -= 1;
      renvoyer.textContent = restant > 0 ? `Renvoyer l'email (${restant} s)` : "Renvoyer l'email";
      if (restant <= 0) { renvoyer.disabled = false; clearInterval(minuteur); }
    }, 1000);

    renvoyer.addEventListener("click", async () => {
      renvoyer.disabled = true;
      const { error } = await demanderAcces(etat.email);
      if (error && !/signups not allowed|otp_disabled/i.test(`${error.code} ${error.message}`)) {
        renvoyer.disabled = false;
        return signaler(zone, "erreur", texteErreur(error));
      }
      clearInterval(minuteur);
      ecranCodeEmail();
    });

    const formulaire = h("form", { novalidate: true },
      h("label", { for: "champ-code-email" }, "Votre email contient un code à 6 chiffres\u00a0?", h("span", { class: "aide" }, "Saisissez-le ici. Sinon, cliquez simplement sur le lien de l'email."), champ),
      zone,
      bouton,
      h("div", { class: "actions-secondaires" }, renvoyer, changer)
    );

    // Secours sur téléphone : le lien s'ouvre parfois dans un autre navigateur.
    const zoneLien = h("div");
    const champLien = h("input", { id: "champ-lien-email", type: "text", inputmode: "url", autocomplete: "off", placeholder: "https://…supabase.co/auth/v1/verify…" });
    const formulaireLien = h("form", { novalidate: true },
      h("label", { for: "champ-lien-email" }, "Le lien s'ouvre dans un autre navigateur\u00a0?",
        h("span", { class: "aide" }, "Dans l'email, appui long sur le lien, « Copier l'adresse du lien », puis collez-le ici."),
        champLien),
      zoneLien,
      h("button", { class: "bouton bouton-secondaire", type: "submit" }, "Ouvrir le lien ici")
    );
    formulaireLien.addEventListener("submit", (evenement) => {
      evenement.preventDefault();
      let url;
      try { url = new URL(champLien.value.trim()); } catch { url = null; }
      const attendu = new URL(config.supabaseUrl);
      if (!url || url.origin !== attendu.origin || !url.pathname.startsWith("/auth/v1/verify")) {
        return signaler(zoneLien, "erreur", "Ce n'est pas le lien de connexion de l'email. Copiez le lien du bouton de connexion, en entier.");
      }
      clearInterval(minuteur);
      window.location.href = url.href;
    });

    formulaire.addEventListener("submit", async (evenement) => {
      evenement.preventDefault();
      if (!codeValide(champ.value)) {
        return signaler(zone, "erreur", "Le code contient exactement 6 chiffres.");
      }
      signaler(zone);
      occupe(bouton, true, "Vérification…");
      const { error } = await sb.auth.verifyOtp({ email: etat.email, token: champ.value, type: "email" });
      occupe(bouton, false);
      if (error) return signaler(zone, "erreur", texteErreur(error));
      clearInterval(minuteur);
      aiguiller();
    });

    afficher(
      h("div", { class: "pile" },
        h("div", {},
          h("p", { class: "surtitre" }, "Connexion · étape 2 sur 2"),
          h("h1", {}, "Ouvrez votre boîte mail"),
          h("p", { class: "chapo" },
            `Si l'adresse ${etat.email} a un accès, un email de connexion vient de lui être envoyé. Cliquez sur le lien qu'il contient : vous arriverez directement dans votre espace. Il est valable une heure. Pensez à regarder dans les courriers indésirables.`)
        ),
        h("div", { class: "carte" }, formulaire),
        h("div", { class: "carte" }, formulaireLien)
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Écran 3a : première connexion de l'administratrice — inscrire le téléphone
  // ---------------------------------------------------------------------------

  async function ecranInscriptionApplication(facteurs) {
    afficher(h("p", { class: "chargement" }, "Préparation de la double authentification…"));

    // Supprime une inscription commencée mais jamais terminée.
    for (const f of facteurs?.all || []) {
      if (f.factor_type === "totp" && f.status !== "verified") {
        await sb.auth.mfa.unenroll({ factorId: f.id });
      }
    }

    const { data, error } = await sb.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Téléphone",
      issuer: "Fil Rouge Apprenants",
    });
    if (error) return afficher(message("erreur", texteErreur(error)));

    const zone = h("div");
    const champ = h("input", {
      id: "champ-code-mfa-inscription", class: "code", type: "text",
      autocomplete: "one-time-code", inputmode: "numeric", maxlength: "6", required: true,
    });
    chiffresSeulement(champ);
    const bouton = h("button", { class: "bouton", type: "submit" }, "Activer la double authentification");

    const formulaire = h("form", { novalidate: true },
      h("ol", { class: "etapes-mfa" },
        h("li", {}, "Installez sur votre téléphone une application d'authentification : Google Authenticator, Microsoft Authenticator ou une équivalente."),
        h("li", {}, "Dans l'application, ajoutez un compte en scannant ce QR code."),
        h("li", {}, "Saisissez le code à 6 chiffres affiché par l'application.")
      ),
      h("img", { class: "qr", src: data.totp.qr_code, alt: "QR code à scanner avec l'application d'authentification", width: "176", height: "176" }),
      h("p", { class: "aide" }, "Impossible de scanner ? Saisissez cette clé dans l'application :"),
      h("p", { class: "secret" }, data.totp.secret),
      h("label", { for: "champ-code-mfa-inscription" }, "Code affiché par l'application", champ),
      zone,
      bouton
    );

    formulaire.addEventListener("submit", async (evenement) => {
      evenement.preventDefault();
      if (!codeValide(champ.value)) return signaler(zone, "erreur", "Le code contient exactement 6 chiffres.");
      signaler(zone);
      occupe(bouton, true, "Vérification…");
      const { error: erreurVerif } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: champ.value });
      occupe(bouton, false);
      if (erreurVerif) return signaler(zone, "erreur", "Ce code ne correspond pas. Attendez que l'application affiche un nouveau code, puis réessayez.");
      aiguiller();
    });

    afficher(
      h("div", { class: "pile" },
        h("div", {},
          h("p", { class: "surtitre" }, "Sécurité du compte administratrice"),
          h("h1", {}, "Activez la double authentification"),
          h("p", { class: "chapo" }, "Votre compte voit les apprenants de tous vos clients. Un second code, généré par votre téléphone, sera demandé à chaque connexion. Cette étape ne se fait qu'une fois.")
        ),
        h("div", { class: "carte" }, formulaire)
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Écran 3b : connexions suivantes de l'administratrice — code de l'application
  // ---------------------------------------------------------------------------

  function ecranCodeApplication(factorId) {
    const zone = h("div");
    const champ = h("input", {
      id: "champ-code-mfa", class: "code", type: "text",
      autocomplete: "one-time-code", inputmode: "numeric", maxlength: "6", required: true,
    });
    chiffresSeulement(champ);
    const bouton = h("button", { class: "bouton", type: "submit" }, "Valider");

    const formulaire = h("form", { novalidate: true },
      h("label", { for: "champ-code-mfa" }, "Code de l'application d'authentification",
        h("span", { class: "aide" }, "Ouvrez l'application sur votre téléphone, ligne « Fil Rouge Apprenants »."),
        champ),
      zone,
      bouton
    );

    formulaire.addEventListener("submit", async (evenement) => {
      evenement.preventDefault();
      if (!codeValide(champ.value)) return signaler(zone, "erreur", "Le code contient exactement 6 chiffres.");
      signaler(zone);
      occupe(bouton, true, "Vérification…");
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: champ.value });
      occupe(bouton, false);
      if (error) return signaler(zone, "erreur", "Ce code ne correspond pas. Attendez le code suivant de l'application, puis réessayez.");
      aiguiller();
    });

    afficher(
      h("div", { class: "pile" },
        h("div", {},
          h("p", { class: "surtitre" }, "Double authentification"),
          h("h1", {}, "Un dernier code"),
          h("p", { class: "chapo" }, "Pour protéger les données de vos clients, confirmez votre connexion avec votre téléphone.")
        ),
        h("div", { class: "carte" }, formulaire)
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Écran : compte sans accès
  // ---------------------------------------------------------------------------

  function ecranSansAcces(email) {
    zoneCompte.hidden = false;
    compteLibelle.textContent = email || "";
    afficher(
      h("div", { class: "pile" },
        h("div", {},
          h("p", { class: "surtitre" }, "Accès"),
          h("h1", {}, "Votre accès n'est pas encore ouvert"),
          h("p", { class: "chapo" }, "Votre compte existe, mais aucun espace ne lui est encore attribué, ou cet accès a été fermé. Contactez Fil Rouge Apprenants pour l'ouvrir.")
        )
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Accueils selon le rôle
  // ---------------------------------------------------------------------------

  function compterAlertes(lignes) {
    const total = { vert: 0, orange: 0, rouge: 0 };
    for (const l of lignes) total[l.alerte] = (total[l.alerte] || 0) + 1;
    return total;
  }

  function blocCompteurs(total, suivis) {
    return h("div", { class: "compteurs" },
      h("div", { class: "compteur" },
        h("span", { class: "compteur-valeur" }, suivis),
        h("span", { class: "compteur-libelle" }, "apprenants suivis")),
      h("div", { class: "compteur compteur-vert" },
        h("span", { class: "compteur-valeur" }, total.vert),
        h("span", { class: "compteur-libelle" }, "à jour")),
      h("div", { class: "compteur compteur-orange" },
        h("span", { class: "compteur-valeur" }, total.orange),
        h("span", { class: "compteur-libelle" }, "à surveiller")),
      h("div", { class: "compteur compteur-rouge" },
        h("span", { class: "compteur-valeur" }, total.rouge),
        h("span", { class: "compteur-libelle" }, "en alerte"))
    );
  }

  function pastille(couleur, texte) {
    return h("span", { class: `pastille pastille-${couleur}` }, texte);
  }

  function libelleAlerte(alerte) {
    return { vert: "à jour", orange: "à surveiller", rouge: "en alerte" }[alerte] || alerte;
  }

  function listeApprenants(lignes) {
    if (!lignes.length) {
      return message("info", "Aucun apprenant actif pour le moment.");
    }
    return h("ul", { class: "liste" },
      lignes.map((a) =>
        h("li", { class: "ligne" },
          h("span", { class: "ligne-titre" }, `${a.prenom || ""} ${a.nom || ""}`.trim() || a.identifiant_externe || "Apprenant"),
          h("span", { class: "pastilles" },
            pastille(a.alerte, `${a.jours_sans_contact} j · ${libelleAlerte(a.alerte)}`)),
          h("span", { class: "ligne-detail" }, a.parcours || "")
        )
      )
    );
  }

  const ordreAlerte = { rouge: 0, orange: 1, vert: 2 };
  function trierParUrgence(lignes) {
    return lignes.slice().sort((a, b) =>
      (ordreAlerte[a.alerte] - ordreAlerte[b.alerte]) || (b.jours_sans_contact - a.jours_sans_contact));
  }

  // ===========================================================================
  // ESPACE ADMINISTRATRICE
  // ===========================================================================
  // Adresses internes (après le #) :
  //   #/                  tableau de bord
  //   #/prospection       CRM : liste des organismes, filtrable par étape
  //   #/prospection/client  (ou toute autre étape) : liste filtrée
  //   #/nouveau           formulaire d'ajout d'un organisme
  //   #/organisme/<id>    fiche d'un organisme : suivi commercial et échanges
  // ===========================================================================

  const ETAPES = ["prospect", "contacte", "test_gratuit", "client", "perdu"];
  const LIBELLE_ETAPE_UNE = {
    prospect: "Prospect", contacte: "Contacté", test_gratuit: "Test gratuit", client: "Client", perdu: "Perdu",
  };
  const COULEUR_ETAPE = {
    prospect: "neutre", contacte: "orange", test_gratuit: "orange", client: "vert", perdu: "neutre",
  };
  const CANAUX = { email: "Email", telephone: "Téléphone", linkedin: "LinkedIn", visio: "Visio", autre: "Autre" };
  const FORMULES = { "": "—", "30": "Jusqu'à 30 apprenants (590 €/mois)", "80": "Jusqu'à 80 apprenants (990 €/mois)", "150": "Jusqu'à 150 apprenants (1 490 €/mois)", sur_devis: "Sur devis" };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Date du jour à l'heure de Paris, au format AAAA-MM-JJ.
  function aujourdhui() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  }
  function ajouterJours(dateIso, n) {
    const d = new Date(`${dateIso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function dateLisible(dateIso) {
    if (!dateIso) return "";
    return new Date(`${dateIso}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }
  // « aujourd'hui », « demain », « il y a 3 j », « dans 5 j »
  function ecartJours(dateIso) {
    const n = Math.round((new Date(`${dateIso}T12:00:00Z`) - new Date(`${aujourdhui()}T12:00:00Z`)) / 86400000);
    if (n === 0) return "aujourd'hui";
    if (n === 1) return "demain";
    if (n === -1) return "hier";
    return n < 0 ? `en retard de ${-n} j` : `dans ${n} j`;
  }

  function lireRoute() {
    const brut = window.location.hash.replace(/^#\/?/, "");
    // Les jetons de connexion passent aussi par le # : on les ignore.
    if (/access_token=|error=|type=/.test(brut)) return { nom: "accueil" };
    const morceaux = brut.split("/").filter(Boolean);
    if (morceaux[0] === "prospection") return { nom: "prospection", etape: ETAPES.includes(morceaux[1]) ? morceaux[1] : null };
    if (morceaux[0] === "nouveau") return { nom: "nouveau" };
    if (morceaux[0] === "organisme" && UUID.test(morceaux[1] || "")) return { nom: "organisme", id: morceaux[1] };
    return { nom: "accueil" };
  }

  function aller(chemin) {
    if (window.location.hash === `#/${chemin}`) routeAdmin();
    else window.location.hash = `#/${chemin}`;
  }

  function lienInterne(chemin, ...enfants) {
    return h("a", { href: `#/${chemin}`, class: "lien-interne" }, ...enfants);
  }

  function navigationAdmin(actif) {
    const onglet = (chemin, texte, cle) =>
      h("a", { href: `#/${chemin}`, class: "onglet", "aria-current": actif === cle ? "page" : null }, texte);
    return h("nav", { class: "onglets", "aria-label": "Sections" },
      onglet("", "Tableau de bord", "accueil"),
      onglet("prospection", "Prospection", "prospection"));
  }

  function routeAdmin() {
    if (!etat.profil || etat.profil.role !== "admin") return aiguiller();
    const route = lireRoute();
    if (route.nom === "prospection") return ecranProspection(route.etape);
    if (route.nom === "nouveau") return ecranNouvelOrganisme();
    if (route.nom === "organisme") return ecranOrganisme(route.id);
    return accueilAdmin(etat.profil);
  }

  window.addEventListener("hashchange", () => {
    if (etat.profil && etat.profil.role === "admin") routeAdmin();
  });

  // ---------------------------------------------------------------------------
  // Tableau de bord
  // ---------------------------------------------------------------------------

  async function accueilAdmin(profil) {
    afficher(navigationAdmin("accueil"), h("p", { class: "chargement" }, "Chargement du tableau de bord…"));

    const [apprenants, suivi] = await Promise.all([
      sb.from("vue_qui_rappeler").select("organisme_id, organisme_nom, alerte"),
      sb.from("organismes_suivi_commercial").select("organisme_id, etape, prochaine_relance"),
    ]);
    if (apprenants.error || suivi.error) {
      return afficher(navigationAdmin("accueil"), message("erreur", texteErreur(apprenants.error || suivi.error)));
    }

    const parOrganisme = new Map();
    for (const l of apprenants.data) {
      if (!parOrganisme.has(l.organisme_id)) parOrganisme.set(l.organisme_id, { id: l.organisme_id, nom: l.organisme_nom, lignes: [] });
      parOrganisme.get(l.organisme_id).lignes.push(l);
    }

    const etapes = {};
    for (const s of suivi.data) etapes[s.etape] = (etapes[s.etape] || 0) + 1;
    const ajd = aujourdhui();
    const aRelancer = suivi.data.filter((s) => s.prochaine_relance && s.prochaine_relance <= ajd && s.etape !== "perdu").length;

    const prenom = (profil.nom_affiche || "").split(" ")[0];

    afficher(
      navigationAdmin("accueil"),
      h("div", { class: "pile" },
        h("div", {},
          h("p", { class: "surtitre" }, "Tableau de bord"),
          h("h1", {}, prenom ? `Bonjour ${prenom}` : "Bonjour"),
          h("p", { class: "chapo" }, "Vue d'ensemble de vos clients et de votre prospection.")
        ),
        h("p", { class: "bandeau-demo" }, "Construction en cours : les apprenants affichés sont fictifs."),

        aRelancer
          ? h("p", { class: "message message-action" },
              h("strong", {}, pluriel(aRelancer, "organisme à relancer", "organismes à relancer")),
              " aujourd'hui ou en retard. ",
              lienInterne("prospection", "Voir la liste"))
          : null,

        blocCompteurs(compterAlertes(apprenants.data), apprenants.data.length),

        h("section", {},
          h("div", { class: "section-titre" },
            h("h2", {}, "Par client"),
            h("p", {}, pluriel(parOrganisme.size, "organisme", "organismes"))),
          parOrganisme.size
            ? h("ul", { class: "liste" },
                [...parOrganisme.values()].map((o) => {
                  const t = compterAlertes(o.lignes);
                  return h("li", { class: "ligne" },
                    h("span", { class: "ligne-titre" }, lienInterne(`organisme/${o.id}`, o.nom)),
                    h("span", { class: "pastilles" },
                      t.rouge ? pastille("rouge", `${t.rouge} en alerte`) : null,
                      t.orange ? pastille("orange", `${t.orange} à surveiller`) : null,
                      pastille("vert", `${t.vert} à jour`)),
                    h("span", { class: "ligne-detail" }, pluriel(o.lignes.length, "apprenant actif", "apprenants actifs")));
                }))
            : message("info", "Aucun client avec des apprenants pour le moment.")
        ),

        h("section", {},
          h("div", { class: "section-titre" },
            h("h2", {}, "Prospection"),
            h("p", {}, lienInterne("prospection", "Ouvrir le CRM"))),
          h("ul", { class: "liste" },
            ETAPES.map((etape) =>
              h("li", { class: "ligne" },
                h("span", { class: "ligne-titre" }, lienInterne(`prospection/${etape}`, LIBELLES_ETAPE[etape])),
                h("span", { class: "pastilles" }, pastille("neutre", String(etapes[etape] || 0))))))
        )
      )
    );
  }

  // ---------------------------------------------------------------------------
  // CRM : liste des organismes
  // ---------------------------------------------------------------------------

  async function ecranProspection(filtre) {
    afficher(navigationAdmin("prospection"), h("p", { class: "chargement" }, "Chargement de la prospection…"));

    const { data, error } = await sb
      .from("organismes")
      .select("id, nom, organismes_suivi_commercial ( etape, contact_nom, contact_fonction, prochaine_relance )")
      .order("nom");
    if (error) return afficher(navigationAdmin("prospection"), message("erreur", texteErreur(error)));

    const lignes = data.map((o) => ({ id: o.id, nom: o.nom, ...(o.organismes_suivi_commercial || { etape: "prospect" }) }));
    const ajd = aujourdhui();
    const compte = {};
    for (const l of lignes) compte[l.etape] = (compte[l.etape] || 0) + 1;

    const aRelancer = lignes
      .filter((l) => l.prochaine_relance && l.prochaine_relance <= ajd && l.etape !== "perdu")
      .sort((a, b) => a.prochaine_relance.localeCompare(b.prochaine_relance));

    const visibles = lignes
      .filter((l) => !filtre || l.etape === filtre)
      .sort((a, b) => (a.prochaine_relance || "9999").localeCompare(b.prochaine_relance || "9999") || a.nom.localeCompare(b.nom, "fr"));

    const filtreBouton = (cle, texte, n) =>
      h("a", { href: cle ? `#/prospection/${cle}` : "#/prospection", class: "filtre", "aria-current": (filtre || null) === cle ? "true" : null },
        texte, h("span", { class: "filtre-nombre" }, String(n)));

    const ligneOrganisme = (l) => {
      const enRetard = l.prochaine_relance && l.prochaine_relance <= ajd && l.etape !== "perdu";
      return h("li", { class: "ligne" },
        h("span", { class: "ligne-titre" }, lienInterne(`organisme/${l.id}`, l.nom)),
        h("span", { class: "pastilles" }, pastille(COULEUR_ETAPE[l.etape], LIBELLE_ETAPE_UNE[l.etape])),
        h("span", { class: "ligne-detail" },
          [l.contact_nom, l.contact_fonction].filter(Boolean).join(" · ") || "Contact à identifier",
          l.prochaine_relance
            ? h("span", { class: enRetard ? "relance relance-retard" : "relance" }, ` · Relance ${ecartJours(l.prochaine_relance)}`)
            : null));
    };

    afficher(
      navigationAdmin("prospection"),
      h("div", { class: "pile" },
        h("div", { class: "entete-action" },
          h("div", {},
            h("p", { class: "surtitre" }, "Prospection"),
            h("h1", {}, "Vos organismes")),
          h("a", { href: "#/nouveau", class: "bouton bouton-petit" }, "+ Ajouter")),

        aRelancer.length
          ? h("section", {},
              h("div", { class: "section-titre" },
                h("h2", {}, "À relancer"),
                h("p", {}, "aujourd'hui ou en retard")),
              h("ul", { class: "liste" }, aRelancer.map(ligneOrganisme)))
          : message("info", "Aucune relance prévue aujourd'hui."),

        h("section", {},
          h("div", { class: "section-titre" }, h("h2", {}, "Tous les organismes")),
          h("div", { class: "filtres" },
            filtreBouton(null, "Tous", lignes.length),
            ETAPES.map((e) => filtreBouton(e, LIBELLES_ETAPE[e], compte[e] || 0))),
          visibles.length
            ? h("ul", { class: "liste" }, visibles.map(ligneOrganisme))
            : message("info", filtre ? "Aucun organisme à cette étape." : "Aucun organisme pour le moment. Ajoutez votre premier prospect."))
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Champs de formulaire réutilisables
  // ---------------------------------------------------------------------------

  function champTexte(id, libelle, valeur, options = {}) {
    const champ = h(options.multiligne ? "textarea" : "input", {
      id, name: id, type: options.multiligne ? null : (options.type || "text"),
      rows: options.multiligne ? "4" : null,
      required: options.obligatoire || null, autocomplete: options.autocomplete || "off",
      inputmode: options.inputmode || null, placeholder: options.placeholder || null,
    });
    champ.value = valeur || "";
    return {
      champ,
      bloc: h("label", { for: id }, libelle,
        options.aide ? h("span", { class: "aide" }, options.aide) : null, champ),
    };
  }

  function champChoix(id, libelle, choix, valeur) {
    const champ = h("select", { id, name: id },
      Object.entries(choix).map(([cle, texte]) => h("option", { value: cle }, texte)));
    champ.value = valeur ?? Object.keys(choix)[0];
    return { champ, bloc: h("label", { for: id }, libelle, champ) };
  }

  const CHOIX_ETAPES = Object.fromEntries(ETAPES.map((e) => [e, LIBELLE_ETAPE_UNE[e]]));

  // ---------------------------------------------------------------------------
  // CRM : ajouter un organisme
  // ---------------------------------------------------------------------------

  function ecranNouvelOrganisme() {
    const zone = h("div");
    const nom = champTexte("org-nom", "Nom de l'organisme", "", { obligatoire: true, placeholder: "Ex. : EFC Formation" });
    const etape = champChoix("org-etape", "Étape", CHOIX_ETAPES, "prospect");
    const contact = champTexte("org-contact", "Contact", "", { placeholder: "Prénom Nom" });
    const fonction = champTexte("org-fonction", "Fonction", "", { placeholder: "Ex. : Directrice pédagogique" });
    const email = champTexte("org-email", "Email", "", { type: "email", inputmode: "email" });
    const tel = champTexte("org-tel", "Téléphone", "", { type: "tel", inputmode: "tel" });
    const relance = champTexte("org-relance", "Prochaine relance", "", { type: "date" });
    const notes = champTexte("org-notes", "Notes", "", { multiligne: true });
    const bouton = h("button", { class: "bouton", type: "submit" }, "Enregistrer l'organisme");

    const formulaire = h("form", { novalidate: true, class: "formulaire" },
      nom.bloc, etape.bloc,
      h("div", { class: "deux-colonnes" }, contact.bloc, fonction.bloc),
      h("div", { class: "deux-colonnes" }, email.bloc, tel.bloc),
      relance.bloc, notes.bloc, zone, bouton);

    formulaire.addEventListener("submit", async (evenement) => {
      evenement.preventDefault();
      if (!nom.champ.value.trim()) return signaler(zone, "erreur", "Indiquez le nom de l'organisme.");
      signaler(zone);
      occupe(bouton, true, "Enregistrement…");
      const { data, error } = await sb.rpc("creer_organisme", {
        p_nom: nom.champ.value,
        p_etape: etape.champ.value,
        p_contact_nom: contact.champ.value,
        p_contact_fonction: fonction.champ.value,
        p_contact_email: email.champ.value,
        p_contact_telephone: tel.champ.value,
        p_prochaine_relance: relance.champ.value || null,
        p_notes: notes.champ.value,
      });
      occupe(bouton, false);
      if (error) return signaler(zone, "erreur", texteErreur(error));
      aller(`organisme/${data}`);
    });

    afficher(
      navigationAdmin("prospection"),
      h("div", { class: "pile" },
        h("div", {},
          h("p", { class: "surtitre" }, lienInterne("prospection", "← Prospection")),
          h("h1", {}, "Ajouter un organisme")),
        h("div", { class: "carte carte-large" }, formulaire))
    );
  }

  // ---------------------------------------------------------------------------
  // CRM : fiche d'un organisme
  // ---------------------------------------------------------------------------

  async function ecranOrganisme(id) {
    afficher(navigationAdmin("prospection"), h("p", { class: "chargement" }, "Chargement de la fiche…"));

    const [org, echanges, nbApprenants] = await Promise.all([
      sb.from("organismes").select("id, nom, organismes_suivi_commercial ( * )").eq("id", id).maybeSingle(),
      sb.from("echanges_commerciaux").select("id, date_echange, canal, resume").eq("organisme_id", id)
        .order("date_echange", { ascending: false }).order("cree_le", { ascending: false }),
      sb.from("apprenants").select("id", { count: "exact", head: true }).eq("organisme_id", id),
    ]);
    const erreur = org.error || echanges.error || nbApprenants.error;
    if (erreur) return afficher(navigationAdmin("prospection"), message("erreur", texteErreur(erreur)));
    if (!org.data) return afficher(navigationAdmin("prospection"), message("info", "Cet organisme n'existe plus."), lienInterne("prospection", "← Retour à la prospection"));

    const s = org.data.organismes_suivi_commercial || {};
    const apprenantsCount = nbApprenants.count || 0;

    // --- Bloc « Suivi commercial » ---
    const zone = h("div");
    const nom = champTexte("fiche-nom", "Nom de l'organisme", org.data.nom, { obligatoire: true });
    const etape = champChoix("fiche-etape", "Étape", CHOIX_ETAPES, s.etape || "prospect");
    const contact = champTexte("fiche-contact", "Contact", s.contact_nom);
    const fonction = champTexte("fiche-fonction", "Fonction", s.contact_fonction);
    const email = champTexte("fiche-email", "Email", s.contact_email, { type: "email", inputmode: "email" });
    const tel = champTexte("fiche-tel", "Téléphone", s.contact_telephone, { type: "tel", inputmode: "tel" });
    const relance = champTexte("fiche-relance", "Prochaine relance", s.prochaine_relance, { type: "date" });
    const formule = champChoix("fiche-formule", "Formule", FORMULES, s.formule || "");
    const debut = champTexte("fiche-debut", "Début du contrat", s.date_debut_contrat, { type: "date" });
    const notes = champTexte("fiche-notes", "Notes", s.notes, { multiligne: true });
    const bouton = h("button", { class: "bouton", type: "submit" }, "Enregistrer");

    const raccourcis = h("div", { class: "raccourcis" },
      h("span", { class: "aide" }, "Relancer :"),
      [["Demain", 1], ["Dans 7 j", 7], ["Dans 15 j", 15], ["Dans 1 mois", 30]].map(([texte, n]) =>
        h("button", { type: "button", class: "puce", onclick: () => { relance.champ.value = ajouterJours(aujourdhui(), n); } }, texte)),
      h("button", { type: "button", class: "puce", onclick: () => { relance.champ.value = ""; } }, "Aucune"));

    const blocContrat = h("div", { class: "deux-colonnes" }, formule.bloc, debut.bloc);
    const majContrat = () => { blocContrat.hidden = etape.champ.value !== "client"; };
    etape.champ.addEventListener("change", majContrat);
    majContrat();

    const formulaire = h("form", { novalidate: true, class: "formulaire" },
      nom.bloc, etape.bloc, blocContrat,
      h("div", { class: "deux-colonnes" }, contact.bloc, fonction.bloc),
      h("div", { class: "deux-colonnes" }, email.bloc, tel.bloc),
      relance.bloc, raccourcis, notes.bloc, zone, bouton);

    formulaire.addEventListener("submit", async (evenement) => {
      evenement.preventDefault();
      if (!nom.champ.value.trim()) return signaler(zone, "erreur", "Indiquez le nom de l'organisme.");
      signaler(zone);
      occupe(bouton, true, "Enregistrement…");
      const vide = (v) => (v && v.trim() ? v.trim() : null);
      const r1 = nom.champ.value.trim() !== org.data.nom
        ? await sb.from("organismes").update({ nom: nom.champ.value.trim() }).eq("id", id)
        : { error: null };
      const r2 = r1.error ? r1 : await sb.from("organismes_suivi_commercial").upsert({
        organisme_id: id,
        etape: etape.champ.value,
        contact_nom: vide(contact.champ.value),
        contact_fonction: vide(fonction.champ.value),
        contact_email: vide(email.champ.value),
        contact_telephone: vide(tel.champ.value),
        prochaine_relance: relance.champ.value || null,
        formule: etape.champ.value === "client" ? (formule.champ.value || null) : (s.formule || null),
        date_debut_contrat: etape.champ.value === "client" ? (debut.champ.value || null) : (s.date_debut_contrat || null),
        notes: vide(notes.champ.value),
      });
      occupe(bouton, false);
      if (r2.error) return signaler(zone, "erreur", texteErreur(r2.error));
      org.data.nom = nom.champ.value.trim();
      titre.textContent = org.data.nom;
      signaler(zone, "info", "Enregistré.");
    });

    // --- Bloc « Échanges » ---
    const zoneEchange = h("div");
    const dateEchange = champTexte("echange-date", "Date", aujourdhui(), { type: "date" });
    const canal = champChoix("echange-canal", "Canal", CANAUX, "email");
    const resume = champTexte("echange-resume", "Ce qui s'est passé", "", { multiligne: true, placeholder: "Ex. : Email n°1 envoyé. / Appel : intéressée, rappeler après les vacances." });
    const boutonEchange = h("button", { class: "bouton bouton-secondaire", type: "submit" }, "Ajouter à l'historique");
    const formulaireEchange = h("form", { novalidate: true, class: "formulaire" },
      h("div", { class: "deux-colonnes" }, dateEchange.bloc, canal.bloc),
      resume.bloc, zoneEchange, boutonEchange);

    formulaireEchange.addEventListener("submit", async (evenement) => {
      evenement.preventDefault();
      if (!resume.champ.value.trim()) return signaler(zoneEchange, "erreur", "Décrivez l'échange en une phrase.");
      signaler(zoneEchange);
      occupe(boutonEchange, true, "Ajout…");
      const { error } = await sb.from("echanges_commerciaux").insert({
        organisme_id: id,
        date_echange: dateEchange.champ.value || aujourdhui(),
        canal: canal.champ.value,
        resume: resume.champ.value.trim(),
        auteur_id: etat.profil.id,
      });
      occupe(boutonEchange, false);
      if (error) return signaler(zoneEchange, "erreur", texteErreur(error));
      ecranOrganisme(id);
    });

    const historique = echanges.data.length
      ? h("ul", { class: "liste" }, echanges.data.map((e) =>
          h("li", { class: "ligne ligne-echange" },
            h("span", { class: "ligne-titre" }, dateLisible(e.date_echange)),
            h("span", { class: "pastilles" }, pastille("neutre", CANAUX[e.canal] || e.canal)),
            h("span", { class: "ligne-detail texte-libre" }, e.resume))))
      : message("info", "Aucun échange enregistré pour l'instant.");

    // --- Bloc « Supprimer » (prospects sans apprenants uniquement) ---
    let blocSuppression = null;
    if (apprenantsCount === 0) {
      const zoneSuppr = h("div");
      const confirmer = h("button", { type: "button", class: "bouton bouton-danger", hidden: true }, "Oui, supprimer définitivement");
      const annuler = h("button", { type: "button", class: "bouton-lien", hidden: true }, "Annuler");
      const demander = h("button", { type: "button", class: "bouton-lien bouton-lien-danger" }, "Supprimer cet organisme");
      demander.addEventListener("click", () => {
        demander.hidden = true; confirmer.hidden = false; annuler.hidden = false;
        signaler(zoneSuppr, "erreur", `Supprimer « ${org.data.nom} » et tout son historique ? Cette action est définitive.`);
      });
      annuler.addEventListener("click", () => {
        demander.hidden = false; confirmer.hidden = true; annuler.hidden = true; signaler(zoneSuppr);
      });
      confirmer.addEventListener("click", async () => {
        occupe(confirmer, true, "Suppression…");
        const { error } = await sb.rpc("supprimer_prospect", { p_organisme: id });
        occupe(confirmer, false);
        if (error) return signaler(zoneSuppr, "erreur", texteErreur(error));
        aller("prospection");
      });
      blocSuppression = h("section", { class: "zone-suppression" }, zoneSuppr, h("div", { class: "actions-secondaires" }, demander, confirmer, annuler));
    }

    const titre = h("h1", {}, org.data.nom);

    afficher(
      navigationAdmin("prospection"),
      h("div", { class: "pile" },
        h("div", {},
          h("p", { class: "surtitre" }, lienInterne("prospection", "← Prospection")),
          titre,
          h("p", { class: "chapo" },
            pastille(COULEUR_ETAPE[s.etape || "prospect"], LIBELLE_ETAPE_UNE[s.etape || "prospect"]),
            apprenantsCount ? ` · ${pluriel(apprenantsCount, "apprenant suivi", "apprenants suivis")}` : "",
            s.prochaine_relance ? ` · Relance ${ecartJours(s.prochaine_relance)} (${dateLisible(s.prochaine_relance)})` : "")),

        h("section", {},
          h("div", { class: "section-titre" }, h("h2", {}, "Historique des échanges"), h("p", {}, pluriel(echanges.data.length, "échange", "échanges"))),
          h("div", { class: "carte carte-large" }, formulaireEchange),
          historique),

        h("section", {},
          h("div", { class: "section-titre" }, h("h2", {}, "Suivi commercial")),
          h("div", { class: "carte carte-large" }, formulaire)),

        blocSuppression
      )
    );
    // Pas de focus automatique sur la fiche : la page s'ouvre en haut.
    window.scrollTo(0, 0);
  }

  async function accueilClient(profil) {
    afficher(h("p", { class: "chargement" }, "Chargement de vos apprenants…"));

    const [organisme, apprenants] = await Promise.all([
      sb.from("organismes").select("nom").eq("id", profil.organisme_id).maybeSingle(),
      sb.from("vue_qui_rappeler").select("identifiant_externe, prenom, nom, parcours, jours_sans_contact, alerte"),
    ]);
    if (organisme.error || apprenants.error) {
      return afficher(message("erreur", texteErreur(organisme.error || apprenants.error)));
    }

    afficher(
      h("div", { class: "pile" },
        h("div", {},
          h("p", { class: "surtitre" }, "Espace client"),
          h("h1", {}, organisme.data?.nom || "Vos apprenants"),
          h("p", { class: "chapo" }, "Le suivi de vos apprenants, mis à jour après chaque appel.")
        ),
        blocCompteurs(compterAlertes(apprenants.data), apprenants.data.length),
        h("section", {},
          h("div", { class: "section-titre" },
            h("h2", {}, "Vos apprenants"),
            h("p", {}, "Les plus urgents en premier")),
          listeApprenants(trierParUrgence(apprenants.data)))
      )
    );
  }

  async function accueilAppelante(profil) {
    afficher(h("p", { class: "chargement" }, "Chargement de vos apprenants…"));
    const { data, error } = await sb
      .from("vue_qui_rappeler")
      .select("identifiant_externe, prenom, nom, parcours, jours_sans_contact, alerte");
    if (error) return afficher(message("erreur", texteErreur(error)));

    afficher(
      h("div", { class: "pile" },
        h("div", {},
          h("p", { class: "surtitre" }, "Appels"),
          h("h1", {}, "Qui rappeler en premier ?"),
          h("p", { class: "chapo" }, "Les apprenants qui vous sont confiés, les plus urgents en premier.")
        ),
        listeApprenants(trierParUrgence(data))
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Déconnexion et démarrage
  // ---------------------------------------------------------------------------

  boutonDeconnexion.addEventListener("click", async () => {
    await sb.auth.signOut();
    zoneCompte.hidden = true;
    ecranEmail("Déconnexion effectuée. À bientôt.");
  });

  sb.auth.onAuthStateChange((evenement) => {
    if (evenement === "SIGNED_OUT") {
      zoneCompte.hidden = true;
    }
  });

  aiguiller().catch(() => {
    afficher(message("erreur", "Impossible de joindre le serveur. Vérifiez votre connexion internet, puis rechargez la page."));
  });
})();
