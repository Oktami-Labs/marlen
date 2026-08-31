import { request as httpRequest } from "node:http";

/** Send an exact Host header without fetch or Playwright rewriting it. */

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export function rawRequest(
  baseURL: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  const url = new URL(path, baseURL);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: "GET",
        // setHost false, or Node appends its own Host after ours.
        setHost: false,
        headers: { host: url.host, ...headers },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}
