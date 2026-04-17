use std::fmt;
use std::path::Path;
use std::sync::Arc;

use capsule_core::config::manifest::Manifest;
use capsule_core::wasm::runtime::{Runtime, RuntimeConfig};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

use crate::commands::exec::ExecError;
use crate::commands::run::RunError;

const RESPONSE_CHANNEL_SIZE: usize = 64;

#[derive(Debug)]
pub enum WorkerError {
    IoError(String),
    RuntimeError(String),
}

impl fmt::Display for WorkerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WorkerError::IoError(msg) => write!(f, "{}", msg),
            WorkerError::RuntimeError(msg) => write!(f, "{}", msg),
        }
    }
}

impl From<std::io::Error> for WorkerError {
    fn from(err: std::io::Error) -> Self {
        WorkerError::IoError(err.to_string())
    }
}

#[derive(Debug, Deserialize)]
pub struct WorkerRequest {
    pub id: String,
    pub file: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub mounts: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct WorkerResponse {
    pub id: String,
    #[serde(flatten)]
    pub result: WorkerResult,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum WorkerResult {
    Ok { output: serde_json::Value },
    Err { error: String },
}

pub async fn execute() -> Result<(), WorkerError> {
    let project_root = std::env::current_dir().unwrap_or_default();
    let cache_dir = project_root.join(".capsule");
    std::fs::create_dir_all(&cache_dir)?;

    let capsule_toml = Manifest::new().map(|m| m.capsule_toml).unwrap_or_default();
    let runtime_config = RuntimeConfig {
        cache_dir,
        verbose: false,
    };

    let runtime = Runtime::new(runtime_config, capsule_toml)
        .map_err(|e| WorkerError::RuntimeError(e.to_string()))?;

    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();

    let (tx, mut rx) = mpsc::channel::<WorkerResponse>(RESPONSE_CHANNEL_SIZE);

    tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(response) = rx.recv().await {
            if let Ok(mut json) = serde_json::to_string(&response) {
                json.push('\n');
                let _ = stdout.write_all(json.as_bytes()).await;
                let _ = stdout.flush().await;
            }
        }
    });

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        let tx = tx.clone();

        let request: WorkerRequest = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                let _ = tx
                    .send(WorkerResponse {
                        id: "unknown".to_string(),
                        result: WorkerResult::Err {
                            error: format!("Failed to parse request: {}", e),
                        },
                    })
                    .await;
                continue;
            }
        };

        let runtime = Arc::clone(&runtime);

        tokio::spawn(async move {
            let result = dispatch(request.file, request.args, request.mounts, runtime).await;

            let response = WorkerResponse {
                id: request.id,
                result: match result {
                    Ok(output) => match serde_json::from_str(&output) {
                        Ok(value) => WorkerResult::Ok { output: value },
                        Err(_) => WorkerResult::Ok {
                            output: serde_json::Value::String(output),
                        },
                    },
                    Err(e) => WorkerResult::Err { error: e },
                },
            };

            let _ = tx.send(response).await;
        });
    }

    Ok(())
}

async fn dispatch(
    file: String,
    args: Vec<String>,
    mounts: Vec<String>,
    runtime: Arc<Runtime>,
) -> Result<String, String> {
    use std::ffi::OsStr;

    let ext = Path::new(&file)
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "wasm" | "cwasm" => super::exec::execute_with_runtime(
            Path::new(&file),
            args,
            mounts,
            true,
            false,
            Some(runtime),
        )
        .await
        .map_err(|e: ExecError| e.to_string()),
        _ => super::run::execute_with_runtime(
            Some(Path::new(&file)),
            args,
            mounts,
            true,
            false,
            Some(runtime),
        )
        .await
        .map_err(|e: RunError| e.to_string()),
    }
}
