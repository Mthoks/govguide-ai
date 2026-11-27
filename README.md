# GovGuide AI — Government Knowledge & Policy Assistant

GovGuide AI is a Node.js/Express prototype for asking policy questions in plain language and tracing answers to authorised source passages. The included corpus contains public legislation extracts and synthetic internal governance examples; it does not contain real classified material.

## Run locally (Windows)

1. Install Node.js **22.13 or newer**.
2. Run `npm.cmd install`.
3. Optionally add a Google Gemini API key to `.env` (`GEMINI_API_KEY=`). Without a key, the app uses its local extractive response mode.
4. Run `npm.cmd start` or double-click `start-govguide.bat`.
5. Open <http://localhost:3000>. Do not open `public/index.html` directly from disk.

Run the automated checks with `npm.cmd test`.

The included demo employee account is `thandi.mokoena@labour.gov.za`, employee number `11204567`, password `govguide`. The other simulated employee records can register their own demo password. This registry is hard-coded for prototype use and is not an identity provider.

## Prototype capabilities

- **Conversation and follow-ups:** the chat keeps recent user questions for follow-up context; those messages are never treated as evidence.
- **Corpus-only answers and citations:** retrieval selects authorised sections from the supplied local corpus. Gemini responses are required to return individual claims with citations to retrieved document IDs and exact sections. The server rejects invented document/section references and falls back to corpus excerpts. Gemini requests time out after 30 seconds; provider errors try the backup model, while connection timeouts and backup failures return a local grounded response with a notice. Each claim includes document, section and version; source cards open the indexed document and, where available, the official public URL.
- **Version/status awareness:** current, superseded, draft and under-review records are distinguished. The server adds explicit warnings for non-current citations; the local response does likewise.
- **Ingestion:** file uploads simulate a departmental DMS or SharePoint repository; an additional web-source flow accepts only HTTPS URLs on `gov.za` and `treasury.gov.za`. PDF, DOCX, TXT, Markdown, PNG, JPG and TIFF are supported. Scanned PDFs/images use local English OCR; a scanned PDF is limited to 30 pages.
- **Metadata and retrieval:** owner, date, status, version, classification and repository are retained. PDF/DOCX/text contents are sectioned for search.
- **Access and privacy safeguards:** server-side signed sessions enforce department and clearance checks; the browser cannot select a user by ID. Uploaded text and questions are scrubbed for common South African ID, PERSAL, email and phone patterns before indexing, logging or model submission. Login, chat and upload routes are rate-limited.
- **Governance and oversight:** user feedback and PII-redacted knowledge gaps are recorded locally; the interface makes clear that officials—not the assistant—make decisions.
- **Accessibility:** responsive layout, keyboard-operable controls, adjustable type size, high-contrast mode, and optional speech input.

## Data and deployment caveats

- The supplied documents and employee identities are demo content. Classification levels are illustrative only; this prototype is **not MISS-certified** and must not be used with classified, confidential, personal, or operational government information.
- The default employee registry, demo password, local JSON storage, and local signing-secret file are for a single-machine demonstration. A real SITA deployment needs an approved identity provider, managed secrets, durable access-controlled storage, repository connectors, retention controls, and security/privacy assessment.
- With Gemini enabled, retrieved passages are sent to Google's API. Use only public or synthetic material unless the department has approved the service and data handling. Without Gemini, answer generation remains local.
- `GEMINI_MODEL` and `GEMINI_FALLBACK_MODEL` can be set for models available to your API key. The fallback defaults to `gemini-3.5-flash-lite`; `gemini-2.5-flash` is deprecated and API access is limited. See Google's [current model list](https://ai.google.dev/gemini-api/docs/models).
- OCR runs on the server. On first OCR use, Tesseract.js downloads its English language model into the ignored `data/.ocr-cache/` directory unless `TESSDATA_PATH` points to a locally provisioned model directory. The document itself is not sent to the model host.
- Web ingestion is intentionally restricted to the listed government domains; it is not a general-purpose URL fetcher. Verify source metadata and currentness before relying on ingested material.
- This is a hackathon prototype, not legal advice or an authoritative interpretation of legislation. Verify cited source documents and consult the responsible policy owner.
