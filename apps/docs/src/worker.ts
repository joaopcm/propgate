import { handleDocsRequest } from "./lib/negotiate";

/**
 * Cloudflare adapter. The decision lives in `negotiate.ts`.
 *
 * Pages stay a static export. This Worker only runs because Accept
 * negotiation, a markdown 404, and JSON errors for unknown `/v1/*` paths
 * cannot be files.
 */

export interface Env {
  readonly ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleDocsRequest(request, (assetRequest) =>
      env.ASSETS.fetch(assetRequest)
    );
  },
};
