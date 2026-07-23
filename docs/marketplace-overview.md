# Deploy and host Eve agents with Railway

Deploy a published EveAgents registry entry as a long-running Eve service on
Railway. Choose a standalone agent or assigned integration variant, provide its
runtime credentials, and let the template securely fetch, verify, build, expose,
and healthcheck the service.

## What the template provides

- Versioned, API-key-authenticated distribution without database keys
- SHA-256 integrity validation for every agent file
- Direct OpenAI model access
- Basic authentication for public Eve session routes
- Railway healthchecks and restart policy
- Persistent local workflow-state storage
- Revocable account API keys with a 20-request hourly setup limit

## Common use cases

- Deploy a standalone workflow agent without creating a repository.
- Run a Discord, GitHub, or other direct-credential channel variant.
- Host operations, product, support, analytics, or research agents.
- Keep all deployment secrets inside the user's Railway project.

For the complete guide, visit
`https://www.eveagents.dev/deploy/railway`.
