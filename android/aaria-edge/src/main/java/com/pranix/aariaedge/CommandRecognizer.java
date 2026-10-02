package com.pranix.aariaedge;

import android.content.Context;
import java.io.InputStream;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;

import com.k2fsa.sherpa.onnx.OfflineRecognizer;
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig;
import com.k2fsa.sherpa.onnx.OfflineModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTransducerModelConfig;
import com.k2fsa.sherpa.onnx.OfflineNemoEncDecCtcModelConfig;
import com.k2fsa.sherpa.onnx.OfflineMoonshineModelConfig;
import com.k2fsa.sherpa.onnx.OfflineStream;
import com.k2fsa.sherpa.onnx.OfflineRecognizerResult;

import com.k2fsa.sherpa.onnx.OnlineRecognizer;
import com.k2fsa.sherpa.onnx.OnlineRecognizerConfig;
import com.k2fsa.sherpa.onnx.OnlineModelConfig;
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig;
import com.k2fsa.sherpa.onnx.OnlineStream;
import com.k2fsa.sherpa.onnx.OnlineRecognizerResult;

import org.json.JSONObject;

public class CommandRecognizer {

    private Context context;
    private ModelStore modelStore;
    private String currentLang = "en";
    
    private CommandMatcher enMatcher;
    private CommandMatcher hiMatcher;
    private CommandMatcher teMatcher;

    private OfflineRecognizer cachedOfflineRecognizer = null;
    private OnlineRecognizer cachedOnlineRecognizer = null;
    private String cachedRecognizerLang = null;

    public CommandRecognizer(Context context, ModelStore store) {
        this.context = context;
        this.modelStore = store;
        
        try {
            enMatcher = new CommandMatcher(loadAssetAsString("commands/en.json"));
            hiMatcher = new CommandMatcher(loadAssetAsString("commands/hi.json"));
            teMatcher = new CommandMatcher(loadAssetAsString("commands/te.json"));
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
    
    private String loadAssetAsString(String file) throws Exception {
        try (InputStream is = context.getAssets().open(file)) {
            byte[] buffer = new byte[is.available()];
            is.read(buffer);
            return new String(buffer, StandardCharsets.UTF_8);
        }
    }
    
    public void setLanguage(String lang) {
        this.currentLang = lang;
    }

    private void prepareRecognizer() {
        if (cachedRecognizerLang != null && currentLang.equals(cachedRecognizerLang)) {
            return;
        }
        if (cachedOfflineRecognizer != null) {
            cachedOfflineRecognizer.release();
            cachedOfflineRecognizer = null;
        }
        if (cachedOnlineRecognizer != null) {
            cachedOnlineRecognizer.release();
            cachedOnlineRecognizer = null;
        }
        
        if (!modelStore.isAvailable(currentLang)) {
            return;
        }
        
        try {
            String modelPath = modelStore.getModelPath(currentLang);
            File jsonFile = new File(modelPath, "model.json");
            FileInputStream fis = new FileInputStream(jsonFile);
            byte[] data = new byte[(int) jsonFile.length()];
            fis.read(data);
            fis.close();
            
            JSONObject configJson = new JSONObject(new String(data, "UTF-8"));
            String type = configJson.optString("type");
            
            if ("streaming_transducer".equals(type)) {
                OnlineRecognizerConfig config = new OnlineRecognizerConfig();
                OnlineModelConfig modelConfig = new OnlineModelConfig();
                modelConfig.setTokens(new File(modelPath, configJson.getString("tokens")).getAbsolutePath());
                modelConfig.setNumThreads(1);
                
                OnlineTransducerModelConfig transducer = new OnlineTransducerModelConfig();
                transducer.setEncoder(new File(modelPath, configJson.getString("encoder")).getAbsolutePath());
                transducer.setDecoder(new File(modelPath, configJson.getString("decoder")).getAbsolutePath());
                transducer.setJoiner(new File(modelPath, configJson.getString("joiner")).getAbsolutePath());
                modelConfig.setTransducer(transducer);
                
                config.setModelConfig(modelConfig);
                config.setDecodingMethod("greedy_search");
                config.setEnableEndpoint(false);
                
                cachedOnlineRecognizer = new OnlineRecognizer(null, config);
            } else {
                OfflineRecognizerConfig config = new OfflineRecognizerConfig();
                OfflineModelConfig modelConfig = new OfflineModelConfig();
                modelConfig.setTokens(new File(modelPath, configJson.getString("tokens")).getAbsolutePath());
                modelConfig.setNumThreads(1);
                
                if ("transducer".equals(type)) {
                    OfflineTransducerModelConfig transducer = new OfflineTransducerModelConfig();
                    transducer.setEncoder(new File(modelPath, configJson.getString("encoder")).getAbsolutePath());
                    transducer.setDecoder(new File(modelPath, configJson.getString("decoder")).getAbsolutePath());
                    transducer.setJoiner(new File(modelPath, configJson.getString("joiner")).getAbsolutePath());
                    modelConfig.setTransducer(transducer);
                } else if ("ctc".equals(type)) {
                    OfflineNemoEncDecCtcModelConfig nemo = new OfflineNemoEncDecCtcModelConfig();
                    nemo.setModel(new File(modelPath, configJson.getString("model")).getAbsolutePath());
                    modelConfig.setNemo(nemo);
                } else if ("moonshine".equals(type)) {
                    OfflineMoonshineModelConfig moonshine = new OfflineMoonshineModelConfig();
                    moonshine.setPreprocessor(new File(modelPath, configJson.getString("preprocessor")).getAbsolutePath());
                    moonshine.setEncoder(new File(modelPath, configJson.getString("encoder")).getAbsolutePath());
                    moonshine.setUncachedDecoder(new File(modelPath, configJson.has("uncachedDecoder") ? configJson.getString("uncachedDecoder") : configJson.getString("uncached_decoder")).getAbsolutePath());
                    moonshine.setCachedDecoder(new File(modelPath, configJson.has("cachedDecoder") ? configJson.getString("cachedDecoder") : configJson.getString("cached_decoder")).getAbsolutePath());
                    modelConfig.setMoonshine(moonshine);
                } else {
                    return;
                }
                
                config.setModelConfig(modelConfig);
                config.setDecodingMethod("greedy_search");
                
                cachedOfflineRecognizer = new OfflineRecognizer(null, config);
            }
            cachedRecognizerLang = currentLang;
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static class RecognizeResult {
        public String transcript;
        public CommandMatcher.MatchResult matchResult;
        
        public RecognizeResult(String transcript, CommandMatcher.MatchResult matchResult) {
            this.transcript = transcript;
            this.matchResult = matchResult;
        }
    }

    public RecognizeResult recognizeCommand(short[] audioData, int sampleRate) {
        prepareRecognizer();
        if (cachedOfflineRecognizer == null && cachedOnlineRecognizer == null) {
            return null;
        }
        
        float[] floatAudio = new float[audioData.length];
        for (int i = 0; i < audioData.length; i++) {
            floatAudio[i] = audioData[i] / 32768.0f;
        }
        
        String transcript = "";
        
        if (cachedOfflineRecognizer != null) {
            OfflineStream stream = cachedOfflineRecognizer.createStream();
            stream.acceptWaveform(floatAudio, sampleRate);
            cachedOfflineRecognizer.decode(stream);
            OfflineRecognizerResult result = cachedOfflineRecognizer.getResult(stream);
            transcript = result.getText();
            stream.release();
        } else if (cachedOnlineRecognizer != null) {
            OnlineStream stream = cachedOnlineRecognizer.createStream("");
            stream.acceptWaveform(floatAudio, sampleRate);
            
            // Add padding for streaming models to flush out the last tokens
            float[] padding = new float[(int)(sampleRate * 0.66f)];
            stream.acceptWaveform(padding, sampleRate);
            
            stream.inputFinished();
            
            while (cachedOnlineRecognizer.isReady(stream)) {
                cachedOnlineRecognizer.decode(stream);
            }
            
            OnlineRecognizerResult result = cachedOnlineRecognizer.getResult(stream);
            transcript = result.getText();
            stream.release();
        }
        
        CommandMatcher matcher = currentLang.equals("en") ? enMatcher :
                                 currentLang.equals("hi") ? hiMatcher :
                                 currentLang.equals("te") ? teMatcher : enMatcher;
                                 
        CommandMatcher.MatchResult match = matcher.match(transcript);
        return new RecognizeResult(transcript, match);
    }

    public CommandMatcher.MatchResult matchCommand(String text) {
        CommandMatcher matcher = currentLang.equals("en") ? enMatcher :
                                 currentLang.equals("hi") ? hiMatcher :
                                 currentLang.equals("te") ? teMatcher : enMatcher;
        return matcher.match(text);
    }
}
