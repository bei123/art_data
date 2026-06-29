# Security Review Report

**Target:** `D:\progect\art_data`  
**Revision:** `f337c40` plus current working tree  
**Date:** 2026-06-29  
**Method:** single-agent repository review, static source tracing, existing tests,
route/OpenAPI reconciliation, and bounded live endpoint checks.

## Executive summary

No critical or high-severity vulnerability was confirmed. Two reportable
security weaknesses and two correctness/reliability defects were validated.
Authentication, administrator route mounting, user-object ownership, payment
callback signatures, webhook authentication, SQL parameterization, local-file
containment, outbound proxy allowlisting, token revocation, and production
error redaction all have material controls in place.

This was a single-agent scan. It covered the deployed high-impact runtime
families listed below, but does not carry the variance-reduction benefit of
independent multi-agent review.

## Findings

### SEC-001 — Registration logs can capture plaintext passwords

**Severity:** Low (P3)  
**Confidence:** High  
**CWE:** CWE-532, CWE-312

**Affected locations**

- Entrypoint: `index.js:263` (`POST /api/auth/register`)
- Root control/sink: `auth.js:181` (`console.log(..., req.body)`)

**Evidence and validation**

The registration handler logs the complete request body before validation.
The body contains `username`, `email`, and plaintext `password`. Public
registration is disabled by default by `utils/publicRegistrationGuard.js`, but
the leak is deterministic whenever `ALLOW_PUBLIC_ADMIN_REGISTER=true`.

**Attack path**

1. An internet client submits a registration request while public registration
   is enabled.
2. Express parses the JSON body.
3. `auth.register` writes the entire body to process output.
4. Anyone with access to application, process-manager, container, or aggregated
   logs can recover the submitted password.

**Counterevidence and calibration**

The route is rate-limited and disabled by default, and an external attacker
does not automatically gain log access. These constraints reduce severity,
but do not remove the secret-at-rest leak.

**Recommendation**

Remove the log or log only non-sensitive fields through the structured logger.
Never log `password`, tokens, session keys, identity numbers, or payment
credentials.

### SEC-002 — WebView authorization credentials are accepted in the URL

**Severity:** Medium (P2)  
**Confidence:** High  
**CWE:** CWE-598

**Affected locations**

- Entrypoint/root control: `routes/webview.js:22`
- Forwarding sink: `routes/webview.js:75-139`
- Client-side injection path: `routes/webview.js:219-227`

**Evidence and validation**

`GET /api/webview/proxy` reads `authorization` from `req.query`, converts it to
an outbound `Authorization` header, and may embed it in the returned HTML
bootstrap. Query strings are routinely visible to ESA/Nginx access logs,
browser history, monitoring, screenshots, referrers, and diagnostic tooling.
Authentication of the proxy itself and the outbound host allowlist do not
prevent this credential exposure.

**Attack path**

1. An authenticated user opens a proxy URL containing a target bearer token.
2. The credential crosses ESA/Nginx inside the request URL.
3. URL-observing infrastructure or diagnostics retain the credential.
4. A party with access to those records can replay the token against the
   allowlisted external service until it expires or is revoked.

**Counterevidence and calibration**

The proxy requires a valid session or a target-bound short-lived access token,
restricts hosts and ports, blocks private DNS results, and guards redirects.
The target service is intended to receive the bearer token. The weakness is
the transport of that token in the proxy URL, not an SSRF bypass.

**Recommendation**

Do not accept third-party bearer credentials in query parameters. Store them
server-side under a short-lived opaque handle, or accept them in a request
header/body on a non-navigation exchange and bind the resulting handle to the
user, target origin, purpose, and short expiry. Redact query strings from edge
and origin logs as defense in depth.

## Correctness and reliability defects

### BUG-001 — OpenAPI favorite request schema does not match the backend

`scripts/generate-openapi-esa.js` documents `FavoriteAdd` as
`item_type`/`item_id`, while `services/favoritesService.js:121` reads
`itemType`/`itemId`. A client generated from the OpenAPI schema receives HTTP
400. The current mini-program uses the backend spelling, so its normal flow is
not broken.

### BUG-002 — Unit tests perform an OSS network probe during module loading

The full parallel test run completed 212/214 tests. Two
identity-document/security tests timed out while `config/oss.js` attempted a
real TLS connection. The same three security test files pass 30/30 when run as
a focused set, confirming a suite-level isolation/concurrency defect rather
than a deterministic assertion failure. OSS initialization should be lazy or
explicitly mocked/disabled in tests.

## Coverage ledger

| Runtime family | Disposition | Evidence |
| --- | --- | --- |
| Authentication/session issuance and revocation | Suppressed | JWT verification is paired with active DB session checks; logout revokes WeChat access and refresh sessions |
| Administrator authorization | Suppressed | `/api/admin` prefix plus route-level `requireAdmin`; integration routers mount `requireAdmin` |
| User object ownership/IDOR | Suppressed | cart/favorites/address/order queries bind `req.user.id`; pay flow verifies openid and order ownership |
| Payment/refund callbacks | Suppressed | raw request body, WeChat signature verification, APIv3 authenticated decryption and idempotency controls |
| Transfer/integration webhooks | Suppressed | `verifyIntegrationWebhook` precedes the public callback |
| SQL/query injection | Suppressed | attacker values use placeholders; dynamic table/sort fragments are constants or allowlisted |
| SSRF and redirects | Suppressed | host allowlist, protocol/port rules, DNS private-address rejection and redirect guard |
| File read/path traversal | Suppressed | local-upload path canonicalization, containment check and signed/authenticated access |
| Upload active-content risk | Suppressed | admin/user authentication, extension allowlists, memory limits, image re-encoding on avatar flow; no executable serving path found |
| Secrets in repository | Suppressed | `.env`, TLS keys and certificates are not tracked; no usable hardcoded production credential found |
| Error/stack disclosure | Suppressed | detailed error messages are disabled in production |
| CORS/CSRF | Suppressed with hardening note | bearer-header authentication limits credentialed cross-origin abuse; disable wildcard subdomains in production |
| Credential logging | Reportable | SEC-001 |
| Credential transport in URLs | Reportable | SEC-002 |
| Command execution/deserialization/XXE | Not applicable | no deployed shell execution or unsafe XML/object deserializer found |

## Validation rubric and closure

Each candidate was checked for: attacker-controlled input, reachable production
entrypoint, concrete sink/broken control, missing or insufficient nearest
control, and meaningful security impact. SEC-001 and SEC-002 satisfy the first
four criteria; severity was reduced according to their preconditions and
impact. CORS wildcard, public registration, dynamic SQL, local uploads, payment
callbacks, and WebView SSRF were retained as coverage rows but suppressed by
the exact controls recorded above.

## Verification performed

- `npm run audit:openapi`: 257/257 operations matched.
- Full suite: 212 passed, 2 timed out while the OSS probe was active.
- Focused security suite: 30/30 passed.
- Production health and representative public endpoints returned HTTP 200.
- Empty WeChat login/refresh requests and unauthenticated user-info requests
  returned the expected 400/401 responses.
