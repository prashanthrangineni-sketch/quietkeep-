package com.pranix.aariaedge;

import javax.crypto.SecretKey;

/**
 * Abstraction for the encryption key used by MemoryStore.
 * Android implementation uses the Keystore; tests use a software key.
 */
public interface KeyProvider {
    SecretKey getKey();
    void destroyKey();
}
