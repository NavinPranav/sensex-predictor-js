# Sensex Predictor — Frontend

Minimal React (Next.js) frontend for testing the prediction API.

## Setup

```bash
npm install
```

## Configure

Edit `.env.local` and set your backend URL:
```
NEXT_PUBLIC_API_URL=http://YOUR_ORACLE_CLOUD_IP:8080
```

## Run locally

```bash
npm run dev
# Opens at http://localhost:3000
```

## Deploy to Vercel

1. Push to GitHub
2. Go to vercel.com → Import project
3. Add env variable: NEXT_PUBLIC_API_URL = http://YOUR_IP
4. Deploy

## Pages

- **Login** — email + password auth via /api/auth/login
- **Dashboard** — shows prediction from /api/predictions/latest
  - 1D / 3D / 1W horizon selector
  - Direction, magnitude, volatility, confidence
  - Auto-refreshes every 5 minutes
