//! The default microphone, read on a thread of its own: the cpal stream
//! fills a [`Ring`] and an optional PCM tap buffer, and the same thread turns
//! the ring into equalizer bands every [`FRAME`] and forwards raw mono frames to
//! any active PCM tap (e.g. local STT). The stream is created and dropped on
//! that thread, so its platform handle never crosses threads.

use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample, Stream, StreamConfig};

use super::analysis::{Analyzer, Ring};

/// About 30 frames a second; the composer smooths between them.
const FRAME: Duration = Duration::from_millis(33);
/// How long a backend may take to open the device.
const OPEN_TIMEOUT: Duration = Duration::from_secs(5);

pub type SpectrumEmit = Arc<dyn Fn(&[u8]) + Send + Sync>;
pub type PcmTap = Arc<dyn Fn(&[f32], u32) + Send + Sync>;

enum Control {
    SetSpectrum(Option<(usize, SpectrumEmit)>),
    SetTap(Option<PcmTap>),
    Stop,
}

struct SharedAudio {
    ring: Ring,
    pcm: Vec<f32>,
    record_pcm: bool,
}

/// A running capture; dropping it stops the stream and joins the thread.
pub struct Capture {
    ctrl: mpsc::Sender<Control>,
    thread: Option<JoinHandle<()>>,
}

impl Capture {
    /// Opens the default input device and runs until dropped. Fails when there
    /// is no microphone or it cannot be opened.
    pub fn start(
        spectrum: Option<(usize, SpectrumEmit)>,
        tap: Option<PcmTap>,
    ) -> Result<Self, String> {
        let (ctrl, ctrl_rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let initial_record = tap.is_some();
        let thread = std::thread::Builder::new()
            .name("voice-spectrum".into())
            .spawn(move || {
                let (stream, shared, rate) = match open(initial_record) {
                    Ok(opened) => opened,
                    Err(e) => {
                        let _ = ready_tx.send(Err(e)); // the starter waits for exactly this
                        return;
                    }
                };
                let _ = ready_tx.send(Ok(()));
                run(&shared, rate, spectrum, tap, &ctrl_rx);
                drop(stream);
            })
            .map_err(|e| format!("could not start the voice spectrum thread: {e}"))?;
        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Self {
                ctrl,
                thread: Some(thread),
            }),
            Ok(Err(e)) => {
                let _ = thread.join();
                Err(e)
            }
            Err(_) => {
                let _ = thread.join();
                Err("the voice spectrum thread ended while opening the microphone".into())
            }
        }
    }

    pub fn set_spectrum(&self, next: Option<(usize, SpectrumEmit)>) -> Result<(), String> {
        self.ctrl
            .send(Control::SetSpectrum(next))
            .map_err(|_| "microphone capture thread ended".to_string())
    }

    pub fn set_tap(&self, next: Option<PcmTap>) -> Result<(), String> {
        self.ctrl
            .send(Control::SetTap(next))
            .map_err(|_| "microphone capture thread ended".to_string())
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        let _ = self.ctrl.send(Control::Stop);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Analyse and emit until told to stop (or the owner is gone).
fn run(
    shared: &Mutex<SharedAudio>,
    rate: u32,
    mut spectrum: Option<(usize, SpectrumEmit)>,
    mut tap: Option<PcmTap>,
    ctrl: &mpsc::Receiver<Control>,
) {
    let mut analyzer = spectrum
        .as_ref()
        .map(|(bands, _)| Analyzer::new(rate, *bands));
    let mut pcm_scratch = Vec::with_capacity(8192);
    loop {
        match ctrl.recv_timeout(FRAME) {
            Ok(msg) => {
                if !handle_control(msg, rate, &mut spectrum, &mut analyzer, &mut tap, shared) {
                    return;
                }
                while let Ok(more) = ctrl.try_recv() {
                    if !handle_control(more, rate, &mut spectrum, &mut analyzer, &mut tap, shared) {
                        return;
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }

        pcm_scratch.clear();
        {
            let mut audio = shared.lock().unwrap_or_else(PoisonError::into_inner);
            if let Some(an) = analyzer.as_mut() {
                an.load(&audio.ring);
            }
            if tap.is_some() && !audio.pcm.is_empty() {
                std::mem::swap(&mut pcm_scratch, &mut audio.pcm);
            } else {
                audio.pcm.clear();
            }
            audio.record_pcm = tap.is_some();
        }

        if let Some(sink) = &tap {
            if !pcm_scratch.is_empty() {
                sink(&pcm_scratch, rate);
            }
        }
        if let (Some((_, emit)), Some(an)) = (&spectrum, &mut analyzer) {
            emit(an.levels());
        }
    }
}

fn handle_control(
    msg: Control,
    rate: u32,
    spectrum: &mut Option<(usize, SpectrumEmit)>,
    analyzer: &mut Option<Analyzer>,
    tap: &mut Option<PcmTap>,
    shared: &Mutex<SharedAudio>,
) -> bool {
    match msg {
        Control::SetSpectrum(next) => {
            *analyzer = next.as_ref().map(|(bands, _)| Analyzer::new(rate, *bands));
            *spectrum = next;
            true
        }
        Control::SetTap(next) => {
            let mut audio = shared.lock().unwrap_or_else(PoisonError::into_inner);
            audio.record_pcm = next.is_some();
            if next.is_none() {
                audio.pcm.clear();
            }
            drop(audio);
            *tap = next;
            true
        }
        Control::Stop => false,
    }
}

type Opened = (Stream, Arc<Mutex<SharedAudio>>, u32);

fn open(record_pcm: bool) -> Result<Opened, String> {
    let device = cpal::default_host()
        .default_input_device()
        .ok_or("no microphone found")?;
    let supported = device
        .default_input_config()
        .map_err(|e| format!("could not read the microphone's format: {e}"))?;
    let config = supported.config();
    let shared = Arc::new(Mutex::new(SharedAudio {
        ring: Ring::new(),
        pcm: Vec::with_capacity(8192),
        record_pcm,
    }));
    let stream = match supported.sample_format() {
        SampleFormat::F32 => build::<f32>(&device, config, &shared),
        SampleFormat::F64 => build::<f64>(&device, config, &shared),
        SampleFormat::I8 => build::<i8>(&device, config, &shared),
        SampleFormat::I16 => build::<i16>(&device, config, &shared),
        SampleFormat::I32 => build::<i32>(&device, config, &shared),
        SampleFormat::U8 => build::<u8>(&device, config, &shared),
        SampleFormat::U16 => build::<u16>(&device, config, &shared),
        SampleFormat::U32 => build::<u32>(&device, config, &shared),
        other => return Err(format!("unsupported microphone sample format {other}")),
    }?;
    stream
        .play()
        .map_err(|e| format!("could not start the microphone: {e}"))?;
    Ok((stream, shared, config.sample_rate))
}

fn build<T>(
    device: &cpal::Device,
    config: StreamConfig,
    shared: &Arc<Mutex<SharedAudio>>,
) -> Result<Stream, String>
where
    T: SizedSample + Send + 'static,
    f32: FromSample<T>,
{
    let channels = usize::from(config.channels);
    let shared = Arc::clone(shared); // the audio callback owns one handle
    device
        .build_input_stream::<T, _, _>(
            config,
            move |data: &[T], _| {
                let mut audio = shared.lock().unwrap_or_else(PoisonError::into_inner);
                let SharedAudio {
                    ring,
                    pcm,
                    record_pcm,
                } = &mut *audio;
                let tap = if *record_pcm { Some(pcm) } else { None };
                ring.push_interleaved_to(data, channels, tap);
                drop(audio);
            },
            |e| eprintln!("[omp-desktop] voice spectrum: microphone error: {e}"),
            Some(OPEN_TIMEOUT),
        )
        .map_err(|e| format!("could not open the microphone: {e}"))
}
