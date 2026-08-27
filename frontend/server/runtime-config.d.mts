export interface RuntimeConfiguration {
  appEnvironment: "local" | "test" | "production";
  internalNetworkSignalSecret: string;
  recipeApiUrl: string;
}

export function runtimeConfiguration(
  environment?: Record<string, string | undefined>,
  options?: { development?: boolean },
): RuntimeConfiguration;
