# Plateforme Fil Rouge Apprenants

Outil de suivi anti-décrochage : le CRM d'Émilie, le suivi des apprenants de ses clients, et l'espace où chaque organisme client consulte ses apprenants et les notes d'appel.

Le cahier des charges complet est dans le document « Plateforme Fil Rouge — Cahier des charges ».

## Où on en est

| Étape | Contenu | État |
| --- | --- | --- |
| 1. La base | Tables, cloisonnement par organisme, données fictives, tests | Terminée |
| 2. La connexion | Code par email, rôles, double authentification administratrice | Terminée |
| 3. Prospects et clients | CRM commercial : liste, relances, fiche, historique des échanges | Terminée |
| 4. Import et liste | Import CSV avec correspondance des colonnes, « Qui rappeler en premier ? » | Terminée |
| 5. Jusqu'à l'examen | Date d'examen, présence, résultat ; relances J-30 / J-7 / J-1 ; taux par cohorte ; dossier de preuves Qualiopi | Terminée |
| 6. Fiche apprenant et appels | Fiche, « Noter un appel », note interne, historique, apprenant suivant | Terminée |
| 7. Comptes et portail client | Création des comptes clients et appelantes depuis l'onglet Accès, désactivation, apprenants confiés ; espace client en lecture seule avec exports | Terminée |
| 7. Sécurité et mise en ligne | Plan Pro, nom de domaine, hébergement | À faire |

## Contenu du dossier

```
supabase/
  migrations/
    20261014000001_schema.sql     Tables, types, automatismes, vue « Qui rappeler »
    20261014000002_securite.sql   Cloisonnement : qui voit et modifie quoi
    20261014000003_double_authentification.sql  Droits admin seulement avec le second facteur
    20261015000004_crm_prospection.sql  Historique des échanges, création et suppression sécurisées
    20261017000005_suivi_examen.sql     Examen (date, présence, résultat), relances J-30/J-7/J-1, taux par cohorte
    20261017000007_comptes.sql          je_suis_admin(), protection de son propre compte, apprenants confiés à une appelante active
    20261017000006_fiche_apprenant.sql  noter_appel() (appel + note interne en une fois), correction du dernier contact si un appel est supprimé
  seed.sql                        Données 100 % fictives (2 clients, 3 prospects, 20 apprenants)
functions/
    gerer-comptes/index.ts        Fonction serveur : création des comptes (seule à détenir la clé de service)
app/                              Le site (HTML + JavaScript, sans compilation)
  index.html, app.js, styles.css
  config.js                       Adresse du projet et clé publique (sans danger)
  _headers                        En-têtes de sécurité pour l'hébergeur
tests/
  00_simulation_supabase.sql      Recrée le minimum de Supabase pour tester en local
  10_tests_cloisonnement.sql      114 vérifications d'accès et de calcul
  lancer_tests.sh                 Lance tout dans une base jetable
  import.test.js                  17 tests de lecture des fichiers CSV (node tests/import.test.js)
```

## Les tables

| Table | Contenu | Qui la voit |
| --- | --- | --- |
| `organismes` | Nom et seuils d'alerte (vert / orange en jours) | Admin ; un client voit le sien |
| `organismes_suivi_commercial` | Étape commerciale, contact, relances, notes de prospection | Admin uniquement |
| `profils` | Rôle de chaque compte (admin, client, appelante), actif ou non | Admin ; chacun voit le sien |
| `apprenants` | Apprenants d'un organisme, date du dernier contact | Admin ; le client voit les siens ; l'appelante voit ceux qui lui sont confiés |
| `appels` | Note d'appel écrite pour le client | Admin ; le client lit les siennes ; l'appelante écrit les siennes |
| `notes_internes` | Ce qui ne doit pas remonter à l'organisme | Admin ; l'appelante pour ses propres appels. Jamais un client |
| `journal` | Qui a créé, modifié, supprimé quoi et quand | Admin uniquement, écrit automatiquement |
| `vue_qui_rappeler` | Apprenants actifs, jours sans contact, couleur | Selon les droits ci-dessus |
| `vue_relances_examen` | Examens à venir, étape J-30 / J-7 / J-1, relance faite ou non | Selon les droits ci-dessus |
| `vue_taux_examen` | Présents, absents, réussis et taux, par organisme et mois d'inscription | Selon les droits ci-dessus |

## Les automatismes

- Enregistrer un appel remet à zéro le compteur « jours sans contact » de l'apprenant.
- Un appel prend toujours l'organisme de son apprenant : impossible de le rattacher à un autre client.
- Chaque création, modification ou suppression est inscrite dans le journal, avec son auteur.
- Supprimer un organisme (fin de contrat) efface ses apprenants, ses appels et les accès de ses comptes.
- Les jours sont comptés à l'heure de Paris.

## Suivi jusqu'à l'examen (étape 5)

- **Onglet Examens** (administratrice) : relances à faire (J-30, J-7, J-1), examens passés à renseigner en un geste (présent / absent, puis réussi / échoué), taux par cohorte, examens à venir et passés, apprenants sans date. Le taux de présence avant Fil Rouge se saisit par client : c'est la base de l'option « résultat ».
- **Relance faite** : un contact noté dans la fenêtre de l'étape (30, 7 ou 1 jour avant l'examen) suffit.
- **Import** : trois nouvelles colonnes reconnues (date d'examen, présence, résultat). Une cellule vide n'efface jamais ce qui a été saisi dans la plateforme.
- **Dossier de preuves Qualiopi** (`#/preuves/<id>`, et `#/preuves` côté client) : synthèse, indicateur 12 (chaque contact daté, résultat, suite), indicateur 19 (avancement, connexion, dernier contact), présentation à l'examen, indicateur 27 (sous-traitance). Impression ou PDF depuis le navigateur, et deux exports pour Excel. Les notes internes n'y figurent jamais.

## Fiche apprenant (étape 6)

- **Accès** : en touchant un nom dans n'importe quelle liste (« Qui rappeler », Examens, espace client, espace appelante).
- **Noter un appel** (administratrice et appelante) : résultat en un geste, compte rendu pour l'organisme, note interne, suite prévue avec raccourcis. Les champs se pré-remplissent selon le résultat (ex. : message laissé → rappeler dans 2 jours). L'appel et la note interne s'enregistrent ensemble (`noter_appel`), sinon rien.
- **Apprenant suivant** : la fiche propose le suivant de la liste d'où l'on vient, pour enchaîner les appels.
- **Administratrice** : supprime un appel saisi par erreur (le dernier contact est recalculé), modifie l'examen et le statut.
- **Client** : lit la fiche et les comptes rendus, jamais les notes internes.

## Comptes (étape 7)

- **Onglet Accès** : créer le compte d'un client (rattaché à son organisme) ou d'une appelante. La plateforme prépare le message à envoyer, avec l'adresse du site. La personne se connecte ensuite avec son email.
- **Fonction serveur `gerer-comptes`** : seule à détenir la clé de service. Elle vérifie que la demande vient de l'administratrice avec la double authentification, refuse de créer un compte administratrice, et annule tout si l'enregistrement échoue. Déploiement : `supabase functions deploy gerer-comptes`.
- **Désactiver** coupe l'accès immédiatement sans rien effacer ; l'administratrice ne peut pas désactiver son propre compte.
- **Confier un apprenant** à une appelante active, depuis sa fiche.

## Lancer les tests

Prérequis : PostgreSQL 15 ou plus installé localement.

```bash
./tests/lancer_tests.sh
```

Le script crée une base jetable, charge la simulation Supabase, les deux migrations et les données fictives, puis vérifie 74 règles. Il s'arrête au premier échec. Les tests ont aussi été vérifiés « à l'envers » : en cassant volontairement une règle, ils échouent bien.

## Le site (étape 2)

Pas d'outil de compilation : trois fichiers que n'importe quel hébergeur de sites statiques sert tels quels.

- **Connexion** par lien reçu par email (ou code à 6 chiffres une fois l'envoi d'emails personnalisé en place, étape 7), sans mot de passe. Personne ne peut créer de compte seul : les comptes sont créés par l'administratrice.
- **Double authentification** obligatoire pour l'administratrice (application d'authentification sur téléphone). Sans elle, la base ne lui donne aucune donnée (règle testée).
- **Accueil selon le rôle** : tableau de bord pour l'administratrice, liste de ses apprenants pour un client, liste des apprenants confiés pour une appelante.

Mise en ligne : GitHub Pages (`.github/workflows/pages.yml`). Chaque envoi sur la branche `main` publie le dossier `app` automatiquement sur https://emilierachas-morgan.github.io/fil-rouge-plateforme/. Le fichier `netlify.toml` permet aussi un hébergement Netlify si besoin.

## Projet Supabase

Projet `fil-rouge-apprenants`, région Paris (eu-west-3). Il ne contient que des données fictives : c'est l'espace de construction.

## Installer sur un autre projet Supabase

1. Créer un projet Supabase en **région Paris**.
2. Installer la ligne de commande Supabase, puis relier le projet : `supabase link`.
3. Envoyer le schéma : `supabase db push`.
4. Ne **jamais** charger `seed.sql` sur la base qui contiendra de vraies données.

Le fichier `tests/00_simulation_supabase.sql` ne sert qu'aux tests locaux : Supabase fournit déjà tout ce qu'il contient.

## Règles à garder

- Aucune donnée réelle avant la signature d'un contrat de sous-traitance RGPD avec le client.
- Notes d'appel factuelles ; ce qui est personnel va dans la note interne.
- Toute nouvelle table : activer le cloisonnement (`enable row level security`) et ajouter ses tests.
