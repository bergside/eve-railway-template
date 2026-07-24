[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/eve-agent-template?referralCode=lAH3cp&utm_medium=integration&utm_source=template&utm_campaign=generic)

# EveAgents Railway template

Deploy one published [EveAgents](https://www.eveagents.dev) agent as a
long-running Eve service on Railway.

1. Choose an agent on EveAgents.
2. Create and copy a key from the [API Keys page](https://www.eveagents.dev/dashboard/api-keys).
3. Paste it into `EVEAGENTS_API_KEY` when Railway asks.

That is the only EveAgents key the template needs.

## How distribution works

1. `EVE_AGENT_SLUG` selects a published base agent.
2. Optional `EVE_INTEGRATION_SLUG` selects an assigned integration variant.
3. The build uses `EVEAGENTS_API_KEY` to download the selected agent.
4. Every path, size, and SHA-256 digest is validated before a file is written.
5. The template replaces only the model, Eve web channel, and sandbox adapters
   needed for a portable Railway service.
6. Eve builds and starts the selected agent on Railway's assigned `PORT`.
7. After the healthcheck passes, the running service registers its generated
   Railway domain with the owning EveAgents account so it appears in
   [Agents Playground](https://www.eveagents.dev/dashboard/agents-playground).

Each EveAgents API key can download an agent up to 10 times per UTC day. You
can revoke a key at any time from the API Keys page.

Agents Playground asks the user for the separate route username and password
when they connect. The template does not send those route credentials to the
registry, and EveAgents does not store them.

## Railway variables

| Variable | Configuration |
| --- | --- |
| `EVE_AGENT_SLUG` | Required; the selected agent slug |
| `EVE_INTEGRATION_SLUG` | Optional; blank for the base agent |
| `EVEAGENTS_REGISTRY_URL` | Fixed template value: `https://www.eveagents.dev/api/registry/v1` |
| `EVEAGENTS_API_KEY` | Your key from the EveAgents API Keys page |
| `EVE_PROVIDER_API_KEY` | Required API key for the provider selected by `EVE_MODEL` |
| `EVE_MODEL` | Provider-qualified model ID; default: `openai/gpt-5.4-mini` |
| `ROUTE_AUTH_BASIC_USER` | Default: `eve` |
| `ROUTE_AUTH_BASIC_PASSWORD` | Generated with `${{ secret(32) }}` |

Integration variants can require additional variables. Add every required value
listed on the corresponding EveAgents integration page before deploying.

`ROUTE_AUTH_BASIC_USER` and `ROUTE_AUTH_BASIC_PASSWORD` are separate from the
EveAgents API key. Railway generates the password automatically; these values
protect the deployed agent's public Eve routes from unauthorized use.

The template currently supports OpenAI, Claude, and Gemini through the official
AI SDK provider adapters. Use one matching pair:

- `openai/gpt-5.4-mini` with an OpenAI API key
- `anthropic/claude-sonnet-4-6` with a Claude API key
- `google/gemini-3.6-flash` with a Gemini API key

Paste the selected provider's secret into `EVE_PROVIDER_API_KEY`. The generic
variable keeps the Railway template simple and prevents unused provider keys
from being requested.

## Railway service settings

- Source: `https://github.com/bergside/eve-railway-template`
- Config file path: `/railway.json`
- Public networking: HTTP enabled
- Healthcheck: `/eve/v1/health`
- Persistent volume: `/app/.eve/.workflow-data`

## Current integration compatibility

Standalone agents and direct-credential channels run entirely on Railway.
Slack and MCP/OpenAPI connection variants currently use Vercel Connect and need
a separately configured Connect authorization path at runtime because Railway
does not inject Vercel deployment OIDC.

## Local verification

Use Node 24 or later:

```bash
cp .env.example .env
npm install
npm test
npm run build
npm start
```

The default health endpoint is `http://localhost:3000/eve/v1/health`.

## License

MIT
