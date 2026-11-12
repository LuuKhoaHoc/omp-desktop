//! Shared-mic capture loop with 16 kHz resampling, Silero VAD gating, and
//! pause-based segment commits.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use super::audio::{
    Resampler, MAX_SEGMENT_SAMPLES, MAX_SESSION_SAMPLES, TARGET_SAMPLE_RATE, VAD_CHUNK_SAMPLES,
};
use super::config::LocalSttConfig;
use super::worker::Worker;
use super::{emit_state, EndEvent, LocalSttManager, TranscriptEvent, EVENT_END, EVENT_TRANSCRIPT};

/// Silero VAD frame probability threshold to count as active speech.
const VAD_SPEECH_THRESHOLD: f32 = 0.5;
/// Silence window after a natural phrase to commit an interim segment.
const SEGMENT_PAUSE: Duration = Duration::from_millis(850);
/// Minimum speech audio before committing an interim pause segment (~1.2 s).
const MIN_INTERIM_SAMPLES: usize = (TARGET_SAMPLE_RATE as usize * 12) / 10;

#[derive(Default)]
pub struct AudioQueue {
    pub samples: VecDeque<f32>,
    pub sample_rate: u32,
    pub closed: bool,
}

pub struct CaptureControl {
    pub capture_id: String,
    pub stop_flag: Arc<AtomicBool>,
    pub cancel_flag: Arc<AtomicBool>,
    pub queue: Arc<(Mutex<AudioQueue>, Condvar)>,
    pub committed: Mutex<String>,
    pub thread: Mutex<Option<JoinHandle<()>>>,
}

struct CaptureState<'a> {
    ctrl: &'a CaptureControl,
    worker: &'a Worker,
    resampler: Option<(u32, Resampler)>,
    vad_buf: Vec<f32>,
    seg_pcm: Vec<f32>,
    total_samples: usize,
    speech_seen: bool,
    last_speech_at: Option<Instant>,
    segment_has_speech: bool,
    auto_stopped: bool,
    fatal_error: Option<String>,
}

impl<'a> CaptureState<'a> {
    fn new(ctrl: &'a CaptureControl, worker: &'a Worker) -> Self {
        Self {
            ctrl,
            worker,
            resampler: None,
            vad_buf: Vec::with_capacity(VAD_CHUNK_SAMPLES * 2),
            seg_pcm: Vec::with_capacity(TARGET_SAMPLE_RATE as usize * 15),
            total_samples: 0,
            speech_seen: false,
            last_speech_at: None,
            segment_has_speech: false,
            auto_stopped: false,
            fatal_error: None,
        }
    }

    fn drain_queue(&mut self, local_in: &mut Vec<f32>, auto_stop: Option<Duration>) -> (u32, bool) {
        let (lock, cv) = &*self.ctrl.queue;
        let mut q = lock.lock().unwrap_or_else(PoisonError::into_inner);
        while q.samples.is_empty() && !q.closed && !self.ctrl.stop_flag.load(Ordering::SeqCst) {
            let (next_q, _) = cv
                .wait_timeout(q, Duration::from_millis(60))
                .unwrap_or_else(PoisonError::into_inner);
            q = next_q;
            if check_auto_stop(self.speech_seen, self.last_speech_at, auto_stop) {
                self.auto_stopped = true;
                self.ctrl.stop_flag.store(true, Ordering::SeqCst);
                break;
            }
        }
        let rate = q.sample_rate;
        let closed = q.closed;
        local_in.extend(q.samples.drain(..));
        drop(q);
        (rate, closed)
    }

    fn feed_audio(&mut self, samples: &[f32], rate: u32) {
        if samples.is_empty() || rate == 0 {
            return;
        }
        let rs = match &mut self.resampler {
            Some((r, existing)) if *r == rate => existing,
            slot => {
                let inserted = slot.insert((rate, Resampler::new(rate)));
                &mut inserted.1
            }
        };
        let before = self.seg_pcm.len();
        rs.push(samples, &mut self.seg_pcm);
        let added = self.seg_pcm.len().saturating_sub(before);
        self.total_samples += added;
        self.vad_buf.extend_from_slice(&self.seg_pcm[before..]);

        while self.vad_buf.len() >= VAD_CHUNK_SAMPLES {
            let chunk: Vec<f32> = self.vad_buf.drain(..VAD_CHUNK_SAMPLES).collect();
            match self.worker.vad_feed(&chunk) {
                Ok(probs) => {
                    if probs.iter().any(|&p| p >= VAD_SPEECH_THRESHOLD) {
                        self.speech_seen = true;
                        self.segment_has_speech = true;
                        self.last_speech_at = Some(Instant::now());
                    }
                }
                Err(e) => {
                    self.fatal_error = Some(e);
                    self.ctrl.stop_flag.store(true, Ordering::SeqCst);
                    break;
                }
            }
        }
    }
}

pub fn run(
    mgr: &LocalSttManager,
    app: &AppHandle,
    ctrl: &CaptureControl,
    worker: &Arc<Worker>,
    cfg: &LocalSttConfig,
    auto_stop: Option<Duration>,
) {
    let mut st = CaptureState::new(ctrl, worker);
    let mut local_in = Vec::with_capacity(4096);

    loop {
        local_in.clear();
        let (rate, closed) = st.drain_queue(&mut local_in, auto_stop);
        if ctrl.cancel_flag.load(Ordering::SeqCst) {
            break;
        }
        st.feed_audio(&local_in, rate);

        if check_auto_stop(st.speech_seen, st.last_speech_at, auto_stop) {
            st.auto_stopped = true;
            ctrl.stop_flag.store(true, Ordering::SeqCst);
        }
        if ctrl.stop_flag.load(Ordering::SeqCst)
            || closed
            || st.total_samples >= MAX_SESSION_SAMPLES
        {
            break;
        }

        let natural_pause = st.segment_has_speech
            && st.seg_pcm.len() >= MIN_INTERIM_SAMPLES
            && st
                .last_speech_at
                .is_some_and(|t| t.elapsed() >= SEGMENT_PAUSE);
        if natural_pause || st.seg_pcm.len() >= MAX_SEGMENT_SAMPLES {
            let chunk = std::mem::take(&mut st.seg_pcm);
            st.segment_has_speech = false;
            if let Err(e) = transcribe_and_append(app, ctrl, worker, cfg, &chunk) {
                st.fatal_error = Some(e);
                break;
            }
        }
    }

    mgr.clear_active_if(&ctrl.capture_id);
    mgr.spectrum.clear_pcm_tap();

    if ctrl.cancel_flag.load(Ordering::SeqCst) {
        let _ = app.emit(
            EVENT_END,
            EndEvent {
                capture_id: ctrl.capture_id.clone(),
                text: String::new(),
                error: None,
                auto_stopped: false,
            },
        );
        return;
    }

    if st.fatal_error.is_none() && st.segment_has_speech && !st.seg_pcm.is_empty() {
        emit_state(app, &ctrl.capture_id, "transcribing");
        if let Err(e) = transcribe_and_append(app, ctrl, worker, cfg, &st.seg_pcm) {
            st.fatal_error = Some(e);
        }
    }

    let final_text = ctrl
        .committed
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone();
    let _ = app.emit(
        EVENT_END,
        EndEvent {
            capture_id: ctrl.capture_id.clone(),
            text: final_text,
            error: st.fatal_error,
            auto_stopped: st.auto_stopped,
        },
    );
}

fn check_auto_stop(
    speech_seen: bool,
    last_speech_at: Option<Instant>,
    auto_stop: Option<Duration>,
) -> bool {
    if !speech_seen {
        return false;
    }
    let Some(limit) = auto_stop else {
        return false;
    };
    last_speech_at.is_some_and(|t| t.elapsed() >= limit)
}

fn transcribe_and_append(
    app: &AppHandle,
    ctrl: &CaptureControl,
    worker: &Worker,
    cfg: &LocalSttConfig,
    pcm: &[f32],
) -> Result<(), String> {
    let lang = (!cfg.language.is_empty()).then_some(cfg.language.as_str());
    let prompt = (!cfg.context_prompt.is_empty()).then_some(cfg.context_prompt.as_str());
    let piece = worker.transcribe(pcm, lang, &cfg.vocabulary, prompt)?;
    let piece = piece.trim();
    if piece.is_empty() {
        return Ok(());
    }
    let full = {
        let mut committed = ctrl
            .committed
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if !committed.is_empty() {
            committed.push(' ');
        }
        committed.push_str(piece);
        committed.clone()
    };
    let _ = app.emit(
        EVENT_TRANSCRIPT,
        TranscriptEvent {
            capture_id: &ctrl.capture_id,
            text: &full,
        },
    );
    Ok(())
}
