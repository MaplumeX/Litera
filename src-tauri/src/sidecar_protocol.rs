use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const AGENT_PROTOCOL_VERSION: u8 = 1;
pub const MAX_JSONL_BYTES: usize = 1024 * 1024;
pub const MAX_ID_LENGTH: usize = 128;
pub const MAX_PROMPT_LENGTH: usize = 64 * 1024;
pub const MAX_SELECTION_LENGTH: usize = 64 * 1024;
const MAX_MESSAGE_CONTENT_LENGTH: usize = MAX_PROMPT_LENGTH * 4;
const MAX_SESSION_TITLE_LENGTH: usize = 1024;
const MAX_RENAME_TITLE_LENGTH: usize = 128;
const MAX_TIMESTAMP_LENGTH: usize = 128;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandEnvelope {
    pub protocol_version: u8,
    #[serde(flatten)]
    pub command: SidecarCommand,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SidecarCommand {
    Ping {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    Configure {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "agentDir")]
        agent_dir: String,
    },
    OpenBook {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "bookId")]
        book_id: String,
        path: String,
        #[serde(rename = "sessionsDir")]
        sessions_dir: String,
    },
    CloseBook {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "bookId", skip_serializing_if = "Option::is_none")]
        book_id: Option<String>,
    },
    Prompt {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "promptId")]
        prompt_id: String,
        #[serde(rename = "bookId")]
        book_id: String,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        context: Option<PromptContext>,
    },
    EditPrompt {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "promptId")]
        prompt_id: String,
        #[serde(rename = "bookId")]
        book_id: String,
        #[serde(rename = "messageIndex")]
        message_index: u32,
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        context: Option<PromptContext>,
    },
    Abort {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "promptId", skip_serializing_if = "Option::is_none")]
        prompt_id: Option<String>,
    },
    ListSessions {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "bookId")]
        book_id: String,
    },
    NewSession {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "bookId")]
        book_id: String,
    },
    SwitchSession {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "bookId")]
        book_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    DeleteSession {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "bookId")]
        book_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    RenameSession {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "bookId")]
        book_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        title: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chapter_href: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EventEnvelope {
    pub protocol_version: u8,
    pub seq: u64,
    #[serde(flatten)]
    pub event: SidecarEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SidecarEvent {
    Ready,
    Pong {
        #[serde(rename = "requestId", skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        fts5: bool,
    },
    BookLoading {
        #[serde(rename = "requestId", skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        #[serde(rename = "bookId")]
        book_id: String,
    },
    BookReady {
        #[serde(rename = "requestId", skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        #[serde(rename = "bookId")]
        book_id: String,
    },
    BookClosed {
        #[serde(rename = "requestId", skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        #[serde(rename = "bookId", skip_serializing_if = "Option::is_none")]
        book_id: Option<String>,
    },
    PromptStarted {
        #[serde(rename = "requestId", skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        #[serde(rename = "bookId")]
        book_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "promptId")]
        prompt_id: String,
    },
    TextDelta {
        #[serde(rename = "bookId")]
        book_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "promptId")]
        prompt_id: String,
        delta: String,
    },
    ToolStart {
        #[serde(rename = "bookId")]
        book_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "promptId")]
        prompt_id: String,
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        tool: String,
        params: Value,
    },
    ToolEnd {
        #[serde(rename = "bookId")]
        book_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "promptId")]
        prompt_id: String,
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        result: Value,
        #[serde(rename = "isError")]
        is_error: bool,
    },
    PromptEnd {
        #[serde(rename = "bookId")]
        book_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "promptId")]
        prompt_id: String,
    },
    PromptAborted {
        #[serde(rename = "requestId", skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        #[serde(rename = "bookId")]
        book_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "promptId")]
        prompt_id: String,
    },
    SessionCreated {
        #[serde(rename = "requestId", skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        #[serde(rename = "bookId")]
        book_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    SessionSwitched {
        #[serde(rename = "requestId", skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        #[serde(rename = "bookId")]
        book_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        messages: Vec<SerializedMessage>,
    },
    SessionRewound {
        #[serde(rename = "requestId", skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        #[serde(rename = "bookId")]
        book_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "promptId")]
        prompt_id: String,
        messages: Vec<SerializedMessage>,
    },
    SessionDeleted {
        #[serde(rename = "requestId", skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        #[serde(rename = "bookId")]
        book_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    SessionRenamed {
        #[serde(rename = "requestId", skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        #[serde(rename = "bookId")]
        book_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        title: String,
    },
    SessionsList {
        #[serde(rename = "requestId", skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        #[serde(rename = "bookId")]
        book_id: String,
        sessions: Vec<SessionSummary>,
    },
    Error {
        #[serde(rename = "requestId", skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        #[serde(rename = "bookId", skip_serializing_if = "Option::is_none")]
        book_id: Option<String>,
        #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
        #[serde(rename = "promptId", skip_serializing_if = "Option::is_none")]
        prompt_id: Option<String>,
        scope: String,
        message: String,
        recoverable: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SerializedToolCall {
    pub tool_call_id: String,
    pub tool: String,
    pub params: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SerializedMessage {
    pub role: MessageRole,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<SerializedToolCall>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSnapshot {
    pub protocol_version: u8,
    pub version: u64,
    pub generation: u64,
    pub status: AgentStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub book_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AgentError>,
}

impl Default for AgentSnapshot {
    fn default() -> Self {
        Self {
            protocol_version: AGENT_PROTOCOL_VERSION,
            version: 0,
            generation: 0,
            status: AgentStatus::Starting,
            book_id: None,
            session_id: None,
            prompt_id: None,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentError {
    pub scope: String,
    pub message: String,
    pub recoverable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub book_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AgentStatus {
    Starting,
    Ready,
    LoadingBook,
    BookReady,
    Prompting,
    Restarting,
    Unavailable,
}

impl CommandEnvelope {
    #[allow(dead_code)]
    pub fn decode_line(line: &str) -> Result<Self, String> {
        if line.len() > MAX_JSONL_BYTES {
            return Err("Sidecar command exceeds JSONL size limit".to_string());
        }
        let envelope: Self = serde_json::from_str(line)
            .map_err(|error| format!("Invalid sidecar command: {error}"))?;
        envelope.validate()?;
        Ok(envelope)
    }

    pub fn encode_line(&self) -> Result<Vec<u8>, String> {
        self.validate()?;
        let mut line = serde_json::to_vec(self)
            .map_err(|error| format!("Failed to encode sidecar command: {error}"))?;
        if line.len() > MAX_JSONL_BYTES {
            return Err("Sidecar command exceeds JSONL size limit".to_string());
        }
        line.push(b'\n');
        Ok(line)
    }

    pub fn validate(&self) -> Result<(), String> {
        validate_version(self.protocol_version)?;
        match &self.command {
            SidecarCommand::Ping { request_id } => validate_id("requestId", request_id),
            SidecarCommand::Configure {
                request_id,
                agent_dir,
            } => {
                validate_id("requestId", request_id)?;
                validate_text("agentDir", agent_dir, 4096)
            }
            SidecarCommand::OpenBook {
                request_id,
                book_id,
                path,
                sessions_dir,
            } => {
                validate_id("requestId", request_id)?;
                validate_id("bookId", book_id)?;
                validate_text("path", path, 4096)?;
                validate_text("sessionsDir", sessions_dir, 4096)
            }
            SidecarCommand::CloseBook {
                request_id,
                book_id,
            } => {
                validate_id("requestId", request_id)?;
                validate_optional_id("bookId", book_id)
            }
            SidecarCommand::Prompt {
                request_id,
                prompt_id,
                book_id,
                text,
                context,
            }
            | SidecarCommand::EditPrompt {
                request_id,
                prompt_id,
                book_id,
                text,
                context,
                ..
            } => {
                validate_id("requestId", request_id)?;
                validate_id("promptId", prompt_id)?;
                validate_id("bookId", book_id)?;
                validate_text("text", text, MAX_PROMPT_LENGTH)?;
                if let Some(selection) = context.as_ref().and_then(|value| value.selection.as_ref())
                {
                    validate_text("context.selection", selection, MAX_SELECTION_LENGTH)?;
                }
                if let Some(chapter_href) =
                    context.as_ref().and_then(|value| value.chapter_href.as_ref())
                {
                    validate_text("context.chapterHref", chapter_href, 4096)?;
                }
                Ok(())
            }
            SidecarCommand::Abort {
                request_id,
                prompt_id,
            } => {
                validate_id("requestId", request_id)?;
                validate_optional_id("promptId", prompt_id)
            }
            SidecarCommand::ListSessions {
                request_id,
                book_id,
            }
            | SidecarCommand::NewSession {
                request_id,
                book_id,
            } => {
                validate_id("requestId", request_id)?;
                validate_id("bookId", book_id)
            }
            SidecarCommand::SwitchSession {
                request_id,
                book_id,
                session_id,
            }
            | SidecarCommand::DeleteSession {
                request_id,
                book_id,
                session_id,
            } => {
                validate_id("requestId", request_id)?;
                validate_id("bookId", book_id)?;
                validate_id("sessionId", session_id)
            }
            SidecarCommand::RenameSession {
                request_id,
                book_id,
                session_id,
                title,
            } => {
                validate_id("requestId", request_id)?;
                validate_id("bookId", book_id)?;
                validate_id("sessionId", session_id)?;
                validate_text("title", title, MAX_RENAME_TITLE_LENGTH)
            }
        }
    }
}

impl EventEnvelope {
    pub fn decode_line(line: &str) -> Result<Self, String> {
        if line.len() > MAX_JSONL_BYTES {
            return Err("Sidecar event exceeds JSONL size limit".to_string());
        }
        let envelope: Self = serde_json::from_str(line)
            .map_err(|error| format!("Invalid sidecar event: {error}"))?;
        envelope.validate()?;
        Ok(envelope)
    }

    pub fn validate(&self) -> Result<(), String> {
        validate_version(self.protocol_version)?;
        if self.seq == 0 {
            return Err("Invalid sidecar event seq".to_string());
        }
        match &self.event {
            SidecarEvent::Ready => Ok(()),
            SidecarEvent::Pong { request_id, .. } => validate_optional_id("requestId", request_id),
            SidecarEvent::BookLoading {
                request_id,
                book_id,
            }
            | SidecarEvent::BookReady {
                request_id,
                book_id,
            } => {
                validate_optional_id("requestId", request_id)?;
                validate_id("bookId", book_id)
            }
            SidecarEvent::BookClosed {
                request_id,
                book_id,
            } => {
                validate_optional_id("requestId", request_id)?;
                validate_optional_id("bookId", book_id)
            }
            SidecarEvent::PromptStarted {
                request_id,
                book_id,
                session_id,
                prompt_id,
            }
            | SidecarEvent::PromptAborted {
                request_id,
                book_id,
                session_id,
                prompt_id,
            } => {
                validate_optional_id("requestId", request_id)?;
                validate_prompt_correlation(book_id, session_id, prompt_id)
            }
            SidecarEvent::TextDelta {
                book_id,
                session_id,
                prompt_id,
                delta,
            } => {
                validate_prompt_correlation(book_id, session_id, prompt_id)?;
                validate_text("delta", delta, MAX_PROMPT_LENGTH)
            }
            SidecarEvent::ToolStart {
                book_id,
                session_id,
                prompt_id,
                tool_call_id,
                tool,
                ..
            } => {
                validate_prompt_correlation(book_id, session_id, prompt_id)?;
                validate_id("toolCallId", tool_call_id)?;
                validate_text("tool", tool, MAX_ID_LENGTH)
            }
            SidecarEvent::ToolEnd {
                book_id,
                session_id,
                prompt_id,
                tool_call_id,
                ..
            } => {
                validate_prompt_correlation(book_id, session_id, prompt_id)?;
                validate_id("toolCallId", tool_call_id)
            }
            SidecarEvent::PromptEnd {
                book_id,
                session_id,
                prompt_id,
            } => validate_prompt_correlation(book_id, session_id, prompt_id),
            SidecarEvent::SessionCreated {
                request_id,
                book_id,
                session_id,
            }
            | SidecarEvent::SessionDeleted {
                request_id,
                book_id,
                session_id,
            } => {
                validate_optional_id("requestId", request_id)?;
                validate_id("bookId", book_id)?;
                validate_id("sessionId", session_id)
            }
            SidecarEvent::SessionRenamed {
                request_id,
                book_id,
                session_id,
                title,
            } => {
                validate_optional_id("requestId", request_id)?;
                validate_id("bookId", book_id)?;
                validate_id("sessionId", session_id)?;
                validate_text("title", title, MAX_RENAME_TITLE_LENGTH)
            }
            SidecarEvent::SessionSwitched {
                request_id,
                book_id,
                session_id,
                messages,
            } => {
                validate_optional_id("requestId", request_id)?;
                validate_id("bookId", book_id)?;
                validate_id("sessionId", session_id)?;
                validate_messages(messages)
            }
            SidecarEvent::SessionRewound {
                request_id,
                book_id,
                session_id,
                prompt_id,
                messages,
            } => {
                validate_optional_id("requestId", request_id)?;
                validate_prompt_correlation(book_id, session_id, prompt_id)?;
                validate_messages(messages)
            }
            SidecarEvent::SessionsList {
                request_id,
                book_id,
                sessions,
            } => {
                validate_optional_id("requestId", request_id)?;
                validate_id("bookId", book_id)?;
                validate_sessions(sessions)
            }
            SidecarEvent::Error {
                request_id,
                book_id,
                session_id,
                prompt_id,
                scope,
                message,
                ..
            } => {
                validate_optional_id("requestId", request_id)?;
                validate_optional_id("bookId", book_id)?;
                validate_optional_id("sessionId", session_id)?;
                validate_optional_id("promptId", prompt_id)?;
                validate_text("scope", scope, MAX_ID_LENGTH)?;
                validate_text("message", message, 4096)
            }
        }
    }
}

fn validate_version(version: u8) -> Result<(), String> {
    if version == AGENT_PROTOCOL_VERSION {
        Ok(())
    } else {
        Err(format!("Unsupported sidecar protocol version: {version}"))
    }
}

fn validate_id(field: &str, value: &str) -> Result<(), String> {
    validate_text(field, value, MAX_ID_LENGTH)
}

fn validate_optional_id(field: &str, value: &Option<String>) -> Result<(), String> {
    value
        .as_deref()
        .map_or(Ok(()), |value| validate_id(field, value))
}

fn validate_text(field: &str, value: &str, maximum: usize) -> Result<(), String> {
    if value.is_empty() || value.len() > maximum {
        Err(format!("Invalid {field}"))
    } else {
        Ok(())
    }
}

fn validate_bounded_text(field: &str, value: &str, maximum: usize) -> Result<(), String> {
    if value.len() > maximum {
        Err(format!("Invalid {field}"))
    } else {
        Ok(())
    }
}

fn validate_messages(messages: &[SerializedMessage]) -> Result<(), String> {
    for message in messages {
        validate_bounded_text(
            "message.content",
            &message.content,
            MAX_MESSAGE_CONTENT_LENGTH,
        )?;
        if let Some(tool_calls) = &message.tool_calls {
            for call in tool_calls {
                validate_id("toolCallId", &call.tool_call_id)?;
                validate_text("tool", &call.tool, MAX_ID_LENGTH)?;
            }
        }
    }
    Ok(())
}

fn validate_sessions(sessions: &[SessionSummary]) -> Result<(), String> {
    for session in sessions {
        validate_id("session.id", &session.id)?;
        validate_text("session.title", &session.title, MAX_SESSION_TITLE_LENGTH)?;
        validate_text(
            "session.createdAt",
            &session.created_at,
            MAX_TIMESTAMP_LENGTH,
        )?;
        validate_text(
            "session.updatedAt",
            &session.updated_at,
            MAX_TIMESTAMP_LENGTH,
        )?;
    }
    Ok(())
}

fn validate_prompt_correlation(
    book_id: &str,
    session_id: &str,
    prompt_id: &str,
) -> Result<(), String> {
    validate_id("bookId", book_id)?;
    validate_id("sessionId", session_id)?;
    validate_id("promptId", prompt_id)
}

#[cfg(test)]
mod tests {
    use super::{CommandEnvelope, EventEnvelope};
    use serde::Deserialize;
    use serde_json::Value;

    #[derive(Deserialize)]
    struct Fixture {
        direction: String,
        message: Value,
    }

    #[test]
    fn shared_protocol_fixtures_decode_and_round_trip() {
        for line in include_str!("../../protocol/agent-protocol.jsonl").lines() {
            let fixture: Fixture = serde_json::from_str(line).expect("fixture envelope");
            let encoded = if fixture.direction == "command" {
                let decoded: CommandEnvelope =
                    serde_json::from_value(fixture.message.clone()).expect("command fixture");
                decoded.validate().expect("valid command fixture");
                serde_json::to_value(decoded).expect("encoded command")
            } else {
                let decoded: EventEnvelope =
                    serde_json::from_value(fixture.message.clone()).expect("event fixture");
                decoded.validate().expect("valid event fixture");
                serde_json::to_value(decoded).expect("encoded event")
            };
            assert_eq!(encoded, fixture.message);
        }
    }

    #[test]
    fn prompt_context_accepts_chapter_href_and_rejects_chapter_index() {
        let with_href = r#"{"protocolVersion":1,"type":"prompt","requestId":"r","promptId":"p","bookId":"b","text":"hello","context":{"chapterHref":"OEBPS/ch1.xhtml"}}"#;
        let decoded = CommandEnvelope::decode_line(with_href).expect("chapterHref context");
        match decoded.command {
            super::SidecarCommand::Prompt { context, .. } => {
                assert_eq!(
                    context.and_then(|value| value.chapter_href),
                    Some("OEBPS/ch1.xhtml".to_string())
                );
            }
            other => panic!("expected prompt, got {other:?}"),
        }

        let with_index = r#"{"protocolVersion":1,"type":"prompt","requestId":"r","promptId":"p","bookId":"b","text":"hello","context":{"chapterIndex":3}}"#;
        assert!(CommandEnvelope::decode_line(with_index).is_err());
    }

    #[test]
    fn decoder_rejects_missing_prompt_correlation_and_invalid_seq() {
        let command =
            r#"{"protocolVersion":1,"type":"prompt","requestId":"r","bookId":"b","text":"hello"}"#;
        assert!(CommandEnvelope::decode_line(command).is_err());
        let event = r#"{"protocolVersion":1,"seq":0,"type":"ready"}"#;
        assert!(EventEnvelope::decode_line(event).is_err());
    }

    #[test]
    fn decoder_validates_nested_session_and_message_identifiers() {
        let invalid_session = format!(
            r#"{{"protocolVersion":1,"seq":1,"type":"sessions_list","requestId":"r","bookId":"b","sessions":[{{"id":"{}","title":"title","createdAt":"1","updatedAt":"1"}}]}}"#,
            "x".repeat(super::MAX_ID_LENGTH + 1),
        );
        assert!(EventEnvelope::decode_line(&invalid_session).is_err());

        let invalid_tool = format!(
            r#"{{"protocolVersion":1,"seq":1,"type":"session_switched","requestId":"r","bookId":"b","sessionId":"s","messages":[{{"role":"assistant","content":"","toolCalls":[{{"toolCallId":"{}","tool":"read_chapter","params":{{}},"done":false}}]}}]}}"#,
            "x".repeat(super::MAX_ID_LENGTH + 1),
        );
        assert!(EventEnvelope::decode_line(&invalid_tool).is_err());

        let tool_only_message = r#"{"protocolVersion":1,"seq":1,"type":"session_switched","requestId":"r","bookId":"b","sessionId":"s","messages":[{"role":"assistant","content":"","toolCalls":[{"toolCallId":"tool-1","tool":"read_chapter","params":{},"done":false}]}]}"#;
        assert!(EventEnvelope::decode_line(tool_only_message).is_ok());
    }

    #[test]
    fn command_encoder_appends_one_newline() {
        let command = CommandEnvelope::decode_line(
            r#"{"protocolVersion":1,"type":"ping","requestId":"request-1"}"#,
        )
        .expect("ping command");
        let encoded = command.encode_line().expect("encoded command");
        assert_eq!(encoded.last(), Some(&b'\n'));
        assert_eq!(encoded.iter().filter(|byte| **byte == b'\n').count(), 1);
    }
}
