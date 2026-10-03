package com.pranix.aariaedge;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;

/**
 * Downloads files with resume support, SHA-256 verification, and atomic rename.
 * Checks free space before downloading. Uses plain Java + HttpURLConnection.
 *
 * <p>Safety guarantees:
 * <ul>
 *   <li>Stops reading as soon as the .part file would exceed expectedBytes (rogue server defence).</li>
 *   <li>Checks Thread.interrupted() in the read loop so WorkManager cancellation is honoured;
 *       the .part is kept intact for resume on the next run.</li>
 *   <li>Free-space check accounts for bytes already in a partial download.</li>
 * </ul>
 */
public class Downloader {

    private static final long SPARE_BYTES = 200L * 1024 * 1024; // 200 MB spare required
    private static final int CONNECT_TIMEOUT = 30_000;
    private static final int READ_TIMEOUT = 60_000;
    private static final int BUFFER_SIZE = 8192;

    /** Injectable free-space function for testing. */
    public interface FreeSpaceProvider {
        long getFreeSpace(File dir);
    }

    public static final FreeSpaceProvider DEFAULT_FREE_SPACE = File::getUsableSpace;

    public static class DownloadResult {
        public final boolean success;
        public final String error;
        public final String skipReason;

        private DownloadResult(boolean success, String error, String skipReason) {
            this.success = success;
            this.error = error;
            this.skipReason = skipReason;
        }

        static DownloadResult ok() { return new DownloadResult(true, null, null); }
        static DownloadResult skipped(String reason) { return new DownloadResult(false, null, reason); }
        static DownloadResult failed(String error) { return new DownloadResult(false, error, null); }
    }

    /**
     * Downloads a file from url to targetFile, verifying sha256 and expected size.
     * Uses .part file for resume. Atomic rename on success.
     *
     * @param url            HTTPS URL to download from
     * @param targetFile     final destination file
     * @param expectedBytes  expected file size
     * @param expectedSha256 expected SHA-256 hex string
     * @param freeSpace      injectable free-space provider
     * @return DownloadResult
     */
    public static DownloadResult download(String url, File targetFile,
                                          long expectedBytes, String expectedSha256,
                                          FreeSpaceProvider freeSpace) {
        // If target already exists and matches, skip
        if (targetFile.exists() && targetFile.length() == expectedBytes) {
            try {
                String existingSha = sha256Hex(targetFile);
                if (existingSha.equalsIgnoreCase(expectedSha256)) {
                    return DownloadResult.ok();
                }
            } catch (Exception ignored) {
                // Re-download if we can't verify
            }
        }

        File parentDir = targetFile.getParentFile();
        if (parentDir != null && !parentDir.exists()) {
            parentDir.mkdirs();
        }

        File partFile = new File(targetFile.getAbsolutePath() + ".part");

        long existingBytes = 0;
        if (partFile.exists()) {
            existingBytes = partFile.length();
            if (existingBytes >= expectedBytes) {
                // Part file is already full size or larger — discard and start fresh
                existingBytes = 0;
                partFile.delete();
            }
        }

        // Free-space check: only need space for remaining bytes + 200 MB spare
        long remainingBytes = expectedBytes - existingBytes;
        File spaceCheckDir = parentDir != null ? parentDir : targetFile;
        long available = freeSpace.getFreeSpace(spaceCheckDir);
        if (available < remainingBytes + SPARE_BYTES) {
            return DownloadResult.skipped("low_storage");
        }

        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(CONNECT_TIMEOUT);
            conn.setReadTimeout(READ_TIMEOUT);
            conn.setRequestProperty("Accept-Encoding", "identity");

            if (existingBytes > 0) {
                conn.setRequestProperty("Range", "bytes=" + existingBytes + "-");
            }

            int responseCode = conn.getResponseCode();

            // If server doesn't support Range, start from scratch
            if (existingBytes > 0 && responseCode != 206) {
                existingBytes = 0;
                partFile.delete();
            }

            if (responseCode != 200 && responseCode != 206) {
                conn.disconnect();
                return DownloadResult.failed("HTTP " + responseCode);
            }

            try (InputStream in = conn.getInputStream();
                 FileOutputStream fos = new FileOutputStream(partFile, existingBytes > 0)) {

                byte[] buffer = new byte[BUFFER_SIZE];
                long totalWritten = existingBytes;
                int read;

                while ((read = in.read(buffer)) != -1) {
                    // Guard: stop if we would exceed expected size (rogue server defence)
                    if (totalWritten + read > expectedBytes) {
                        fos.close();
                        in.close();
                        conn.disconnect();
                        partFile.delete();
                        return DownloadResult.failed(
                                "Server sent more bytes than expected (" + expectedBytes + ")");
                    }

                    fos.write(buffer, 0, read);
                    totalWritten += read;

                    // Honour cancellation: keep .part intact for resume
                    if (Thread.currentThread().isInterrupted()) {
                        fos.close();
                        in.close();
                        conn.disconnect();
                        return DownloadResult.failed("interrupted");
                    }
                }
            } finally {
                conn.disconnect();
            }

            // Verify size
            if (partFile.length() != expectedBytes) {
                partFile.delete();
                return DownloadResult.failed("Size mismatch: expected " + expectedBytes
                        + " but got " + partFile.length());
            }

            // Verify SHA-256
            String actualSha = sha256Hex(partFile);
            if (!actualSha.equalsIgnoreCase(expectedSha256)) {
                partFile.delete();
                return DownloadResult.failed("SHA-256 mismatch: expected " + expectedSha256
                        + " but got " + actualSha);
            }

            // Atomic rename
            Files.move(partFile.toPath(), targetFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
            return DownloadResult.ok();

        } catch (Exception e) {
            // Don't delete .part on network errors — allow resume next time
            return DownloadResult.failed(e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    static String sha256Hex(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream fis = new FileInputStream(file)) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = fis.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        byte[] hash = digest.digest();
        StringBuilder sb = new StringBuilder(hash.length * 2);
        for (byte b : hash) {
            String hex = Integer.toHexString(0xff & b);
            if (hex.length() == 1) sb.append('0');
            sb.append(hex);
        }
        return sb.toString();
    }
}
