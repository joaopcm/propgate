#!/bin/sh
set -eu

ROLE="${ROLE:?ROLE is required}"
BIND_ADDRESS="${BIND_ADDRESS:?BIND_ADDRESS is required}"
DNS_PORT="${DNS_PORT:-53}"
ZONES=/fixtures/zones
GENERATED=/tmp/generated

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
    nsd-checkconf /etc/nsd/nsd.conf
    exec nsd -c /etc/nsd/nsd.conf -d
    ;;
  resolver | permissive)
    unbound-checkconf /etc/unbound/unbound.conf
    exec unbound -c /etc/unbound/unbound.conf -d
    ;;
esac
