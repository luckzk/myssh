# 后端构建：多阶段，产出单二进制。
FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -o /out/ntserver ./cmd/server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out/ntserver /app/ntserver
ENV NT_ADDR=:8088 NT_DB_DSN=/data/nt.db
VOLUME /data
EXPOSE 8088
ENTRYPOINT ["/app/ntserver"]
