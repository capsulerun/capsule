use std::fmt;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use capsule_core::config::manifest::{Manifest, ManifestError};
use capsule_core::wasm::commands::create::CreateInstance;
use capsule_core::wasm::commands::run::RunInstance;
use capsule_core::wasm::execution_policy::{Compute, ExecutionPolicy};
use capsule_core::wasm::runtime::{Runtime, RuntimeConfig, WasmRuntimeError};
use capsule_core::wasm::utilities::task_reporter::{LogLevel, TaskReporter};

use crate::commands::shared::load_env_variables;

pub enum ExecError {
    IoError(String),
    ExecutionFailed(String),
}

impl fmt::Display for ExecError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExecError::IoError(msg) => write!(f, "{}", msg),
            ExecError::ExecutionFailed(msg) => write!(f, "Execution failed: {}", msg),
        }
    }
}

impl From<std::io::Error> for ExecError {
    fn from(err: std::io::Error) -> Self {
        ExecError::IoError(err.to_string())
    }
}

impl From<WasmRuntimeError> for ExecError {
    fn from(err: WasmRuntimeError) -> Self {
        ExecError::ExecutionFailed(err.to_string())
    }
}

impl From<ManifestError> for ExecError {
    fn from(err: ManifestError) -> Self {
        ExecError::ExecutionFailed(err.to_string())
    }
}

pub async fn execute(
    wasm_path: &Path,
    args: Vec<String>,
    mounts: Vec<String>,
    json: bool,
    verbose: bool,
    shared_runtime: Option<Arc<Runtime>>,
) -> Result<String, ExecError> {
    let ext = wasm_path.extension().and_then(|e| e.to_str()).unwrap_or("");

    if ext != "wasm" && ext != "cwasm" {
        return Err(ExecError::IoError(format!(
            "Unsupported file type: '{}'. Expected a .wasm or .cwasm file.",
            wasm_path.display()
        )));
    }

    if !wasm_path.exists() {
        return Err(ExecError::IoError(format!(
            "File not found: '{}'. Run `capsule build` first to generate the artifact.",
            wasm_path.display()
        )));
    }

    let log_level = if json {
        LogLevel::Silent
    } else if verbose {
        LogLevel::Verbose
    } else {
        LogLevel::Normal
    };

    let mut reporter = TaskReporter::new(log_level.clone());

    let wasm_path_abs = wasm_path
        .canonicalize()
        .unwrap_or_else(|_| wasm_path.to_path_buf());

    let project_root = std::env::current_dir().unwrap_or_default();
    let cache_dir = project_root.join(".capsule");
    let wasm_dir = cache_dir.join("wasm");

    if !wasm_dir.exists() {
        std::fs::create_dir_all(&wasm_dir)?;
    }

    load_env_variables(&project_root).map_err(ExecError::IoError)?;

    let mut execution_policy = ExecutionPolicy::default().compute(Some(Compute::Custom(u64::MAX)));

    execution_policy.mounts.extend(mounts);

    let runtime = match shared_runtime {
        Some(r) => r,
        None => {
            reporter.start_progress("Initializing runtime");

            let capsule_toml = Manifest::new().map(|m| m.capsule_toml).unwrap_or_default();
            let runtime_config = RuntimeConfig {
                cache_dir,
                log_level,
            };
            let runtime = Runtime::new(runtime_config, capsule_toml)?;

            reporter.finish_progress(Some("Runtime ready"));
            runtime
        }
    };

    let create_instance_command = CreateInstance::new(execution_policy.clone(), args.clone())
        .wasm_path(wasm_path_abs)
        .project_root(project_root);

    let (store, instance, task_id) = runtime.execute(create_instance_command).await?;

    let start_time = Instant::now();

    let args_json = serde_json::json!({
        "task_name": "main",
        "args": args,
        "kwargs": {}
    })
    .to_string();

    let run_command = RunInstance::new(task_id, execution_policy, store, instance, args_json);
    let result = runtime.execute(run_command).await?;

    let elapsed = start_time.elapsed();
    let time_str = reporter.format_duration(elapsed);
    reporter.success(&format!("✓ Complete ({})", time_str));

    Ok(result)
}
