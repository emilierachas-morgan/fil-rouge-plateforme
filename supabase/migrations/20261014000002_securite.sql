-- =============================================================================
-- Fil Rouge Apprenants — Étape 1 : cloisonnement et droits d'accès
-- =============================================================================
-- Principe : tout est interdit par défaut, puis on ouvre au cas par cas.
--
--   admin      (Émilie)     -> tout voir, tout modifier
--   client     (organisme)  -> LIRE ses apprenants et ses notes d'appel, rien d'autre
--   appelante  (renfort)    -> lire ses apprenants confiés, écrire ses propres appels
--   anon       (non connecté) -> rien
--
-- Ces règles sont appliquées par la base elle-même (Row Level Security) :
-- même un bug dans les écrans ne peut pas montrer les données d'un autre client.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Fonctions d'aide : qui est connecté, avec quel rôle, pour quel organisme.
-- security definer : elles lisent « profils » sans déclencher ses propres règles
-- (évite une boucle). Un compte désactivé obtient « null » partout.
-- -----------------------------------------------------------------------------

create or replace function prive.role_actuel()
returns public.role_utilisateur
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profils p
  where p.id = auth.uid() and p.actif
$$;

create or replace function prive.organisme_actuel()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organisme_id
  from public.profils p
  where p.id = auth.uid() and p.actif and p.role = 'client'
$$;

create or replace function prive.est_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(prive.role_actuel() = 'admin', false)
$$;

create or replace function prive.est_appelante()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(prive.role_actuel() = 'appelante', false)
$$;

-- L'apprenant est-il confié à l'appelante connectée ?
create or replace function prive.apprenant_confie(p_apprenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select prive.est_appelante() and exists (
    select 1 from public.apprenants a
    where a.id = p_apprenant and a.appelante_id = auth.uid()
  )
$$;

-- L'appel a-t-il été écrit par l'appelante connectée ?
create or replace function prive.appel_de_l_appelante(p_appel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select prive.est_appelante() and exists (
    select 1 from public.appels ap
    where ap.id = p_appel and ap.auteur_id = auth.uid()
  )
$$;

revoke all on schema prive from public;
grant usage on schema prive to authenticated;
grant execute on all functions in schema prive to authenticated;

-- -----------------------------------------------------------------------------
-- Droits de base sur les tables.
-- Les visiteurs non connectés (anon) n'ont aucun droit.
-- Les comptes connectés ont des droits SQL, filtrés ensuite ligne par ligne.
-- -----------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

grant select, insert, update, delete on
  public.organismes,
  public.organismes_suivi_commercial,
  public.profils,
  public.apprenants,
  public.appels,
  public.notes_internes
to authenticated;

grant select on public.journal to authenticated;
grant select on public.vue_qui_rappeler to authenticated;

-- Le journal ne s'écrit que par les automatismes, jamais à la main.
revoke insert, update, delete on public.journal from authenticated;

-- -----------------------------------------------------------------------------
-- Activation du cloisonnement sur chaque table
-- -----------------------------------------------------------------------------

alter table public.organismes                  enable row level security;
alter table public.organismes_suivi_commercial enable row level security;
alter table public.profils                     enable row level security;
alter table public.apprenants                  enable row level security;
alter table public.appels                      enable row level security;
alter table public.notes_internes              enable row level security;
alter table public.journal                     enable row level security;

-- -----------------------------------------------------------------------------
-- organismes
-- -----------------------------------------------------------------------------

create policy organismes_admin on public.organismes
  for all to authenticated
  using (prive.est_admin())
  with check (prive.est_admin());

create policy organismes_client_lecture on public.organismes
  for select to authenticated
  using (id = prive.organisme_actuel());

create policy organismes_appelante_lecture on public.organismes
  for select to authenticated
  using (
    prive.est_appelante() and exists (
      select 1 from public.apprenants a
      where a.organisme_id = organismes.id and a.appelante_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- organismes_suivi_commercial : administratrice uniquement
-- -----------------------------------------------------------------------------

create policy suivi_commercial_admin on public.organismes_suivi_commercial
  for all to authenticated
  using (prive.est_admin())
  with check (prive.est_admin());

-- -----------------------------------------------------------------------------
-- profils : chacun lit le sien ; seule l'administratrice crée et modifie.
-- (Personne ne peut changer son propre rôle.)
-- -----------------------------------------------------------------------------

create policy profils_admin on public.profils
  for all to authenticated
  using (prive.est_admin())
  with check (prive.est_admin());

create policy profils_lecture_soi on public.profils
  for select to authenticated
  using (id = auth.uid());

-- -----------------------------------------------------------------------------
-- apprenants
-- -----------------------------------------------------------------------------

create policy apprenants_admin on public.apprenants
  for all to authenticated
  using (prive.est_admin())
  with check (prive.est_admin());

create policy apprenants_client_lecture on public.apprenants
  for select to authenticated
  using (organisme_id = prive.organisme_actuel());

create policy apprenants_appelante_lecture on public.apprenants
  for select to authenticated
  using (prive.est_appelante() and appelante_id = auth.uid());

-- -----------------------------------------------------------------------------
-- appels
-- -----------------------------------------------------------------------------

create policy appels_admin on public.appels
  for all to authenticated
  using (prive.est_admin())
  with check (prive.est_admin());

create policy appels_client_lecture on public.appels
  for select to authenticated
  using (organisme_id = prive.organisme_actuel());

create policy appels_appelante_lecture on public.appels
  for select to authenticated
  using (prive.apprenant_confie(apprenant_id));

create policy appels_appelante_creation on public.appels
  for insert to authenticated
  with check (prive.apprenant_confie(apprenant_id) and auteur_id = auth.uid());

create policy appels_appelante_modification on public.appels
  for update to authenticated
  using (prive.apprenant_confie(apprenant_id) and auteur_id = auth.uid())
  with check (prive.apprenant_confie(apprenant_id) and auteur_id = auth.uid());

-- -----------------------------------------------------------------------------
-- notes_internes : jamais pour un client
-- -----------------------------------------------------------------------------

create policy notes_internes_admin on public.notes_internes
  for all to authenticated
  using (prive.est_admin())
  with check (prive.est_admin());

create policy notes_internes_appelante_lecture on public.notes_internes
  for select to authenticated
  using (prive.appel_de_l_appelante(appel_id));

create policy notes_internes_appelante_creation on public.notes_internes
  for insert to authenticated
  with check (prive.appel_de_l_appelante(appel_id));

create policy notes_internes_appelante_modification on public.notes_internes
  for update to authenticated
  using (prive.appel_de_l_appelante(appel_id))
  with check (prive.appel_de_l_appelante(appel_id));

-- -----------------------------------------------------------------------------
-- journal : lecture par l'administratrice uniquement
-- -----------------------------------------------------------------------------

create policy journal_admin_lecture on public.journal
  for select to authenticated
  using (prive.est_admin());
