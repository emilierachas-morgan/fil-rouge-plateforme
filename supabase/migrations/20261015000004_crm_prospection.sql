-- =============================================================================
-- Fil Rouge Apprenants — Étape 3 : CRM de prospection
-- =============================================================================
-- Ajoute :
--   - echanges_commerciaux : l'historique des échanges avec chaque organisme
--     (email envoyé, appel, relance, réponse...). Administratrice uniquement.
--   - creer_organisme()    : crée un organisme et sa fiche commerciale en une
--     seule opération (tout ou rien).
--   - supprimer_prospect() : supprime un organisme uniquement s'il n'a aucun
--     apprenant (protection contre une suppression accidentelle d'un client).
-- =============================================================================

create type public.canal_echange as enum ('email', 'telephone', 'linkedin', 'visio', 'autre');

create table public.echanges_commerciaux (
  id             uuid primary key default gen_random_uuid(),
  organisme_id   uuid not null references public.organismes (id) on delete cascade,
  date_echange   date not null default prive.aujourdhui(),
  canal          public.canal_echange not null default 'email',
  resume         text not null check (length(trim(resume)) > 0),
  auteur_id      uuid references public.profils (id) on delete set null,
  cree_le        timestamptz not null default now()
);

create index echanges_organisme_idx on public.echanges_commerciaux (organisme_id, date_echange desc);

comment on table public.echanges_commerciaux is
  'Historique des échanges commerciaux avec un organisme. Administratrice uniquement.';

create trigger journal_echanges_commerciaux after insert or update or delete on public.echanges_commerciaux
  for each row execute function prive.journaliser();

alter table public.echanges_commerciaux enable row level security;

revoke all on public.echanges_commerciaux from anon;
grant select, insert, update, delete on public.echanges_commerciaux to authenticated;

create policy echanges_admin on public.echanges_commerciaux
  for all to authenticated
  using (prive.est_admin())
  with check (prive.est_admin());

-- -----------------------------------------------------------------------------
-- Créer un organisme et sa fiche commerciale en une fois.
-- security invoker : les règles d'accès de la personne connectée s'appliquent.
-- -----------------------------------------------------------------------------

create or replace function public.creer_organisme(
  p_nom               text,
  p_etape             public.etape_commerciale default 'prospect',
  p_contact_nom       text default null,
  p_contact_fonction  text default null,
  p_contact_email     text default null,
  p_contact_telephone text default null,
  p_prochaine_relance date default null,
  p_notes             text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not prive.est_admin() then
    raise exception 'Action réservée à l''administratrice.' using errcode = '42501';
  end if;

  insert into public.organismes (nom) values (trim(p_nom)) returning id into v_id;

  insert into public.organismes_suivi_commercial
    (organisme_id, etape, contact_nom, contact_fonction, contact_email, contact_telephone, prochaine_relance, notes)
  values
    (v_id, p_etape, nullif(trim(p_contact_nom), ''), nullif(trim(p_contact_fonction), ''),
     nullif(trim(p_contact_email), ''), nullif(trim(p_contact_telephone), ''),
     p_prochaine_relance, nullif(trim(p_notes), ''));

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Supprimer un prospect : refusé s'il a des apprenants (c'est alors un client).
-- -----------------------------------------------------------------------------

create or replace function public.supprimer_prospect(p_organisme uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not prive.est_admin() then
    raise exception 'Action réservée à l''administratrice.' using errcode = '42501';
  end if;

  if exists (select 1 from public.apprenants where organisme_id = p_organisme) then
    raise exception 'Cet organisme a des apprenants : il ne peut pas être supprimé d''ici.'
      using errcode = 'P0001';
  end if;

  delete from public.organismes where id = p_organisme;
end;
$$;

revoke all on function public.creer_organisme(text, public.etape_commerciale, text, text, text, text, date, text) from public, anon;
revoke all on function public.supprimer_prospect(uuid) from public, anon;
grant execute on function public.creer_organisme(text, public.etape_commerciale, text, text, text, text, date, text) to authenticated;
grant execute on function public.supprimer_prospect(uuid) to authenticated;
