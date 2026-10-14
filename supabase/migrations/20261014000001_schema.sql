-- =============================================================================
-- Fil Rouge Apprenants — Étape 1 : schéma de la base
-- =============================================================================
-- Ce fichier crée les tables, les types et les automatismes de la plateforme.
-- Les règles d'accès (qui voit quoi) sont dans le fichier suivant :
--   20261014000002_securite.sql
--
-- Organisation des données :
--   organismes                    -> les organismes (prospects et clients)
--   organismes_suivi_commercial   -> le CRM commercial d'Émilie (jamais visible par un client)
--   profils                       -> les personnes qui se connectent et leur rôle
--   apprenants                    -> les apprenants des clients (1 organisme -> n apprenants)
--   appels                        -> les notes d'appel visibles par le client (1 apprenant -> n appels)
--   notes_internes                -> la partie interne d'un appel (jamais visible par un client)
--   journal                       -> la trace de chaque création, modification, suppression
--
-- Cible : Supabase (PostgreSQL 15+). Le schéma « auth » et la fonction auth.uid()
-- sont fournis par Supabase.
-- =============================================================================

create extension if not exists pgcrypto;

-- Schéma privé : fonctions internes, jamais exposées par l'API de Supabase.
create schema if not exists prive;

-- -----------------------------------------------------------------------------
-- Types (listes de valeurs fermées)
-- -----------------------------------------------------------------------------

create type public.etape_commerciale as enum (
  'prospect',       -- repéré, pas encore contacté
  'contacte',       -- premier email ou appel fait
  'test_gratuit',   -- diagnostic découverte en cours
  'client',         -- abonnement ou prestation signée
  'perdu'           -- refus ou sans suite
);

create type public.role_utilisateur as enum (
  'admin',      -- Émilie : voit et modifie tout
  'client',     -- personne d'un organisme client : lecture seule de ses apprenants
  'appelante'   -- renfort pour les appels : seulement les apprenants qui lui sont confiés
);

create type public.statut_apprenant as enum ('actif', 'termine', 'abandon');

create type public.canal_appel as enum ('telephone', 'sms', 'email');

create type public.resultat_appel as enum (
  'joint',          -- conversation réelle avec l'apprenant
  'messagerie',     -- message laissé
  'injoignable',    -- pas de réponse, pas de messagerie
  'refuse_suivi'    -- l'apprenant ne souhaite plus être contacté
);

-- -----------------------------------------------------------------------------
-- Automatisme commun : mise à jour de la colonne modifie_le
-- -----------------------------------------------------------------------------

create or replace function prive.maj_modifie_le()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.modifie_le := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Organismes : ce qu'un client a le droit de voir de son propre organisme
-- -----------------------------------------------------------------------------

create table public.organismes (
  id                  uuid primary key default gen_random_uuid(),
  nom                 text not null check (length(trim(nom)) > 0),
  -- Seuils d'alerte en jours sans contact : vert jusqu'à seuil_vert,
  -- orange jusqu'à seuil_orange, rouge au-delà.
  seuil_vert_jours    integer not null default 7  check (seuil_vert_jours > 0),
  seuil_orange_jours  integer not null default 14,
  cree_le             timestamptz not null default now(),
  modifie_le          timestamptz not null default now(),
  constraint seuils_coherents check (seuil_orange_jours > seuil_vert_jours)
);

comment on table public.organismes is
  'Organismes de formation (prospects et clients). Un client ne voit que le sien.';

create trigger organismes_modifie_le
  before update on public.organismes
  for each row execute function prive.maj_modifie_le();

-- -----------------------------------------------------------------------------
-- Suivi commercial : le CRM de prospection d'Émilie (administratrice seulement)
-- Séparé de « organismes » pour qu'un client ne puisse jamais lire ses propres
-- notes commerciales, même en cas d'erreur d'affichage.
-- -----------------------------------------------------------------------------

create table public.organismes_suivi_commercial (
  organisme_id        uuid primary key references public.organismes (id) on delete cascade,
  contact_nom         text,
  contact_fonction    text,
  contact_email       text,
  contact_telephone   text,
  etape               public.etape_commerciale not null default 'prospect',
  prochaine_relance   date,
  formule             text check (formule in ('30', '80', '150', 'sur_devis')),
  date_debut_contrat  date,
  notes               text,
  modifie_le          timestamptz not null default now()
);

comment on table public.organismes_suivi_commercial is
  'CRM commercial : étape, relances, notes. Jamais visible par un client.';

create trigger suivi_commercial_modifie_le
  before update on public.organismes_suivi_commercial
  for each row execute function prive.maj_modifie_le();

-- -----------------------------------------------------------------------------
-- Profils : une ligne par compte de connexion (créé par Supabase Auth)
-- -----------------------------------------------------------------------------

create table public.profils (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text not null,
  nom_affiche    text,
  role           public.role_utilisateur not null default 'client',
  organisme_id   uuid references public.organismes (id) on delete cascade,
  actif          boolean not null default true,
  cree_le        timestamptz not null default now(),
  -- Un compte client est toujours rattaché à un organisme.
  constraint client_a_un_organisme check (role <> 'client' or organisme_id is not null)
);

comment on table public.profils is
  'Rôle de chaque compte. Un compte désactivé (actif = false) ne voit plus rien.';

-- -----------------------------------------------------------------------------
-- Apprenants : les apprenants des organismes clients
-- -----------------------------------------------------------------------------

create table public.apprenants (
  id                    uuid primary key default gen_random_uuid(),
  organisme_id          uuid not null references public.organismes (id) on delete cascade,
  -- Identifiant de l'apprenant dans l'export du client : sert à mettre à jour
  -- au lieu de dupliquer lors d'un nouvel import.
  identifiant_externe   text,
  prenom                text,
  nom                   text,
  telephone             text,
  email                 text,
  parcours              text,
  date_inscription      date,
  avancement_pct        numeric(5, 2) check (avancement_pct between 0 and 100),
  derniere_connexion    date,
  statut                public.statut_apprenant not null default 'actif',
  -- Mis à jour automatiquement à chaque appel enregistré.
  date_dernier_contact  date,
  -- Appelante à qui l'apprenant est confié (vide = géré par Émilie).
  appelante_id          uuid references public.profils (id) on delete set null,
  cree_le               timestamptz not null default now(),
  modifie_le            timestamptz not null default now(),
  constraint identifiant_unique_par_organisme unique (organisme_id, identifiant_externe)
);

create index apprenants_organisme_idx on public.apprenants (organisme_id);
create index apprenants_appelante_idx on public.apprenants (appelante_id);

create trigger apprenants_modifie_le
  before update on public.apprenants
  for each row execute function prive.maj_modifie_le();

-- -----------------------------------------------------------------------------
-- Appels : la partie d'un appel visible par le client
-- -----------------------------------------------------------------------------

create table public.appels (
  id                      uuid primary key default gen_random_uuid(),
  apprenant_id            uuid not null references public.apprenants (id) on delete cascade,
  -- Recopié automatiquement depuis l'apprenant (impossible à falsifier).
  organisme_id            uuid not null references public.organismes (id) on delete cascade,
  auteur_id               uuid references public.profils (id) on delete set null,
  date_appel              timestamptz not null default now(),
  canal                   public.canal_appel not null default 'telephone',
  resultat                public.resultat_appel not null,
  note_client             text,
  prochaine_action        text,
  date_prochaine_action   date,
  cree_le                 timestamptz not null default now(),
  modifie_le              timestamptz not null default now()
);

create index appels_apprenant_idx on public.appels (apprenant_id, date_appel desc);
create index appels_organisme_idx on public.appels (organisme_id);

create trigger appels_modifie_le
  before update on public.appels
  for each row execute function prive.maj_modifie_le();

comment on column public.appels.note_client is
  'Note écrite pour être lue par le client. Ce qui ne le concerne pas va dans notes_internes.';

-- L'organisme d'un appel est toujours celui de l'apprenant : on l'impose.
create or replace function prive.appel_fixe_organisme()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organisme uuid;
begin
  select a.organisme_id into v_organisme
  from public.apprenants a
  where a.id = new.apprenant_id;

  if v_organisme is null then
    raise exception 'Apprenant introuvable : %', new.apprenant_id;
  end if;

  new.organisme_id := v_organisme;
  return new;
end;
$$;

create trigger appels_fixe_organisme
  before insert or update of apprenant_id, organisme_id on public.appels
  for each row execute function prive.appel_fixe_organisme();

-- Après un appel, la date du dernier contact de l'apprenant avance :
-- le compteur « jours sans contact » repart à zéro.
create or replace function prive.appel_maj_dernier_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.apprenants a
  set date_dernier_contact = greatest(
        coalesce(a.date_dernier_contact, (new.date_appel at time zone 'Europe/Paris')::date),
        (new.date_appel at time zone 'Europe/Paris')::date
      )
  where a.id = new.apprenant_id;
  return null;
end;
$$;

create trigger appels_maj_dernier_contact
  after insert or update of date_appel on public.appels
  for each row execute function prive.appel_maj_dernier_contact();

-- -----------------------------------------------------------------------------
-- Notes internes : ce que l'apprenant confie et qui ne regarde pas l'organisme
-- Table séparée : un client n'a aucun droit dessus.
-- -----------------------------------------------------------------------------

create table public.notes_internes (
  appel_id     uuid primary key references public.appels (id) on delete cascade,
  contenu      text not null,
  cree_le      timestamptz not null default now(),
  modifie_le   timestamptz not null default now()
);

create trigger notes_internes_modifie_le
  before update on public.notes_internes
  for each row execute function prive.maj_modifie_le();

comment on table public.notes_internes is
  'Partie interne d''une note d''appel. Visible par l''équipe Fil Rouge uniquement.';

-- -----------------------------------------------------------------------------
-- Journal : qui a créé, modifié ou supprimé quoi, et quand
-- -----------------------------------------------------------------------------

create table public.journal (
  id             bigint generated always as identity primary key,
  horodatage     timestamptz not null default now(),
  utilisateur_id uuid,
  action         text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_nom      text not null,
  ligne_id       text,
  organisme_id   uuid
);

create index journal_horodatage_idx on public.journal (horodatage desc);

create or replace function prive.journaliser()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ligne jsonb;
begin
  v_ligne := to_jsonb(coalesce(new, old));
  insert into public.journal (utilisateur_id, action, table_nom, ligne_id, organisme_id)
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    coalesce(v_ligne ->> 'id', v_ligne ->> 'appel_id', v_ligne ->> 'organisme_id'),
    case
      when tg_table_name = 'organismes' then (v_ligne ->> 'id')::uuid
      else (v_ligne ->> 'organisme_id')::uuid
    end
  );
  return null;
end;
$$;

create trigger journal_organismes after insert or update or delete on public.organismes
  for each row execute function prive.journaliser();
create trigger journal_suivi_commercial after insert or update or delete on public.organismes_suivi_commercial
  for each row execute function prive.journaliser();
create trigger journal_profils after insert or update or delete on public.profils
  for each row execute function prive.journaliser();
create trigger journal_apprenants after insert or update or delete on public.apprenants
  for each row execute function prive.journaliser();
create trigger journal_appels after insert or update or delete on public.appels
  for each row execute function prive.journaliser();
create trigger journal_notes_internes after insert or update or delete on public.notes_internes
  for each row execute function prive.journaliser();

-- -----------------------------------------------------------------------------
-- Vue « Qui rappeler en premier ? »
-- security_invoker : la vue applique les règles d'accès de la personne connectée.
-- -----------------------------------------------------------------------------

-- « Aujourd'hui » à l'heure de Paris (le serveur Supabase tourne en heure UTC).
create or replace function prive.aujourdhui()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Paris')::date
$$;

create view public.vue_qui_rappeler
with (security_invoker = true)
as
select
  a.id,
  a.organisme_id,
  o.nom                                   as organisme_nom,
  a.identifiant_externe,
  a.prenom,
  a.nom,
  a.telephone,
  a.parcours,
  a.avancement_pct,
  a.derniere_connexion,
  a.date_dernier_contact,
  a.statut,
  a.appelante_id,
  (prive.aujourdhui() - coalesce(a.date_dernier_contact, a.date_inscription, a.cree_le::date)) as jours_sans_contact,
  case
    when (prive.aujourdhui() - coalesce(a.date_dernier_contact, a.date_inscription, a.cree_le::date)) <= o.seuil_vert_jours   then 'vert'
    when (prive.aujourdhui() - coalesce(a.date_dernier_contact, a.date_inscription, a.cree_le::date)) <= o.seuil_orange_jours then 'orange'
    else 'rouge'
  end                                     as alerte
from public.apprenants a
join public.organismes o on o.id = a.organisme_id
where a.statut = 'actif';

comment on view public.vue_qui_rappeler is
  'Apprenants actifs avec le nombre de jours sans contact et la couleur d''alerte.';
