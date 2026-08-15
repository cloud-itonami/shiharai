# Operator quickstart

**Read this first: `CLAUDE.md` states that this actor executes the final payment
submit, and that it overrides ADR-0032 `決済=禁止`.** Whatever else is true of this
repository, that is the sentence that governs how carefully anything here is
touched.

The good news, and it is checkable rather than assumed: **the dangerous parts are
not in this tree.** What is here is a thin edge facade, a registry that stores
*references* to credentials rather than credentials, and four declarative payment
recipes. Credential custody and the browser automation that submits live elsewhere,
and this document verifies that claim instead of repeating it.

Steps marked ✅ were run against this tree on 2026-08-16. This is repository
orientation; it deliberately contains no instructions for making a payment.

---

## 1. Verify the boundary the repository claims ✅

`kotoba/src/registry.ts` says in its header that "credential custody, Playwright
submit ACTION and LLM extraction INFERENCE stay" outside. Checking rather than
trusting:

```bash
# no browser is driven from this tree
git grep -nE 'page\.(click|fill|goto|type|press)|chromium\.|browser\.newPage' -- .
#   (no output)

# every mention of submit is a comment about the boundary, not an implementation
git grep -n 'submit' -- kotoba/src/
#   kotoba/src/index.ts:5     * submit ACTION and LLM extraction INFERENCE stay ...
#   kotoba/src/registry.ts:11 * credential custody, Playwright submit ACTION ...
#   kotoba/src/types.ts:6     * submits the final payment. Founder directive ...
#   kotoba/src/types.ts:26    *   custody (Keychain -> vault ephemeral-wrap) ...

# no literal secret material
git grep -nE '(password|secret|api[_-]?key|token)\s*[:=]\s*["\x27][^"\x27]{8,}' -- .
#   (no output)
```

All three come back empty or comment-only. And what the registry *does* store for a
biller is a **`keychainService` name** alongside `siteUrl`, `payUrl`, `adapter`,
`authKind` and `capabilities` — that is, *where* a credential lives, never the
credential. That separation is the single most important property of this
repository, so it is the first thing this document checks.

## 2. The facade runs offline ✅

`src/app.ts` has **no imports** and uses only `Request`/`Response`, so Node runs it
directly. Walked on Node v26.3.0, where `--experimental-strip-types` is a no-op
(default from Node 23) and required on 22.6–22.x:

```bash
cd appview/etzhayyim-wasm-shiharai-sh1h4r41

cat > /tmp/shwalk.mjs <<'EOF'
const app = (await import(process.argv[2])).default;
for (const [l, req] of [
  ["GET /health", new Request("https://shiharai.etzhayyim.com/health")],
  ["GET /nope  ", new Request("https://shiharai.etzhayyim.com/nope")],
  ["bad json   ", new Request("https://shiharai.etzhayyim.com/xrpc/com.etzhayyim.apps.shiharai.listBillers",
                              { method: "POST", body: "{not json" })],
]) { const r = await app.fetch(req, {}); console.log(l, "->", r.status, (await r.text()).slice(0,90)); }
EOF

node --experimental-strip-types /tmp/shwalk.mjs "$PWD/src/app.ts"
```

Actual output:

```
GET /health -> 200 {"ok":true,"actor":"did:web:shiharai.etzhayyim.com","nanoid":"sh1h4r41", ...
GET /nope   -> 404 {"error":"NotFound","message":"shiharai not found"}
bad json    -> 400 {"error":"InvalidJson"}
```

Note what this proves and what it does not: the facade rejects a malformed body
before proxying, and it proxies everything else. **No payment path is exercised by
this check** — the facade implements none.

## 3. The four recipes, by shape ✅

```bash
python3 -c "
import json,io,glob
for f in sorted(glob.glob('recipes/*.json')):
    d=json.load(io.open(f)); flow=d.get('flow',[])
    print(f, d['id'], 'v'+str(d['version']), len(d['variables']),'vars', len(flow),'steps')
"
```

| file | id | vars | steps | error ends |
|---|---|---|---|---|
| `flyio.bpmn.json` | `shiharai-flyio-v1` | 3 | 15 | 1 |
| `paidy.bpmn.json` | `shiharai-paidy-v1` | 3 | 14 | 2 |
| `suidocard-recurring.bpmn.json` | `shiharai-tokyo-waterworks-recurring-v1` | 3 | 15 | 1 |
| `tokyo-waterworks.bpmn.json` | `shiharai-tokyo-waterworks-v1` | 4 | 20 | 2 |

All four parse. Each is a BPMN-shaped flow of `serviceTask` steps with a
`startEvent`, at least one `errorEndEvent`, and a `messageIntermediateCatchEvent`
— that last one is where the flow waits for an out-of-band signal, e.g. a
confirmation. The Tokyo Waterworks recipe additionally carries an
`exclusiveGateway`, so it branches.

Deliberately not reproduced here: the CSS selectors and the ordered submit
sequence. They are in the files for anyone who needs them, and a quickstart is not
the place to restate the click path of a payment.

**Three of the four declare an `expectedAmountJpy` variable. The fourth is the
recurring one.** Measured:

| recipe | declared variables |
|---|---|
| `flyio` | `billId`, `payUrl`, **`expectedAmountJpy`** |
| `paidy` | `billId`, `payUrl`, **`expectedAmountJpy`** |
| `tokyo-waterworks` | `billId`, `payUrl`, **`expectedAmountJpy`**, `requesterDid` |
| `suidocard-recurring` | `recurringId`, `customerNumber`, `payMethod` — **no expected amount** |

The first draft of this file said all four declared it; counting them showed
otherwise, and the exception is the one that matters most. A recurring payment
authorisation is exactly where an expected-amount bound belongs, and this recipe
declares no amount variable for anything downstream to compare against.

That may be deliberate — a recurring mandate may be intended to authorise the
biller rather than an amount, and `tokyo-waterworks` (which does declare one) is
the same biller's one-shot flow, so the pair may be an intentional split. Either
way it is the first question to ask of this actor, and the comparison itself is not
in this tree.

## 4. ⚠ The facade is not what deploys

The pattern common to this cohort, present here:

```bash
grep '"main"' appview/*/wrangler.jsonc
#     "main": "svelte/.svelte-kit/cloudflare/_worker.js",
grep -c '"/health"' appview/*/src/app.ts                              # 1
rg -c health appview/*/svelte/src/                                    # no match
grep -c 'catch(() => ({}))' appview/*/svelte/src/routes/xrpc/*/+server.ts  # 1
```

So `/health` answers only in the file that is not deployed, and the deployed route
turns a malformed body into `{}` and calls the tool with empty arguments. Across
the 329 appview repositories carrying a `wrangler.jsonc` that is 89 and 58
respectively; the standing check is `:verify-appview-facade` in
`manifest/orgs-detectors.edn`. **Do not health-check this service at `/health`,**
and for this actor in particular, do not assume a malformed request is rejected by
the thing that answers.

## 5. What is not here, and it is most of it ⚠

- **Credential custody.** `CLAUDE.md` describes macOS Keychain → a local daemon →
  an ephemeral wrap pushed to `vault.etzhayyim.com` → decrypted in the Worker for
  60 seconds. None of that is in this tree; the registry holds a service *name*.
- **The browser automation.** A local Playwright daemon on the operator's Mac, per
  `CLAUDE.md`, with Cloudflare Browser Rendering listed as Phase 3.
- **The amount check.** See §3.
- **`MIGRATION-TODO.md` carries 7 unchecked constitutional invariants**, so this
  app is not yet etzhayyim-aligned by its own file's account.

## 6. Provenance ✅

`migration.edn` is the `/v1` schema with an `:identity/:allowed-additions`
allow-list, which this document has been added to rather than appearing beside it
unrecorded.
