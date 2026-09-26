# Observability

## Pillars

| Pillar | Tool | Retention |
|--------|------|-----------|
| Logs | Loki / Datadog | 30d |
| Metrics | Prometheus | 90d |
| Traces | OpenTelemetry / Tempo | 7d |
| Errors | GlitchTip (Sentry-SDK compatible) | 90d |
| Uptime | Better Stack (free tier: 10 monitors, 3-min checks, status page; one account per client) | — |

## Logging

- Format: JSON, one line per event.
- Required fields: `ts` (ISO-8601 UTC), `level`, `service`, `trace_id`, `user_id`, `event`.
- No PII in logs.

## Metrics (RED + USE)

- Requests/sec, Errors/sec, Duration p50/p95/p99 per endpoint.
- DB connections, queue depth, cache hit ratio.

## SLOs

| Service | SLI | SLO | Window |
|---------|-----|-----|--------|
| API | availability | 99.9% | 30d |
| API | p95 latency | < 300ms | 30d |

## Alerts

- Page on: SLO burn rate, DB down, queue depth > X.
- Ticket on: warning thresholds.

## Dashboards

- Overview, API, DB, Worker, Business KPIs.
