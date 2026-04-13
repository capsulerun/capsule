use std::error::Error;
use std::fmt;
use std::path::{Path, PathBuf};

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum FileAccessMode {
    ReadOnly,

    #[default]
    ReadWrite,
}

#[derive(Debug)]
pub struct ParsedPath {
    pub path: PathBuf,
    pub guest_path: String,
    pub mode: FileAccessMode,
}

#[derive(Debug)]
pub enum PathValidationError {
    AbsolutePathNotAllowed(String),
    EscapesProjectDirectory(String),
    PathNotFound(String),
    InvalidMode(String),
}

impl fmt::Display for PathValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PathValidationError::AbsolutePathNotAllowed(path) => {
                write!(f, "Absolute paths are not allowed: {}", path)
            }
            PathValidationError::EscapesProjectDirectory(path) => {
                write!(f, "Path escapes project directory: {}", path)
            }
            PathValidationError::PathNotFound(path) => {
                write!(f, "Path does not exist: {}", path)
            }
            PathValidationError::InvalidMode(mode) => {
                write!(
                    f,
                    "Invalid access mode '{}'. Use :ro (read-only) or :rw (read-write)",
                    mode
                )
            }
        }
    }
}

impl Error for PathValidationError {}

fn parse_path_spec(path_spec: &str) -> (String, Option<String>, FileAccessMode) {
    let (spec, mode) = if path_spec.ends_with(":ro") {
        let stripped = path_spec.strip_suffix(":ro").unwrap();
        (stripped, FileAccessMode::ReadOnly)
    } else if path_spec.ends_with(":rw") {
        let stripped = path_spec.strip_suffix(":rw").unwrap();
        (stripped, FileAccessMode::ReadWrite)
    } else {
        (path_spec, FileAccessMode::default())
    };

    if let Some(idx) = spec.find("::") {
        let host = spec[..idx].to_string();
        let guest = spec[idx + 2..].to_string();
        (host, Some(guest), mode)
    } else {
        (spec.to_string(), None, mode)
    }
}

fn to_absolute_guest_path(path: &str) -> String {
    let stripped = path.trim_start_matches("./");

    if stripped.starts_with('/') {
        stripped.to_string()
    } else {
        format!("/{}", stripped)
    }
}

pub fn validate_path(
    path_spec: &str,
    project_root: &Path,
) -> Result<ParsedPath, PathValidationError> {
    let (host_str, guest_alias, mode) = parse_path_spec(path_spec);
    let p = Path::new(&host_str);

    if p.is_absolute() {
        return Err(PathValidationError::AbsolutePathNotAllowed(host_str));
    }

    let joined = project_root.join(p);
    let resolved = joined
        .canonicalize()
        .map_err(|_| PathValidationError::PathNotFound(host_str.clone()))?;

    let canonical_root = project_root
        .canonicalize()
        .map_err(|_| PathValidationError::EscapesProjectDirectory(host_str.clone()))?;

    if !resolved.starts_with(&canonical_root) {
        return Err(PathValidationError::EscapesProjectDirectory(host_str));
    }

    let raw_guest = guest_alias.unwrap_or_else(|| host_str.clone());
    let guest_path = to_absolute_guest_path(&raw_guest);

    Ok(ParsedPath {
        path: resolved,
        guest_path,
        mode,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_absolute_path_rejected() {
        let temp = std::env::temp_dir();

        let result = validate_path("/absolute/path", &temp);
        assert!(matches!(
            result,
            Err(PathValidationError::AbsolutePathNotAllowed(_))
        ));
    }

    #[test]
    fn test_relative_path_works() {
        let current = std::env::current_dir().unwrap();

        let test_dir = current.join(".capsule_test");
        let _ = fs::create_dir(&test_dir);

        let result = validate_path("./.capsule_test", &current);

        let _ = fs::remove_dir(&test_dir);

        assert!(result.is_ok());
        let parsed = result.unwrap();
        assert_eq!(parsed.guest_path, "/.capsule_test");
    }

    #[test]
    fn test_non_existent_path_fails() {
        let current = std::env::current_dir().unwrap();

        let result = validate_path("./nonexistent_dir", &current);
        assert!(matches!(result, Err(PathValidationError::PathNotFound(_))));
    }

    #[test]
    fn test_escape_project_root_rejected() {
        let temp = std::env::temp_dir();
        let subdir = temp.join("test_subdir");
        let _ = fs::create_dir(&subdir);

        let result = validate_path("../", &subdir);

        let _ = fs::remove_dir(&subdir);

        assert!(matches!(
            result,
            Err(PathValidationError::EscapesProjectDirectory(_))
        ));
    }

    #[test]
    fn test_parse_mode_readonly() {
        let (path, guest, mode) = parse_path_spec("./data:ro");
        assert_eq!(path, "./data");
        assert_eq!(guest, None);
        assert_eq!(mode, FileAccessMode::ReadOnly);
    }

    #[test]
    fn test_parse_mode_readwrite() {
        let (path, guest, mode) = parse_path_spec("./output:rw");
        assert_eq!(path, "./output");
        assert_eq!(guest, None);
        assert_eq!(mode, FileAccessMode::ReadWrite);
    }

    #[test]
    fn test_parse_mode_default() {
        let (path, guest, mode) = parse_path_spec("./data");
        assert_eq!(path, "./data");
        assert_eq!(guest, None);
        assert_eq!(mode, FileAccessMode::ReadWrite);
    }

    #[test]
    fn test_parse_alias() {
        let (path, guest, mode) = parse_path_spec("./data::workspace");
        assert_eq!(path, "./data");
        assert_eq!(guest, Some("workspace".to_string()));
        assert_eq!(mode, FileAccessMode::ReadWrite);
    }

    #[test]
    fn test_parse_alias_with_mode() {
        let (path, guest, mode) = parse_path_spec("./data::workspace:ro");
        assert_eq!(path, "./data");
        assert_eq!(guest, Some("workspace".to_string()));
        assert_eq!(mode, FileAccessMode::ReadOnly);
    }

    #[test]
    fn test_guest_path_normalization() {
        assert_eq!(to_absolute_guest_path("./data"), "/data");
        assert_eq!(to_absolute_guest_path("data"), "/data");
        assert_eq!(to_absolute_guest_path("/data"), "/data");
        assert_eq!(to_absolute_guest_path("/"), "/");
        assert_eq!(to_absolute_guest_path("workspace"), "/workspace");
        assert_eq!(to_absolute_guest_path("./nested/dir"), "/nested/dir");
    }
}
