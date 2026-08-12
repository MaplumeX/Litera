use std::{
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TryRecvError, TrySendError},
        Arc, RwLock,
    },
    thread,
    time::Duration,
};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use uuid::Uuid;

use crate::sidecar_protocol::{
    AgentError, AgentSnapshot, AgentStatus, CommandEnvelope, EventEnvelope, PromptContext,
    SidecarCommand, SidecarEvent, AGENT_PROTOCOL_VERSION, MAX_JSONL_BYTES,
};

const SUPERVISOR_QUEUE_CAPACITY: usize = 128;
const WRITER_QUEUE_CAPACITY: usize = 64;
const EVENT_BRIDGE_CAPACITY: usize = 128;
const MAX_RESTART_ATTEMPTS: usize = 3;
const RESTART_DELAYS_MS: [u64; MAX_RESTART_ATTEMPTS] = [100, 250, 500];
// Match the packaged smoke budget: the self-contained runtime starts a worker
// and loads FTS WASM before ready, which can be slow under antivirus scanning.
const READY_TIMEOUT_MS: u64 = 20_000;

#[derive(Clone)]
struct BookDescriptor {
    book_id: String,
    path: String,
    sessions_dir: String,
}

enum SupervisorMessage {
    Command {
        envelope: CommandEnvelope,
        completion: Option<SyncSender<Result<(), String>>>,
    },
    ProcessEvent {
        generation: u64,
        event: EventEnvelope,
    },
    ProcessEnded {
        generation: u64,
        reason: String,
    },
    ReadyTimeout {
        generation: u64,
    },
    Restart,
    Shutdown,
}

#[derive(Debug, PartialEq, Eq)]
enum WriterCommand {
    Write(Vec<u8>),
    Kill,
}

struct ProcessHandle {
    writer: SyncSender<Vec<u8>>,
    killer: SyncSender<()>,
}

#[derive(Clone)]
pub struct SidecarSupervisor {
    control: Option<SyncSender<SupervisorMessage>>,
    snapshot: Arc<RwLock<AgentSnapshot>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandReceipt {
    request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    prompt_id: Option<String>,
}

impl SidecarSupervisor {
    pub fn start(app: tauri::AppHandle) -> Self {
        let (control, receiver) = mpsc::sync_channel(SUPERVISOR_QUEUE_CAPACITY);
        let snapshot = Arc::new(RwLock::new(AgentSnapshot::default()));
        let actor_snapshot = snapshot.clone();
        let actor_control = control.clone();
        thread::spawn(move || run_supervisor(app, receiver, actor_control, actor_snapshot));
        Self {
            control: Some(control),
            snapshot,
        }
    }

    pub fn unavailable(reason: impl Into<String>) -> Self {
        let reason = reason.into();
        let snapshot = AgentSnapshot {
            status: AgentStatus::Unavailable,
            error: Some(AgentError {
                scope: "transport".to_string(),
                message: reason,
                recoverable: true,
                request_id: None,
                book_id: None,
                session_id: None,
                prompt_id: None,
            }),
            ..AgentSnapshot::default()
        };
        Self {
            control: None,
            snapshot: Arc::new(RwLock::new(snapshot)),
        }
    }

    pub fn snapshot(&self) -> Result<AgentSnapshot, String> {
        self.snapshot
            .read()
            .map(|snapshot| snapshot.clone())
            .map_err(|_| "Sidecar snapshot lock is poisoned".to_string())
    }

    fn enqueue(&self, message: SupervisorMessage) -> Result<(), String> {
        let control = self
            .control
            .as_ref()
            .ok_or("Sidecar supervisor is unavailable")?;
        match control.try_send(message) {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(_)) => Err("Sidecar command queue is full".to_string()),
            Err(TrySendError::Disconnected(_)) => Err("Sidecar supervisor has stopped".to_string()),
        }
    }

    fn send(&self, command: SidecarCommand) -> Result<(), String> {
        let envelope = CommandEnvelope {
            protocol_version: AGENT_PROTOCOL_VERSION,
            command,
        };
        envelope.validate()?;
        self.enqueue(SupervisorMessage::Command {
            envelope,
            completion: None,
        })
    }

    fn send_confirmed(&self, command: SidecarCommand) -> Result<(), String> {
        let envelope = CommandEnvelope {
            protocol_version: AGENT_PROTOCOL_VERSION,
            command,
        };
        envelope.validate()?;
        let (completion, result) = mpsc::sync_channel(1);
        self.enqueue(SupervisorMessage::Command {
            envelope,
            completion: Some(completion),
        })?;
        result
            .recv()
            .map_err(|_| "Sidecar supervisor stopped before confirming the command".to_string())?
    }

    pub fn shutdown(&self) {
        if let Some(control) = self.control.clone() {
            thread::spawn(move || {
                let _ = control.send(SupervisorMessage::Shutdown);
            });
        }
    }
}

#[derive(Default)]
struct JsonLineFramer {
    pending: Vec<u8>,
}

impl JsonLineFramer {
    fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>, String> {
        if self.pending.len().saturating_add(chunk.len()) > MAX_JSONL_BYTES {
            self.pending.clear();
            return Err("Sidecar stdout line exceeds size limit".to_string());
        }
        self.pending.extend_from_slice(chunk);
        let mut lines = Vec::new();
        while let Some(index) = self.pending.iter().position(|byte| *byte == b'\n') {
            let mut line = self.pending.drain(..=index).collect::<Vec<_>>();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if line.is_empty() {
                continue;
            }
            lines.push(
                String::from_utf8(line).map_err(|_| "Sidecar emitted invalid UTF-8".to_string())?,
            );
        }
        Ok(lines)
    }
}

fn spawn_process(
    app: &tauri::AppHandle,
    supervisor: &SyncSender<SupervisorMessage>,
    generation: u64,
) -> Result<ProcessHandle, String> {
    let (mut events, mut child) = app
        .shell()
        .sidecar("litera-sidecar")
        .map_err(|error| format!("Failed to resolve bundled sidecar: {error}"))?
        .set_raw_out(true)
        .spawn()
        .map_err(|error| format!("Failed to spawn bundled sidecar: {error}"))?;

    let (writer, writes) = mpsc::sync_channel(WRITER_QUEUE_CAPACITY);
    let (killer, kills) = mpsc::sync_channel(1);
    let writer_supervisor = supervisor.clone();
    thread::spawn(move || loop {
        match next_writer_command(&writes, &kills) {
            WriterCommand::Write(bytes) => {
                if let Err(error) = child.write(&bytes) {
                    let _ = writer_supervisor.send(SupervisorMessage::ProcessEnded {
                        generation,
                        reason: format!("Sidecar stdin write failed: {error}"),
                    });
                    break;
                }
            }
            WriterCommand::Kill => {
                if let Err(error) = child.kill() {
                    eprintln!("[sidecar] kill failed: {error}");
                }
                break;
            }
        }
    });

    let (event_bridge, bridged_events) = mpsc::sync_channel(EVENT_BRIDGE_CAPACITY);
    let bridge_supervisor = supervisor.clone();
    thread::spawn(move || {
        while let Ok(message) = bridged_events.recv() {
            if bridge_supervisor.send(message).is_err() {
                break;
            }
        }
    });
    let (terminal_bridge, terminal_events) = mpsc::sync_channel(1);
    let terminal_supervisor = supervisor.clone();
    thread::spawn(move || {
        if let Ok(message) = terminal_events.recv() {
            let _ = terminal_supervisor.send(message);
        }
    });
    tauri::async_runtime::spawn(async move {
        let mut stdout = JsonLineFramer::default();
        let mut stderr = JsonLineFramer::default();
        let mut terminal_sent = false;
        'events: while let Some(command_event) = events.recv().await {
            match command_event {
                CommandEvent::Stdout(chunk) => match stdout.push(&chunk) {
                    Ok(lines) => {
                        for line in lines {
                            match stdout_line_message(generation, &line) {
                                SupervisorMessage::ProcessEvent { event, .. } => {
                                    if event_bridge
                                        .try_send(SupervisorMessage::ProcessEvent {
                                            generation,
                                            event,
                                        })
                                        .is_err()
                                    {
                                        terminal_sent = true;
                                        let _ = terminal_bridge.try_send(
                                            SupervisorMessage::ProcessEnded {
                                                generation,
                                                reason: "Sidecar event bridge overflowed"
                                                    .to_string(),
                                            },
                                        );
                                        break 'events;
                                    }
                                }
                                terminal @ SupervisorMessage::ProcessEnded { .. } => {
                                    terminal_sent = true;
                                    let _ = terminal_bridge.try_send(terminal);
                                    break 'events;
                                }
                                _ => unreachable!(
                                    "stdout lines only create process events or termination"
                                ),
                            }
                        }
                    }
                    Err(error) => {
                        terminal_sent = true;
                        let _ = terminal_bridge.try_send(SupervisorMessage::ProcessEnded {
                            generation,
                            reason: error,
                        });
                        break;
                    }
                },
                CommandEvent::Stderr(chunk) => match stderr.push(&chunk) {
                    Ok(lines) => {
                        for line in lines {
                            eprintln!("[sidecar stderr] {line}");
                        }
                    }
                    Err(error) => eprintln!("[sidecar stderr] {error}"),
                },
                CommandEvent::Error(error) => {
                    terminal_sent = true;
                    let _ = terminal_bridge.try_send(SupervisorMessage::ProcessEnded {
                        generation,
                        reason: format!("Sidecar transport error: {error}"),
                    });
                    break;
                }
                CommandEvent::Terminated(payload) => {
                    terminal_sent = true;
                    let _ = terminal_bridge.try_send(SupervisorMessage::ProcessEnded {
                        generation,
                        reason: format!(
                            "Sidecar terminated (code: {:?}, signal: {:?})",
                            payload.code, payload.signal
                        ),
                    });
                    break;
                }
                _ => {}
            }
        }
        if !terminal_sent {
            let _ = terminal_bridge.try_send(SupervisorMessage::ProcessEnded {
                generation,
                reason: "Sidecar event stream closed".to_string(),
            });
        }
    });

    Ok(ProcessHandle { writer, killer })
}

fn next_writer_command(writes: &Receiver<Vec<u8>>, kills: &Receiver<()>) -> WriterCommand {
    loop {
        match kills.try_recv() {
            Ok(()) | Err(TryRecvError::Disconnected) => return WriterCommand::Kill,
            Err(TryRecvError::Empty) => {}
        }

        match writes.recv_timeout(Duration::from_millis(10)) {
            Ok(bytes) => match kills.try_recv() {
                Ok(()) | Err(TryRecvError::Disconnected) => return WriterCommand::Kill,
                Err(TryRecvError::Empty) => return WriterCommand::Write(bytes),
            },
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return WriterCommand::Kill,
        }
    }
}

fn stdout_line_message(generation: u64, line: &str) -> SupervisorMessage {
    match EventEnvelope::decode_line(line) {
        Ok(event) => SupervisorMessage::ProcessEvent { generation, event },
        Err(error) => SupervisorMessage::ProcessEnded {
            generation,
            reason: format!("Sidecar emitted invalid protocol event: {error}"),
        },
    }
}

struct SupervisorActor {
    app: tauri::AppHandle,
    control: SyncSender<SupervisorMessage>,
    snapshot: Arc<RwLock<AgentSnapshot>>,
    process: Option<ProcessHandle>,
    generation: u64,
    stopping: bool,
    restart_attempts: usize,
    replay_book: Option<BookDescriptor>,
    replay_session_id: Option<String>,
    pending_replay_session: Option<String>,
    recovering: bool,
    process_ready: bool,
    last_seq: u64,
    agent_dir: String,
}

fn run_supervisor(
    app: tauri::AppHandle,
    receiver: Receiver<SupervisorMessage>,
    control: SyncSender<SupervisorMessage>,
    snapshot: Arc<RwLock<AgentSnapshot>>,
) {
    let agent_dir = app
        .path()
        .app_data_dir()
        .map(|dir| dir.join("agent"))
        .map(|dir| dir.to_string_lossy().to_string())
        .unwrap_or_default();
    let _ = std::fs::create_dir_all(&agent_dir);
    let mut actor = SupervisorActor {
        app,
        control,
        snapshot,
        process: None,
        generation: 0,
        stopping: false,
        restart_attempts: 0,
        replay_book: None,
        replay_session_id: None,
        pending_replay_session: None,
        recovering: false,
        process_ready: false,
        last_seq: 0,
        agent_dir,
    };
    actor.start_process();
    while let Ok(message) = receiver.recv() {
        match message {
            SupervisorMessage::Command {
                envelope,
                completion,
            } => {
                let result = actor.handle_command(envelope);
                if let Some(completion) = completion {
                    let _ = completion.try_send(result);
                }
            }
            SupervisorMessage::ProcessEvent { generation, event } => {
                if generation == actor.generation && event.seq > actor.last_seq {
                    actor.last_seq = event.seq;
                    actor.handle_event(event);
                }
            }
            SupervisorMessage::ProcessEnded { generation, reason } => {
                if generation == actor.generation && !actor.stopping {
                    actor.handle_process_ended(reason);
                }
            }
            SupervisorMessage::ReadyTimeout { generation } => {
                if generation == actor.generation && !actor.process_ready && !actor.stopping {
                    actor.handle_process_ended(
                        "Sidecar did not become ready before timeout".to_string(),
                    );
                }
            }
            SupervisorMessage::Restart => {
                if !actor.stopping {
                    actor.restart_attempts = 0;
                    actor.recovering = true;
                    actor.kill_process();
                    actor.start_process();
                }
            }
            SupervisorMessage::Shutdown => {
                actor.stopping = true;
                actor.kill_process();
                break;
            }
        }
    }
}

impl SupervisorActor {
    fn start_process(&mut self) {
        self.generation = self.generation.saturating_add(1);
        self.update_snapshot(|snapshot| {
            snapshot.generation = self.generation;
            snapshot.status = AgentStatus::Starting;
            snapshot.prompt_id = None;
        });
        self.process_ready = false;
        self.last_seq = 0;
        match spawn_process(&self.app, &self.control, self.generation) {
            Ok(process) => {
                self.process = Some(process);
                self.schedule_ready_timeout();
                let bootstrap = CommandEnvelope {
                    protocol_version: AGENT_PROTOCOL_VERSION,
                    command: SidecarCommand::Ping {
                        request_id: new_id("bootstrap"),
                    },
                };
                let _ = self.write_command(&bootstrap);
            }
            Err(error) => self.handle_process_ended(error),
        }
    }

    fn schedule_ready_timeout(&self) {
        let control = self.control.clone();
        let generation = self.generation;
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(READY_TIMEOUT_MS));
            let _ = control.send(SupervisorMessage::ReadyTimeout { generation });
        });
    }

    fn kill_process(&mut self) {
        if let Some(process) = self.process.take() {
            let _ = process.killer.try_send(());
        }
    }

    fn write_command(&self, command: &CommandEnvelope) -> Result<(), String> {
        let process = self
            .process
            .as_ref()
            .ok_or("Sidecar process is unavailable")?;
        let bytes = command.encode_line()?;
        match process.writer.try_send(bytes) {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(_)) => Err("Sidecar writer queue is full".to_string()),
            Err(TrySendError::Disconnected(_)) => Err("Sidecar writer has stopped".to_string()),
        }
    }

    fn handle_command(&mut self, command: CommandEnvelope) -> Result<(), String> {
        if let Err(error) = self.write_command(&command) {
            self.emit_command_error("transport", &error, true, &command);
            return Err(error);
        }

        match &command.command {
            SidecarCommand::OpenBook {
                book_id,
                path,
                sessions_dir,
                ..
            } => {
                self.replay_book = Some(BookDescriptor {
                    book_id: book_id.clone(),
                    path: path.clone(),
                    sessions_dir: sessions_dir.clone(),
                });
                self.replay_session_id = None;
            }
            SidecarCommand::CloseBook { book_id, .. }
                if book_id.as_ref().is_none_or(|closing_id| {
                    self.replay_book
                        .as_ref()
                        .is_some_and(|book| &book.book_id == closing_id)
                }) =>
            {
                self.replay_book = None;
                self.replay_session_id = None;
                self.pending_replay_session = None;
            }
            _ => {}
        }
        Ok(())
    }

    fn handle_event(&mut self, event: EventEnvelope) {
        self.apply_event_to_snapshot(&event);
        self.emit_sidecar_event(&event);

        match &event.event {
            SidecarEvent::Ready => {
                self.process_ready = true;
                if !self.agent_dir.is_empty() {
                    let configure = CommandEnvelope {
                        protocol_version: AGENT_PROTOCOL_VERSION,
                        command: SidecarCommand::Configure {
                            request_id: new_id("configure"),
                            agent_dir: self.agent_dir.clone(),
                        },
                    };
                    if let Err(error) = self.write_command(&configure) {
                        self.emit_command_error("configure", &error, true, &configure);
                    }
                }
                if self.recovering {
                    self.recovering = false;
                } else {
                    return;
                }
                if let Some(book) = self.replay_book.clone() {
                    self.pending_replay_session = self.replay_session_id.clone();
                    let command = CommandEnvelope {
                        protocol_version: AGENT_PROTOCOL_VERSION,
                        command: SidecarCommand::OpenBook {
                            request_id: new_id("replay-open"),
                            book_id: book.book_id,
                            path: book.path,
                            sessions_dir: book.sessions_dir,
                        },
                    };
                    if let Err(error) = self.write_command(&command) {
                        self.emit_command_error("replay", &error, true, &command);
                    }
                }
            }
            SidecarEvent::BookReady { book_id, .. } => {
                if let Some(session_id) = self.pending_replay_session.take() {
                    let command = CommandEnvelope {
                        protocol_version: AGENT_PROTOCOL_VERSION,
                        command: SidecarCommand::SwitchSession {
                            request_id: new_id("replay-session"),
                            book_id: book_id.clone(),
                            session_id,
                        },
                    };
                    if let Err(error) = self.write_command(&command) {
                        self.emit_command_error("replay", &error, true, &command);
                    }
                }
            }
            SidecarEvent::SessionCreated { session_id, .. }
            | SidecarEvent::SessionSwitched { session_id, .. } => {
                self.replay_session_id = Some(session_id.clone());
            }
            SidecarEvent::PromptStarted { session_id, .. } => {
                self.replay_session_id = Some(session_id.clone());
            }
            SidecarEvent::SessionDeleted { session_id, .. }
                if self.replay_session_id.as_ref() == Some(session_id) =>
            {
                self.replay_session_id = None;
            }
            _ => {}
        }
    }

    fn handle_process_ended(&mut self, reason: String) {
        self.kill_process();
        self.process_ready = false;
        self.recovering = true;
        let interrupted = self.snapshot().ok().and_then(|snapshot| {
            Some((snapshot.book_id?, snapshot.session_id?, snapshot.prompt_id?))
        });
        self.update_snapshot(|snapshot| {
            snapshot.status = AgentStatus::Restarting;
            snapshot.prompt_id = None;
            snapshot.error = Some(AgentError {
                scope: "transport".to_string(),
                message: reason.clone(),
                recoverable: true,
                request_id: None,
                book_id: snapshot.book_id.clone(),
                session_id: snapshot.session_id.clone(),
                prompt_id: None,
            });
        });
        if let Some((book_id, session_id, prompt_id)) = interrupted {
            self.emit_synthetic(
                "prompt_interrupted",
                json!({
                    "bookId": book_id,
                    "sessionId": session_id,
                    "promptId": prompt_id,
                    "message": "Sidecar restarted while generating. You can retry the prompt."
                }),
            );
        }
        self.emit_synthetic(
            "supervisor_status",
            json!({ "status": "restarting", "message": reason }),
        );

        while let Some(delay) = restart_delay(self.restart_attempts) {
            if self.stopping {
                break;
            }
            self.restart_attempts += 1;
            thread::sleep(Duration::from_millis(delay));
            self.generation = self.generation.saturating_add(1);
            self.last_seq = 0;
            self.update_snapshot(|snapshot| {
                snapshot.generation = self.generation;
                snapshot.status = AgentStatus::Starting;
            });
            match spawn_process(&self.app, &self.control, self.generation) {
                Ok(process) => {
                    self.process = Some(process);
                    self.process_ready = false;
                    self.schedule_ready_timeout();
                    let bootstrap = CommandEnvelope {
                        protocol_version: AGENT_PROTOCOL_VERSION,
                        command: SidecarCommand::Ping {
                            request_id: new_id("restart-bootstrap"),
                        },
                    };
                    let _ = self.write_command(&bootstrap);
                    return;
                }
                Err(error) => eprintln!("[sidecar] restart failed: {error}"),
            }
        }
        self.update_snapshot(|snapshot| {
            snapshot.generation = self.generation;
            snapshot.status = AgentStatus::Unavailable;
            if let Some(error) = snapshot.error.as_mut() {
                error.recoverable = true;
            }
        });
        self.emit_synthetic(
            "supervisor_status",
            json!({ "status": "unavailable", "message": "Sidecar restart attempts exhausted" }),
        );
    }

    fn apply_event_to_snapshot(&self, event: &EventEnvelope) {
        self.update_snapshot(|snapshot| {
            snapshot.generation = self.generation;
            match &event.event {
                SidecarEvent::Ready => {
                    snapshot.status = AgentStatus::Ready;
                    snapshot.error = None;
                }
                SidecarEvent::BookLoading { book_id, .. } => {
                    snapshot.status = AgentStatus::LoadingBook;
                    snapshot.book_id = Some(book_id.clone());
                    snapshot.session_id = None;
                    snapshot.prompt_id = None;
                    snapshot.error = None;
                }
                SidecarEvent::BookReady { book_id, .. } => {
                    snapshot.status = AgentStatus::BookReady;
                    snapshot.book_id = Some(book_id.clone());
                    snapshot.error = None;
                }
                SidecarEvent::BookClosed { .. } => {
                    snapshot.status = AgentStatus::Ready;
                    snapshot.book_id = None;
                    snapshot.session_id = None;
                    snapshot.prompt_id = None;
                    snapshot.error = None;
                }
                SidecarEvent::PromptStarted {
                    book_id,
                    session_id,
                    prompt_id,
                    ..
                } => {
                    snapshot.status = AgentStatus::Prompting;
                    snapshot.book_id = Some(book_id.clone());
                    snapshot.session_id = Some(session_id.clone());
                    snapshot.prompt_id = Some(prompt_id.clone());
                    snapshot.error = None;
                }
                SidecarEvent::PromptEnd { prompt_id, .. }
                | SidecarEvent::PromptAborted { prompt_id, .. } => {
                    if snapshot.prompt_id.as_ref() == Some(prompt_id) {
                        snapshot.status = AgentStatus::BookReady;
                        snapshot.prompt_id = None;
                    }
                }
                SidecarEvent::SessionCreated {
                    book_id,
                    session_id,
                    ..
                }
                | SidecarEvent::SessionSwitched {
                    book_id,
                    session_id,
                    ..
                } => {
                    snapshot.book_id = Some(book_id.clone());
                    snapshot.session_id = Some(session_id.clone());
                }
                SidecarEvent::SessionDeleted { session_id, .. } => {
                    if snapshot.session_id.as_ref() == Some(session_id) {
                        snapshot.session_id = None;
                    }
                }
                SidecarEvent::Error {
                    request_id,
                    book_id,
                    session_id,
                    prompt_id,
                    scope,
                    message,
                    recoverable,
                } => {
                    if !error_matches_snapshot(snapshot, book_id, prompt_id) {
                        return;
                    }
                    if prompt_id.is_some() && snapshot.prompt_id == *prompt_id {
                        snapshot.status = AgentStatus::BookReady;
                        snapshot.prompt_id = None;
                    }
                    snapshot.error = Some(AgentError {
                        scope: scope.clone(),
                        message: message.clone(),
                        recoverable: *recoverable,
                        request_id: request_id.clone(),
                        book_id: book_id.clone(),
                        session_id: session_id.clone(),
                        prompt_id: prompt_id.clone(),
                    });
                }
                _ => {}
            }
        });
    }

    fn snapshot(&self) -> Result<AgentSnapshot, String> {
        self.snapshot
            .read()
            .map(|snapshot| snapshot.clone())
            .map_err(|_| "Sidecar snapshot lock is poisoned".to_string())
    }

    fn update_snapshot(&self, update: impl FnOnce(&mut AgentSnapshot)) {
        if let Ok(mut snapshot) = self.snapshot.write() {
            update(&mut snapshot);
            snapshot.version = snapshot.version.saturating_add(1);
        }
    }

    fn emit_sidecar_event(&self, event: &EventEnvelope) {
        let Ok(snapshot) = self.snapshot() else {
            return;
        };
        let Ok(mut payload) = serde_json::to_value(event) else {
            return;
        };
        if let Some(object) = payload.as_object_mut() {
            object.insert("version".to_string(), Value::from(snapshot.version));
            object.insert("generation".to_string(), Value::from(self.generation));
        }
        let _ = self.app.emit("agent_event", payload);
    }

    fn emit_synthetic(&self, event_type: &str, fields: Value) {
        self.update_snapshot(|_| {});
        let Ok(snapshot) = self.snapshot() else {
            return;
        };
        let mut payload = json!({
            "protocolVersion": AGENT_PROTOCOL_VERSION,
            "version": snapshot.version,
            "generation": self.generation,
            "seq": 0,
            "type": event_type,
        });
        if let (Some(target), Some(source)) = (payload.as_object_mut(), fields.as_object()) {
            for (key, value) in source {
                target.insert(key.clone(), value.clone());
            }
        }
        let _ = self.app.emit("agent_event", payload);
    }

    fn emit_command_error(
        &self,
        scope: &str,
        message: &str,
        recoverable: bool,
        command: &CommandEnvelope,
    ) {
        let correlation = command_correlation(&command.command);
        self.update_snapshot(|snapshot| {
            snapshot.error = Some(AgentError {
                scope: scope.to_string(),
                message: message.to_string(),
                recoverable,
                request_id: Some(correlation.request_id.clone()),
                book_id: correlation.book_id.clone(),
                session_id: correlation.session_id.clone(),
                prompt_id: correlation.prompt_id.clone(),
            });
        });
        self.emit_synthetic(
            "error",
            json!({
                "scope": scope,
                "message": message,
                "recoverable": recoverable,
                "requestId": correlation.request_id,
                "bookId": correlation.book_id,
                "sessionId": correlation.session_id,
                "promptId": correlation.prompt_id,
            }),
        );
    }
}

fn error_matches_snapshot(
    snapshot: &AgentSnapshot,
    book_id: &Option<String>,
    prompt_id: &Option<String>,
) -> bool {
    if let Some(book_id) = book_id {
        if snapshot.book_id.as_ref() != Some(book_id) {
            return false;
        }
    }
    if let Some(prompt_id) = prompt_id {
        if snapshot.prompt_id.as_ref() != Some(prompt_id) {
            return false;
        }
    }
    true
}

struct CommandCorrelation {
    request_id: String,
    book_id: Option<String>,
    session_id: Option<String>,
    prompt_id: Option<String>,
}

fn restart_delay(attempts_used: usize) -> Option<u64> {
    RESTART_DELAYS_MS.get(attempts_used).copied()
}

fn command_correlation(command: &SidecarCommand) -> CommandCorrelation {
    match command {
        SidecarCommand::Ping { request_id }
        | SidecarCommand::Configure { request_id, .. }
        | SidecarCommand::CloseBook { request_id, .. }
        | SidecarCommand::Abort { request_id, .. } => CommandCorrelation {
            request_id: request_id.clone(),
            book_id: match command {
                SidecarCommand::CloseBook { book_id, .. } => book_id.clone(),
                _ => None,
            },
            session_id: None,
            prompt_id: match command {
                SidecarCommand::Abort { prompt_id, .. } => prompt_id.clone(),
                _ => None,
            },
        },
        SidecarCommand::OpenBook {
            request_id,
            book_id,
            ..
        }
        | SidecarCommand::ListSessions {
            request_id,
            book_id,
        }
        | SidecarCommand::NewSession {
            request_id,
            book_id,
        } => CommandCorrelation {
            request_id: request_id.clone(),
            book_id: Some(book_id.clone()),
            session_id: None,
            prompt_id: None,
        },
        SidecarCommand::Prompt {
            request_id,
            book_id,
            prompt_id,
            ..
        }
        | SidecarCommand::EditPrompt {
            request_id,
            book_id,
            prompt_id,
            ..
        } => CommandCorrelation {
            request_id: request_id.clone(),
            book_id: Some(book_id.clone()),
            session_id: None,
            prompt_id: Some(prompt_id.clone()),
        },
        SidecarCommand::SwitchSession {
            request_id,
            book_id,
            session_id,
        }
        | SidecarCommand::DeleteSession {
            request_id,
            book_id,
            session_id,
        } => CommandCorrelation {
            request_id: request_id.clone(),
            book_id: Some(book_id.clone()),
            session_id: Some(session_id.clone()),
            prompt_id: None,
        },
        SidecarCommand::RenameSession {
            request_id,
            book_id,
            session_id,
            ..
        } => CommandCorrelation {
            request_id: request_id.clone(),
            book_id: Some(book_id.clone()),
            session_id: Some(session_id.clone()),
            prompt_id: None,
        },
    }
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4())
}

fn normalize_request_id(request_id: Option<String>, prefix: &str) -> String {
    request_id.unwrap_or_else(|| new_id(prefix))
}

#[tauri::command]
pub fn get_agent_snapshot(
    supervisor: tauri::State<'_, SidecarSupervisor>,
) -> Result<AgentSnapshot, String> {
    supervisor.snapshot()
}

#[tauri::command]
pub fn agent_prompt(
    prompt: String,
    selection: Option<String>,
    chapter_index: Option<u32>,
    book_id: String,
    request_id: Option<String>,
    prompt_id: Option<String>,
    supervisor: tauri::State<'_, SidecarSupervisor>,
) -> Result<CommandReceipt, String> {
    let request_id = normalize_request_id(request_id, "prompt-request");
    let prompt_id = prompt_id.unwrap_or_else(|| new_id("prompt"));
    let context = if selection.is_some() || chapter_index.is_some() {
        Some(PromptContext {
            selection,
            chapter_index,
        })
    } else {
        None
    };
    supervisor.send(SidecarCommand::Prompt {
        request_id: request_id.clone(),
        prompt_id: prompt_id.clone(),
        book_id,
        text: prompt,
        context,
    })?;
    Ok(CommandReceipt {
        request_id,
        prompt_id: Some(prompt_id),
    })
}

#[tauri::command]
pub fn agent_edit_prompt(
    message_index: u32,
    prompt: String,
    selection: Option<String>,
    chapter_index: Option<u32>,
    book_id: String,
    request_id: Option<String>,
    prompt_id: Option<String>,
    supervisor: tauri::State<'_, SidecarSupervisor>,
) -> Result<CommandReceipt, String> {
    let request_id = normalize_request_id(request_id, "edit-prompt-request");
    let prompt_id = prompt_id.unwrap_or_else(|| new_id("prompt"));
    let context = if selection.is_some() || chapter_index.is_some() {
        Some(PromptContext {
            selection,
            chapter_index,
        })
    } else {
        None
    };
    supervisor.send(SidecarCommand::EditPrompt {
        request_id: request_id.clone(),
        prompt_id: prompt_id.clone(),
        book_id,
        message_index,
        text: prompt,
        context,
    })?;
    Ok(CommandReceipt {
        request_id,
        prompt_id: Some(prompt_id),
    })
}

#[tauri::command]
pub fn agent_abort(
    prompt_id: Option<String>,
    request_id: Option<String>,
    supervisor: tauri::State<'_, SidecarSupervisor>,
) -> Result<CommandReceipt, String> {
    let request_id = normalize_request_id(request_id, "abort");
    supervisor.send(SidecarCommand::Abort {
        request_id: request_id.clone(),
        prompt_id,
    })?;
    Ok(CommandReceipt {
        request_id,
        prompt_id: None,
    })
}

#[tauri::command]
pub fn list_sessions(
    book_id: String,
    request_id: Option<String>,
    supervisor: tauri::State<'_, SidecarSupervisor>,
) -> Result<CommandReceipt, String> {
    let request_id = normalize_request_id(request_id, "list");
    supervisor.send(SidecarCommand::ListSessions {
        request_id: request_id.clone(),
        book_id,
    })?;
    Ok(CommandReceipt {
        request_id,
        prompt_id: None,
    })
}

#[tauri::command]
pub fn new_session(
    book_id: String,
    request_id: Option<String>,
    supervisor: tauri::State<'_, SidecarSupervisor>,
) -> Result<CommandReceipt, String> {
    let request_id = normalize_request_id(request_id, "new-session");
    supervisor.send(SidecarCommand::NewSession {
        request_id: request_id.clone(),
        book_id,
    })?;
    Ok(CommandReceipt {
        request_id,
        prompt_id: None,
    })
}

#[tauri::command]
pub fn switch_session(
    book_id: String,
    session_id: String,
    request_id: Option<String>,
    supervisor: tauri::State<'_, SidecarSupervisor>,
) -> Result<CommandReceipt, String> {
    let request_id = normalize_request_id(request_id, "switch-session");
    supervisor.send(SidecarCommand::SwitchSession {
        request_id: request_id.clone(),
        book_id,
        session_id,
    })?;
    Ok(CommandReceipt {
        request_id,
        prompt_id: None,
    })
}

#[tauri::command]
pub fn delete_session(
    book_id: String,
    session_id: String,
    request_id: Option<String>,
    supervisor: tauri::State<'_, SidecarSupervisor>,
) -> Result<CommandReceipt, String> {
    let request_id = normalize_request_id(request_id, "delete-session");
    supervisor.send(SidecarCommand::DeleteSession {
        request_id: request_id.clone(),
        book_id,
        session_id,
    })?;
    Ok(CommandReceipt {
        request_id,
        prompt_id: None,
    })
}

#[tauri::command]
pub fn rename_session(
    book_id: String,
    session_id: String,
    title: String,
    request_id: Option<String>,
    supervisor: tauri::State<'_, SidecarSupervisor>,
) -> Result<CommandReceipt, String> {
    let request_id = normalize_request_id(request_id, "rename-session");
    supervisor.send(SidecarCommand::RenameSession {
        request_id: request_id.clone(),
        book_id,
        session_id,
        title,
    })?;
    Ok(CommandReceipt {
        request_id,
        prompt_id: None,
    })
}

#[tauri::command]
pub fn close_book(
    book_id: Option<String>,
    request_id: Option<String>,
    supervisor: tauri::State<'_, SidecarSupervisor>,
) -> Result<CommandReceipt, String> {
    let request_id = normalize_request_id(request_id, "close-book");
    supervisor.send(SidecarCommand::CloseBook {
        request_id: request_id.clone(),
        book_id,
    })?;
    Ok(CommandReceipt {
        request_id,
        prompt_id: None,
    })
}

#[tauri::command]
pub fn restart_sidecar(supervisor: tauri::State<'_, SidecarSupervisor>) -> Result<(), String> {
    supervisor.enqueue(SupervisorMessage::Restart)
}

pub fn notify_book_opened(app: &tauri::AppHandle, path: &str, book_id: &str) -> Result<(), String> {
    let supervisor = app
        .try_state::<SidecarSupervisor>()
        .ok_or("Sidecar supervisor is unavailable")?;
    let sessions_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve sessions dir: {error}"))?
        .join("sessions")
        .to_string_lossy()
        .to_string();
    send_open_book(&supervisor, path, book_id, sessions_dir)
}

fn send_open_book(
    supervisor: &SidecarSupervisor,
    path: &str,
    book_id: &str,
    sessions_dir: String,
) -> Result<(), String> {
    let command = SidecarCommand::OpenBook {
        request_id: new_id("open-book"),
        book_id: book_id.to_string(),
        path: path.to_string(),
        sessions_dir,
    };
    supervisor.send_confirmed(command)
}

#[cfg(test)]
mod tests {
    use std::sync::{mpsc, Arc, RwLock};

    use super::{
        command_correlation, error_matches_snapshot, next_writer_command, restart_delay,
        send_open_book, stdout_line_message, JsonLineFramer, SidecarSupervisor, SupervisorMessage,
        WriterCommand,
    };
    use crate::sidecar_protocol::{AgentSnapshot, SidecarCommand, MAX_JSONL_BYTES};

    #[test]
    fn json_line_framer_reassembles_fragmented_chunks() {
        let mut framer = JsonLineFramer::default();
        assert!(framer.push(br#"{"type":"rea"#).expect("chunk").is_empty());
        assert_eq!(
            framer
                .push(b"dy\"}\r\n{\"type\":\"pong\"}\npartial")
                .expect("chunk"),
            vec![
                r#"{"type":"ready"}"#.to_string(),
                r#"{"type":"pong"}"#.to_string(),
            ]
        );
        assert_eq!(
            framer.push(b"-line\n").expect("chunk"),
            vec!["partial-line"]
        );
    }

    #[test]
    fn json_line_framer_rejects_oversized_pending_line() {
        let mut framer = JsonLineFramer::default();
        assert!(framer.push(&vec![b'x'; MAX_JSONL_BYTES + 1]).is_err());
    }

    #[test]
    fn consecutive_ready_then_crash_cycles_exhaust_the_restart_budget() {
        assert_eq!(restart_delay(0), Some(100));
        assert_eq!(restart_delay(1), Some(250));
        assert_eq!(restart_delay(2), Some(500));
        assert_eq!(restart_delay(3), None);
    }

    #[test]
    fn transport_error_keeps_command_correlation() {
        let correlation = command_correlation(&SidecarCommand::Prompt {
            request_id: "request-1".to_string(),
            prompt_id: "prompt-1".to_string(),
            book_id: "book-1".to_string(),
            text: "question".to_string(),
            context: None,
        });
        assert_eq!(correlation.request_id, "request-1");
        assert_eq!(correlation.book_id.as_deref(), Some("book-1"));
        assert_eq!(correlation.prompt_id.as_deref(), Some("prompt-1"));
    }

    #[test]
    fn command_validation_rejects_oversized_prompt_before_enqueue() {
        let command = crate::sidecar_protocol::CommandEnvelope {
            protocol_version: crate::sidecar_protocol::AGENT_PROTOCOL_VERSION,
            command: SidecarCommand::Prompt {
                request_id: "request-1".to_string(),
                prompt_id: "prompt-1".to_string(),
                book_id: "book-1".to_string(),
                text: "x".repeat(crate::sidecar_protocol::MAX_PROMPT_LENGTH + 1),
                context: None,
            },
        };
        assert!(command.validate().is_err());
    }

    #[test]
    fn open_book_notification_reports_an_unavailable_supervisor() {
        let supervisor = SidecarSupervisor::unavailable("not started");
        let error = send_open_book(
            &supervisor,
            "/controlled/book.epub",
            "book-1",
            "/controlled/sessions".to_string(),
        )
        .expect_err("notification must fail");
        assert_eq!(error, "Sidecar supervisor is unavailable");
    }

    #[test]
    fn confirmed_command_waits_for_the_actor_writer_result() {
        let (control, receiver) = mpsc::sync_channel(1);
        let supervisor = SidecarSupervisor {
            control: Some(control),
            snapshot: Arc::new(RwLock::new(Default::default())),
        };
        let actor = std::thread::spawn(move || {
            let SupervisorMessage::Command {
                envelope,
                completion: Some(completion),
            } = receiver.recv().expect("confirmed command")
            else {
                panic!("expected a confirmed command");
            };
            assert!(matches!(envelope.command, SidecarCommand::OpenBook { .. }));
            completion
                .try_send(Err("writer queue is full".to_string()))
                .expect("completion result");
        });

        let error = send_open_book(
            &supervisor,
            "/controlled/book.epub",
            "book-1",
            "/controlled/sessions".to_string(),
        )
        .expect_err("writer failure must reach open_book_bytes");
        assert_eq!(error, "writer queue is full");
        actor.join().expect("actor thread");
    }

    #[test]
    fn kill_channel_preempts_a_full_writer_queue() {
        let (writer, writes) = mpsc::sync_channel(1);
        let (killer, kills) = mpsc::sync_channel(1);
        writer.try_send(vec![1]).expect("fill writer queue");
        killer.try_send(()).expect("queue kill");

        assert_eq!(next_writer_command(&writes, &kills), WriterCommand::Kill);
    }

    #[test]
    fn invalid_stdout_protocol_line_becomes_process_ended() {
        match stdout_line_message(7, r#"{"protocolVersion":1,"seq":1,"type":"unknown"}"#) {
            SupervisorMessage::ProcessEnded { generation, reason } => {
                assert_eq!(generation, 7);
                assert!(reason.contains("invalid protocol event"));
            }
            _ => panic!("invalid protocol output must terminate its process generation"),
        }
    }

    #[test]
    fn snapshot_rejects_an_error_from_an_old_prompt_or_book() {
        let snapshot = AgentSnapshot {
            book_id: Some("book-b".to_string()),
            prompt_id: Some("prompt-new".to_string()),
            ..AgentSnapshot::default()
        };
        assert!(!error_matches_snapshot(
            &snapshot,
            &Some("book-a".to_string()),
            &None,
        ));
        assert!(!error_matches_snapshot(
            &snapshot,
            &Some("book-b".to_string()),
            &Some("prompt-old".to_string()),
        ));
        assert!(error_matches_snapshot(
            &snapshot,
            &Some("book-b".to_string()),
            &Some("prompt-new".to_string()),
        ));
    }
}
