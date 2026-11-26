import http from "k6/http";
import { check } from "k6";
import { sleep } from "k6";

/**
 * Load test for the GET /api/contract/[id]/events endpoint.
 *
 * Sends 100 concurrent requests and asserts:
 *   - p99 request latency is below 500 ms
 *   - no 5xx responses are returned
 *
 * Configuration (via environment variables):
 *   BASE_URL        - origin of the running frontend (default: http://localhost:3000)
 *   CONTRACT_ID     - contract id to query events for (required for a meaningful run)
 */

export const options = {
  vus: 100,
  duration: "30s",
  thresholds: {
    http_req_duration: ["p(99) < 500"],
    "checks{no_5xx}": ["rate == 1.0"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const CONTRACT_ID = __ENV.CONTRACT_ID || "";

if (!CONTRACT_ID) {
  throw new Error("CONTRACT_ID environment variable is required");
}

export default function () {
  const url = `${BASE_URL}/api/contract/${encodeURIComponent(CONTRACT_ID)}/events`;
  const res = http.get(url);
  check(res, {
    "no 5xx responses": (r) => r.status < 500,
  });
  sleep(0.1);
}
