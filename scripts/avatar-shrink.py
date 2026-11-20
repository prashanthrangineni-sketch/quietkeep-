#!/usr/bin/env python3
"""Make an Aaria character file small enough for phone data.

    python3 scripts/avatar-shrink.py IN.glb OUT.glb [--keep-morphs a,b,c] [--max-texture 1024]

What it does, and nothing else:
  * --keep-morphs  keeps only the named face shapes (morph targets) on every
                   mesh and drops the rest. For plain .glb files only: a .vrm
                   file points at shapes by number, so its shapes are never
                   touched (the tool refuses).
  * --max-texture  shrinks every picture stored inside the file so its longer
                   side is at most this many pixels. PNG stays PNG (so
                   transparency survives), JPEG stays JPEG.
  * --palette      stores PNG pictures with at most 256 colours (transparency
                   kept). Suits flat-coloured anime pictures; look before use.
  * Anything no longer used is removed and the file is packed again.

It prints what it removed so the change can be recorded beside the file.
"""
import argparse
import io
import json
import struct
import sys

from PIL import Image


def read_glb(path):
    b = open(path, 'rb').read()
    if b[:4] != b'glTF':
        sys.exit(f'{path}: not a binary glTF/VRM file')
    pos, js, bin_ = 12, None, b''
    while pos < len(b):
        ln, kind = struct.unpack('<I4s', b[pos:pos + 8])
        chunk = b[pos + 8:pos + 8 + ln]
        if kind == b'JSON':
            js = json.loads(chunk)
        elif kind == b'BIN\x00':
            bin_ = chunk
        pos += 8 + ln
    return js, bin_


def write_glb(path, js, bin_):
    j = json.dumps(js, separators=(',', ':'), ensure_ascii=False).encode('utf8')
    j += b' ' * ((4 - len(j) % 4) % 4)
    bin_ += b'\x00' * ((4 - len(bin_) % 4) % 4)
    total = 12 + 8 + len(j) + (8 + len(bin_) if bin_ else 0)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(j), b'JSON') + j)
        if bin_:
            f.write(struct.pack('<I4s', len(bin_), b'BIN\x00') + bin_)


def prune_morphs(js, keep):
    """Keep only named morph targets. Returns how many were removed."""
    removed = 0
    for mesh in js.get('meshes', []):
        names = (mesh.get('extras') or {}).get('targetNames')
        if not names:
            continue
        idx = [i for i, n in enumerate(names) if n in keep]
        removed += len(names) - len(idx)
        for prim in mesh['primitives']:
            if 'targets' in prim:
                prim['targets'] = [prim['targets'][i] for i in idx]
                if not prim['targets']:
                    del prim['targets']
        mesh['extras']['targetNames'] = [names[i] for i in idx]
        if 'weights' in mesh:
            mesh['weights'] = [mesh['weights'][i] for i in idx]
        if not idx:
            mesh['extras'].pop('targetNames', None)
            mesh.pop('weights', None)
    return removed


def shrink_images(js, bin_, max_side, palette=False):
    """Return {bufferView index: new bytes} for images that got smaller."""
    out = {}
    for img in js.get('images', []):
        if 'bufferView' not in img:
            continue
        bvi = img['bufferView']
        bv = js['bufferViews'][bvi]
        raw = bin_[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        im = Image.open(io.BytesIO(raw))
        im.load()
        w, h = im.size
        if max(w, h) <= max_side and not (palette and img.get('mimeType') != 'image/jpeg'):
            continue
        if max(w, h) > max_side:
            scale = max_side / max(w, h)
            im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
        buf = io.BytesIO()
        if img.get('mimeType') == 'image/jpeg':
            im.convert('RGB').save(buf, 'JPEG', quality=88)
        elif palette:
            im.convert('RGBA').quantize(colors=256, method=Image.FASTOCTREE).save(buf, 'PNG', optimize=True)
        else:
            im.save(buf, 'PNG', optimize=True)
        if buf.tell() < len(raw):
            out[bvi] = buf.getvalue()
    return out


def accessor_refs(js):
    """Every place that names an accessor, as (container, key) pairs."""
    refs = []
    for mesh in js.get('meshes', []):
        for prim in mesh['primitives']:
            for k in list(prim.get('attributes', {})):
                refs.append((prim['attributes'], k))
            if 'indices' in prim:
                refs.append((prim, 'indices'))
            for t in prim.get('targets', []):
                for k in list(t):
                    refs.append((t, k))
    for skin in js.get('skins', []):
        if 'inverseBindMatrices' in skin:
            refs.append((skin, 'inverseBindMatrices'))
    for anim in js.get('animations', []):
        for s in anim.get('samplers', []):
            refs.append((s, 'input'))
            refs.append((s, 'output'))
    return refs


def repack(js, bin_, replaced):
    """Drop unused accessors and buffer views, then rebuild the binary."""
    refs = accessor_refs(js)
    used_acc = sorted({c[k] for c, k in refs})
    acc_map = {old: new for new, old in enumerate(used_acc)}
    for c, k in refs:
        c[k] = acc_map[c[k]]
    js['accessors'] = [js['accessors'][i] for i in used_acc]

    bv_refs = []
    for a in js['accessors']:
        if 'bufferView' in a:
            bv_refs.append((a, 'bufferView'))
        sp = a.get('sparse')
        if sp:
            bv_refs.append((sp['indices'], 'bufferView'))
            bv_refs.append((sp['values'], 'bufferView'))
    for img in js.get('images', []):
        if 'bufferView' in img:
            bv_refs.append((img, 'bufferView'))
    used_bv = sorted({c[k] for c, k in bv_refs})
    bv_map = {old: new for new, old in enumerate(used_bv)}

    new_bin = bytearray()
    new_views = []
    for old in used_bv:
        bv = dict(js['bufferViews'][old])
        data = replaced.get(old)
        if data is None:
            off = bv.get('byteOffset', 0)
            data = bin_[off:off + bv['byteLength']]
        new_bin += b'\x00' * ((4 - len(new_bin) % 4) % 4)
        bv['byteOffset'] = len(new_bin)
        bv['byteLength'] = len(data)
        bv['buffer'] = 0
        new_bin += data
        new_views.append(bv)
    for c, k in bv_refs:
        c[k] = bv_map[c[k]]
    js['bufferViews'] = new_views
    js['buffers'] = [{'byteLength': len(new_bin)}]
    return bytes(new_bin), len(refs), len(used_acc), len(used_bv)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--keep-morphs', default=None)
    ap.add_argument('--max-texture', type=int, default=None)
    ap.add_argument('--palette', action='store_true')
    a = ap.parse_args()

    js, bin_ = read_glb(a.src)
    ext = js.get('extensions', {})
    is_vrm = 'VRM' in ext or 'VRMC_vrm' in ext
    removed = 0
    if a.keep_morphs:
        if is_vrm:
            sys.exit('refusing: a VRM file refers to its face shapes by number; shapes are never removed from VRM files')
        keep = {s.strip() for s in a.keep_morphs.split(',') if s.strip()}
        found = {n for m in js.get('meshes', []) for n in (m.get('extras') or {}).get('targetNames', [])}
        missing = keep - found
        if missing:
            sys.exit(f'refusing: shapes to keep are not in the file: {sorted(missing)}')
        removed = prune_morphs(js, keep)
    replaced = shrink_images(js, bin_, a.max_texture or 1 << 30, a.palette) if (a.max_texture or a.palette) else {}
    if is_vrm and removed:
        sys.exit('internal error')
    if is_vrm:
        # A VRM file's extension blocks point at accessors? They do not (they
        # point at meshes, nodes, materials and textures), but keep every
        # accessor anyway: only pictures are changed in VRM files.
        new_bin = bytearray()
        views = []
        for i, bv in enumerate(js['bufferViews']):
            bv = dict(bv)
            data = replaced.get(i)
            if data is None:
                off = bv.get('byteOffset', 0)
                data = bin_[off:off + bv['byteLength']]
            new_bin += b'\x00' * ((4 - len(new_bin) % 4) % 4)
            bv['byteOffset'] = len(new_bin)
            bv['byteLength'] = len(data)
            bv['buffer'] = 0
            new_bin += data
            views.append(bv)
        js['bufferViews'] = views
        js['buffers'] = [{'byteLength': len(new_bin)}]
        new_bin = bytes(new_bin)
    else:
        new_bin, _, _, _ = repack(js, bin_, replaced)
    write_glb(a.dst, js, new_bin)
    import os
    print(json.dumps({
        'src_bytes': os.path.getsize(a.src), 'dst_bytes': os.path.getsize(a.dst),
        'morphs_removed': removed, 'pictures_shrunk': len(replaced),
    }))


if __name__ == '__main__':
    main()
