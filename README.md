# Plateforme Fil Rouge Apprenants

Outil de suivi anti-décrochage : le CRM d'Émilie, le suivi des apprenants de ses clients, et l'espace où chaque organisme client consulte ses apprenants et les notes d'appel.

Le cahier des charges complet est dans le document « Plateforme Fil Rouge — Cahier des charges ».

## Où on en est

| Étape | Contenu | État |
| --- | --- | --- |
| 1. La base | Tables, cloisonnement par organisme, données fictives, tests | Terminée |
| 2. La connexion | Code par email, rôles, double authentification administratrice | Terminée |
| 3. Prospects et clients | CRM commercial | À faire |
| 4. Import et liste | Import CSV, « Qui rappeler en premier ? » | À faire |
| 5. Fiche apprenant et appels | Historique, « Noter un appel » | À faire |
| 6. Portail client | Lecture seule, export CSV | À faire |
| 7. Sécurité et mise en ligne | Plan Pro, nom de domaine, hébergement | À faire |

## Contenu du dossier

```
supabase/
  migrations/
    20261014000001_schema.sql     Tables, types, automatismes, vue « Qui rappeler »
    20261014000002_securite.sql   Cloisonnement : qui voit et modifie quoi
    20261014000003_double_authentification.sql  Droits admin seulement avec le second facteur
  seed.sql                        Données 100 % fictives (2 clients, 3 prospects, 20 apprenants)
app/                              Le site (HTML + JavaScript, sans compilation)
  index.html, app.js, styles.css
  config.js                       Adresse du projet et clé publique (sans danger)
  _headers                        En-têtes de sécurité pour l'hébergeur
tests/
  00_simulation_supabase.sql      Recrée le minimum de Supabase pour tester en local
  10_tests_cloisonnement.sql      57 vérifications d'accès
  lancer_tests.sh                 Lance tout dans une base jetable
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

## Les automatismes

- Enregistrer un appel remet à zéro le compteur « jours sans contact » de l'apprenant.
- Un appel prend toujours l'organisme de son apprenant : impossible de le rattacher à un autre client.
- Chaque création, modification ou suppression est inscrite dans le journal, avec son auteur.
- Supprimer un organisme (fin de contrat) efface ses apprenants, ses appels et les accès de ses comptes.
- Les jours sont comptés à l'heure de Paris.

## Lancer les tests

Prérequis : PostgreSQL 15 ou plus installé localement.

```bash
./tests/lancer_tests.sh
```

Le script crée une base jetable, charge la simulation Supabase, les deux migrations et les données fictives, puis vérifie 57 règles. Il s'arrête au premier échec. Les tests ont aussi été vérifiés « à l'envers » : en cassant volontairement une règle, ils échouent bien.

## Le site (étape 2)

Pas d'outil de compilation : trois fichiers que n'importe quel hébergeur de sites statiques sert tels quels.

- **Connexion** par code à 6 chiffres reçu par email, sans mot de passe. Personne ne peut créer de compte seul : les comptes sont créés par l'administratrice.
- **Double authentification** obligatoire pour l'administratrice (application d'authentification sur téléphone). Sans elle, la base ne lui donne aucune donnée (règle testée).
- **Accueil selon le rôle** : tableau de bord pour l'administratrice, liste de ses apprenants pour un client, liste des apprenants confiés pour une appelante.

Mettre en ligne : déposer le dossier `app` sur Netlify Drop (https://app.netlify.com/drop), puis rattacher le site à un compte Netlify gratuit pour le garder.

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
