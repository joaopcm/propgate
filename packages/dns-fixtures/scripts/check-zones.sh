#!/usr/bin/env bash
# named-checkzone every fixture zone.
#
# Catches the silent-corruption failures that a zone file makes easy:
#   - an unquoted ";" in a CAA record, which starts a comment and leaves empty rdata
#   - a TXT string over 255 bytes
#   - a missing trailing dot turning an absolute name into a relative one
#
# NSD would refuse to load a broken zone and then SERVFAIL everything under it,
# which is a confusing way to find out. This turns that into a filename.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZONES="$(dirname "$HERE")/zones"

fail=0

check() {
  local zone="$1" file="$2" output
  if output="$(named-checkzone "$zone" "$file" 2>&1)" \
    && grep -q '^OK$' <<< "$output"; then
    printf 'ok    %s\n' "${file#"$ZONES"/}"
  else
    printf 'FAIL  %s\n%s\n' "${file#"$ZONES"/}" "$output"
    fail=1
  fi
}

zone_name_of() {
  local base
  base="$(basename "$1")"
  base="${base%.signed}"
  printf '%s' "${base%.zone}"
}

for dir in unsigned decoy divergent psl; do
  [ -d "$ZONES/$dir" ] || continue
  for file in "$ZONES/$dir"/*.zone; do
    [ -e "$file" ] || continue
    check "$(zone_name_of "$file")" "$file"
  done
done

for file in "$ZONES"/signed/auth/*.zone.signed; do
  [ -e "$file" ] || continue
  check "$(zone_name_of "$file")" "$file"
done

[ -e "$ZONES/signed/root/test.zone.signed" ] \
  && check test "$ZONES/signed/root/test.zone.signed"
[ -e "$ZONES/signed/root/root.zone.signed" ] \
  && check . "$ZONES/signed/root/root.zone.signed"

# The DNSSEC differential the whole validating tier rests on. Asserting both
# directions matters: if the bogus zone ever starts verifying, every DNSSEC
# diagnosis code is silently untested and the suite would still be green.
if command -v dnssec-verify >/dev/null 2>&1; then
  if dnssec-verify -o secure.test "$ZONES/signed/auth/secure.test.zone.signed" \
    >/dev/null 2>&1; then
    printf 'ok    secure.test verifies\n'
  else
    printf 'FAIL  secure.test should verify but does not — run `pnpm dns:sign`\n'
    fail=1
  fi

  if dnssec-verify -o bogus-zone.test \
    "$ZONES/signed/auth/bogus-zone.test.zone.signed" >/dev/null 2>&1; then
    printf 'FAIL  bogus-zone.test verifies, so it is testing nothing\n'
    fail=1
  else
    printf 'ok    bogus-zone.test is bogus, as intended\n'
  fi
fi

exit "$fail"
