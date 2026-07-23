# Publish the EveAgents Railway template

## Create the template

Open Railway **Workspace settings → Templates → New Template** and add one
service:

- Source: `https://github.com/bergside/eve-railway-template`
- Branch: `main`
- Config file path: `/railway.json`
- Public networking: HTTP enabled
- Volume mount path: `/app/.eve/.workflow-data`
- Healthcheck path: `/eve/v1/health`

## Template variables

Add these variables in the composer:

| Variable | Template configuration |
| --- | --- |
| `EVE_AGENT_SLUG` | Required, no default; user-entered |
| `EVE_INTEGRATION_SLUG` | Optional, empty default; user-entered |
| `EVEAGENTS_REGISTRY_URL` | Fixed to `https://www.eveagents.dev/api/registry/v1` |
| `EVEAGENTS_API_KEY` | Required user-entered secret created in the EveAgents API Keys dashboard |
| `OPENAI_API_KEY` | Required user-entered secret |
| `EVE_MODEL` | Default `gpt-5.4-mini` |
| `ROUTE_AUTH_BASIC_USER` | Default `eve` |
| `ROUTE_AUTH_BASIC_PASSWORD` | Default `${{ secret(32) }}` |

The fixed registry URL is a public HTTPS API endpoint, not a Supabase URL or
credential. Never add an EveAgents Supabase key to this repository or template.
The user's `EVEAGENTS_API_KEY` authenticates only to that endpoint and is limited
to 20 bundle requests per hour.

## Smoke test

Deploy with:

```dotenv
EVE_AGENT_SLUG=meeting-action-planner
EVE_INTEGRATION_SLUG=
```

Add the runtime secrets, generate a Railway domain, and verify
`/eve/v1/health`.

## Publish and configure EveAgents

Publish the template to Railway's marketplace, then copy the final segment from
its URL:

```text
https://railway.com/new/template/AbC123
                                 ^^^^^^
```

Configure the EveAgents website and redeploy it:

```dotenv
RAILWAY_TEMPLATE_CODE=AbC123
RAILWAY_AFFILIATE_URL=lAH3cp
```

Published marketplace templates are eligible for Railway template kickbacks.
Complete cash payout details from Railway **Account settings → Earnings** if
cash withdrawal is preferred over Railway credits.

## Future Pro distribution

The runtime sends the user's `EVEAGENTS_API_KEY` as a Bearer token. A Pro launch
still requires the EveAgents application to add:

1. An agent access tier and RLS rules that stop direct public source reads.
2. User entitlements or purchases.
3. Account entitlements checked after API-key authentication.
4. Agent-tier authorization in the distribution API.

Do not embed a shared Pro secret in the public Railway template. A template user
ultimately controls their Railway project and can inspect deployed source, so
Pro access can control licensed distribution but cannot make delivered code
unreadable to the entitled user.
