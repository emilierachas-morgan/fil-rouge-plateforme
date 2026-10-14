-- =============================================================================
-- Fil Rouge Apprenants — Étape 2 : double authentification de l'administratrice
-- =============================================================================
-- Le compte administratrice voit les données de TOUS les clients. Il n'obtient
-- ces droits que si la connexion a été confirmée par un second facteur
-- (code de l'application d'authentification sur le téléphone).
--
-- Concrètement : Supabase indique le niveau de la connexion dans le jeton,
--   aal1 = email seul, aal2 = email + code de l'application.
-- Sans aal2, un compte administratrice ne voit que son propre profil.
-- =============================================================================

create or replace function prive.est_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    prive.role_actuel() = 'admin'
      and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2',
    false
  )
$$;

comment on function prive.est_admin() is
  'Vrai seulement pour un compte administratrice actif, connecté avec la double authentification.';
