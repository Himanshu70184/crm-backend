# TODO - Fix 413 Payload Too Large on POST /api/attendance/clock-in

- [ ] Inspect request parsing limits in server.js (express.json / express.urlencoded) and identify missing body size config
- [ ] Implement server-side payload limit update (set explicit limit for JSON/urlencoded) OR switch clock-in to file upload if base64 screenshots are included
- [ ] Update related controller/routes if they currently accept base64 or large note payloads
- [ ] Add clear error handling/logging for oversized payloads (optional)
- [ ] Run server + reproduce request to confirm 413 resolved

