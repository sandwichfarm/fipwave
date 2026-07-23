# alpine:3.21.3 is recorded alongside the immutable multi-architecture digest.
FROM alpine:3.21.3@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c

RUN apk add --no-cache iproute2

COPY --chmod=0755 scripts/preflight-tun.sh /usr/local/bin/preflight-tun

ENTRYPOINT ["/usr/local/bin/preflight-tun"]
