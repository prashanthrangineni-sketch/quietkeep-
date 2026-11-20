# Licence record: Sakurada_Fumiriya.vrm

Recorded 18 Nov 2026 for the AARIA demo page (`/aaria-stage`).

| | |
|---|---|
| File | `Sakurada_Fumiriya.vrm` (19,342,280 bytes) |
| SHA-256 | `d8fb05f33e377df028cb6b9d58c441ce68326c41fa23f6c735d40c65ae3dc710` |
| Taken from | `https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Sakurada_Fumiriya.vrm` (a public collection of VRoid sample models) |
| Origin | A sample character from early versions of VRoid Studio (pixiv). |
| Licence | CC0 (public-domain dedication), as written inside the file. |
| Modified by Pranix | Yes, pictures only (20 Nov 2026) - see below. CC0 places no conditions on changes. |

## The permissions written inside the file itself

Read from the file's own `VRM.meta` block:

```json
{
  "title": "Sakurada Fumiriya",
  "allowedUserName": "Everyone",
  "violentUssageName": "Allow",
  "sexualUssageName": "Allow",
  "commercialUssageName": "Allow",
  "licenseName": "CC0"
}
```

In plain words: anyone may use it, including commercially, with no conditions.

## Limits of this record

- The licence was read from the file itself. The original VRoid help page that
  announced these CC0 samples was not opened on 18 Nov 2026 (it could not be
  reached from the build machine); a public listing on opengameart.org
  describes the same set as released by VRoid under CC0.
- The copy came from a third-party collection, not from pixiv directly.
- It is a stand-in to show the engine. It is not Aaria's own character.

## Made smaller for phone data (20 Nov 2026)

Changed with `scripts/avatar-shrink.py`, which is in this repository. The look was compared
before and after on rendered pictures; no visible difference.

| | Before | After |
|---|---|---|
| Size | 19,342,280 bytes | 5,205,316 bytes |
| SHA-256 | `d8fb05f33e377df028cb6b9d58c441ce68326c41fa23f6c735d40c65ae3dc710` | `a2d5d91a7ee453941284cd7f4e15b8bd4edc0dd2f4ee1d7a130605041e80a343` |

Command: `python3 scripts/avatar-shrink.py ORIGINAL.vrm Sakurada_Fumiriya.vrm --max-texture 1024 --palette`.
Shape, skeleton, face shapes, materials and the licence block are untouched.
