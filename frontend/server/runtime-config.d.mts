export interface RuntimeConfiguration {
  appEnvironment: "local" | "test" | "production";
  internalNetworkSignalSecret: string;
  recipeApiUrl: string;
  supervisorHeartbeat: {
    path: "/run/recipe-lab-supervisor/heartbeat";
    ttlSeconds: number;
  } | null;
  trustedProxyCidrs: readonly string[];
  trustedProxyProofSecret: string | null;
}

export function runtimeConfiguration(
  environment?: Record<string, string | undefined>,
  options?: { development?: boolean },
): RuntimeConfiguration;
