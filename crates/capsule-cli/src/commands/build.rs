use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};

use capsule_core::config::manifest::{Manifest, ManifestError};

use capsule_core::wasm::compiler::javascript::{
    JavascriptWasmCompiler, JavascriptWasmCompilerError,
};
use capsule_core::wasm::compiler::python::{PythonWasmCompiler, PythonWasmCompilerError};
use capsule_core::wasm::runtime::Runtime;
use capsule_core::wasm::runtime::RuntimeConfig;
use capsule_core::wasm::runtime::WasmRuntimeError;
use capsule_core::wasm::utilities::task_reporter::TaskReporter;

pub enum BuildError {
    IoError(String),
    CompileFailed(String),
}

impl fmt::Display for BuildError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BuildError::IoError(msg) => write!(f, "{}", msg),
            BuildError::CompileFailed(msg) => write!(f, "Build failed: {}", msg),
        }
    }
}

impl From<std::io::Error> for BuildError {
    fn from(err: std::io::Error) -> Self {
        BuildError::IoError(err.to_string())
    }
}

impl From<PythonWasmCompilerError> for BuildError {
    fn from(err: PythonWasmCompilerError) -> Self {
        BuildError::CompileFailed(err.to_string())
    }
}

impl From<JavascriptWasmCompilerError> for BuildError {
    fn from(err: JavascriptWasmCompilerError) -> Self {
        BuildError::CompileFailed(err.to_string())
    }
}

impl From<ManifestError> for BuildError {
    fn from(err: ManifestError) -> Self {
        BuildError::CompileFailed(err.to_string())
    }
}

impl From<WasmRuntimeError> for BuildError {
    fn from(err: WasmRuntimeError) -> Self {
        BuildError::CompileFailed(err.to_string())
    }
}

pub type TaskRegistry = HashMap<String, serde_json::Value>;

pub struct CompileResult {
    pub wasm_path: PathBuf,
    pub cache_dir: PathBuf,
    pub task_registry: Option<TaskRegistry>,
}

pub fn compile_to_wasm(file_path: &Path, export: bool) -> Result<CompileResult, BuildError> {
    let extension = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("");

    match extension {
        "py" => {
            let compiler = PythonWasmCompiler::new(file_path)?;
            let wasm_path = compiler.compile_wasm(export)?;
            let task_registry = compiler.introspect_task_registry();

            Ok(CompileResult {
                wasm_path,
                cache_dir: compiler.cache_dir,
                task_registry,
            })
        }
        "js" | "mjs" | "ts" => {
            let compiler = JavascriptWasmCompiler::new(file_path)?;
            let wasm_path = compiler.compile_wasm(export)?;
            let task_registry = compiler.introspect_task_registry();

            Ok(CompileResult {
                wasm_path,
                cache_dir: compiler.cache_dir,
                task_registry,
            })
        }
        _ => Err(BuildError::CompileFailed(format!(
            "Unsupported file extension: '{}'. Supported: .py, .js, .mjs, .ts",
            extension
        ))),
    }
}

pub async fn execute(file_path: Option<&Path>, export: bool) -> Result<PathBuf, BuildError> {
    let manifest = Manifest::new()?;
    let mut reporter = TaskReporter::new(true);

    let file_path: PathBuf = match file_path {
        Some(path) => path.to_path_buf(),
        None => PathBuf::from(manifest.get_entrypoint()?),
    };

    reporter.start_progress("Compiling to WASM");
    let compile_result = compile_to_wasm(&file_path, export)?;
    reporter.finish_progress(Some("WASM compiled"));

    reporter.start_progress("Precompiling to native (cwasm)");

    let runtime_config = RuntimeConfig {
        cache_dir: compile_result.cache_dir,
        verbose: true,
    };
    let runtime = Runtime::new(runtime_config, manifest.capsule_toml)?;
    let cwasm_path = runtime.precompile(&compile_result.wasm_path)?;

    reporter.finish_progress(Some("Precompilation complete"));

    if export {
        reporter.success("Export complete.");
    }

    reporter.success("Build successful.");

    Ok(cwasm_path)
}
