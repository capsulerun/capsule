use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::process::Stdio;

use crate::config::fingerprint::SourceFingerprint;
use crate::wasm::utilities::cache::generate_wasm_filename;
use crate::wasm::utilities::introspection::python::extract_python_task_configs;
use crate::wasm::utilities::wit_manager::WitManager;

pub enum PythonWasmCompilerError {
    CompileFailed(String),
    FsError(String),
}

impl fmt::Display for PythonWasmCompilerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PythonWasmCompilerError::CompileFailed(msg) => {
                write!(f, "Compilation failed > {}", msg)
            }
            PythonWasmCompilerError::FsError(msg) => write!(f, "File system error > {}", msg),
        }
    }
}

impl From<std::io::Error> for PythonWasmCompilerError {
    fn from(err: std::io::Error) -> Self {
        PythonWasmCompilerError::CompileFailed(err.to_string())
    }
}

impl From<std::time::SystemTimeError> for PythonWasmCompilerError {
    fn from(err: std::time::SystemTimeError) -> Self {
        PythonWasmCompilerError::FsError(err.to_string())
    }
}

pub struct PythonWasmCompiler {
    pub source_path: PathBuf,
    pub cache_dir: PathBuf,
    pub output_wasm: PathBuf,
}

impl PythonWasmCompiler {
    pub fn new(source_path: &Path) -> Result<Self, PythonWasmCompilerError> {
        let source_path = source_path.canonicalize().map_err(|e| {
            PythonWasmCompilerError::FsError(format!("Cannot resolve source path: {}", e))
        })?;

        let cache_dir = std::env::current_dir()
            .map_err(|e| {
                PythonWasmCompilerError::FsError(format!("Cannot get current directory: {}", e))
            })?
            .join(".capsule");

        let wasm_dir = cache_dir.join("wasm");

        if !wasm_dir.exists() {
            fs::create_dir_all(&wasm_dir)?;
        }

        let wasm_filename = generate_wasm_filename(&source_path);
        let output_wasm = wasm_dir.join(wasm_filename);

        Ok(Self {
            source_path,
            cache_dir,
            output_wasm,
        })
    }

    fn python_command() -> &'static str {
        if Command::new("python")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok()
        {
            "python"
        } else {
            "python3"
        }
    }

    fn normalize_path(path: &Path) -> PathBuf {
        let path_str = path.to_string_lossy();
        if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
        path.to_path_buf()
    }

    pub fn compile_wasm(&self, export: bool) -> Result<PathBuf, PythonWasmCompilerError> {
        let source_dir = self.source_path.parent().ok_or_else(|| {
            PythonWasmCompilerError::FsError("Cannot determine source directory".to_string())
        })?;

        if !SourceFingerprint::needs_rebuild(
            &self.cache_dir,
            source_dir,
            &self.output_wasm,
            &["py", "toml"],
            &["__pycache__"],
        ) {
            if export && let Some(file_stem) = self.source_path.file_stem() {
                let export_path = source_dir.join(file_stem).with_extension("wasm");
                let _ = fs::copy(&self.output_wasm, &export_path);
            }

            return Ok(self.output_wasm.clone());
        }

        let module_name = self
            .source_path
            .file_stem()
            .ok_or(PythonWasmCompilerError::FsError(
                "Invalid source file name".to_string(),
            ))?
            .to_str()
            .ok_or(PythonWasmCompilerError::FsError(
                "Invalid UTF-8 in file name".to_string(),
            ))?;

        let python_path = self
            .source_path
            .parent()
            .ok_or(PythonWasmCompilerError::FsError(
                "Cannot determine parent directory".to_string(),
            ))?;

        let wit_path = self.get_wit_path()?;
        let sdk_path = self.get_sdk_path()?;

        if !sdk_path.exists() {
            return Err(PythonWasmCompilerError::FsError(format!(
                "SDK directory not found: {}",
                sdk_path.display()
            )));
        }

        let bootloader_path = self.cache_dir.join("_capsule_boot.py");
        let bootloader_content = format!(
            r#"# Auto-generated bootloader for Capsule
import capsule.socket
capsule.socket._install()
import {module_name}
import capsule.app
capsule.app._main_module = {module_name}
from capsule.app import TaskRunner, exports
"#,
            module_name = module_name
        );

        fs::write(&bootloader_path, bootloader_content)?;

        let wit_path_normalized = Self::normalize_path(&wit_path);
        let cache_dir_normalized = Self::normalize_path(&self.cache_dir);
        let python_path_normalized = Self::normalize_path(python_path);
        let sdk_path_normalized = Self::normalize_path(&sdk_path);
        let output_wasm_normalized = Self::normalize_path(&self.output_wasm);

        let mut cmd = Command::new("componentize-py");
        cmd.arg("-d")
            .arg(&wit_path_normalized)
            .arg("-w")
            .arg("capsule-agent")
            .arg("componentize")
            .arg("_capsule_boot")
            .arg("-p")
            .arg(&cache_dir_normalized)
            .arg("-p")
            .arg(&python_path_normalized)
            .arg("-p")
            .arg(&sdk_path_normalized)
            .arg("-o")
            .arg(&output_wasm_normalized);

        let output = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).output()?;

        if !output.status.success() {
            return Err(PythonWasmCompilerError::CompileFailed(format!(
                "Compilation failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }

        self.cleanup_pycache(python_path);

        let _ = SourceFingerprint::update_after_build(
            &self.cache_dir,
            source_dir,
            &["py", "toml"],
            &["__pycache__"],
        );

        if export && let Some(file_stem) = self.source_path.file_stem() {
            let export_path = source_dir.join(file_stem).with_extension("wasm");
            let _ = fs::copy(&self.output_wasm, &export_path);
        }

        Ok(self.output_wasm.clone())
    }

    fn get_wit_path(&self) -> Result<PathBuf, PythonWasmCompilerError> {
        let wit_dir = self.cache_dir.join("wit");

        if !wit_dir.join("capsule.wit").exists() {
            WitManager::import_wit_deps(&wit_dir)?;
        }

        Ok(wit_dir)
    }

    fn get_sdk_path(&self) -> Result<PathBuf, PythonWasmCompilerError> {
        if let Ok(sdk_path) = self.find_python_sdk_path() {
            return Ok(sdk_path);
        }

        if let Ok(exe_path) = std::env::current_exe()
            && let Some(project_root) = exe_path
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
        {
            let sdk_path = project_root.join("crates/capsule-sdk/python/src");
            if sdk_path.exists() {
                return Ok(sdk_path);
            }
        }

        Err(PythonWasmCompilerError::FsError(
            "Cannot find SDK. Make sure to install capsule package.".to_string(),
        ))
    }

    fn find_python_sdk_path(&self) -> Result<PathBuf, PythonWasmCompilerError> {
        let python_cmd = Self::python_command();
        let output = Command::new(python_cmd)
            .arg("-c")
            .arg("import capsule; import os; print(os.path.dirname(os.path.dirname(capsule.__file__)), end='')")
            .output()
            .map_err(|e| {
                PythonWasmCompilerError::FsError(format!(
                    "Failed to execute '{}': {}. Make sure Python is installed and 'pip install capsule-run' was run.",
                    python_cmd, e
                ))
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(PythonWasmCompilerError::FsError(format!(
                "Cannot find 'capsule' module. Run 'pip install capsule-run' first. Python error: {}",
                stderr.trim()
            )));
        }

        let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();

        if path_str.is_empty() {
            return Err(PythonWasmCompilerError::FsError(
                "Python returned empty path for capsule package".to_string(),
            ));
        }

        let sdk_path = PathBuf::from(&path_str);

        if !sdk_path.exists() {
            return Err(PythonWasmCompilerError::FsError(format!(
                "SDK path from Python does not exist: {}",
                sdk_path.display()
            )));
        }

        Ok(sdk_path)
    }

    fn cleanup_pycache(&self, source_dir: &Path) {
        Self::remove_pycache_recursive(source_dir);
        Self::remove_pycache_recursive(&self.cache_dir);
    }

    fn remove_pycache_recursive(dir: &Path) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if path.file_name().is_some_and(|n| n == "__pycache__") {
                        let _ = fs::remove_dir_all(&path);
                    } else {
                        Self::remove_pycache_recursive(&path);
                    }
                }
            }
        }
    }

    pub fn introspect_task_registry(&self) -> Option<HashMap<String, serde_json::Value>> {
        let source = fs::read_to_string(&self.source_path).ok()?;
        extract_python_task_configs(&source)
    }
}
