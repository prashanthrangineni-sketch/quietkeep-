package com.pranix.aariaedge;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import java.security.KeyStore;

import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

/**
 * Android Keystore-backed key provider for MemoryStore.
 * The key lives in the phone's secure chip and is never exportable.
 */
public class KeystoreKeyProvider implements KeyProvider {

    private static final String ALIAS = "aaria_memory_v1";
    private static final String KEYSTORE_TYPE = "AndroidKeyStore";

    @Override
    public SecretKey getKey() {
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE_TYPE);
            ks.load(null);
            KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null);
            if (entry != null) {
                return entry.getSecretKey();
            }
            // Create a new key
            return generateKey();
        } catch (Exception e) {
            throw new RuntimeException("Failed to get memory encryption key", e);
        }
    }

    @Override
    public void destroyKey() {
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE_TYPE);
            ks.load(null);
            if (ks.containsAlias(ALIAS)) {
                ks.deleteEntry(ALIAS);
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to destroy memory encryption key", e);
        }
    }

    private SecretKey generateKey() throws Exception {
        KeyGenerator kg = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_TYPE);
        kg.init(new KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return kg.generateKey();
    }
}
