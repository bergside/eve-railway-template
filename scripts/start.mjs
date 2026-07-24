import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { setTimeout as wait } from "node:timers/promises";

const HEALTH_ATTEMPTS = 120;
const REGISTRATION_ATTEMPTS = 5;

function railwayRegistration() {
  const values = {
    apiKey: process.env.EVEAGENTS_API_KEY?.trim(),
    registryUrl: process.env.EVEAGENTS_REGISTRY_URL?.trim(),
    agentSlug: process.env.EVE_AGENT_SLUG?.trim(),
    integrationSlug: process.env.EVE_INTEGRATION_SLUG?.trim() || null,
    publicDomain: process.env.RAILWAY_PUBLIC_DOMAIN?.trim(),
    projectId: process.env.RAILWAY_PROJECT_ID?.trim(),
    serviceId: process.env.RAILWAY_SERVICE_ID?.trim(),
    environmentId: process.env.RAILWAY_ENVIRONMENT_ID?.trim(),
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID?.trim() || null,
  };

  if (
    !values.apiKey ||
    !values.registryUrl ||
    !values.agentSlug ||
    !values.publicDomain ||
    !values.projectId ||
    !values.serviceId ||
    !values.environmentId
  ) {
    return null;
  }

  const endpoint = new URL(values.registryUrl);
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/deployments`;
  endpoint.search = "";
  endpoint.hash = "";

  return {
    endpoint,
    apiKey: values.apiKey,
    payload: {
      platform: "railway",
      agentSlug: values.agentSlug,
      integrationSlug: values.integrationSlug,
      publicUrl: `https://${values.publicDomain}`,
      projectId: values.projectId,
      serviceId: values.serviceId,
      environmentId: values.environmentId,
      deploymentId: values.deploymentId,
    },
  };
}

async function waitForAgent(child) {
  const port = process.env.PORT?.trim() || "3000";
  const healthUrl = `http://127.0.0.1:${port}/eve/v1/health`;

  for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) {
      return false;
    }

    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(2_000),
      });

      if (response.ok) {
        return true;
      }
    } catch {
      // The Eve server is still starting.
    }

    await wait(1_000);
  }

  return false;
}

async function registerDeployment(child) {
  const registration = railwayRegistration();

  if (!registration) {
    console.info(
      "Skipping EveAgents deployment registration outside a complete Railway environment.",
    );
    return;
  }

  if (!(await waitForAgent(child))) {
    console.warn(
      "Eve started without registering in Agents Playground because its health endpoint was not ready.",
    );
    return;
  }

  for (let attempt = 1; attempt <= REGISTRATION_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(registration.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${registration.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(registration.payload),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        console.info("Registered this service in EveAgents Agents Playground.");
        return;
      }

      const result = await response.json().catch(() => null);
      const message =
        result && typeof result.message === "string"
          ? result.message
          : `registration returned HTTP ${response.status}`;

      if (response.status >= 400 && response.status < 500) {
        console.warn(`EveAgents deployment registration failed: ${message}`);
        return;
      }
    } catch {
      // Railway's public route or the registry may still be converging.
    }

    await wait(attempt * 2_000);
  }

  console.warn(
    "Eve is running, but this service could not be added to Agents Playground automatically.",
  );
}

const eveBinary = path.resolve(process.cwd(), "node_modules/.bin/eve");
const child = spawn(eveBinary, ["start", "--host", "0.0.0.0"], {
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    child.kill(signal);
  });
}

void registerDeployment(child);

const exit = await new Promise((resolve) => {
  child.once("error", (error) => {
    console.error("Unable to start Eve:", error);
    resolve({ code: 1, signal: null });
  });
  child.once("exit", (code, signal) => {
    resolve({ code, signal });
  });
});

if (exit.signal) {
  process.kill(process.pid, exit.signal);
} else {
  process.exitCode = exit.code ?? 1;
}
