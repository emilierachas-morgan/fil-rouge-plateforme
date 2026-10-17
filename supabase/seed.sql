-- =============================================================================
-- Fil Rouge Apprenants — données fictives pour la construction
-- =============================================================================
-- TOUT EST INVENTÉ : organismes, apprenants, téléphones, notes.
-- Ces données servent à construire et tester les écrans.
-- Elles ne doivent jamais être chargées dans la base de production.
--
-- Les dates sont calculées à partir d'aujourd'hui : les couleurs d'alerte
-- restent parlantes quel que soit le jour où la base est rechargée.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Organismes : 2 clients fictifs + 3 prospects fictifs
-- -----------------------------------------------------------------------------

insert into public.organismes (id, nom, seuil_vert_jours, seuil_orange_jours) values
  ('a0000000-0000-4000-8000-000000000001', 'Académie Horizon (fictif)', 7, 14),
  ('b0000000-0000-4000-8000-000000000002', 'Institut Boréal (fictif)',  5, 10),
  ('c0000000-0000-4000-8000-000000000003', 'École Méridienne (fictif)', 7, 14),
  ('c0000000-0000-4000-8000-000000000004', 'Campus Alizé (fictif)',     7, 14),
  ('c0000000-0000-4000-8000-000000000005', 'Formations Archipel (fictif)', 7, 14);

insert into public.organismes_suivi_commercial
  (organisme_id, contact_nom, contact_fonction, contact_email, etape, prochaine_relance, formule, date_debut_contrat, notes)
values
  ('a0000000-0000-4000-8000-000000000001', 'Claire Fictive', 'Directrice pédagogique', 'claire@horizon.example',
   'client', prive.aujourdhui() + 30, '30', prive.aujourdhui() - 45,
   'Client depuis le test gratuit. Export CSV chaque lundi.'),
  ('b0000000-0000-4000-8000-000000000002', 'Marc Exemple', 'Responsable qualité', 'marc@boreal.example',
   'test_gratuit', prive.aujourdhui() + 2, null, null,
   'A envoyé 10 lignes anonymisées. Restitution prévue.'),
  ('c0000000-0000-4000-8000-000000000003', 'Sophie Démo', 'Directrice générale', 'sophie@meridienne.example',
   'contacte', prive.aujourdhui() + 5, null, null,
   'Email n°1 envoyé. Relance « Question directe » à J+7.'),
  ('c0000000-0000-4000-8000-000000000004', null, null, null,
   'prospect', prive.aujourdhui() + 1, null, null,
   'Trouver la direction pédagogique sur LinkedIn.'),
  ('c0000000-0000-4000-8000-000000000005', 'Paul Essai', 'Fondateur', 'paul@archipel.example',
   'perdu', null, null, null,
   'Pas de budget cette année. Recontacter en septembre prochain.');

-- -----------------------------------------------------------------------------
-- Apprenants : 12 chez Académie Horizon, 8 chez Institut Boréal
-- -----------------------------------------------------------------------------

insert into public.apprenants
  (id, organisme_id, identifiant_externe, prenom, nom, telephone, email, parcours,
   date_inscription, avancement_pct, derniere_connexion, statut)
values
  -- Académie Horizon
  ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'AH-001', 'Julie',   'Martin',   '06 00 00 00 01', 'julie.m@exemple.test',   'Titre pro Secrétaire assistant(e)', prive.aujourdhui() - 60, 12, prive.aujourdhui() - 21, 'actif'),
  ('a1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'AH-002', 'Karim',   'Benali',   '06 00 00 00 02', 'karim.b@exemple.test',   'Titre pro Secrétaire assistant(e)', prive.aujourdhui() - 90, 48, prive.aujourdhui() - 2,  'actif'),
  ('a1000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'AH-003', 'Sandrine','Lefèvre',  '06 00 00 00 03', 'sandrine.l@exemple.test','Titre pro Comptable assistant(e)',  prive.aujourdhui() - 40, 25, prive.aujourdhui() - 11, 'actif'),
  ('a1000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'AH-004', 'Thomas',  'Girard',   '06 00 00 00 04', 'thomas.g@exemple.test',  'Titre pro Comptable assistant(e)',  prive.aujourdhui() - 30, 8,  prive.aujourdhui() - 18, 'actif'),
  ('a1000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'AH-005', 'Nadia',   'Haddad',   '06 00 00 00 05', 'nadia.h@exemple.test',   'BTS Gestion de la PME',             prive.aujourdhui() - 120, 67, prive.aujourdhui() - 1, 'actif'),
  ('a1000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', 'AH-006', 'Lucas',   'Moreau',   '06 00 00 00 06', 'lucas.m@exemple.test',   'BTS Gestion de la PME',             prive.aujourdhui() - 75, 33, prive.aujourdhui() - 9,  'actif'),
  ('a1000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001', 'AH-007', 'Émilie',  'Roux',     '06 00 00 00 07', 'emilie.r@exemple.test',  'Titre pro Secrétaire assistant(e)', prive.aujourdhui() - 20, 5,  prive.aujourdhui() - 20, 'actif'),
  ('a1000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000001', 'AH-008', 'Yanis',   'Fontaine', '06 00 00 00 08', 'yanis.f@exemple.test',   'Titre pro Comptable assistant(e)',  prive.aujourdhui() - 150, 100, prive.aujourdhui() - 5, 'termine'),
  ('a1000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000001', 'AH-009', 'Chloé',   'Perrin',   '06 00 00 00 09', 'chloe.p@exemple.test',   'BTS Gestion de la PME',             prive.aujourdhui() - 50, 19, prive.aujourdhui() - 26, 'actif'),
  ('a1000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000001', 'AH-010', 'Mehdi',   'Saidi',    '06 00 00 00 10', 'mehdi.s@exemple.test',   'Titre pro Secrétaire assistant(e)', prive.aujourdhui() - 35, 41, prive.aujourdhui() - 3,  'actif'),
  ('a1000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001', 'AH-011', 'Laura',   'Blanc',    '06 00 00 00 11', 'laura.b@exemple.test',   'Titre pro Comptable assistant(e)',  prive.aujourdhui() - 100, 22, prive.aujourdhui() - 40, 'abandon'),
  ('a1000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000001', 'AH-012', 'Hugo',    'Lambert',  '06 00 00 00 12', 'hugo.l@exemple.test',    'BTS Gestion de la PME',             prive.aujourdhui() - 4,  2,  prive.aujourdhui() - 1,  'actif'),
  -- Institut Boréal
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'IB-101', 'Inès',    'Charpentier','06 00 00 00 21', 'ines.c@exemple.test',  'CAP Accompagnant éducatif petite enfance', prive.aujourdhui() - 45, 30, prive.aujourdhui() - 12, 'actif'),
  ('b1000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'IB-102', 'Rachid',  'Ouali',      '06 00 00 00 22', 'rachid.o@exemple.test','CAP Accompagnant éducatif petite enfance', prive.aujourdhui() - 70, 55, prive.aujourdhui() - 4,  'actif'),
  ('b1000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 'IB-103', 'Camille', 'Dupuis',     '06 00 00 00 23', 'camille.d@exemple.test','Titre pro Assistant(e) de vie aux familles', prive.aujourdhui() - 25, 10, prive.aujourdhui() - 15, 'actif'),
  ('b1000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000002', 'IB-104', 'Jordan',  'Michel',     '06 00 00 00 24', 'jordan.m@exemple.test','Titre pro Assistant(e) de vie aux familles', prive.aujourdhui() - 80, 62, prive.aujourdhui() - 2,  'actif'),
  ('b1000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000002', 'IB-105', 'Aurélie', 'Vidal',      '06 00 00 00 25', 'aurelie.v@exemple.test','CAP Accompagnant éducatif petite enfance', prive.aujourdhui() - 55, 15, prive.aujourdhui() - 30, 'actif'),
  ('b1000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000002', 'IB-106', 'Samuel',  'Garnier',    '06 00 00 00 26', 'samuel.g@exemple.test','Titre pro Assistant(e) de vie aux familles', prive.aujourdhui() - 10, 6,  prive.aujourdhui() - 6,  'actif'),
  ('b1000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000002', 'IB-107', 'Fatou',   'Diallo',     '06 00 00 00 27', 'fatou.d@exemple.test', 'CAP Accompagnant éducatif petite enfance', prive.aujourdhui() - 65, 38, prive.aujourdhui() - 8,  'actif'),
  ('b1000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000002', 'IB-108', 'Antoine', 'Roussel',    '06 00 00 00 28', 'antoine.r@exemple.test','Titre pro Assistant(e) de vie aux familles', prive.aujourdhui() - 95, 71, prive.aujourdhui() - 3,  'actif');

-- -----------------------------------------------------------------------------
-- Appels passés (la date du dernier contact se met à jour toute seule)
-- -----------------------------------------------------------------------------

insert into public.appels
  (id, apprenant_id, date_appel, canal, resultat, note_client, prochaine_action, date_prochaine_action)
values
  -- Académie Horizon
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', now() - interval '23 days', 'telephone', 'messagerie',
   'Message laissé, sans retour pour l''instant.', 'Rappeler en fin de journée', prive.aujourdhui() - 20),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', now() - interval '3 days',  'telephone', 'joint',
   'Échange positif. Avance bien, objectif module 5 d''ici deux semaines.', 'Point d''étape', prive.aujourdhui() + 11),
  ('a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003', now() - interval '10 days', 'telephone', 'joint',
   'Difficultés personnelles passagères. Reprise prévue la semaine prochaine.', 'Vérifier la reprise', prive.aujourdhui() + 1),
  ('a2000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000004', now() - interval '16 days', 'sms', 'injoignable',
   'SMS envoyé, pas de réponse.', 'Appel téléphonique', prive.aujourdhui() - 9),
  ('a2000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000005', now() - interval '2 days',  'telephone', 'joint',
   'Très motivée. Demande des conseils pour préparer l''examen.', 'Envoyer la fiche méthode', prive.aujourdhui() + 3),
  ('a2000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000006', now() - interval '9 days',  'email', 'joint',
   'A répondu par email : bloqué sur le module comptabilité. Mis en relation avec le formateur.', 'Rappel de suivi', prive.aujourdhui() + 2),
  ('a2000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000010', now() - interval '1 day',   'telephone', 'joint',
   'Rythme régulier, aucun signal d''alerte.', 'Point mensuel', prive.aujourdhui() + 29),
  ('a2000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000011', now() - interval '41 days', 'telephone', 'refuse_suivi',
   'Ne souhaite plus poursuivre la formation. Abandon confirmé.', null, null),
  -- Institut Boréal
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', now() - interval '8 days',  'telephone', 'joint',
   'Organisation à revoir avec la reprise du travail. Nouveau planning convenu.', 'Vérifier le planning', prive.aujourdhui() + 6),
  ('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', now() - interval '4 days',  'telephone', 'joint',
   'Tout va bien, stage trouvé.', 'Point mensuel', prive.aujourdhui() + 26),
  ('b2000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000003', now() - interval '13 days', 'telephone', 'messagerie',
   'Message laissé.', 'Rappeler', prive.aujourdhui() - 6),
  ('b2000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000005', now() - interval '28 days', 'sms', 'injoignable',
   'SMS sans réponse.', 'Appel téléphonique', prive.aujourdhui() - 21),
  ('b2000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000008', now() - interval '3 days',  'telephone', 'joint',
   'Prépare son dossier professionnel, aucun frein.', 'Point mensuel', prive.aujourdhui() + 27);

-- -----------------------------------------------------------------------------
-- Notes internes (jamais visibles par le client)
-- -----------------------------------------------------------------------------

insert into public.notes_internes (appel_id, contenu) values
  ('a2000000-0000-4000-8000-000000000003', 'Séparation récente, déménagement en cours. Ne pas mentionner à l''organisme.'),
  ('a2000000-0000-4000-8000-000000000006', 'Se sent dépassé, a besoin d''être rassuré. Ton encourageant au prochain appel.'),
  ('b2000000-0000-4000-8000-000000000001', 'Garde des enfants compliquée le mercredi : appeler le mardi ou le jeudi.');

-- -----------------------------------------------------------------------------
-- Historique des échanges commerciaux (fictif)
-- -----------------------------------------------------------------------------

insert into public.echanges_commerciaux (organisme_id, date_echange, canal, resume) values
  ('a0000000-0000-4000-8000-000000000001', prive.aujourdhui() - 60, 'email',     'Email n°1 envoyé : test gratuit sur leurs données.'),
  ('a0000000-0000-4000-8000-000000000001', prive.aujourdhui() - 55, 'telephone', 'Appel de découverte : 30 apprenants, aucun suivi entre les modules.'),
  ('a0000000-0000-4000-8000-000000000001', prive.aujourdhui() - 45, 'visio',     'Restitution du test gratuit. Abonnement 30 apprenants signé.'),
  ('b0000000-0000-4000-8000-000000000002', prive.aujourdhui() - 6,  'email',     'Réponse positive à l''email n°1. Export de 10 lignes reçu.'),
  ('c0000000-0000-4000-8000-000000000003', prive.aujourdhui() - 2,  'email',     'Email n°1 envoyé.'),
  ('c0000000-0000-4000-8000-000000000005', prive.aujourdhui() - 20, 'telephone', 'Pas de budget cette année.');

-- -----------------------------------------------------------------------------
-- Examens (étape 5) — fictifs, dates calculées à partir d'aujourd'hui
-- -----------------------------------------------------------------------------

update public.organismes set taux_presence_depart = 70 where id = 'a0000000-0000-4000-8000-000000000001';
update public.organismes set taux_presence_depart = 75 where id = 'b0000000-0000-4000-8000-000000000002';

update public.apprenants as a set
  date_examen = prive.aujourdhui() + e.decalage,
  presence_examen = e.presence::public.presence_examen,
  resultat_examen = e.resultat::public.resultat_examen
from (values
  -- Académie Horizon
  ('AH-010',   1, null,      null),      -- examen demain : relance J-1
  ('AH-002',   6, null,      null),      -- dans 6 jours : relance J-7
  ('AH-005',  25, null,      null),      -- dans 25 jours : relance J-30 (déjà faite)
  ('AH-003',  -3, null,      null),      -- passé, présence à renseigner
  ('AH-006', -10, 'absent',  null),
  ('AH-008', -20, 'present', 'reussi'),
  -- Institut Boréal
  ('IB-102',  12, null,      null),
  ('IB-104', -15, 'present', 'echoue'),
  ('IB-108', -15, 'present', 'reussi')
) as e (identifiant, decalage, presence, resultat)
where a.identifiant_externe = e.identifiant;
