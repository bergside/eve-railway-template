import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ENVIRONMENT_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const MAX_BUNDLE_FILES = 500;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function optionalSlug(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    return null;
  }

  if (!SLUG_PATTERN.test(value)) {
    throw new Error(`${name} must be a lowercase kebab-case slug.`);
  }

  return value;
}

function requiredApiKey() {
  const value = requiredEnvironment("EVEAGENTS_API_KEY");

  if (/\s/.test(value)) {
    throw new Error("EVEAGENTS_API_KEY must not contain whitespace.");
  }

  return value;
}

export function normalizeRegistryUrl(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error("EVEAGENTS_REGISTRY_URL must be a valid absolute URL.");
  }

  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);

  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    throw new Error(
      "EVEAGENTS_REGISTRY_URL must use HTTPS outside local development.",
    );
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "EVEAGENTS_REGISTRY_URL must not contain credentials, a query, or a hash.",
    );
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function createBundleUrl(registryUrl, agentSlug, integrationSlug) {
  const url = new URL(
    `${normalizeRegistryUrl(registryUrl)}/agents/${encodeURIComponent(agentSlug)}`,
  );

  if (integrationSlug) {
    url.searchParams.set("integration", integrationSlug);
  }

  return url;
}

export function validateRelativeFilePath(filePath) {
  if (
    typeof filePath !== "string" ||
    filePath.length === 0 ||
    filePath.length > 512 ||
    filePath.includes("\\") ||
    filePath.includes("\0") ||
    path.posix.isAbsolute(filePath)
  ) {
    throw new Error(`Unsafe agent file path: ${String(filePath)}`);
  }

  const normalized = path.posix.normalize(filePath);

  if (
    normalized !== filePath ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(`Unsafe agent file path: ${filePath}`);
  }

  return normalized;
}

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`The distribution bundle has an invalid ${label}.`);
  }

  return value;
}

function stringValue(value, label) {
  if (typeof value !== "string" || !value) {
    throw new Error(`The distribution bundle has an invalid ${label}.`);
  }

  return value;
}

function decodeFileData(file, safePath) {
  const data = stringValue(file.data, `data value for ${safePath}`);

  if (
    data.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      data,
    )
  ) {
    throw new Error(`The source file ${safePath} has invalid base64 data.`);
  }

  const contents = Buffer.from(data, "base64");

  if (contents.toString("base64") !== data) {
    throw new Error(`The source file ${safePath} has non-canonical base64 data.`);
  }

  return contents;
}

function validateRequirement(value) {
  const requirement = objectValue(value, "requirement");
  const kind = stringValue(requirement.kind, "requirement kind");
  const name = stringValue(requirement.name, "requirement name");

  if (!['environment_variable', 'setup_step'].includes(kind)) {
    throw new Error(`The distribution bundle has an invalid requirement kind.`);
  }

  if (kind === "environment_variable" && !ENVIRONMENT_NAME_PATTERN.test(name)) {
    throw new Error(`The distribution bundle has an invalid environment name.`);
  }

  return {
    kind,
    name,
    description:
      typeof requirement.description === "string" ? requirement.description : "",
    setupInstructions:
      typeof requirement.setupInstructions === "string"
        ? requirement.setupInstructions
        : "",
    documentationUrl:
      typeof requirement.documentationUrl === "string"
        ? requirement.documentationUrl
        : null,
    isRequired: requirement.isRequired === true,
    isSecret: requirement.isSecret === true,
  };
}

export function validateDistributionBundle(
  value,
  { agentSlug, integrationSlug },
) {
  const bundle = objectValue(value, "root object");

  if (bundle.schemaVersion !== 1) {
    throw new Error("The distribution bundle uses an unsupported schema version.");
  }

  const access = objectValue(bundle.access, "access descriptor");

  if (!['public', 'pro'].includes(access.tier)) {
    throw new Error("The distribution bundle has an invalid access tier.");
  }

  const agent = objectValue(bundle.agent, "agent descriptor");

  if (agent.slug !== agentSlug) {
    throw new Error("The distribution bundle returned a different agent.");
  }

  const integration = bundle.integration;

  if (
    (integrationSlug === null && integration !== null) ||
    (integrationSlug !== null &&
      objectValue(integration, "integration descriptor").slug !== integrationSlug)
  ) {
    throw new Error("The distribution bundle returned a different integration.");
  }

  if (!Array.isArray(bundle.files) || bundle.files.length === 0) {
    throw new Error("The distribution bundle does not contain source files.");
  }

  if (bundle.files.length > MAX_BUNDLE_FILES) {
    throw new Error(`The distribution bundle exceeds ${MAX_BUNDLE_FILES} files.`);
  }

  const seenPaths = new Set();
  let totalBytes = 0;
  const files = bundle.files.map((value) => {
    const file = objectValue(value, "file entry");
    const safePath = validateRelativeFilePath(file.path);

    if (seenPaths.has(safePath)) {
      throw new Error(`The distribution bundle repeats ${safePath}.`);
    }

    seenPaths.add(safePath);

    if (file.encoding !== "base64") {
      throw new Error(`The source file ${safePath} uses an unsupported encoding.`);
    }

    const contents = decodeFileData(file, safePath);

    if (contents.byteLength > MAX_FILE_BYTES) {
      throw new Error(`The source file ${safePath} exceeds 10 MB.`);
    }

    if (file.sizeBytes !== contents.byteLength) {
      throw new Error(`The source file ${safePath} has an invalid size.`);
    }

    if (
      typeof file.sha256 !== "string" ||
      !SHA256_PATTERN.test(file.sha256) ||
      createHash("sha256").update(contents).digest("hex") !== file.sha256
    ) {
      throw new Error(`The source file ${safePath} failed integrity validation.`);
    }

    totalBytes += contents.byteLength;

    if (totalBytes > MAX_BUNDLE_BYTES) {
      throw new Error("The distribution bundle exceeds 25 MB.");
    }

    return { path: safePath, contents };
  });

  if (!Array.isArray(bundle.requirements)) {
    throw new Error("The distribution bundle has invalid requirements.");
  }

  return {
    agent: {
      slug: agentSlug,
      title: stringValue(agent.title, "agent title"),
      version: stringValue(agent.version, "agent version"),
      license: stringValue(agent.license, "agent license"),
    },
    integration:
      integration === null
        ? null
        : {
            slug: integrationSlug,
            name: stringValue(integration.name, "integration name"),
            type: stringValue(integration.type, "integration type"),
          },
    accessTier: access.tier,
    revision: stringValue(bundle.revision, "revision"),
    requirements: bundle.requirements.map(validateRequirement),
    files,
  };
}

export function missingRequiredEnvironment(requirements, environment) {
  return requirements
    .filter(
      (requirement) =>
        requirement.kind === "environment_variable" && requirement.isRequired,
    )
    .map((requirement) => requirement.name)
    .filter((name) => !environment[name]?.trim());
}

export async function requestDistributionBundle({
  registryUrl,
  agentSlug,
  integrationSlug,
  apiKey,
}) {
  const url = createBundleUrl(registryUrl, agentSlug, integrationSlug);
  const headers = {
    Accept: "application/vnd.eveagents.bundle+json; version=1",
    Authorization: `Bearer ${apiKey}`,
  };

  const response = await fetch(url, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const value = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      value && typeof value.message === "string"
        ? value.message
        : `The registry returned HTTP ${response.status}.`;
    throw new Error(`Unable to download the Eve agent: ${message}`);
  }

  return validateDistributionBundle(value, { agentSlug, integrationSlug });
}

async function writeAgentFile(root, filePath, contents) {
  const safePath = validateRelativeFilePath(filePath);
  const destination = path.resolve(root, ...safePath.split("/"));
  const rootPrefix = `${path.resolve(root)}${path.sep}`;

  if (!destination.startsWith(rootPrefix)) {
    throw new Error(`Unsafe agent file path: ${filePath}`);
  }

  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}

function railwayAgentDefinition() {
  return `import { openai } from "@ai-sdk/openai";
import { defineAgent } from "eve";

export default defineAgent({
  model: openai(process.env.EVE_MODEL ?? "gpt-5.4-mini"),
});
`;
}

function railwayEveChannel() {
  return `import { httpBasic } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

function requiredEnv(name: "ROUTE_AUTH_BASIC_USER" | "ROUTE_AUTH_BASIC_PASSWORD") {
  const value = process.env[name];

  if (!value) {
    throw new Error(\`\${name} is required.\`);
  }

  return value;
}

export default eveChannel({
  auth: [
    httpBasic({
      username: requiredEnv("ROUTE_AUTH_BASIC_USER"),
      password: requiredEnv("ROUTE_AUTH_BASIC_PASSWORD"),
    }),
  ],
});
`;
}

function railwaySandboxDefinition() {
  return `import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";

export default defineSandbox({
  backend: justbash(),
});
`;
}

export async function prepareAgent() {
  const registryUrl = requiredEnvironment("EVEAGENTS_REGISTRY_URL");
  const agentSlug = optionalSlug("EVE_AGENT_SLUG");
  const integrationSlug = optionalSlug("EVE_INTEGRATION_SLUG");
  const apiKey = requiredApiKey();

  if (!agentSlug) {
    throw new Error("EVE_AGENT_SLUG is required.");
  }

  requiredEnvironment("OPENAI_API_KEY");
  requiredEnvironment("ROUTE_AUTH_BASIC_USER");
  requiredEnvironment("ROUTE_AUTH_BASIC_PASSWORD");

  const bundle = await requestDistributionBundle({
    registryUrl,
    agentSlug,
    integrationSlug,
    apiKey,
  });
  const missingEnvironment = missingRequiredEnvironment(
    bundle.requirements,
    process.env,
  );

  if (missingEnvironment.length) {
    throw new Error(
      `Add the required integration variables before deploying: ${missingEnvironment.join(", ")}.`,
    );
  }

  const agentRoot = path.resolve(process.cwd(), "agent");

  await rm(agentRoot, { force: true, recursive: true });
  await mkdir(agentRoot, { recursive: true });

  for (const file of bundle.files) {
    await writeAgentFile(agentRoot, file.path, file.contents);
  }

  await writeAgentFile(agentRoot, "agent.ts", railwayAgentDefinition());
  await writeAgentFile(agentRoot, "channels/eve.ts", railwayEveChannel());
  await writeAgentFile(
    agentRoot,
    "sandbox/sandbox.ts",
    railwaySandboxDefinition(),
  );

  const variant = bundle.integration ? ` with ${bundle.integration.name}` : "";
  console.log(
    `Prepared ${bundle.agent.title}${variant} for Railway (revision ${bundle.revision.slice(0, 12)}).`,
  );
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;

if (entryPoint === import.meta.url) {
  prepareAgent().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
