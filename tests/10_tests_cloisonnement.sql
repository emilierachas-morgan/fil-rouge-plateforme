-- =============================================================================
-- Tests du cloisonnement — Fil Rouge Apprenants
-- =============================================================================
-- Chaque test se connecte « comme » une personne (administratrice, client A,
-- client B, appelante, compte désactivé, visiteur anonyme) et vérifie ce
-- qu'elle peut voir et faire. Le premier test qui échoue arrête tout.
--
-- Lancement : ./tests/lancer_tests.sh
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

-- -----------------------------------------------------------------------------
-- Outils de test
-- -----------------------------------------------------------------------------

create schema tests;
grant usage on schema tests to anon, authenticated;

-- Vérifie une condition ; affiche OK ou arrête tout.
create function tests.verifier(condition boolean, libelle text)
returns void language plpgsql as $$
begin
  if condition is distinct from true then
    raise exception 'ÉCHEC : %', libelle;
  end if;
  raise notice 'OK   %', libelle;
end $$;

-- Vérifie qu'une instruction est refusée par la base.
create function tests.doit_etre_refuse(instruction text, libelle text)
returns void language plpgsql as $$
begin
  begin
    execute instruction;
  exception when others then
    raise notice 'OK   % (refusé : %)', libelle, sqlerrm;
    return;
  end;
  raise exception 'ÉCHEC : % — l''instruction a été acceptée', libelle;
end $$;

-- Nombre de lignes réellement touchées par une modification.
create function tests.lignes_touchees(instruction text)
returns integer language plpgsql as $$
declare n integer;
begin
  execute instruction;
  get diagnostics n = row_count;
  return n;
end $$;

-- Ouvre une session au nom d'une personne (comme le ferait Supabase).
-- niveau : 'aal1' (email seul) ou 'aal2' (email + application d'authentification).
create function tests.session(utilisateur uuid, niveau text default 'aal1')
returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', utilisateur, 'role', 'authenticated', 'aal', niveau)::text, true);
$$;

grant execute on all functions in schema tests to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Comptes de test
-- -----------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'admin@test.example'),
  ('22222222-2222-4222-8222-222222222222', 'client.horizon@test.example'),
  ('33333333-3333-4333-8333-333333333333', 'client.boreal@test.example'),
  ('44444444-4444-4444-8444-444444444444', 'appelante@test.example'),
  ('55555555-5555-4555-8555-555555555555', 'ancien.client@test.example');

insert into public.profils (id, email, nom_affiche, role, organisme_id, actif) values
  ('11111111-1111-4111-8111-111111111111', 'admin@test.example',          'Émilie (test)',      'admin',     null, true),
  ('22222222-2222-4222-8222-222222222222', 'client.horizon@test.example', 'Client Horizon',     'client',    'a0000000-0000-4000-8000-000000000001', true),
  ('33333333-3333-4333-8333-333333333333', 'client.boreal@test.example',  'Client Boréal',      'client',    'b0000000-0000-4000-8000-000000000002', true),
  ('44444444-4444-4444-8444-444444444444', 'appelante@test.example',      'Appelante (test)',   'appelante', null, true),
  ('55555555-5555-4555-8555-555555555555', 'ancien.client@test.example',  'Ancien client',      'client',    'a0000000-0000-4000-8000-000000000001', false);

-- L'appelante reçoit trois apprenants d'Académie Horizon.
update public.apprenants set appelante_id = '44444444-4444-4444-8444-444444444444'
where identifiant_externe in ('AH-001', 'AH-003', 'AH-004');

\echo
\echo '\n== 1. Données fictives et couleurs d''alerte'

select tests.verifier((select count(*) from public.organismes) = 5, '5 organismes fictifs');
select tests.verifier((select count(*) from public.apprenants) = 20, '20 apprenants fictifs');
select tests.verifier(
  (select count(*) from public.vue_qui_rappeler where organisme_id = 'a0000000-0000-4000-8000-000000000001') = 10,
  'Horizon : 10 apprenants actifs dans « Qui rappeler » (terminés et abandons exclus)');
select tests.verifier(
  (select string_agg(alerte || '=' || n, ' ' order by alerte) from (
     select alerte, count(*) n from public.vue_qui_rappeler
     where organisme_id = 'a0000000-0000-4000-8000-000000000001' group by alerte) t)
  = 'orange=2 rouge=4 vert=4',
  'Horizon (seuils 7/14 j) : 4 vert, 2 orange, 4 rouge');
select tests.verifier(
  (select string_agg(alerte || '=' || n, ' ' order by alerte) from (
     select alerte, count(*) n from public.vue_qui_rappeler
     where organisme_id = 'b0000000-0000-4000-8000-000000000002' group by alerte) t)
  = 'orange=2 rouge=4 vert=2',
  'Boréal (seuils 5/10 j) : 2 vert, 2 orange, 4 rouge');
select tests.verifier(
  (select jours_sans_contact from public.vue_qui_rappeler where identifiant_externe = 'AH-001') = 23,
  'Julie (AH-001) : 23 jours sans contact');

\echo
\echo '\n== 2. Client Horizon'

begin;
select tests.session('22222222-2222-4222-8222-222222222222');
set local role authenticated;

select tests.verifier((select count(*) from public.apprenants) = 12, 'voit ses 12 apprenants');
select tests.verifier(
  (select count(*) from public.apprenants where organisme_id <> 'a0000000-0000-4000-8000-000000000001') = 0,
  'ne voit aucun apprenant d''un autre organisme');
select tests.verifier(
  (select count(*) from public.apprenants where id = 'b1000000-0000-4000-8000-000000000001') = 0,
  'ne voit pas un apprenant de Boréal même en le demandant par son identifiant');
select tests.verifier((select count(*) from public.organismes) = 1, 'ne voit que son propre organisme');
select tests.verifier((select count(*) from public.vue_qui_rappeler) = 10, '« Qui rappeler » limité à ses 10 apprenants actifs');
select tests.verifier((select count(*) from public.appels) = 8, 'voit les 8 notes d''appel de ses apprenants');
select tests.verifier((select count(*) from public.notes_internes) = 0, 'ne voit AUCUNE note interne');
select tests.verifier((select count(*) from public.organismes_suivi_commercial) = 0, 'ne voit pas le suivi commercial');
select tests.verifier((select count(*) from public.journal) = 0, 'ne voit pas le journal');
select tests.verifier((select count(*) from public.profils) = 1, 'ne voit que son propre profil');

select tests.doit_etre_refuse(
  $$insert into public.apprenants (organisme_id, prenom) values ('a0000000-0000-4000-8000-000000000001', 'Intrus')$$,
  'ne peut pas créer d''apprenant');
select tests.doit_etre_refuse(
  $$insert into public.appels (apprenant_id, resultat, note_client) values ('a1000000-0000-4000-8000-000000000002', 'joint', 'faux')$$,
  'ne peut pas écrire de note d''appel');
select tests.verifier(
  tests.lignes_touchees($$update public.apprenants set prenom = 'Modifié' where organisme_id = 'a0000000-0000-4000-8000-000000000001'$$) = 0,
  'ne peut pas modifier ses apprenants (lecture seule)');
select tests.verifier(
  tests.lignes_touchees($$delete from public.appels$$) = 0,
  'ne peut pas supprimer de note d''appel');
select tests.verifier(
  tests.lignes_touchees($$update public.profils set role = 'admin' where id = '22222222-2222-4222-8222-222222222222'$$) = 0,
  'ne peut pas se donner le rôle administratrice');
select tests.verifier(
  tests.lignes_touchees($$update public.profils set organisme_id = 'b0000000-0000-4000-8000-000000000002' where id = '22222222-2222-4222-8222-222222222222'$$) = 0,
  'ne peut pas se rattacher à un autre organisme');
select tests.verifier(
  tests.lignes_touchees($$update public.organismes set seuil_vert_jours = 30$$) = 0,
  'ne peut pas changer ses seuils d''alerte');
rollback;

\echo
\echo '\n== 3. Client Boréal'

begin;
select tests.session('33333333-3333-4333-8333-333333333333');
set local role authenticated;
select tests.verifier((select count(*) from public.apprenants) = 8, 'voit ses 8 apprenants');
select tests.verifier((select count(*) from public.appels) = 5, 'voit ses 5 notes d''appel');
select tests.verifier(
  (select count(*) from public.appels where organisme_id = 'a0000000-0000-4000-8000-000000000001') = 0,
  'ne voit aucune note d''appel d''Horizon');
select tests.verifier((select count(*) from public.notes_internes) = 0, 'ne voit aucune note interne, même les siennes');
rollback;

\echo
\echo '\n== 4. Appelante'

begin;
select tests.session('44444444-4444-4444-8444-444444444444');
set local role authenticated;
select tests.verifier((select count(*) from public.apprenants) = 3, 'voit uniquement ses 3 apprenants confiés');
select tests.verifier((select count(*) from public.organismes) = 1, 'voit le nom de l''organisme concerné, pas les autres');
select tests.verifier((select count(*) from public.organismes_suivi_commercial) = 0, 'ne voit pas le suivi commercial');
select tests.verifier((select count(*) from public.notes_internes) = 0, 'ne voit pas les notes internes écrites par d''autres');

insert into public.appels (id, apprenant_id, auteur_id, canal, resultat, note_client, prochaine_action, date_prochaine_action)
values ('d2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
        '44444444-4444-4444-8444-444444444444', 'telephone', 'joint',
        'Julie a repris contact, nouveau planning fixé.', 'Point dans une semaine', prive.aujourdhui() + 7);
select tests.verifier(true, 'peut noter un appel pour une apprenante confiée');

insert into public.notes_internes (appel_id, contenu)
values ('d2000000-0000-4000-8000-000000000001', 'Fatiguée, horaires de travail décalés.');
select tests.verifier((select count(*) from public.notes_internes) = 1, 'peut écrire et relire la note interne de son propre appel');

select tests.verifier(
  (select jours_sans_contact = 0 and alerte = 'vert' from public.vue_qui_rappeler where identifiant_externe = 'AH-001'),
  'après l''appel, Julie repasse à 0 jour et en vert');

select tests.doit_etre_refuse(
  $$insert into public.appels (apprenant_id, auteur_id, resultat) values ('a1000000-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'joint')$$,
  'ne peut pas noter un appel pour un apprenant non confié');
select tests.doit_etre_refuse(
  $$insert into public.appels (apprenant_id, auteur_id, resultat) values ('a1000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'joint')$$,
  'ne peut pas signer un appel au nom de quelqu''un d''autre');
select tests.doit_etre_refuse(
  $$insert into public.notes_internes (appel_id, contenu) values ('a2000000-0000-4000-8000-000000000004', 'intrusion')$$,
  'ne peut pas ajouter de note interne à l''appel d''une autre personne');
select tests.verifier(
  tests.lignes_touchees($$update public.apprenants set appelante_id = null$$) = 0,
  'ne peut pas modifier la fiche d''un apprenant');
rollback;

\echo
\echo '\n== 5. Administratrice'

begin;
select tests.session('11111111-1111-4111-8111-111111111111', 'aal1');
set local role authenticated;
select tests.verifier((select count(*) from public.apprenants) = 0,
  'sans double authentification, l''administratrice ne voit AUCUN apprenant');
select tests.verifier((select count(*) from public.organismes_suivi_commercial) = 0,
  'sans double authentification, pas d''accès au suivi commercial');
select tests.verifier((select count(*) from public.profils) = 1,
  'sans double authentification, elle voit seulement son profil (pour être guidée vers le second facteur)');
select tests.doit_etre_refuse(
  $$insert into public.organismes (nom) values ('Intrus')$$,
  'sans double authentification, elle ne peut rien créer');
rollback;

begin;
select tests.session('11111111-1111-4111-8111-111111111111', 'aal2');
set local role authenticated;
select tests.verifier((select count(*) from public.apprenants) = 20, 'avec double authentification : voit les 20 apprenants');
select tests.verifier((select count(*) from public.notes_internes) = 3, 'voit les 3 notes internes');
select tests.verifier((select count(*) from public.organismes_suivi_commercial) = 5, 'voit son suivi commercial (5 organismes)');
select tests.verifier(
  (select count(*) from public.organismes_suivi_commercial where etape = 'client') = 1,
  'retrouve son client par étape commerciale');

insert into public.appels (id, apprenant_id, auteur_id, resultat, note_client)
values ('e2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002',
        '11111111-1111-4111-8111-111111111111', 'joint', 'Test de traçabilité');
select tests.verifier(
  (select count(*) from public.journal
   where table_nom = 'appels' and action = 'INSERT'
     and utilisateur_id = '11111111-1111-4111-8111-111111111111') = 1,
  'chaque appel enregistré laisse une trace dans le journal, avec son auteur');

-- Tentative de rattacher un appel au mauvais organisme : la base corrige.
insert into public.appels (id, apprenant_id, organisme_id, auteur_id, resultat, note_client)
values ('e2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002',
        'b0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'joint', 'Organisme falsifié');
select tests.verifier(
  (select organisme_id from public.appels where id = 'e2000000-0000-4000-8000-000000000002')
    = 'a0000000-0000-4000-8000-000000000001',
  'un appel prend toujours l''organisme de son apprenant, impossible de le falsifier');

select tests.doit_etre_refuse(
  $$insert into public.journal (action, table_nom) values ('INSERT', 'faux')$$,
  'personne, pas même l''administratrice, ne peut écrire à la main dans le journal');
select tests.doit_etre_refuse(
  $$update public.organismes set seuil_orange_jours = 3 where id = 'a0000000-0000-4000-8000-000000000001'$$,
  'des seuils incohérents (orange avant vert) sont refusés');
rollback;

\echo
\echo '\n== 6. Compte désactivé'

begin;
select tests.session('55555555-5555-4555-8555-555555555555');
set local role authenticated;
select tests.verifier((select count(*) from public.apprenants) = 0, 'un compte désactivé ne voit plus aucun apprenant');
select tests.verifier((select count(*) from public.appels) = 0, 'un compte désactivé ne voit plus aucune note');
rollback;

\echo
\echo '\n== 7. Compte inconnu et visiteur non connecté'

begin;
select tests.session('99999999-9999-4999-8999-999999999999');
set local role authenticated;
select tests.verifier((select count(*) from public.apprenants) = 0, 'un compte sans profil ne voit rien');
rollback;

begin;
set local role anon;
select tests.doit_etre_refuse($$select * from public.apprenants$$, 'un visiteur non connecté n''accède pas aux apprenants');
select tests.doit_etre_refuse($$select * from public.vue_qui_rappeler$$, 'un visiteur non connecté n''accède pas à « Qui rappeler »');
select tests.doit_etre_refuse($$select * from public.notes_internes$$, 'un visiteur non connecté n''accède pas aux notes internes');
rollback;

\echo
\echo '\n== 8. Suppression d''un organisme (fin de contrat)'

begin;
delete from public.organismes where id = 'b0000000-0000-4000-8000-000000000002';
select tests.verifier(
  (select count(*) from public.apprenants where organisme_id = 'b0000000-0000-4000-8000-000000000002') = 0
  and (select count(*) from public.appels where organisme_id = 'b0000000-0000-4000-8000-000000000002') = 0
  and (select count(*) from public.profils where organisme_id = 'b0000000-0000-4000-8000-000000000002') = 0,
  'supprimer un organisme efface ses apprenants, ses appels et les accès de ses comptes');
rollback;

\echo '\n== 9. CRM de prospection (étape 3)'

begin;
select tests.session('11111111-1111-4111-8111-111111111111', 'aal2');
set local role authenticated;
select tests.verifier((select count(*) from public.echanges_commerciaux) = 6, 'administratrice : voit les 6 échanges commerciaux');
select tests.verifier(
  public.creer_organisme('Organisme test', 'contacte', 'Jean Test', 'Directeur', 'jean@test.example', null, prive.aujourdhui() + 3, 'Note') is not null,
  'administratrice : crée un organisme et sa fiche commerciale en une fois');
select tests.verifier(
  (select etape = 'contacte' and contact_nom = 'Jean Test'
   from public.organismes_suivi_commercial s join public.organismes o on o.id = s.organisme_id
   where o.nom = 'Organisme test'),
  'la fiche commerciale du nouvel organisme est bien remplie');
select tests.doit_etre_refuse(
  $$select public.supprimer_prospect('a0000000-0000-4000-8000-000000000001')$$,
  'impossible de supprimer un organisme qui a des apprenants');
select public.supprimer_prospect('c0000000-0000-4000-8000-000000000004');
select tests.verifier(
  (select count(*) from public.organismes where id = 'c0000000-0000-4000-8000-000000000004') = 0,
  'un prospect sans apprenant peut être supprimé');
rollback;

begin;
select tests.session('11111111-1111-4111-8111-111111111111', 'aal1');
set local role authenticated;
select tests.doit_etre_refuse(
  $$select public.creer_organisme('Intrus')$$,
  'sans double authentification : création refusée');
select tests.verifier((select count(*) from public.echanges_commerciaux) = 0,
  'sans double authentification : aucun échange visible');
rollback;

begin;
select tests.session('22222222-2222-4222-8222-222222222222');
set local role authenticated;
select tests.verifier((select count(*) from public.echanges_commerciaux) = 0,
  'client : ne voit AUCUN échange commercial, même ceux qui le concernent');
select tests.doit_etre_refuse(
  $$select public.creer_organisme('Intrus')$$,
  'client : ne peut pas créer d''organisme');
select tests.doit_etre_refuse(
  $$select public.supprimer_prospect('c0000000-0000-4000-8000-000000000004')$$,
  'client : ne peut rien supprimer');
rollback;

begin;
set local role anon;
select tests.doit_etre_refuse($$select * from public.echanges_commerciaux$$,
  'visiteur non connecté : aucun accès aux échanges');
rollback;

\echo '\n== 10. Import d''apprenants (étape 4)'

begin;
select tests.session('11111111-1111-4111-8111-111111111111', 'aal2');
set local role authenticated;
-- Même requête que l'écran d'import : insertion, ou mise à jour si l'identifiant existe.
insert into public.apprenants (organisme_id, identifiant_externe, prenom, nom, avancement_pct)
values ('a0000000-0000-4000-8000-000000000001', 'AH-001', 'Julie', 'Martin-Dupont', 55),
       ('a0000000-0000-4000-8000-000000000001', 'AH-NOUVEAU', 'Nina', 'Nouvelle', 0)
on conflict (organisme_id, identifiant_externe) do update
  set prenom = excluded.prenom, nom = excluded.nom, avancement_pct = excluded.avancement_pct;
select tests.verifier(
  (select count(*) from public.apprenants where organisme_id = 'a0000000-0000-4000-8000-000000000001') = 13,
  'import : 1 apprenant ajouté, l''existant mis à jour sans doublon (12 + 1)');
select tests.verifier(
  (select nom = 'Martin-Dupont' and avancement_pct = 55 and date_dernier_contact is not null
   from public.apprenants where identifiant_externe = 'AH-001'),
  'import : la mise à jour garde l''historique de contact de l''apprenant');
select tests.verifier(
  (select statut = 'actif' from public.apprenants where identifiant_externe = 'AH-NOUVEAU'),
  'import : un nouvel apprenant est « actif » par défaut');
select tests.verifier(
  (select count(*) from public.vue_qui_rappeler where identifiant_externe = 'AH-NOUVEAU') = 1,
  'import : le nouvel apprenant apparaît aussitôt dans « Qui rappeler »');
rollback;

begin;
select tests.session('22222222-2222-4222-8222-222222222222');
set local role authenticated;
select tests.doit_etre_refuse(
  $$insert into public.apprenants (organisme_id, identifiant_externe, prenom) values ('a0000000-0000-4000-8000-000000000001', 'X', 'Intrus')
    on conflict (organisme_id, identifiant_externe) do update set prenom = excluded.prenom$$,
  'client : ne peut pas importer d''apprenants');
rollback;

begin;
select tests.session('11111111-1111-4111-8111-111111111111', 'aal1');
set local role authenticated;
select tests.doit_etre_refuse(
  $$insert into public.apprenants (organisme_id, identifiant_externe, prenom) values ('a0000000-0000-4000-8000-000000000001', 'X', 'Intrus')$$,
  'sans double authentification : import refusé');
rollback;


\echo '\n== 11. Suivi jusqu''à l''examen (étape 5)'

select tests.verifier(
  (select string_agg(identifiant_externe || '=' || etape_relance || case when relance_faite then '(faite)' else '' end, ' ' order by jours_avant_examen)
   from public.vue_relances_examen where organisme_id = 'a0000000-0000-4000-8000-000000000001')
  = 'AH-010=J-1 AH-002=J-7 AH-005=J-30(faite)',
  'relances : J-1, J-7 et J-30 repérées ; la relance J-30 de Nadia est faite (contact il y a 2 j)');
select tests.verifier(
  (select sum(presents) = 1 and sum(absents) = 1 and sum(reussis) = 1 and sum(a_renseigner) = 1 and sum(a_venir) = 3
   from public.vue_taux_examen where organisme_id = 'a0000000-0000-4000-8000-000000000001'),
  'Horizon : 1 présent, 1 absent, 1 réussite, 1 examen à renseigner, 3 à venir');
select tests.verifier(
  (select sum(presents) = 2 and sum(reussis) = 1 and sum(echoues) = 1
   from public.vue_taux_examen where organisme_id = 'b0000000-0000-4000-8000-000000000002'),
  'Boréal : 2 présents, 1 réussite, 1 échec');
select tests.verifier(
  (select taux_presence = 100 and taux_reussite = 50 from (
     select round(100.0 * sum(presents) / nullif(sum(presents + absents), 0), 1) taux_presence,
            round(100.0 * sum(reussis) / nullif(sum(reussis + echoues), 0), 1) taux_reussite
     from public.vue_taux_examen where organisme_id = 'b0000000-0000-4000-8000-000000000002') t),
  'Boréal : taux de présence 100 %, taux de réussite 50 %');
select tests.doit_etre_refuse(
  $$update public.apprenants set resultat_examen = 'reussi' where identifiant_externe = 'AH-006'$$,
  'cohérence : pas de résultat pour un apprenant absent');
select tests.doit_etre_refuse(
  $$update public.apprenants set date_examen = null where identifiant_externe = 'AH-008'$$,
  'cohérence : pas de présence sans date d''examen');

begin;
select tests.session('33333333-3333-4333-8333-333333333333');
set local role authenticated;
select tests.verifier(
  (select count(*) from public.vue_relances_examen where organisme_id <> 'b0000000-0000-4000-8000-000000000002') = 0
  and (select count(*) from public.vue_relances_examen) = 1,
  'client Boréal : voit sa seule relance d''examen, aucune d''Horizon');
select tests.verifier(
  (select count(distinct organisme_id) from public.vue_taux_examen) = 1
  and (select bool_and(organisme_id = 'b0000000-0000-4000-8000-000000000002') from public.vue_taux_examen),
  'client Boréal : taux d''examen de son seul organisme');
select tests.verifier(
  tests.lignes_touchees($$update public.apprenants set presence_examen = 'present' where identifiant_externe = 'IB-102'$$) = 0,
  'client : ne peut pas modifier la présence à l''examen');
select tests.verifier(
  tests.lignes_touchees($$update public.organismes set taux_presence_depart = 10$$) = 0,
  'client : ne peut pas modifier son taux de départ');
rollback;

begin;
select tests.session('44444444-4444-4444-8444-444444444444');
set local role authenticated;
select tests.verifier(
  (select count(*) from public.vue_taux_examen where organisme_id = 'b0000000-0000-4000-8000-000000000002') = 0,
  'appelante : ne voit aucun taux d''un organisme qui ne lui confie personne');
select tests.verifier(
  (select coalesce(sum(effectif), 0) from public.vue_taux_examen) = 3,
  'appelante : les taux ne portent que sur ses 3 apprenants confiés');
rollback;

begin;
select tests.session('11111111-1111-4111-8111-111111111111', 'aal2');
set local role authenticated;
select tests.verifier(
  tests.lignes_touchees($$update public.apprenants set presence_examen = 'present', resultat_examen = 'reussi' where identifiant_externe = 'AH-003'$$) = 1,
  'administratrice : renseigne présence et résultat');
select tests.verifier(
  (select sum(a_renseigner) from public.vue_taux_examen where organisme_id = 'a0000000-0000-4000-8000-000000000001') = 0,
  'après saisie : plus aucun examen à renseigner chez Horizon');
rollback;

begin;
set local role anon;
select tests.doit_etre_refuse($$select * from public.vue_taux_examen$$, 'visiteur non connecté : aucun taux d''examen');
select tests.doit_etre_refuse($$select * from public.vue_relances_examen$$, 'visiteur non connecté : aucune relance d''examen');
rollback;

\echo '\n== 12. Fiche apprenant et « Noter un appel » (étape 6)'

begin;
select tests.session('44444444-4444-4444-8444-444444444444');
set local role authenticated;
select tests.verifier(
  (select public.noter_appel('a1000000-0000-4000-8000-000000000001', 'joint', 'telephone', now(),
     'Reprise des modules cette semaine.', 'Fatiguée, garde alternée.', 'Point d''étape', prive.aujourdhui() + 7)) is not null,
  'appelante : note un appel pour une apprenante confiée');
select tests.verifier(
  (select count(*) from public.vue_qui_rappeler where identifiant_externe = 'AH-001' and jours_sans_contact = 0) = 1,
  'appelante : le compteur de Julie repart à zéro');
select tests.verifier(
  (select count(*) from public.notes_internes ni join public.appels ap on ap.id = ni.appel_id
   where ap.apprenant_id = 'a1000000-0000-4000-8000-000000000001' and ni.contenu like 'Fatiguée%') = 1,
  'appelante : relit la note interne de son propre appel');
select tests.verifier(
  (select auteur_id = '44444444-4444-4444-8444-444444444444' and organisme_id = 'a0000000-0000-4000-8000-000000000001'
   from public.appels where note_client = 'Reprise des modules cette semaine.'),
  'l''appel porte son autrice et l''organisme de l''apprenante');
select tests.doit_etre_refuse(
  $$select public.noter_appel('a1000000-0000-4000-8000-000000000002', 'joint')$$,
  'appelante : refusé pour un apprenant qui ne lui est pas confié');
select tests.doit_etre_refuse(
  $$select public.noter_appel('a1000000-0000-4000-8000-000000000001', 'joint', 'telephone', now() + interval '2 days')$$,
  'appel daté dans le futur : refusé');
select tests.verifier(
  tests.lignes_touchees($$delete from public.appels where apprenant_id = 'a1000000-0000-4000-8000-000000000001'$$) = 0,
  'appelante : ne peut pas supprimer d''appel');
rollback;

begin;
select tests.session('22222222-2222-4222-8222-222222222222');
set local role authenticated;
select tests.doit_etre_refuse(
  $$select public.noter_appel('a1000000-0000-4000-8000-000000000001', 'joint')$$,
  'client : ne peut pas noter d''appel');
rollback;

begin;
select tests.session('11111111-1111-4111-8111-111111111111', 'aal2');
set local role authenticated;
do $$ begin perform public.noter_appel('a1000000-0000-4000-8000-000000000004', 'joint', 'telephone', now(), 'Appel saisi par erreur.'); end $$;
select tests.verifier(
  (select date_dernier_contact = prive.aujourdhui() from public.apprenants where identifiant_externe = 'AH-004'),
  'administratrice : appel noté, dernier contact à aujourd''hui');
select tests.verifier(
  tests.lignes_touchees($$delete from public.appels where note_client = 'Appel saisi par erreur.'$$) = 1,
  'administratrice : supprime un appel saisi par erreur');
select tests.verifier(
  (select date_dernier_contact = prive.aujourdhui() - 16 from public.apprenants where identifiant_externe = 'AH-004'),
  'après suppression : le dernier contact revient à l''appel précédent (il y a 16 j)');
rollback;

begin;
select tests.session('11111111-1111-4111-8111-111111111111', 'aal1');
set local role authenticated;
select tests.doit_etre_refuse(
  $$select public.noter_appel('a1000000-0000-4000-8000-000000000001', 'joint')$$,
  'sans double authentification : appel refusé');
rollback;

\echo '\n== 13. Comptes clients et appelantes (étape 7)'

begin;
select tests.session('11111111-1111-4111-8111-111111111111', 'aal2');
set local role authenticated;
select tests.verifier(public.je_suis_admin(), 'administratrice avec double authentification : reconnue');
select tests.doit_etre_refuse(
  $$update public.profils set actif = false where id = '11111111-1111-4111-8111-111111111111'$$,
  'administratrice : ne peut pas désactiver son propre compte');
select tests.doit_etre_refuse(
  $$update public.profils set role = 'client', organisme_id = 'a0000000-0000-4000-8000-000000000001' where id = '11111111-1111-4111-8111-111111111111'$$,
  'administratrice : ne peut pas changer son propre rôle');
select tests.verifier(
  tests.lignes_touchees($$update public.profils set actif = false where id = '33333333-3333-4333-8333-333333333333'$$) = 1,
  'administratrice : désactive le compte d''un client');
select tests.verifier(
  tests.lignes_touchees($$update public.apprenants set appelante_id = '44444444-4444-4444-8444-444444444444' where identifiant_externe = 'AH-002'$$) = 1,
  'administratrice : confie un apprenant à l''appelante');
select tests.doit_etre_refuse(
  $$update public.apprenants set appelante_id = '22222222-2222-4222-8222-222222222222' where identifiant_externe = 'AH-005'$$,
  'un apprenant ne peut pas être confié à un compte client');
update public.profils set actif = false where id = '44444444-4444-4444-8444-444444444444';
select tests.doit_etre_refuse(
  $$update public.apprenants set appelante_id = '44444444-4444-4444-8444-444444444444' where identifiant_externe = 'AH-006'$$,
  'un apprenant ne peut pas être confié à une appelante désactivée');
select tests.verifier(
  tests.lignes_touchees($$update public.apprenants set appelante_id = null where identifiant_externe = 'AH-001'$$) = 1,
  'administratrice : reprend un apprenant (plus confié à personne)');
rollback;

begin;
select tests.session('11111111-1111-4111-8111-111111111111', 'aal1');
set local role authenticated;
select tests.verifier(not public.je_suis_admin(), 'administratrice sans double authentification : pas reconnue');
rollback;

begin;
select tests.session('22222222-2222-4222-8222-222222222222');
set local role authenticated;
select tests.verifier(not public.je_suis_admin(), 'client : pas reconnu comme administratrice');
select tests.verifier(
  tests.lignes_touchees($$update public.profils set role = 'admin' where id = '22222222-2222-4222-8222-222222222222'$$) = 0,
  'client : ne peut pas se donner le rôle administratrice');
rollback;

begin;
set local role anon;
select tests.doit_etre_refuse($$select public.je_suis_admin()$$, 'visiteur non connecté : refusé');
rollback;

\echo
\echo '\n== 14. Contact multicanal'

begin;
select tests.session('44444444-4444-4444-8444-444444444444');
set local role authenticated;
select tests.verifier(public.noter_appel('a1000000-0000-4000-8000-000000000001', 'messagerie', 'whatsapp', now(),
  'Message WhatsApp envoyé : point du mois.', null, null, null) is not null, 'appelante : enregistre un message WhatsApp');
select tests.verifier(
  (select count(*) from public.appels where apprenant_id = 'a1000000-0000-4000-8000-000000000001' and canal = 'whatsapp') = 1,
  'appelante : un message WhatsApp est noté dans l''historique');
select tests.verifier(public.noter_appel('a1000000-0000-4000-8000-000000000001', 'joint', 'visio', now(),
  'Point en visio.', null, null, null) is not null, 'appelante : enregistre un point en visio');
select tests.verifier(
  (select count(*) from public.appels where apprenant_id = 'a1000000-0000-4000-8000-000000000001' and canal = 'visio') = 1,
  'appelante : un rendez-vous en visio est noté dans l''historique');
select tests.doit_etre_refuse(
  $$select public.noter_appel('a1000000-0000-4000-8000-000000000002', 'messagerie', 'whatsapp', now(), 'x', null, null, null)$$,
  'appelante : pas de message noté pour un apprenant non confié');
rollback;

\echo
\echo '\n== 15. Coaching : stage, projet, organisation'

begin;
select tests.session('22222222-2222-4222-8222-222222222222');
set local role authenticated;
select tests.verifier((select count(*) from public.coaching) = 2, 'client Horizon : voit les 2 fiches de coaching de SES apprenants');
select tests.verifier(
  (select count(*) from public.coaching where organisme_id = 'b0000000-0000-4000-8000-000000000002') = 0,
  'client Horizon : ne voit aucune fiche de Boréal');
select tests.verifier(
  tests.lignes_touchees($$update public.coaching set projet_metier = 'x'$$) = 0,
  'client : ne peut pas modifier une fiche de coaching');
rollback;

begin;
select tests.session('33333333-3333-4333-8333-333333333333');
set local role authenticated;
select tests.verifier((select count(*) from public.coaching) = 2, 'client Boréal : voit ses 2 fiches, pas celles d''Horizon');
rollback;

begin;
select tests.session('44444444-4444-4444-8444-444444444444');
set local role authenticated;
select tests.verifier((select count(*) from public.coaching) = 1, 'appelante : voit seulement la fiche de son apprenante confiée');
select tests.verifier(
  tests.lignes_touchees($$update public.coaching set orga_objectif = 'Module 5 fini' where apprenant_id = 'a1000000-0000-4000-8000-000000000001'$$) = 1,
  'appelante : complète la fiche de son apprenante confiée');
select tests.verifier(
  tests.lignes_touchees($$update public.coaching set orga_objectif = 'x' where apprenant_id = 'a1000000-0000-4000-8000-000000000002'$$) = 0,
  'appelante : ne touche pas à la fiche d''un apprenant non confié');
rollback;

begin;
select tests.session('11111111-1111-4111-8111-111111111111', 'aal2');
set local role authenticated;
insert into public.coaching (apprenant_id, organisme_id, stage_statut)
values ('a1000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 'a_chercher');
select tests.verifier(
  (select organisme_id = 'a0000000-0000-4000-8000-000000000001' from public.coaching where apprenant_id = 'a1000000-0000-4000-8000-000000000003'),
  'administratrice : la fiche est rangée d''office dans le dossier du bon client');
select tests.doit_etre_refuse(
  $$update public.coaching set stage_debut = '2026-12-10', stage_fin = '2026-12-01' where apprenant_id = 'a1000000-0000-4000-8000-000000000003'$$,
  'fin de stage avant le début : refusé');
rollback;

begin;
set local role anon;
select tests.doit_etre_refuse($$select * from public.coaching$$, 'visiteur non connecté : aucune fiche de coaching');
rollback;

\echo
\echo 'TOUS LES TESTS SONT PASSÉS'
