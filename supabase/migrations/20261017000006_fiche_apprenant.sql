-- =============================================================================
-- Fil Rouge Apprenants — Étape 6 : fiche apprenant et « Noter un appel »
-- =============================================================================
-- Ajoute :
--   - la correction automatique de la date du dernier contact quand un appel
--     saisi par erreur est supprimé (sinon le compteur « jours sans contact »
--     resterait faussement à zéro) ;
--   - noter_appel() : enregistre un appel et sa note interne en une seule
--     opération (tout ou rien), pour l'administratrice ou l'appelante.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Suppression d'un appel : la date du dernier contact revient à l'appel
-- précédent, si l'appel supprimé était le plus récent.
-- -----------------------------------------------------------------------------

create or replace function prive.appel_supprime_maj_dernier_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.apprenants a
  set date_dernier_contact = (
        select max((ap.date_appel at time zone 'Europe/Paris')::date)
        from public.appels ap
        where ap.apprenant_id = old.apprenant_id
      )
  where a.id = old.apprenant_id
    and a.date_dernier_contact = (old.date_appel at time zone 'Europe/Paris')::date
    -- Un autre appel le même jour : la date reste juste.
    and not exists (
      select 1 from public.appels ap
      where ap.apprenant_id = old.apprenant_id
        and (ap.date_appel at time zone 'Europe/Paris')::date = a.date_dernier_contact
    );
  return null;
end;
$$;

create trigger appels_supprime_maj_dernier_contact
  after delete on public.appels
  for each row execute function prive.appel_supprime_maj_dernier_contact();

-- -----------------------------------------------------------------------------
-- noter_appel : appel + note interne, en une fois.
-- security invoker : les règles d'accès de la personne connectée s'appliquent
-- (une appelante ne peut noter que pour ses apprenants confiés).
-- -----------------------------------------------------------------------------

create or replace function public.noter_appel(
  p_apprenant             uuid,
  p_resultat              public.resultat_appel,
  p_canal                 public.canal_appel default 'telephone',
  p_date_appel            timestamptz default now(),
  p_note_client           text default null,
  p_note_interne          text default null,
  p_prochaine_action      text default null,
  p_date_prochaine_action date default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (prive.est_admin() or prive.apprenant_confie(p_apprenant)) then
    raise exception 'Vous ne pouvez pas noter d''appel pour cet apprenant.' using errcode = '42501';
  end if;

  if p_date_appel > now() + interval '10 minutes' then
    raise exception 'La date de l''appel ne peut pas être dans le futur.' using errcode = 'P0001';
  end if;

  insert into public.appels
    (apprenant_id, organisme_id, auteur_id, date_appel, canal, resultat, note_client, prochaine_action, date_prochaine_action)
  values
    -- organisme_id est recopié de l'apprenant par l'automatisme existant.
    (p_apprenant, '00000000-0000-0000-0000-000000000000', auth.uid(), p_date_appel, p_canal, p_resultat,
     nullif(trim(p_note_client), ''), nullif(trim(p_prochaine_action), ''), p_date_prochaine_action)
  returning id into v_id;

  if nullif(trim(p_note_interne), '') is not null then
    insert into public.notes_internes (appel_id, contenu) values (v_id, trim(p_note_interne));
  end if;

  return v_id;
end;
$$;

revoke all on function public.noter_appel(uuid, public.resultat_appel, public.canal_appel, timestamptz, text, text, text, date) from public, anon;
grant execute on function public.noter_appel(uuid, public.resultat_appel, public.canal_appel, timestamptz, text, text, text, date) to authenticated;
