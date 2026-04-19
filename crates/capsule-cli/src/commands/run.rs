use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use capsule_core::config::manifest::{CapsuleToml, Manifest, ManifestError};
use capsule_core::wasm::commands::create::CreateInstance;
use capsule_core::wasm::commands::run::RunInstance;
use capsule_core::wasm::execution_policy::{Compute, ExecutionPolicy};
use capsule_core::wasm::runtime::{Runtime, RuntimeConfig, WasmRuntimeError};
use capsule_core::wasm::utilities::task_config::TaskConfig;
use capsule_core::wasm::utilities::task_reporter::{LogLevel, TaskReporter};
use tokio::sync::Mutex;

use crate::build::{BuildError, TaskRegistry, compile_to_wasm};
use crate::commands::shared::load_env_variables;

pub enum RunError {
    IoError(String),
    ExecutionFailed(String),
}

impl fmt::Display for RunError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RunError::IoError(msg) => write!(f, "{}", msg),
            RunError::ExecutionFailed(msg) => write!(f, "Execution failed: {}", msg),
        }
    }
}

impl From<std::io::Error> for RunError {
    fn from(err: std::io::Error) -> Self {
        RunError::IoError(err.to_string())
    }
}

impl From<BuildError> for RunError {
    fn from(err: BuildError) -> Self {
        RunError::ExecutionFailed(err.to_string())
    }
}

impl From<WasmRuntimeError> for RunError {
    fn from(err: WasmRuntimeError) -> Self {
        RunError::ExecutionFailed(err.to_string())
    }
}

impl From<ManifestError> for RunError {
    fn from(err: ManifestError) -> Self {
        RunError::ExecutionFailed(err.to_string())
    }
}

fn extract_main_execution_policy(
    task_registry: Option<TaskRegistry>,
    capsule_toml: &CapsuleToml,
) -> Option<ExecutionPolicy> {
    let registry = task_registry?;
    let main_config = registry.get("main")?;
    let task_config: TaskConfig = serde_json::from_value(main_config.clone()).ok()?;

    Some(task_config.to_execution_policy(capsule_toml))
}

async fn resolve_wasm(
    file_path: &Path,
    reporter: &mut TaskReporter,
    wasm_cache: Option<Arc<Mutex<HashMap<String, PathBuf>>>>,
) -> Result<(PathBuf, Option<TaskRegistry>, PathBuf), RunError> {
    if let Some(cache) = wasm_cache {
        let cache_key = file_path.to_string_lossy().to_string();

        if let Some(wasm_path) = cache.lock().await.get(&cache_key).cloned() {
            let cache_dir = std::env::current_dir().unwrap_or_default().join(".capsule");
            return Ok((wasm_path, None, cache_dir));
        }

        reporter.start_progress("Preparing environment");

        let compile_result = tokio::task::spawn_blocking({
            let file_path = file_path.to_path_buf();
            move || compile_to_wasm(&file_path, false)
        })
        .await
        .map_err(|e| RunError::IoError(e.to_string()))??;

        reporter.finish_progress(Some("Environment ready"));

        cache
            .lock()
            .await
            .insert(cache_key, compile_result.wasm_path.clone());

        Ok((
            compile_result.wasm_path,
            compile_result.task_registry,
            compile_result.cache_dir,
        ))
    } else {
        reporter.start_progress("Preparing environment");

        let compile_result = tokio::task::spawn_blocking({
            let file_path = file_path.to_path_buf();
            move || compile_to_wasm(&file_path, false)
        })
        .await
        .map_err(|e| RunError::IoError(e.to_string()))??;

        reporter.finish_progress(Some("Environment ready"));

        Ok((
            compile_result.wasm_path,
            compile_result.task_registry,
            compile_result.cache_dir,
        ))
    }
}

pub async fn execute(
    file_path: Option<&Path>,
    args: Vec<String>,
    mounts: Vec<String>,
    json: bool,
    verbose: bool,
    shared_runtime: Option<Arc<Runtime>>,
    wasm_cache: Option<Arc<Mutex<HashMap<String, PathBuf>>>>,
) -> Result<String, RunError> {
    let manifest = Manifest::new()?;

    let log_level = if json {
        LogLevel::Silent
    } else if verbose {
        LogLevel::Verbose
    } else {
        LogLevel::Normal
    };

    let mut reporter = TaskReporter::new(log_level.clone());

    let file_path: PathBuf = match file_path {
        Some(path) => path.to_path_buf(),
        None => PathBuf::from(manifest.get_entrypoint()?),
    };

    let (wasm_path, task_registry, cache_dir) =
        resolve_wasm(&file_path, &mut reporter, wasm_cache).await?;

    let project_root = std::env::current_dir().unwrap_or_else(|_| {
        file_path
            .canonicalize()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_default()
    });

    load_env_variables(&project_root).map_err(RunError::IoError)?;

    let mut execution_policy = extract_main_execution_policy(task_registry, &manifest.capsule_toml)
        .unwrap_or_else(|| ExecutionPolicy::default().compute(Some(Compute::Custom(u64::MAX))));

    execution_policy.mounts.extend(mounts);

    let runtime = match shared_runtime {
        Some(r) => r,
        None => {
            reporter.start_progress("Initializing runtime");

            let runtime_config = RuntimeConfig {
                cache_dir,
                log_level,
            };
            let runtime = Runtime::new(runtime_config, manifest.capsule_toml)?;

            reporter.finish_progress(Some("Runtime ready"));
            runtime
        }
    };

    let create_instance_command = CreateInstance::new(execution_policy.clone(), args.clone())
        .wasm_path(wasm_path)
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
