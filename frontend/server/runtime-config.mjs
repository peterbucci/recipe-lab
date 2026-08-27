import { internalNetworkSignalSecret } from "./trusted-network-signal.mjs";

const APP_ENVIRONMENTS = new Set(["local", "test", "production"]);

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
  return Object.freeze({
    appEnvironment,
    internalNetworkSignalSecret: internalNetworkSignalSecret(signalEnvironment),
    recipeApiUrl: recipeApiUrl(environment, appEnvironment),
  });
}
