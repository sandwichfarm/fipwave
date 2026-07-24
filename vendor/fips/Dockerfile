FROM rust:1.94.1-bookworm AS build
WORKDIR /src
RUN apt-get update \
  && apt-get install -y --no-install-recommends pkg-config libdbus-1-dev libclang-dev \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN cargo build --locked --release --bin fips

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends libdbus-1-3 iproute2 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/fips /usr/local/bin/fips
# The Compose service drops every default capability and adds only NET_ADMIN.
# FIPS must remain UID 0 so that capability is effective when it creates fips0.
CMD ["/usr/local/bin/fips"]
