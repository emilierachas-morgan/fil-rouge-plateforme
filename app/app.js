// =============================================================================
// Fil Rouge Apprenants — application (étape 2 : connexion et rôles)
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

  const sb = window.supabase.createClient(config.supabaseUrl, config.supabaseCle, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

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
    const premierChamp = contenu.querySelector("input");
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
    if (brut.includes("rate") || erreur?.status === 429) {
      return "Trop de demandes en peu de temps. Patientez une minute, puis réessayez.";
    }
    if (brut.includes("expired") || brut.includes("invalid") || brut.includes("otp")) {
      return "Ce code n'est pas valable ou a expiré. Vérifiez les 6 chiffres, ou demandez un nouveau code.";
    }
    if (brut.includes("fetch") || brut.includes("network")) {
      return "Impossible de joindre le serveur. Vérifiez votre connexion internet.";
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
      return ecranEmail();
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
      return accueilAdmin(profil);
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
    const bouton = h("button", { class: "bouton", type: "submit" }, "Recevoir mon code");

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
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
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
          h("p", { class: "chapo" }, "Saisissez votre adresse email : vous recevrez un code à 6 chiffres pour vous connecter. Aucun mot de passe à retenir.")
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
    const renvoyer = h("button", { class: "bouton-lien", type: "button" }, "Renvoyer un code");
    const changer = h("button", { class: "bouton-lien", type: "button", onclick: () => ecranEmail() }, "Changer d'adresse");

    // Délai d'une minute avant de pouvoir redemander un code.
    let restant = 60;
    renvoyer.disabled = true;
    const minuteur = setInterval(() => {
      restant -= 1;
      renvoyer.textContent = restant > 0 ? `Renvoyer un code (${restant} s)` : "Renvoyer un code";
      if (restant <= 0) { renvoyer.disabled = false; clearInterval(minuteur); }
    }, 1000);

    renvoyer.addEventListener("click", async () => {
      renvoyer.disabled = true;
      const { error } = await sb.auth.signInWithOtp({ email: etat.email, options: { shouldCreateUser: false } });
      if (error && !/signups not allowed|otp_disabled/i.test(`${error.code} ${error.message}`)) {
        renvoyer.disabled = false;
        return signaler(zone, "erreur", texteErreur(error));
      }
      clearInterval(minuteur);
      ecranCodeEmail();
    });

    const formulaire = h("form", { novalidate: true },
      h("label", { for: "champ-code-email" }, "Code à 6 chiffres", champ),
      zone,
      bouton,
      h("div", { class: "actions-secondaires" }, renvoyer, changer)
    );

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
          h("h1", {}, "Saisissez votre code"),
          h("p", { class: "chapo" },
            `Si l'adresse ${etat.email} a un accès, un code à 6 chiffres vient de lui être envoyé. Il est valable une heure. Pensez à regarder dans les courriers indésirables.`)
        ),
        h("div", { class: "carte" }, formulaire)
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

  async function accueilAdmin(profil) {
    afficher(h("p", { class: "chargement" }, "Chargement du tableau de bord…"));

    const [apprenants, suivi] = await Promise.all([
      sb.from("vue_qui_rappeler").select("organisme_id, organisme_nom, alerte"),
      sb.from("organismes_suivi_commercial").select("etape"),
    ]);
    if (apprenants.error || suivi.error) {
      return afficher(message("erreur", texteErreur(apprenants.error || suivi.error)));
    }

    // Regroupement par organisme
    const parOrganisme = new Map();
    for (const l of apprenants.data) {
      if (!parOrganisme.has(l.organisme_id)) parOrganisme.set(l.organisme_id, { nom: l.organisme_nom, lignes: [] });
      parOrganisme.get(l.organisme_id).lignes.push(l);
    }

    const etapes = {};
    for (const s of suivi.data) etapes[s.etape] = (etapes[s.etape] || 0) + 1;

    const prenom = (profil.nom_affiche || "").split(" ")[0];

    afficher(
      h("div", { class: "pile" },
        h("div", {},
          h("p", { class: "surtitre" }, "Tableau de bord"),
          h("h1", {}, prenom ? `Bonjour ${prenom}` : "Bonjour"),
          h("p", { class: "chapo" }, "Vue d'ensemble de vos clients et de votre prospection.")
        ),
        h("p", { class: "bandeau-demo" }, "Données fictives de construction : aucun organisme ni apprenant réel."),
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
                    h("span", { class: "ligne-titre" }, o.nom),
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
            h("p", {}, pluriel(suivi.data.length, "organisme suivi", "organismes suivis"))),
          h("ul", { class: "liste" },
            Object.keys(LIBELLES_ETAPE).map((etape) =>
              h("li", { class: "ligne" },
                h("span", { class: "ligne-titre" }, LIBELLES_ETAPE[etape]),
                h("span", { class: "pastilles" }, pastille("neutre", String(etapes[etape] || 0))))))
        )
      )
    );
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
