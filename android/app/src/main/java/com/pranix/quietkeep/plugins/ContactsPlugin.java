package com.pranix.quietkeep.plugins;

import android.Manifest;
import android.content.ContentResolver;
import android.database.Cursor;
import android.provider.ContactsContract;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.HashMap;
import java.util.Map;

/**
 * ContactsPlugin — Capacitor Plugin for full phonebook sync (Track A2).
 */
@CapacitorPlugin(
    name = "ContactsPlugin",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_CONTACTS }, alias = "contacts")
    }
)
public class ContactsPlugin extends Plugin {
    private static final String TAG = "QK_CONTACTS_PLUGIN";

    @PluginMethod
    public void getAll(PluginCall call) {
        if (!hasRequiredPermissions()) {
            requestPermissionForAlias("contacts", call, "contactsPermCallback");
            return;
        }
        fetchAndResolveContacts(call);
    }

    @PermissionCallback
    private void contactsPermCallback(PluginCall call) {
        if (hasRequiredPermissions()) {
            fetchAndResolveContacts(call);
        } else {
            Log.w(TAG, "READ_CONTACTS permission denied");
            JSObject res = new JSObject();
            res.put("contacts", new JSArray());
            call.resolve(res);
        }
    }

    private void fetchAndResolveContacts(PluginCall call) {
        JSArray contactsArray = new JSArray();
        ContentResolver cr = getContext().getContentResolver();

        Cursor cursor = null;
        try {
            cursor = cr.query(
                ContactsContract.Contacts.CONTENT_URI,
                new String[]{ ContactsContract.Contacts._ID, ContactsContract.Contacts.DISPLAY_NAME_PRIMARY },
                null,
                null,
                ContactsContract.Contacts.DISPLAY_NAME_PRIMARY + " ASC"
            );

            if (cursor == null || !cursor.moveToFirst()) {
                if (cursor != null) cursor.close();
                JSObject res = new JSObject();
                res.put("contacts", contactsArray);
                call.resolve(res);
                return;
            }

            int idIdx = cursor.getColumnIndex(ContactsContract.Contacts._ID);
            int nameIdx = cursor.getColumnIndex(ContactsContract.Contacts.DISPLAY_NAME_PRIMARY);

            Map<String, JSObject> map = new HashMap<>();

            do {
                String id = cursor.getString(idIdx);
                String name = cursor.getString(nameIdx);
                if (name == null || name.trim().isEmpty()) continue;

                JSObject cObj = new JSObject();
                cObj.put("name", name.trim());
                cObj.put("phones", new JSArray());
                cObj.put("emails", new JSArray());
                map.put(id, cObj);
            } while (cursor.moveToNext());
            cursor.close();

            // Fetch Phone numbers
            Cursor phoneCursor = cr.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                new String[]{ ContactsContract.CommonDataKinds.Phone.CONTACT_ID, ContactsContract.CommonDataKinds.Phone.NUMBER },
                null,
                null,
                null
            );

            if (phoneCursor != null) {
                int pIdIdx = phoneCursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.CONTACT_ID);
                int numIdx = phoneCursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                while (phoneCursor.moveToNext()) {
                    String contactId = phoneCursor.getString(pIdIdx);
                    String number = phoneCursor.getString(numIdx);
                    if (map.containsKey(contactId) && number != null) {
                        map.get(contactId).getJSONArray("phones").put(number.trim());
                    }
                }
                phoneCursor.close();
            }

            // Fetch Emails
            Cursor emailCursor = cr.query(
                ContactsContract.CommonDataKinds.Email.CONTENT_URI,
                new String[]{ ContactsContract.CommonDataKinds.Email.CONTACT_ID, ContactsContract.CommonDataKinds.Email.ADDRESS },
                null,
                null,
                null
            );

            if (emailCursor != null) {
                int eIdIdx = emailCursor.getColumnIndex(ContactsContract.CommonDataKinds.Email.CONTACT_ID);
                int addrIdx = emailCursor.getColumnIndex(ContactsContract.CommonDataKinds.Email.ADDRESS);
                while (emailCursor.moveToNext()) {
                    String contactId = emailCursor.getString(eIdIdx);
                    String address = emailCursor.getString(addrIdx);
                    if (map.containsKey(contactId) && address != null) {
                        map.get(contactId).getJSONArray("emails").put(address.trim());
                    }
                }
                emailCursor.close();
            }

            for (JSObject obj : map.values()) {
                contactsArray.put(obj);
            }

        } catch (Exception e) {
            Log.e(TAG, "Error fetching contacts: " + e.getMessage(), e);
        } finally {
            if (cursor != null && !cursor.isClosed()) {
                cursor.close();
            }
        }

        JSObject res = new JSObject();
        res.put("contacts", contactsArray);
        call.resolve(res);
    }
}
