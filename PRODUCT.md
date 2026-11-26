# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Specialist tracking implementers and web-analytics analysts (GTM, GA4, Meta Pixel, LinkedIn, HubSpot and similar). They debug and audit client sites several times a day, know the vocabulary (`dataLayer`, `gcs`, `gclid`, sGTM), and need to answer "what did each tag actually send, and why not?" fast.

## Product Purpose

Tag Companion is a Chrome MV3 extension that shows what tags really sent, not only what GTM decided to fire. It unifies `dataLayer` pushes, decoded vendor hits, loaded scripts, Consent Mode v2 state, marketing cookies and automatic diagnostics in one session per tab. Success: the analyst finds the broken, duplicated or pre-consent tag in seconds and can export the evidence.

## Positioning

It observes the network and the page directly, so it sees tags fired outside GTM (hardcoded, inline, app code pushing to `dataLayer`), separates "loaded" from "fired" per vendor, correlates events to hits, and flags problems with nine automatic diagnostics.

## Operating Context

Runs inside two surfaces with equal priority: the DevTools "Tags" panel (wide, with a side inspector) and the Chrome Side Panel (narrow, around 400px, inspector overlays the list). Used next to the page being debugged, during live navigation, often for long sessions. Permission is granted per site ("Ativar neste site").

## Capabilities and Constraints

- Views that must all remain: Por Vendor, Linha do tempo, Diagnósticos, Consentimento & Cookies, plus the detail inspector, JSON export, clear session, preserve log and PII masking toggle.
- Four tag states: Carregado, Disparado, Falhou, Carregou mas não disparou.
- Vendors: GTM/sGTM, GA4, Google Ads, Meta Pixel, LinkedIn, HubSpot, Clarity, TikTok, Reddit, X, Mixpanel, OpenAI Ads.
- Stack: React 19, Tailwind CSS 4, lucide-react, Vite; UI shared by both surfaces.
- Interface language: pt-BR.
- Privacy: PII masked on screen and in exports by default; session data is local.

## Evidence on Hand

- PRD and reference images: `/home/rafael-ferreira/Projects/chargeblast-interview-prep/tag-debugger/` (PRD-tag-debugger.md, img/).
- Demo page: `demo/test-site.html`.
- No users, testimonials or metrics exist; do not invent them.

## Product Principles

1. Truth over intent: show what actually went over the wire.
2. Problems surface themselves; the analyst should not hunt for them.
3. Dense but scannable: expert users, long sessions, many rows.
4. Every view works in both the wide DevTools panel and the narrow side panel.
5. Private by default.
