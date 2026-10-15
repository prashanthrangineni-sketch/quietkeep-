package com.pranix.aariaedge;

import android.content.res.AssetManager;

import com.k2fsa.sherpa.onnx.FeatureConfig;
import com.k2fsa.sherpa.onnx.KeywordSpotter;
import com.k2fsa.sherpa.onnx.KeywordSpotterConfig;
import com.k2fsa.sherpa.onnx.KeywordSpotterResult;
import com.k2fsa.sherpa.onnx.OnlineModelConfig;
import com.k2fsa.sherpa.onnx.OnlineStream;
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig;

/**
 * sherpa-onnx's keyword spotter, on the same native library as the recogniser. Made only by
 * {@link KeywordSpotterWake#forPhone}, and only after every model file has passed its SHA-256 check.
 * The keywords ("Hey Aaria", "Hi Aaria" and "Hello Aaria", in the model's own tokens) are in assets/kws/keywords.txt.
 * Settings are sherpa-onnx's own defaults; how well they suit "Aaria" is not measured.
 */
class SherpaKeywordEngine implements KeywordSpotterWake.Engine {

    /** Silence added after each piece of speech, so a name at its very end is still decided. */
    private static final int TAIL_SAMPLES = 16000 * 3 / 10;

    private final KeywordSpotter spotter;

    /** Throws (often a LinkageError) when the speech engine is not packed into the app. */
    SherpaKeywordEngine(AssetManager assets) {
        String dir = KeywordSpotterWake.DIR + "/";
        OnlineTransducerModelConfig transducer = new OnlineTransducerModelConfig();
        transducer.setEncoder(dir + KeywordSpotterWake.MODEL_FILES[0][0]);
        transducer.setDecoder(dir + KeywordSpotterWake.MODEL_FILES[1][0]);
        transducer.setJoiner(dir + KeywordSpotterWake.MODEL_FILES[2][0]);

        OnlineModelConfig model = new OnlineModelConfig();
        model.setTransducer(transducer);
        model.setTokens(dir + KeywordSpotterWake.MODEL_FILES[3][0]);
        model.setModelType("zipformer2");
        model.setNumThreads(1);
        model.setProvider("cpu");

        FeatureConfig feat = new FeatureConfig();
        feat.setSampleRate(16000);
        feat.setFeatureDim(80);

        KeywordSpotterConfig config = new KeywordSpotterConfig();
        config.setFeatConfig(feat);
        config.setModelConfig(model);
        config.setKeywordsFile(dir + KeywordSpotterWake.KEYWORDS);

        spotter = new KeywordSpotter(assets, config);
    }

    @Override
    public boolean heard(float[] samples16k) {
        // A fresh stream for every piece of speech: one piece can wake at most once.
        OnlineStream stream = spotter.createStream("");
        try {
            stream.acceptWaveform(samples16k, 16000);
            stream.acceptWaveform(new float[TAIL_SAMPLES], 16000);
            stream.inputFinished();
            while (spotter.isReady(stream)) {
                spotter.decode(stream);
                KeywordSpotterResult result = spotter.getResult(stream);
                if (result != null && result.getKeyword() != null && !result.getKeyword().isEmpty()) return true;
            }
            return false;
        } finally {
            stream.release();
        }
    }

    @Override
    public void release() {
        spotter.release();
    }
}
