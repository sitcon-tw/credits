# AGENTS.md

This repository maintains SITCON Credits, a long-term public index of SITCON staff and speaker contribution records.

The public reader-facing documentation should be written in Traditional Chinese for Taiwan unless a file explicitly targets another audience. This file is written in English because it is intended for LLM agents and automated maintainers.

## Project Purpose

- Preserve public contribution records for SITCON-related events.
- Help contributors, organizers, and community members find historical staff and speaker records without searching every event website manually.
- Allow contributors to opt in to public profile information such as a preferred display name, biography, avatar, public email, and links.
- Keep data maintenance practical for current SITCON staff who already work in the Google Workspace ecosystem.

## Data Authority

- Official historical event websites are the evidence source for event contribution records.
- Google Sheets is the operational canonical dataset after records are collected, reviewed, and accepted by maintainers.
- GitHub Pages is the intended public output.
- GitHub Actions is the intended export/build path from the controlled dataset to the static site.

Do not describe planned infrastructure as already implemented. If a Sheet, Form, Action, schema, or deployment does not exist yet, document it as planned or `TBD`.

Repository tools may use maintainer-provided service account credentials to operate the controlled Google Sheet, including initializing sheets, syncing validation helper sheets, configuring validation, exporting data, or running checks. This repository has GitHub Actions workflows for manual Sheet export, direct missing profile-template commits to `credits-profiles`, `people` helper synchronization from `credits-profiles`, canonical appearances checks for profile PR auto-review, and maintainer-confirmed claim URL application from `site:` references to GitHub usernames, but they depend on repository secrets such as `GOOGLE_SERVICE_ACCOUNT_JSON` plus the `SITCON Credits Assistant` GitHub App installation and credentials configured outside the repository. Cross-repository writes, comments, reviews, and merges should use `sitcon-credits[bot]`, not an individual maintainer token. The workflow files exist in this repository, but do not describe credentialed GitHub Actions automation as operational in a live repository unless the repository/Google Workspace/GitHub App configuration also exists.

Service account credentials and other secrets may exist locally for maintainers, but they must not be committed or read by LLM agents. In particular, do not open, inspect, parse, copy, summarize, or print files such as `credentials.json`, `*credentials*.json`, `*service-account*.json`, `.env`, or `.env.*`. If a task requires confirming secret presence, use file metadata, `.gitignore`, or `git status` only; do not read the secret contents.

If official event websites and the reviewed canonical Sheet disagree, public output should follow the maintainer-reviewed canonical Sheet. Do not resolve conflicts yourself unless the repository documentation or a maintainer explicitly gives the rule for that case.

Low-risk self-service profile updates happen in the separate `sitcon-tw/credits-profiles` repository. The two repositories now contain workflow definitions for trusted profile validation, cross-repository review dispatch, confirmed claim application, direct generated profile-template commits, and people-helper synchronization. Do not describe branch protection or ruleset behavior, merge permissions, repository secrets, Google Workspace access, or GitHub App installation as active unless those settings are confirmed.

## Scope

The initial scope includes staff and speakers for SITCON-related events, including but not limited to:

- SITCON annual conferences
- SITCON Camp
- Hour of Code
- Hackathons
- Other SITCON-run, co-run, formally branded, or long-term maintained community events

Partnered, sponsored, or loosely related community events are not automatically in scope. Ask maintainers before adding ambiguous event types.

Do not expand the default scope to general attendees, rejected submissions, sponsor contacts, or other private/non-public roles unless the repository documentation is updated first.

## Identity Handling

Identity matching is sensitive. The same person may appear under different names, nicknames, romanizations, or GitHub handles across different years.

Use an appearance-first model:

- Preserve each public event appearance as its own record when needed.
- Link appearances to a GitHub username profile only when a maintainer has accepted that identity link.
- `appearances.github_username` may temporarily contain a GitHub username that does not yet have a repository profile file when maintainers use it to trigger future blank profile-template creation.
- `appearances.github_username` may contain `site:<source_person_id>` to refer to `credits-profiles/site-profiles/<event_id>/<source_person_id>.json` for display-only public event website data. This is not a GitHub username, not contributor opt-in, and not identity-merge approval.
- Maintainer judgment is allowed, especially during initial dataset construction.
- Preserve existing maintainer-approved identity links unless the user explicitly asks to review or change them.

Never merge identities automatically based only on:

- matching or similar display names
- matching or similar nicknames
- romanization similarity
- GitHub/account-name similarity
- memory from prior tasks
- LLM inference

If an identity match is uncertain, keep records separate and report the uncertainty.

Maintainer-approved means one of:

- an explicit instruction from a repository maintainer
- a merged pull request that makes or accepts the identity link
- a reviewed value in the canonical Sheet

Agent memory, similar names, unreviewed form submissions, or unreviewed Sheet rows are not maintainer approval.

The public index may display-group site-profile records that share a `source_person_id`, or that share a normalized display name in adjacent event years, so they render as one badge in the field. This grouping exists only in the rendering layer: it is never written back to the Sheet, never links an appearance to a GitHub username, never merges a site record into a GitHub-linked profile, and is not identity-merge approval. The public page must state that the merge is display-only, and the canonical `appearances` rows stay untouched.

## Privacy and Removal Policy

Historical records that were already published on official event websites are not hidden by default in this project.

People may request changes to the profile layer:

- remove biography, avatar, and links
- remove or change a preferred display name
- unlink historical appearances from a consolidated person profile
- correct wrong roles, event names, or source URLs

If a person does not want a consolidated profile, unlink the profile from the historical appearances instead of deleting the event records. If the original source is wrong, prefer correcting the source or documenting a better source.

Do not invent a policy that hides, deletes, or rewrites historical event records. If the user asks for a policy change, treat it as a documentation/policy change request and keep the distinction between event records and profile data explicit.

## External Profile Repository

Profile files are maintained in the separate `sitcon-tw/credits-profiles` repository so self-service profile PRs do not mix with this repository's data model, Google Sheets tooling, and site development history.

Automation may allow a contributor to update a profile file in that repository when it corresponds to their own GitHub username. This is only appropriate for low-risk, opt-in profile fields such as preferred display name, biography, avatar, public email, and public links.

Profile files live at `profiles/<github_username>.json` in `credits-profiles`. The filename is the profile link key; do not add a separate identity identifier or historical appearance list inside the profile file.

Automation may create blank profile templates in `credits-profiles` for GitHub usernames found in the `people` helper sheet when the corresponding profile file does not exist yet. The template should be empty or placeholder-only; it must not invent profile details, identity evidence, biographies, avatars, links, aliases, or historical appearance links. `site:` profile references must not create blank contributor profile templates.

Existing contributors may open a GitHub PR to create or fill their own profile and state which historical appearances they believe are theirs. Treat that PR as a signal of intent and evidence for maintainer review, not as automatic approval to merge identities or rewrite historical records.

The GitHub Pages frontend may let contributors enter a query-gated claim mode, mark public index entries that they believe refer to themselves, and carry the resulting URL into a `credits-profiles` issue form. Treat those claim URLs the same way: they are contributor intent and maintainer-review evidence only, not identity-merge approval and not permission to change canonical appearances automatically.

Before any self-service PR may be auto-accepted, the repository should have validation that confirms:

- the PR author matches the GitHub username represented by the profile filename
- the PR changes only that contributor's own profile file
- the changed fields are limited to the approved profile schema
- the PR does not add, change, split, or infer historical appearance links
- the PR does not change historical event records, roles, source URLs, or event scope
- the PR does not process profile removal, unlinking, or privacy policy changes

Passing a filename or GitHub username check in `credits-profiles` is not identity-merge approval. It must not be used to link appearances, consolidate profiles, or resolve source conflicts.

Use `pnpm profiles:validate` in `credits-profiles` for local profile-format validation. This validation is a field-scope and data-minimization check only; it does not approve an identity link, historical record correction, removal request, or profile unlinking request.

## Google Sheets Model

The expected operational sheets are:

- `appearances`: maintainer-edited public contribution appearances.
- `events`: maintainer-edited event metadata and event-level source URLs.
- `people`: a generated selection helper with only `github_username` and `display_name`.

Do not add a separate identity identifier for profile links. Historical appearances link to profile files through `github_username`.

Do not treat the `people` sheet as the canonical profile source or a closed allowlist. It is expected to be derived from `credits-profiles` profile files and exists to help Google Sheets operators choose known usernames while still allowing `appearances.github_username` to contain not-yet-created profile usernames.

`appearances.github_username` validation should not be strict against `people`. A username outside `people` means either a blank profile template still needs to be created, or a maintainer still needs to review a contributor's requested link. It is not by itself proof that the profile exists or that an identity link has been accepted. `site:` profile references intentionally do not appear in `people`.

`people` synchronization from `credits-profiles` is a helper update only. It must not add, change, or approve `appearances.github_username`, and it must not be treated as identity-merge approval.

Use conditional formatting to make username states visible to Sheet operators:

- Highlight `appearances.github_username` values that are not present in `people.github_username`.
- Do not highlight `appearances.github_username` values that start with `site:` as missing `people` entries.
- Highlight `people.github_username` values that are not used by any `appearances.github_username`.
- Treat these highlights as maintenance prompts, not errors or identity decisions.

Role fields are reader-facing labels:

- `role_group_zh` and `role_group_en` are public group or session-type labels. For staff records, use the staff team or group. For speaker records, use the talk/session type such as Keynote, Panel, or session.
- `role_title_zh` and `role_title_en` are public identity labels within that group or session. For staff records, use labels such as team lead or member. For speaker records, use labels such as speaker, moderator, or panelist.
- Do not use `role_group_zh` or `role_group_en` as a staff/speaker classification field.
- Do not add `contribution_type` or another classification column unless repository documentation is updated first.
- If an English role field is blank, English output should fall back to the corresponding Traditional Chinese field.
- Do not auto-translate missing English role fields.
- Do not create a data-quality report only because an English role field is blank.

Source URLs should usually live on `events`:

- Use `staff_source_url` for staff records.
- Use `speaker_source_url` for speaker records.
- Use `appearances.source_url_override` only when a specific appearance has a different source from the event-level source.

Repository tooling may manage Google Sheets structure, header notes, validation rules, read-only exports, or local data checks from `config/sheets.json` and package scripts. Use `pnpm` for all package-manager operations and package scripts. Do not use npm, yarn, or bun, and do not create or commit `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `bun.lock`, or `bun.lockb`.

LLM agents may run dry-run, local validation, or static syntax-check commands that do not read credentials and do not contact Google APIs, such as `pnpm sheets:init:dry-run`, `pnpm sheets:export:dry-run`, `pnpm data:validate`, or `node --check ...`. `pnpm data:validate` may read `../credits-profiles/site-profiles` or an explicitly provided `--site-profiles-dir` path to verify `site:` references; it still must not read secrets or contact Google APIs.

`pnpm site:data` builds the public index badge-field data and the avatar atlases into `public/assets/`, and `pnpm exec astro build` bundles the Astro site into `dist/`. `pnpm site:build` runs both but accepts no flags; pass flags to `site:data`. Atlas building fetches public avatar URLs over the network; pass `--skip-avatars` for an offline build, which renders the badges as flat coloured discs. `pnpm site:dev-fixture` downloads the already-published `site-data.json` from the public site into `tmp/dev/` so the page can be worked on at real scale. None of these commands read credentials or contact Google APIs.

Do not run commands that read `GOOGLE_APPLICATION_CREDENTIALS` or contact Google APIs unless the user explicitly asks for that exact operation and the command can run without exposing secret contents. This includes credentialed commands such as `pnpm sheets:init` and `pnpm sheets:export`, even when the operation is read-only.

## Data Minimization

Public historical records should only include data needed for the event contribution index, such as event name, year, role, public display name, source URL, and profile-link status.

Do not publish private email addresses, phone numbers, addresses, identity documents, internal contact information, non-opt-in social accounts, or unrelated private information.

Internal Google Workspace documents may be used as maintenance leads, but access to an internal document does not make its contents publishable. Data should be published only when it comes from a public event source, reviewed canonical data, or opt-in profile input.

## Human Review Required

Stop and ask a maintainer before making or accepting changes involving:

- adding, changing, or splitting a historical appearance link to a GitHub username profile
- expanding event scope beyond the documented scope
- expanding person scope beyond staff and speakers
- resolving a conflict between official websites, archives, old repos, Google Sheets, or other sources
- processing requests to remove profile data or unlink a profile from historical appearances
- changing the privacy, removal, or historical-record retention policy

Self-service profile PR automation must route the cases above to maintainer review instead of auto-accepting them.

LLM agents may identify candidates, summarize evidence, and mark items for review. They must not make the final decision for the cases above.

## Source and Access Limits

If you cannot access a Sheet, Form, source page, archive, or repo, say that the information is unknown or unavailable. Do not fill gaps from memory or inference.

When sources conflict, preserve the uncertainty and route the decision to maintainers. Do not silently choose the most convenient source.

If a source is outside this repository, do not claim that it has been corrected. You may document the discrepancy or propose a follow-up.

## Agent Operating Rules

- Inspect the current repository state before editing.
- Keep changes small, reviewable, and aligned with the existing documentation.
- Separate confirmed facts from inference when reporting data quality or identity issues.
- Do not invent people, roles, aliases, biographies, source URLs, event names, or profile links.
- Do not turn guesses into data. Mark uncertain records for human review instead.
- Do not overwrite maintainer-controlled Google Workspace assumptions unless the user asks for a policy change.
- Keep public-facing wording respectful and non-ranking. This project records and thanks contributors; it must not turn contribution history into a leaderboard.

## Documentation Expectations

- `README.md` is the friendly starting point for community members and maintainers.
- `docs/data-model.md` is the reader-facing source for data authority, scope, Sheets model, identity boundaries, and privacy policy.
- `docs/workflows.md` is the reader-facing source for cross-repository GitHub Actions flowcharts and automation boundaries.
- `docs/maintainer-guide.md` is the reader-facing source for local tools, credentialed operations, and maintainer setup.
- `AGENTS.md` is the local instruction entrypoint for LLM agents.
- The GitHub Pages frontend is an Astro 5 site. The public index is a three.js 3D badge field (`src/pages/index.astro`, `src/styles/index.css`, `src/scripts/index-page.js`, `src/scripts/field/*`); the claim flow is a separate page (`src/pages/claim.astro`, `src/scripts/claim-page.js`, `src/styles/claim.css`). Keep frontend expectations, usage scenarios, and redesign ideas routed to https://github.com/sitcon-tw/credits/issues/2 so they are collected before further interface work; deployment failures, data security or privacy risks, visibly wrong public data, and an existing required flow becoming unusable are always in scope to fix.
- Keep `AGENTS.md` focused on agent-facing policy, safety boundaries, and routing rules. Do not turn it into the complete command manual as repository tooling grows.
- Future technical docs should distinguish planned behavior from implemented behavior.
- If tool-specific operational detail grows beyond short guardrails, move it into dedicated maintainer documentation and link or summarize the boundary here.
- When adding data model docs later, describe the minimum fields, source-of-truth rules, and maintenance flow before adding automation.
