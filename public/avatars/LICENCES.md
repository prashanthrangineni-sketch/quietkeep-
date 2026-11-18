# Aaria avatar assets — licence register

Every character, drawing and 3D engine used for Aaria's face is listed here,
with its licence. Nothing is added to `public/avatars/` or `src/lib/avatar/`
without a row in this table and, for a character file, a `LICENCE.md` beside it.

| Asset | Where | Source | Licence | Notes |
|---|---|---|---|---|
| Aaria 2D face (orb, eyes, mouth, tick) | `src/components/AariaFace.jsx`, `src/components/AariaMark.jsx` | Drawn for Pranix AI Labs Private Limited | Pranix's own work | Vector shapes written in code; no outside artwork. |
| Sample anime 3D character | `public/avatars/anime-sample/VRM1_Constraint_Twist_Sample.vrm` | pixiv/three-vrm examples | VRM Public License 1.0 | See `anime-sample/LICENCE.md`. A stand-in, not Aaria's final look. |
| Sample anime 3D man | `public/avatars/anime-man-sample/Sakurada_Fumiriya.vrm` | VRoid Studio sample character (via madjin/vrm-samples) | CC0, as written inside the file | See `anime-man-sample/LICENCE.md`. A stand-in. |
| three.js 0.187.0 | npm dependency `three` | https://github.com/mrdoob/three.js | MIT | Notice ships in `node_modules/three/LICENSE`. |
| three-vrm 3.5.5 | npm dependency `@pixiv/three-vrm` | https://github.com/pixiv/three-vrm | MIT | Notice ships in `node_modules/@pixiv/three-vrm/LICENSE`. |
| framer-motion | npm dependency (already in the app) | https://github.com/motiondivision/motion | MIT | Animates the 2D face. |
| Sample realistic 3D people (two women, four men) | `public/avatars/realistic-rocketbox/` | Microsoft Rocketbox avatar library: Female_Adult_01, 15 and Male_Adult_01, 07, 08, 21 | MIT (Copyright (c) 2020 Microsoft) | See `realistic-rocketbox/LICENCE.md`. Converted once from FBX to GLB. A stand-in, not Aaria's final look. |
| Realistic Indian woman (saree) and man (kurta) | — | — | — | NOT ADDED. No character with a usable licence has been found yet. |

Not used, by decision: Live2D, Rive, AI-generated face video, native 3D renderers.
