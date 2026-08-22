FROM alpine:3.21

RUN apk add --no-cache unbound bind-tools \
  && mkdir -p /var/lib/unbound \
  && chown -R unbound:unbound /var/lib/unbound

COPY unbound.conf /etc/unbound/unbound.conf

RUN unbound-anchor -a /var/lib/unbound/root.key || true
RUN chown unbound:unbound /var/lib/unbound/root.key

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD dig +short +time=2 +tries=1 @127.0.0.1 a.root-servers.net A > /dev/null || exit 1

USER unbound
CMD ["unbound", "-d", "-c", "/etc/unbound/unbound.conf"]
