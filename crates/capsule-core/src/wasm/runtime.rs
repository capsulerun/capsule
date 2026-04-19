use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::{Mutex, RwLock};
use wasmtime::component::Component;
use wasmtime::{Config, Engine};

use crate::config::log::{Log, LogError};
use crate::config::manifest::CapsuleToml;
use crate::wasm::utilities::cache::precompile_component;
use crate::wasm::utilities::task_reporter::{LogLevel, TaskReporter};

pub enum WasmRuntimeError {
    WasmtimeError(wasmtime::Error),
    LogError(LogError),
    ConfigError(String),
    FilesystemError(String),
    SerializationError(String),
    Timeout,
}

impl fmt::Display for WasmRuntimeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WasmRuntimeError::WasmtimeError(msg) => {
                write!(f, "{}", msg)
            }
            WasmRuntimeError::LogError(msg) => write!(f, "{}", msg),
            WasmRuntimeError::ConfigError(msg) => write!(f, "{}", msg),
            WasmRuntimeError::FilesystemError(msg) => {
                write!(f, "{}", msg)
            }
            WasmRuntimeError::SerializationError(msg) => {
                write!(f, "{}", msg)
            }
            WasmRuntimeError::Timeout => write!(f, "Timeout"),
        }
    }
}

impl From<wasmtime::Error> for WasmRuntimeError {
    fn from(err: wasmtime::Error) -> Self {
        WasmRuntimeError::WasmtimeError(err)
    }
}

impl From<LogError> for WasmRuntimeError {
    fn from(err: LogError) -> Self {
        WasmRuntimeError::LogError(err)
    }
}

pub trait RuntimeCommand {
    type Output;
    fn execute(
        self,
        runtime: Arc<Runtime>,
    ) -> impl Future<Output = Result<Self::Output, WasmRuntimeError>> + Send;
}

pub struct RuntimeConfig {
    pub cache_dir: PathBuf,
    pub log_level: LogLevel,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            cache_dir: PathBuf::from(".capsule"),
            log_level: LogLevel::Normal,
        }
    }
}

pub struct Runtime {
    pub(crate) engine: Engine,
    pub(crate) log: Log,

    #[allow(dead_code)]
    pub(crate) cache_dir: PathBuf,

    pub log_level: LogLevel,

    component: RwLock<HashMap<PathBuf, Component>>,
    pub task_reporter: Arc<Mutex<TaskReporter>>,
    pub capsule_toml: CapsuleToml,
}

impl Runtime {
    pub fn new(
        config: RuntimeConfig,
        capsule_toml: CapsuleToml,
    ) -> Result<Arc<Self>, WasmRuntimeError> {
        let mut engine_config = Config::new();
        let db_path = config.cache_dir.join("trace.db");
        let log = Log::new(
            Some(
                db_path
                    .parent()
                    .expect("Cache dir is empty")
                    .to_str()
                    .expect("failed to get cache dir"),
            ),
            db_path
                .file_name()
                .expect("Cache dir is empty")
                .to_str()
                .expect("failed to get cache dir"),
        )?;

        engine_config.wasm_component_model(true);
        engine_config.async_support(true);
        engine_config.consume_fuel(true);

        let task_reporter = Arc::new(Mutex::new(TaskReporter::new(config.log_level.clone())));

        Ok(Arc::new(Self {
            engine: Engine::new(&engine_config)?,
            log,
            cache_dir: config.cache_dir,
            log_level: config.log_level,
            component: RwLock::new(HashMap::new()),
            task_reporter,
            capsule_toml,
        }))
    }

    pub async fn execute<C: RuntimeCommand>(
        self: &Arc<Self>,
        command: C,
    ) -> Result<C::Output, WasmRuntimeError> {
        command.execute(Arc::clone(self)).await
    }

    pub async fn get_component(&self, wasm_path: &PathBuf) -> Option<Component> {
        self.component.read().await.get(wasm_path).cloned()
    }

    pub async fn set_component(&self, wasm_path: PathBuf, component: Component) {
        self.component.write().await.insert(wasm_path, component);
    }

    pub fn precompile(
        &self,
        wasm_path: &std::path::Path,
    ) -> Result<std::path::PathBuf, WasmRuntimeError> {
        precompile_component(&self.engine, wasm_path).map_err(WasmRuntimeError::WasmtimeError)
    }
}
