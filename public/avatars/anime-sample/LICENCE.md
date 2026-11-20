# Licence record: VRM1_Constraint_Twist_Sample.vrm

Recorded 18 Nov 2026 for the AARIA demo page (`/aaria-stage`).

| | |
|---|---|
| File | `VRM1_Constraint_Twist_Sample.vrm` (10,776,032 bytes) |
| SHA-256 | `12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2` |
| Taken from | `https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm` |
| Author / copyright | pixiv Inc. — "(c) 2022 pixiv Inc." |
| Licence | VRM Public License 1.0 — https://vrm.dev/licenses/1.0/ |
| Modified by Pranix | Yes, pictures only (20 Nov 2026) - see below. The file's licence block allows modification and redistribution (`"modification": "allowModificationRedistribution"`). |

## The permissions written inside the file itself

Read from the file's own `VRMC_vrm.meta` block (not from a web page):

```json
{
  "name": "VRM1_Constraint_Twist_Sample",
  "version": "v1.0.1",
  "authors": ["pixiv Inc."],
  "copyrightInformation": "(c) 2022 pixiv Inc.",
  "licenseUrl": "https://vrm.dev/licenses/1.0/",
  "avatarPermission": "everyone",
  "commercialUsage": "corporation",
  "creditNotation": "unnecessary",
  "allowRedistribution": true,
  "modification": "allowModificationRedistribution",
  "allowAntisocialOrHateUsage": false,
  "allowExcessivelySexualUsage": true,
  "allowExcessivelyViolentUsage": true,
  "allowPoliticalOrReligiousUsage": true
}
```

In plain words: anyone may use this character as an avatar, companies may use
it commercially, it may be redistributed, and credit is not required. It may
not be used for antisocial or hateful content.

## What this file is NOT

It is a sample character from pixiv's three-vrm project, used as a stand-in so
the 3D engine can be shown and measured. It is not Aaria's own character and
must not be presented as Aaria's final look. Aaria's own 3D character is to be
made by Pranix (the plan names VRoid Studio) and recorded here the same way.

## Made smaller for phone data (20 Nov 2026)

Changed with `scripts/avatar-shrink.py`, which is in this repository. The look was compared
before and after on rendered pictures; no visible difference.

| | Before | After |
|---|---|---|
| Size | 10,776,032 bytes | 4,833,068 bytes |
| SHA-256 | `12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2` | `4972206992287fc420ff373a964572d8f846e5b1b214b65614e6c90c84698a71` |

Command: `python3 scripts/avatar-shrink.py ORIGINAL.vrm VRM1_Constraint_Twist_Sample.vrm --max-texture 1024 --palette`
(every picture at most 1024 pixels on its longer side, PNG pictures stored with at most 256 colours).
Shape, skeleton, face shapes, materials and the licence block are untouched.
