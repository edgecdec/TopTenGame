// Answer-pool scoping. Given a question's subtheme, returns the code prefix
// (or allowed-code list) the client should filter the Autocomplete dropdown by.
// Shared between server.js (multiplayer) and solo.ts (single-player).
//
// Subthemes not listed here stay unfiltered — including intentionally mixed
// pools like "Pro Sports - Cross League" and "European Soccer - European".
//
// When the map grows past ~15 entries or a second scoping attribute (per-sub
// beta flag, description, sort order) is needed, move this to a JSON config
// under data/ and read it in from seed. Not before — the map is small and
// still fits comfortably on one screen.

const SUBTHEME_PREFIX = {
  "Pro Sports - NBA": "NBA-",
  "Pro Sports - NFL": "NFL-",
  "Pro Sports - MLB": "MLB-",
  "Pro Sports - NHL": "NHL-",
  "European Soccer - Premier League": "EPL-",
  "European Soccer - La Liga": "LAL-",
  "European Soccer - Bundesliga": "BUN-",
  "European Soccer - Serie A": "SEA-",
  "European Soccer - Ligue 1": "L1-",
};

function scopingForSubtheme(_theme, subtheme) {
  return { codeFilter: SUBTHEME_PREFIX[subtheme] ?? null, allowedCodes: null };
}

module.exports = { scopingForSubtheme, SUBTHEME_PREFIX };
