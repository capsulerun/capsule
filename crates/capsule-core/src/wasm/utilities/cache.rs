use std::path::{Path, PathBuf};

use wasmtime::Engine;
use wasmtime::component::Component;

pub fn load_or_compile_component(
    engine: &Engine,
    wasm_path: &Path,
) -> Result<Component, wasmtime::Error> {
    let cwasm_path = wasm_path.with_extension("cwasm");

    let use_cached = if cwasm_path.exists() {
        let wasm_time = std::fs::metadata(wasm_path).and_then(|m| m.modified()).ok();
        let cwasm_time = std::fs::metadata(&cwasm_path)
            .and_then(|m| m.modified())
            .ok();

        match (wasm_time, cwasm_time) {
            (Some(w), Some(c)) => c > w,
            _ => false,
        }
    } else {
        false
    };

    if use_cached {
        unsafe { Component::deserialize_file(engine, &cwasm_path) }
    } else {
        let component = Component::from_file(engine, wasm_path)?;

        if let Ok(bytes) = component.serialize() {
            let _ = std::fs::write(&cwasm_path, bytes);
        }

        Ok(component)
    }
}

pub fn precompile_component(engine: &Engine, wasm_path: &Path) -> Result<PathBuf, wasmtime::Error> {
    let component = Component::from_file(engine, wasm_path)?;
    let cwasm_path = wasm_path.with_extension("cwasm");
    let bytes = component.serialize()?;
    std::fs::write(&cwasm_path, &bytes)
        .map_err(|e| wasmtime::Error::msg(format!("Failed to write cwasm: {}", e)))?;
    Ok(cwasm_path)
}

pub fn generate_wasm_filename(source_path: &Path) -> String {
    let stem = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("capsule");

    let path_str = source_path.to_string_lossy();
    let hash = blake3::hash(path_str.as_bytes()).to_hex();
    let hash_str = hash.as_str();
    let short_hash = &hash_str[..8];

    format!("{stem}_{short_hash}.wasm")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_generate_wasm_filename_basic() {
        let path = PathBuf::from("/project/main.ts");
        let filename = generate_wasm_filename(&path);
        assert!(filename.starts_with("main_"));
        assert!(filename.ends_with(".wasm"));
        assert_eq!(filename.len(), "main_".len() + 8 + ".wasm".len());
    }

    #[test]
    fn test_generate_wasm_filename_deterministic() {
        let path = PathBuf::from("/project/main.ts");
        let a = generate_wasm_filename(&path);
        let b = generate_wasm_filename(&path);
        assert_eq!(a, b);
    }

    #[test]
    fn test_generate_wasm_filename_different_dirs() {
        let a = generate_wasm_filename(&PathBuf::from("/project/src/main.ts"));
        let b = generate_wasm_filename(&PathBuf::from("/project/tasks/main.ts"));
        assert_ne!(a, b);
        assert!(a.starts_with("main_"));
        assert!(b.starts_with("main_"));
    }

    #[test]
    fn test_generate_wasm_filename_different_files() {
        let a = generate_wasm_filename(&PathBuf::from("/project/main.ts"));
        let b = generate_wasm_filename(&PathBuf::from("/project/other.ts"));
        assert_ne!(a, b);
        assert!(a.starts_with("main_"));
        assert!(b.starts_with("other_"));
    }
}
