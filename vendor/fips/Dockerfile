FROM rust:1.94.1-bookworm AS build
WORKDIR /src
RUN apt-get update \
  && apt-get install -y --no-install-recommends pkg-config libdbus-1-dev \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN cargo build --locked --release --bin fips

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends libdbus-1-3 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/fips /usr/local/bin/fips
USER 65532:65532
CMD ["/usr/local/bin/fips"]
