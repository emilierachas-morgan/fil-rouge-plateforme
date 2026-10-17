-- =============================================================================
-- Fil Rouge Apprenants — Étape 9 : coaching (stage, projet, organisation)
-- =============================================================================
-- Une fiche de coaching par apprenant, en plus du suivi d'examen (étape 5) :
--   - Stage        : où en est la recherche de stage et la convention ;
--   - Projet       : le métier visé et la situation de l'apprenant ;
--   - Organisation : son temps disponible, ses créneaux, l'objectif du mois.
--
-- Cloisonnement, comme pour les apprenants :
--   - administratrice : tout ;
--   - appelante       : lit et complète la fiche des apprenants qui lui sont confiés ;
--   - client          : lit les fiches de SES apprenants, jamais celles d'un autre organisme.
-- L'organisme est recopié automatiquement depuis l'apprenant : impossible de
-- ranger une fiche dans le dossier d'un autre client.
-- =============================================================================

create type public.statut_stage as enum (
  'non_concerne',        -- pas de stage dans ce parcours
  'a_chercher',          -- stage à trouver
  'structure_trouvee',   -- structure d'accueil trouvée
  'convention_envoyee',  -- convention envoyée, en attente de signatures
  'convention_signee',   -- convention signée
  'en_cours',            -- stage en cours
  'termine'              -- stage terminé
);

create type public.situation_projet as enum (
  'reconversion', 'en_emploi', 'en_recherche', 'creation_activite', 'autre'
);

create table public.coaching (
  apprenant_id         uuid primary key references public.apprenants (id) on delete cascade,
  organisme_id         uuid not null references public.organismes (id) on delete cascade,

  stage_statut         public.statut_stage not null default 'non_concerne',
  stage_structure      text check (char_length(stage_structure) <= 200),
  stage_debut          date,
  stage_fin            date,

  projet_metier        text check (char_length(projet_metier) <= 200),
  projet_situation     public.situation_projet,
  projet_note          text check (char_length(projet_note) <= 2000),

  orga_heures_semaine  smallint check (orga_heures_semaine between 0 and 60),
  orga_creneaux        text check (char_length(orga_creneaux) <= 200),
  orga_objectif        text check (char_length(orga_objectif) <= 500),
  orga_date_fin_visee  date,

  modifie_le           timestamptz not null default now(),
  constraint stage_dates_coherentes check (stage_fin is null or stage_debut is null or stage_fin >= stage_debut)
);

create index coaching_organisme_idx on public.coaching (organisme_id);

-- Organisme recopié depuis l'apprenant (même principe que pour les appels).
create or replace function prive.coaching_fixe_organisme()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organisme uuid;
begin
  select a.organisme_id into v_organisme from public.apprenants a where a.id = new.apprenant_id;
  if v_organisme is null then
    raise exception 'Apprenant introuvable : %', new.apprenant_id;
  end if;
  new.organisme_id := v_organisme;
  new.modifie_le := now();
  return new;
end;
$$;

create trigger coaching_fixe_organisme
  before insert or update on public.coaching
  for each row execute function prive.coaching_fixe_organisme();

-- Si un apprenant change d'organisme, sa fiche de coaching le suit.
create or replace function prive.apprenant_maj_coaching()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.coaching set organisme_id = new.organisme_id where apprenant_id = new.id;
  return null;
end;
$$;

create trigger apprenants_maj_coaching
  after update of organisme_id on public.apprenants
  for each row execute function prive.apprenant_maj_coaching();

-- Journal : la fiche est identifiée par son apprenant.
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
    coalesce(v_ligne ->> 'id', v_ligne ->> 'appel_id', v_ligne ->> 'apprenant_id', v_ligne ->> 'organisme_id'),
    case
      when tg_table_name = 'organismes' then (v_ligne ->> 'id')::uuid
      else (v_ligne ->> 'organisme_id')::uuid
    end
  );
  return null;
end;
$$;

create trigger journal_coaching after insert or update or delete on public.coaching
  for each row execute function prive.journaliser();

-- -----------------------------------------------------------------------------
-- Droits et cloisonnement
-- -----------------------------------------------------------------------------

revoke all on public.coaching from anon;
grant select, insert, update, delete on public.coaching to authenticated;
alter table public.coaching enable row level security;

create policy coaching_admin on public.coaching
  for all to authenticated
  using (prive.est_admin())
  with check (prive.est_admin());

create policy coaching_client_lecture on public.coaching
  for select to authenticated
  using (organisme_id = prive.organisme_actuel());

create policy coaching_appelante_lecture on public.coaching
  for select to authenticated
  using (prive.apprenant_confie(apprenant_id));

create policy coaching_appelante_creation on public.coaching
  for insert to authenticated
  with check (prive.apprenant_confie(apprenant_id));

create policy coaching_appelante_modification on public.coaching
  for update to authenticated
  using (prive.apprenant_confie(apprenant_id))
  with check (prive.apprenant_confie(apprenant_id));
