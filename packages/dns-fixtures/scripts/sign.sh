#!/usr/bin/env bash
# Sign the DNSSEC fixture zones. Output is committed.
#
#   pnpm dns:sign
#
# Signing happens offline, never in the serving container. An online signer
# (CoreDNS's dnssec plugin, Knot with signing enabled, PowerDNS in live mode)
# would re-sign — and therefore silently *repair* — the zones whose brokenness is
# the entire point of this harness.
#
# Order matters: children first, so their DS records can be threaded into the
# signed parent, and test. before the root. Get this backwards and every signed
# zone is bogus for the wrong reason, which is a confusing afternoon.
#
# Algorithms: RSASHA256 (alg 8) almost everywhere, because PKCS#1 v1.5 signing is
# deterministic — the same key over the same RRset yields the same signature.
# wildcard-signed.test deliberately uses ECDSAP256SHA256 (alg 13), the dominant
# real-world algorithm, whose signatures embed a random nonce and so differ on
# every run.
#
# Determinism, measured rather than assumed: the RSA zones' *content* is
# reproducible (identical when sorted), but dnssec-signzone's record *ordering*
# is not stable between runs — roughly 30 lines shuffle each time. So re-signing
# always produces a diff, and a byte-for-byte CI drift check is not possible.
# A sorted-content comparison would work for the alg-8 zones if one is ever
# wanted. In practice this script runs rarely: only when a signed fixture's
# source changes or keys are rolled.
#
# The `; File written on <date>` header dnssec-signzone emits is stripped, so at
# least a build timestamp never lands in a committed file.
#
# Validity is far-future so the "good" fixtures do not rot. expiry.spec.ts fails
# if any of them comes within a year of expiring, so the suite tells you to
# re-sign years before anything breaks mysteriously.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="$(dirname "$HERE")"
ZONES="$PKG/zones"
SRC="$ZONES/src"
KEYS="$ZONES/signed/keys"
OUT_ROOT="$ZONES/signed/root"
OUT_AUTH="$ZONES/signed/auth"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

INCEPTION=20260101000000
EXPIRY=20400101000000

# Children of test., signed and DS-linked. insecure-island.test is deliberately
# absent: it stays unsigned with no DS so it forms a real insecure island.
CHILDREN=(secure.test bogus-zone.test wildcard-signed.test)

mkdir -p "$KEYS" "$OUT_ROOT" "$OUT_AUTH"

# --- tool runner ------------------------------------------------------------
# A pinned container keeps output reproducible across machines. Local BIND tools
# are used when Docker is unavailable (or PROPGATE_SIGN_LOCAL=1); that can differ
# subtly between BIND versions, so prefer the container when committing output.
BIND_IMAGE=internetsystemsconsortium/bind9:9.20

if [[ "${PROPGATE_SIGN_LOCAL:-}" != "1" ]] && command -v docker >/dev/null 2>&1; then
  echo "signing via $BIND_IMAGE"
  bind_tool() {
    # $WORK is mounted as well as $PKG. It is a mktemp directory outside the
    # package, so without this the container cannot see the staged zones and
    # every run fails with "file not found" — which is why this path had never
    # actually run, and the local-tools fallback silently covered for it.
    docker run --rm -u "$(id -u):$(id -g)" \
      -v "$PKG:$PKG" -v "$WORK:$WORK" -w "$1" \
      --entrypoint "$2" "$BIND_IMAGE" "${@:3}"
  }
elif command -v dnssec-signzone >/dev/null 2>&1; then
  echo "signing with local BIND tools ($(dnssec-signzone -h 2>&1 | head -1 || true))"
  echo "  note: commit output produced by $BIND_IMAGE where possible" >&2
  bind_tool() {
    local dir="$1" cmd="$2"
    shift 2
    (cd "$dir" && "$cmd" "$@")
  }
else
  echo "error: need Docker or local BIND tools (dnssec-signzone)" >&2
  exit 1
fi

keygen() { bind_tool "$KEYS" dnssec-keygen "$@"; }
signzone() { bind_tool "$WORK" dnssec-signzone "$@"; }

# --- keys -------------------------------------------------------------------
# Idempotent: existing keys are reused, so re-signing does not churn every
# signature. Delete a zone's keys to force a rollover.
# BIND names key files K<fqdn>+<alg>+<tag>, where <fqdn> carries its trailing
# dot — so the root's keys are K.+008+NNNNN, not K..+008+NNNNN. Getting this
# wrong makes the existence check never match for the root, so every run
# generates a fresh root KSK, which rewrites the trust anchor and invalidates
# the entire committed chain. Silent, and thoroughly confusing.
key_prefix_for() {
  if [[ "$1" == "." ]]; then
    printf 'K.+'
  else
    printf 'K%s.+' "$1"
  fi
}

ensure_keys() {
  local zone="$1" algo="$2" ksk_bits="$3" zsk_bits="$4"
  local prefix
  prefix="$(key_prefix_for "$zone")"

  if compgen -G "$KEYS/$prefix*.key" >/dev/null; then
    return
  fi

  echo "  generating keys for $zone ($algo)"
  if [[ -n "$ksk_bits" ]]; then
    keygen -a "$algo" -b "$ksk_bits" -f KSK -n ZONE "$zone" >/dev/null
    keygen -a "$algo" -b "$zsk_bits" -n ZONE "$zone" >/dev/null
  else
    keygen -a "$algo" -f KSK -n ZONE "$zone" >/dev/null
    keygen -a "$algo" -n ZONE "$zone" >/dev/null
  fi
}

# -S is smart signing: dnssec-signzone finds the zone's keys in -K and adds the
# DNSKEY RRset itself. Without it, dnssec-signzone expects the DNSKEY records to
# already be present in the zone file and fails with the memorable-but-unhelpful
# "failed to find keys at the zone apex".
sign_one() {
  local zone="$1" origin="$2" output="$3"

  cp "$SRC/$zone.zone" "$WORK/$zone.zone"
  signzone -S -o "$origin" -K "$KEYS" -N keep \
    -s "$INCEPTION" -e "$EXPIRY" -P \
    -f "$output" -d "$WORK" "$WORK/$zone.zone" >/dev/null

  # Drop the generated header so a wall-clock timestamp and the local BIND
  # version string never get committed.
  grep -v -e '^; File written on ' -e '^; dnssec_signzone version ' \
    "$output" > "$output.tmp"
  mv "$output.tmp" "$output"
}

# --- DS injection -----------------------------------------------------------
# Rewrites the block between the markers in a source zone. Idempotent, so the
# script can be re-run without accumulating duplicate DS records.
inject_ds() {
  local target="$1" dsfile="$2"

  awk -v dsfile="$dsfile" '
    /^; BEGIN GENERATED DS$/ {
      print
      while ((getline line < dsfile) > 0) {
        print line
      }
      close(dsfile)
      skip = 1
      next
    }
    /^; END GENERATED DS$/ { skip = 0 }
    !skip { print }
  ' "$target" > "$target.tmp"

  mv "$target.tmp" "$target"
}

# --- sign the children ------------------------------------------------------
echo "signing children of test."
: > "$WORK/child-ds"

for zone in "${CHILDREN[@]}"; do
  if [[ "$zone" == "wildcard-signed.test" ]]; then
    ensure_keys "$zone" ECDSAP256SHA256 "" ""
  else
    ensure_keys "$zone" RSASHA256 2048 1024
  fi

  sign_one "$zone" "$zone" "$OUT_AUTH/$zone.zone.signed"

  cat "$WORK/dsset-$zone." >> "$WORK/child-ds"
  echo "  $zone"
done

inject_ds "$SRC/test.zone" "$WORK/child-ds"

# --- sign test. -------------------------------------------------------------
echo "signing test."
ensure_keys test RSASHA256 2048 1024
sign_one test test "$OUT_ROOT/test.zone.signed"

inject_ds "$SRC/root.zone" "$WORK/dsset-test."

# --- sign the root ----------------------------------------------------------
echo "signing the root"
ensure_keys . RSASHA256 2048 1024
sign_one root . "$OUT_ROOT/root.zone.signed"

# --- trust anchor -----------------------------------------------------------
# The root KSK's DNSKEY, in zone-file form, is the validating resolver's only
# trust anchor. Deliberately a static file: `auto-trust-anchor-file` plus
# unbound-anchor would reach for the REAL root KSK, against which every fixture
# answer is bogus.
echo "writing root.anchor"
{
  echo "; propgate fixture root trust anchor. Regenerated by scripts/sign.sh."
  echo "; This signs a fake root under RFC 6761 .test — it protects nothing."
  grep -h 'DNSKEY.*257' "$KEYS"/K.+*.key | grep -v '^;'
} > "$ZONES/signed/root.anchor"

# --- break the bogus zone ---------------------------------------------------
# Last, so signing itself stays clean and only this step introduces the fault.
# Corrupting the DNSKEY RRSIG makes the whole zone bogus — the botched-key-rollover
# case, and the more common real-world failure than a single bad RRset.
echo "corrupting bogus-zone.test"
node "$HERE/corrupt-rrsig.mjs" "$OUT_AUTH/bogus-zone.test.zone.signed" DNSKEY

# --- revision ---------------------------------------------------------------
node "$HERE/revision.mjs" --write >/dev/null
echo "revision: $(cat "$PKG/REVISION")"
echo "done"
