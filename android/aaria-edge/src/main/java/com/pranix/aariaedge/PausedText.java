package com.pranix.aariaedge;

import java.util.HashSet;
import java.util.Set;

public class PausedText {
    public static final Set<String> AUTO_RESUME_REASONS = new HashSet<>();
    static {
        AUTO_RESUME_REASONS.add("low_battery");
        AUTO_RESUME_REASONS.add("power_saver");
        AUTO_RESUME_REASONS.add("hot");
        AUTO_RESUME_REASONS.add("unplugged");
        AUTO_RESUME_REASONS.add("in_use");
    }

    public static class Result {
        public String titleKey;
        public String reasonKey;
        public String lastLineKey;

        public Result(String titleKey, String reasonKey, String lastLineKey) {
            this.titleKey = titleKey;
            this.reasonKey = reasonKey;
            this.lastLineKey = lastLineKey;
        }
    }

    public static Result choose(String reason, boolean canAutoResume) {
        String reasonKey = "";
        if ("low_battery".equals(reason)) reasonKey = "s4_paused_low_battery";
        else if ("power_saver".equals(reason)) reasonKey = "s4_paused_power_saver";
        else if ("hot".equals(reason)) reasonKey = "s4_paused_hot";
        else if ("unplugged".equals(reason)) reasonKey = "s4_paused_unplugged";
        else if ("in_use".equals(reason)) reasonKey = "s4_paused_in_use";

        String lastLineKey = "s4_paused_open_app";
        if (canAutoResume && reason != null && AUTO_RESUME_REASONS.contains(reason)) {
            lastLineKey = "s4_paused_resume";
        }

        return new Result("s4_paused_title", reasonKey, lastLineKey);
    }
}
