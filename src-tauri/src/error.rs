use serde::Serialize;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum AppErrorCode {
    Cancelled,
    InvalidInput,
    BookNotFound,
    StorageCorrupt,
    StorageIo,
    RollbackFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: AppErrorCode,
    pub message: String,
}

impl AppError {
    pub fn new(code: AppErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn cancelled(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::Cancelled, message)
    }

    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::InvalidInput, message)
    }

    pub fn book_not_found(book_id: &str) -> Self {
        Self::new(
            AppErrorCode::BookNotFound,
            format!("Book not found: {book_id}"),
        )
    }

    pub fn storage_corrupt(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::StorageCorrupt, message)
    }

    pub fn storage_io(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::StorageIo, message)
    }

    pub fn rollback_failed(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::RollbackFailed, message)
    }
}

impl Display for AppError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for AppError {}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_error_serializes_as_the_frontend_contract() {
        let value = serde_json::to_value(AppError::invalid_input("bad input"))
            .expect("serialize app error");

        assert_eq!(value["code"], "InvalidInput");
        assert_eq!(value["message"], "bad input");
    }
}
