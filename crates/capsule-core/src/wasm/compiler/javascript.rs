use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::config::fingerprint::SourceFingerprint;
use crate::wasm::utilities::cache::generate_wasm_filename;
use crate::wasm::utilities::introspection::javascript::extract_js_task_configs;
use crate::wasm::utilities::wit_manager::WitManager;

#[derive(Debug)]
pub enum JavascriptWasmCompilerError {
    FsError(String),
    CommandFailed(String),
    CompileFailed(String),
}

impl fmt::Display for JavascriptWasmCompilerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            JavascriptWasmCompilerError::FsError(msg) => write!(f, "Filesystem error > {}", msg),
            JavascriptWasmCompilerError::CommandFailed(msg) => {
                write!(f, "Command failed > {}", msg)
            }
            JavascriptWasmCompilerError::CompileFailed(msg) => {
                write!(f, "Compilation failed > {}", msg)
            }
        }
    }
}

impl From<std::io::Error> for JavascriptWasmCompilerError {
    fn from(err: std::io::Error) -> Self {
        JavascriptWasmCompilerError::FsError(err.to_string())
    }
}

impl From<std::time::SystemTimeError> for JavascriptWasmCompilerError {
    fn from(err: std::time::SystemTimeError) -> Self {
        JavascriptWasmCompilerError::FsError(err.to_string())
    }
}

pub struct JavascriptWasmCompiler {
    pub source_path: PathBuf,
    pub cache_dir: PathBuf,
    pub output_wasm: PathBuf,
}

impl JavascriptWasmCompiler {
    pub fn new(source_path: &Path) -> Result<Self, JavascriptWasmCompilerError> {
        let source_path = source_path.canonicalize().map_err(|e| {
            JavascriptWasmCompilerError::FsError(format!("Cannot resolve source path: {}", e))
        })?;

        let cache_dir = std::env::current_dir()
            .map_err(|e| {
                JavascriptWasmCompilerError::FsError(format!("Cannot get current directory: {}", e))
            })?
            .join(".capsule");

        let wasm_dir = cache_dir.join("wasm");
        fs::create_dir_all(&wasm_dir)?;

        let wasm_filename = generate_wasm_filename(&source_path);
        let output_wasm = wasm_dir.join(wasm_filename);

        Ok(Self {
            source_path,
            cache_dir,
            output_wasm,
        })
    }

    fn npx_command() -> Command {
        if Command::new("npx.cmd")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok()
        {
            Command::new("npx.cmd")
        } else {
            Command::new("npx")
        }
    }

    fn normalize_path_for_command(path: &Path) -> PathBuf {
        let path_str = path.to_string_lossy();
        if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
        path.to_path_buf()
    }

    fn normalize_path_for_import(path: &Path) -> String {
        Self::normalize_path_for_command(path)
            .to_string_lossy()
            .replace('\\', "/")
    }

    fn find_node_modules(root_dir: &Path) -> Option<PathBuf> {
        let mut current = root_dir.to_path_buf();
        loop {
            let node_modules = current.join("node_modules");
            if node_modules.exists() && node_modules.is_dir() {
                return Some(node_modules);
            }
            if !current.pop() {
                return None;
            }
        }
    }

    pub fn compile_wasm(&self, export: bool) -> Result<PathBuf, JavascriptWasmCompilerError> {
        let source_dir = self.source_path.parent().ok_or_else(|| {
            JavascriptWasmCompilerError::FsError("Cannot determine source directory".to_string())
        })?;

        if !SourceFingerprint::needs_rebuild(
            &self.cache_dir,
            source_dir,
            &self.output_wasm,
            &["js", "ts", "toml"],
            &["node_modules", "dist"],
            Some("js"),
        ) {
            if export && let Some(file_stem) = self.source_path.file_stem() {
                let export_path = source_dir.join(file_stem).with_extension("wasm");
                let _ = fs::copy(&self.output_wasm, &export_path);
            }

            return Ok(self.output_wasm.clone());
        }

        let wit_path = self.get_wit_path()?;
        let sdk_path = self.get_sdk_path()?;

        let source_for_import = if self.source_path.extension().is_some_and(|ext| ext == "ts") {
            self.transpile_typescript()?
        } else {
            self.source_path.clone()
        };

        let wrapper_path = self.cache_dir.join("_capsule_boot.js");
        let bundled_path = self.cache_dir.join("_capsule_bundled.js");

        let import_path = Self::normalize_path_for_import(
            &source_for_import
                .canonicalize()
                .unwrap_or_else(|_| source_for_import.to_path_buf()),
        );

        let sdk_path_str = Self::normalize_path_for_import(&sdk_path);

        let wrapper_content = format!(
            r#"// Auto-generated bootloader for Capsule
import * as hostApi from 'capsule:host/api';
import * as fsTypes from 'wasi:filesystem/types@0.2.0';
import * as fsPreopens from 'wasi:filesystem/preopens@0.2.0';
import * as environment from 'wasi:cli/environment@0.2.0';
import * as stdinApi from 'wasi:cli/stdin@0.2.0';
import * as stdoutApi from 'wasi:cli/stdout@0.2.0';
globalThis['capsule:host/api'] = hostApi;
globalThis['wasi:filesystem/types'] = fsTypes;
globalThis['wasi:filesystem/preopens'] = fsPreopens;
globalThis['wasi:cli/environment'] = environment;
globalThis['wasi:cli/stdin'] = stdinApi;
globalThis['wasi:cli/stdout'] = stdoutApi;
import '{}';
import {{ exports, incomingHandler }} from '{}/dist/app.js';
export const taskRunner = exports;
export {{ incomingHandler }};
            "#,
            import_path, sdk_path_str
        );

        fs::write(&wrapper_path, wrapper_content)?;

        let wrapper_path_normalized = Self::normalize_path_for_command(&wrapper_path);
        let bundled_path_normalized = Self::normalize_path_for_command(&bundled_path);
        let wit_path_normalized = Self::normalize_path_for_command(&wit_path);
        let sdk_path_normalized = Self::normalize_path_for_command(&sdk_path);
        let output_wasm_normalized = Self::normalize_path_for_command(&self.output_wasm);

        let os_polyfill_path = sdk_path_normalized.join("dist/polyfills/os.js");
        let process_polyfill_path = sdk_path_normalized.join("dist/polyfills/process.js");
        let fs_polyfill_path = sdk_path_normalized.join("dist/polyfills/fs.js");
        let mut esbuild_cmd = Self::npx_command();
        esbuild_cmd
            .arg("esbuild")
            .arg(&wrapper_path_normalized)
            .arg("--bundle")
            .arg("--format=esm")
            .arg("--platform=neutral")
            .arg("--main-fields=main,module")
            .arg("--external:capsule:host/api")
            .arg("--external:wasi:filesystem/*")
            .arg("--external:wasi:cli/*")
            .arg(format!("--inject:{}", process_polyfill_path.display()))
            .arg(format!("--alias:os={}", os_polyfill_path.display()))
            .arg(format!("--alias:node:os={}", os_polyfill_path.display()))
            .arg(format!(
                "--alias:process={}",
                process_polyfill_path.display()
            ))
            .arg(format!(
                "--alias:node:process={}",
                process_polyfill_path.display()
            ))
            .arg(format!("--alias:fs={}", fs_polyfill_path.display()))
            .arg(format!("--alias:node:fs={}", fs_polyfill_path.display()))
            .arg(format!(
                "--alias:fs/promises={}",
                sdk_path_normalized
                    .join("dist/polyfills/fs-promises.js")
                    .display()
            ))
            .arg(format!(
                "--alias:node:fs/promises={}",
                sdk_path_normalized
                    .join("dist/polyfills/fs-promises.js")
                    .display()
            ));

        let bundled_unenv_dir = sdk_path_normalized.join("dist/polyfills/unenv-runtime");
        let bundled_node_dir = bundled_unenv_dir.join("node");
        esbuild_cmd.arg(format!("--alias:unenv={}", bundled_unenv_dir.display()));
        let mut stack = vec![(bundled_node_dir, String::new())];
        while let Some((dir, prefix)) = stack.pop() {
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };

            for entry in entries.flatten() {
                let path = entry.path();
                let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };

                if path.is_file() {
                    if let Some(stripped) = name.strip_suffix(".mjs") {
                        let mod_name = format!("{}{}", prefix, stripped);
                        if !matches!(mod_name.as_str(), "os" | "process" | "fs" | "fs/promises") {
                            esbuild_cmd.arg(format!(
                                "--alias:node:{}={}",
                                mod_name,
                                path.display()
                            ));
                            esbuild_cmd.arg(format!("--alias:{}={}", mod_name, path.display()));
                        }
                    }
                } else {
                    stack.push((path.clone(), format!("{}{}/", prefix, name)));
                }
            }
        }

        let esbuild_output = esbuild_cmd
            .arg(format!("--outfile={}", bundled_path_normalized.display()))
            .current_dir(&sdk_path_normalized)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()?;

        if !esbuild_output.status.success() {
            return Err(JavascriptWasmCompilerError::CompileFailed(format!(
                "Bundling failed: {}",
                String::from_utf8_lossy(&esbuild_output.stderr).trim()
            )));
        }

        let jco_output = Self::npx_command()
            .arg("jco")
            .arg("componentize")
            .arg(&bundled_path_normalized)
            .arg("--wit")
            .arg(&wit_path_normalized)
            .arg("--world-name")
            .arg("capsule-agent")
            .arg("--enable")
            .arg("http")
            .arg("-o")
            .arg(&output_wasm_normalized)
            .current_dir(&sdk_path_normalized)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()?;

        if !jco_output.status.success() {
            return Err(JavascriptWasmCompilerError::CompileFailed(format!(
                "Component creation failed: {}",
                String::from_utf8_lossy(&jco_output.stderr).trim()
            )));
        }

        let _ = SourceFingerprint::update_after_build(
            &self.cache_dir,
            source_dir,
            &["js", "ts", "toml"],
            &["node_modules", "dist"],
            Some("js"),
        );

        if export && let Some(file_stem) = self.source_path.file_stem() {
            let export_path = source_dir.join(file_stem).with_extension("wasm");
            let _ = fs::copy(&self.output_wasm, &export_path);
        }

        Ok(self.output_wasm.clone())
    }

    fn get_wit_path(&self) -> Result<PathBuf, JavascriptWasmCompilerError> {
        let wit_dir = self.cache_dir.join("wit");

        if !wit_dir.join("capsule.wit").exists() {
            WitManager::import_wit_deps(&wit_dir)?;
        }

        Ok(wit_dir)
    }

    fn get_sdk_path(&self) -> Result<PathBuf, JavascriptWasmCompilerError> {
        if let Some(source_dir) = self.source_path.parent()
            && let Some(node_modules) = Self::find_node_modules(source_dir)
        {
            let sdk_path = node_modules.join("@capsule-run/sdk");
            if sdk_path.exists() {
                return Ok(sdk_path);
            }
        }

        if let Ok(exe_path) = std::env::current_exe()
            && let Some(project_root) = exe_path
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
        {
            let sdk_path = project_root.join("crates/capsule-sdk/javascript");
            if sdk_path.exists() {
                return Ok(sdk_path);
            }
        }

        Err(JavascriptWasmCompilerError::FsError(
            "Could not find JavaScript SDK.".to_string(),
        ))
    }

    fn transpile_typescript(&self) -> Result<PathBuf, JavascriptWasmCompilerError> {
        let output_path = self.cache_dir.join(
            self.source_path
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| format!("{}.js", s))
                .ok_or_else(|| {
                    JavascriptWasmCompilerError::FsError("Invalid source filename".to_string())
                })?,
        );

        let source_dir = self.source_path.parent().ok_or_else(|| {
            JavascriptWasmCompilerError::FsError("Cannot determine source directory".to_string())
        })?;

        let cache_dir_normalized = Self::normalize_path_for_command(&self.cache_dir);

        let mut cmd = Self::npx_command();
        cmd.arg("tsc");

        let tsconfig_path = source_dir.join("tsconfig.json");
        if tsconfig_path.exists() {
            cmd.arg("--project")
                .arg(Self::normalize_path_for_command(&tsconfig_path));
        } else {
            cmd.arg(Self::normalize_path_for_command(&self.source_path))
                .arg("--module")
                .arg("esnext")
                .arg("--target")
                .arg("esnext")
                .arg("--moduleResolution")
                .arg("bundler")
                .arg("--esModuleInterop")
                .arg("--skipLibCheck");
        }

        let output = cmd
            .arg("--outDir")
            .arg(&cache_dir_normalized)
            .arg("--rootDir")
            .arg(Self::normalize_path_for_command(source_dir))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()?;

        if !output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);

            return Err(JavascriptWasmCompilerError::CompileFailed(format!(
                "TypeScript compilation failed: {}{}",
                stderr.trim(),
                if !stdout.is_empty() {
                    format!("\nstdout: {}", stdout.trim())
                } else {
                    String::new()
                }
            )));
        }

        if !output_path.exists() {
            return Err(JavascriptWasmCompilerError::FsError(format!(
                "TypeScript transpilation did not produce expected output: {}",
                output_path.display()
            )));
        }

        Ok(output_path)
    }

    pub fn introspect_task_registry(&self) -> Option<HashMap<String, serde_json::Value>> {
        let source = fs::read_to_string(&self.source_path).ok()?;
        let is_typescript = self
            .source_path
            .extension()
            .is_some_and(|ext| ext == "ts" || ext == "mts");
        extract_js_task_configs(&source, is_typescript)
    }
}
