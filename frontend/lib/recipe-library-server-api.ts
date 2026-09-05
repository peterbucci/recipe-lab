import "server-only";

import { serverApiRequest } from "../shared/api/server";
import { ApiTransportError } from "../shared/api/core";
import {
  parsePublicCookProfilePage,
  type PublicCookProfilePage,
  type PublicCookProfileWire,
} from "../features/recipes/shared/public-cook-profile";
import {
  RECIPE_LIBRARY_ERROR_CONTRACT,
  recipeLibraryErrorFromTransport as fromTransportError,
} from "../features/recipes/shared/recipe-library-error";

export async function fetchPublicCookProfile({
  handle,
  page = 1,
  pageSize = 12,
}: {
  handle: string;
  page?: number;
  pageSize?: number;
}): Promise<PublicCookProfilePage | null> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  try {
    const response = await serverApiRequest(
      `/api/cooks/${encodeURIComponent(handle)}?${query.toString()}`,
      { errorContract: RECIPE_LIBRARY_ERROR_CONTRACT, kind: "query", retry: "never" },
    );
    const payload = response.data as PublicCookProfileWire;
    return parsePublicCookProfilePage(payload);
  } catch (error) {
    if (error instanceof ApiTransportError) {
      if (error.status === 404) return null;
      throw fromTransportError(error);
    }
    throw error;
  }
}
