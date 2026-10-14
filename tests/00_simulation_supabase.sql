-- =============================================================================
-- Simulation minimale de Supabase, UNIQUEMENT pour les tests locaux.
-- =============================================================================
-- Sur Supabase, tout ceci existe déjà : ce fichier n'est jamais envoyé en
-- production. Il recrée seulement ce dont nos fichiers ont besoin :
--   - les rôles anon, authenticated, service_role
--   - la table auth.users
--   - la fonction auth.uid() (identifiant de la personne connectée)
-- =============================================================================

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table auth.users (
  id    uuid primary key,
  email text
);

-- Même comportement que Supabase : l'identifiant vient du jeton de connexion.
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase donne par défaut des droits à anon et authenticated sur les
-- nouvelles tables : on reproduit ce comportement pour tester qu'on les retire.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
