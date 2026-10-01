"""
Make the PHONE-TEST build installable from a download. (Run by
.github/workflows/android-release.yml on the CI checkout only - the
repository's manifest is never changed.)

WHY
---
On 1 October 2026 the founder downloaded the test APK and Android refused it:
"App blocked". That is Google Play Protect's enhanced fraud protection, which
is live in India. It blocks any app installed from a browser, a messaging app
or a file manager that asks for one of four permissions - RECEIVE_SMS,
READ_SMS, NOTIFICATION_LISTENER or ACCESSIBILITY - and the person has no way
past it. (Google's developer guidance on Play Protect warnings lists the
four.)

QuietKeep asks for exactly one of them: PaymentNotificationListener, the
"read my UPI payment notifications and log the expense" feature. Nothing else
in the manifest is on the list.

The earlier explanation in android-release.yml - that the shared DEBUG
signature was what Play Protect objected to - was wrong. A properly signed
build is blocked just the same, because the trigger is the permission.

WHAT THIS DOES
--------------
Removes that one <service> declaration from the manifest before the test
build, so the test APK installs. Expense auto-capture is the only thing a
phone-test build cannot do; everything being tested this week (Aaria, calls,
reminders, the home-screen button) is unaffected.

The Play Store build keeps it: an app installed from Google Play is not
subject to this block.

Fails loudly if the block is not found, rather than producing an APK that
would be refused on the phone.
"""

import re
import sys

PATH = sys.argv[1] if len(sys.argv) > 1 else "android/app/src/main/AndroidManifest.xml"

with open(PATH, encoding="utf-8") as f:
    source = f.read()

trimmed = re.sub(
    r'\s*<!-- PaymentNotificationListener[^>]*-->\s*'
    r'<service\s+android:name="\.services\.PaymentNotificationListener".*?</service>',
    "\n", source, flags=re.S)

if trimmed == source:
    sys.exit("PaymentNotificationListener block not found - refusing to build an "
             "APK that Play Protect would block on the phone")
if "NotificationListenerService" in trimmed or "BIND_NOTIFICATION_LISTENER_SERVICE" in trimmed:
    sys.exit("a notification-listener declaration is still in the manifest")

with open(PATH, "w", encoding="utf-8") as f:
    f.write(trimmed)

print("phone-test build: left out PaymentNotificationListener (notification access)")
