-- =============================================================================
-- Fil Rouge Apprenants — Étape 5 : suivi jusqu'à l'examen
-- =============================================================================
-- Pourquoi : depuis la loi du 27 juin 2026, l'apprenant financé par le CPF doit
-- se présenter à l'examen, et les organismes publient leurs taux de réussite.
-- L'offre « Suivi jusqu'à l'examen » doit donc suivre, pour chaque apprenant :
--   - la date de son examen,
--   - s'il s'est présenté ou non,
--   - s'il a réussi ou échoué.
--
-- Ajoute :
--   - 3 colonnes sur « apprenants » (une session d'examen par apprenant ;
--     un report remplace la date, l'ancienne reste dans le journal)
--   - organismes.taux_presence_depart : le taux de présence avant Fil Rouge,
--     base de calcul de l'option « résultat » du contrat
--   - vue_relances_examen : qui appeler à J-30, J-7 et J-1
--   - vue_taux_examen     : taux de présence et de réussite par cohorte
--
-- Les deux vues appliquent les règles d'accès de la personne connectée
-- (security_invoker) : un client ne voit que ses propres apprenants.
-- =============================================================================

create type public.presence_examen as enum ('present', 'absent');
create type public.resultat_examen as enum ('reussi', 'echoue');

alter table public.apprenants
  add column date_examen      date,
  add column presence_examen  public.presence_examen,
  add column resultat_examen  public.resultat_examen,
  -- Un résultat n'existe que pour un apprenant présent.
  add constraint resultat_si_present
    check (resultat_examen is null or presence_examen = 'present'),
  -- Présence ou résultat sans date d'examen : incohérent.
  add constraint examen_date_obligatoire
    check (date_examen is not null or (presence_examen is null and resultat_examen is null));

comment on column public.apprenants.date_examen is
  'Date de la session d''examen prévue. Vide = pas encore inscrit.';
comment on column public.apprenants.presence_examen is
  'Présent ou absent le jour de l''examen. Vide = examen à venir ou non renseigné.';
comment on column public.apprenants.resultat_examen is
  'Réussi ou échoué (seulement si présent). Vide = résultat pas encore connu.';

create index apprenants_examen_idx on public.apprenants (organisme_id, date_examen);

alter table public.organismes
  add column taux_presence_depart numeric(5, 2)
    check (taux_presence_depart is null or taux_presence_depart between 0 and 100);

comment on column public.organismes.taux_presence_depart is
  'Taux de présence à l''examen avant l''intervention de Fil Rouge (en %). Base de l''option résultat.';

-- -----------------------------------------------------------------------------
-- Relances avant l'examen : J-30, J-7, J-1
-- Une relance est « faite » si l'apprenant a été contacté depuis le début de
-- la fenêtre (ex. : pour J-7, un contact dans les 7 derniers jours avant
-- l'examen). Seuls les examens à venir non encore renseignés apparaissent.
-- -----------------------------------------------------------------------------

create view public.vue_relances_examen
with (security_invoker = true)
as
with base as (
  select
    a.id,
    a.organisme_id,
    o.nom                                   as organisme_nom,
    a.identifiant_externe,
    a.prenom,
    a.nom,
    a.telephone,
    a.parcours,
    a.statut,
    a.appelante_id,
    a.date_examen,
    a.date_dernier_contact,
    (a.date_examen - prive.aujourdhui())    as jours_avant_examen
  from public.apprenants a
  join public.organismes o on o.id = a.organisme_id
  where a.date_examen is not null
    and a.date_examen >= prive.aujourdhui()
    and a.presence_examen is null
    and a.statut <> 'abandon'
)
select
  b.*,
  case
    when b.jours_avant_examen <= 1  then 'J-1'
    when b.jours_avant_examen <= 7  then 'J-7'
    when b.jours_avant_examen <= 30 then 'J-30'
  end                                       as etape_relance,
  -- Vrai si un contact a déjà eu lieu dans la fenêtre de l'étape en cours.
  coalesce(b.date_dernier_contact >= b.date_examen - case
    when b.jours_avant_examen <= 1  then 1
    when b.jours_avant_examen <= 7  then 7
    else 30
  end, false)                               as relance_faite
from base b;

comment on view public.vue_relances_examen is
  'Examens à venir et étape de relance (J-30, J-7, J-1). Vide après J-30.';

-- -----------------------------------------------------------------------------
-- Taux par cohorte (mois d'inscription)
--   taux_presence  = présents / (présents + absents)
--   taux_reussite  = réussis / (réussis + échoués)
-- Les examens passés non renseignés sont comptés à part (« a_renseigner »),
-- pour ne pas fausser les taux.
-- -----------------------------------------------------------------------------

create view public.vue_taux_examen
with (security_invoker = true)
as
select
  a.organisme_id,
  o.nom                                                                   as organisme_nom,
  coalesce(to_char(a.date_inscription, 'YYYY-MM'), 'sans date')           as cohorte,
  count(*)                                                                as effectif,
  count(*) filter (where a.statut = 'abandon')                            as abandons,
  count(*) filter (where a.date_examen is not null)                       as inscrits_examen,
  count(*) filter (where a.date_examen >= prive.aujourdhui() and a.presence_examen is null) as a_venir,
  count(*) filter (where a.date_examen <  prive.aujourdhui() and a.presence_examen is null) as a_renseigner,
  count(*) filter (where a.presence_examen = 'present')                   as presents,
  count(*) filter (where a.presence_examen = 'absent')                    as absents,
  count(*) filter (where a.resultat_examen = 'reussi')                    as reussis,
  count(*) filter (where a.resultat_examen = 'echoue')                    as echoues,
  round(100.0 * count(*) filter (where a.presence_examen = 'present')
        / nullif(count(*) filter (where a.presence_examen is not null), 0), 1) as taux_presence,
  round(100.0 * count(*) filter (where a.resultat_examen = 'reussi')
        / nullif(count(*) filter (where a.resultat_examen is not null), 0), 1) as taux_reussite,
  o.taux_presence_depart
from public.apprenants a
join public.organismes o on o.id = a.organisme_id
group by a.organisme_id, o.nom, o.taux_presence_depart, coalesce(to_char(a.date_inscription, 'YYYY-MM'), 'sans date');

comment on view public.vue_taux_examen is
  'Présence et réussite à l''examen par organisme et par mois d''inscription.';

-- -----------------------------------------------------------------------------
-- Droits : lecture des vues pour les comptes connectés (filtrées par les
-- règles des tables). Aucun accès pour les visiteurs non connectés.
-- La vue « Qui rappeler » est recréée à l'identique plus bas pour exposer
-- la date d'examen.
-- -----------------------------------------------------------------------------

revoke all on public.vue_relances_examen, public.vue_taux_examen from anon, public;
grant select on public.vue_relances_examen, public.vue_taux_examen to authenticated;
-- Supabase accorde par défaut tous les droits sur les nouvelles vues : on ne
-- garde que la lecture.
revoke insert, update, delete, truncate, references, trigger
  on public.vue_relances_examen, public.vue_taux_examen from authenticated;

-- « Qui rappeler en premier ? » montre aussi la date d'examen.
create or replace view public.vue_qui_rappeler
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
  end                                     as alerte,
  a.date_examen
from public.apprenants a
join public.organismes o on o.id = a.organisme_id
where a.statut = 'actif';
