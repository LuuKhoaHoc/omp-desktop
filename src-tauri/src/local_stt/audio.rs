//! 16 kHz mono resampling and Silero VAD frame chunking.

/// Target sample rate expected by `transcribe.cpp` (Qwen3-ASR and Silero VAD).
pub const TARGET_SAMPLE_RATE: u32 = 16_000;
/// Silero VAD v6.2 scores 512-sample (32 ms) frames at 16 kHz; feeding 3
/// frames (96 ms) per IPC round-trip keeps overhead negligible.
pub const VAD_CHUNK_SAMPLES: usize = 1_536;
/// Upper bound on one buffered segment before forcing an incremental commit
/// (~25 seconds at 16 kHz), keeping memory and single-pass decode bounded.
pub const MAX_SEGMENT_SAMPLES: usize = 25 * TARGET_SAMPLE_RATE as usize;
/// Hard ceiling on total captured audio in one dictation session (5 minutes).
pub const MAX_SESSION_SAMPLES: usize = 5 * 60 * TARGET_SAMPLE_RATE as usize;

/// Anti-aliased linear/tent resampler from `in_rate` Hz mono `f32` to 16 kHz.
pub struct Resampler {
    in_rate: u32,
    step: f64,
    pos: f64,
    carry: Vec<f32>,
}

impl Resampler {
    #[must_use]
    pub fn new(in_rate: u32) -> Self {
        let safe_rate = in_rate.max(1);
        Self {
            in_rate: safe_rate,
            step: f64::from(safe_rate) / f64::from(TARGET_SAMPLE_RATE),
            pos: 0.0,
            carry: Vec::new(),
        }
    }

    /// Feeds mono `f32` samples at `in_rate` and appends resampled 16 kHz
    /// samples into `out`.
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_precision_loss,
        clippy::cast_sign_loss,
        clippy::while_float
    )]
    pub fn push(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if input.is_empty() {
            return;
        }
        if self.in_rate == TARGET_SAMPLE_RATE {
            out.extend_from_slice(input);
            return;
        }
        self.carry.extend_from_slice(input);
        let half = self.step.max(1.0);
        let len = self.carry.len();
        while self.pos + half < len as f64 {
            let lo = (self.pos - half).ceil().max(0.0) as usize;
            let hi = ((self.pos + half).floor() as usize).min(len - 1);
            let mut sum = 0.0_f64;
            let mut wsum = 0.0_f64;
            for (idx, &sample) in self.carry[lo..=hi].iter().enumerate() {
                let x = (lo + idx) as f64;
                let w = 1.0 - (x - self.pos).abs() / half;
                if w > 0.0 {
                    sum = f64::mul_add(f64::from(sample), w, sum);
                    wsum += w;
                }
            }
            out.push(if wsum > 0.0 { (sum / wsum) as f32 } else { 0.0 });
            self.pos += self.step;
        }
        let drop_before = (self.pos - half).floor().max(0.0) as usize;
        if drop_before > 0 && drop_before <= self.carry.len() {
            self.carry.drain(..drop_before);
            self.pos -= drop_before as f64;
        }
    }
}

/// Encodes `f32` PCM samples as little-endian bytes for base64 worker transport.
#[must_use]
pub fn encode_f32_le(samples: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(std::mem::size_of_val(samples));
    for &sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passthrough_at_16khz_preserves_samples_exactly() {
        let mut resampler = Resampler::new(16_000);
        let input = [0.1_f32, -0.2, 0.3, 0.4];
        let mut out = Vec::new();
        resampler.push(&input, &mut out);
        assert_eq!(out, input);
    }

    #[test]
    fn downsampling_48khz_to_16khz_matches_expected_duration_and_dc() {
        let mut resampler = Resampler::new(48_000);
        let mut out = Vec::new();
        // 1 second of 48 kHz audio in 10 ms chunks.
        let chunk = vec![0.5_f32; 480];
        for _ in 0..100 {
            resampler.push(&chunk, &mut out);
        }
        // ~16000 samples (minus the final 1-sample half-window).
        assert!((15_990..=16_005).contains(&out.len()), "len={}", out.len());
        for &sample in &out {
            assert!((sample - 0.5).abs() < 1e-5, "sample={sample}");
        }
    }

    #[test]
    fn downsampling_44100_to_16khz_preserves_low_frequency_sine() {
        let mut resampler = Resampler::new(44_100);
        let mut out = Vec::new();
        let freq = 200.0_f64;
        let input: Vec<f32> = (0..44_100)
            .map(|i| {
                #[allow(clippy::cast_possible_truncation)]
                let s = (2.0 * std::f64::consts::PI * freq * f64::from(i) / 44_100.0).sin() as f32;
                s
            })
            .collect();
        resampler.push(&input, &mut out);
        assert!((15_980..=16_005).contains(&out.len()), "len={}", out.len());
        // Verify peak amplitude of 200 Hz stays close to 1.0 after anti-alias filter.
        let peak = out.iter().copied().fold(0.0_f32, |a, b| a.max(b.abs()));
        assert!(peak > 0.9, "peak={peak}");
    }

    #[test]
    fn encode_f32_le_writes_four_bytes_per_sample() {
        let encoded = encode_f32_le(&[1.0, -0.5]);
        assert_eq!(encoded.len(), 8);
        assert_eq!(
            f32::from_le_bytes(encoded[0..4].try_into().expect("4 bytes")),
            1.0
        );
        assert_eq!(
            f32::from_le_bytes(encoded[4..8].try_into().expect("4 bytes")),
            -0.5
        );
    }
}
