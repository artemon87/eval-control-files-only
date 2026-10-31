# Overview analytics synchronization draft

Stacked on the current global History insights implementation. Preserve History's new branch/case insights, its dedicated scope endpoint, and Compare's complete scope queries and independent targets.

This draft switches Overview to the companion backend /overview endpoint. Totals come from server counts, not inbox array lengths. The UI includes the first partial UTC day, uses case-weighted daily sparklines, and takes predecessor/degradation evidence from the server. The server returns five recent records per type for the existing recent-runs panel.

The hook keys results by query and API instance, rejects late successes/errors after cancellation, and withholds results from a different scope. It does not calculate a second set of partial analytics when the endpoint fails. Existing loading/error presentation remains in place. No comparison or History view replacement is included.

The API client shares filter serialization between paged runs and Overview and exposes /facets. The existing new History and Compare discovery APIs remain their source of scope choices. Applying facets to the Evaluation Runs metadata dropdowns is pending; this draft is not a claim of complete company-code synchronization.

Companion backend deploys first. Contract additions beyond the screenshots: recent_runs for the server-derived recent feed and distinct e2e_stage/e2e_target Overview parameters. Keep the client and server together.

Validation: actual API client/hook/pure-view execution tests plus existing comparison, window, and pagination checks. Targeted API/helper TypeScript checking passes. Full page TypeScript checking is blocked by missing Next/next-auth/CSS declarations and an existing authorization-provider nullability error in this prepared snapshot. No production build, browser visual check, live Mongo integration, or deployment was performed.

Remaining before merging: live data/response compatibility and performance, metadata dropdown adoption, full page/build/browser verification, final UI reconciliation, and regression coverage of endpoint failures and facets. Do not restore the company's 50-page silent truncation, stale-results fallback, or old History layout.
