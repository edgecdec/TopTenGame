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

**Slug verification before writing** (⚠️ WHY: every fan-out has lost 5-20% of rows to slug mismatches):
- Before shipping a question, load the answer_sets.json entries for your theme and check that every `code` you produced exists.
- If you had to invent a slug (e.g., for a small subtheme like Movies-Talent where you know one film), verify against the answer set — variants like `the-godfather-1972` vs `godfather-1972` will silently drop your row.
- If you produced slugs the consolidator will reject, list them in your recap so we can add aliases.

**Historical entities and constituent nations** (⚠️ WHY: these mappings keep bouncing back and forth across fan-outs):
- **USSR** → map to `RU` with a disclaimer, OR drop those rows. Never invent `SU`.
- **East Germany** → map to `DE` and disclaim consolidation. Same for West Germany.
- **Yugoslavia** → map to `RS` (Serbia as successor) OR split by successor state OR drop. Pick one and disclaim.
- **Czechoslovakia** → drop, or split into `CZ` + `SK`.
- **Ottoman Empire** → map to `TR`.
- **West Indies (cricket)** → not a country. Drop the row.
- **England / Scotland / Wales / Northern Ireland** → aggregate under `GB` and add a disclaimer noting the aggregation. Do NOT invent codes like `EN` or `SCT`. This applies to Wimbledon, Rugby World Cup, Cricket World Cup, Six Nations, Commonwealth Games, F1 by nationality, Ballon d'Or, and any question where UK constituent nations compete separately in the underlying sport but are collapsed here.

**Cross-file duplicate awareness** (⚠️ WHY: agents have re-created questions that were explicitly dropped in earlier waves):
- Before proposing new topics, skim `data/questions.json` for existing entries in your theme — look at each subtheme's titles.
- Prompts tell you what's covered; the "already have..." section is a hint, not exhaustive.
- Explicit blocklist of topics already dropped for cause: G20 hosts (14-way tie), youngest voting age (7-way tie), most streamed BP winners (no source), Best Picture winners of the 1990s (dropdown-year lookup). Do not re-propose these.

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

**⚠️ AUDITOR NOTE**: `trivia` is verified post-round in the UI (`src/app/room/[code]/page.tsx` intermission view). If you are auditing questions, "trivia names top-1 answer" is NEVER a bug — that's the intended use. Only flag disclaimer leaks. Multiple past audits produced hundreds of false positives by treating trivia as pre-round.

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

## 7. Value formatting — HIGH SEVERITY

**Value-format consistency is the #1 recurring bug.** We have fixed this exact class of issue on tea, aquaculture, butter, yogurt, coffee-exporters, cocoa-exporters, orange producers, and more. Every time an agent produces a question mixing formats, the auto-sorter mis-orders it — usually placing the true #1 answer near the bottom.

- **Always include units**: `"5 titles"`, `"$27,721B"`, `"340M population"`, `"1,650 km²"`, `"93 min"`, `"1794 (founded)"`.
- **Use comma notation OR scale suffix, not both. NEVER MIX WITHIN ONE QUESTION.**
  - Same question: `"1,450,935,791"` and `"340,003,797"` ✓
  - Same question: `"1.45B"` and `"340M"` ✓
  - Same question: `"3.35 million tonnes"` and `"535,000 tonnes"` ✗ **catastrophic — auto-sorter treats `3.35 million` as smaller than `535,000`**
  - Same question: `"50+ wins"` and `"50 wins"` ✗ **the `+` bucket kills sortability; use exact counts or drop the row**
- **Ties**: same `rank`, add `"(tied)"` suffix to the value.
  ```
  { "rank": 3, "code": "IT", "value": "4 titles" },
  { "rank": 3, "code": "DE", "value": "4 titles (tied)" }
  ```
- **Buckets are forbidden** — if the source only publishes ranges (`"50+ champions"`, `"~35 medals"`), use the underlying exact number. If you can't find the exact number, drop the row and let seededDepth shrink.
- **Before shipping**: eyeball your values list. If two different unit-word formats appear in one question, normalize before writing the file.

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

- **Seed 15-20 answers per question when a top-20 is defensibly available.** 15 was our old floor because most agents produced exactly 15; that's fine for small topics but leaves the game capped at top-15 rounds even when the host sets top-20. If the topic clearly supports 20 defensible answers (population, GDP, Olympic medals, etc.), seed 20.
- If the topic has a small pool (e.g. only 4 Rugby World Cup winners, 6 F1 constructor champions, 8 Great Lakes states), match `seededDepth` to the pool size — **don't pad with weak or unranked entries**.
- **Do NOT include entries that don't belong in the ranking**:
  - ⚠️ WHY: "Films that lost Best Picture" question included 3 films that had actually WON Best Picture. That's a category error.
- Ties get shared ranks. If ranks 1-3 are three-way tied, the next rank is 4.
- **When you can't produce 20 exact-count answers, stop at the last exact-count row.** Never pad with bucketed values (`"50+"`) — that breaks the auto-sorter.

---

## 10. Subtheme naming

Format: `"<Theme Name> - <SubDomain>"` — e.g. `"Movies - Awards"`, `"Countries - Sports"`, `"Pro Sports - NBA"`, `"US States - Health"`.

If your questions span multiple sub-domains, split into multiple output files rather than mixing subthemes in one file.

**Sub-theme scoping**: when a subtheme is a strict answer sub-pool (Pro Sports league, or a scoped Movies subset), the game engine will filter the dropdown automatically. Awareness of that:
- Pro Sports NBA/NFL/MLB/NHL questions → dropdown shows only that league's teams
- Movies non-nominees questions → dropdown shows only Best Picture winners (96 films)
- **Movies - Nominees** subtheme → dropdown shows full 602 Best Picture nominees pool
- Countries subthemes → dropdown is always all 199 countries (topical filter, not answer-pool filter)
- US States subthemes → always all 51 (50 states + DC)
- Colleges subthemes → always all 147 institutions
- Video Games / Video Game Franchises subthemes → always full pool

**Practical implication:** if you're producing a Movies question under a non-Nominees subtheme, every answer code must be a Best Picture WINNER (96 slugs). If you use a Best-Picture-nominee-but-not-winner, the consolidator will silently drop the row.

You don't need to do anything special — the consolidator + server handle it. Just produce accurate answers with codes matching the effective pool.

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

---

## 13. Patch-file schema (for FIX agents applying audit findings)

When you are a **fix agent** — reading an audit JSON and applying fixes — do NOT write directly to `questions.json`. Multiple fix agents run in parallel and would clobber each other. Write your patches to a per-cluster patch file that the parent process merges serially.

**Canonical schema** (used by every fix wave):

```json
{
  "cluster": "Sports",
  "updates": [
    {
      "id": "question-id",
      "changes": {
        "disclaimer": "new text or null",
        "trivia": "new text or null",
        "title": "new title (only if changed)",
        "prompt": "new prompt (only if changed)",
        "answers": [ /* full array only if changed */ ]
      }
    }
  ],
  "deletions": ["question-id-1", "question-id-2"]
}
```

**Do NOT use alternate schemas** (⚠️ WHY: two agents shipped `operations`/`op`/`set`/`drop:true`, requiring custom merge logic each time):
- ❌ `operations` array with `op` field — use `updates` and `deletions` instead
- ❌ inline `drop: true` on an update — put the id in the `deletions` array
- ❌ per-answer patches — replace the full `answers` array

**Only include fields you're changing** in `changes`. Fields you leave alone are preserved by the parent merger. If you rewrite `answers`, the merger auto-caps `seededDepth` to `min(existing, len(answers))`.

---

## 14. Common mistakes we've hit (continued)

11. **Trivia false-positives during audits** — flagging trivia that names a top-1 answer as a "leak". Trivia is post-round only. Not a bug.
12. **Historical entity codes** — inventing `SU`, `YU`, `DD`, `CS`, `EN`, `SCT`. Use modern successors with a disclaimer, or drop rows.
13. **Value-format mixing** — the tea/aquaculture/butter class of bug. Never mix `"3.35 million"` with `"535,000"` in one question.
14. **Bucket values** — `"50+ wins"` mixed with `"49 wins"` scrambles ranking. Use exact counts or drop.
15. **Padding to seededDepth 15** — every subtheme having exactly 15 answers regardless of pool. Seed 20 when defensible; smaller when the pool is naturally small.
16. **Cross-file re-creation of dropped questions** — re-proposing G20 hosts / youngest voting age / streaming rankings after they were dropped in prior waves. Check questions.json first.
17. **Bad patch schemas** — fix agents shipping `{operations:[...]}` instead of `{updates:[...],deletions:[...]}`. Match section 13 exactly.
18. **Movies-Nominees vs winners confusion** — Movies non-Nominees subthemes require Best Picture WINNER codes only. Movies - Nominees uses the full 602-pool.
