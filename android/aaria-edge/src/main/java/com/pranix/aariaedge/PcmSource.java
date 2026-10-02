package com.pranix.aariaedge;

interface PcmSource {
    int read(short[] b, int off, int n);
    void close();

    interface Factory {
        PcmSource create();
    }

    static Factory defaultFactory = new Factory() {
        @Override
        public PcmSource create() {
            int sampleRate = 16000;
            int bufferSize = android.media.AudioRecord.getMinBufferSize(sampleRate,
                    android.media.AudioFormat.CHANNEL_IN_MONO,
                    android.media.AudioFormat.ENCODING_PCM_16BIT);

            android.media.AudioRecord audioRecord = new android.media.AudioRecord(
                    android.media.MediaRecorder.AudioSource.MIC,
                    sampleRate,
                    android.media.AudioFormat.CHANNEL_IN_MONO,
                    android.media.AudioFormat.ENCODING_PCM_16BIT,
                    bufferSize);
                    
            if (audioRecord.getState() != android.media.AudioRecord.STATE_INITIALIZED) {
                audioRecord.release();
                return null;
            }
            
            audioRecord.startRecording();
            
            return new PcmSource() {
                @Override
                public int read(short[] b, int off, int n) {
                    return audioRecord.read(b, off, n);
                }
                @Override
                public void close() {
                    try {
                        audioRecord.stop();
                    } catch (IllegalStateException e) {}
                    audioRecord.release();
                }
            };
        }
    };
}
