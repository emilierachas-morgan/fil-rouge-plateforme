#!/usr/bin/env bash
# =============================================================================
# Lance les tests du cloisonnement dans une base PostgreSQL jetable.
# Usage : ./tests/lancer_tests.sh
# Prérequis : PostgreSQL 15 ou plus installé localement (initdb, pg_ctl, psql).
# =============================================================================
set -euo pipefail

RACINE="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
DOSSIER="$(mktemp -d)"
PORT="${PORT:-54329}"
UTILISATEUR="$(id -un)"

# PostgreSQL refuse de tourner sous root : on passe par l'utilisateur postgres.
lancer() {
  if [ "$UTILISATEUR" = "root" ]; then
    su postgres -s /bin/bash -c "$*"
  else
    bash -c "$*"
  fi
}

[ "$UTILISATEUR" = "root" ] && chown postgres "$DOSSIER"

nettoyer() {
  lancer "$PG_BIN/pg_ctl -D '$DOSSIER/data' -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$DOSSIER"
}
trap nettoyer EXIT

echo "Création d'une base de test jetable..."
lancer "$PG_BIN/initdb -D '$DOSSIER/data' -U postgres --encoding=UTF8 --locale=C.UTF-8" >/dev/null
lancer "$PG_BIN/pg_ctl -D '$DOSSIER/data' -o '-p $PORT -k $DOSSIER -c timezone=UTC' -l '$DOSSIER/pg.log' -w start" >/dev/null

PSQL=(psql -h "$DOSSIER" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)

echo "Chargement : simulation Supabase, schéma, sécurité, données fictives..."
"${PSQL[@]}" -f "$RACINE/tests/00_simulation_supabase.sql"
for f in "$RACINE"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -f "$f"
done
"${PSQL[@]}" -f "$RACINE/supabase/seed.sql"

echo "Tests :"
"${PSQL[@]}" -t -A -f "$RACINE/tests/10_tests_cloisonnement.sql" 2>&1 | grep -v "^$" | sed -e 's/^psql:[^ ]* NOTICE:  //' -e 's/^NOTICE:  //'
exit "${PIPESTATUS[0]}"
