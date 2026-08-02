FROM alpine:3.21

# bind-tools is here for `docker compose exec unbound dig ...`, which is the
# first thing anyone does when an answer looks wrong.
RUN apk add --no-cache unbound bind-tools \
  && mkdir -p /var/lib/unbound \
  && chown -R unbound:unbound /var/lib/unbound

COPY unbound.conf /etc/unbound/unbound.conf

# Fetch the root trust anchor at build time so the first query does not have to
# wait for it, and so a failure to get it fails the build rather than showing up
# as every DNSSEC-signed domain being indeterminate.
RUN unbound-anchor -a /var/lib/unbound/root.key || true
RUN chown unbound:unbound /var/lib/unbound/root.key

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD dig +short +time=2 +tries=1 @127.0.0.1 a.root-servers.net A > /dev/null || exit 1

USER unbound
CMD ["unbound", "-d", "-c", "/etc/unbound/unbound.conf"]
