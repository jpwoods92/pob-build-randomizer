# PoE1 Path of Building Randomizer

A seeded **Path of Exile 1 (3.30)** build randomizer that generates a complete, cohesive build—connected passive skill tree, ascendancy, masteries, gem links, gear, flasks, and jewels—and exports a **Path of Building Community** import code and `.xml` build file.

## Features

- **Knobs & Constraints**
  - **Softcore vs Hardcore**: Hardcore biases toward life/ES scaling, overcapped elemental & chaos resistances, spell suppression, defensive shields/auras, guard skills, and safe uniques. Softcore leans further into crit, DPS, and riskier uniques.
  - **SSF vs Trade**: SSF restricts Awakened gems and boss/chase uniques, uses realistic 5–6 links and achievable rare tiers. Trade unlocks full 6-links, Awakened supports, endgame rare affix tiers, and the broader unique pool.
  - **Optional Filters**: Class, Ascendancy, Damage Archetype (`Attack`, `Spell`, `Minion`, `Totem`, `Trap / Mine`, `DoT`), Defense Layer (`Life`, `ES`, `Hybrid`), Target Level (`80–100`), and deterministic **Build Seed**.
- **Connected Passive Tree Generator**: Allocates a valid connected passive tree from class start (including Ascendancy points, Mastery effect selections, and Jewel Sockets) using Path of Exile 3.30 tree data, complete with an interactive zoom/pan canvas and official tree URL encoder.
- **PoB-Verified Gem Links**: Evaluates support gem compatibility using Path of Building's `SkillType` expression rules (`requireSkillTypes` / `excludeSkillTypes`) and populates body, aura, guard, movement, and curse/mark socket groups.
- **Full Gear, Flasks & Jewels**: Rolls real bases and affixes (`ModExplicit`, `ModFlask`, `ModJewel`) plus bench crafts to cover resistances and gem attribute requirements, paired with level-appropriate uniques.
- **Path of Building Export**: Generates `<PathOfBuilding>` XML compressed with RFC 1950 zlib + URL-safe Base64 for one-click paste into Path of Building (`Import/Export Build`).

## Development

```bash
npm install
npm run dev
```

Run tests and production build:

```bash
npm test
npm run build
```

To refresh the game data from Path of Building Community and GGG's `skilltree-export`:

```bash
npm run fetch-data
npm run build-data
```
