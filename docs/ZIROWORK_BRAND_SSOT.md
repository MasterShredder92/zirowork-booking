# ZiroWork Brand Asset SSOT

**Status:** Canonical. Use this file as the rule for every ZiroWork repo.

## The Rule

ZiroWork uses exactly two visible brand asset types across public web properties.

| Slot | Required Asset | Purpose |
|---|---|---|
| Main logo, nav logo, header logo, footer logo, login logo, social preview image | `zirowork-logo-horizontal-bolt.png` | Horizontal ZiroWork text logo with the lightning bolt. |
| Favicon, browser tab icon, app icon, apple touch icon, circle avatar, square icon-only slots | `zirowork-bolt-icon.png` plus generated sizes | Bolt-only icon. |

Do not use alternate logos for public ZiroWork brand slots. Do not use old marks, random lightning files, square text logos, stacked logos, or background variants as the main visible logo.

## Canonical Asset Files

| Asset | Canonical Source Path | SHA256 |
|---|---|---|
| Horizontal wordmark + bolt | `/brand/zirowork-logo-horizontal-bolt.png` | `6267ec65949789a8e61d79a8a21d4db521e7e3d3591591a2fbc4e9281e05a5ae` |
| Bolt icon, default 512px | `/brand/zirowork-bolt-icon.png` | `80965aaf9e0eef2e8d158ec9cb24ced8726a3f91a980c8b84bd2d3ddc6a4b5df` |
| Bolt icon, 192px | `/brand/zirowork-bolt-icon-192.png` | `1a85f740a48a0e5fae324a73e66c4ebe65e9360ac3b987bbcfa4cb7200eae293` |
| Bolt icon, 512px | `/brand/zirowork-bolt-icon.png` | `80965aaf9e0eef2e8d158ec9cb24ced8726a3f91a980c8b84bd2d3ddc6a4b5df` |
| Favicon ICO | `/brand/favicon.ico` | Generated from the bolt-only icon. |
| Favicon 16x16 | `/brand/favicon-16x16.png` | Generated from the bolt-only icon. |
| Favicon 32x32 | `/brand/favicon-32x32.png` | Generated from the bolt-only icon. |
| Apple touch icon | `/brand/apple-touch-icon.png` | Generated from the bolt-only icon. |

## Required HTML Head Block

Every public ZiroWork page should include these tags. Use the path that matches the repo's static root.

```html
<link rel="icon" href="/brand/favicon.ico" />
<link rel="icon" type="image/png" sizes="16x16" href="/brand/favicon-16x16.png" />
<link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32x32.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/brand/apple-touch-icon.png" />
<meta property="og:image" content="/brand/zirowork-logo-horizontal-bolt.png" />
<meta name="twitter:image" content="/brand/zirowork-logo-horizontal-bolt.png" />
```

## Required Visible Logo Pattern

Use the horizontal wordmark for visible ZiroWork text/logo slots.

```html
<img src="/brand/zirowork-logo-horizontal-bolt.png" alt="ZiroWork" />
```

Use the bolt-only icon only when the UI slot is square or circular.

```html
<img src="/brand/zirowork-bolt-icon.png" alt="ZiroWork" />
```

## Static Asset Location Rules

| Repo Type | Correct Brand Asset Root |
|---|---|
| Plain static HTML repos | `public/brand/` and, if Vercel config serves root static files, `brand/` |
| Vite repos with root `publicDir` | `public/brand/` |
| Vite repos with `client/public` | `client/public/brand/` |
| Built `dist` folders | Do not edit by hand unless the repo intentionally commits `dist`; regenerate from source where possible. |

## Approved Rollout Repos

| Repo | Public Domain | Branch |
|---|---|---|
| `MasterShredder92/zirowork-booking` | `book.zirowork.com` | `main` |
| `MasterShredder92/zirowork-waitlist` | `zirowork-waitlist.vercel.app` | `master` |
| `MasterShredder92/zirowork-university` | `university.zirowork.com` | `main` |
| `MasterShredder92/zirowork-signup-static` | `signup.zirowork.com` | `master` |
| `MasterShredder92/zirowork-vault` | `myvault.zirowork.com` | `main` |
| `MasterShredder92/zirowork-playbook` | `playbook.zirowork.com` | `main` |
| `MasterShredder92/zirowork-founders` | `founders.zirowork.com` | `main` |
| `MasterShredder92/zirowork-connect` | `connect.zirowork.com` | `main` |
| `MasterShredder92/zirowork-audit` | `audit.zirowork.com` | `main` |
| `MasterShredder92/ziro-work` | `app.zirowork.com` | default branch |

## No-Touch Rule

Do not change non-ZiroWork repos. Do not change ZiroWork backend/service repos unless they serve a public UI that needs the visible brand assets.

## New Repo Rule

When creating a new ZiroWork repo, copy this SSOT into `docs/ZIROWORK_BRAND_SSOT.md`, copy the canonical assets into the repo's correct static brand folder, and wire the HTML head block before the repo is deployed.

## Verification Rule

A repo passes only when all are true:

| Check | Pass Condition |
|---|---|
| Main visible logo | Every text/logo slot references `zirowork-logo-horizontal-bolt.png`. |
| Favicon/browser tab | Every favicon tag references files generated from the bolt-only icon. |
| Social image | `og:image` and `twitter:image` reference `zirowork-logo-horizontal-bolt.png`. |
| Static serving | `/brand/zirowork-logo-horizontal-bolt.png`, `/brand/zirowork-bolt-icon.png`, and favicon paths return HTTP 200 live. |
| Scope | Only approved ZiroWork repos were changed. |
