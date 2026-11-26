# GovGuide AI — Working Prototype

Full-stack prototype of **GovGuide AI**: a role-aware South African government policy & legislation assistant powered by Node.js, Express, and Google's `@google/genai` SDK.

## Quick Start (Windows)

1. Double-click `start-govguide.bat` (or run `npm.cmd install` then `npm.cmd start` from this folder).
2. Open **http://localhost:3000** in your browser.
   > **Important:** Do not open `public/index.html` directly from Explorer (`file://`). Always access it through `http://localhost:3000`.
3. To enable live Gemini answers:
   - Get an API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
   - Open `.env` and set `GEMINI_API_KEY=your_key_here`.
   - Restart the server.
   - Without an API key, GovGuide AI still runs in **Local Grounded Mode** so you can test search, RBAC, document uploads, and citations immediately.

## Health Check

Visit `http://localhost:3000/api/health` to inspect server status, Gemini configuration, model name, and loaded document counts.

## Demo Employee Accounts

- **Thandi Mokoena** (Director: Labour Policy — Employment & Labour, Level 3 Confidential):
  - Sign in: `thandi.mokoena@labour.gov.za` | Employee No: `11204567` | Password: `govguide`
- **Sipho Dlamini** (Administrative Officer — Employment & Labour, Level 1 Public):
  - Register first: `sipho.dlamini@labour.gov.za` | Employee No: `11208890` | Create any 8+ char password
- **Lerato Naidoo** (Chief Director: SCM — National Treasury, Level 3 Confidential):
  - Register first: `lerato.naidoo@treasury.gov.za` | Employee No: `22013345` | Create any 8+ char password

## Features Implemented

- **Server-side RBAC**: Documents and retrieved passages are filtered on the backend by department and clearance level (`Public`, `Internal`, `Confidential`).
- **Gemini SDK Integration (`@google/genai`)**: Grounded JSON-structured responses citing exact document titles, sections, versions, and statuses.
- **Status Governance**: Flags superseded circulars (linking their replacement), drafts (not in force), and documents under review.
- **Upload Real Policies**: Upload `.pdf`, `.docx`, `.txt`, or `.md` files in the Knowledge Library; they are parsed into searchable sections and immediately queryable by your department's authorised users.
