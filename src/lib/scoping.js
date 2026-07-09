// Answer-pool scoping. Given a question's subtheme, returns either a code
// prefix (cheap client-side filter) or an explicit allowed-code list. Shared
// between server.js (multiplayer) and solo.ts (single-player) so both modes
// scope the Autocomplete dropdown to just the relevant sub-set.
//
// Cross-league / cross-country subthemes ("Pro Sports - Cross League",
// "European Soccer - European") stay unfiltered so all options remain visible.

function scopingForSubtheme(theme, subtheme) {
  const st = subtheme || "";
  if (theme === "US Big 4 Sports" || theme === "Pro Sports Teams") {
    if (st === "Pro Sports - NBA") return { codeFilter: "NBA-", allowedCodes: null };
    if (st === "Pro Sports - NFL") return { codeFilter: "NFL-", allowedCodes: null };
    if (st === "Pro Sports - MLB") return { codeFilter: "MLB-", allowedCodes: null };
    if (st === "Pro Sports - NHL") return { codeFilter: "NHL-", allowedCodes: null };
  }
  if (theme === "European Soccer Clubs") {
    if (st === "European Soccer - Premier League") return { codeFilter: "EPL-", allowedCodes: null };
    if (st === "European Soccer - La Liga") return { codeFilter: "LAL-", allowedCodes: null };
    if (st === "European Soccer - Bundesliga") return { codeFilter: "BUN-", allowedCodes: null };
    if (st === "European Soccer - Serie A") return { codeFilter: "SEA-", allowedCodes: null };
    if (st === "European Soccer - Ligue 1") return { codeFilter: "L1-", allowedCodes: null };
  }
  return { codeFilter: null, allowedCodes: null };
}

module.exports = { scopingForSubtheme };
