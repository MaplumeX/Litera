//! Windows Thumbnail Provider for Litera
//!
//! Provides Windows Explorer thumbnail support for EPUB files.
//! Thumbnails are only shown when Litera is set as the default application
//! for the `.epub` file type.

#![allow(non_snake_case)]

mod com_provider;
mod extraction;

pub use extraction::*;