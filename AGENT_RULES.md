# Rules for Agents Producing Question Data

You are producing ranking questions for a top-10-style trivia game. This document is the contract. Follow every rule; failures we've seen in production are called out inline as `⚠️ WHY`.

---

## 1. Output schema

Write ONE JSON file per task. Structure:

```json
{
  "theme": "Countries",
  "subtheme": "Sports",
  "questions": [
    {
      "title": "Most FIFA Men's World Cup wins",
      "prompt": "Name the countries that have won the most FIFA Men's World Cup titles.",
      "source": {
        "name": "FIFA — World Cup archive",
        "url": "https://www.fifa.com/en/tournaments/mens/worldcup",
        "asOf": "2022 (through Qatar)"
      },
      "disclaimer": "West Germany's 3 titles are counted separately from unified Germany's.",
      "trivia": "Brazil is the only country to have played in every World Cup, and won 3 of the first 12.",
      "seededDepth": 8,
      "answers": [
        { "rank": 1, "code": "BR", "value": "5 titles" },
        { "rank": 2, "code": "DE", "value": "4 titles" },
        { "rank": 2, "code": "IT", "value": "4 titles (tied)" },
        ...
      ]
    }
  ]
}
```

Do NOT include any other fields. `note` is legacy — use `disclaimer` + `trivia` instead.

---

## 2. Answer codes MUST match the theme's answer set

Answer sets live at `data/answer_sets.json` keyed by theme name. Every `code` in your answers must exist in that set for the theme you're producing.

**Slug conventions per theme:**

| Theme | Format | Example |
|---|---|---|
| Countries | ISO 3166-1 alpha-2 | `US`, `GB`, `KR`, `XK` (Kosovo), `HK` (SAR), `MO` (SAR) |
| US States | USPS 2-letter | `CA`, `NY`, `DC` |
| Pro Sports Teams | `<LEAGUE>-<ABBR>` | `NBA-LAL`, `NFL-GB`, `MLB-NYY`, `NHL-MTL` |
| Companies | Stock ticker for public / kebab-case for private | `AAPL`, `MSFT`, `BRK-B`, `cargill`, `koch` |
| Chemical Elements | IUPAC symbol (case-sensitive) | `H`, `He`, `Au`, `U` |
| Movies | kebab-case title + release year | `godfather-1972`, `beautiful-mind-2001` |
| Video Games | kebab-case title + release year | `minecraft-2011`, `elder-scrolls-v-skyrim-2011` |
| Video Game Franchises | bare kebab-case, no year | `mario`, `pokemon`, `grand-theft-auto` |

**Movies + Video Games specific slug rules** (⚠️ WHY: we've had many slug-mismatch failures):
- Strip leading `The` and `A` → `The Godfather` → `godfather-1972`, `A Beautiful Mind` → `beautiful-mind-2001`
- Possessives lose apostrophe → `Schindler's List` → `schindlers-list-1993`
- Colons become hyphens → `Legend of Zelda: Ocarina of Time` → `legend-of-zelda-ocarina-of-time-1998`
- Ampersands become `and` → `Ratchet & Clank` → `ratchet-and-clank-2002`
- Roman numerals preserved → `godfather-part-ii-1974`
- Different-year remakes get different slugs → `resident-evil-4-2005` and `resident-evil-4-2023`
- Cross-platform re-releases share ONE code → Skyrim doesn't get 5 entries
- Common misspellings/aliases → **canonicalize before writing**. E.g., don't write `gta-v-2013`, write `grand-theft-auto-v-2013`. Don't write `zelda-breath-of-the-wild-2017`, write `legend-of-zelda-breath-of-the-wild-2017`.

**Companies**: prefer stock tickers where publicly traded (case-sensitive, hyphen for class shares: `BRK-B`, `GOOGL`). Private companies use kebab-case: `cargill`, `state-farm`, `koch`.

**Countries — HK and MO are SARs, not sovereign countries**. Only include them if the specific ranking source actually lists them separately (fastest internet, HDI, tourism destinations). If a ranking is "countries" in a strict sense, exclude them.

**Countries — Do NOT use codes for**: Soviet Union, West Indies (cricket team), Cook Islands, Niue. They aren't in the answer set. If a ranking authoritatively includes them, drop those rows.

---

## 3. What makes a good question

- **Rankable**: has a monotonic numeric metric where players can plausibly guess the top-10.
- **Defensible top-5**: authoritative source unambiguously agrees on ranks 1-5.
- **Not a lookup**: don't ask "the 10 films released in 1990" if the year already appears in the film's slug — the dropdown search gives it away.
- **Not a lottery**: avoid rankings where the top-N is dominated by ties (⚠️ WHY: "youngest voting age" had 7 countries tied at 16; "most G20 hosts" had 14 tied at 1 — dropped both).
- **Answer pool large enough**: at least 5-10 possible correct answers. A 4-way total answer set (e.g. "Rugby World Cup winners") is borderline — usable, but flag it in the recap.
- **Public knowledge**: something a general-audience player has a shot at recalling — not deeply obscure ("most cargo-tonnage-through-Somali-ports").

**Bad question examples we've dropped:**
- "Most streamed BP winners" — no single source, values were vibes-based
- "Most G20 summits hosted" — 14-way tie at 1, degenerated to "name G20 members"
- "Best Picture winners of the 1990s" — trivial once dropdown search is available

---

## 4. Prompt & title rules

- **Title**: short (under 60 chars), no methodology jargon. Player-facing.
- **Prompt**: one sentence describing what to guess, unambiguously.
  - ⚠️ BAD: "Name the primary country (origin / largest native-speaker country) for each..." (two contradictory metrics in one prompt)
  - ✓ GOOD: "Name the countries most closely associated with the origin of the world's most-spoken native languages."
- **Sort direction MUST be explicit in the prompt** when it's ambiguous:
  - ⚠️ "Name the countries with the highest ranking on the AFI Top 100" — is #1 the best or the worst? Fix: "Best Picture winners with the highest positions on AFI Top 100 (i.e. lowest AFI rank numbers)."
- **If the metric could be interpreted two ways, disambiguate**:
  - "Highest life expectancy" → note if microstates are included/excluded
  - "Largest by area" → land only? land + inland water?
  - "Nominal GDP" vs "PPP GDP" — say which

---

## 5. `disclaimer` vs `trivia` — CRITICAL

Two separate fields:

- **`disclaimer`** is shown **BEFORE** the round starts. Anything here is visible to players while they're guessing.
- **`trivia`** is shown **ONLY AFTER** the round ends with the correct answers. It can spoil freely.

**Rules for `disclaimer`:**
- ✓ Methodology: "Nominal GDP in USD billions, not PPP."
- ✓ Inclusion criteria: "Excludes Special Administrative Regions."
- ✓ Convention: "Ties broken alphabetically."
- ✗ **NEVER name a top-10 answer**. This is a spoiler.
  - ⚠️ WHY: "China and India together account for two-thirds of tea production" — leaked the top 2.
  - ⚠️ WHY: "West Germany's 3 titles are counted separately" — leaked Germany as an answer.
  - ⚠️ WHY: "Turkey has been the runaway leader for over a decade" — leaked #1.
- ✗ **NEVER reference a specific rank number** ("China ranks above US at #3" is a leak).
- If your disclaimer contains a top-5 answer's name, move that sentence to `trivia`.

**Rules for `trivia`:**
- 1-2 sentences MAX.
- Something interesting, not a restatement of the answer list.
- Can name specific answers.
- If you don't have anything genuinely interesting, set to `null`. Don't pad with generic factoids.
- Good example: "The Godfather is #2 on the AFI Top 100 (only Citizen Kane ranks higher), and Part II at #32 is the highest sequel on the list."

---

## 6. Sort direction & ranking

`rank: 1` is the "best" or most extreme answer according to the question. The auto-consolidator will re-sort by numeric magnitude, but **you should still produce answers in the correct order** — the sorter can't parse mixed-format values (`3.35 million tonnes` alongside `535,000 tonnes`) reliably.

**Direction rules:**
- "Most / highest / largest / longest / best" → descending numeric value, rank 1 = biggest
- "Least / lowest / smallest / shortest / fewest / earliest / oldest" → ascending numeric value, rank 1 = smallest
- **Inverse-scale metrics** (like AFI rank position, where lower is better): the value column stores the raw number, but rank 1 is the *best* film (lowest AFI rank). Write the answers in the order you want them displayed.

**Bugs we've hit repeatedly** (⚠️ AVOID):
- AFI ranks: value was AFI #83 at rank 1, AFI #2 at rank 15 — completely flipped
- Aquaculture: China at 68.4M tonnes was ranked #4, Japan at 915k tonnes was #1 — the auto-sorter mishandled mixed `million` and comma-notation
- Fewest Oscar wins: chaotic mid-list ordering

**Fix pattern:** normalize all values in a question to the same format (all `"535,000 tonnes"` OR all `"3.35 million tonnes"` — not both).

---

## 7. Value formatting

- **Always include units**: `"5 titles"`, `"$27,721B"`, `"340M population"`, `"1,650 km²"`, `"93 min"`, `"1794 (founded)"`.
- **Use comma notation OR scale suffix, not both**. Within one question, pick a format and stick to it.
  - Same question: `"1,450,935,791"` and `"340,003,797"` ✓
  - Same question: `"1.45B"` and `"340M"` ✓
  - Same question: `"3.35 million tonnes"` and `"535,000 tonnes"` ✗ (breaks the auto-sorter)
- **Ties**: same `rank`, add `"(tied)"` suffix to the value.
  ```
  { "rank": 3, "code": "IT", "value": "4 titles" },
  { "rank": 3, "code": "DE", "value": "4 titles (tied)" }
  ```

---

## 8. Source rules

- Prefer **primary sources** with a real URL: WHO, IMF, UN, FIFA, IOC, IMDb, Box Office Mojo, AMPAS, VGChartz, SIPRI.
- Wikipedia is acceptable **as a citation aggregator** when the underlying data comes from a primary source.
- **URL must resolve to something viewable**. If unsure, use the source's main data page.
  - ⚠️ WHY: an agent once cited "Nielsen (streaming Top 10) / Netflix, Prime Video, HBO Max, Apple TV+ public dashboards" — mashup with no single URL. Question got dropped.
- **`asOf` must have a year** (`"2024"` or `"2024 season"` or `"2022 production year"`). This is surfaced in the game UI as a chip so players know how current the data is.
- Never fabricate URLs. Empty string is better than made-up.

---

## 9. Ties and depth

- **Seed 10-15 answers per question by default**.
- If the topic has a small pool (e.g. only 4 Rugby World Cup winners), match `seededDepth` to the pool size — don't pad.
- **Do NOT include entries that don't belong in the ranking**:
  - ⚠️ WHY: "Films that lost Best Picture" question included 3 films that had actually WON Best Picture. That's a category error.
- Ties get shared ranks. If ranks 1-3 are three-way tied, the next rank is 4.

---

## 10. Subtheme naming

Format: `"<Theme Name> - <SubDomain>"` — e.g. `"Movies - Awards"`, `"Countries - Sports"`, `"Pro Sports - NBA"`, `"US States - Health"`.

If your questions span multiple sub-domains, split into multiple output files rather than mixing subthemes in one file.

**Sub-theme scoping**: when a subtheme is a strict answer sub-pool (Pro Sports league, or a scoped Movies subset), the game engine will filter the dropdown automatically. Awareness of that:
- Pro Sports NBA/NFL/MLB/NHL questions → dropdown shows only that league's teams
- Movies non-nominees questions → dropdown shows only Best Picture winners (96 films)
- Countries subthemes → dropdown is always all 199 countries (topical filter, not answer-pool filter)

You don't need to do anything special — the consolidator + server handle it. Just produce accurate answers.

---

## 11. Common mistakes we've hit

1. **Slug drift** — "The Godfather" written as `the-godfather-1972` when answer set has `godfather-1972`. **Always match the answer set exactly.**
2. **Wrong year on movies** — `crash-2004` for the 2005-released "Crash". Check the film's release year, not the ceremony year.
3. **Ranking wrong direction** — treating ascending metrics as descending. Test yourself: is rank 1 the "biggest/best" of your list?
4. **Answers not in scope** — including winners in a "losers" list, or including US states in a "countries" question.
5. **Duplicate codes within one question** — Hindi and Bengali both mapping to `IN` (India). Deduplicate.
6. **Disclaimer leaks** — mentioning a top-5 answer by name. Move to trivia.
7. **Padding** — filling `trivia` with generic filler when you have nothing interesting. Set to null instead.
8. **Fabricated sources** — writing a plausible-looking URL that doesn't exist. Empty string is safer.
9. **Off-schema output** — writing `{id, prompt, sort, answers}` instead of the schema in section 1. Always use the exact field names.
10. **Dispatching subagents** — every task tells you not to. Do the work yourself in one pass.

---

## 12. Output requirements

- Write ONE JSON file to the path specified in your task.
- Do NOT print the JSON in your response — write the file.
- Give a 2-3 sentence recap: topics chosen, any topics skipped and why, and any judgment calls (slug decisions, source pick, whatever).
- Do NOT dispatch subagents. Do the work in-line.
- Under 400 words in your response.
