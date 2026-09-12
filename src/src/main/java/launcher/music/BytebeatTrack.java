package launcher.music;

import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioInputStream;
import java.io.ByteArrayInputStream;

public final class BytebeatTrack {
    private static final float SAMPLE_RATE = 44_100f;

    private BytebeatTrack() {}

    public static AudioInputStream create(String expressionSeed) {
        byte[] pcm = new byte[(int) SAMPLE_RATE * 16];
        int seed = Math.abs(expressionSeed.hashCode());
        for (int t = 0; t < pcm.length; t++) {
            int sample = switch (seed % 4) {
                case 0 -> (t * ((t >> 9 | t >> 13) & 25 & t >> 6));
                case 1 -> ((t * 5 & t >> 7) | (t * 3 & t >> 10));
                case 2 -> ((t >> 4) | (t * 9 & t >> 7) | (t * 3 & t >> 10));
                default -> ((t * (t >> 5 | t >> 8)) >> (t >> 16));
            };
            pcm[t] = (byte) (sample & 0x7F);
        }
        AudioFormat format = new AudioFormat(SAMPLE_RATE, 8, 1, false, false);
        return new AudioInputStream(new ByteArrayInputStream(pcm), format, pcm.length);
    }
}
