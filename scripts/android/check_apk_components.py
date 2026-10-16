#!/usr/bin/env python3
"""Proves the phone-test APK lost ONLY notification access, nothing else.

Why this exists: the phone-test build removes one <service> (PaymentNotificationListener) so Play
Protect lets the downloaded APK install. Two layers do that removal - the manifest script run in
android-release.yml and a text edit of the merged manifest in android/app/build.gradle - and a text
edit can cut out more than it means to. So this compares the finished APK against the repository's
own manifest: every activity, service, receiver, provider and permission the repository declares
must still be inside, except the one listener. Prints the APK's full component list either way.

usage: python3 scripts/android/check_apk_components.py <repo-manifest.xml> <aapt2-xmltree-dump.txt>
  repo-manifest.xml  the manifest as committed (e.g. from `git show HEAD:...`), not the edited one
  dump               output of `aapt2 dump xmltree --file AndroidManifest.xml <apk>`
"""
import re
import sys
import xml.etree.ElementTree as ET

ANDROID = "{http://schemas.android.com/apk/res/android}"
COMPONENTS = ("activity", "activity-alias", "service", "receiver", "provider")
LEFT_OUT = {"com.pranix.quietkeep.services.PaymentNotificationListener"}


def full_name(name, package):
    if name.startswith("."):
        return package + name
    if "." not in name:
        return package + "." + name
    return name


def repo_declares(path):
    root = ET.parse(path).getroot()
    package = root.get("package") or "com.pranix.quietkeep"
    components = set()
    app = root.find("application")
    for el in (app if app is not None else []):
        if el.tag in COMPONENTS and el.get(ANDROID + "name"):
            components.add((el.tag, full_name(el.get(ANDROID + "name"), package)))
    permissions = {el.get(ANDROID + "name") for el in root.findall("uses-permission")}
    return components, permissions


def apk_declares(dump_path):
    components, permissions = set(), set()
    element = None
    name_re = re.compile(r'A: http://schemas\.android\.com/apk/res/android:name\(0x01010003\)="([^"]+)"')
    with open(dump_path, encoding="utf-8") as f:
        for line in f:
            stripped = line.strip()
            if stripped.startswith("E: "):
                element = stripped[3:].split(" ", 1)[0]
                continue
            m = name_re.search(stripped)
            if m and element:
                if element in COMPONENTS:
                    components.add((element, m.group(1)))
                elif element == "uses-permission":
                    permissions.add(m.group(1))
                element = None  # the name belongs to this element only
    return components, permissions


def main():
    repo_components, repo_permissions = repo_declares(sys.argv[1])
    apk_components, apk_permissions = apk_declares(sys.argv[2])
    if not apk_components:
        sys.exit("no components read from the APK manifest dump - check is blind")

    print("-- components in the APK:")
    for kind, name in sorted(apk_components):
        print(f"   {kind:15} {name}")

    expected = {c for c in repo_components if c[1] not in LEFT_OUT}
    missing = sorted(expected - apk_components)
    missing_perms = sorted(repo_permissions - apk_permissions)
    still_there = sorted(c for c in apk_components if c[1] in LEFT_OUT)

    for kind, name in missing:
        print(f"FAIL: {kind} {name} is in the repository manifest but missing from the APK", file=sys.stderr)
    for p in missing_perms:
        print(f"FAIL: permission {p} is in the repository manifest but missing from the APK", file=sys.stderr)
    for kind, name in still_there:
        print(f"FAIL: {kind} {name} should have been left out but is in the APK", file=sys.stderr)
    if missing or missing_perms or still_there:
        sys.exit(1)
    print(f"ok: all {len(expected)} components and {len(repo_permissions)} permissions the repository "
          f"declares are in the APK; only {', '.join(sorted(LEFT_OUT))} was left out")


if __name__ == "__main__":
    main()
