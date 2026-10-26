# Phase 11.3 - Ownership Statement Remove Total Fees Paid Field

Changes:
- Removed the visible "Total Fees Paid In Period" field from Ownership Statement Part C.
- Kept the internal hidden value for backward compatibility so existing save/calculation logic does not break.
- Kept Add Row rent entries and Total Rent auto-sum behavior.

Deploy on Hostinger (Node.js Web App):
- Use hPanel -> Websites -> Add Website -> Node.js Apps (Business or Cloud plan required).
- Upload a zip created with: npm run zip:hostinger
  (package.json must be at the zip root, not inside a subfolder.)
- Framework: Next.js
- Node version: 22.x
- Root directory: . (leave empty / project root)
- Build command: npm run build
- Start command: npm start
- Output directory: .next
- Do not include node_modules or .next in the zip; Hostinger installs and builds on the server.

### Environment variables (required — do not rely on a server `.env` file)
Zip uploads can replace project files and wipe a server-side `.env`.  
Store secrets in **hPanel → your Node.js app → Environment Variables** so they survive redeploys:

| Variable | Example / note |
|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string (URI, pooler ok) |
| `DIRECT_URL` | Same DB, direct (non-pooler) connection if you use migrations |
| `NEXTAUTH_URL` | `https://sharehousemanagers.com` |
| `NEXTAUTH_SECRET` | Long random string (`openssl rand -base64 32`) |
| `RESEND_API_KEY` | For signing emails |
| `EMAIL_FROM` | Verified sender in Resend |

If login shows `Environment variable not found: DATABASE_URL`:
1. Re-add the variables above in Hostinger Environment Variables (from Supabase / Resend dashboards).
2. Save, then **Restart** the Node.js app.
3. Do not recreate the whole Node app unless necessary — that also clears env vars.

Manual deploy (if already built on server):
- Root directory: repository root (not `.next` only)
- Build command: npm install && npm run build
- Output directory: .next
- Node version: 22.x
- Start command: npm start

Required files on server after deploy:
- `server.js`
- `package.json`
- `node_modules`
- `.next`
- `lib/shm/templates/ownership-statement-template.docx`
- `lib/shm/templates/property-management-agreement-template.docx`
- `public/shm-plugin-assets/`

If the site shows `504 Gateway Time-out`, restart the Node app in hosting and confirm `npm run build` completed successfully.

If signing links show a blank/404 page:
- Redeploy with a fresh `npm run zip:hostinger` upload and full rebuild.
- Confirm Start command is `npm start` (or `node server.js`) and Output directory is `.next`.
- Signing now loads via `/sign-document` (embedded frame) and posts to `/shm-docs/*` (Hostinger was 404ing `/api/*` route handlers).

No SQL change required.
