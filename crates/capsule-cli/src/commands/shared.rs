use std::path::Path;

pub fn load_args_file(path: &str) -> Result<Vec<String>, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read --args-file '{}': {}", path, e))?;
    let args: Vec<String> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse --args-file '{}': {}", path, e))?;
    Ok(args)
}

pub fn load_env_variables(project_root: &Path) -> Result<(), String> {
    let env_files = [".env", ".env.local", ".env.development", ".env.production"];

    for file_name in env_files {
        let file_path = project_root.join(file_name);

        if file_path.exists() {
            dotenvy::from_path(&file_path)
                .map_err(|e| format!("Failed to load {}: {}", file_path.display(), e))?;
        }
    }

    Ok(())
}
