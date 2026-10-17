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
    for (const enfant of enfants.flat(Infinity)) {
      if (enfant === null || enfant === undefined || enfant === false) continue;
      el.append(enfant instanceof Node ? enfant : document.createTextNode(String(enfant)));
    }
    return el;
  }

  function afficher(...elements) {
    // Menu latéral : seulement pour l'administratrice connectée.
    const avecMenu = menuVisible();
    document.body.classList.toggle("avec-menu", avecMenu);
    menu.hidden = !avecMenu;
    boutonMenu.hidden = !avecMenu;
    if (!avecMenu) ouvrirMenu(false);
    contenu.replaceChildren(...elements.filter((e) => e !== null && e !== undefined && e !== false));
    // Onglets trop larges pour un téléphone : on fait défiler jusqu'à l'onglet actif.
    const ongletActif = contenu.querySelector(".onglet[aria-current='page']");
    if (ongletActif && ongletActif.parentElement) {
      ongletActif.parentElement.scrollLeft = Math.max(0, ongletActif.offsetLeft - ongletActif.parentElement.offsetLeft - 16);
    }
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

    if (profil.role === "client") {
      etat.profil = profil;
      return routeClient();
    }
    etat.profil = profil;
    return routeAppelante();
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
      h("label", { for: "champ-code-email" }, "Code reçu par email", h("span", { class: "aide" }, "Les 6 chiffres de l'email. C'est le plus sûr sur téléphone."), champ),
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
            `Si l'adresse ${etat.email} a un accès, un email de connexion vient de lui être envoyé. Saisissez le code à 6 chiffres qu'il contient, ou cliquez sur son bouton. Valable une heure, pour une seule connexion. Pensez à regarder dans les courriers indésirables.`)
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
          h("span", { class: "ligne-titre" }, lienApprenant(a)),
          h("span", { class: "pastilles" },
            pastille(a.alerte, `${a.jours_sans_contact} j · ${libelleAlerte(a.alerte)}`)),
          h("span", { class: "ligne-detail" }, a.parcours || "", lienTelephone(a.telephone))
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
    if (morceaux[0] === "rappels") return { nom: "rappels", id: UUID.test(morceaux[1] || "") ? morceaux[1] : null };
    if (morceaux[0] === "import") return { nom: "import", id: UUID.test(morceaux[1] || "") ? morceaux[1] : null };
    if (morceaux[0] === "examens") return { nom: "examens", id: UUID.test(morceaux[1] || "") ? morceaux[1] : null };
    if (morceaux[0] === "acces") return { nom: "acces" };
    if (morceaux[0] === "apprenant" && UUID.test(morceaux[1] || "")) return { nom: "apprenant", id: morceaux[1], onglet: morceaux[2] || null, partie: morceaux[3] || null };
    if (morceaux[0] === "preuves") return { nom: "preuves", id: UUID.test(morceaux[1] || "") ? morceaux[1] : null };
    if (morceaux[0] === "eleves" && UUID.test(morceaux[1] || "")) return { nom: "eleves", id: morceaux[1] };
    if (morceaux[0] === "coaching") return { nom: "coaching", type: morceaux[1] || "stage", id: UUID.test(morceaux[2] || "") ? morceaux[2] : null };
    return { nom: "accueil" };
  }

  function aller(chemin) {
    if (window.location.hash === `#/${chemin}`) routeAdmin();
    else window.location.hash = `#/${chemin}`;
  }

  function lienInterne(chemin, ...enfants) {
    return h("a", { href: `#/${chemin}`, class: "lien-interne" }, ...enfants);
  }

  // Les onglets du haut sont remplacés par le menu latéral (étape 9) :
  // cette fonction reste pour les écrans existants et ne dessine plus rien.
  function navigationAdmin() {
    return null;
  }

  function routeAdmin() {
    if (!etat.profil || etat.profil.role !== "admin") return aiguiller();
    const route = lireRoute();
    etat.dossierActif = null;
    chargerMenu();
    if (route.nom === "eleves") return ecranDossierEleves(route.id);
    if (route.nom === "coaching") return ecranCoaching(route.type, route.id);
    if (route.nom === "prospection") return ecranProspection(route.etape);
    if (route.nom === "nouveau") return ecranNouvelOrganisme();
    if (route.nom === "organisme") return ecranOrganisme(route.id);
    if (route.nom === "rappels") return ecranRappels(route.id);
    if (route.nom === "import") return ecranImport(route.id);
    if (route.nom === "examens") return ecranExamens(route.id);
    if (route.nom === "apprenant") return ecranApprenant(route.id);
    if (route.nom === "acces") return ecranAcces();
    if (route.nom === "preuves") return route.id ? ecranPreuves(route.id) : ecranExamens(null);
    return accueilAdmin(etat.profil);
  }

  // Espace client : son accueil, et son dossier de preuves (#/preuves).
  function routeClient() {
    if (!etat.profil || etat.profil.role !== "client") return aiguiller();
    const route = lireRoute();
    if (route.nom === "preuves") return ecranPreuves(etat.profil.organisme_id);
    if (route.nom === "apprenant") return ecranApprenant(route.id);
    return accueilClient(etat.profil);
  }

  // Espace appelante : ses apprenants confiés, et leur fiche.
  function routeAppelante() {
    if (!etat.profil || etat.profil.role !== "appelante") return aiguiller();
    const route = lireRoute();
    if (route.nom === "apprenant") return ecranApprenant(route.id);
    return accueilAppelante(etat.profil);
  }

  window.addEventListener("hashchange", () => {
    if (etat.profil && etat.profil.role === "admin") routeAdmin();
    else if (etat.profil && etat.profil.role === "client") routeClient();
    else if (etat.profil && etat.profil.role === "appelante") routeAppelante();
  });

  // ---------------------------------------------------------------------------
  // Tableau de bord
  // ---------------------------------------------------------------------------

  async function accueilAdmin(profil) {
    afficher(navigationAdmin("accueil"), h("p", { class: "chargement" }, "Chargement du tableau de bord…"));

    const [apprenants, suivi, relancesExamen] = await Promise.all([
      sb.from("vue_qui_rappeler").select("organisme_id, organisme_nom, alerte"),
      sb.from("organismes_suivi_commercial").select("organisme_id, etape, prochaine_relance"),
      sb.from("vue_relances_examen").select("id").not("etape_relance", "is", null).eq("relance_faite", false),
    ]);
    if (apprenants.error || suivi.error || relancesExamen.error) {
      return afficher(navigationAdmin("accueil"), message("erreur", texteErreur(apprenants.error || suivi.error || relancesExamen.error)));
    }
    const nbRelancesExamen = relancesExamen.data.length;

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

        nbRelancesExamen
          ? h("p", { class: "message message-action" },
              h("strong", {}, pluriel(nbRelancesExamen, "relance d'examen", "relances d'examen")),
              " à faire (J-30, J-7 ou J-1). ",
              lienInterne("examens", "Voir les examens"))
          : null,

        blocCompteurs(compterAlertes(apprenants.data), apprenants.data.length),
        h("p", { class: "lien-suite" }, lienInterne("rappels", "Voir qui rappeler en premier →")),

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
                    h("span", { class: "ligne-detail" }, pluriel(o.lignes.length, "apprenant actif", "apprenants actifs"), " · ", lienInterne(`rappels/${o.id}`, "qui rappeler")));
                }))
            : message("info", "Aucun client avec des apprenants pour le moment. Importez un premier fichier depuis la fiche d'un organisme.")
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
          h("div", { class: "section-titre" }, h("h2", {}, "Apprenants"), h("p", {}, pluriel(apprenantsCount, "apprenant", "apprenants"))),
          h("div", { class: "actions-ligne" },
            h("a", { href: `#/import/${id}`, class: "bouton bouton-secondaire bouton-petit" }, "Importer un fichier"),
            apprenantsCount ? h("a", { href: `#/rappels/${id}`, class: "bouton bouton-secondaire bouton-petit" }, "Qui rappeler en premier") : null,
            apprenantsCount ? h("a", { href: `#/examens/${id}`, class: "bouton bouton-secondaire bouton-petit" }, "Examens") : null,
            apprenantsCount ? h("a", { href: `#/preuves/${id}`, class: "bouton bouton-secondaire bouton-petit" }, "Dossier de preuves Qualiopi") : null)),

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

  // ---------------------------------------------------------------------------
  // « Qui rappeler en premier ? » — tous les clients ou un seul
  // ---------------------------------------------------------------------------

  async function ecranRappels(organismeId) {
    afficher(navigationAdmin("rappels"), h("p", { class: "chargement" }, "Chargement des apprenants…"));

    const { data, error } = await sb
      .from("vue_qui_rappeler")
      .select("id, organisme_id, organisme_nom, identifiant_externe, prenom, nom, telephone, parcours, avancement_pct, derniere_connexion, jours_sans_contact, alerte");
    if (error) return afficher(navigationAdmin("rappels"), message("erreur", texteErreur(error)));

    const organismes = new Map();
    for (const l of data) {
      if (!organismes.has(l.organisme_id)) organismes.set(l.organisme_id, { id: l.organisme_id, nom: l.organisme_nom, n: 0 });
      organismes.get(l.organisme_id).n++;
    }
    const visibles = trierParUrgence(data.filter((l) => !organismeId || l.organisme_id === organismeId));
    const total = compterAlertes(visibles);
    memoriserFile(visibles, organismeId ? `rappels/${organismeId}` : "rappels");

    const filtre = (id, texte, n) =>
      h("a", { href: id ? `#/rappels/${id}` : "#/rappels", class: "filtre", "aria-current": (organismeId || null) === id ? "true" : null },
        texte, h("span", { class: "filtre-nombre" }, String(n)));

    const ligne = (a) => {
      const nomComplet = `${a.prenom || ""} ${a.nom || ""}`.trim() || a.identifiant_externe || "Apprenant";
      const details = [
        organismeId ? null : a.organisme_nom,
        a.parcours,
        a.avancement_pct !== null && a.avancement_pct !== undefined ? `${Math.round(a.avancement_pct)}\u00a0% réalisé` : null,
        a.derniere_connexion ? `connecté·e le ${dateLisible(a.derniere_connexion)}` : null,
      ].filter(Boolean).join(" · ");
      return h("li", { class: "ligne" },
        h("span", { class: "ligne-titre" }, lienInterne(`apprenant/${a.id}`, nomComplet)),
        h("span", { class: "pastilles" }, pastille(a.alerte, `${a.jours_sans_contact} j · ${libelleAlerte(a.alerte)}`)),
        h("span", { class: "ligne-detail" },
          details,
          a.telephone ? h("span", { class: "telephone" }, " · ", h("a", { href: `tel:${a.telephone.replace(/[^\d+]/g, "")}` }, a.telephone)) : null));
    };

    afficher(
      navigationAdmin("rappels"),
      h("div", { class: "pile" },
        h("div", {},
          h("p", { class: "surtitre" }, "À rappeler"),
          h("h1", {}, "Qui rappeler en premier ?"),
          h("p", { class: "chapo" }, "Apprenants actifs, classés du plus urgent au moins urgent selon le nombre de jours sans contact.")),
        organismes.size > 1
          ? h("div", { class: "filtres" },
              filtre(null, "Tous les clients", data.length),
              [...organismes.values()].sort((a, b) => a.nom.localeCompare(b.nom, "fr")).map((o) => filtre(o.id, o.nom, o.n)))
          : null,
        visibles.length ? blocCompteurs(total, visibles.length) : null,
        visibles.length
          ? h("ul", { class: "liste" }, visibles.map(ligne))
          : message("info", "Aucun apprenant actif. Importez le fichier d'un client depuis sa fiche, dans Prospection."))
    );
  }

  // ---------------------------------------------------------------------------
  // Import d'un fichier d'apprenants (CSV)
  // ---------------------------------------------------------------------------

  const CLE_CORRESPONDANCE = "filrouge-correspondance-";

  function lireCorrespondanceMemorisee(organismeId, entetes) {
    try {
      const brut = window.localStorage.getItem(CLE_CORRESPONDANCE + organismeId);
      if (!brut) return null;
      const memo = JSON.parse(brut); // { champ: "En-tête" }
      const resultat = {};
      for (const [champ, entete] of Object.entries(memo)) {
        const i = entetes.indexOf(entete);
        if (i >= 0) resultat[champ] = i;
      }
      return Object.keys(resultat).length ? resultat : null;
    } catch (e) { return null; }
  }

  function memoriserCorrespondance(organismeId, correspondance, entetes) {
    try {
      const memo = {};
      for (const [champ, i] of Object.entries(correspondance)) if (Number.isInteger(i)) memo[champ] = entetes[i];
      window.localStorage.setItem(CLE_CORRESPONDANCE + organismeId, JSON.stringify(memo));
    } catch (e) { /* mémorisation impossible : sans gravité */ }
  }

  async function ecranImport(organismeId) {
    const I = window.FilRougeImport;
    afficher(navigationAdmin("rappels"), h("p", { class: "chargement" }, "Préparation de l'import…"));

    const { data: organismes, error } = await sb.from("organismes").select("id, nom").order("nom");
    if (error) return afficher(navigationAdmin("rappels"), message("erreur", texteErreur(error)));
    if (!organismes.length) return afficher(navigationAdmin("rappels"), message("info", "Ajoutez d'abord un organisme dans Prospection."));

    const etatImport = { organismeId: organismes.some((o) => o.id === organismeId) ? organismeId : "", fichier: null, entetes: [], lignes: [], correspondance: {} };

    const choixOrganisme = champChoix("import-organisme", "Client concerné",
      Object.fromEntries([["", "— Choisir —"], ...organismes.map((o) => [o.id, o.nom])]), etatImport.organismeId);
    const champFichier = h("input", { id: "import-fichier", type: "file", accept: ".csv,text/csv,text/plain" });
    const zoneFichier = h("div");
    const zoneCorrespondance = h("div", { class: "pile" });

    const etape1 = h("div", { class: "carte carte-large" },
      h("div", { class: "formulaire" },
        choixOrganisme.bloc,
        h("label", { for: "import-fichier" }, "Fichier des apprenants (CSV)",
          h("span", { class: "aide" }, "Depuis Excel : Fichier › Enregistrer sous › « CSV (séparateur : point-virgule) ». Le fichier est lu sur cet appareil et n'est pas conservé."),
          champFichier),
        h("p", { class: "aide" }, "Pour essayer : ", h("a", { href: "exemple-apprenants-fictifs.csv", download: "exemple-apprenants-fictifs.csv" }, "télécharger un fichier d'exemple (12 apprenants fictifs)"), "."),
        zoneFichier));

    choixOrganisme.champ.addEventListener("change", () => {
      etatImport.organismeId = choixOrganisme.champ.value;
      if (etatImport.entetes.length) afficherCorrespondance();
    });

    champFichier.addEventListener("change", async () => {
      signaler(zoneFichier);
      zoneCorrespondance.replaceChildren();
      const fichier = champFichier.files && champFichier.files[0];
      if (!fichier) return;
      if (/\.xlsx?$/i.test(fichier.name)) {
        return signaler(zoneFichier, "erreur", "Ce fichier est au format Excel. Ouvrez-le dans Excel et enregistrez-le en « CSV (séparateur : point-virgule) », puis choisissez ce nouveau fichier.");
      }
      if (fichier.size > 5 * 1024 * 1024) return signaler(zoneFichier, "erreur", "Fichier trop lourd (plus de 5 Mo). Gardez seulement les colonnes utiles.");
      const lu = I.lireCsv(I.decoder(new Uint8Array(await fichier.arrayBuffer())));
      if (lu.entetes.length < 2 || !lu.lignes.length) {
        return signaler(zoneFichier, "erreur", "Ce fichier ne contient pas de tableau lisible : il faut une ligne d'en-têtes, puis une ligne par apprenant.");
      }
      etatImport.fichier = fichier.name;
      etatImport.entetes = lu.entetes;
      etatImport.lignes = lu.lignes;
      etatImport.correspondance = (etatImport.organismeId && lireCorrespondanceMemorisee(etatImport.organismeId, lu.entetes)) || I.devinerCorrespondance(lu.entetes);
      signaler(zoneFichier, "info", `${fichier.name} : ${pluriel(lu.lignes.length, "ligne", "lignes")}, ${pluriel(lu.entetes.length, "colonne", "colonnes")}.`);
      afficherCorrespondance();
    });

    function afficherCorrespondance() {
      const choixColonnes = { "": "— Ne pas importer —" };
      etatImport.entetes.forEach((e, i) => { choixColonnes[String(i)] = e; });

      const selecteurs = I.CHAMPS.map((champ) => {
        const actuel = etatImport.correspondance[champ.cle];
        const c = champChoix(`corr-${champ.cle}`, champ.libelle, choixColonnes, Number.isInteger(actuel) ? String(actuel) : "");
        c.champ.addEventListener("change", () => {
          etatImport.correspondance[champ.cle] = c.champ.value === "" ? undefined : Number(c.champ.value);
          majApercu();
        });
        return c.bloc;
      });

      const zoneApercu = h("div", { class: "pile" });
      const zoneResultat = h("div");
      const bouton = h("button", { class: "bouton", type: "button" }, "Importer");

      function majApercu() {
        const r = I.preparer(etatImport.lignes, etatImport.correspondance, etatImport.organismeId || "?");
        const colonnes = I.CHAMPS.filter((c) => Number.isInteger(etatImport.correspondance[c.cle]));
        const tableau = h("div", { class: "tableau-defilant" },
          h("table", { class: "tableau" },
            h("thead", {}, h("tr", {}, colonnes.map((c) => h("th", {}, c.libelle)))),
            h("tbody", {}, r.valides.slice(0, 5).map((v) =>
              h("tr", {}, colonnes.map((c) => h("td", {}, v[c.cle] === null || v[c.cle] === undefined ? "—" : String(v[c.cle]))))))));
        bouton.textContent = r.valides.length ? `Importer ${pluriel(r.valides.length, "apprenant", "apprenants")}` : "Importer";
        bouton.disabled = !r.valides.length || !etatImport.organismeId;
        zoneApercu.replaceChildren(...[
          h("h2", {}, "Aperçu"),
          colonnes.length ? tableau : message("info", "Choisissez au moins une colonne."),
          r.valides.length > 5 ? h("p", { class: "aide" }, `… et ${pluriel(r.valides.length - 5, "autre ligne", "autres lignes")}.`) : null,
          !Number.isInteger(etatImport.correspondance.identifiant_externe)
            ? message("info", "Pas de colonne d'identifiant : l'email (ou à défaut le prénom et le nom) servira à reconnaître chaque apprenant. Gardez la même façon de faire d'un import à l'autre pour éviter les doublons.")
            : null,
          r.doublons ? message("info", `${pluriel(r.doublons, "apprenant apparaît", "apprenants apparaissent")} plusieurs fois dans le fichier : la dernière ligne est retenue.`) : null,
          r.erreurs.length
            ? h("div", { class: "message message-erreur" },
                h("strong", {}, `${pluriel(r.erreurs.length, "ligne ignorée", "lignes ignorées")} :`),
                h("ul", { class: "liste-erreurs" },
                  r.erreurs.slice(0, 10).map((e) => h("li", {}, `ligne ${e.ligne} — ${e.message}`)),
                  r.erreurs.length > 10 ? h("li", {}, `… et ${r.erreurs.length - 10} autres`) : null))
            : null,
          !etatImport.organismeId ? message("erreur", "Choisissez le client concerné, tout en haut.") : null,
        ].filter(Boolean));
      }

      bouton.addEventListener("click", async () => {
        const r = I.preparer(etatImport.lignes, etatImport.correspondance, etatImport.organismeId);
        if (!r.valides.length) return;
        signaler(zoneResultat);
        occupe(bouton, true, "Import en cours…");

        // Combien existent déjà ? (pour annoncer nouveaux / mis à jour)
        const existants = await sb.from("apprenants").select("identifiant_externe").eq("organisme_id", etatImport.organismeId);
        const dejaLa = new Set((existants.data || []).map((e) => e.identifiant_externe));

        // Envoi par groupes de lignes ayant les mêmes colonnes : une ligne dont
        // une cellule d'examen est vide n'envoie pas cette colonne, et ne doit
        // pas effacer ce qui a été saisi dans la plateforme.
        const groupes = new Map();
        for (const v of r.valides) {
          const signature = Object.keys(v).sort().join(",");
          if (!groupes.has(signature)) groupes.set(signature, []);
          groupes.get(signature).push(v);
        }
        let erreur = null;
        for (const groupe of groupes.values()) {
          for (let i = 0; i < groupe.length && !erreur; i += 500) {
            const lot = groupe.slice(i, i + 500);
            const res = await sb.from("apprenants").upsert(lot, { onConflict: "organisme_id,identifiant_externe", defaultToNull: false });
            erreur = res.error;
          }
        }
        occupe(bouton, false);
        if (erreur) return signaler(zoneResultat, "erreur", `L'import s'est arrêté : ${texteErreur(erreur)}`);

        memoriserCorrespondance(etatImport.organismeId, etatImport.correspondance, etatImport.entetes);
        const nouveaux = r.valides.filter((v) => !dejaLa.has(v.identifiant_externe)).length;
        etatImport.lignes = []; // le contenu du fichier n'est pas gardé en mémoire
        champFichier.value = "";
        zoneCorrespondance.replaceChildren(
          h("div", { class: "message message-action" },
            h("strong", {}, "Import terminé. "),
            `${pluriel(nouveaux, "nouvel apprenant", "nouveaux apprenants")}, ${pluriel(r.valides.length - nouveaux, "mis à jour", "mis à jour")}`,
            r.erreurs.length ? `, ${pluriel(r.erreurs.length, "ligne ignorée", "lignes ignorées")}` : "",
            ". ",
            lienInterne(`rappels/${etatImport.organismeId}`, "Voir qui rappeler en premier →")));
        bouton.disabled = true;
      });

      zoneCorrespondance.replaceChildren(
        h("section", { class: "carte carte-large" },
          h("h2", {}, "Correspondance des colonnes"),
          h("p", { class: "aide" }, "Pour chaque information, choisissez la colonne du fichier qui la contient. Les colonnes devinées sont déjà sélectionnées ; ce choix sera retenu pour les prochains imports de ce client."),
          h("div", { class: "formulaire grille-correspondance" }, selecteurs)),
        zoneApercu,
        zoneResultat,
        bouton);
      majApercu();
    }

    afficher(
      navigationAdmin("rappels"),
      h("div", { class: "pile" },
        h("div", {},
          h("p", { class: "surtitre" }, etatImport.organismeId ? lienInterne(`organisme/${etatImport.organismeId}`, "← Fiche du client") : "Import"),
          h("h1", {}, "Importer des apprenants"),
          h("p", { class: "chapo" }, "Un nouvel import met à jour les apprenants déjà présents (reconnus par leur identifiant) et ajoute les nouveaux. Il ne supprime personne.")),
        etape1,
        zoneCorrespondance)
    );
  }

  // ===========================================================================
  // SUIVI JUSQU'À L'EXAMEN (étape 5)
  // ===========================================================================
  //   #/examens            tous les clients
  //   #/examens/<id>       un client : relances, saisie, taux par cohorte
  //   #/preuves/<id>       dossier de preuves Qualiopi (aussi #/preuves côté client)
  // ===========================================================================

  const LIBELLE_PRESENCE = { present: "Présent·e", absent: "Absent·e" };
  const LIBELLE_RESULTAT = { reussi: "Réussi", echoue: "Échoué" };
  const COULEUR_RELANCE = { "J-1": "rouge", "J-7": "orange", "J-30": "neutre" };
  const LIBELLE_RESULTAT_APPEL = { joint: "Joint·e", messagerie: "Message laissé", injoignable: "Injoignable", refuse_suivi: "Refuse le suivi" };
  const LIBELLE_CANAL_APPEL = { telephone: "Téléphone", whatsapp: "WhatsApp", sms: "SMS", email: "Email", visio: "Visio" };
  const LIBELLE_STATUT = { actif: "En formation", termine: "Terminé", abandon: "Abandon" };

  function nomApprenant(a) {
    return `${a.prenom || ""} ${a.nom || ""}`.trim() || a.identifiant_externe || "Apprenant";
  }

  function lienTelephone(numero) {
    return numero ? h("span", { class: "telephone" }, " · ", h("a", { href: `tel:${numero.replace(/[^\d+]/g, "")}` }, numero)) : null;
  }

  function pourcentage(valeur) {
    return valeur === null || valeur === undefined || Number.isNaN(valeur) ? "—" : `${String(Math.round(valeur * 10) / 10).replace(".", ",")} %`;
  }

  function taux(numerateur, denominateur) {
    return denominateur ? (100 * numerateur) / denominateur : null;
  }

  // Additionne les lignes de vue_taux_examen (une ligne par cohorte).
  function totalTaux(lignes) {
    const t = { effectif: 0, abandons: 0, inscrits_examen: 0, a_venir: 0, a_renseigner: 0, presents: 0, absents: 0, reussis: 0, echoues: 0 };
    for (const l of lignes) for (const cle of Object.keys(t)) t[cle] += Number(l[cle] || 0);
    t.taux_presence = taux(t.presents, t.presents + t.absents);
    t.taux_reussite = taux(t.reussis, t.reussis + t.echoues);
    return t;
  }

  // Lit toutes les lignes d'une requête, par pages de 1 000 (limite de Supabase).
  async function toutLire(fabriquerRequete) {
    const resultat = [];
    for (let debut = 0; ; debut += 1000) {
      const { data, error } = await fabriquerRequete().range(debut, debut + 999);
      if (error) return { data: null, error };
      resultat.push(...data);
      if (data.length < 1000) return { data: resultat, error: null };
    }
  }

  function tableauTaux(lignes, tauxDepart) {
    const t = totalTaux(lignes);
    const ligne = (libelle, l, classe) => h("tr", { class: classe || null },
      h("td", {}, libelle),
      h("td", {}, String(l.inscrits_examen)),
      h("td", {}, String(l.presents)),
      h("td", {}, String(l.absents)),
      h("td", {}, pourcentage(l.taux_presence === null || l.taux_presence === undefined ? null : Number(l.taux_presence))),
      h("td", {}, String(l.reussis)),
      h("td", {}, pourcentage(l.taux_reussite === null || l.taux_reussite === undefined ? null : Number(l.taux_reussite))));
    const tries = lignes.slice().sort((a, b) => a.cohorte.localeCompare(b.cohorte));
    return h("div", { class: "pile pile-serree" },
      h("div", { class: "tableau-defilant" },
        h("table", { class: "tableau" },
          h("thead", {}, h("tr", {},
            h("th", {}, "Inscrits en"), h("th", {}, "Examens"), h("th", {}, "Présents"),
            h("th", {}, "Absents"), h("th", {}, "Présence"), h("th", {}, "Réussis"), h("th", {}, "Réussite"))),
          h("tbody", {},
            tries.map((l) => ligne(moisLisible(l.cohorte), l)),
            tries.length > 1 ? ligne("Total", t, "ligne-total") : null))),
      h("p", { class: "aide" },
        "Taux de présence = présents ÷ (présents + absents). Taux de réussite = réussis ÷ résultats connus. ",
        t.a_renseigner ? `${pluriel(t.a_renseigner, "examen passé n'est pas encore renseigné", "examens passés ne sont pas encore renseignés")} : il n'entre pas dans les taux. ` : "",
        tauxDepart !== null && tauxDepart !== undefined ? `Taux de présence avant Fil Rouge : ${pourcentage(Number(tauxDepart))}.` : ""));
  }

  function moisLisible(cohorte) {
    if (!/^\d{4}-\d{2}$/.test(cohorte || "")) return "Sans date d'inscription";
    const texte = new Date(`${cohorte}-15T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
    return texte.charAt(0).toUpperCase() + texte.slice(1);
  }

  // Formulaire compact : date d'examen, présence, résultat d'un apprenant.
  function editeurExamen(a, apresEnregistrement) {
    const zone = h("div");
    const date = h("input", { type: "date", value: a.date_examen || "", "aria-label": "Date d'examen" });
    const presence = h("select", { "aria-label": "Présence" },
      h("option", { value: "" }, "Présence : à venir / inconnue"),
      h("option", { value: "present" }, "Présent·e"),
      h("option", { value: "absent" }, "Absent·e"));
    presence.value = a.presence_examen || "";
    const resultat = h("select", { "aria-label": "Résultat" },
      h("option", { value: "" }, "Résultat : inconnu"),
      h("option", { value: "reussi" }, "Réussi"),
      h("option", { value: "echoue" }, "Échoué"));
    resultat.value = a.resultat_examen || "";
    const majResultat = () => {
      resultat.disabled = presence.value !== "present";
      if (resultat.disabled) resultat.value = "";
    };
    presence.addEventListener("change", majResultat);
    majResultat();
    const bouton = h("button", { type: "submit", class: "bouton bouton-petit" }, "Enregistrer");
    const formulaire = h("form", { class: "editeur-examen", novalidate: true },
      h("label", {}, "Date d'examen", date),
      h("label", {}, "Présence", presence),
      h("label", {}, "Résultat", resultat),
      bouton, zone);
    formulaire.addEventListener("submit", async (evenement) => {
      evenement.preventDefault();
      if (!date.value && presence.value) return signaler(zone, "erreur", "Indiquez d'abord la date de l'examen.");
      signaler(zone);
      occupe(bouton, true, "Enregistrement…");
      const valeurs = {
        date_examen: date.value || null,
        presence_examen: date.value ? (presence.value || null) : null,
        resultat_examen: date.value && presence.value === "present" ? (resultat.value || null) : null,
      };
      const { error } = await sb.from("apprenants").update(valeurs).eq("id", a.id);
      occupe(bouton, false);
      if (error) return signaler(zone, "erreur", texteErreur(error));
      Object.assign(a, valeurs);
      apresEnregistrement();
    });
    return formulaire;
  }

  // Une ligne d'apprenant avec son examen, et un bouton « Modifier ».
  function ligneExamen(a, options) {
    const { afficherOrganisme, rafraichir, rapide } = options;
    const li = h("li", { class: "ligne" });
    const dessiner = () => {
      const pastilles = [];
      if (a.date_examen) pastilles.push(pastille("neutre", dateLisible(a.date_examen)));
      if (a.presence_examen) pastilles.push(pastille(a.presence_examen === "present" ? "vert" : "rouge", LIBELLE_PRESENCE[a.presence_examen]));
      if (a.resultat_examen) pastilles.push(pastille(a.resultat_examen === "reussi" ? "vert" : "orange", LIBELLE_RESULTAT[a.resultat_examen]));
      const zoneEdition = h("div", { class: "ligne-edition", hidden: true });
      const boutonModifier = h("button", { type: "button", class: "bouton-lien" }, a.date_examen ? "Modifier" : "Ajouter une date d'examen");
      boutonModifier.addEventListener("click", () => {
        zoneEdition.hidden = !zoneEdition.hidden;
        if (!zoneEdition.hidden && !zoneEdition.firstChild) zoneEdition.append(editeurExamen(a, rafraichir));
      });
      // Saisie en un geste pour un examen passé : présent / absent, puis le résultat.
      const zoneRapide = h("div", { class: "actions-ligne" });
      const enregistrerRapide = async (valeurs, bouton) => {
        occupe(bouton, true, "…");
        const { error } = await sb.from("apprenants").update(valeurs).eq("id", a.id);
        occupe(bouton, false);
        if (error) return zoneRapide.replaceChildren(message("erreur", texteErreur(error)));
        Object.assign(a, valeurs);
        rafraichir();
      };
      if (rapide && a.date_examen && !a.presence_examen) {
        const present = h("button", { type: "button", class: "puce" }, "Présent·e");
        const absent = h("button", { type: "button", class: "puce" }, "Absent·e");
        present.addEventListener("click", () => enregistrerRapide({ presence_examen: "present" }, present));
        absent.addEventListener("click", () => enregistrerRapide({ presence_examen: "absent", resultat_examen: null }, absent));
        zoneRapide.append(present, absent);
      } else if (rapide && a.presence_examen === "present" && !a.resultat_examen) {
        const reussi = h("button", { type: "button", class: "puce" }, "Réussi");
        const echoue = h("button", { type: "button", class: "puce" }, "Échoué");
        reussi.addEventListener("click", () => enregistrerRapide({ resultat_examen: "reussi" }, reussi));
        echoue.addEventListener("click", () => enregistrerRapide({ resultat_examen: "echoue" }, echoue));
        zoneRapide.append(h("span", { class: "aide" }, "Résultat :"), reussi, echoue);
      }
      const details = [afficherOrganisme ? a.organisme_nom : null, a.parcours].filter(Boolean).join(" · ");
      li.replaceChildren(...[
        h("span", { class: "ligne-titre" }, lienApprenant(a)),
        h("span", { class: "pastilles" }, pastilles),
        h("span", { class: "ligne-detail" }, details, lienTelephone(a.telephone)),
        zoneRapide.childNodes.length ? h("div", { class: "ligne-detail" }, zoneRapide) : null,
        etat.profil && etat.profil.role === "admin" ? h("div", { class: "ligne-detail" }, boutonModifier) : null,
        zoneEdition,
      ].filter(Boolean)); // replaceChildren écrirait « null » en toutes lettres
    };
    dessiner();
    return li;
  }

  async function ecranExamens(organismeId) {
    afficher(navigationAdmin("examens"), h("p", { class: "chargement" }, "Chargement des examens…"));

    const [apprenants, relances, tauxCohortes] = await Promise.all([
      toutLire(() => sb.from("apprenants")
        .select("id, organisme_id, identifiant_externe, prenom, nom, telephone, parcours, statut, date_examen, presence_examen, resultat_examen, organismes ( nom, taux_presence_depart )")
        .order("date_examen", { ascending: true, nullsFirst: false }).order("id")),
      sb.from("vue_relances_examen").select("id, etape_relance, relance_faite, jours_avant_examen"),
      sb.from("vue_taux_examen").select("*"),
    ]);
    const erreur = apprenants.error || relances.error || tauxCohortes.error;
    if (erreur) return afficher(navigationAdmin("examens"), message("erreur", texteErreur(erreur)));

    const tous = apprenants.data.map((a) => ({ ...a, organisme_nom: a.organismes?.nom || "", taux_presence_depart: a.organismes?.taux_presence_depart }));
    const organismes = new Map();
    for (const a of tous) {
      if (!organismes.has(a.organisme_id)) organismes.set(a.organisme_id, { id: a.organisme_id, nom: a.organisme_nom, n: 0, tauxDepart: a.taux_presence_depart });
      if (a.date_examen) organismes.get(a.organisme_id).n++;
    }
    const filtrer = (l) => !organismeId || l.organisme_id === organismeId;
    const visibles = tous.filter(filtrer);
    const relanceParId = new Map(relances.data.map((r) => [r.id, r]));
    const ajd = aujourdhui();
    const retourExamens = organismeId ? `examens/${organismeId}` : "examens";

    const rafraichir = () => ecranExamens(organismeId);
    const options = { afficherOrganisme: !organismeId, rafraichir };

    const aRelancer = visibles
      .filter((a) => relanceParId.has(a.id) && relanceParId.get(a.id).etape_relance && !relanceParId.get(a.id).relance_faite)
      .sort((a, b) => a.date_examen.localeCompare(b.date_examen));
    const aRenseigner = visibles
      .filter((a) => a.statut !== "abandon" && a.date_examen && a.date_examen < ajd && (!a.presence_examen || (a.presence_examen === "present" && !a.resultat_examen)))
      .sort((a, b) => a.date_examen.localeCompare(b.date_examen));
    const aVenir = visibles.filter((a) => a.date_examen && a.date_examen >= ajd && !a.presence_examen && a.statut !== "abandon");
    const passes = visibles.filter((a) => a.date_examen && (a.date_examen < ajd || a.presence_examen)).sort((a, b) => b.date_examen.localeCompare(a.date_examen));
    const sansDate = visibles.filter((a) => !a.date_examen && a.statut === "actif");
    memoriserFile([...aRelancer, ...aRenseigner], retourExamens);

    const ligneRelance = (a) => {
      const r = relanceParId.get(a.id);
      return h("li", { class: "ligne" },
        h("span", { class: "ligne-titre" }, lienApprenant(a)),
        h("span", { class: "pastilles" }, pastille(COULEUR_RELANCE[r.etape_relance], `${r.etape_relance} · ${ecartJours(a.date_examen)}`)),
        h("span", { class: "ligne-detail" },
          [options.afficherOrganisme ? a.organisme_nom : null, a.parcours, `examen le ${dateLisible(a.date_examen)}`].filter(Boolean).join(" · "),
          lienTelephone(a.telephone)));
    };

    const filtre = (id, texte, n) =>
      h("a", { href: id ? `#/examens/${id}` : "#/examens", class: "filtre", "aria-current": (organismeId || null) === id ? "true" : null },
        texte, h("span", { class: "filtre-nombre" }, String(n)));

    // Taux de départ (base de l'option résultat), pour un client sélectionné.
    let blocTauxDepart = null;
    if (organismeId && organismes.has(organismeId)) {
      const zone = h("div");
      const champ = h("input", { type: "text", inputmode: "decimal", id: "taux-depart", value: organismes.get(organismeId).tauxDepart ?? "", placeholder: "ex. : 70" });
      const bouton = h("button", { type: "submit", class: "bouton bouton-secondaire bouton-petit" }, "Enregistrer");
      const formulaire = h("form", { class: "formulaire", novalidate: true },
        h("label", { for: "taux-depart" }, "Taux de présence à l'examen avant Fil Rouge (%)",
          h("span", { class: "aide" }, "Mesuré au diagnostic. Sert de point de départ pour l'option « résultat » du contrat."), champ),
        zone, bouton);
      formulaire.addEventListener("submit", async (evenement) => {
        evenement.preventDefault();
        const brut = champ.value.replace(",", ".").replace("%", "").trim();
        const valeur = brut === "" ? null : Number(brut);
        if (valeur !== null && (!Number.isFinite(valeur) || valeur < 0 || valeur > 100)) return signaler(zone, "erreur", "Indiquez un nombre entre 0 et 100.");
        occupe(bouton, true, "Enregistrement…");
        const { error } = await sb.from("organismes").update({ taux_presence_depart: valeur }).eq("id", organismeId);
        occupe(bouton, false);
        if (error) return signaler(zone, "erreur", texteErreur(error));
        rafraichir();
      });
      blocTauxDepart = h("div", { class: "carte carte-large" }, formulaire);
    }

    const tauxVisibles = tauxCohortes.data.filter(filtrer);
    const total = totalTaux(tauxVisibles);
    const tauxDepart = organismeId && organismes.has(organismeId) ? organismes.get(organismeId).tauxDepart : null;

    afficher(
      navigationAdmin("examens"),
      h("div", { class: "pile" },
        h("div", {},
          h("p", { class: "surtitre" }, organismeId ? lienInterne(`organisme/${organismeId}`, "← Fiche du client") : "Examens"),
          h("h1", {}, organismeId && organismes.has(organismeId) ? `Examens · ${organismes.get(organismeId).nom}` : "Jusqu'à l'examen"),
          h("p", { class: "chapo" }, "Relances J-30, J-7 et J-1, présence le jour J, résultats et taux par cohorte.")),
        organismes.size > 1
          ? h("div", { class: "filtres" },
              filtre(null, "Tous les clients", [...organismes.values()].reduce((n, o) => n + o.n, 0)),
              [...organismes.values()].sort((a, b) => a.nom.localeCompare(b.nom, "fr")).map((o) => filtre(o.id, o.nom, o.n)))
          : null,

        h("div", { class: "compteurs" },
          h("div", { class: "compteur" }, h("span", { class: "compteur-valeur" }, aVenir.length), h("span", { class: "compteur-libelle" }, "examens à venir")),
          h("div", { class: `compteur ${aRelancer.length ? "compteur-rouge" : ""}` }, h("span", { class: "compteur-valeur" }, aRelancer.length), h("span", { class: "compteur-libelle" }, "relances à faire")),
          h("div", { class: "compteur compteur-vert" }, h("span", { class: "compteur-valeur" }, pourcentage(total.taux_presence)), h("span", { class: "compteur-libelle" }, "taux de présence")),
          h("div", { class: "compteur" }, h("span", { class: "compteur-valeur" }, pourcentage(total.taux_reussite)), h("span", { class: "compteur-libelle" }, "taux de réussite"))),

        organismeId ? h("div", { class: "actions-ligne" },
          h("a", { href: `#/preuves/${organismeId}`, class: "bouton bouton-petit" }, "Dossier de preuves Qualiopi")) : null,

        h("section", {},
          h("div", { class: "section-titre" }, h("h2", {}, "À relancer avant l'examen"), h("p", {}, "J-30 · J-7 · J-1")),
          aRelancer.length
            ? h("ul", { class: "liste" }, aRelancer.map(ligneRelance))
            : message("info", "Aucune relance d'examen à faire aujourd'hui. Un appel noté dans la fenêtre (30, 7 ou 1 jour avant) compte comme relance faite.")),

        h("section", {},
          h("div", { class: "section-titre" }, h("h2", {}, "Examens passés à renseigner"), h("p", {}, pluriel(aRenseigner.length, "apprenant", "apprenants"))),
          aRenseigner.length
            ? h("ul", { class: "liste" }, aRenseigner.map((a) => ligneExamen(a, { ...options, rapide: true })))
            : message("info", "Tout est à jour : chaque examen passé a sa présence et son résultat.")),

        h("section", {},
          h("div", { class: "section-titre" }, h("h2", {}, "Taux par cohorte")),
          tauxVisibles.some((l) => Number(l.inscrits_examen))
            ? tableauTaux(tauxVisibles, tauxDepart)
            : message("info", "Aucun examen enregistré pour l'instant. Ajoutez la colonne « Date d'examen » au prochain import, ou saisissez les dates ci-dessous.")),

        blocTauxDepart,

        h("section", {},
          h("div", { class: "section-titre" }, h("h2", {}, "Examens à venir"), h("p", {}, pluriel(aVenir.length, "apprenant", "apprenants"))),
          aVenir.length ? h("ul", { class: "liste" }, aVenir.map((a) => ligneExamen(a, options))) : message("info", "Aucun examen à venir.")),

        h("section", {},
          h("div", { class: "section-titre" }, h("h2", {}, "Examens passés"), h("p", {}, pluriel(passes.length, "apprenant", "apprenants"))),
          passes.length ? h("ul", { class: "liste" }, passes.map((a) => ligneExamen(a, options))) : message("info", "Aucun examen passé.")),

        h("section", {},
          h("div", { class: "section-titre" }, h("h2", {}, "Sans date d'examen"), h("p", {}, pluriel(sansDate.length, "apprenant en formation", "apprenants en formation"))),
          sansDate.length
            ? h("details", { class: "depliant" },
                h("summary", {}, "Afficher la liste"),
                h("ul", { class: "liste" }, sansDate.map((a) => ligneExamen(a, options))))
            : message("info", "Tous les apprenants en formation ont une date d'examen."))
      )
    );
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------------------
  // Dossier de preuves Qualiopi (administratrice et client)
  // ---------------------------------------------------------------------------

  // CSV pour Excel : point-virgule, BOM UTF-8, et protection contre les
  // cellules commençant par = + - @ (formules exécutées à l'ouverture).
  function telechargerCsv(nomFichier, entetes, lignes) {
    const cellule = (v) => {
      let t = v === null || v === undefined ? "" : String(v);
      if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
      return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const texte = "﻿" + [entetes, ...lignes].map((l) => l.map(cellule).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([texte], { type: "text/csv;charset=utf-8" }));
    const lien = h("a", { href: url, download: nomFichier });
    document.body.append(lien);
    lien.click();
    lien.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function nomFichier(texte) {
    return normaliserNom(texte).slice(0, 40) || "organisme";
  }
  function normaliserNom(texte) {
    return String(texte || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  // Minuit à l'heure de Paris (heure d'été ou d'hiver), pour filtrer les appels.
  function debutJourParis(dateIso) {
    let decalage = "+01:00";
    try {
      const partie = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", timeZoneName: "longOffset" })
        .formatToParts(new Date(`${dateIso}T12:00:00Z`)).find((p) => p.type === "timeZoneName");
      if (partie) decalage = partie.value.replace("GMT", "") || "+00:00";
    } catch (e) { /* navigateur ancien : heure d'hiver par défaut */ }
    return `${dateIso}T00:00:00${decalage}`;
  }

  function dateHeureLisible(horodatage) {
    return new Date(horodatage).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris" });
  }

  async function ecranPreuves(organismeId, periode) {
    const estAdmin = etat.profil && etat.profil.role === "admin";
    const entete = estAdmin ? [navigationAdmin("examens")] : [];
    afficher(...entete, h("p", { class: "chargement" }, "Préparation du dossier de preuves…"));

    const au = periode?.au || aujourdhui();
    const du = periode?.du || ajouterJours(au, -90);

    const [organisme, apprenants, appels, tauxCohortes] = await Promise.all([
      sb.from("organismes").select("id, nom, seuil_vert_jours, seuil_orange_jours, taux_presence_depart").eq("id", organismeId).maybeSingle(),
      toutLire(() => sb.from("apprenants")
        .select("id, identifiant_externe, prenom, nom, parcours, statut, avancement_pct, derniere_connexion, date_dernier_contact, date_inscription, date_examen, presence_examen, resultat_examen")
        .eq("organisme_id", organismeId).order("nom").order("id")),
      toutLire(() => sb.from("appels")
        .select("id, apprenant_id, date_appel, canal, resultat, note_client, prochaine_action, date_prochaine_action")
        .eq("organisme_id", organismeId)
        .gte("date_appel", debutJourParis(du)).lt("date_appel", debutJourParis(ajouterJours(au, 1)))
        .order("date_appel").order("id")),
      sb.from("vue_taux_examen").select("*").eq("organisme_id", organismeId),
    ]);
    const erreur = organisme.error || apprenants.error || appels.error || tauxCohortes.error;
    if (erreur) return afficher(...entete, message("erreur", texteErreur(erreur)));
    if (!organisme.data) return afficher(...entete, message("info", "Cet organisme n'existe plus."));

    const org = organisme.data;
    const parId = new Map(apprenants.data.map((a) => [a.id, a]));
    const contacts = appels.data;
    const contactesIds = new Set(contacts.map((c) => c.apprenant_id));
    const jointsIds = new Set(contacts.filter((c) => c.resultat === "joint").map((c) => c.apprenant_id));
    const contactsParApprenant = new Map();
    for (const c of contacts) contactsParApprenant.set(c.apprenant_id, (contactsParApprenant.get(c.apprenant_id) || 0) + 1);
    const actifs = apprenants.data.filter((a) => a.statut === "actif");
    const examensPeriode = apprenants.data
      .filter((a) => a.date_examen && a.date_examen >= du && a.date_examen <= au)
      .sort((a, b) => a.date_examen.localeCompare(b.date_examen));
    const examensAVenir = apprenants.data
      .filter((a) => a.date_examen && a.date_examen > au && a.statut !== "abandon")
      .sort((a, b) => a.date_examen.localeCompare(b.date_examen));
    const total = totalTaux(tauxCohortes.data);
    const presentsPeriode = examensPeriode.filter((a) => a.presence_examen === "present").length;
    const absentsPeriode = examensPeriode.filter((a) => a.presence_examen === "absent").length;
    const nomAppr = (id) => (parId.has(id) ? nomApprenant(parId.get(id)) : "Apprenant");

    // --- Choix de la période ---
    const zonePeriode = h("div");
    const champDu = h("input", { type: "date", id: "preuves-du", value: du });
    const champAu = h("input", { type: "date", id: "preuves-au", value: au });
    const boutonPeriode = h("button", { type: "submit", class: "bouton bouton-secondaire bouton-petit" }, "Mettre à jour");
    const formulairePeriode = h("form", { class: "formulaire", novalidate: true },
      h("div", { class: "deux-colonnes" },
        h("label", { for: "preuves-du" }, "Du", champDu),
        h("label", { for: "preuves-au" }, "Au", champAu)),
      h("div", { class: "raccourcis" },
        h("span", { class: "aide" }, "Période :"),
        [["3 derniers mois", 90], ["6 derniers mois", 182], ["12 derniers mois", 365]].map(([texte, n]) =>
          h("button", { type: "button", class: "puce", onclick: () => ecranPreuves(organismeId, { du: ajouterJours(aujourdhui(), -n), au: aujourdhui() }) }, texte))),
      zonePeriode, boutonPeriode);
    formulairePeriode.addEventListener("submit", (evenement) => {
      evenement.preventDefault();
      if (!champDu.value || !champAu.value || champDu.value > champAu.value) return signaler(zonePeriode, "erreur", "Choisissez une date de début antérieure à la date de fin.");
      ecranPreuves(organismeId, { du: champDu.value, au: champAu.value });
    });

    // --- Exports ---
    const suffixe = `${nomFichier(org.nom)}-${du}-au-${au}`;
    const exporterContacts = () => telechargerCsv(`preuves-suivi-${suffixe}.csv`,
      ["Date", "Apprenant", "Identifiant", "Parcours", "Canal", "Résultat", "Compte rendu", "Suite prévue", "Date de la suite"],
      contacts.map((c) => {
        const a = parId.get(c.apprenant_id) || {};
        return [dateHeureLisible(c.date_appel), nomAppr(c.apprenant_id), a.identifiant_externe || "", a.parcours || "",
          LIBELLE_CANAL_APPEL[c.canal] || c.canal, LIBELLE_RESULTAT_APPEL[c.resultat] || c.resultat,
          c.note_client || "", c.prochaine_action || "", c.date_prochaine_action ? dateLisible(c.date_prochaine_action) : ""];
      }));
    const exporterExamens = () => telechargerCsv(`examens-${nomFichier(org.nom)}-${au}.csv`,
      ["Apprenant", "Identifiant", "Parcours", "Inscription", "Statut", "Date d'examen", "Présence", "Résultat"],
      apprenants.data.map((a) => [nomApprenant(a), a.identifiant_externe || "", a.parcours || "",
        a.date_inscription ? dateLisible(a.date_inscription) : "", LIBELLE_STATUT[a.statut] || a.statut,
        a.date_examen ? dateLisible(a.date_examen) : "", LIBELLE_PRESENCE[a.presence_examen] || "", LIBELLE_RESULTAT[a.resultat_examen] || ""]));

    const tableau = (entetes, lignes) => h("div", { class: "tableau-defilant" },
      h("table", { class: "tableau" },
        h("thead", {}, h("tr", {}, entetes.map((e) => h("th", {}, e)))),
        h("tbody", {}, lignes.map((l) => h("tr", {}, l.map((c) => h("td", {}, c === null || c === undefined || c === "" ? "—" : c)))))));

    // --- Le dossier lui-même ---
    const dossier = h("article", { class: "dossier" },
      h("header", { class: "dossier-entete" },
        h("p", { class: "surtitre" }, "Dossier de preuves · Qualiopi"),
        h("h1", {}, org.nom),
        h("p", { class: "chapo" }, `Suivi des apprenants en formation à distance, du ${dateLisible(du)} au ${dateLisible(au)}.`),
        h("p", { class: "aide" }, `Établi le ${dateLisible(aujourdhui())} par Fil Rouge Apprenants, prestataire du suivi. Données issues de la plateforme de suivi, horodatées à chaque saisie.`)),

      h("section", {},
        h("h2", {}, "Synthèse de la période"),
        h("div", { class: "compteurs" },
          h("div", { class: "compteur" }, h("span", { class: "compteur-valeur" }, apprenants.data.length), h("span", { class: "compteur-libelle" }, "apprenants suivis")),
          h("div", { class: "compteur" }, h("span", { class: "compteur-valeur" }, contacts.length), h("span", { class: "compteur-libelle" }, "contacts tracés")),
          h("div", { class: "compteur" }, h("span", { class: "compteur-valeur" }, contactesIds.size), h("span", { class: "compteur-libelle" }, "apprenants contactés")),
          h("div", { class: "compteur compteur-vert" }, h("span", { class: "compteur-valeur" }, pourcentage(taux(jointsIds.size, contactesIds.size))), h("span", { class: "compteur-libelle" }, "joints au moins une fois"))),
        h("div", { class: "compteurs" },
          h("div", { class: "compteur" }, h("span", { class: "compteur-valeur" }, examensPeriode.length), h("span", { class: "compteur-libelle" }, "examens sur la période")),
          h("div", { class: "compteur" }, h("span", { class: "compteur-valeur" }, `${presentsPeriode} / ${presentsPeriode + absentsPeriode}`), h("span", { class: "compteur-libelle" }, "présents / renseignés")),
          h("div", { class: "compteur compteur-vert" }, h("span", { class: "compteur-valeur" }, pourcentage(total.taux_presence)), h("span", { class: "compteur-libelle" }, "taux de présence (cumul)")),
          h("div", { class: "compteur" }, h("span", { class: "compteur-valeur" }, pourcentage(total.taux_reussite)), h("span", { class: "compteur-libelle" }, "taux de réussite (cumul)")))),

      h("section", {},
        h("h2", {}, "Indicateur 12 · Prévention des ruptures de parcours"),
        h("p", {}, `Chaque apprenant sans contact depuis plus de ${org.seuil_vert_jours} jours est repéré, puis appelé en priorité au-delà de ${org.seuil_orange_jours} jours. Chaque action est datée, avec son résultat et la suite prévue. Le compte rendu ne reprend que les éléments utiles au parcours de formation.`),
        contacts.length
          ? tableau(["Date", "Apprenant", "Canal", "Résultat", "Compte rendu", "Suite prévue"],
              contacts.map((c) => [dateHeureLisible(c.date_appel), nomAppr(c.apprenant_id), LIBELLE_CANAL_APPEL[c.canal] || c.canal,
                LIBELLE_RESULTAT_APPEL[c.resultat] || c.resultat, c.note_client,
                [c.prochaine_action, c.date_prochaine_action ? `(${dateLisible(c.date_prochaine_action)})` : null].filter(Boolean).join(" ")]))
          : message("info", "Aucun contact enregistré sur cette période.")),

      h("section", {},
        h("h2", {}, "Indicateur 19 · Suivi de la formation à distance"),
        h("p", {}, `Situation des ${pluriel(actifs.length, "apprenant en formation", "apprenants en formation")} au ${dateLisible(aujourdhui())} : avancement sur la plateforme de formation, dernière connexion et dernier contact humain.`),
        actifs.length
          ? tableau(["Apprenant", "Parcours", "Avancement", "Dernière connexion", "Dernier contact", "Contacts sur la période"],
              actifs.map((a) => [nomApprenant(a), a.parcours,
                a.avancement_pct === null || a.avancement_pct === undefined ? "" : `${Math.round(a.avancement_pct)} %`,
                a.derniere_connexion ? dateLisible(a.derniere_connexion) : "", a.date_dernier_contact ? dateLisible(a.date_dernier_contact) : "",
                String(contactsParApprenant.get(a.id) || 0)]))
          : message("info", "Aucun apprenant en formation actuellement.")),

      h("section", {},
        h("h2", {}, "Présentation à l'examen"),
        h("p", {}, "Depuis la loi du 27 juin 2026, l'apprenant financé par le CPF doit se présenter à l'examen. Relances systématiques 30 jours, 7 jours et la veille de chaque session."),
        tauxCohortes.data.some((l) => Number(l.inscrits_examen)) ? tableauTaux(tauxCohortes.data, org.taux_presence_depart) : message("info", "Aucun examen enregistré."),
        examensPeriode.length
          ? h("div", { class: "pile pile-serree" }, h("h3", {}, "Examens de la période"),
              tableau(["Date", "Apprenant", "Parcours", "Présence", "Résultat"],
                examensPeriode.map((a) => [dateLisible(a.date_examen), nomApprenant(a), a.parcours,
                  LIBELLE_PRESENCE[a.presence_examen] || "à renseigner", LIBELLE_RESULTAT[a.resultat_examen] || ""])))
          : null,
        examensAVenir.length
          ? h("div", { class: "pile pile-serree" }, h("h3", {}, "Examens à venir"),
              tableau(["Date", "Apprenant", "Parcours", "Dernier contact"],
                examensAVenir.map((a) => [dateLisible(a.date_examen), nomApprenant(a), a.parcours, a.date_dernier_contact ? dateLisible(a.date_dernier_contact) : ""])))
          : null),

      h("section", {},
        h("h2", {}, "Indicateur 27 · Sous-traitance"),
        h("p", {}, "Le suivi téléphonique est confié à Fil Rouge Apprenants dans le cadre d'un contrat de sous-traitance écrit, à joindre à ce dossier avec l'accord de traitement des données (RGPD). Les éléments personnels confiés par les apprenants ne figurent pas dans les comptes rendus transmis à l'organisme.")),

      h("p", { class: "aide dossier-pied" }, "Numérotation des indicateurs : référentiel national qualité applicable au 1er novembre 2026. Ce dossier est une aide à la preuve ; l'appréciation de la conformité revient à l'organisme certificateur."));

    const actions = h("div", { class: "actions-ligne actions-impression" },
      h("button", { type: "button", class: "bouton", onclick: () => window.print() }, "Imprimer ou enregistrer en PDF"),
      h("button", { type: "button", class: "bouton bouton-secondaire", onclick: exporterContacts }, "Contacts (Excel)"),
      h("button", { type: "button", class: "bouton bouton-secondaire", onclick: exporterExamens }, "Examens (Excel)"));

    afficher(
      ...entete,
      h("div", { class: "pile" },
        h("div", { class: "masque-impression" },
          h("p", { class: "surtitre" }, estAdmin ? lienInterne(`examens/${organismeId}`, "← Examens du client") : lienInterne("", "← Vos apprenants")),
          h("p", { class: "chapo" }, "Ce dossier rassemble les preuves du suivi pour votre audit Qualiopi. Choisissez la période, puis imprimez-le ou enregistrez-le en PDF.")),
        h("div", { class: "carte carte-large masque-impression" }, formulairePeriode),
        actions,
        dossier)
    );
    window.scrollTo(0, 0);
  }

  // ===========================================================================
  // FICHE APPRENANT ET « NOTER UN APPEL » (étape 6)
  // ===========================================================================
  //   #/apprenant/<id>   pour l'administratrice, l'appelante (ses apprenants
  //                      confiés) et le client (lecture seule)
  // ===========================================================================

  const COULEUR_RESULTAT_APPEL = { joint: "vert", messagerie: "orange", injoignable: "rouge", refuse_suivi: "neutre" };
  // Suite proposée selon le résultat (modifiable avant d'enregistrer).
  const SUITE_PROPOSEE = {
    joint: ["Point d'étape", 7],
    messagerie: ["Rappeler", 2],
    injoignable: ["Rappeler à un autre moment de la journée", 1],
    refuse_suivi: ["", null],
  };
  const NOTE_PROPOSEE = {
    messagerie: "Message laissé, en attente de rappel.",
    injoignable: "Pas de réponse, pas de messagerie.",
  };

  function lienApprenant(a, texte) {
    return a && a.id ? lienInterne(`apprenant/${a.id}`, texte || nomApprenant(a)) : (texte || nomApprenant(a || {}));
  }

  // Mémorise l'ordre d'une liste pour proposer « Apprenant suivant » sur la fiche.
  function memoriserFile(lignes, retour) {
    etat.file = { ids: lignes.map((l) => l.id).filter(Boolean), retour };
  }

  function maintenantLocal() {
    const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }

  function dateHeureComplete(horodatage) {
    const d = new Date(horodatage);
    const jour = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Paris" });
    const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
    return `${jour} à ${heure}`;
  }

  function joursDepuis(dateIso) {
    if (!dateIso) return null;
    return Math.round((new Date(`${aujourdhui()}T12:00:00Z`) - new Date(`${dateIso}T12:00:00Z`)) / 86400000);
  }

  // Formulaire « Noter un appel ».
  function formulaireAppel(apprenant, apresEnregistrement) {
    const zone = h("div");
    const choixResultat = h("div", { class: "choix-boutons", role: "radiogroup", "aria-label": "Résultat de l'appel" },
      Object.entries(LIBELLE_RESULTAT_APPEL).map(([valeur, texte]) =>
        h("label", { class: "choix-bouton" },
          h("input", { type: "radio", name: "resultat", value: valeur }), h("span", {}, texte))));
    const canal = champChoix("appel-canal", "Canal", LIBELLE_CANAL_APPEL, "telephone");
    const quand = champTexte("appel-date", "Date et heure", maintenantLocal(), { type: "datetime-local" });
    const noteClient = champTexte("appel-note-client", "Compte rendu pour l'organisme", "", {
      multiligne: true, placeholder: "Ex. : Joint·e. Reprend le module 4 cette semaine, objectif examen maintenu.",
    });
    const noteInterne = champTexte("appel-note-interne", "Note interne (jamais visible par l'organisme)", "", {
      multiligne: true, placeholder: "Ce que l'apprenant confie de personnel, conseils pour le prochain appel…",
    });
    const suite = champTexte("appel-suite", "Suite prévue", "", { placeholder: "Ex. : Point d'étape" });
    const dateSuite = champTexte("appel-date-suite", "Date de la suite", "", { type: "date" });
    const raccourcis = h("div", { class: "raccourcis" },
      h("span", { class: "aide" }, "Dans :"),
      [["1 j", 1], ["2 j", 2], ["7 j", 7], ["15 j", 15], ["1 mois", 30]].map(([texte, n]) =>
        h("button", { type: "button", class: "puce", onclick: () => { dateSuite.champ.value = ajouterJours(aujourdhui(), n); } }, texte)),
      h("button", { type: "button", class: "puce", onclick: () => { dateSuite.champ.value = ""; suite.champ.value = ""; } }, "Aucune"));
    const conseil = h("div");
    const bouton = h("button", { class: "bouton", type: "submit" }, "Enregistrer l'appel");

    // Propositions automatiques tant que la personne n'a rien tapé.
    const toucheParUtilisateur = new Set();
    for (const c of [noteClient.champ, suite.champ, dateSuite.champ]) c.addEventListener("input", () => toucheParUtilisateur.add(c));
    choixResultat.addEventListener("change", () => {
      const resultat = choixResultat.querySelector("input:checked")?.value;
      const [texteSuite, jours] = SUITE_PROPOSEE[resultat] || ["", null];
      if (!toucheParUtilisateur.has(noteClient.champ)) noteClient.champ.value = NOTE_PROPOSEE[resultat] || "";
      if (!toucheParUtilisateur.has(suite.champ)) suite.champ.value = texteSuite;
      if (!toucheParUtilisateur.has(dateSuite.champ)) dateSuite.champ.value = jours ? ajouterJours(aujourdhui(), jours) : "";
      signaler(conseil, resultat === "refuse_suivi" ? "info" : null,
        resultat === "refuse_suivi" ? "Si l'apprenant arrête sa formation, passez aussi son statut en « Abandon » (en bas de la fiche)." : null);
    });

    const formulaire = h("form", { novalidate: true, class: "formulaire" },
      h("fieldset", { class: "groupe" }, h("legend", {}, "Résultat"), choixResultat),
      conseil,
      noteClient.bloc,
      noteInterne.bloc,
      h("div", { class: "deux-colonnes" }, suite.bloc, dateSuite.bloc),
      raccourcis,
      h("details", { class: "depliant" },
        h("summary", {}, "Canal, date et heure"),
        h("div", { class: "deux-colonnes" }, canal.bloc, quand.bloc)),
      zone, bouton);

    formulaire.addEventListener("submit", async (evenement) => {
      evenement.preventDefault();
      const resultat = choixResultat.querySelector("input:checked")?.value;
      if (!resultat) return signaler(zone, "erreur", "Choisissez le résultat de l'appel.");
      const date = quand.champ.value ? new Date(quand.champ.value) : new Date();
      if (Number.isNaN(date.getTime())) return signaler(zone, "erreur", "La date et l'heure ne sont pas valables.");
      if (date.getTime() > Date.now() + 10 * 60000) return signaler(zone, "erreur", "La date de l'appel ne peut pas être dans le futur.");
      signaler(zone);
      occupe(bouton, true, "Enregistrement…");
      const { error } = await sb.rpc("noter_appel", {
        p_apprenant: apprenant.id,
        p_resultat: resultat,
        p_canal: canal.champ.value,
        p_date_appel: date.toISOString(),
        p_note_client: noteClient.champ.value,
        p_note_interne: noteInterne.champ.value,
        p_prochaine_action: suite.champ.value,
        p_date_prochaine_action: dateSuite.champ.value || null,
      });
      occupe(bouton, false);
      if (error) return signaler(zone, "erreur", texteErreur(error));
      apresEnregistrement();
    });
    return formulaire;
  }

  function ligneHistorique(appel, options) {
    const { peutSupprimer, apresSuppression } = options;
    const noteInterne = appel.notes_internes && appel.notes_internes.contenu;
    let suppression = null;
    if (peutSupprimer) {
      const zone = h("div");
      const demander = h("button", { type: "button", class: "bouton-lien bouton-lien-danger" }, "Supprimer");
      const confirmer = h("button", { type: "button", class: "bouton-lien bouton-lien-danger", hidden: true }, "Oui, supprimer cet appel");
      const annuler = h("button", { type: "button", class: "bouton-lien", hidden: true }, "Annuler");
      demander.addEventListener("click", () => { demander.hidden = true; confirmer.hidden = false; annuler.hidden = false; });
      annuler.addEventListener("click", () => { demander.hidden = false; confirmer.hidden = true; annuler.hidden = true; });
      confirmer.addEventListener("click", async () => {
        occupe(confirmer, true, "Suppression…");
        const { error } = await sb.from("appels").delete().eq("id", appel.id);
        occupe(confirmer, false);
        if (error) return signaler(zone, "erreur", texteErreur(error));
        apresSuppression();
      });
      suppression = h("div", { class: "ligne-detail" }, h("div", { class: "actions-secondaires" }, demander, confirmer, annuler), zone);
    }
    return h("li", { class: "ligne ligne-echange" }, ...[
      h("span", { class: "ligne-titre" }, dateHeureComplete(appel.date_appel)),
      h("span", { class: "pastilles" },
        pastille("neutre", LIBELLE_CANAL_APPEL[appel.canal] || appel.canal),
        appel.resultat === "messagerie" && NOTE_MESSAGE_ENVOYE[appel.canal]
          ? pastille("vert", "Message envoyé")
          : pastille(COULEUR_RESULTAT_APPEL[appel.resultat] || "neutre", LIBELLE_RESULTAT_APPEL[appel.resultat] || appel.resultat)),
      appel.note_client ? h("span", { class: "ligne-detail texte-libre" }, appel.note_client) : null,
      appel.prochaine_action || appel.date_prochaine_action
        ? h("span", { class: "ligne-detail" }, "Suite : ", [appel.prochaine_action, appel.date_prochaine_action ? `le ${dateLisible(appel.date_prochaine_action)}` : null].filter(Boolean).join(" "))
        : null,
      noteInterne ? h("div", { class: "ligne-detail note-interne" }, h("strong", {}, "Note interne · "), noteInterne) : null,
      suppression,
    ].filter(Boolean));
  }

  // ---------------------------------------------------------------------------
  // Bloc « Contacter » de la fiche apprenant (étape 8) : appel, WhatsApp, SMS,
  // email, avec un message tout prêt et modifiable. Tout est gratuit : le bouton
  // ouvre l'application du téléphone avec le texte écrit, la personne n'a plus
  // qu'à appuyer sur « Envoyer ». Ensuite, un clic l'ajoute à l'historique
  // (preuve de suivi Qualiopi). Fonctions pures dans contact.js.
  // ---------------------------------------------------------------------------
  const NOTE_MESSAGE_ENVOYE = { whatsapp: "Message WhatsApp envoyé", sms: "SMS envoyé", email: "Email envoyé" };

  function blocContacter(a, rafraichir) {
    const C = window.FilRougeContact;
    const surIphone = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const moi = (etat.profil?.nom_affiche || "").trim().split(" ")[0] || (etat.profil?.role === "admin" ? "Émilie" : "");
    const contexte = { prenom: a.prenom, moi, organisme: a.organismes?.nom, date_examen: a.date_examen, avancement_pct: a.avancement_pct };

    const choixModeles = Object.fromEntries(Object.entries(C.MODELES).map(([cle, m]) => [cle, m.titre]));
    const modele = champChoix("contact-modele", "Message tout prêt", choixModeles, C.modeleConseille(a, aujourdhui()));
    const texte = champTexte("contact-texte", "Texte du message (modifiable)", "", { multiligne: true });
    texte.champ.rows = 6;
    let objet = "";

    const appeler = a.telephone ? h("a", { class: "bouton", href: `tel:${a.telephone.replace(/[^\d+]/g, "")}` }, `📞 Appeler · ${a.telephone}`) : null;
    const whatsapp = h("a", { class: "bouton bouton-secondaire", target: "_blank", rel: "noopener" }, "💬 WhatsApp");
    const sms = h("a", { class: "bouton bouton-secondaire" }, "✉️ SMS");
    const email = h("a", { class: "bouton bouton-secondaire" }, "📧 Email");
    const copierTexte = h("button", { type: "button", class: "bouton-lien" }, "Copier le texte");
    copierTexte.addEventListener("click", () => copier(texte.champ.value, copierTexte));

    function majLiens() {
      const liens = [
        [whatsapp, C.lienWhatsApp(a.telephone, texte.champ.value)],
        [sms, C.lienSms(a.telephone, texte.champ.value, surIphone)],
        [email, C.lienEmail(a.email, objet, texte.champ.value)],
      ];
      for (const [lien, adresse] of liens) {
        lien.hidden = !adresse;
        if (adresse) lien.setAttribute("href", adresse); else lien.removeAttribute("href");
      }
    }
    function chargerModele() {
      const r = C.remplir(modele.champ.value, contexte);
      texte.champ.value = r.texte;
      objet = r.objet;
      majLiens();
    }
    modele.champ.addEventListener("change", chargerModele);
    texte.champ.addEventListener("input", majLiens);
    chargerModele();

    // Après l'envoi : proposer de l'ajouter à l'historique.
    const zoneConfirmation = h("div");
    function proposerHistorique(canal) {
      const zone = h("div");
      const oui = h("button", { type: "button", class: "bouton bouton-petit" }, "Oui, l'ajouter à l'historique");
      const non = h("button", { type: "button", class: "bouton bouton-secondaire bouton-petit" }, "Non, pas envoyé");
      non.addEventListener("click", () => zoneConfirmation.replaceChildren());
      oui.addEventListener("click", async () => {
        occupe(oui, true, "Enregistrement…");
        const { error } = await sb.rpc("noter_appel", {
          p_apprenant: a.id,
          p_resultat: "messagerie",
          p_canal: canal,
          p_date_appel: new Date().toISOString(),
          p_note_client: `${NOTE_MESSAGE_ENVOYE[canal]} : ${C.MODELES[modele.champ.value].titre.toLowerCase()}.`,
          p_note_interne: "",
          p_prochaine_action: "",
          p_date_prochaine_action: null,
        });
        occupe(oui, false);
        if (error) return signaler(zone, "erreur", texteErreur(error));
        rafraichir(`${NOTE_MESSAGE_ENVOYE[canal]} : ajouté à l'historique.`);
      });
      zoneConfirmation.replaceChildren(
        h("div", { class: "message message-action pile pile-serree" },
          h("strong", {}, `${NOTE_MESSAGE_ENVOYE[canal]} ?`),
          h("div", { class: "actions-ligne" }, oui, non),
          zone));
    }
    whatsapp.addEventListener("click", () => setTimeout(() => proposerHistorique("whatsapp"), 300));
    sms.addEventListener("click", () => setTimeout(() => proposerHistorique("sms"), 300));
    email.addEventListener("click", () => setTimeout(() => proposerHistorique("email"), 300));

    const manque = !a.telephone && !a.email ? "Pas de numéro de téléphone ni d'adresse email sur la fiche."
      : !a.telephone ? "Pas de numéro de téléphone sur la fiche." : !a.email ? "Pas d'adresse email sur la fiche." : null;

    return h("section", {},
      h("div", { class: "section-titre" }, h("h2", {}, "Contacter")),
      h("div", { class: "carte carte-large pile pile-serree" },
        h("div", { class: "actions-ligne" }, appeler, whatsapp, sms, email),
        manque ? h("p", { class: "aide" }, manque) : null,
        h("div", { class: "formulaire" }, modele.bloc, texte.bloc),
        h("p", { class: "aide" }, "Le bouton ouvre WhatsApp, vos SMS ou votre messagerie avec ce texte déjà écrit : vous n'avez plus qu'à envoyer. ", copierTexte),
        zoneConfirmation));
  }

  async function ecranApprenant(id, info) {
    const role = etat.profil?.role;
    const estAdmin = role === "admin";
    const peutNoter = estAdmin || role === "appelante";
    const entete = () => (estAdmin ? [navigationAdmin("rappels")] : []);
    afficher(...entete(), h("p", { class: "chargement" }, "Chargement de la fiche…"));

    const [apprenant, appels, coaching] = await Promise.all([
      sb.from("apprenants")
        .select("id, organisme_id, appelante_id, identifiant_externe, prenom, nom, telephone, email, parcours, date_inscription, avancement_pct, derniere_connexion, statut, date_dernier_contact, cree_le, date_examen, presence_examen, resultat_examen, organismes ( nom, seuil_vert_jours, seuil_orange_jours )")
        .eq("id", id).maybeSingle(),
      sb.from("appels")
        .select(peutNoter
          ? "id, date_appel, canal, resultat, note_client, prochaine_action, date_prochaine_action, auteur_id, notes_internes ( contenu )"
          : "id, date_appel, canal, resultat, note_client, prochaine_action, date_prochaine_action")
        .eq("apprenant_id", id).order("date_appel", { ascending: false }).order("id"),
      sb.from("coaching").select("*").eq("apprenant_id", id).maybeSingle(),
    ]);
    const erreur = apprenant.error || appels.error || coaching.error;
    if (erreur) return afficher(...entete(), message("erreur", texteErreur(erreur)));
    const retourParDefaut = estAdmin ? (apprenant.data ? `eleves/${apprenant.data.organisme_id}` : "rappels") : "";
    if (!apprenant.data) {
      return afficher(...entete(), message("info", "Cette fiche n'existe pas ou ne vous est pas accessible."), lienInterne(retourParDefaut, "← Retour à la liste"));
    }

    const a = apprenant.data;
    const org = a.organismes || {};
    if (estAdmin) { etat.dossierActif = a.organisme_id; marquerActif(); }
    const rafraichir = (texte) => ecranApprenant(id, texte);

    // Jours sans contact et couleur, comme dans « Qui rappeler ».
    const reference = a.date_dernier_contact || a.date_inscription || (a.cree_le || "").slice(0, 10);
    const jours = joursDepuis(reference);
    const couleur = jours === null ? "neutre" : jours <= (org.seuil_vert_jours ?? 7) ? "vert" : jours <= (org.seuil_orange_jours ?? 14) ? "orange" : "rouge";

    // Apprenant suivant dans la dernière liste consultée.
    const file = etat.file && etat.file.ids.includes(id) ? etat.file : null;
    const suivantId = file ? file.ids[file.ids.indexOf(id) + 1] : null;
    const retour = file ? file.retour : retourParDefaut;

    // --- Statut (administratrice) ---
    let blocStatut = null;
    if (estAdmin) {
      const zone = h("div");
      const statut = champChoix("fiche-statut", "Statut de l'apprenant", LIBELLE_STATUT, a.statut);
      const bouton = h("button", { type: "submit", class: "bouton bouton-secondaire bouton-petit" }, "Enregistrer le statut");
      const formulaire = h("form", { class: "formulaire", novalidate: true }, statut.bloc, zone, bouton);
      formulaire.addEventListener("submit", async (evenement) => {
        evenement.preventDefault();
        occupe(bouton, true, "Enregistrement…");
        const { error } = await sb.from("apprenants").update({ statut: statut.champ.value }).eq("id", id);
        occupe(bouton, false);
        if (error) return signaler(zone, "erreur", texteErreur(error));
        rafraichir("Statut enregistré.");
      });
      blocStatut = h("section", {},
        h("div", { class: "section-titre" }, h("h2", {}, "Statut")),
        h("div", { class: "carte carte-large" },
          h("p", { class: "aide" }, "« Abandon » et « Terminé » retirent l'apprenant de la liste « Qui rappeler »."),
          formulaire));
    }

    // --- Examen ---
    const resumeExamen = a.date_examen
      ? [`Le ${dateLisible(a.date_examen)} (${ecartJours(a.date_examen).replace("en retard de", "il y a")})`,
         a.presence_examen ? LIBELLE_PRESENCE[a.presence_examen] : null,
         a.resultat_examen ? LIBELLE_RESULTAT[a.resultat_examen] : null].filter(Boolean).join(" · ")
      : "Pas encore de date d'examen.";
    const blocExamen = h("div", { class: "pile-serree" },
      h("p", {}, resumeExamen),
      estAdmin ? editeurExamen(a, () => rafraichir("Examen enregistré.")) : null);

    const blocConfie = estAdmin ? await blocConfieA(a, rafraichir) : null;

    const historique = appels.data.length
      ? h("ul", { class: "liste" }, appels.data.map((ap) =>
          ligneHistorique(ap, { peutSupprimer: estAdmin, apresSuppression: () => rafraichir("Appel supprimé.") })))
      : message("info", "Aucun appel pour l'instant.");

    // --- Deux onglets : Suivi (appels) et Coaching (stage, examen, projet, organisation) ---
    const memo = etat.ongletFiche && etat.ongletFiche.id === id ? etat.ongletFiche : { id, onglet: lireRoute().onglet || "suivi", partie: lireRoute().partie || "stage" };
    etat.ongletFiche = memo;
    const panneauSuivi = h("div", { class: "pile" },
      peutNoter ? blocContacter(a, rafraichir) : null,
      peutNoter
        ? h("section", {},
            h("div", { class: "section-titre" }, h("h2", {}, "Noter un appel")),
            h("div", { class: "carte carte-large" }, formulaireAppel(a, () => rafraichir("Appel enregistré. Le compteur repart à zéro."))))
        : null,
      h("section", {},
        h("div", { class: "section-titre" }, h("h2", {}, "Historique des appels"), h("p", {}, pluriel(appels.data.length, "appel", "appels"))),
        historique),
      blocConfie,
      blocStatut);
    const panneauCoaching = blocCoachingFiche(a, coaching.data, peutNoter, rafraichir, blocExamen, memo);
    const ongletsFiche = barreOnglets("fiche", [["suivi", "Suivi des appels", panneauSuivi], ["coaching", "Coaching", panneauCoaching]],
      memo.onglet, (cle) => {
        memo.onglet = cle;
        const cible = `#/apprenant/${a.id}/${cle}${cle === "coaching" ? `/${memo.partie}` : ""}`;
        if (window.location.hash !== cible) history.replaceState(null, "", cible);
      });

    afficher(
      ...entete(),
      h("div", { class: "pile" },
        h("div", {},
          h("p", { class: "surtitre" }, lienInterne(retour, "← Retour à la liste")),
          h("h1", {}, nomApprenant(a)),
          h("p", { class: "chapo" },
            [org.nom, a.parcours, a.identifiant_externe].filter(Boolean).join(" · "), " ",
            a.statut === "actif"
              ? pastille(couleur, jours === null ? "jamais contacté·e" : `${jours} j sans contact`)
              : pastille("neutre", LIBELLE_STATUT[a.statut]))),

        info ? message("info", info) : null,
        suivantId
          ? h("p", { class: "message message-action" }, lienInterne(`apprenant/${suivantId}`, "Apprenant suivant dans la liste →"))
          : null,

        h("div", { class: "compteurs" },
          h("div", { class: "compteur" }, h("span", { class: "compteur-valeur" }, a.avancement_pct === null || a.avancement_pct === undefined ? "—" : `${Math.round(a.avancement_pct)} %`), h("span", { class: "compteur-libelle" }, "avancement")),
          h("div", { class: "compteur" }, h("span", { class: "compteur-valeur compteur-valeur-date" }, a.derniere_connexion ? dateLisible(a.derniere_connexion) : "—"), h("span", { class: "compteur-libelle" }, "dernière connexion")),
          h("div", { class: "compteur" }, h("span", { class: "compteur-valeur compteur-valeur-date" }, a.date_dernier_contact ? dateLisible(a.date_dernier_contact) : "—"), h("span", { class: "compteur-libelle" }, "dernier contact")),
          h("div", { class: "compteur" }, h("span", { class: "compteur-valeur compteur-valeur-date" }, a.date_examen ? dateLisible(a.date_examen) : "—"), h("span", { class: "compteur-libelle" }, "examen"))),

        ongletsFiche)
    );
    window.scrollTo(0, 0);
  }

  // ===========================================================================
  // ACCÈS : comptes clients et appelantes (étape 7)
  // ===========================================================================
  //   #/acces   créer un compte, désactiver / réactiver, voir qui a accès à quoi
  // La création passe par la fonction serveur « gerer-comptes ».
  // ===========================================================================

  function adresseSite() {
    return /^https?:$/.test(window.location.protocol) ? window.location.origin + window.location.pathname : "https://filrouge-apprenant.github.io/";
  }

  function messageBienvenue(role, nom) {
    const bonjour = nom ? `Bonjour ${nom.split(" ")[0]},` : "Bonjour,";
    return role === "client"
      ? `${bonjour}\n\nVotre espace de suivi Fil Rouge Apprenants est prêt. Vous y retrouvez vos apprenants, les comptes rendus d'appel, le suivi jusqu'à l'examen et votre dossier de preuves Qualiopi.\n\nPour vous connecter : ${adresseSite()}\nSaisissez votre adresse email, puis ouvrez le lien de connexion que vous recevrez (pensez à vérifier les courriers indésirables).\n\nÀ bientôt,\nÉmilie Rachas\nFil Rouge Apprenants`
      : `${bonjour}\n\nTon accès à la plateforme Fil Rouge Apprenants est prêt. Tu y trouveras les apprenants qui te sont confiés et le bouton « Noter un appel ».\n\nPour te connecter : ${adresseSite()}\nSaisis ton adresse email, puis ouvre le lien de connexion reçu (vérifie les courriers indésirables).\n\nÀ bientôt,\nÉmilie`;
  }

  async function copier(texte, bouton) {
    try {
      await navigator.clipboard.writeText(texte);
      const avant = bouton.textContent;
      bouton.textContent = "Copié ✓";
      setTimeout(() => { bouton.textContent = avant; }, 2000);
    } catch (e) {
      bouton.textContent = "Copie impossible : sélectionnez le texte";
    }
  }

  async function ecranAcces(info) {
    afficher(navigationAdmin("acces"), h("p", { class: "chargement" }, "Chargement des accès…"));

    const [profils, organismes, confies] = await Promise.all([
      sb.from("profils").select("id, email, nom_affiche, role, organisme_id, actif, cree_le").order("cree_le"),
      sb.from("organismes").select("id, nom, organismes_suivi_commercial ( etape )").order("nom"),
      sb.from("apprenants").select("appelante_id").not("appelante_id", "is", null),
    ]);
    const erreur = profils.error || organismes.error || confies.error;
    if (erreur) return afficher(navigationAdmin("acces"), message("erreur", texteErreur(erreur)));

    const nomOrganisme = new Map(organismes.data.map((o) => [o.id, o.nom]));
    const nbConfies = new Map();
    for (const a of confies.data) nbConfies.set(a.appelante_id, (nbConfies.get(a.appelante_id) || 0) + 1);

    // Les clients en premier dans la liste des organismes, puis les autres.
    const estClient = (o) => (o.organismes_suivi_commercial?.etape || "prospect") === "client";
    const choixOrganismes = Object.fromEntries([["", "— Choisir l'organisme —"],
      ...organismes.data.filter(estClient).map((o) => [o.id, o.nom]),
      ...organismes.data.filter((o) => !estClient(o)).map((o) => [o.id, `${o.nom} (pas encore client)`])]);

    // --- Formulaire de création ---
    const zone = h("div");
    const zoneResultat = h("div");
    const email = champTexte("acces-email", "Adresse email", "", { type: "email", inputmode: "email", autocomplete: "off", obligatoire: true });
    const nom = champTexte("acces-nom", "Prénom et nom", "", { placeholder: "Ex. : Sophie Durand" });
    const role = champChoix("acces-role", "Type de compte", { client: "Client (lecture seule)", appelante: "Appelante (renfort d'appels)" }, "client");
    const organisme = champChoix("acces-organisme", "Organisme", choixOrganismes, "");
    const blocOrganisme = h("div", {}, organisme.bloc);
    const majRole = () => { blocOrganisme.hidden = role.champ.value !== "client"; };
    role.champ.addEventListener("change", majRole);
    majRole();
    const bouton = h("button", { class: "bouton", type: "submit" }, "Créer le compte");
    const formulaire = h("form", { class: "formulaire", novalidate: true }, email.bloc, nom.bloc, role.bloc, blocOrganisme, zone, bouton);

    formulaire.addEventListener("submit", async (evenement) => {
      evenement.preventDefault();
      const adresse = email.champ.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(adresse)) return signaler(zone, "erreur", "Indiquez une adresse email valable.");
      if (role.champ.value === "client" && !organisme.champ.value) return signaler(zone, "erreur", "Choisissez l'organisme de ce client.");
      signaler(zone);
      occupe(bouton, true, "Création…");
      const { data, error } = await sb.functions.invoke("gerer-comptes", {
        body: { action: "creer", email: adresse, nom_affiche: nom.champ.value.trim(), role: role.champ.value, organisme_id: organisme.champ.value || null },
      });
      occupe(bouton, false);
      if (error) {
        let texte = "Le compte n'a pas pu être créé. Réessayez dans un instant.";
        try { const corps = await error.context.json(); if (corps && corps.erreur) texte = corps.erreur; } catch (e) { /* message par défaut */ }
        return signaler(zone, "erreur", texte);
      }
      // Message prêt à envoyer à la personne.
      const texteBienvenue = messageBienvenue(role.champ.value, nom.champ.value.trim());
      const boutonCopier = h("button", { type: "button", class: "bouton bouton-secondaire bouton-petit" }, "Copier le message");
      boutonCopier.addEventListener("click", () => copier(texteBienvenue, boutonCopier));
      zoneResultat.replaceChildren(
        h("div", { class: "carte carte-large pile pile-serree" },
          h("p", { class: "message message-action" }, h("strong", {}, `Compte créé pour ${data.email}. `), "Envoyez-lui ce message :"),
          h("p", { class: "texte-libre message-a-envoyer" }, texteBienvenue),
          h("div", { class: "actions-ligne" },
            boutonCopier,
            h("a", { class: "bouton bouton-secondaire bouton-petit", href: `mailto:${data.email}?subject=${encodeURIComponent("Votre accès Fil Rouge Apprenants")}&body=${encodeURIComponent(texteBienvenue)}` }, "Ouvrir dans ma messagerie"))));
      formulaire.reset();
      majRole();
      ecranAccesListe();
    });

    // --- Liste des comptes ---
    const zoneListe = h("section", {});
    async function ecranAccesListe() {
      const { data, error } = await sb.from("profils").select("id, email, nom_affiche, role, organisme_id, actif, cree_le").order("cree_le");
      if (error) return zoneListe.replaceChildren(message("erreur", texteErreur(error)));
      dessinerListe(data);
    }
    function dessinerListe(liste) {
      const autres = liste.filter((p) => p.id !== etat.profil.id);
      const ligne = (p) => {
        const zoneLigne = h("div");
        const basculer = h("button", { type: "button", class: p.actif ? "bouton-lien bouton-lien-danger" : "bouton-lien" }, p.actif ? "Désactiver l'accès" : "Réactiver l'accès");
        basculer.addEventListener("click", async () => {
          occupe(basculer, true, "…");
          const { error } = await sb.from("profils").update({ actif: !p.actif }).eq("id", p.id);
          occupe(basculer, false);
          if (error) return signaler(zoneLigne, "erreur", texteErreur(error));
          ecranAccesListe();
        });
        const details = p.role === "client"
          ? nomOrganisme.get(p.organisme_id) || "Organisme supprimé"
          : pluriel(nbConfies.get(p.id) || 0, "apprenant confié", "apprenants confiés");
        return h("li", { class: "ligne" },
          h("span", { class: "ligne-titre" }, p.nom_affiche || p.email),
          h("span", { class: "pastilles" },
            pastille(p.role === "client" ? "neutre" : "orange", p.role === "client" ? "Client" : "Appelante"),
            p.actif ? pastille("vert", "Actif") : pastille("rouge", "Désactivé")),
          h("span", { class: "ligne-detail" }, [p.nom_affiche ? p.email : null, details].filter(Boolean).join(" · ")),
          h("div", { class: "ligne-detail" }, basculer, zoneLigne));
      };
      zoneListe.replaceChildren(
        h("div", { class: "section-titre" }, h("h2", {}, "Comptes existants"), h("p", {}, pluriel(autres.length, "compte", "comptes"))),
        autres.length ? h("ul", { class: "liste" }, autres.map(ligne)) : message("info", "Aucun compte client ou appelante pour l'instant."),
        h("p", { class: "aide" }, "Désactiver coupe l'accès immédiatement, sans rien effacer. Pour confier un apprenant à une appelante, ouvrez la fiche de l'apprenant."));
    }
    dessinerListe(profils.data);

    afficher(
      navigationAdmin("acces"),
      h("div", { class: "pile" },
        h("div", {},
          h("p", { class: "surtitre" }, "Accès"),
          h("h1", {}, "Comptes clients et appelantes"),
          h("p", { class: "chapo" }, "Créez l'accès d'un client ou d'une appelante. Chacun ne voit que ce qui le concerne : le client, ses apprenants ; l'appelante, ceux que vous lui confiez.")),
        info ? message("info", info) : null,
        h("section", {},
          h("div", { class: "section-titre" }, h("h2", {}, "Nouveau compte")),
          h("div", { class: "carte carte-large" },
            h("p", { class: "aide" }, "Rappel : aucune donnée réelle d'apprenant avant la signature du contrat de sous-traitance et de l'accord RGPD avec le client."),
            formulaire)),
        zoneResultat,
        zoneListe)
    );
    window.scrollTo(0, 0);
  }

  // Bloc « Confié à » de la fiche apprenant (administratrice).
  async function blocConfieA(apprenant, rafraichir) {
    const { data, error } = await sb.from("profils").select("id, email, nom_affiche").eq("role", "appelante").eq("actif", true).order("nom_affiche");
    if (error) return message("erreur", texteErreur(error));
    const choix = Object.fromEntries([["", "Moi (personne d'autre)"], ...data.map((p) => [p.id, p.nom_affiche || p.email])]);
    if (apprenant.appelante_id && !(apprenant.appelante_id in choix)) choix[apprenant.appelante_id] = "Appelante désactivée";
    const zone = h("div");
    const champ = champChoix("fiche-appelante", "Appels assurés par", choix, apprenant.appelante_id || "");
    const bouton = h("button", { type: "submit", class: "bouton bouton-secondaire bouton-petit" }, "Enregistrer");
    const formulaire = h("form", { class: "formulaire", novalidate: true }, champ.bloc, zone, bouton);
    formulaire.addEventListener("submit", async (evenement) => {
      evenement.preventDefault();
      occupe(bouton, true, "Enregistrement…");
      const { error: erreurMaj } = await sb.from("apprenants").update({ appelante_id: champ.champ.value || null }).eq("id", apprenant.id);
      occupe(bouton, false);
      if (erreurMaj) return signaler(zone, "erreur", texteErreur(erreurMaj));
      rafraichir("Suivi attribué.");
    });
    return h("section", {},
      h("div", { class: "section-titre" }, h("h2", {}, "Qui appelle cet apprenant ?")),
      h("div", { class: "carte carte-large" },
        data.length ? null : h("p", { class: "aide" }, "Aucune appelante pour l'instant. Créez son compte dans l'onglet Accès."),
        formulaire));
  }

  async function accueilClient(profil) {
    afficher(h("p", { class: "chargement" }, "Chargement de vos apprenants…"));

    const [organisme, apprenants, tauxCohortes, examensAVenir] = await Promise.all([
      sb.from("organismes").select("nom, taux_presence_depart").eq("id", profil.organisme_id).maybeSingle(),
      sb.from("vue_qui_rappeler").select("id, identifiant_externe, prenom, nom, parcours, jours_sans_contact, alerte"),
      sb.from("vue_taux_examen").select("*"),
      sb.from("vue_relances_examen").select("id", { count: "exact", head: true }),
    ]);
    const erreur = organisme.error || apprenants.error || tauxCohortes.error || examensAVenir.error;
    if (erreur) return afficher(message("erreur", texteErreur(erreur)));
    const totalExamens = totalTaux(tauxCohortes.data);

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
            h("h2", {}, "Jusqu'à l'examen")),
          h("div", { class: "actions-ligne" },
            h("a", { href: "#/preuves", class: "bouton bouton-petit" }, "Dossier de preuves Qualiopi")),
          h("div", { class: "compteurs" },
            h("div", { class: "compteur" }, h("span", { class: "compteur-valeur" }, examensAVenir.count || 0), h("span", { class: "compteur-libelle" }, "examens à venir")),
            h("div", { class: "compteur compteur-vert" }, h("span", { class: "compteur-valeur" }, pourcentage(totalExamens.taux_presence)), h("span", { class: "compteur-libelle" }, "taux de présence")),
            h("div", { class: "compteur" }, h("span", { class: "compteur-valeur" }, pourcentage(totalExamens.taux_reussite)), h("span", { class: "compteur-libelle" }, "taux de réussite")),
            h("div", { class: "compteur" }, h("span", { class: "compteur-valeur" }, totalExamens.presents + totalExamens.absents), h("span", { class: "compteur-libelle" }, "examens renseignés"))),
          tauxCohortes.data.some((l) => Number(l.inscrits_examen)) ? tableauTaux(tauxCohortes.data, organisme.data?.taux_presence_depart) : null),
        h("section", {},
          h("div", { class: "section-titre" },
            h("h2", {}, "Vos apprenants"),
            h("p", {}, "Les plus urgents en premier")),
          (memoriserFile(trierParUrgence(apprenants.data), ""), listeApprenants(trierParUrgence(apprenants.data))))
      )
    );
  }

  async function accueilAppelante(profil) {
    afficher(h("p", { class: "chargement" }, "Chargement de vos apprenants…"));
    const { data, error } = await sb
      .from("vue_qui_rappeler")
      .select("id, identifiant_externe, prenom, nom, parcours, telephone, jours_sans_contact, alerte");
    if (error) return afficher(message("erreur", texteErreur(error)));
    memoriserFile(trierParUrgence(data), "");

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

  // ===========================================================================
  // MENU LATÉRAL (administratrice, étape 9)
  // ===========================================================================
  // Sur ordinateur : colonne à gauche, toujours visible. Sur téléphone : volet
  // qui s'ouvre avec le bouton « Menu ». Groupes dépliables :
  //   Prospects · Clients · Élèves (un dossier par client) · Coaching
  // Les groupes ouverts sont retenus dans ce navigateur (simple confort).
  // ===========================================================================

  const menu = document.getElementById("menu-lateral");
  const boutonMenu = document.getElementById("bouton-menu");
  const voile = document.getElementById("voile");
  const CLE_GROUPES = "filrouge.menu.groupes";
  let signatureMenu = "";

  function lireGroupesOuverts() {
    try {
      const v = JSON.parse(localStorage.getItem(CLE_GROUPES) || "null");
      return Array.isArray(v) ? v : ["eleves"];
    } catch (e) {
      return ["eleves"];
    }
  }
  function memoriserGroupes() {
    try {
      localStorage.setItem(CLE_GROUPES, JSON.stringify([...menu.querySelectorAll("details[open]")].map((d) => d.dataset.groupe)));
    } catch (e) { /* confort seulement */ }
  }

  function ouvrirMenu(ouvert) {
    document.body.classList.toggle("menu-ouvert", ouvert);
    boutonMenu.setAttribute("aria-expanded", String(ouvert));
    voile.hidden = !ouvert;
  }
  boutonMenu.addEventListener("click", () => ouvrirMenu(!document.body.classList.contains("menu-ouvert")));
  voile.addEventListener("click", () => ouvrirMenu(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") ouvrirMenu(false); });
  menu.addEventListener("click", (e) => { if (e.target.closest("a")) ouvrirMenu(false); });

  function menuVisible() {
    return Boolean(etat.profil && etat.profil.role === "admin" && !zoneCompte.hidden);
  }

  function etapeDe(o) {
    const s = Array.isArray(o.organismes_suivi_commercial) ? o.organismes_suivi_commercial[0] : o.organismes_suivi_commercial;
    return (s && s.etape) || "prospect";
  }

  async function chargerMenu() {
    if (!menuVisible()) return;
    const [orgs, appr, urgents] = await Promise.all([
      sb.from("organismes").select("id, nom, organismes_suivi_commercial ( etape )").order("nom"),
      sb.from("apprenants").select("organisme_id, statut"),
      sb.from("vue_qui_rappeler").select("id").eq("alerte", "rouge"),
    ]);
    if (orgs.error || appr.error || urgents.error) return;
    const total = new Map();
    const actifs = new Map();
    for (const a of appr.data) {
      total.set(a.organisme_id, (total.get(a.organisme_id) || 0) + 1);
      if (a.statut === "actif") actifs.set(a.organisme_id, (actifs.get(a.organisme_id) || 0) + 1);
    }
    const donnees = {
      prospects: orgs.data.filter((o) => !["client", "perdu"].includes(etapeDe(o))).map((o) => ({ id: o.id, nom: o.nom })),
      clients: orgs.data.filter((o) => etapeDe(o) === "client").map((o) => ({ id: o.id, nom: o.nom })),
      // Un dossier par client, et par organisme qui a déjà des élèves (test gratuit).
      dossiers: orgs.data.filter((o) => etapeDe(o) === "client" || total.has(o.id)).map((o) => ({ id: o.id, nom: o.nom, n: actifs.get(o.id) || 0 })),
      urgents: urgents.data.length,
    };
    const signature = JSON.stringify(donnees);
    if (signature !== signatureMenu) {
      signatureMenu = signature;
      dessinerMenu(donnees);
    }
    marquerActif();
  }

  function dessinerMenu(d) {
    const ouverts = new Set(lireGroupesOuverts());
    const lien = (chemin, texte, extra) =>
      h("a", { href: `#/${chemin}`, class: "menu-lien", "data-chemin": chemin }, h("span", { class: "menu-texte" }, texte), extra || null);
    const nombre = (n, alerte) => h("span", { class: alerte ? "menu-nombre menu-nombre-alerte" : "menu-nombre" }, String(n));
    const vide = (texte) => h("p", { class: "menu-vide" }, texte);
    const groupe = (cle, titre, enfants) => {
      const g = h("details", { class: "menu-groupe", "data-groupe": cle },
        h("summary", {}, h("span", {}, titre)),
        h("div", { class: "menu-sous" }, enfants));
      g.open = ouverts.has(cle);
      g.addEventListener("toggle", memoriserGroupes);
      return g;
    };

    menu.replaceChildren(
      h("div", { class: "menu-haut" },
        lien("", "Tableau de bord"),
        lien("rappels", "À rappeler", d.urgents ? nombre(d.urgents, true) : null),
        lien("examens", "Relances d'examen")),
      groupe("prospects", "Prospects", [
        lien("prospection", "Tous les centres à démarcher"),
        lien("nouveau", "Ajouter un centre"),
        d.prospects.length ? h("div", { class: "menu-liste" }, d.prospects.map((o) => lien(`organisme/${o.id}`, o.nom))) : vide("Aucun centre en cours."),
      ]),
      groupe("clients", "Clients", [
        d.clients.length ? d.clients.map((o) => lien(`organisme/${o.id}`, o.nom)) : vide("Pas encore de client signé."),
        lien("acces", "Comptes d'accès"),
      ]),
      groupe("eleves", "Élèves", [
        d.dossiers.length
          ? d.dossiers.map((o) => lien(`eleves/${o.id}`, [h("span", { class: "icone-dossier", "aria-hidden": "true" }), o.nom], nombre(o.n)))
          : vide("Les dossiers apparaissent dès qu'un client a des élèves."),
      ]));
  }

  // Met en avant l'entrée de la page affichée (et ouvre son groupe).
  function marquerActif() {
    const chemin = (window.location.hash || "#/").replace(/^#\/?/, "");
    let actif = null;
    for (const a of menu.querySelectorAll(".menu-lien")) {
      a.removeAttribute("aria-current");
      const c = a.dataset.chemin;
      const correspond = c === chemin || (c !== "" && chemin.startsWith(`${c}/`));
      if (correspond && (!actif || c.length > actif.dataset.chemin.length)) actif = a;
    }
    if (!actif && etat.dossierActif) actif = menu.querySelector(`[data-chemin="eleves/${etat.dossierActif}"]`);
    if (actif) {
      actif.setAttribute("aria-current", "page");
      const g = actif.closest("details");
      if (g && !g.open) g.open = true;
    }
  }

  // ===========================================================================
  // DOSSIER ÉLÈVES D'UN CLIENT (#/eleves/<id>)
  // ===========================================================================
  // Un dossier = les élèves d'un seul client. Rien n'est mélangé : la base
  // range chaque élève dans le dossier de son organisme (cloisonnement).
  // ===========================================================================

  function pourRecherche(texte) {
    return String(texte || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  }

  async function ecranDossierEleves(organismeId) {
    afficher(h("p", { class: "chargement" }, "Ouverture du dossier…"));
    const [org, appr] = await Promise.all([
      sb.from("organismes").select("id, nom, seuil_vert_jours, seuil_orange_jours").eq("id", organismeId).maybeSingle(),
      sb.from("apprenants")
        .select("id, identifiant_externe, prenom, nom, parcours, avancement_pct, statut, date_dernier_contact, date_inscription, cree_le, date_examen")
        .eq("organisme_id", organismeId).order("nom").order("prenom"),
    ]);
    const erreur = org.error || appr.error;
    if (erreur) return afficher(message("erreur", texteErreur(erreur)));
    if (!org.data) return afficher(message("info", "Ce dossier n'existe pas ou n'est plus accessible."));

    const o = org.data;
    const eleves = appr.data;
    let statutChoisi = "actif";
    let recherche = "";

    const filtres = h("div", { class: "filtres", role: "group", "aria-label": "Statut des élèves" });
    const champ = h("input", { type: "search", class: "recherche", placeholder: "Rechercher : nom, identifiant, parcours", "aria-label": "Rechercher un élève", autocomplete: "off" });
    const zoneListe = h("div");
    champ.addEventListener("input", () => { recherche = champ.value; dessiner(); });

    const couleurPour = (jours) => (jours === null ? "neutre" : jours <= (o.seuil_vert_jours ?? 7) ? "vert" : jours <= (o.seuil_orange_jours ?? 14) ? "orange" : "rouge");

    function ligneEleve(a) {
      const jours = joursDepuis(a.date_dernier_contact || a.date_inscription || (a.cree_le || "").slice(0, 10));
      return h("li", { class: "ligne" },
        h("span", { class: "ligne-titre" }, lienInterne(`apprenant/${a.id}`, nomApprenant(a))),
        h("span", { class: "pastilles" },
          a.statut === "actif" ? pastille(couleurPour(jours), jours === null ? "jamais contacté·e" : `${jours} j sans contact`) : pastille("neutre", LIBELLE_STATUT[a.statut])),
        h("span", { class: "ligne-detail" }, [
          a.parcours,
          a.identifiant_externe,
          a.avancement_pct === null || a.avancement_pct === undefined ? null : `${Math.round(a.avancement_pct)} % du parcours`,
          a.date_examen ? `examen le ${dateLisible(a.date_examen)}` : null,
        ].filter(Boolean).join(" · ")));
    }

    function dessiner() {
      filtres.replaceChildren(...Object.entries(LIBELLE_STATUT).map(([statut, texte]) => {
        const b = h("button", { type: "button", class: "filtre", "aria-pressed": String(statut === statutChoisi) },
          texte, h("span", { class: "filtre-nombre" }, String(eleves.filter((a) => a.statut === statut).length)));
        b.addEventListener("click", () => { statutChoisi = statut; dessiner(); });
        return b;
      }));
      const q = pourRecherche(recherche);
      const visibles = eleves
        .filter((a) => a.statut === statutChoisi)
        .filter((a) => !q || pourRecherche([a.prenom, a.nom, a.identifiant_externe, a.parcours].join(" ")).includes(q));
      memoriserFile(visibles, `eleves/${organismeId}`);
      zoneListe.replaceChildren(visibles.length
        ? h("ul", { class: "liste" }, visibles.map(ligneEleve))
        : message("info", !eleves.length
            ? "Ce dossier est vide. Importez le fichier d'élèves envoyé par ce client."
            : q ? "Aucun élève ne correspond à cette recherche." : "Aucun élève avec ce statut."));
    }
    dessiner();

    const nbActifs = eleves.filter((a) => a.statut === "actif").length;
    afficher(
      h("div", { class: "pile" },
        h("div", { class: "entete-dossier" },
          h("span", { class: "icone-dossier icone-dossier-grande", "aria-hidden": "true" }),
          h("div", {},
            h("h1", {}, o.nom),
            h("p", { class: "chapo" }, `Dossier élèves : ${pluriel(nbActifs, "élève en formation", "élèves en formation")}, ${pluriel(eleves.length, "au total", "au total")}.`))),
        h("div", { class: "actions-ligne" },
          h("a", { class: "bouton bouton-petit", href: `#/import/${o.id}` }, "Importer des élèves"),
          h("a", { class: "bouton bouton-secondaire bouton-petit", href: `#/rappels/${o.id}` }, "Qui rappeler"),
          h("a", { class: "bouton bouton-secondaire bouton-petit", href: `#/examens/${o.id}` }, "Examens et preuves"),
          h("a", { class: "bouton bouton-secondaire bouton-petit", href: `#/organisme/${o.id}` }, "Fiche du client")),
        h("section", {}, champ, filtres, zoneListe)));
    window.scrollTo(0, 0);
  }

  // ===========================================================================
  // COACHING : stage, projet, organisation (#/coaching/<type>)
  // ===========================================================================
  // L'examen garde son écran (#/examens). Chaque écran classe les élèves en
  // formation par situation, du plus urgent au plus avancé ; un filtre limite
  // l'affichage au dossier d'un seul client.
  // ===========================================================================

  const LIBELLE_STAGE = {
    non_concerne: "Pas de stage dans ce parcours",
    a_chercher: "Stage à trouver",
    structure_trouvee: "Structure trouvée",
    convention_envoyee: "Convention envoyée, en attente de signature",
    convention_signee: "Convention signée",
    en_cours: "En stage",
    termine: "Stage terminé",
  };
  const LIBELLE_SITUATION = {
    reconversion: "En reconversion",
    en_emploi: "En emploi",
    en_recherche: "En recherche d'emploi",
    creation_activite: "Création d'activité",
    autre: "Autre situation",
  };

  function ficheDe(a) {
    return (Array.isArray(a.coaching) ? a.coaching[0] : a.coaching) || null;
  }

  const ECRANS_COACHING = {
    stage: {
      titre: "Stage",
      chapo: "Où en est chaque élève de sa recherche de stage et de sa convention. Les conventions à faire signer passent en premier.",
      groupe: (f) => (f ? f.stage_statut : "a_renseigner"),
      ordre: ["convention_envoyee", "a_chercher", "structure_trouvee", "a_renseigner", "convention_signee", "en_cours", "termine", "non_concerne"],
      replies: ["termine", "non_concerne"],
      libelles: { ...LIBELLE_STAGE, a_renseigner: "Situation de stage à renseigner" },
      detail: (f) => f && [
        f.stage_structure,
        f.stage_debut ? `du ${dateLisible(f.stage_debut)}` : null,
        f.stage_fin ? `au ${dateLisible(f.stage_fin)}` : null,
      ].filter(Boolean).join(" "),
    },
    projet: {
      titre: "Projet",
      chapo: "Le métier visé par chaque élève et sa situation : c'est ce qui le fait tenir jusqu'à l'examen.",
      groupe: (f) => (f && (f.projet_metier || f.projet_situation) ? (f.projet_situation || "autre") : "a_renseigner"),
      ordre: ["a_renseigner", "en_recherche", "reconversion", "creation_activite", "en_emploi", "autre"],
      replies: [],
      libelles: { ...LIBELLE_SITUATION, a_renseigner: "Projet à définir avec l'élève" },
      detail: (f) => f && [f.projet_metier ? `Métier visé : ${f.projet_metier}` : null, f.projet_note].filter(Boolean).join(" — "),
    },
    organisation: {
      titre: "Organisation",
      chapo: "Le temps que chaque élève consacre à sa formation, ses créneaux et son objectif du mois.",
      groupe: (f) => {
        if (!f || !f.orga_objectif) return "sans_objectif";
        if (f.orga_date_fin_visee && joursDepuis(f.orga_date_fin_visee) >= -30) return "fin_proche";
        return "avec_objectif";
      },
      ordre: ["sans_objectif", "fin_proche", "avec_objectif"],
      replies: [],
      libelles: { sans_objectif: "Pas d'objectif fixé ce mois-ci", fin_proche: "Fin de parcours visée dans moins de 30 jours", avec_objectif: "Objectif du mois fixé" },
      detail: (f) => f && [
        f.orga_objectif ? `Objectif : ${f.orga_objectif}` : null,
        f.orga_heures_semaine !== null && f.orga_heures_semaine !== undefined ? `${f.orga_heures_semaine} h par semaine` : null,
        f.orga_creneaux,
        f.orga_date_fin_visee ? `fin visée le ${dateLisible(f.orga_date_fin_visee)}` : null,
      ].filter(Boolean).join(" · "),
    },
  };

  async function ecranCoaching(type, organismeId) {
    const ecran = ECRANS_COACHING[type];
    if (!ecran) return accueilAdmin(etat.profil);
    afficher(h("p", { class: "chargement" }, `Chargement : ${ecran.titre.toLowerCase()}…`));

    const { data, error } = await sb.from("apprenants")
      .select("id, organisme_id, prenom, nom, identifiant_externe, parcours, avancement_pct, organismes ( nom ), coaching ( * )")
      .eq("statut", "actif").order("nom");
    if (error) return afficher(message("erreur", texteErreur(error)));

    const organismes = new Map();
    for (const a of data) organismes.set(a.organisme_id, a.organismes?.nom || "Organisme");
    const choix = h("select", { "aria-label": "Dossier client" },
      h("option", { value: "" }, "Tous les clients"),
      [...organismes].sort((x, y) => x[1].localeCompare(y[1], "fr")).map(([id, nom]) => h("option", { value: id }, nom)));
    choix.value = organismeId && organismes.has(organismeId) ? organismeId : "";
    choix.addEventListener("change", () => aller(`coaching/${type}${choix.value ? `/${choix.value}` : ""}`));

    const visibles = data.filter((a) => !choix.value || a.organisme_id === choix.value);
    const groupes = new Map(ecran.ordre.map((cle) => [cle, []]));
    for (const a of visibles) {
      const cle = ecran.groupe(ficheDe(a));
      if (!groupes.has(cle)) groupes.set(cle, []);
      groupes.get(cle).push(a);
    }
    memoriserFile([...groupes.values()].flat(), `coaching/${type}${choix.value ? `/${choix.value}` : ""}`);

    const ligne = (a) => {
      const detail = ecran.detail(ficheDe(a));
      return h("li", { class: "ligne" },
        h("span", { class: "ligne-titre" }, lienInterne(`apprenant/${a.id}`, nomApprenant(a))),
        h("span", { class: "pastilles" }, choix.value ? null : pastille("neutre", a.organismes?.nom || "")),
        h("span", { class: "ligne-detail" }, [a.parcours, detail].filter(Boolean).join(" · ")));
    };

    const sections = [...groupes].filter(([, liste]) => liste.length).map(([cle, liste]) => {
      const titre = h("div", { class: "section-titre" }, h("h2", {}, ecran.libelles[cle] || cle), h("p", {}, pluriel(liste.length, "élève", "élèves")));
      const corps = h("ul", { class: "liste" }, liste.map(ligne));
      return ecran.replies.includes(cle)
        ? h("details", { class: "depliant section-repliee" }, h("summary", {}, `${ecran.libelles[cle]} (${liste.length})`), corps)
        : h("section", {}, titre, corps);
    });

    afficher(
      h("div", { class: "pile" },
        h("div", {},
          h("h1", {}, ecran.titre),
          h("p", { class: "chapo" }, ecran.chapo)),
        h("label", { class: "choix-dossier" }, "Dossier", choix),
        sections.length ? sections : message("info", "Aucun élève en formation dans ce dossier."),
        h("p", { class: "aide" }, "Pour compléter une situation, ouvrez la fiche de l'élève, partie « Coaching ».")));
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------------------
  // Onglets (fiche apprenant). Changer d'onglet ne recharge rien : l'adresse
  // est mise à jour pour pouvoir y revenir (#/apprenant/<id>/coaching/stage).
  // ---------------------------------------------------------------------------
  function barreOnglets(nom, onglets, actif, surChangement) {
    const boutons = [];
    const panneaux = [];
    const choisir = (cle, focus) => {
      onglets.forEach(([c], i) => {
        const oui = c === cle;
        boutons[i].setAttribute("aria-selected", String(oui));
        boutons[i].tabIndex = oui ? 0 : -1;
        panneaux[i].hidden = !oui;
        if (oui && focus) boutons[i].focus();
      });
      surChangement(cle);
    };
    onglets.forEach(([cle, texte, contenuPanneau], i) => {
      const b = h("button", { type: "button", role: "tab", class: "onglet-fiche", id: `onglet-${nom}-${cle}`, "aria-controls": `panneau-${nom}-${cle}` }, texte);
      b.addEventListener("click", () => choisir(cle));
      b.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const j = (i + (e.key === "ArrowRight" ? 1 : onglets.length - 1)) % onglets.length;
        choisir(onglets[j][0], true);
      });
      boutons.push(b);
      panneaux.push(h("div", { role: "tabpanel", id: `panneau-${nom}-${cle}`, "aria-labelledby": `onglet-${nom}-${cle}`, class: "panneau-onglet" }, contenuPanneau));
    });
    const bloc = h("div", { class: `onglets-fiche onglets-${nom}` },
      h("div", { role: "tablist", class: "barre-onglets", "aria-label": nom === "fiche" ? "Parties de la fiche" : "Coaching" }, boutons),
      panneaux);
    const depart = onglets.some(([c]) => c === actif) ? actif : onglets[0][0];
    onglets.forEach(([c], i) => {
      boutons[i].setAttribute("aria-selected", String(c === depart));
      boutons[i].tabIndex = c === depart ? 0 : -1;
      panneaux[i].hidden = c !== depart;
    });
    return bloc;
  }

  // Onglet « Coaching » de la fiche : Stage, Examen, Projet, Organisation.
  function blocCoachingFiche(a, fiche, peutModifier, rafraichir, contenuExamen, memo) {
    const f = fiche || {};
    const vide = (v) => (v === undefined || v === null ? "" : v);
    const texte = (c) => c.champ.value.trim() || null;
    const majAdresse = () => {
      const cible = `#/apprenant/${a.id}/${memo.onglet}${memo.onglet === "coaching" ? `/${memo.partie}` : ""}`;
      if (window.location.hash !== cible) history.replaceState(null, "", cible);
    };

    // Un formulaire par partie ; chacun n'enregistre que ses propres champs.
    function formulairePartie(champs, valeurs, verifier) {
      const zone = h("div");
      const bouton = h("button", { class: "bouton", type: "submit" }, "Enregistrer");
      const form = h("form", { class: "formulaire", novalidate: true }, champs, zone, bouton);
      form.addEventListener("submit", async (evenement) => {
        evenement.preventDefault();
        const probleme = verifier ? verifier() : null;
        if (probleme) return signaler(zone, "erreur", probleme);
        signaler(zone);
        occupe(bouton, true, "Enregistrement…");
        const { error } = await sb.from("coaching").upsert({ apprenant_id: a.id, organisme_id: a.organisme_id, ...valeurs() }, { onConflict: "apprenant_id" });
        occupe(bouton, false);
        if (error) return signaler(zone, "erreur", texteErreur(error));
        rafraichir("Coaching enregistré.");
      });
      return h("div", { class: "carte carte-large" }, form);
    }
    const lecture = (lignes) => {
      const utiles = lignes.filter(([, v]) => v);
      return utiles.length
        ? h("dl", { class: "resume-coaching" }, utiles.map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]))
        : message("info", "Rien de renseigné pour l'instant.");
    };

    // --- Stage ---
    let stage;
    if (peutModifier) {
      const statut = champChoix("co-stage-statut", "Situation", LIBELLE_STAGE, f.stage_statut || "non_concerne");
      const structure = champTexte("co-stage-structure", "Structure d'accueil", vide(f.stage_structure), { placeholder: "Ex. : Crèche Les Petits Pas" });
      const debut = champTexte("co-stage-debut", "Début du stage", vide(f.stage_debut), { type: "date" });
      const fin = champTexte("co-stage-fin", "Fin du stage", vide(f.stage_fin), { type: "date" });
      stage = formulairePartie([statut.bloc, structure.bloc, h("div", { class: "deux-colonnes" }, debut.bloc, fin.bloc)],
        () => ({ stage_statut: statut.champ.value, stage_structure: texte(structure), stage_debut: debut.champ.value || null, stage_fin: fin.champ.value || null }),
        () => (debut.champ.value && fin.champ.value && fin.champ.value < debut.champ.value ? "La fin du stage est avant son début." : null));
    } else {
      stage = lecture([["Situation", LIBELLE_STAGE[f.stage_statut || "non_concerne"]], ["Structure", f.stage_structure],
        ["Dates", [f.stage_debut ? `du ${dateLisible(f.stage_debut)}` : null, f.stage_fin ? `au ${dateLisible(f.stage_fin)}` : null].filter(Boolean).join(" ")]]);
    }

    // --- Projet ---
    let projet;
    if (peutModifier) {
      const metier = champTexte("co-projet-metier", "Métier visé", vide(f.projet_metier), { placeholder: "Ex. : auxiliaire de crèche" });
      const situation = champChoix("co-projet-situation", "Situation de l'élève", { "": "— Non renseignée —", ...LIBELLE_SITUATION }, f.projet_situation || "");
      const note = champTexte("co-projet-note", "Ce qui le motive, ses freins (visible par l'organisme)", vide(f.projet_note), { multiligne: true });
      projet = formulairePartie([metier.bloc, situation.bloc, note.bloc],
        () => ({ projet_metier: texte(metier), projet_situation: situation.champ.value || null, projet_note: texte(note) }));
    } else {
      projet = lecture([["Métier visé", f.projet_metier], ["Situation", f.projet_situation ? LIBELLE_SITUATION[f.projet_situation] : null], ["Motivation", f.projet_note]]);
    }

    // --- Organisation ---
    let organisation;
    if (peutModifier) {
      const heures = champTexte("co-orga-heures", "Heures par semaine", vide(f.orga_heures_semaine), { type: "number", inputmode: "numeric" });
      heures.champ.min = "0";
      heures.champ.max = "60";
      const finVisee = champTexte("co-orga-fin", "Fin de parcours visée", vide(f.orga_date_fin_visee), { type: "date" });
      const creneaux = champTexte("co-orga-creneaux", "Créneaux disponibles", vide(f.orga_creneaux), { placeholder: "Ex. : mardi et jeudi soir" });
      const objectif = champTexte("co-orga-objectif", "Objectif du mois", vide(f.orga_objectif), { placeholder: "Ex. : terminer les modules 4 et 5" });
      organisation = formulairePartie([h("div", { class: "deux-colonnes" }, heures.bloc, finVisee.bloc), creneaux.bloc, objectif.bloc],
        () => ({ orga_heures_semaine: heures.champ.value === "" ? null : Number(heures.champ.value), orga_date_fin_visee: finVisee.champ.value || null, orga_creneaux: texte(creneaux), orga_objectif: texte(objectif) }),
        () => {
          const n = heures.champ.value === "" ? null : Number(heures.champ.value);
          return n !== null && (!Number.isInteger(n) || n < 0 || n > 60) ? "Heures par semaine : un nombre entier entre 0 et 60." : null;
        });
    } else {
      organisation = lecture([["Objectif du mois", f.orga_objectif],
        ["Temps disponible", f.orga_heures_semaine !== null && f.orga_heures_semaine !== undefined ? `${f.orga_heures_semaine} h par semaine` : null],
        ["Créneaux", f.orga_creneaux], ["Fin visée", f.orga_date_fin_visee ? dateLisible(f.orga_date_fin_visee) : null]]);
    }

    const sousOnglets = barreOnglets("coaching", [
      ["stage", "Stage", stage],
      ["examen", "Examen", contenuExamen],
      ["projet", "Projet", projet],
      ["organisation", "Organisation", organisation],
    ], memo.partie, (cle) => { memo.partie = cle; majAdresse(); });

    return sousOnglets;
  }

  // ---------------------------------------------------------------------------
  // Déconnexion et démarrage
  // ---------------------------------------------------------------------------

  boutonDeconnexion.addEventListener("click", async () => {
    await sb.auth.signOut();
    zoneCompte.hidden = true;
    etat.profil = null;
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
