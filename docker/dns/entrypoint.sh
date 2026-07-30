#!/bin/sh
# Role dispatch for the propgate DNS fixture tier.
#
# Env:
#   ROLE          root | auth | decoy | divergent | resolver | permissive
#   BIND_ADDRESS  address to listen on (a distinct 127.0.0.x per role)
#   DNS_PORT      defaults to 53; the macOS override raises it
set -eu

ROLE="${ROLE:?ROLE is required}"
BIND_ADDRESS="${BIND_ADDRESS:?BIND_ADDRESS is required}"
DNS_PORT="${DNS_PORT:-53}"
ZONES=/fixtures/zones
GENERATED=/tmp/generated

# Zone name for a fixture file. Filenames are the source of truth so adding a
# fixture never means editing a config: `secure.test.zone.signed` -> `secure.test`.
zone_name_for() {
  base=$(basename "$1")
  base=${base%.signed}
  base=${base%.zone}
  if [ "$base" = "root" ]; then
    printf '.'
  else
    printf '%s' "$base"
  fi
}

emit_zone_blocks() {
  # Every argument is a directory to scan. Missing directories are skipped so a
  # role can be added before its fixtures exist.
  for dir in "$@"; do
    [ -d "$dir" ] || continue
    find "$dir" -maxdepth 1 -type f \( -name '*.zone' -o -name '*.zone.signed' \) \
      | sort \
      | while read -r zonefile; do
          printf '\nzone:\n  name: "%s"\n  zonefile: "%s"\n' \
            "$(zone_name_for "$zonefile")" "$zonefile"
        done
  done
}

# The canary zone is generated rather than committed: it publishes the content
# hash of zones/, so committing it would feed its own hash back into itself.
# The staleness check in packages/dns compares this TXT against the local
# REVISION file, which is what turns "I edited a zone and the test still fails"
# into an actionable error instead of an afternoon.
write_canary_zone() {
  revision=$(cat /fixtures/REVISION 2>/dev/null || echo unknown)
  mkdir -p "$GENERATED"
  cat > "$GENERATED/canary.test.zone" <<EOF
\$ORIGIN canary.test.
\$TTL 5
@       IN SOA  ns1.test. hostmaster.propgate.invalid. ( 1 7200 3600 1209600 5 )
@       IN NS   ns1.test.
_rev    IN TXT  "$revision"
EOF
}

render_nsd_conf() {
  template="/etc/nsd/templates/$1.conf.tmpl"
  shift
  sed -e "s|@BIND_ADDRESS@|$BIND_ADDRESS|g" -e "s|@DNS_PORT@|$DNS_PORT|g" \
    "$template" > /etc/nsd/nsd.conf
  emit_zone_blocks "$@" >> /etc/nsd/nsd.conf
}

render_unbound_conf() {
  sed -e "s|@BIND_ADDRESS@|$BIND_ADDRESS|g" -e "s|@DNS_PORT@|$DNS_PORT|g" \
    "/etc/unbound/templates/$1.conf" > /etc/unbound/unbound.conf
  cp /etc/unbound/templates/root.hints /etc/unbound/root.hints
  sed -i "s|@ROOT_ADDRESS@|${ROOT_ADDRESS:-127.0.0.2}|g" /etc/unbound/root.hints
}

case "$ROLE" in
  root)
    # . and test. are both signed, so both live under signed/root/.
    render_nsd_conf root "$ZONES/signed/root"
    ;;
  auth)
    write_canary_zone
    render_nsd_conf auth "$ZONES/unsigned" "$ZONES/signed/auth" "$ZONES/psl" "$GENERATED"
    ;;
  decoy)
    render_nsd_conf decoy "$ZONES/decoy"
    ;;
  divergent)
    render_nsd_conf divergent "$ZONES/divergent"
    ;;
  resolver)
    render_unbound_conf validating
    ;;
  permissive)
    render_unbound_conf permissive
    ;;
  *)
    echo "unknown ROLE: $ROLE" >&2
    exit 64
    ;;
esac

case "$ROLE" in
  root | auth | decoy | divergent)
    # Fail loudly on a malformed fixture rather than starting up and serving
    # SERVFAIL for a zone that silently failed to load.
    nsd-checkconf /etc/nsd/nsd.conf
    # -d keeps NSD in the foreground. SIGHUP makes it re-read zone files, which
    # is what `pnpm dns:reload` sends — no nsd-control TLS setup needed.
    exec nsd -c /etc/nsd/nsd.conf -d
    ;;
  resolver | permissive)
    unbound-checkconf /etc/unbound/unbound.conf
    exec unbound -c /etc/unbound/unbound.conf -d
    ;;
esac
