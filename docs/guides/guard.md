# Guard: what it removes

Every text an agent writes to the shared board — notes, messages, answers,
comments, lessons, `WORKBOARD.md` entries and dream proposals — passes Guard
before it is stored. A recognised secret is replaced with `[secret removed]`, so
it never reaches disk, another agent, `WORKBOARD.md` or `LOGBOOK.md`, and you
get a message telling you to rotate the key. Guard also strips invisible
characters and quarantines text that reads like an order to other agents; those
parts are described in the [README](../../README.md) under "Safety and proof".

This page is the full list of the **kinds of secrets** Guard recognises today.
The authoritative list is the first element of each entry in `SECRET_RULES` in
`src/guard.js`; print the current list yourself with:

```sh
node -e "const {SECRET_RULES}=require('./src/guard'); console.log([...new Set(SECRET_RULES.map(r => r[0]))].join('\n'))"
```

The shapes below are written **in words on purpose**: they name a prefix and the
length or character set of the opaque part. No complete token, real or invented,
appears on this page, so GitHub secret scanning has nothing to flag.

## AI providers, model and search APIs

| Kind | Shape (described in words) |
|---|---|
| Anthropic key | prefix `sk-ant-` followed by 20 or more letters, digits, underscores or hyphens |
| OpenAI key | prefix `sk-`, optionally followed by `proj-`, `svcacct-` or `admin-`, then 20 or more letters, digits, underscores or hyphens |
| Firecrawl API key | prefix `fc-` and a bounded body of 24–128 characters that contains at least one uppercase letter |
| Groq key | prefix `gsk_` followed by 30 or more letters and digits |
| xAI API key | prefix `xai-` and a bounded body of 24–128 letters, digits, underscores or hyphens |
| Tavily API key | prefix `tvly-` and a bounded body of 32–128 characters that contains at least one uppercase letter |
| Replicate token | prefix `r8_` followed by 30 or more letters and digits |
| Hugging Face token | prefix `hf_` followed by 30 or more letters and digits |
| LangSmith API key | prefix `lsv2_pt_` or `lsv2_sk_` and a bounded body of 24–256 characters that contains at least one uppercase letter |
| NVIDIA NGC API key | prefix `nvapi-` followed by 24 or more characters that contain at least one uppercase letter |
| Google API key | prefix `AIza` followed by exactly 35 letters, digits, underscores or hyphens |

## Code hosting, CI and package registries

| Kind | Shape (described in words) |
|---|---|
| GitHub token | one of the `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` prefixes plus 30 or more alphanumerics, or `github_pat_` plus 40 or more characters |
| Bitbucket API token | the documented `ATAT` header, then 171 characters, an equals sign and 8 hexadecimal digits |
| GitLab token | prefix `glpat-` followed by 20 or more characters |
| GitLab CI job token | an optional short instance prefix, then `glcbt-` and either three dot-separated segments or a long opaque body; requires an uppercase letter |
| GitLab runner authentication token | prefix `glrt-` or `glrtr-` followed by a bounded opaque body |
| GitLab pipeline trigger token | prefix `glptt-` followed by a bounded opaque body with at least one uppercase letter |
| GitLab deploy token | prefix `gldt-` followed by a bounded opaque body with at least one uppercase letter |
| Azure DevOps PAT | 75 alphanumerics, the literal marker `AZDO`, then 5 more alphanumerics |
| SonarQube API token | one of the `squ_`, `sqa_`, `sqp_` prefixes followed by 40 lowercase hexadecimal digits |
| Docker Hub access token | prefix `dckr_pat_` or `dckr_oat_` followed by 27 or more characters with at least one uppercase letter |
| npm token | prefix `npm_` followed by exactly 36 alphanumerics |
| PyPI token | prefix `pypi-` followed by 85 or more base64url characters |

## Cloud, infrastructure and observability

| Kind | Shape (described in words) |
|---|---|
| AWS access key | prefix `AKIA` or `ASIA` followed by 16 uppercase letters and digits |
| Azure Storage account key | an `AccountKey=` assignment whose value is 86 base64 characters ending in `==` |
| Google Cloud Storage signed URL signature | the value of an `X-Goog-Signature=` query parameter, 64–1024 lowercase hexadecimal digits |
| Google OAuth client secret | prefix `GOCSPX-` followed by exactly 28 characters |
| Cloudflare API credential | one of the `cfk_`, `cfut_`, `cfat_` prefixes, then 40 alphanumerics and an 8-digit hexadecimal checksum |
| DigitalOcean token | one of the `dop_`, `doo_`, `dor_` prefixes, then `v1_` and 64 lowercase hexadecimal digits |
| Databricks personal access token | prefix `dapi` followed by 32 hexadecimal digits |
| Doppler authentication token | prefix `dp.` and a typed segment (`ct`, `pt`, `sa`, `said`, `scim`, `audit` or `st` with an optional environment slug), then 40–44 alphanumerics |
| HashiCorp Vault token | prefix `hvs.`, `hvb.` or `hvr.` followed by 24 or more characters with at least one uppercase letter |
| Terraform Cloud API token | 14 alphanumerics, the marker `.atlasv1.`, then 60–70 characters |
| Pulumi Cloud access token | prefix `pul-` followed by 40 lowercase hexadecimal digits |
| Vercel API credential | one of the `vcp_`, `vci_`, `vca_`, `vcr_`, `vck_` prefixes followed by 40–80 alphanumerics |
| Supabase secret key | prefix `sb_secret_`, 22 characters, an underscore and an 8-character checksum; the first part must contain an uppercase letter |
| Grafana service account token | prefix `glsa_`, 32 alphanumerics, an underscore and 8 hexadecimal digits |
| Tailscale key | prefix `tskey-`, a type word (`api`, `auth`, `client`, `scim` or `webhook`), then two hyphen-separated segments, the last containing an uppercase letter |
| 1Password service account token | prefix `ops_eyJ` followed by a long bounded base64 payload and up to three padding characters |
| Sentry organization token | prefix `sntrys_eyJ`, a bounded base64 JSON payload, an underscore and 43 base64 characters |
| PostHog private token | prefix `phx_` or `phs_` with 48 or more base57 characters, or `pha_` or `phr_` with 44 or more; the payload must not look like an ordinary lowercase identifier |
| Linear API key | prefix `lin_api_` followed by exactly 40 alphanumerics |
| Notion integration token | prefix `ntn_`, 11 digits, then 35 alphanumerics |

## Chat, webhooks, email and work tools

| Kind | Shape (described in words) |
|---|---|
| Discord bot token | three dot-separated segments of roughly 24, 7 and 32 characters; the first must decode to a numeric snowflake, which Guard validates |
| Discord webhook URL | a `discord.com` or `discordapp.com` `/api/webhooks/` URL with a 17–20 digit ID and a long token path segment |
| Telegram bot token | an 8–16 digit bot ID, a colon and 35 characters; the ID must fit in 52 bits, which Guard validates |
| Slack token | prefix `xox` plus one of `a`, `b`, `p`, `o`, `s` or `r`, a hyphen and 10 or more characters |
| Slack app-level token | optional `xoxe.` prefix, then `xapp-`, a version number, an app ID starting with `A`, a numeric ID and a long secret segment |
| Slack incoming webhook URL | a `hooks.slack.com` or `hooks.slack-gov.com` `/services/` URL with three path segments: a `T`/`E` ID, a `B` ID and a long token |
| SendGrid key | prefix `SG.`, 22 characters, a dot and 43 characters |
| Resend API key | prefix `re_` followed by 24 or more characters with at least one uppercase letter |

## Payments and commerce

| Kind | Shape (described in words) |
|---|---|
| Stripe key | prefix `sk_` or `rk_`, then `live_` or `test_`, then 20 or more alphanumerics |
| Stripe webhook secret | prefix `whsec_` followed by a bounded run of 20–128 alphanumerics |
| Shopify token | one of the `shpat_`, `shpca_`, `shppa_`, `shpss_` prefixes followed by 32 hexadecimal digits |

## Generic: headers, passwords, keys and tokens

| Kind | Shape (described in words) |
|---|---|
| private key | a PEM block from a `BEGIN ... PRIVATE KEY` line to its matching `END` line, or to the end of the text |
| JWT | three base64url segments separated by dots, the first two starting with `eyJ` |
| HTTP cookie header | a `Cookie:` or `Set-Cookie:` line containing at least one `name=value` pair; Guard keeps the header name and removes the value |
| authorization token | an `Authorization:` header using `Bearer`, `Token` or `Basic` followed by a value, even a short one |
| password | an assignment (with `:` or `=`) to a name such as `password`, `passwd`, `pwd`, `secret`, `api_key`, `access_token`, `auth_token` or `client_secret`, with a quoted or bare value of at least 6 characters; it also matches inside names like `DB_PASSWORD` |
| connection string password | a URI of the form `scheme://user:password@host`, where the password is the part between the colon and the `@` |

## What Guard deliberately does not redact

Several rules require at least one uppercase letter in the opaque part, because
an all-lowercase kebab-case or snake_case identifier after a known prefix is
far more likely to be an ordinary variable name than a credential. Public
project identifiers are excluded too: PostHog `phc_` project keys are not
secrets, so only the private `phx_`, `phs_`, `pha_` and `phr_` forms are
matched. The `[secret removed]` marker itself is never matched again, and
values shorter than the documented bounds (except complete Authorization and
Cookie headers) are left alone.

These are detection heuristics, not format validators: a real credential whose
shape differs from the table may slip through, and a long random identifier
that happens to share a prefix may be redacted. Guard is a safety net, not a
replacement for keeping secrets out of shared memory in the first place.
