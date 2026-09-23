import {
  internalNetworkSignalSecret,
  trustedProxyConfiguration,
} from "./trusted-network-signal.mjs";

const APP_ENVIRONMENTS = new Set(["local", "test", "production"]);
const SUPERVISOR_HEARTBEAT_PATH = "/run/recipe-lab-supervisor/heartbeat";

function applicationEnvironment(environment, development) {
  const configured = environment.APP_ENVIRONMENT?.trim();
  const value = configured || (development ? "local" : "production");
  if (!APP_ENVIRONMENTS.has(value)) {
    throw new Error("APP_ENVIRONMENT must be local, test, or production.");
  }
  return value;
}

function recipeApiUrl(environment, appEnvironment) {
  const configured = environment.RECIPE_API_URL?.trim();
  if (!configured && appEnvironment === "production") {
    throw new Error("RECIPE_API_URL must be configured in production.");
  }

  let url;
  try {
    url = new URL(configured || "http://localhost:8000");
  } catch {
    throw new Error(
      "RECIPE_API_URL must be an HTTP(S) origin without credentials, a path, a query, or a hash.",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "RECIPE_API_URL must be an HTTP(S) origin without credentials, a path, a query, or a hash.",
    );
  }
  return url.origin;
}

function supervisorHeartbeat(environment) {
  const configuredPath = environment.SANDBOX_SUPERVISOR_HEARTBEAT_PATH?.trim();
  const configuredTtl =
    environment.SANDBOX_SUPERVISOR_HEARTBEAT_TTL_SECONDS?.trim();
  if (!configuredPath && !configuredTtl) {
    return null;
  }
  if (!configuredPath || !configuredTtl) {
    throw new Error(
      "SANDBOX_SUPERVISOR_HEARTBEAT_PATH and SANDBOX_SUPERVISOR_HEARTBEAT_TTL_SECONDS must be configured together.",
    );
  }
  if (configuredPath !== SUPERVISOR_HEARTBEAT_PATH) {
    throw new Error(
      `SANDBOX_SUPERVISOR_HEARTBEAT_PATH must be ${SUPERVISOR_HEARTBEAT_PATH}.`,
    );
  }
  if (!/^[1-9]\d{0,2}$/.test(configuredTtl)) {
    throw new Error(
      "SANDBOX_SUPERVISOR_HEARTBEAT_TTL_SECONDS must be an integer between 1 and 300.",
    );
  }
  const ttlSeconds = Number(configuredTtl);
  if (ttlSeconds > 300) {
    throw new Error(
      "SANDBOX_SUPERVISOR_HEARTBEAT_TTL_SECONDS must be an integer between 1 and 300.",
    );
  }
  return Object.freeze({ path: SUPERVISOR_HEARTBEAT_PATH, ttlSeconds });
}

export function runtimeConfiguration(
  environment = process.env,
  { development = false } = {},
) {
  const appEnvironment = applicationEnvironment(environment, development);
  if (!development && appEnvironment !== "production") {
    throw new Error("APP_ENVIRONMENT must be production for the production server.");
  }
  const signalEnvironment = {
    ...environment,
    NODE_ENV: appEnvironment === "production" ? "production" : "development",
  };
  const trustedProxy = trustedProxyConfiguration(environment);
  return Object.freeze({
    appEnvironment,
    internalNetworkSignalSecret: internalNetworkSignalSecret(signalEnvironment),
    recipeApiUrl: recipeApiUrl(environment, appEnvironment),
    supervisorHeartbeat: supervisorHeartbeat(environment),
    trustedProxyCidrs: trustedProxy.cidrs,
    trustedProxyProofSecret: trustedProxy.proofSecret,
  });
}
