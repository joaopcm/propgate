FROM alpine:3.22

RUN apk add --no-cache nsd unbound bind-tools \
  && mkdir -p /fixtures /etc/nsd /etc/unbound /var/db/nsd /var/lib/unbound \
  && chown -R nsd:nsd /var/db/nsd

COPY packages/dns-fixtures/zones /fixtures/zones
COPY packages/dns-fixtures/REVISION /fixtures/REVISION

COPY docker/dns/nsd/ /etc/nsd/templates/
COPY docker/dns/unbound/ /etc/unbound/templates/
COPY docker/dns/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
