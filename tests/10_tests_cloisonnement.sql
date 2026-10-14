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
create function tests.session(utilisateur uuid)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', utilisateur, 'role', 'authenticated')::text, true);
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
select tests.session('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select tests.verifier((select count(*) from public.apprenants) = 20, 'voit les 20 apprenants');
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

\echo
\echo 'TOUS LES TESTS SONT PASSÉS'
