package com.pranix.aariaedge;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.media.MediaPlayer;

import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

public class AudioPlayer {
    public interface PlaybackCallback {
        void onCompletion();
    }

    public static void playOgg(Context context, File file, PlaybackCallback callback) {
        try {
            MediaPlayer mediaPlayer = new MediaPlayer();
            AudioAttributes attributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
            mediaPlayer.setAudioAttributes(attributes);
            mediaPlayer.setDataSource(file.getAbsolutePath());
            mediaPlayer.setOnCompletionListener(mp -> {
                mp.release();
                if (callback != null) {
                    new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(callback::onCompletion, 250);
                }
            });
            mediaPlayer.setOnErrorListener((mp, what, extra) -> {
                mp.release();
                if (callback != null) callback.onCompletion();
                return true;
            });
            mediaPlayer.prepare();
            mediaPlayer.start();
        } catch (Exception e) {
            if (callback != null) callback.onCompletion();
        }
    }

    public static void playWav(byte[] wavBytes, PlaybackCallback callback) {
        new Thread(() -> {
            try {
                // Parse WAV header
                ByteBuffer bb = ByteBuffer.wrap(wavBytes).order(ByteOrder.LITTLE_ENDIAN);
                bb.position(22);
                int channels = bb.getShort();
                int sampleRate = bb.getInt();
                bb.position(34);
                int bitsPerSample = bb.getShort();

                int channelConfig = channels == 1 ? AudioFormat.CHANNEL_OUT_MONO : AudioFormat.CHANNEL_OUT_STEREO;
                int audioFormat = bitsPerSample == 16 ? AudioFormat.ENCODING_PCM_16BIT : AudioFormat.ENCODING_PCM_8BIT;

                // Find data chunk
                int dataOffset = 12;
                int dataSize = 0;
                while (dataOffset < wavBytes.length - 8) {
                    String chunkId = new String(wavBytes, dataOffset, 4);
                    int chunkSize = ByteBuffer.wrap(wavBytes, dataOffset + 4, 4).order(ByteOrder.LITTLE_ENDIAN).getInt();
                    if ("data".equals(chunkId)) {
                        dataOffset += 8;
                        dataSize = chunkSize;
                        break;
                    }
                    dataOffset += 8 + chunkSize;
                }
                
                if (dataSize <= 0) {
                    dataSize = wavBytes.length - dataOffset;
                } else {
                    dataSize = Math.min(dataSize, wavBytes.length - dataOffset);
                }

                int bufferSize = AudioTrack.getMinBufferSize(sampleRate, channelConfig, audioFormat);
                AudioAttributes attributes = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANT)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build();

                AudioFormat format = new AudioFormat.Builder()
                        .setSampleRate(sampleRate)
                        .setChannelMask(channelConfig)
                        .setEncoding(audioFormat)
                        .build();

                AudioTrack track = new AudioTrack.Builder()
                        .setAudioAttributes(attributes)
                        .setAudioFormat(format)
                        .setBufferSizeInBytes(bufferSize)
                        .setTransferMode(AudioTrack.MODE_STREAM)
                        .build();

                track.play();
                track.write(wavBytes, dataOffset, dataSize);
                
                int totalFrames = dataSize / (channelConfig == AudioFormat.CHANNEL_OUT_STEREO ? 2 : 1) / (bitsPerSample / 8);
                long timeoutMs = (long) ((totalFrames / (double) sampleRate) * 1000) + 1000;
                long startMs = System.currentTimeMillis();
                
                while (track.getPlaybackHeadPosition() < totalFrames && (System.currentTimeMillis() - startMs) < timeoutMs) {
                    Thread.sleep(10);
                }
                
                track.stop();
                track.release();
            } catch (Exception e) {
                // ignore
            } finally {
                if (callback != null) {
                    try { Thread.sleep(250); } catch (Exception ignored) {}
                    callback.onCompletion();
                }
            }
        }).start();
    }
}
