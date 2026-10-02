package com.pranix.aariaedge;

import java.util.ArrayList;
import java.util.List;

public class WakeWordMatcher {
    private final List<String> prefixes = new ArrayList<>();

    public WakeWordMatcher(List<String> prefixes) {
        if (prefixes != null) {
            for (String p : prefixes) {
                this.prefixes.add(transliterateToLatin(p.toLowerCase()));
            }
        }
    }

    public static class MatchResult {
        public boolean isMatch;
        public float score;
        public boolean isShort;
        public String bestName;
    }

    public MatchResult match(String rawTranscript, String wakeName, List<String> aliases) {
        String latinTranscript = transliterateToLatin(rawTranscript.toLowerCase());

        List<String> validNames = new ArrayList<>();
        validNames.add(transliterateToLatin(wakeName.toLowerCase()));
        if (aliases != null) {
            for (String alias : aliases) {
                validNames.add(transliterateToLatin(alias.toLowerCase()));
            }
        }

        String[] words = latinTranscript.split("\\s+");
        StringBuilder firstThree = new StringBuilder();
        for (int i = 0; i < Math.min(3, words.length); i++) {
            firstThree.append(words[i]).append(" ");
        }
        String toMatch = firstThree.toString().trim();

        float maxScore = 0.0f;
        String bestName = "";

        for (String name : validNames) {
            float s = evaluateMatch(toMatch, name);
            if (s > maxScore) {
                maxScore = s;
                bestName = name;
            }
        }

        boolean isShort = bestName.length() <= 3; 
        float threshold = isShort ? 0.9f : 0.8f;

        MatchResult result = new MatchResult();
        result.score = maxScore;
        result.bestName = bestName;
        result.isShort = isShort;
        result.isMatch = (maxScore >= threshold);
        
        return result;
    }

    public String stripWake(String rawTranscript, String wakeName, List<String> aliases) {
        String latinTranscript = transliterateToLatin(rawTranscript.toLowerCase());
        String[] latinWords = latinTranscript.trim().split("\\s+");
        String[] rawWords = rawTranscript.trim().split("\\s+");

        List<String> validNames = new ArrayList<>();
        validNames.add(transliterateToLatin(wakeName.toLowerCase()));
        if (aliases != null) {
            for (String alias : aliases) {
                validNames.add(transliterateToLatin(alias.toLowerCase()));
            }
        }

        float maxScore = 0.0f;
        int bestWordCount = 0;

        for (int count = 1; count <= Math.min(4, latinWords.length); count++) {
            StringBuilder prefix = new StringBuilder();
            for (int i = 0; i < count; i++) {
                prefix.append(latinWords[i]).append(" ");
            }
            String toMatch = prefix.toString().trim();
            for (String name : validNames) {
                float s = evaluateMatch(toMatch, name);
                if (s > maxScore) {
                    maxScore = s;
                    bestWordCount = count;
                }
            }
        }

        if (bestWordCount == 0 || bestWordCount >= rawWords.length) {
            return "";
        }

        StringBuilder remainder = new StringBuilder();
        for (int i = bestWordCount; i < rawWords.length; i++) {
            remainder.append(rawWords[i]);
            if (i < rawWords.length - 1) remainder.append(" ");
        }
        return remainder.toString();
    }

    public static final float ENROLL_MIN_SIMILARITY = 0.6f;

    public List<String> chooseEnrollAliases(String typedName, List<String> heard) {
        String typedNorm = transliterateToLatin(typedName.toLowerCase()).trim();
        List<String> validHeard = new ArrayList<>();
        for (String h : heard) {
            String norm = transliterateToLatin(h.toLowerCase()).trim();
            String[] words = norm.split("\\s+");
            if (words.length > 1) {
                String first = words[0];
                boolean isGreeting = first.equals("hey") || first.equals("hi") || first.equals("ok") || first.equals("okay") || first.equals("hello");
                if (!isGreeting) {
                    for (String p : prefixes) {
                        if (first.equals(p)) {
                            isGreeting = true;
                            break;
                        }
                    }
                }
                if (isGreeting) {
                    norm = norm.substring(first.length()).trim();
                }
            }
            validHeard.add(norm);
        }

        List<String> selected = new ArrayList<>();
        for (String h : validHeard) {
            if (h.isEmpty() || h.equals(typedNorm)) continue;
            float sim = getEditDistanceRatio(h, typedNorm);
            if (sim < ENROLL_MIN_SIMILARITY) continue;
            
            int count = 0;
            for (String other : validHeard) {
                if (other.equals(h)) count++;
            }
            if (count >= 2 && !selected.contains(h)) {
                selected.add(h);
                if (selected.size() == 5) break;
            }
        }
        return selected;
    }

    private float evaluateMatch(String text, String name) {
        float maxScore = 0.0f; // Require prefix match!
        for (String prefix : prefixes) {
            String combined = prefix + " " + name;
            float s = getEditDistanceRatio(text, combined);
            if (s > maxScore) maxScore = s;
        }
        return maxScore;
    }

    public static float getEditDistanceRatio(String s1, String s2) {
        if (s1.equals(s2)) return 1.0f;
        if (s1.isEmpty() || s2.isEmpty()) return 0.0f;

        int[] costs = new int[s2.length() + 1];
        for (int i = 0; i <= s1.length(); i++) {
            int lastValue = i;
            for (int j = 0; j <= s2.length(); j++) {
                if (i == 0)
                    costs[j] = j;
                else {
                    if (j > 0) {
                        int newValue = costs[j - 1];
                        if (s1.charAt(i - 1) != s2.charAt(j - 1))
                            newValue = Math.min(Math.min(newValue, lastValue),
                                    costs[j]) + 1;
                        costs[j - 1] = lastValue;
                        lastValue = newValue;
                    }
                }
            }
            if (i > 0)
                costs[s2.length()] = lastValue;
        }
        int distance = costs[s2.length()];
        int maxLen = Math.max(s1.length(), s2.length());
        return 1.0f - ((float) distance / maxLen);
    }

    public static String transliterateToLatin(String input) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < input.length(); i++) {
            char c = input.charAt(i);
            if (c >= '\u0900' && c <= '\u097F') {
                sb.append(devanagariToLatin(c, i, input));
            } else if (c >= '\u0C00' && c <= '\u0C7F') {
                sb.append(teluguToLatin(c, i, input));
            } else {
                sb.append(c);
            }
        }
        return sb.toString().replace("aa", "a").replace("ee", "i").replace("oo", "u");
    }

    private static boolean isLabial(char c) {
        return (c >= '\u092A' && c <= '\u092E') || (c >= '\u0C2A' && c <= '\u0C2E');
    }

    private static boolean hasVowelSignOrVirama(String str, int idx) {
        for (int i = idx + 1; i < str.length(); i++) {
            char next = str.charAt(i);
            if (next == '\u093C' || next == '\u200C' || next == '\u200D') continue;
            if ((next >= '\u093A' && next <= '\u094F') || (next >= '\u0955' && next <= '\u0957') || next == '\u0962' || next == '\u0963') return true;
            if ((next >= '\u0C3E' && next <= '\u0C4D') || (next >= '\u0C55' && next <= '\u0C56') || next == '\u0C62' || next == '\u0C63') return true;
            return false;
        }
        return false;
    }

    private static String devanagariToLatin(char c, int idx, String str) {
        char next = (idx + 1 < str.length()) ? str.charAt(idx + 1) : 0;
        String val = "";
        boolean isConsonant = false;
        switch (c) {
            case '\u0905': val = "a"; break; case '\u0906': val = "aa"; break;
            case '\u0907': val = "i"; break; case '\u0908': val = "ee"; break;
            case '\u0909': val = "u"; break; case '\u090A': val = "oo"; break;
            case '\u090F': val = "e"; break; case '\u0910': val = "ai"; break;
            case '\u0913': val = "o"; break; case '\u0914': val = "au"; break;
            case '\u090B': val = "ri"; break;
            
            case '\u0915': val = "k"; isConsonant = true; break;
            case '\u0916': val = "kh"; isConsonant = true; break;
            case '\u0917': val = "g"; isConsonant = true; break;
            case '\u0918': val = "gh"; isConsonant = true; break;
            case '\u091A': val = "ch"; isConsonant = true; break;
            case '\u091B': val = "chh"; isConsonant = true; break;
            case '\u091C': val = next == '\u093C' ? "z" : "j"; isConsonant = true; break;
            case '\u091D': val = "jh"; isConsonant = true; break;
            case '\u091F': val = "t"; isConsonant = true; break;
            case '\u0920': val = "th"; isConsonant = true; break;
            case '\u0921': val = next == '\u093C' ? "r" : "d"; isConsonant = true; break;
            case '\u0922': val = next == '\u093C' ? "rh" : "dh"; isConsonant = true; break;
            case '\u0923': val = "n"; isConsonant = true; break;
            case '\u0924': val = "t"; isConsonant = true; break;
            case '\u0925': val = "th"; isConsonant = true; break;
            case '\u0926': val = "d"; isConsonant = true; break;
            case '\u0927': val = "dh"; isConsonant = true; break;
            case '\u0928': val = "n"; isConsonant = true; break;
            case '\u092A': val = "p"; isConsonant = true; break;
            case '\u092B': val = next == '\u093C' ? "f" : "ph"; isConsonant = true; break;
            case '\u092C': val = "b"; isConsonant = true; break;
            case '\u092D': val = "bh"; isConsonant = true; break;
            case '\u092E': val = "m"; isConsonant = true; break;
            case '\u092F': val = "y"; isConsonant = true; break;
            case '\u0930': val = "r"; isConsonant = true; break;
            case '\u0932': val = "l"; isConsonant = true; break;
            case '\u0933': val = "l"; isConsonant = true; break;
            case '\u0935': val = "v"; isConsonant = true; break;
            case '\u0936': val = "sh"; isConsonant = true; break;
            case '\u0937': val = "sh"; isConsonant = true; break;
            case '\u0938': val = "s"; isConsonant = true; break;
            case '\u0939': val = "h"; isConsonant = true; break;
            
            case '\u0958': val = "k"; isConsonant = true; break;
            case '\u0959': val = "kh"; isConsonant = true; break;
            case '\u095A': val = "g"; isConsonant = true; break;
            case '\u095B': val = "z"; isConsonant = true; break;
            case '\u095C': val = "r"; isConsonant = true; break;
            case '\u095D': val = "rh"; isConsonant = true; break;
            case '\u095E': val = "f"; isConsonant = true; break;

            case '\u093E': val = "aa"; break;
            case '\u093F': val = "i"; break; case '\u0940': val = "ee"; break;
            case '\u0941': val = "u"; break; case '\u0942': val = "oo"; break;
            case '\u0943': val = "ri"; break;
            case '\u0947': val = "e"; break; case '\u0948': val = "ai"; break;
            case '\u094B': val = "o"; break; case '\u094C': val = "au"; break;
            
            case '\u0902': 
            case '\u0901': 
                val = isLabial(next) ? "m" : "n";
                break;
            case '\u0903': val = "h"; break;
            case '\u093C': val = ""; break;
            case '\u094D': val = ""; break;
            
            default: 
                if (Character.isLetter(c)) {
                    val = "_";
                } else {
                    val = "";
                }
                break;
        }
        
        if (isConsonant && !hasVowelSignOrVirama(str, idx)) {
            boolean isEnd = true;
            for (int i = idx + 1; i < str.length(); i++) {
                char n = str.charAt(i);
                if (n == '\u093C' || n == '\u200C' || n == '\u200D' || n == '\u0902' || n == '\u0901' || n == '\u0903') continue;
                if ((n >= '\u0900' && n <= '\u097F') && Character.isLetter(n)) {
                    isEnd = false;
                    break;
                }
                break;
            }
            if (!isEnd) {
                val += "a";
            } else {
                // In Hindi, final consonant retains 'a' if preceded by a virama (consonant cluster)
                if (idx > 0 && str.charAt(idx - 1) == '\u094D') {
                    val += "a";
                }
            }
        }
        return val;
    }

    private static String teluguToLatin(char c, int idx, String str) {
        char next = (idx + 1 < str.length()) ? str.charAt(idx + 1) : 0;
        String val = "";
        boolean isConsonant = false;
        switch (c) {
            case '\u0C05': val = "a"; break; case '\u0C06': val = "aa"; break;
            case '\u0C07': val = "i"; break; case '\u0C08': val = "ee"; break;
            case '\u0C09': val = "u"; break; case '\u0C0A': val = "oo"; break;
            case '\u0C0E': val = "e"; break; case '\u0C0F': val = "e"; break;
            case '\u0C10': val = "ai"; break; case '\u0C12': val = "o"; break;
            case '\u0C13': val = "o"; break; case '\u0C14': val = "au"; break;
            case '\u0C0B': val = "ri"; break;
            
            case '\u0C15': val = "k"; isConsonant = true; break;
            case '\u0C16': val = "kh"; isConsonant = true; break;
            case '\u0C17': val = "g"; isConsonant = true; break;
            case '\u0C18': val = "gh"; isConsonant = true; break;
            case '\u0C1A': val = "ch"; isConsonant = true; break;
            case '\u0C1B': val = "chh"; isConsonant = true; break;
            case '\u0C1C': val = "j"; isConsonant = true; break;
            case '\u0C1D': val = "jh"; isConsonant = true; break;
            case '\u0C1F': val = "t"; isConsonant = true; break;
            case '\u0C20': val = "th"; isConsonant = true; break;
            case '\u0C21': val = "d"; isConsonant = true; break;
            case '\u0C22': val = "dh"; isConsonant = true; break;
            case '\u0C23': val = "n"; isConsonant = true; break;
            case '\u0C24': val = "t"; isConsonant = true; break;
            case '\u0C25': val = "th"; isConsonant = true; break;
            case '\u0C26': val = "d"; isConsonant = true; break;
            case '\u0C27': val = "dh"; isConsonant = true; break;
            case '\u0C28': val = "n"; isConsonant = true; break;
            case '\u0C2A': val = "p"; isConsonant = true; break;
            case '\u0C2B': val = "ph"; isConsonant = true; break;
            case '\u0C2C': val = "b"; isConsonant = true; break;
            case '\u0C2D': val = "bh"; isConsonant = true; break;
            case '\u0C2E': val = "m"; isConsonant = true; break;
            case '\u0C2F': val = "y"; isConsonant = true; break;
            case '\u0C30': val = "r"; isConsonant = true; break;
            case '\u0C31': val = "r"; isConsonant = true; break;
            case '\u0C32': val = "l"; isConsonant = true; break;
            case '\u0C33': val = "l"; isConsonant = true; break;
            case '\u0C35': val = "v"; isConsonant = true; break;
            case '\u0C36': val = "sh"; isConsonant = true; break;
            case '\u0C37': val = "sh"; isConsonant = true; break;
            case '\u0C38': val = "s"; isConsonant = true; break;
            case '\u0C39': val = "h"; isConsonant = true; break;
            
            case '\u0C3E': val = "aa"; break;
            case '\u0C3F': val = "i"; break; case '\u0C40': val = "ee"; break;
            case '\u0C41': val = "u"; break; case '\u0C42': val = "oo"; break;
            case '\u0C43': val = "ri"; break;
            case '\u0C46': val = "e"; break; case '\u0C47': val = "e"; break;
            case '\u0C48': val = "ai"; break; case '\u0C4A': val = "o"; break;
            case '\u0C4B': val = "o"; break; case '\u0C4C': val = "au"; break;
            
            case '\u0C02': 
            case '\u0C01': 
                val = isLabial(next) ? "m" : "n";
                break;
            case '\u0C03': val = "h"; break;
            case '\u0C4D': val = ""; break;
            
            default:
                if (Character.isLetter(c)) {
                    val = "_";
                } else {
                    val = "";
                }
                break;
        }
        
        if (isConsonant && !hasVowelSignOrVirama(str, idx)) {
            val += "a";
        }
        return val;
    }
}
