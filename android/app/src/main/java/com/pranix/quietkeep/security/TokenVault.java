package com.pranix.quietkeep.security;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Item 1.6 (25 Nov 2026): the sign-in token is never kept as plain text.
 *
 * The token is encrypted with an AES key that lives in the Android Keystore
 * (the key never leaves the phone's secure hardware and cannot be copied out),
 * and only the encrypted form is written to the preference file. An old plain
 * "auth_token" left by an earlier app version is moved into the vault and
 * deleted the first time it is read, so updating the app keeps people signed in.
 *
 * No new library: Keystore AES-GCM is built into Android 6+ (our minSdk is 23).
 */
public final class TokenVault {
    private static final String TAG = "TokenVault";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "qk_token_key_v1";
    private static final String PLAIN = "auth_token";       // legacy plain-text entry (removed on sight)
    private static final String SEALED = "auth_token_enc";  // iv + ciphertext, base64
    private static final int IV_LEN = 12;

    private TokenVault() {}

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        kg.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return kg.generateKey();
    }

    /** Store (or, with null/empty, clear) the token for this preference file. Never throws. */
    public static void put(Context ctx, String prefsName, String token) {
        SharedPreferences prefs = ctx.getSharedPreferences(prefsName, Context.MODE_PRIVATE);
        SharedPreferences.Editor ed = prefs.edit().remove(PLAIN);
        if (token == null || token.isEmpty()) {
            ed.remove(SEALED).apply();
            return;
        }
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = c.getIV();
            byte[] ct = c.doFinal(token.getBytes(StandardCharsets.UTF_8));
            byte[] out = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            ed.putString(SEALED, Base64.encodeToString(out, Base64.NO_WRAP)).apply();
        } catch (Exception e) {
            // Never fall back to plain text: without the vault the person simply
            // signs in again from the app; the services keep using the token they
            // were handed in their start message.
            Log.w(TAG, "could not seal token: " + e.getClass().getSimpleName());
            ed.remove(SEALED).apply();
        }
    }

    /** The token for this preference file, or null. Moves a legacy plain token into the vault. */
    public static String get(Context ctx, String prefsName) {
        SharedPreferences prefs = ctx.getSharedPreferences(prefsName, Context.MODE_PRIVATE);
        String legacy = prefs.getString(PLAIN, null);
        if (legacy != null) {
            put(ctx, prefsName, legacy);
            return legacy.isEmpty() ? null : legacy;
        }
        String sealed = prefs.getString(SEALED, null);
        if (sealed == null) return null;
        try {
            byte[] all = Base64.decode(sealed, Base64.NO_WRAP);
            if (all.length <= IV_LEN) return null;
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, all, 0, IV_LEN));
            byte[] pt = c.doFinal(all, IV_LEN, all.length - IV_LEN);
            return new String(pt, StandardCharsets.UTF_8);
        } catch (Exception e) {
            Log.w(TAG, "could not open token: " + e.getClass().getSimpleName());
            prefs.edit().remove(SEALED).apply();
            return null;
        }
    }
}
