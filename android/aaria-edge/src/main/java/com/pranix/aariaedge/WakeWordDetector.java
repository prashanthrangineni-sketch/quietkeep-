package com.pranix.aariaedge;

import java.io.File;

public interface WakeWordDetector {
    void load(File modelDir);
    float score(short[] frame16k);
    String id();
}
