# One image, several roles. NSD serves authoritative zones; Unbound provides the
# validating and non-validating resolver tiers.
#
# Why not CoreDNS, which the first draft of the README named: its `dnssec` plugin
# is an *online signer*, so it physically cannot serve the deliberately-bogus and
# expired signatures this harness exists to produce, and its `file` plugin's
# pre-signed support is unreliable for NSEC3 and for signing negative answers.
#
# Why NSD rather than Knot or PowerDNS: those two actively repair or reject
# pathological zones (illegal MX-to-CNAME, contradictory RRsets, invalid
# signatures). That correctness is exactly what we need in the Phase 3
# production fleet and exactly what disqualifies them here. NSD is lenient,
# ships no signer at all, and serves pre-signed zones verbatim.
#
# Signing happens offline via packages/dns-fixtures/scripts/sign.sh in a pinned
# BIND container, so this image contains no signing tooling and cannot
# accidentally re-sign a zone whose brokenness is the point.
FROM alpine:3.22

RUN apk add --no-cache nsd unbound bind-tools \
  && mkdir -p /fixtures /etc/nsd /etc/unbound /var/db/nsd /var/lib/unbound \
  && chown -R nsd:nsd /var/db/nsd

# Baked in so the image is self-contained; docker-compose.yml also bind-mounts
# the same path, and the mount wins locally so editing a zone plus `pnpm
# dns:reload` is instant with no rebuild.
COPY packages/dns-fixtures/zones /fixtures/zones
COPY packages/dns-fixtures/REVISION /fixtures/REVISION

COPY docker/dns/nsd/ /etc/nsd/templates/
COPY docker/dns/unbound/ /etc/unbound/templates/
COPY docker/dns/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
