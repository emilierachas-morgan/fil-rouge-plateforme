-- =============================================================================
-- Fil Rouge Apprenants — Étape 8 : contact multicanal
-- =============================================================================
-- Le suivi se fait aussi par WhatsApp et en visio (en plus du téléphone, des
-- SMS et des emails). Chaque message envoyé depuis la fiche apprenant est noté
-- dans l'historique avec son canal : il compte dans les preuves Qualiopi.
-- =============================================================================

alter type public.canal_appel add value if not exists 'whatsapp';
alter type public.canal_appel add value if not exists 'visio';
