import { handleDocsRequest } from "./lib/negotiate";

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
