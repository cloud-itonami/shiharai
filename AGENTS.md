# etzhayyim-project-shiharai — 支払 Web 自動化 Actor

`did:web:shiharai.etzhayyim.com` / nanoid `sh1h4r41`。Gmail 等の請求 email を抽出し、
Web 支払いページを Playwright 駆動で埋め、**最終 submit まで** 実行する汎用 actor。

## Scope

- **用途**: 汎用 (jun784 個人 + etzhayyim 社用 両方)
- **最終 submit**: **実行可** (ADR-0032 `決済=禁止` を本 actor は override)
- **Credential**: macOS Keychain → local daemon 経由で vault.etzhayyim.com (ADR-0029)
  に ephemeral wrap push → Worker が 60s 以内に decrypt して使用 → 即破棄
- **Browser**: Playwright Worker (local Node.js daemon on user's Mac
  — CF Browser Rendering + `@cloudflare/playwright` は Phase 3)

## Architecture (逆トポロジー下から)

```
┌─────────────────────────────────────────────────────────────────┐
│ T5 User (Claude Code / etzhayyim CLI)                                 │
│   etzhayyim shiharai list            → listPendingBills               │
│   etzhayyim shiharai prepare <id>    → preparePayment                 │
│   etzhayyim shiharai confirm <id>    → confirmPayment (destructive)   │
│   etzhayyim shiharai agent           → local Playwright daemon loop   │
└─────────────────────────────────────────────────────────────────┘
                        │
                        │ XRPC (com.etzhayyim.apps.shiharai.*)
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ T4 shiharai.etzhayyim.com Worker (this project)                        │
│  - extractBill         LLM parse via murakumo                    │
│  - listPendingBills    SQL vertex_shiharai_bill WHERE state=due  │
│  - preparePayment      enqueue job, return {jobId, payUrl}       │
│  - confirmPayment      mark job ready-to-commit                  │
│  - registerRecurring   credential handoff + biller registration  │
│  - getJobStatus        poll job state                            │
│  - State: HYPERDRIVE → vertex_shiharai_{bill,payment,biller,...} │
│  - Queue: D1 SHIHARAI_DB.job (pending/running/done/failed)       │
└─────────────────────────────────────────────────────────────────┘
                        │
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ T3 gmail     │ │ T2 murakumo  │ │ T2 vault     │
│ vertex_gmail │ │ bill extract │ │ creds fetch  │
│ _email       │ │ via LLM      │ │ (ADR-0029)   │
└──────────────┘ └──────────────┘ └──────────────┘
                                          │
                                          │ ephemeralVaultKey (60s)
                                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ T0 Local Mac — `etzhayyim shiharai agent` daemon (LaunchAgent)        │
│  1. Long-poll shiharai.etzhayyim.com/xrpc/com.etzhayyim.apps.shiharai.dequeue│
│  2. Fetch creds from macOS Keychain (service=etzhayyim.shiharai.X)    │
│  3. Run Playwright: Chrome / WebKit launch → navigate → fill     │
│     → (confirmPayment if authorized) → submit                    │
│  4. POST result to shiharai.etzhayyim.com/xrpc/...reportJobResult      │
│  Credentials NEVER leave the Mac. Only bill/session state does.  │
└─────────────────────────────────────────────────────────────────┘
```

## Tier placement

T4 domain app. Depends on T3 gmail (bill source), T2 murakumo (extract),
T2 vault (creds), T1 pds (XRPC), T0 auth.

## Credential policy

- **On the Mac**: `security add-generic-password -s etzhayyim.shiharai -a <biller>`
  で ユーザー ID / パスワード / 2FA seed を保存
- **Keychain service naming**: `etzhayyim.shiharai.{biller-handle}` → account =
  username, generic password = JSON `{password, totpSeed?, customerNumber?}`
- **Wire**: 支払い実行時、local daemon が Keychain から読み、
  `vault.etzhayyim.com` の `injectWorkerSecret` pattern (ADR-0029) で shiharai
  Worker に 1 回限り pass。Worker memory のみ、persist 禁止。
- **1Password**: Phase 3 で `op` CLI plugin 経由 read サポート (同じ
  injectWorkerSecret 境界)。

## Biller adapter roster (初期)

| biller | handle | site | method | priority |
|---|---|---|---|---|
| 東京都水道局 | `tokyo-waterworks` | suidoapp.waterworks.metro.tokyo.lg.jp | クレカ / Pay-easy | P0 |
| PayPay 銀行 | `paypay-bank` | paypay-bank.co.jp | login only (支払履歴 read) | P1 |
| bitFlyer 積立 | `bitflyer` | bitflyer.com | auto (no payment UI) | P2 |
| Paidy | `paidy` | paidy.com | クレカ継続払 | P1 |
| NURO 光 | `nuro` | nuro.jp | クレカ登録済 | P2 |
| Fly.io | `flyio` | fly.io/dashboard | クレカ retry | P0 |

各 adapter は `src/adapters/{handle}.ts` に集約 (Playwright selector + form
logic)。biller 識別は `extractBill` の output `issuer` field から。

## XRPC methods

NSID: `com.etzhayyim.apps.shiharai.*`

| method | type | destructive | 概要 |
|---|---|---|---|
| `extractBill` | procedure | safe | raw email body → `{issuer, amount, dueDate, customerNumber, payUrl, method}` |
| `listPendingBills` | query | safe | 未払 bill 一覧 (state=due/overdue) |
| `preparePayment` | procedure | safe | job enqueue + form-fill 準備 (credentials は vault injectWorkerSecret で Worker に流す) |
| `dequeueJob` | procedure | safe (auth required) | local daemon が long-poll で pull |
| `reportJobResult` | procedure | safe | daemon → Worker の結果報告 |
| `confirmPayment` | procedure | **destructive** | job の最終 submit フラグ立て |
| `registerRecurring` | procedure | moderate | クレカ継続払 (suidocard.jp 等) 登録 |
| `listRecurring` | query | safe | 既存継続払 binding 一覧 |
| `getJobStatus` | query | safe | job 状態取得 |

## Data model

- `vertex_shiharai_biller` — 支払先 (Tokyo Water, Paidy, ...)
- `vertex_shiharai_bill` — 1 bill = 1 row (from gmail email or manual)
- `vertex_shiharai_payment` — actual payment tx (confirmPayment 後)
- `vertex_shiharai_recurring` — クレカ継続払 binding
- `vertex_shiharai_job` — Playwright job state (D1 でなく graph 側に
  persistence、復元性のため)
- edges: `edge_shiharai_bill_for_biller`, `edge_shiharai_payment_settles_bill`

詳細: `30-graph/graph-schema/migrations/20260419120000_vertex_shiharai_tables.ts`

## Phase roadmap

- ✅ **Phase 1** (2026-04-19): scaffold + schema + 6 safe methods. Migration
  `20260419120000` applied (12 tables). 3 biller rows seeded.
- ✅ **Phase 2** (2026-04-19): `confirmPayment` + local daemon (superseded).
- ✅ **Phase 3** (2026-04-19): **architectural pivot — shiharai becomes a
  thin consumer of `com.etzhayyim.apps.bpmn` (orchestrator) +
  `com.etzhayyim.apps.playwright` (primitives) +
  `com.etzhayyim.apps.cloudflareBrowserRender` (substrate).** Biller-specific
  code removed — each biller is a BPMN JSON recipe at `recipes/*.bpmn.json`
  deployed once via `bpmn.deployProcess`. shiharai `src/app.ts` = 7 XRPC
  methods that wrap `bpmn.startInstance` / `bpmn.signalInstance`. Local
  Playwright daemon code moved out (now lives under
  `60-apps/etzhayyim-project-playwright/daemon/` — Phase 3b).
- **Phase 3b** (next): playwright actor daemon + real `bpmnCall()` via
  service binding; seed deploy 4 recipes; test E2E Tokyo Water flow.
- **Phase 4**: suidocard recurring + NURO / bitFlyer / Paidy adapters
  (= just more BPMN JSON recipes, no code); 1Password `op` CLI resolver
  for `1password://` valueRef scheme.

## Anti-patterns (禁止)

- Credential を worker 側で persist (D1 / B2 / KV へ書くの禁止)
- 最終 submit を automatic にする (必ず `confirmPayment` 経由、approval
  workflow で human-in-the-loop)
- Keychain secret を plaintext で log / stderr / response に出力
- 複数 biller の credential を 1 request で fetch (blast radius 最小化)
