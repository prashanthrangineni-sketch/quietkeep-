package com.pranix.aariaedge;

import android.content.Context;
import java.io.File;

public class ModelStore {

    private Context context;

    public ModelStore(Context context) {
        this.context = context;
    }

    public boolean isAvailable(String lang) {
        File filesDir = context.getFilesDir();
        File modelDir = new File(filesDir, "models/" + lang);
        if (!modelDir.exists() || !modelDir.isDirectory()) return false;
        
        File modelJson = new File(modelDir, "model.json");
        if (!modelJson.exists()) return false;

        try {
            java.io.FileInputStream fis = new java.io.FileInputStream(modelJson);
            byte[] data = new byte[(int) modelJson.length()];
            fis.read(data);
            fis.close();
            String jsonContent = new String(data, "UTF-8");
            org.json.JSONObject obj = new org.json.JSONObject(jsonContent);
            
            // Check all string values that look like filenames ending in .onnx or .txt
            java.util.Iterator<String> keys = obj.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if (obj.optString(key).endsWith(".onnx") || obj.optString(key).endsWith(".txt") || obj.optString(key).endsWith(".fst")) {
                    String fileName = obj.getString(key);
                    if (!new File(modelDir, fileName).exists()) {
                        return false;
                    }
                }
            }
            return true;
        } catch (Exception e) {
            e.printStackTrace();
            return false;
        }
    }
    
    public String getModelPath(String lang) {
        File filesDir = context.getFilesDir();
        File modelDir = new File(filesDir, "models/" + lang);
        return modelDir.getAbsolutePath();
    }
}
