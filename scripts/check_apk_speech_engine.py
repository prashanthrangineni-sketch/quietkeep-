#!/usr/bin/env python3
"""Opens built QuietKeep APKs and fails unless the on-phone speech engine is really inside.

Why this exists: until 3 Oct 2026 every automatic check was green on a build whose speech
recogniser (sherpa-onnx) had never been packed into the app. The app installed, downloaded its
speech files, said "Ready", and could never turn one sound into words. A real-phone test found it.

What it checks, for every APK given on the command line:
  1. the recogniser's native library is there for every processor type the APK supports;
  2. libonnxruntime.so is the version sherpa-onnx was built for (an older copy under the same
     file name also comes in with the VAD library, and the recogniser cannot run on that one);
  3. the recogniser's Java classes, the VAD's Java classes and the Aaria plugin are DEFINED in the
     app's code, not merely mentioned by it.

usage: python3 scripts/check_apk_speech_engine.py <apk> [<apk> ...]
"""
import re
import struct
import sys
import zipfile

# The onnxruntime that sherpa-onnx 1.13.8 ships and needs. Change both together.
ORT_VERSION = "1.28.2"
NATIVE_LIBS = ("libsherpa-onnx-jni.so", "libonnxruntime.so", "libonnxruntime4j_jni.so")
CLASSES = (
    "Lcom/k2fsa/sherpa/onnx/OfflineRecognizer;",
    "Lai/onnxruntime/OrtEnvironment;",
    "Lcom/pranix/aariaedge/AariaEdgePlugin;",
)


def defined_classes(dex):
    """Type descriptors of the classes a .dex file defines (not the ones it only refers to)."""
    if dex[:3] != b"dex":
        return set()
    string_ids_off = struct.unpack_from("<I", dex, 0x3C)[0]
    type_ids_off = struct.unpack_from("<I", dex, 0x44)[0]
    class_defs_size, class_defs_off = struct.unpack_from("<II", dex, 0x60)
    out = set()
    for i in range(class_defs_size):
        type_idx = struct.unpack_from("<I", dex, class_defs_off + 32 * i)[0]
        string_idx = struct.unpack_from("<I", dex, type_ids_off + 4 * type_idx)[0]
        pos = struct.unpack_from("<I", dex, string_ids_off + 4 * string_idx)[0]
        while dex[pos] & 0x80:  # skip the length prefix
            pos += 1
        pos += 1
        end = dex.index(b"\x00", pos)
        out.add(dex[pos:end].decode("utf-8", "replace"))
    return out


def check(path):
    problems = []
    with zipfile.ZipFile(path) as apk:
        names = set(apk.namelist())
        abis = sorted({n.split("/")[1] for n in names if n.startswith("lib/") and n.endswith(".so")})
        if "arm64-v8a" not in abis:
            problems.append("no arm64-v8a native libraries (the processor type of nearly every phone)")
        for abi in abis:
            for lib in NATIVE_LIBS:
                if f"lib/{abi}/{lib}" not in names:
                    problems.append(f"{abi}: {lib} is missing")
            ort = f"lib/{abi}/libonnxruntime.so"
            if ort in names:
                found = {m.group().decode() for m in re.finditer(
                    rb"(?<![0-9.])1\.[1-3][0-9]\.[0-9]+(?![0-9.])", apk.read(ort))}
                if ORT_VERSION not in found:
                    problems.append(f"{abi}: libonnxruntime.so is {sorted(found) or 'unknown'}, "
                                    f"the recogniser needs {ORT_VERSION}")
        defined = set()
        for n in names:
            if re.fullmatch(r"classes\d*\.dex", n):
                defined |= defined_classes(apk.read(n))
        for cls in CLASSES:
            if cls not in defined:
                problems.append(f"class {cls[1:-1].replace('/', '.')} is not in the app")
    return abis, problems


def main(paths):
    if not paths:
        print("no APK given - nothing was checked", file=sys.stderr)
        return 1
    failed = False
    for path in paths:
        abis, problems = check(path)
        if problems:
            failed = True
            print(f"FAIL {path}")
            for p in problems:
                print(f"   - {p}")
        else:
            print(f"ok   {path}  (speech engine inside, onnxruntime {ORT_VERSION}, {', '.join(abis)})")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
