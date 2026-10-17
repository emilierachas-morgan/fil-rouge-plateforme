-- =============================================================================
-- Fil Rouge Apprenants — Étape 7 : comptes clients et appelantes
-- =============================================================================
-- La création d'un compte de connexion passe par la fonction serveur
-- « gerer-comptes » (supabase/functions/gerer-comptes) : elle seule détient la
-- clé de service. Cette migration ajoute ce qu'il lui faut côté base, et deux
-- garde-fous :
--   - je_suis_admin()   : la fonction serveur vérifie que l'appel vient bien de
--                         l'administratrice connectée avec la double authentification ;
--   - l'administratrice ne peut ni désactiver son propre compte ni changer son
--     propre rôle (impossible de s'enfermer dehors) ;
--   - un apprenant ne peut être confié qu'à un compte appelante actif.
-- =============================================================================

create or replace function public.je_suis_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select prive.est_admin()
$$;

revoke all on function public.je_suis_admin() from public, anon;
grant execute on function public.je_suis_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- Son propre compte : ni désactivation, ni changement de rôle par soi-même.
-- -----------------------------------------------------------------------------

create or replace function prive.protege_propre_compte()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.id = auth.uid() and (new.actif is distinct from old.actif or new.role is distinct from old.role) then
    raise exception 'Vous ne pouvez pas désactiver votre propre compte ni changer votre propre rôle.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger profils_protege_propre_compte
  before update on public.profils
  for each row execute function prive.protege_propre_compte();

-- -----------------------------------------------------------------------------
-- Apprenant confié : uniquement à une appelante active.
-- -----------------------------------------------------------------------------

create or replace function prive.verifie_appelante()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.appelante_id is not null
     and (tg_op = 'INSERT' or new.appelante_id is distinct from old.appelante_id)
     and not exists (
       select 1 from public.profils p
       where p.id = new.appelante_id and p.role = 'appelante' and p.actif
     ) then
    raise exception 'Un apprenant ne peut être confié qu''à une appelante active.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger apprenants_verifie_appelante
  before insert or update of appelante_id on public.apprenants
  for each row execute function prive.verifie_appelante();
