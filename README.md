# Profit Lab

Profit intelligence for hour-sellers. A Code63 Labs product.

Connects to a small service business's Jobber account (read-only) and shows the owner
what every hour actually earns — which work makes money, which quietly doesn't, and
what to change. Plain-English advice powered by the Claude API, computed by our own engine.

## Stack

- Plain Node.js (zero runtime dependencies by design — portable anywhere)
- Postgres (coming: accounts, tokens, reports)
- Deployed on Render; `Dockerfile` included for portability

## Run locally

```
node server.js
# http://localhost:4700
```

## Structure

- `server.js` — web server
- `public/` — landing page + live demo report
- (coming) `engine/` — Jobber OAuth, data pull, profit-per-hour analysis
