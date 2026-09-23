import { createServer } from "node:http";
import { connect } from "node:net";

import { describe, expect, it } from "vitest";

import { hardenIncomingNetworkRequest } from "../server.mjs";
import {
  NETWORK_HEADER,
  NETWORK_SIGNATURE_HEADER,
  NETWORK_TIMESTAMP_HEADER,
  PROXY_PROOF_HEADER,
  UNTRUSTED_FORWARDING_HEADERS,
} from "./trusted-network-signal.mjs";

const SIGNAL_SECRET = "incoming-message-integration-signal-secret";
const PROXY_PROOF = "a".repeat(64);

interface RequestSnapshot {
  headers: Record<string, string | string[] | undefined>;
  headersDistinct: Record<string, string[] | undefined>;
  rawHeaders: string[];
  trailers: Record<string, string | string[] | undefined>;
  trailersDistinct: Record<string, string[] | undefined>;
  rawTrailers: string[];
}

function snapshotRecord<Value>(record: Record<string, Value>) {
  return Object.fromEntries(
    Object.entries(record).map(([name, value]) => [
      name,
      Array.isArray(value) ? [...value] : value,
    ]),
  );
}

async function captureRequest(
  path: string,
  rawHeaders: string[],
  trailers: Record<string, string>,
) {
  let resolveSnapshot: (snapshot: RequestSnapshot) => void;
  let rejectSnapshot: (reason: unknown) => void;
  const snapshot = new Promise<RequestSnapshot>((resolve, reject) => {
    resolveSnapshot = resolve;
    rejectSnapshot = reject;
  });
  const server = createServer((incoming, response) => {
    hardenIncomingNetworkRequest(incoming, {
      remoteAddress: incoming.socket.remoteAddress,
      method: incoming.method ?? "GET",
      path: incoming.url ?? "/",
      secret: SIGNAL_SECRET,
      timestamp: 1_800_000_000,
      trustedProxyCidrs: ["127.0.0.1", "::1"],
      trustedProxyProofSecret: PROXY_PROOF,
    });
    incoming.on("error", rejectSnapshot);
    incoming.on("end", () => {
      resolveSnapshot({
        headers: snapshotRecord(incoming.headers),
        headersDistinct: snapshotRecord(incoming.headersDistinct),
        rawHeaders: [...incoming.rawHeaders],
        trailers: snapshotRecord(incoming.trailers),
        trailersDistinct: snapshotRecord(incoming.trailersDistinct),
        rawTrailers: [...incoming.rawTrailers],
      });
      response.end("ok");
    });
    incoming.resume();
  });
  server.on("clientError", (error, socket) => {
    rejectSnapshot(error);
    socket.destroy();
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("The HTTP integration server did not expose a port.");
    }
    await new Promise<void>((resolve, reject) => {
      const headerLines = [
        `POST ${path} HTTP/1.1`,
        `Host: 127.0.0.1:${address.port}`,
        "Connection: close",
        "Transfer-Encoding: chunked",
      ];
      for (let index = 0; index < rawHeaders.length; index += 2) {
        headerLines.push(`${rawHeaders[index]}: ${rawHeaders[index + 1]}`);
      }
      const trailerLines = Object.entries(trailers).map(
        ([name, value]) => `${name}: ${value}`,
      );
      const rawRequest = [
        ...headerLines,
        "",
        "4",
        "body",
        "0",
        ...trailerLines,
        "",
        "",
      ].join("\r\n");
      const socket = connect(address.port, "127.0.0.1", () => {
        socket.end(rawRequest);
      });
      let responseText = "";
      socket.setEncoding("utf8");
      socket.setTimeout(2_000, () =>
        socket.destroy(new Error("Timed out waiting for the integration server.")),
      );
      socket.on("data", (chunk) => {
        responseText += chunk;
      });
      socket.on("error", reject);
      socket.on("end", () => {
        if (!responseText.startsWith("HTTP/1.1 200")) {
          reject(new Error("The integration server did not return HTTP 200."));
          return;
        }
        resolve();
      });
    });
    return await snapshot;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function expectNoUntrustedFields(snapshot: RequestSnapshot) {
  const blocked = new Set(UNTRUSTED_FORWARDING_HEADERS);
  for (const record of [
    snapshot.headers,
    snapshot.headersDistinct,
    snapshot.trailers,
    snapshot.trailersDistinct,
  ]) {
    expect(Object.keys(record).filter((name) => blocked.has(name.toLowerCase()))).toEqual(
      [],
    );
  }
  for (const raw of [snapshot.rawHeaders, snapshot.rawTrailers]) {
    expect(
      raw.filter((value, index) => index % 2 === 0 && blocked.has(value.toLowerCase())),
    ).toEqual([]);
  }
}

describe("real IncomingMessage network-header hardening", () => {
  it("removes duplicate forwarding, proof, and forged internal signals everywhere", async () => {
    const attackerValues = [
      "198.51.100.11",
      "198.51.100.12",
      "attacker.example",
      "attacker-trailer-value",
      "forged-network-value",
      "forged-signature-value",
    ];
    const captured = await captureRequest(
      "/recipes",
      [
        "Content-Type",
        "text/plain",
        "Trailer",
        "Forwarded, X-Real-IP, X-Recipe-Lab-Proxy-Proof, X-Recipe-Lab-Client-Network",
        "Forwarded",
        "for=198.51.100.11",
        "X-Forwarded-For",
        attackerValues[0],
        "x-forwarded-for",
        attackerValues[1],
        "X-Forwarded-Host",
        attackerValues[2],
        "X-Recipe-Lab-Proxy-Proof",
        PROXY_PROOF,
        "X-Recipe-Lab-Client-Network",
        attackerValues[4],
        "X-Recipe-Lab-Network-Timestamp",
        "123",
        "X-Recipe-Lab-Network-Signature",
        attackerValues[5],
      ],
      {
        Forwarded: "for=attacker-trailer-value",
        "X-Real-IP": attackerValues[3],
        "X-Recipe-Lab-Proxy-Proof": PROXY_PROOF,
        "X-Recipe-Lab-Client-Network": attackerValues[4],
      },
    );

    expectNoUntrustedFields(captured);
    const serialized = JSON.stringify(captured);
    for (const attackerValue of [...attackerValues, PROXY_PROOF]) {
      expect(serialized).not.toContain(attackerValue);
    }
    expect(captured.headers["content-type"]).toBe("text/plain");
  });

  it("uses a single proven XFF value before stripping its original representations", async () => {
    const captured = await captureRequest(
      "/api/recipes",
      [
        "Content-Type",
        "text/plain",
        "X-Forwarded-For",
        "198.51.100.77",
        "X-Recipe-Lab-Proxy-Proof",
        PROXY_PROOF,
        "X-Recipe-Lab-Client-Network",
        "forged-network-value",
      ],
      {},
    );

    expect(captured.headers[NETWORK_HEADER]).toBe("198.51.100.0/24");
    expect(captured.headers[NETWORK_TIMESTAMP_HEADER]).toBe("1800000000");
    expect(captured.headers[NETWORK_SIGNATURE_HEADER]).toMatch(/^[0-9a-f]{64}$/);
    expect(captured.headers).not.toHaveProperty(PROXY_PROOF_HEADER);
    expect(captured.headers).not.toHaveProperty("x-forwarded-for");
    expect(captured.headersDistinct).not.toHaveProperty(PROXY_PROOF_HEADER);
    expect(captured.headersDistinct).not.toHaveProperty("x-forwarded-for");
    expect(captured.rawHeaders.map((value) => value.toLowerCase())).not.toContain(
      PROXY_PROOF_HEADER,
    );
    expect(captured.rawHeaders.map((value) => value.toLowerCase())).not.toContain(
      "x-forwarded-for",
    );
  });
});
