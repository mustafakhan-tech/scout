# Scout

Find creators on YouTube, Instagram and TikTok by niche, then filter them by followers, average views, average likes, engagement rate and country.

Built by Mustafa Khan for scouting creators at Nexus Partners, and for any brand that wants to find creators without paying for a full influencer platform.

## What it does

- **Searches by niche** on one, two or all three platforms, with an optional region.
- **Measures recent performance.** Scout reads each creator's latest posts (10 on YouTube, 8 on Instagram and TikTok) and averages their views, likes and comments, so you're comparing how accounts perform now, not just how big they are.
- **Gives two engagement rates.** Likes plus comments per post, divided either by followers (the usual Instagram measure) or by views (better for TikTok and YouTube, where reach doesn't depend on followers).
- **Puts a histogram on every filter.** Each slider shows how the current results are spread out, so you can see where the mid-tier creators cluster before you set a range.
- **Works out CPM.** Enter a fee per post and every creator gets a cost per 1,000 views.
- **Keeps a shortlist and exports CSV.** Star creators to keep them, then export to a sheet for outreach.

## How the data works

| Platform | Source | Country comes from |
|---|---|---|
| YouTube | Official YouTube Data API v3 | The channel's own profile setting |
| TikTok | Apify actor `clockworks/tiktok-scraper` | Where recent videos were posted (most common) |
| Instagram | Apify actor `apify/instagram-scraper` | The business address, when the account has one |

Instagram and TikTok don't offer a public creator search API, so Scout uses Apify scrapers for them. Those platforms' terms don't allow scraping, so keep live search for your own scouting at small scale. Don't open it up as a public service.

**Sample mode vs live mode.** Anyone who opens the site sees sample mode: invented creators, with the same filters and math. Live search needs a password, so visitors can't spend your API credits.

YouTube searches return in a few seconds. Instagram and TikTok start an Apify run in the background, and their results appear in the table as soon as the run finishes, usually within 1 to 3 minutes.

## Costs

- **YouTube:** free. The default quota is 10,000 units a day, and search calls draw on that quota.
- **Apify:** the free plan includes $5 of usage a month. These actors charge roughly $2–3 per 1,000 results. Every run is capped at `APIFY_MAX_CHARGE_USD` (50¢ by default).

## Setup

1. **YouTube key.** Go to console.cloud.google.com, create a project, enable "YouTube Data API v3", then go to Credentials and create an API key. Restrict the key to that API.
2. **Apify token.** Create a free account at apify.com, then copy your token from Settings → API & Integrations.
3. **Run locally:**
   ```bash
   npm install
   cp .env.example .env.local   # fill in SCOUT_PASSWORD, YOUTUBE_API_KEY, APIFY_TOKEN
   npm run dev
   ```
4. **Deploy:** push to GitHub, import the repo at vercel.com/new, and add the same three variables under Settings → Environment Variables.

## Code tour

```
app/page.tsx                       search, filters, results table
app/components/RangeHistogram.tsx  dual-thumb slider drawn over a histogram
app/api/search/route.ts            runs YouTube searches, starts Apify runs, serves sample data
app/api/jobs/[platform]/[runId]    checks an Apify run and normalizes its results
lib/youtube.ts                     channel search + recent-upload stats
lib/apify.ts                       actor inputs and TikTok/Instagram normalizers
lib/metrics.ts                     averages, engagement rates, CPM
lib/filters.ts                     filtering, log-scale sliders, sorting, CSV export
lib/sample.ts                      deterministic invented creators for sample mode
```

Tests cover the metrics, normalizers, filters, CSV escaping and access rules: `npm test`.

## Limits worth knowing

- YouTube's country is self-reported and often blank.
- Instagram hides like counts on some posts. Scout leaves those posts out of the average.
- Instagram photos have no view count, so their average views come from video posts only.
- Scrapers break when platforms change their pages. If a run fails, check the actor's page on Apify for updates.
