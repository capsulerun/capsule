use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct SourceFingerprint {
    pub files: BTreeMap<String, String>,
}

impl SourceFingerprint {
    const MANIFEST_FILENAME: &'static str = ".capsule_fingerprint.json";

    fn manifest_filename(key: Option<&str>) -> String {
        match key {
            Some(k) => format!(".capsule_fingerprint_{}.json", k),
            None => Self::MANIFEST_FILENAME.to_string(),
        }
    }

    pub fn load(cache_dir: &Path, key: Option<&str>) -> Self {
        let fingerprint_path = cache_dir.join(Self::manifest_filename(key));

        if fingerprint_path.exists()
            && let Ok(content) = fs::read_to_string(&fingerprint_path)
            && let Ok(fingerprint) = serde_json::from_str(&content)
        {
            return fingerprint;
        }

        Self::default()
    }

    pub fn save(&self, cache_dir: &Path, key: Option<&str>) -> std::io::Result<()> {
        let fingerprint_path = cache_dir.join(Self::manifest_filename(key));
        let content = serde_json::to_string_pretty(self)?;
        fs::write(fingerprint_path, content)
    }

    pub fn hash_file(path: &Path) -> Option<String> {
        let contents = fs::read(path).ok()?;
        Some(blake3::hash(&contents).to_hex().to_string())
    }

    pub fn collect_source_files(
        base_dir: &Path,
        extensions: &[&str],
        ignored_dirs: &[&str],
    ) -> Vec<PathBuf> {
        let mut files = Vec::new();
        Self::collect_files_recursive(base_dir, extensions, ignored_dirs, &mut files);
        files
    }

    fn collect_files_recursive(
        dir: &Path,
        extensions: &[&str],
        ignored_dirs: &[&str],
        files: &mut Vec<PathBuf>,
    ) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };

        for entry in entries.flatten() {
            let path = entry.path();

            if path.is_dir() {
                let dir_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

                if dir_name.starts_with('.') || ignored_dirs.contains(&dir_name) {
                    continue;
                }

                Self::collect_files_recursive(&path, extensions, ignored_dirs, files);
            } else if let Some(ext) = path.extension().and_then(|e| e.to_str())
                && extensions.contains(&ext)
            {
                files.push(path);
            }
        }
    }

    pub fn build(base_dir: &Path, extensions: &[&str], ignored_dirs: &[&str]) -> Self {
        let files = Self::collect_source_files(base_dir, extensions, ignored_dirs);
        let mut fingerprint = Self::default();

        for file_path in files {
            if let Some(hash) = Self::hash_file(&file_path) {
                let relative = file_path
                    .strip_prefix(base_dir)
                    .unwrap_or(&file_path)
                    .to_string_lossy()
                    .to_string();
                fingerprint.files.insert(relative, hash);
            }
        }

        fingerprint
    }

    pub fn has_changes(&self, other: &SourceFingerprint) -> bool {
        if self.files.len() != other.files.len() {
            return true;
        }

        for (path, hash) in &self.files {
            match other.files.get(path) {
                Some(other_hash) if hash == other_hash => continue,
                _ => return true,
            }
        }

        false
    }

    pub fn needs_rebuild(
        cache_dir: &Path,
        source_dir: &Path,
        output_path: &Path,
        extensions: &[&str],
        ignored_dirs: &[&str],
        key: Option<&str>,
    ) -> bool {
        if !output_path.exists() {
            return true;
        }
        let previous = Self::load(cache_dir, key);
        let current = Self::build(source_dir, extensions, ignored_dirs);
        current.has_changes(&previous)
    }

    pub fn update_after_build(
        cache_dir: &Path,
        source_dir: &Path,
        extensions: &[&str],
        ignored_dirs: &[&str],
        key: Option<&str>,
    ) -> std::io::Result<()> {
        let fingerprint = Self::build(source_dir, extensions, ignored_dirs);
        fingerprint.save(cache_dir, key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_consistency() {
        let hash1 = blake3::hash(b"hello world").to_hex().to_string();
        let hash2 = blake3::hash(b"hello world").to_hex().to_string();
        assert_eq!(hash1, hash2);

        let hash3 = blake3::hash(b"goodbye world").to_hex().to_string();
        assert_ne!(hash1, hash3);
    }

    #[test]
    fn test_fingerprint_no_changes() {
        let mut fingerprint1 = SourceFingerprint::default();
        fingerprint1
            .files
            .insert("main.py".to_string(), "abc123".to_string());

        let mut fingerprint2 = SourceFingerprint::default();
        fingerprint2
            .files
            .insert("main.py".to_string(), "abc123".to_string());

        assert!(!fingerprint1.has_changes(&fingerprint2));
    }

    #[test]
    fn test_fingerprint_content_changed() {
        let mut fingerprint1 = SourceFingerprint::default();
        fingerprint1
            .files
            .insert("main.py".to_string(), "abc123".to_string());

        let mut fingerprint2 = SourceFingerprint::default();
        fingerprint2
            .files
            .insert("main.py".to_string(), "xyz789".to_string());

        assert!(fingerprint1.has_changes(&fingerprint2));
    }

    #[test]
    fn test_fingerprint_file_added() {
        let mut fingerprint1 = SourceFingerprint::default();
        fingerprint1
            .files
            .insert("main.py".to_string(), "abc123".to_string());

        let mut fingerprint2 = SourceFingerprint::default();
        fingerprint2
            .files
            .insert("main.py".to_string(), "abc123".to_string());
        fingerprint2
            .files
            .insert("helper.py".to_string(), "def456".to_string());

        assert!(fingerprint1.has_changes(&fingerprint2));
    }

    #[test]
    fn test_fingerprint_file_deleted() {
        let mut fingerprint1 = SourceFingerprint::default();
        fingerprint1
            .files
            .insert("main.py".to_string(), "abc123".to_string());
        fingerprint1
            .files
            .insert("helper.py".to_string(), "def456".to_string());

        let mut fingerprint2 = SourceFingerprint::default();
        fingerprint2
            .files
            .insert("main.py".to_string(), "abc123".to_string());

        assert!(fingerprint1.has_changes(&fingerprint2));
    }
}
