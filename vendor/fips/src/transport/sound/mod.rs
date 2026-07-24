//! Codec-neutral complete-packet transport for the local sound bridge.
//!
//! FIPS sees only bounded opaque packets. Audio, modulation, retries and
//! browser implementation details deliberately stay outside this module.

use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

use futures::{SinkExt, StreamExt};
use serde_json::json;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use tokio_tungstenite::tungstenite::{
    client::IntoClientRequest,
    http::{header::ORIGIN, HeaderValue},
    Message,
};

use crate::config::SoundConfig;
use crate::transport::{
    ConnectionState, DiscoveredPeer, PacketTx, ReceivedPacket, Transport, TransportAddr,
    TransportError, TransportId, TransportState, TransportType,
};

const FWAV_HEADER_BYTES: usize = 32;
const FWAV_TYPE_FIPS_PACKET: u8 = 9;
const FWAV_TYPE_RESET: u8 = 8;
const FWAV_TYPE_BROWSER_ARM: u8 = 10;
const FWAV_TYPE_BROWSER_DISARM: u8 = 11;
const RECONNECT_INITIAL_DELAY: Duration = Duration::from_millis(100);
const RECONNECT_MAX_DELAY: Duration = Duration::from_secs(1);

#[derive(Clone, Debug, Default)]
struct SoundCounters {
    tx_packets: u64,
    tx_bytes: u64,
    rx_packets: u64,
    rx_bytes: u64,
    rejected: u64,
    overflowed: u64,
    disconnects: u64,
}

struct Runtime {
    state: TransportState,
    browser_ready: bool,
    epoch: u32,
    next_sequence: u64,
    highest_received_sequence: Option<u64>,
    sender: Option<mpsc::Sender<OutboundFrame>>,
    last_error: Option<&'static str>,
    counters: SoundCounters,
}

struct OutboundFrame {
    bytes: Vec<u8>,
    enqueued_at: Instant,
}

impl Default for Runtime {
    fn default() -> Self {
        Self {
            state: TransportState::Configured,
            browser_ready: false,
            epoch: 1,
            next_sequence: 0,
            highest_received_sequence: None,
            sender: None,
            last_error: None,
            counters: SoundCounters::default(),
        }
    }
}

/// Owned local WebSocket worker and complete-packet FIPS transport.
pub struct SoundTransport {
    transport_id: TransportId,
    name: Option<String>,
    config: SoundConfig,
    packet_tx: PacketTx,
    runtime: Arc<Mutex<Runtime>>,
    outbound_bytes: Arc<AtomicUsize>,
    stop: Option<oneshot::Sender<()>>,
    worker: Option<JoinHandle<()>>,
}

impl SoundTransport {
    pub fn new(
        transport_id: TransportId,
        name: Option<String>,
        config: SoundConfig,
        packet_tx: PacketTx,
    ) -> Result<Self, TransportError> {
        config.validate().map_err(TransportError::InvalidAddress)?;
        Ok(Self {
            transport_id,
            name,
            config,
            packet_tx,
            runtime: Arc::new(Mutex::new(Runtime::default())),
            outbound_bytes: Arc::new(AtomicUsize::new(0)),
            stop: None,
            worker: None,
        })
    }

    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }
    pub fn browser_ready(&self) -> bool {
        self.runtime.lock().expect("sound runtime").browser_ready
    }
    pub fn configured_peer(&self) -> TransportAddr {
        TransportAddr::from(self.config.peer_addr.clone())
    }

    /// Arms only the current bridge epoch. This is deliberately separate from
    /// the worker lifecycle: a local WebSocket being Up is not a peer claim.
    pub fn arm_browser(&self, epoch: u32) -> Result<(), TransportError> {
        let mut runtime = self.runtime.lock().expect("sound runtime");
        if runtime.state != TransportState::Up || runtime.epoch != epoch {
            runtime.counters.rejected += 1;
            runtime.last_error = Some("sound_browser_epoch_invalid");
            return Err(TransportError::SendFailed(
                "sound browser is not armed".into(),
            ));
        }
        runtime.browser_ready = true;
        Ok(())
    }

    pub async fn start_async(&mut self) -> Result<(), TransportError> {
        if !self.state().can_start() {
            return Err(TransportError::AlreadyStarted);
        }
        self.runtime.lock().expect("sound runtime").state = TransportState::Starting;
        let stream = connect_bridge(&self.config.bridge_url)
            .await
            .map_err(|code| self.start_failed(code))?;
        let (stop_tx, mut stop_rx) = oneshot::channel();
        let runtime = Arc::clone(&self.runtime);
        let outbound_bytes = Arc::clone(&self.outbound_bytes);
        let packet_tx = self.packet_tx.clone();
        let transport_id = self.transport_id;
        let peer = self.configured_peer();
        let mtu = self.config.mtu();
        let queue_max_age = Duration::from_millis(self.config.queue_max_age_ms());
        let queue_items = self.config.queue_items();
        let bridge_url = self.config.bridge_url.clone();
        self.worker = Some(tokio::spawn(async move {
            let mut next_stream = Some(stream);
            'supervisor: loop {
                let stream = next_stream.take().expect("sound supervisor stream");
                let (mut writer, mut reader) = stream.split();
                let (outbound_tx, mut outbound_rx) = mpsc::channel(queue_items);
                {
                    let mut current = runtime.lock().expect("sound runtime");
                    current.state = TransportState::Up;
                    current.sender = Some(outbound_tx);
                    // A browser must explicitly arm every socket generation.
                    // Queue contents never survive a local bridge disconnect,
                    // but same-epoch sequence watermarks do: resetting either
                    // would permit replay against the replacement socket.
                    current.browser_ready = false;
                    current.last_error = None;
                }
                let disconnected = loop {
                    tokio::select! {
                        _ = &mut stop_rx => break false,
                        outbound = outbound_rx.recv() => match outbound {
                            Some(frame) => {
                                outbound_bytes.fetch_sub(frame.bytes.len(), Ordering::AcqRel);
                                if outbound_expired(frame.enqueued_at, queue_max_age) {
                                    reject(&runtime, "sound_queue_item_expired");
                                } else if writer.send(Message::Binary(frame.bytes.into())).await.is_err() {
                                    break true;
                                }
                            }
                            None => break true,
                        },
                        inbound = reader.next() => match inbound {
                            Some(Ok(Message::Binary(bytes))) => {
                                let prior_epoch = runtime.lock().expect("sound runtime").epoch;
                                let accepted = inject_inbound(&runtime, &packet_tx, transport_id, &peer, mtu, &bytes).await;
                                if accepted.is_ok() && runtime.lock().expect("sound runtime").epoch != prior_epoch {
                                    while let Ok(expired) = outbound_rx.try_recv() {
                                        outbound_bytes.fetch_sub(expired.bytes.len(), Ordering::AcqRel);
                                    }
                                }
                            }
                            Some(Ok(_)) => reject(&runtime, "sound_binary_frame_required"),
                            Some(Err(_)) | None => break true,
                        },
                    }
                };
                if !disconnected { break 'supervisor; }
                {
                    let mut current = runtime.lock().expect("sound runtime");
                    current.counters.disconnects += 1;
                    current.sender = None;
                    current.browser_ready = false;
                    current.state = TransportState::Starting;
                    current.last_error = Some("sound_bridge_disconnected");
                }
                // Dropping this receiver releases every unsent frame. Every
                // reconnect starts with zero reserved bytes and a fresh queue.
                drop(outbound_rx);
                outbound_bytes.store(0, Ordering::Release);

                let mut delay = RECONNECT_INITIAL_DELAY;
                loop {
                    tokio::select! {
                        _ = &mut stop_rx => break 'supervisor,
                        attempt = connect_bridge(&bridge_url) => match attempt {
                            Ok(next) => { next_stream = Some(next); break; }
                            Err(_) => {
                                let mut current = runtime.lock().expect("sound runtime");
                                current.last_error = Some("sound_bridge_reconnecting");
                            }
                        },
                    }
                    tokio::select! {
                        _ = &mut stop_rx => break 'supervisor,
                        _ = tokio::time::sleep(delay) => {},
                    }
                    delay = std::cmp::min(delay.saturating_mul(2), RECONNECT_MAX_DELAY);
                }
            }
            let mut current = runtime.lock().expect("sound runtime");
            current.sender = None;
            if current.state == TransportState::Up {
                current.state = TransportState::Down;
            }
            outbound_bytes.store(0, Ordering::Release);
        }));
        self.stop = Some(stop_tx);
        Ok(())
    }

    pub async fn stop_async(&mut self) -> Result<(), TransportError> {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.await;
        }
        let mut runtime = self.runtime.lock().expect("sound runtime");
        runtime.sender = None;
        runtime.browser_ready = false;
        runtime.state = TransportState::Down;
        self.outbound_bytes.store(0, Ordering::Release);
        Ok(())
    }

    pub async fn send_async(
        &self,
        addr: &TransportAddr,
        data: &[u8],
    ) -> Result<usize, TransportError> {
        if addr != &self.configured_peer() {
            return Err(TransportError::InvalidAddress(
                "sound peer is not configured".into(),
            ));
        }
        if data.len() > self.config.mtu() as usize {
            return Err(TransportError::MtuExceeded {
                packet_size: data.len(),
                mtu: self.config.mtu(),
            });
        }
        let (sender, frame) = {
            let mut runtime = self.runtime.lock().expect("sound runtime");
            if runtime.state != TransportState::Up {
                return Err(TransportError::NotStarted);
            }
            if !runtime.browser_ready {
                runtime.counters.rejected += 1;
                runtime.last_error = Some("sound_browser_not_armed");
                return Err(TransportError::SendFailed(
                    "sound browser is not armed".into(),
                ));
            }
            let Some(sender) = runtime.sender.clone() else {
                runtime.counters.rejected += 1;
                runtime.last_error = Some("sound_bridge_disconnected");
                return Err(TransportError::SendFailed(
                    "sound bridge is disconnected".into(),
                ));
            };
            runtime.next_sequence = runtime.next_sequence.wrapping_add(1);
            (
                sender,
                encode_packet(runtime.epoch, runtime.next_sequence, data),
            )
        };
        let frame_bytes = frame.len();
        if !reserve_bytes(&self.outbound_bytes, self.config.queue_bytes(), frame_bytes) {
            let mut runtime = self.runtime.lock().expect("sound runtime");
            runtime.counters.overflowed += 1;
            runtime.last_error = Some("sound_queue_byte_budget_exceeded");
            return Err(TransportError::SendFailed("sound queue byte budget is full".into()));
        }
        sender.try_send(OutboundFrame { bytes: frame, enqueued_at: Instant::now() }).map_err(|_| {
            self.outbound_bytes.fetch_sub(frame_bytes, Ordering::AcqRel);
            let mut runtime = self.runtime.lock().expect("sound runtime");
            runtime.counters.overflowed += 1;
            runtime.last_error = Some("sound_queue_full");
            TransportError::SendFailed("sound queue is full".into())
        })?;
        let mut runtime = self.runtime.lock().expect("sound runtime");
        runtime.counters.tx_packets += 1;
        runtime.counters.tx_bytes += data.len() as u64;
        Ok(data.len())
    }

    pub fn transport_stats(&self) -> serde_json::Value {
        let runtime = self.runtime.lock().expect("sound runtime");
        json!({
            "browser_ready": runtime.browser_ready,
            "epoch": runtime.epoch,
            "tx_packets": runtime.counters.tx_packets,
            "tx_bytes": runtime.counters.tx_bytes,
            "rx_packets": runtime.counters.rx_packets,
            "rx_bytes": runtime.counters.rx_bytes,
            "rejected": runtime.counters.rejected,
            "overflowed": runtime.counters.overflowed,
            "disconnects": runtime.counters.disconnects,
            "last_error": runtime.last_error,
        })
    }

    fn start_failed(&self, code: &'static str) -> TransportError {
        let mut runtime = self.runtime.lock().expect("sound runtime");
        runtime.state = TransportState::Failed;
        runtime.last_error = Some(code);
        TransportError::StartFailed(code.into())
    }
}

async fn connect_bridge(
    bridge_url: &str,
) -> Result<WebSocketStream<MaybeTlsStream<TcpStream>>, &'static str> {
    let mut request = bridge_url
        .into_client_request()
        .map_err(|_| "sound_bridge_request_invalid")?;
    let authority = request
        .uri()
        .authority()
        .ok_or("sound_bridge_request_invalid")?;
    let origin = HeaderValue::from_str(&format!("http://{authority}"))
        .map_err(|_| "sound_bridge_request_invalid")?;
    request.headers_mut().insert(ORIGIN, origin);
    connect_async(request)
        .await
        .map(|(stream, _)| stream)
        .map_err(|_| "sound_bridge_connect_failed")
}

fn reserve_bytes(counter: &AtomicUsize, limit: usize, amount: usize) -> bool {
    loop {
        let current = counter.load(Ordering::Acquire);
        let Some(next) = current.checked_add(amount) else { return false };
        if next > limit {
            return false;
        }
        if counter
            .compare_exchange(current, next, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            return true;
        }
    }
}

fn outbound_expired(enqueued_at: Instant, max_age: Duration) -> bool {
    enqueued_at.elapsed() > max_age
}

fn reject(runtime: &Arc<Mutex<Runtime>>, code: &'static str) {
    let mut current = runtime.lock().expect("sound runtime");
    current.counters.rejected += 1;
    current.last_error = Some(code);
}

async fn inject_inbound(
    runtime: &Arc<Mutex<Runtime>>,
    packet_tx: &PacketTx,
    transport_id: TransportId,
    peer: &TransportAddr,
    mtu: u16,
    encoded: &[u8],
) -> Result<(), ()> {
    if encoded.len() < FWAV_HEADER_BYTES || &encoded[0..4] != b"FWAV" || encoded[4] != 1 {
        reject(runtime, "sound_frame_invalid");
        return Err(());
    }
    let kind = encoded[5];
    let payload_len = u32::from_le_bytes(encoded[8..12].try_into().expect("header")) as usize;
    let epoch = u32::from_le_bytes(encoded[12..16].try_into().expect("header"));
    let sequence = u64::from_le_bytes(encoded[16..24].try_into().expect("header"));
    if encoded.len() != FWAV_HEADER_BYTES + payload_len {
        reject(runtime, "sound_frame_length_invalid");
        return Err(());
    }
    // Sound accepts only the canonical packet envelope emitted by this module.
    // In particular, PCM metadata and extension flags are not meaningful at the
    // FIPS boundary and must never become an alternate parser surface.
    if encoded[6..8] != [0, 0]
        || encoded[24..28] != [0, 0, 0, 0]
        || encoded[28..30] != [0, 0]
        || encoded[30..32] != [0, 0]
    {
        reject(runtime, "sound_frame_noncanonical");
        return Err(());
    }
    if kind == FWAV_TYPE_RESET {
        let mut current = runtime.lock().expect("sound runtime");
        if payload_len != 0 || sequence != 0 || epoch <= current.epoch {
            current.counters.rejected += 1;
            current.last_error = Some("sound_reset_invalid");
            return Err(());
        }
        current.epoch = epoch;
        current.next_sequence = 0;
        current.highest_received_sequence = None;
        current.browser_ready = false;
        current.counters = SoundCounters::default();
        current.last_error = None;
        return Ok(());
    }
    if kind == FWAV_TYPE_BROWSER_ARM || kind == FWAV_TYPE_BROWSER_DISARM {
        let mut current = runtime.lock().expect("sound runtime");
        if payload_len != 0 || sequence != 0 || current.state != TransportState::Up || current.epoch != epoch {
            current.counters.rejected += 1;
            current.last_error = Some("sound_browser_control_invalid");
            return Err(());
        }
        current.browser_ready = kind == FWAV_TYPE_BROWSER_ARM;
        return Ok(());
    }
    if kind != FWAV_TYPE_FIPS_PACKET || payload_len > mtu as usize {
        reject(runtime, "sound_packet_invalid");
        return Err(());
    }
    let data = encoded[FWAV_HEADER_BYTES..].to_vec();
    let mut current = runtime.lock().expect("sound runtime");
    if current.state != TransportState::Up || !current.browser_ready || current.epoch != epoch {
        drop(current);
        reject(runtime, "sound_packet_not_armed");
        return Err(());
    }
    if current.highest_received_sequence.is_some_and(|highest| sequence <= highest) {
        current.counters.rejected += 1;
        current.last_error = Some("sound_packet_replay");
        return Err(());
    }
    if packet_tx.try_send(ReceivedPacket::new(
            transport_id,
            peer.clone(),
            data.clone(),
        )).is_err() {
        current.counters.rejected += 1;
        current.last_error = Some("sound_packet_channel_full");
        return Err(());
    }
    current.highest_received_sequence = Some(sequence);
    current.counters.rx_packets += 1;
    current.counters.rx_bytes += data.len() as u64;
    Ok(())
}

fn encode_packet(epoch: u32, sequence: u64, payload: &[u8]) -> Vec<u8> {
    let mut frame = vec![0; FWAV_HEADER_BYTES + payload.len()];
    frame[0..4].copy_from_slice(b"FWAV");
    frame[4] = 1;
    frame[5] = FWAV_TYPE_FIPS_PACKET;
    frame[8..12].copy_from_slice(&(payload.len() as u32).to_le_bytes());
    frame[12..16].copy_from_slice(&epoch.to_le_bytes());
    frame[16..24].copy_from_slice(&sequence.to_le_bytes());
    frame[FWAV_HEADER_BYTES..].copy_from_slice(payload);
    frame
}

impl Transport for SoundTransport {
    fn transport_id(&self) -> TransportId {
        self.transport_id
    }
    fn transport_type(&self) -> &TransportType {
        &TransportType::SOUND
    }
    fn state(&self) -> TransportState {
        self.runtime.lock().expect("sound runtime").state
    }
    fn mtu(&self) -> u16 {
        self.config.mtu()
    }
    fn start(&mut self) -> Result<(), TransportError> {
        Err(TransportError::NotSupported(
            "use start_async for sound".into(),
        ))
    }
    fn stop(&mut self) -> Result<(), TransportError> {
        Err(TransportError::NotSupported(
            "use stop_async for sound".into(),
        ))
    }
    fn send(&self, _addr: &TransportAddr, _data: &[u8]) -> Result<(), TransportError> {
        Err(TransportError::NotSupported(
            "use send_async for sound".into(),
        ))
    }
    fn discover(&self) -> Result<Vec<DiscoveredPeer>, TransportError> {
        Ok(Vec::new())
    }
    fn auto_connect(&self) -> bool {
        false
    }
    fn accept_connections(&self) -> bool {
        false
    }
}

impl SoundTransport {
    pub fn connection_state(&self, addr: &TransportAddr) -> ConnectionState {
        if addr != &self.configured_peer() {
            ConnectionState::Failed("sound peer is not configured".into())
        } else {
            let runtime = self.runtime.lock().expect("sound runtime");
            if runtime.state == TransportState::Up && runtime.browser_ready {
                ConnectionState::Connected
            } else if runtime.state == TransportState::Failed {
                ConnectionState::Failed(
                    runtime
                        .last_error
                        .unwrap_or("sound transport unavailable")
                        .into(),
                )
            } else {
                ConnectionState::Failed("sound browser is not armed".into())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::MIN_SOUND_MTU;
    use crate::transport::packet_channel;

    fn config() -> SoundConfig {
        SoundConfig {
            bridge_url: "ws://127.0.0.1:4310/bridge/fips".into(),
            peer_addr: "sound-a".into(),
            mtu: MIN_SOUND_MTU,
            queue_items: 2,
            queue_bytes: 4096,
            queue_max_age_ms: 5_000,
        }
    }

    #[tokio::test]
    async fn sound_transport_fails_closed_until_current_epoch_is_armed() {
        let (tx, _rx) = packet_channel(2);
        let sound = SoundTransport::new(TransportId::new(7), None, config(), tx).unwrap();
        assert_eq!(sound.mtu(), 1357);
        assert!(!sound.browser_ready());
        assert!(
            sound
                .send_async(&sound.configured_peer(), &[1; 1357])
                .await
                .is_err()
        );
        assert!(
            sound
                .send_async(&sound.configured_peer(), &[1; 1358])
                .await
                .is_err()
        );
        assert_eq!(sound.transport_stats()["browser_ready"], false);
    }

    #[tokio::test]
    async fn sound_injects_only_current_epoch_armed_packets_and_reset_invalidates_old_work() {
        let (tx, mut rx) = packet_channel(2);
        let sound = SoundTransport::new(TransportId::new(7), None, config(), tx).unwrap();
        {
            let mut runtime = sound.runtime.lock().unwrap();
            runtime.state = TransportState::Up;
            runtime.browser_ready = true;
        }
        let payload = vec![0x5a; 1357];
        let packet = encode_packet(1, 1, &payload);
        inject_inbound(
            &sound.runtime,
            &sound.packet_tx,
            sound.transport_id,
            &sound.configured_peer(),
            sound.mtu(),
            &packet,
        )
        .await
        .unwrap();
        assert_eq!(rx.recv().await.unwrap().data, payload);

        // A current-epoch packet may be delivered once only. Replays and
        // noncanonical header variants are rejected before PacketTx injection.
        assert!(inject_inbound(
            &sound.runtime,
            &sound.packet_tx,
            sound.transport_id,
            &sound.configured_peer(),
            sound.mtu(),
            &packet,
        )
        .await
        .is_err());
        let mut noncanonical = encode_packet(1, 2, &[0x5a]);
        noncanonical[6] = 1;
        assert!(inject_inbound(
            &sound.runtime,
            &sound.packet_tx,
            sound.transport_id,
            &sound.configured_peer(),
            sound.mtu(),
            &noncanonical,
        )
        .await
        .is_err());
        assert!(rx.try_recv().is_err());

        let mut reset = vec![0; FWAV_HEADER_BYTES];
        reset[0..4].copy_from_slice(b"FWAV");
        reset[4] = 1;
        reset[5] = FWAV_TYPE_RESET;
        reset[12..16].copy_from_slice(&2u32.to_le_bytes());
        inject_inbound(
            &sound.runtime,
            &sound.packet_tx,
            sound.transport_id,
            &sound.configured_peer(),
            sound.mtu(),
            &reset,
        )
        .await
        .unwrap();
        assert!(!sound.browser_ready());
        assert!(
            inject_inbound(
                &sound.runtime,
                &sound.packet_tx,
                sound.transport_id,
                &sound.configured_peer(),
                sound.mtu(),
                &packet
            )
            .await
            .is_err()
        );
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn bridge_browser_control_arms_and_disarms_only_the_current_epoch() {
        let (tx, _rx) = packet_channel(2);
        let sound = SoundTransport::new(TransportId::new(7), None, config(), tx).unwrap();
        sound.runtime.lock().unwrap().state = TransportState::Up;
        let mut arm = vec![0; FWAV_HEADER_BYTES];
        arm[0..4].copy_from_slice(b"FWAV");
        arm[4] = 1;
        arm[5] = FWAV_TYPE_BROWSER_ARM;
        arm[12..16].copy_from_slice(&1u32.to_le_bytes());
        inject_inbound(
            &sound.runtime,
            &sound.packet_tx,
            sound.transport_id,
            &sound.configured_peer(),
            sound.mtu(),
            &arm,
        )
        .await
        .unwrap();
        assert!(sound.browser_ready());

        let mut disarm = arm.clone();
        disarm[5] = FWAV_TYPE_BROWSER_DISARM;
        inject_inbound(
            &sound.runtime,
            &sound.packet_tx,
            sound.transport_id,
            &sound.configured_peer(),
            sound.mtu(),
            &disarm,
        )
        .await
        .unwrap();
        assert!(!sound.browser_ready());

        arm[12..16].copy_from_slice(&2u32.to_le_bytes());
        assert!(inject_inbound(
            &sound.runtime,
            &sound.packet_tx,
            sound.transport_id,
            &sound.configured_peer(),
            sound.mtu(),
            &arm,
        )
        .await
        .is_err());
        assert!(!sound.browser_ready());
    }

    #[test]
    fn sound_handle_exposes_all_connectionless_capabilities() {
        let (tx, _rx) = packet_channel(2);
        let handle = crate::transport::TransportHandle::Sound(
            SoundTransport::new(TransportId::new(8), Some("desk".into()), config(), tx).unwrap(),
        );
        let peer = TransportAddr::from("sound-a");
        assert_eq!(handle.transport_type().name, "sound");
        assert_eq!(handle.name(), Some("desk"));
        assert_eq!(handle.mtu(), 1357);
        assert_eq!(handle.link_mtu(&peer), 1357);
        assert!(handle.discover().unwrap().is_empty());
        assert!(!handle.auto_connect());
        assert!(!handle.accept_connections());
        assert!(matches!(
            handle.connection_state(&peer),
            ConnectionState::Failed(ref reason) if reason == "sound browser is not armed"
        ));
        assert!(matches!(
            handle.connection_state(&TransportAddr::from("sound-other")),
            ConnectionState::Failed(_)
        ));
        assert_eq!(handle.transport_stats()["browser_ready"], false);
        assert_eq!(handle.congestion().recv_drops, Some(0));
    }

    #[test]
    fn configured_sound_peer_is_connected_only_after_the_worker_and_browser_are_ready() {
        let (tx, _rx) = packet_channel(2);
        let sound = SoundTransport::new(TransportId::new(8), Some("desk".into()), config(), tx).unwrap();
        let peer = sound.configured_peer();
        assert!(matches!(sound.connection_state(&peer), ConnectionState::Failed(_)));
        {
            let mut runtime = sound.runtime.lock().unwrap();
            runtime.state = TransportState::Up;
            runtime.browser_ready = true;
        }
        assert_eq!(sound.connection_state(&peer), ConnectionState::Connected);
    }

    #[tokio::test]
    async fn sound_outbound_queue_enforces_its_byte_budget_before_item_capacity() {
        let (packet_tx, _packet_rx) = packet_channel(2);
        let mut bounded = config();
        bounded.queue_items = 2;
        bounded.queue_bytes = 1_400;
        let sound = SoundTransport::new(TransportId::new(8), None, bounded, packet_tx).unwrap();
        let (sender, _receiver) = mpsc::channel(2);
        {
            let mut runtime = sound.runtime.lock().unwrap();
            runtime.state = TransportState::Up;
            runtime.browser_ready = true;
            runtime.sender = Some(sender);
        }
        let payload = vec![0x7f; 1_357];
        assert_eq!(sound.send_async(&sound.configured_peer(), &payload).await.unwrap(), 1_357);
        assert!(sound.send_async(&sound.configured_peer(), &payload).await.is_err());
        assert_eq!(sound.transport_stats()["overflowed"], 1);
        assert_eq!(sound.outbound_bytes.load(Ordering::Acquire), 1_389);
    }

    #[test]
    fn sound_outbound_queue_drops_items_older_than_its_configured_max_age() {
        assert!(outbound_expired(
            Instant::now() - Duration::from_millis(2),
            Duration::from_millis(1),
        ));
        assert!(!outbound_expired(Instant::now(), Duration::from_secs(1)));
    }

    #[tokio::test]
    async fn sound_worker_round_trips_an_opaque_1357_byte_packet_over_loopback_websocket() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let expected = vec![0x3c; 1357];
        let returned = expected.clone();
        let fixture_returned = returned.clone();
        let fixture = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            let (mut writer, mut reader) = socket.split();
            let outbound = reader.next().await.unwrap().unwrap().into_data();
            assert_eq!(&outbound[FWAV_HEADER_BYTES..], expected.as_slice());
            writer
                .send(Message::Binary(
                    encode_packet(1, 1, &fixture_returned).into(),
                ))
                .await
                .unwrap();
        });
        let config = SoundConfig {
            bridge_url: format!("ws://127.0.0.1:{}/bridge/fips", address.port()),
            peer_addr: "sound-a".into(),
            mtu: 1357,
            queue_items: 2,
            queue_bytes: 4096,
            queue_max_age_ms: 5_000,
        };
        let (packet_tx, mut packet_rx) = packet_channel(2);
        let mut sound = SoundTransport::new(TransportId::new(9), None, config, packet_tx).unwrap();
        sound.start_async().await.unwrap();
        for _ in 0..20 {
            if sound.state() == TransportState::Up {
                break;
            }
            tokio::task::yield_now().await;
        }
        sound.arm_browser(1).unwrap();
        assert_eq!(
            sound
                .send_async(&sound.configured_peer(), &returned)
                .await
                .unwrap(),
            1357
        );
        assert_eq!(packet_rx.recv().await.unwrap().data, returned);
        fixture.await.unwrap();
        sound.stop_async().await.unwrap();
        assert_eq!(sound.state(), TransportState::Down);
    }

    #[tokio::test]
    async fn sound_worker_reconnects_after_bridge_loss_without_replaying_or_restart() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let first_payload = vec![0x6d; 1357];
        let second_payload = vec![0x6e; 1357];
        let expected_first = first_payload.clone();
        let expected_second = second_payload.clone();
        let fixture = tokio::spawn(async move {
            let (first, _) = listener.accept().await.unwrap();
            let first = tokio_tungstenite::accept_async(first).await.unwrap();
            let (mut first_writer, mut first_reader) = first.split();
            let first_outbound = tokio::time::timeout(Duration::from_secs(2), first_reader.next())
                .await.expect("first connection did not receive a packet")
                .expect("first connection closed before receiving a packet")
                .expect("first connection returned an invalid frame")
                .into_data();
            assert_eq!(&first_outbound[FWAV_HEADER_BYTES..], expected_first.as_slice());
            assert_eq!(u64::from_le_bytes(first_outbound[16..24].try_into().unwrap()), 1);
            first_writer.send(Message::Binary(encode_packet(1, 9, &[0x41]).into())).await.unwrap();
            drop(first_writer);
            drop(first_reader);

            let (second, _) = listener.accept().await.unwrap();
            let second = tokio_tungstenite::accept_async(second).await.unwrap();
            let (mut second_writer, mut second_reader) = second.split();
            // Same-epoch sequence 9 was accepted before the disconnect and
            // must remain a replay after the replacement socket is live.
            second_writer.send(Message::Binary(encode_packet(1, 9, &[0x41]).into())).await.unwrap();
            let second_outbound = tokio::time::timeout(Duration::from_secs(2), second_reader.next())
                .await.expect("reconnected socket did not receive a packet")
                .expect("reconnected socket closed before receiving a packet")
                .expect("reconnected socket returned an invalid frame")
                .into_data();
            assert_eq!(&second_outbound[FWAV_HEADER_BYTES..], expected_second.as_slice());
            assert_eq!(u64::from_le_bytes(second_outbound[16..24].try_into().unwrap()), 2);
        });
        let config = SoundConfig {
            bridge_url: format!("ws://127.0.0.1:{}/bridge/fips", address.port()),
            peer_addr: "sound-a".into(),
            mtu: 1357,
            queue_items: 2,
            queue_bytes: 4096,
            queue_max_age_ms: 5_000,
        };
        let (packet_tx, mut packet_rx) = packet_channel(2);
        let mut sound = SoundTransport::new(TransportId::new(10), None, config, packet_tx).unwrap();
        sound.start_async().await.unwrap();
        for _ in 0..100 {
            if sound.state() == TransportState::Up { break; }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        sound.arm_browser(1).unwrap();
        assert_eq!(sound.send_async(&sound.configured_peer(), &first_payload).await.unwrap(), 1357);
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), packet_rx.recv())
                .await.expect("first inbound packet timed out")
                .expect("first inbound packet channel closed").data,
            vec![0x41]
        );
        for _ in 0..100 {
            if sound.transport_stats()["disconnects"] == 1 && sound.state() == TransportState::Up {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(sound.transport_stats()["disconnects"], 1);
        assert_eq!(sound.outbound_bytes.load(Ordering::Acquire), 0);
        sound.arm_browser(1).unwrap();
        assert_eq!(sound.send_async(&sound.configured_peer(), &second_payload).await.unwrap(), 1357);
        tokio::time::timeout(Duration::from_secs(2), fixture)
            .await.expect("reconnect fixture timed out")
            .expect("reconnect fixture failed");
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert!(packet_rx.try_recv().is_err());
        assert_eq!(sound.transport_stats()["tx_packets"], 2);
        assert!(sound.transport_stats()["rejected"].as_u64().unwrap_or(0) >= 1);
        sound.stop_async().await.unwrap();
        assert_eq!(sound.state(), TransportState::Down);
    }
}
