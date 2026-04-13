# Mapping the Modern Agora — site

A single-page replacement for the existing five-page MapAgora dashboard, designed in the
visual language of the SNF Agora Institute at Johns Hopkins. The page consolidates the
project overview, the interactive county-level map, four data-driven findings, the
methods and data-access section, and the publications list into one document.

## What's in the box

```
.
├── index.html      # the page (HTML + all CSS, ~50 KB)
├── app.js          # front-end app: map, sidebar, story charts (~18 KB)
├── agora_data.json # baked county data + pre-computed story stats (~2 MB)
├── build_data.py   # script that produces agora_data.json from the source CSVs
└── README.md       # this file
```

That's the whole site. No build step, no bundler, no framework. It is four files.

## How to deploy

It's a static site. Drop the four files into any static host:

- **GitHub Pages**: copy into the `agora_dashboard` repo (or a fresh repo), commit, enable Pages.
- **Netlify / Vercel / Cloudflare Pages**: drag-and-drop the folder.
- **Any web server**: `python3 -m http.server` from this directory and visit
  <http://localhost:8000>. That's enough for local preview.

The page loads three things from public CDNs at runtime:

1. **Google Fonts** — Fraunces (display) and IBM Plex Sans / Plex Mono (body).
2. **D3 v7** and **topojson-client v3** from `cdn.jsdelivr.net`.
3. **`counties-albers-10m.json`** from the `us-atlas` package on `cdn.jsdelivr.net`.
   This is the pre-projected (Albers USA) version of the U.S. county TopoJSON, which
   matches the SVG's `975×610` viewBox without requiring a `d3.geoProjection` call.
   The non-projected `counties-10m.json` will *not* render — the paths come out
   sized for a 360°×180° geographic coordinate system and disappear off-screen.

If you need the site to work offline or air-gapped, vendor those three files locally
and update the URLs in `index.html` and `app.js`.

## How the page is organized

| Section | Anchor | Replaces |
|--|--|--|
| Hero | `#top` | the old `index.html` headline |
| Civic life, made visible | `#about` | `where_to_start.html` + the old `about.html` intro |
| Every county, scored | `#map` | `map.html` |
| Four findings | `#stories` | (new — the storytelling layer the original lacked) |
| Methods & data access | `#methods` | the methods half of `about.html` + Community Uses links |
| Publications | `#publications` | the references at the bottom of `index.html` |

The old `table.html` is intentionally not replicated. If you want a sortable table back,
the cleanest path is a `table.html` that loads the same `agora_data.json` and renders
into a `<table>` — most of the work is already done.

## The interactive map

- **Choropleth** drawn with D3 + TopoJSON, using `counties-albers-10m.json`.
  Pure SVG, no Leaflet, no tile server.
- **Layer toggle** between two views:
  1. *Civic Opportunity Index* (sequential 5-bin scale, cream → deep amber)
  2. *Primary Organization Type* (categorical, navy = Social & Fraternal,
     gold = Religious, etc.)
- **Hover** shows a tooltip with the county name and the relevant statistic for the
  current layer.
- **Click** a county to open a sidebar from the right with a full county profile:
  - Civic opportunity score per 100k + quintile pips
  - National percentile and in-state rank
  - Snapshot grid: population, total nonprofits, civic opportunity orgs, national rank
  - The four civic-opportunity subtype counts (Membership, Volunteer, Public Events,
    Take Action) as horizontal bars
  - The full organization-mix breakdown by type, primary type highlighted in gold
  - Community context from the ACS (poverty, no-HS-diploma, unemployment, etc.)
- **Esc** or the × button closes the sidebar.

## The four findings

These are pre-computed in `build_data.py` so the page does no analysis at runtime:

1. **The U-curve.** Median civic opportunity score per capita by population quintile.
   Highest in the smallest and largest counties; lowest in the middle.
2. **The adversity gap.** Pearson correlation of the civic opportunity score against six
   measures of disadvantage. All six are negative; the strongest signal is no-HS-diploma
   at *r* = −0.45.
3. **The composition.** What is the most common primary organization type in each state.
   Social & Fraternal dominates nationally (~51 % of counties); Religious is second
   (~30 %). The South leans Religious, the Plains and New England lean Social & Fraternal.
4. **The extremes.** Top 10 and bottom 10 counties on the civic opportunity score
   (filtered to counties with ≥ 10,000 residents to avoid small-denominator noise).
   Clicking a row jumps to that county on the map and opens its sidebar.

## Regenerating the data

If the underlying CSVs are updated:

```bash
python3 build_data.py \
  --counts cnty_counts_cov.csv \
  --types  cnty_civic_org_type.csv \
  --out    agora_data.json
```

The script needs `pandas`. It produces a deterministic JSON file (~2 MB) keyed by
5-character FIPS code, plus the four pre-computed story payloads.

## Design notes

- **Type**: Fraunces (display serif, optical-sized) + IBM Plex Sans (body) + IBM Plex
  Mono (eyebrows, labels, numerics). All from Google Fonts.
- **Color**: Hopkins-inspired deep navy (`#0a2540`) and heritage gold (`#c9a24a`) over a
  warm cream paper (`#f7f4ee` / `#fbfaf6`). The map uses a sequential warm ramp
  (cream → gold → deep amber) to keep the categorical and continuous scales visually
  related.
- **Layout**: a hero, then alternating cream / paper sections, then a dark navy methods
  section before the publications and footer. Each story is a numbered "chapter" with a
  big italic numeral.
- **No frameworks**: vanilla JS, vanilla CSS variables. The whole page is < 70 KB before
  data and dependencies.

## Browser support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari). Uses CSS `aspect-ratio`,
CSS variables, modern JS. No IE.

## Credits

Data and underlying research from the **Mapping the Modern Agora** project:
Jae Yeon Kim, Milan de Vries, and Hahrie Han at the SNF Agora Institute, Johns Hopkins
University. Datasets are CC-BY 4.0 and live at:

- GitHub: <https://github.com/snfagora/american_civic_opportunity_datasets>
- Harvard Dataverse: <https://doi.org/10.7910/DVN/IRCA7C>
- Data paper: <https://www.nature.com/articles/s41597-025-05353-6>
# modern_agora_dashboard
