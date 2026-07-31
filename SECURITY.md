# Security Policy

## Supported versions

AegisFlow is pre-release software. Security fixes are applied to the latest `main` branch only.
Do not expose a development build or the default local Compose configuration to the internet.

## Reporting a vulnerability

Do not open a public issue. Use GitHub private vulnerability reporting when the repository is
published, or contact the maintainers through the private channel listed in the repository
profile. Include affected version, impact, reproduction steps, and suggested mitigation when
available. Do not include real credentials, personal data, or third-party secrets.

The maintainers will acknowledge a complete report within five business days and coordinate a
remediation and disclosure timeline based on severity.

## Operational requirements

- Replace every example credential; `200520` is allowed only for local PostgreSQL development.
- Terminate TLS at a trusted ingress and enable HSTS only after HTTPS is enforced.
- Store secrets in a managed secret store and rotate them after suspected exposure.
- Keep PostgreSQL, Redis, MinIO, Prometheus and Grafana off public networks.
- Run the documented CI and security checks before release.
- Never upload production evidence or private RAG documents into demo environments.

Threat models live under `docs/threat-model/` and evolve with every phase.
