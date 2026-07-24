import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createBundleUrl,
  missingRequiredEnvironment,
  normalizeRegistryUrl,
  railwayAgentDefinition,
  requestDistributionBundle,
  validateDistributionBundle,
  validateRelativeFilePath,
} from "./prepare-agent.mjs";

function file(path, contents) {
  const data = Buffer.from(contents);

  return {
    path,
    mimeType: "text/plain",
    sizeBytes: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
    encoding: "base64",
    data: data.toString("base64"),
  };
}

function bundle(files = [file("instructions.md", "Use evidence.")]) {
  return {
    schemaVersion: 1,
    access: { tier: "public" },
    agent: {
      slug: "research-agent",
      title: "Research Agent",
      version: "1.0.0",
      license: "MIT",
    },
    integration: null,
    requirements: [],
    revision: "abc123",
    files,
  };
}

test("validates registry URLs and builds the selected bundle URL", () => {
  assert.equal(
    normalizeRegistryUrl("https://www.eveagents.dev/api/registry/v1/"),
    "https://www.eveagents.dev/api/registry/v1",
  );
  assert.equal(
    createBundleUrl(
      "https://www.eveagents.dev/api/registry/v1",
      "research-agent",
      "discord",
    ).toString(),
    "https://www.eveagents.dev/api/registry/v1/agents/research-agent?integration=discord",
  );
  assert.throws(() => normalizeRegistryUrl("http://eveagents.dev/api"));
});

test("validates registry file paths", () => {
  assert.equal(validateRelativeFilePath("skills/research.md"), "skills/research.md");

  for (const unsafePath of [
    "../secret",
    "skills/../secret",
    "/etc/passwd",
    "skills\\secret.md",
    "./agent.ts",
  ]) {
    assert.throws(() => validateRelativeFilePath(unsafePath));
  }
});

test("verifies every distributed file before returning it", () => {
  const validated = validateDistributionBundle(bundle(), {
    agentSlug: "research-agent",
    integrationSlug: null,
  });

  assert.equal(validated.files[0].contents.toString(), "Use evidence.");

  const tampered = bundle();
  tampered.files[0].data = Buffer.from("Use evidencf.").toString("base64");

  assert.throws(
    () =>
      validateDistributionBundle(tampered, {
        agentSlug: "research-agent",
        integrationSlug: null,
      }),
    /integrity validation/,
  );
});

test("reports only missing required integration variables", () => {
  const requirements = [
    { kind: "environment_variable", name: "BOT_TOKEN", isRequired: true },
    { kind: "environment_variable", name: "OPTIONAL_ID", isRequired: false },
    { kind: "setup_step", name: "Create an app", isRequired: true },
  ];

  assert.deepEqual(missingRequiredEnvironment(requirements, {}), ["BOT_TOKEN"]);
  assert.deepEqual(
    missingRequiredEnvironment(requirements, { BOT_TOKEN: "secret" }),
    [],
  );
});

test("generates an Eve model definition for every supported provider", () => {
  const definition = railwayAgentDefinition();

  assert.match(definition, /@ai-sdk\/openai/);
  assert.match(definition, /@ai-sdk\/anthropic/);
  assert.match(definition, /@ai-sdk\/google/);
  assert.match(definition, /EVE_PROVIDER_API_KEY/);
  assert.match(definition, /"openai\/gpt-5\.4-mini"/);
  assert.match(definition, /case "openai"/);
  assert.match(definition, /case "anthropic"/);
  assert.match(definition, /case "google"/);
});

test("authenticates every registry bundle request with the user API key", async () => {
  const originalFetch = globalThis.fetch;
  let authorization = null;

  globalThis.fetch = async (_url, options) => {
    authorization = options?.headers?.Authorization ?? null;
    return new Response(JSON.stringify(bundle()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await requestDistributionBundle({
      registryUrl: "https://www.eveagents.dev/api/registry/v1",
      agentSlug: "research-agent",
      integrationSlug: null,
      apiKey: "eva_live_example",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(authorization, "Bearer eva_live_example");
});
