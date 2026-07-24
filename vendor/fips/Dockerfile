FROM rust:1.94.1-bookworm AS build
WORKDIR /src
COPY . .
RUN cargo build --locked --release --bin fips

FROM debian:bookworm-slim
COPY --from=build /src/target/release/fips /usr/local/bin/fips
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/fips"]
