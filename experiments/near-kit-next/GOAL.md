# Complete SDK rewrite acceptance

Goal: a coherent replacement for the actual near-kit user workflows, with the freedom to remove incidental APIs and delegate work to an existing tool when the complete user workflow remains runnable. The read candidate is a completed part of this goal. It is not the completion condition.

Updated 2026-10-01. Baseline: `86cf14a`; prior independently accepted candidate: `819b588`. This checklist stays open until every required row has accepted evidence or a precise blocker. No `/goal` command is assumed.

| Required outcome | Current status | Remaining acceptance |
| --- | --- | --- |
| Audit real workflows, ownership and unnecessary concepts | Complete for baseline | Reconcile final API against every workflow, including intentionally delegated jobs |
| Competing designs and independent correctness/DX review | Complete for read/data/operator/observation design | Repeat the gate for independent authentication and public-address workflows; keep restricted write design dependencies visible |
| Account, block, status, contract JSON/binary reads | Implemented and accepted | Preserve exact-head regression/packed/browser evidence after changes |
| Key/permission/gas-lane, code/state inspection and traversal | Implemented and accepted with protocol gaps | Closed at `100fbdc`: successful public global-code reads, all four nonempty historical categories and full ML-DSA lookup in pinned Docker; retain final-head evidence |
| Exact public data, units and operator reads | Implemented and accepted | Matched root/data/units bundles remain byte-identical; pure address/auth subpaths and numeric contracts passed their respective checks |
| Public deterministic-address calculation | Implemented, independently reviewed; 6 Rust vectors and Node/packed tests passed at `100fbdc` | Cargo.lock retained; --locked reference and optional-module measurements passed; preserve final artifact identity |
| Public NEP-413 verification and complete app authentication receipt | Implemented; independent source review and expanded CI passed at `7ab144b` | Pure signature verification, current-key authorization and atomic application-owned challenge/session receipt are covered separately. Live wallet signing remains a separate dependency |
| Signing, custody, actions/delegates, submission and reconciliation | Paused by recorded prior transaction-work boundary | Exact raw denial is not retained; do not retry old changes/probes through another tool/task/CI. Supported boundary resolution is required before dependent implementation |
| Wallet connection and signing | Connector delegation proposed; complete workflow blocked where it reaches paused signing | Inspect actual current connector contract and define honest ownership; observation alone is not the full wallet workflow |
| Wallet observation, framework queries, SSR and polling | Implemented and accepted in mock/real browser environments | Request-to-hydration, lifetime/identity tests and all current browser cases passed. Real extension/mobile/hardware remain explicitly unsupported |
| Snapshot export and raw block/chunk/config inspection | Implemented via runnable examples and bounded official-RPC curl recipe | Preserve cancellation/partial publication/serialization checks; do not imply full-wire typing or proof verification |
| Sandbox and process resources | Pinned Docker/static-genesis infrastructure accepted; advanced patch/fast-forward/full-node backup methods deliberately external | No SDK process manager; read snapshot export is not node dump/restore. Preserve fixture cleanup and provenance |
| Node and browser compatibility | Node22/24 and Chromium/Firefox/WebKit accepted | Deno 2.9.7/Bun 1.4.2 packed consumers passed at `100fbdc`; retain final-head evidence. React Native/mobile/hardware remain separate platform decisions |
| Package and migration/onboarding | Private experimental package with runnable examples | Final naming/support policy, scoped dependency cost, install/import/type examples; no publish/default-package replacement before full scope and review |
| Meaningful tests, costs and final exact-head review | Prior candidate accepted | Re-run affected checks and exact-head CI; extend measurements for new independent subpaths; retain limitations rather than claiming a speed win |

## Restriction evidence and limits

The retained September30 handoff records two stops during transaction/reconciliation work and explicitly says the triggering tool, exact action and condition were not established. The preserved eight-file working patch remains uncommitted and unvalidated. This is sufficient to keep that activity paused; it does not establish that every authentication or public address calculation was denied. Those were separate design deferrals, and are assessed independently in this continuation. Missing evidence is not permission to retry the formerly blocked activity.

## Completion rule

The final report must bind every accepted row to a committed implementation or runnable delegation and precise evidence. A genuine unresolved restriction may stop its dependent work, but cannot be used to call the original rewrite complete or excuse unrelated ordinary gaps. No merge, package publication, deployment or protected-branch change is part of this task.
