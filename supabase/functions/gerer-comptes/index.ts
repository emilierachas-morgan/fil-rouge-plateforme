// =============================================================================
// Fil Rouge Apprenants — fonction serveur « gerer-comptes »
// =============================================================================
// Crée le compte de connexion d'un client (personne d'un organisme) ou d'une
// appelante. Seule cette fonction détient la clé de service : elle n'est
// jamais envoyée au navigateur.
//
// Sécurité :
//   1. Supabase refuse tout appel sans jeton de connexion valide (verify_jwt).
//   2. La fonction demande à la base, avec le jeton de la personne qui appelle,
//      si elle est administratrice ET connectée avec la double authentification
//      (public.je_suis_admin). Sinon : refus.
//   3. Impossible de créer un compte administratrice.
//   4. Si l'enregistrement du rôle échoue, le compte créé est supprimé
//      (rien n'est laissé à moitié fait).
//
// Appel : POST { action: "creer", email, nom_affiche, role: "client" | "appelante", organisme_id? }
// =============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGINES_AUTORISEES = [
  "https://filrouge-apprenant.github.io",
];

function entetes(origine: string | null) {
  return {
    "Access-Control-Allow-Origin": origine && ORIGINES_AUTORISEES.includes(origine) ? origine : ORIGINES_AUTORISEES[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    Vary: "Origin",
  };
}

function reponse(origine: string | null, statut: number, corps: Record<string, unknown>) {
  return new Response(JSON.stringify(corps), { status: statut, headers: entetes(origine) });
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  const origine = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: entetes(origine) });
  if (req.method !== "POST") return reponse(origine, 405, { erreur: "Méthode non autorisée." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const cleAnonyme = Deno.env.get("SUPABASE_ANON_KEY")!;
  const cleService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const jeton = req.headers.get("Authorization") ?? "";

  // 1. Qui appelle ? (avec SON jeton : les règles de la base s'appliquent)
  const appelant = createClient(url, cleAnonyme, {
    global: { headers: { Authorization: jeton } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: estAdmin, error: erreurAdmin } = await appelant.rpc("je_suis_admin");
  if (erreurAdmin || estAdmin !== true) {
    return reponse(origine, 403, { erreur: "Action réservée à l'administratrice connectée avec la double authentification." });
  }

  // 2. Contrôle de la demande
  let demande: Record<string, unknown>;
  try {
    demande = await req.json();
  } catch {
    return reponse(origine, 400, { erreur: "Demande illisible." });
  }
  if (demande.action !== "creer") return reponse(origine, 400, { erreur: "Action inconnue." });

  const email = String(demande.email ?? "").trim().toLowerCase();
  const nom = String(demande.nom_affiche ?? "").trim().slice(0, 120) || null;
  const role = String(demande.role ?? "");
  const organisme = demande.organisme_id ? String(demande.organisme_id) : null;

  if (!EMAIL.test(email) || email.length > 254) return reponse(origine, 400, { erreur: "Adresse email non valable." });
  if (role !== "client" && role !== "appelante") return reponse(origine, 400, { erreur: "Rôle non valable : client ou appelante." });
  if (role === "client" && (!organisme || !UUID.test(organisme))) {
    return reponse(origine, 400, { erreur: "Choisissez l'organisme de ce client." });
  }

  const service = createClient(url, cleService, { auth: { persistSession: false, autoRefreshToken: false } });

  if (role === "client") {
    const { data: org } = await service.from("organismes").select("id").eq("id", organisme).maybeSingle();
    if (!org) return reponse(origine, 400, { erreur: "Cet organisme n'existe pas." });
  }

  // 3. Création du compte de connexion (adresse considérée comme confirmée :
  //    la personne se connectera par le lien reçu à cette adresse).
  const { data: cree, error: erreurCreation } = await service.auth.admin.createUser({ email, email_confirm: true });
  if (erreurCreation || !cree?.user) {
    const deja = /already|registered|exists/i.test(erreurCreation?.message ?? "");
    return reponse(origine, deja ? 409 : 500, {
      erreur: deja ? "Un compte existe déjà avec cette adresse email." : "Le compte n'a pas pu être créé. Réessayez dans un instant.",
    });
  }

  // 4. Rôle et organisme. En cas d'échec, on supprime le compte créé.
  const { error: erreurProfil } = await service.from("profils").insert({
    id: cree.user.id,
    email,
    nom_affiche: nom,
    role,
    organisme_id: role === "client" ? organisme : null,
    actif: true,
  });
  if (erreurProfil) {
    await service.auth.admin.deleteUser(cree.user.id);
    return reponse(origine, 500, { erreur: "Le compte n'a pas pu être enregistré. Rien n'a été créé." });
  }

  return reponse(origine, 200, { id: cree.user.id, email, role });
});
