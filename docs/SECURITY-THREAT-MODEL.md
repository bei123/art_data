# Security Threat Model

## Overview

`art_data` is an Express/MySQL API and Vue administration application serving a
WeChat mini-program, administrators, payment and logistics integrations, OSS
uploads, and external asset systems. Production traffic enters through ESA and
Nginx. Runtime code is primarily `index.js`, `auth.js`, `routes/`, `services/`,
`middleware/`, `utils/`, and `config/`; UI, tests, scripts, and documentation
are supporting surfaces.

The highest-value assets are administrator sessions, WeChat user sessions and
PII, payment/refund state, order ownership and inventory, referral balances,
identity documents, OSS objects, third-party API credentials, webhook secrets,
and database integrity.

## Threat Model, Trust Boundaries, and Assumptions

- Internet clients cross the ESA/Nginx boundary into public Express routes.
- Administrator browsers and WeChat users share the API but have distinct
  identities and authorization rules.
- WeChat, WeChat Pay, SF Express, OSS, WMS, and asset platforms are external
  trust domains. Their callbacks and responses are untrusted until verified.
- MySQL and Redis are trusted persistence systems; query inputs are not.
- Uploaded files, URLs, route/query/body parameters, headers, webhook bodies,
  rich text, and third-party responses are attacker-controlled.
- Environment variables, deployment configuration, and admin actions are
  operator-controlled. Source, migration, test, and build inputs are
  developer-controlled.
- TLS termination and proxy forwarding are assumed correctly configured.
  Secrets are assumed absent from source control and protected at deployment.

Required invariants:

- A user can read or mutate only their own cart, favorites, addresses, orders,
  identity, referral and payout records.
- Only administrators can reach administrative mutation and integration proxy
  routes.
- Payment, refund, transfer, and webhook state changes require authentic
  provider messages and are idempotent.
- Client-provided prices, user IDs, callback URLs, file paths, and roles never
  override authoritative server state.
- Session logout/revocation is enforced server-side and tokens do not leak to
  logs, URLs, HTML, or unrelated origins.
- Outbound requests cannot reach private/reserved networks or escape approved
  hosts through redirects or DNS rebinding.
- Uploads cannot execute code, overwrite arbitrary files, or expose private
  identity documents.

## Attack Surface, Mitigations, and Attacker Stories

Primary surfaces include `/api/wx`, `/api/wx/pay`, `/api/auth`, public catalog
routes, admin routes, webhook callbacks, `/api/webview/proxy`, `/api/upload`,
local upload delivery, external integration routes, and database-backed search
and sorting.

Existing controls include JWT plus active-session checks, role middleware,
ownership helpers, rate limits, webhook signature middleware, parameterized
queries, upload limits, outbound URL allowlists, DNS/private-address checks,
short-lived URL access tokens, Helmet, CORS policy, and production error
redaction.

Realistic attacker stories:

- An unauthenticated client probes public registration, login, callback,
  catalog, search, and proxy endpoints.
- A valid WeChat user changes IDs to access another user's orders, addresses,
  referrals, claims, or refunds.
- A compromised low-privilege or admin browser abuses permissive CORS, leaked
  tokens, rich content, or remote proxied HTML.
- A forged/replayed webhook attempts to alter payment, refund, transfer, or
  fulfillment state.
- A malicious upload or URL attempts content-type confusion, path traversal,
  SSRF, credential leakage, or stored script execution.
- An attacker manipulates quantities, prices, order numbers, sorting fields,
  long IDs, or pagination values to trigger injection, overflow, or inventory
  inconsistency.

Out of scope without additional evidence: direct compromise of WeChat/OSS/SF
Express infrastructure, malicious database administrators, and attacks that
require modifying trusted deployment secrets or source code.

## Severity Calibration

- **Critical:** unauthenticated administrator takeover; arbitrary payment or
  payout execution; remote code execution; bulk identity-document disclosure;
  usable production secret committed to the repository.
- **High:** horizontal access to another user's financial/identity data;
  signature bypass on a state-changing webhook; SSRF into cloud metadata or
  internal services; arbitrary refund/transfer; SQL injection with material
  read/write impact.
- **Medium:** plaintext credentials or bearer tokens written to routine logs or
  URLs; exploitable stored XSS requiring an authenticated administrator;
  meaningful rate-limit bypass; CSRF/CORS weakness with a realistic credential
  path; availability failures on important flows.
- **Low:** limited information disclosure, documentation/client-contract drift,
  noisy logging without secrets, weak hardening that requires another
  compromise, or test-only reliability defects.
