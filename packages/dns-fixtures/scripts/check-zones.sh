#!/usr/bin/env bash
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
