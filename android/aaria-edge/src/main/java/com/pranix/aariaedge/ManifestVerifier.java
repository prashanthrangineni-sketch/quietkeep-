package com.pranix.aariaedge;

import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

/**
 * Verifies a detached ECDSA P-256 / SHA-256 signature over a sync manifest.
 *
 * <p>The host app supplies a base64-encoded X.509 ECDSA public key via
 * {@code configureSync({ manifestUrl, manifestPublicKey })}. Before the
 * manifest is parsed, both {@code manifest.json} and {@code manifest.json.sig}
 * are fetched. If the signature is missing, malformed, or does not verify,
 * sync is refused with error {@code "bad_signature"}.
 */
public class ManifestVerifier {

    /**
     * Verify that {@code signatureBytes} is a valid ECDSA-SHA256 signature of
     * {@code data} under the ECDSA P-256 public key encoded in {@code publicKeyBase64}
     * (DER / X.509 SubjectPublicKeyInfo, base64).
     *
     * @param data             the raw manifest bytes
     * @param signatureBytes   the detached DER signature
     * @param publicKeyBase64  base64-encoded X.509 public key
     * @return true iff the signature is valid
     */
    public static boolean verify(byte[] data, byte[] signatureBytes, String publicKeyBase64) {
        try {
            byte[] keyBytes = Base64.getDecoder().decode(publicKeyBase64);
            X509EncodedKeySpec keySpec = new X509EncodedKeySpec(keyBytes);
            KeyFactory kf = KeyFactory.getInstance("EC");
            PublicKey publicKey = kf.generatePublic(keySpec);

            Signature sig = Signature.getInstance("SHA256withECDSA");
            sig.initVerify(publicKey);
            sig.update(data);
            return sig.verify(signatureBytes);
        } catch (Exception e) {
            // Any failure (bad key, bad signature bytes, etc.) → not verified
            return false;
        }
    }
}
