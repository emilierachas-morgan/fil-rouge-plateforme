-- =============================================================================
-- Fil Rouge Apprenants — chargement des 8 vrais prospects (16 octobre 2026)
-- =============================================================================
-- À coller dans Supabase > SQL Editor, puis « Run ».
-- - Retire les 3 prospects fictifs (École Méridienne, Campus Alizé,
--   Formations Archipel). Les 2 clients fictifs restent pour construire
--   la partie apprenants.
-- - Ajoute les 8 organismes de la liste validée, à l'étape « Prospect ».
-- Sans danger si on le relance : un organisme déjà présent n'est pas recréé.
-- =============================================================================

begin;

delete from public.organismes where id in (
  'c0000000-0000-4000-8000-000000000003',
  'c0000000-0000-4000-8000-000000000004',
  'c0000000-0000-4000-8000-000000000005');

with nouveaux(nom, contact, fonction, notes) as (values
  ('EFC Formation', 'Valérie Romero', 'Directrice pédagogique',
   'Angle : test gratuit. Accroche : forme à distance depuis 1945, inscriptions toute l''année. Email n°1 prêt (document « 8 emails de prospection »). Adresse email du contact à trouver.'),
  ('Koreva + CNFDI (groupe JPL Formation)', 'Coryne Sultan', 'Co-dirigeante du groupe',
   'Angle : test gratuit. Une porte pour deux écoles. Accroche : entretien Informations Entreprise (janv. 2025) sur les abandons, à relire avant envoi.'),
  ('L''École Française', 'Alisa Grassaud', 'Directrice générale',
   'Angle : test gratuit. Accroche : « rendre la formation en ligne plus humaine ».'),
  ('Icademie', 'Jean-Luc Codaccioni', 'Fondateur-CEO',
   'Angle : test gratuit. Vérifier sur LinkedIn qu''il dirige toujours l''école (rachat Eureka Education en 2020 selon une source secondaire).'),
  ('EDAA', 'Alexandre Cocco', 'Directeur',
   'Angle : test gratuit. Accroche : entrée toute l''année, trois ans de suivi pédagogique.'),
  ('ENACO', null, 'Direction pédagogique (à identifier)',
   'Angle : test gratuit. Trouver le nom de la direction pédagogique sur LinkedIn avant envoi. Accroche : leur livre blanc sur la formation à distance.'),
  ('Walter Learning', 'Thomas Cornet', 'Cofondateur',
   'Angle : enquête « voix des décrochés » (ils ont déjà leur propre système de relance).'),
  ('Skill and You (Educatel + Lignes et Formations)', 'Latifa Idrissi', 'Directrice pédagogique',
   'Angle : enquête « voix des décrochés » (service coaching interne). Plans B : Alexandre Denis, Emeline Drancourt.')
), a_creer as (
  select * from nouveaux n
  where not exists (select 1 from public.organismes o where o.nom = n.nom)
), crees as (
  insert into public.organismes (nom)
  select nom from a_creer
  returning id, nom
)
insert into public.organismes_suivi_commercial (organisme_id, etape, contact_nom, contact_fonction, notes)
select c.id, 'prospect', n.contact, n.fonction,
       n.notes || ' En attente de l''accord écrit de YouSchool avant tout envoi.'
from crees c join a_creer n on n.nom = c.nom;

commit;

select o.nom as organisme, s.etape, s.contact_nom as contact
from public.organismes o
join public.organismes_suivi_commercial s on s.organisme_id = o.id
order by o.nom;
