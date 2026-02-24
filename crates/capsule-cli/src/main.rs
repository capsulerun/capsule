pub mod cli;
pub mod commands;

use clap::Parser;
use std::fmt;
use std::path::Path;

use cli::{Cli, Commands};
use commands::{BuildError, RunError, build, run};

#[derive(Debug)]
pub enum CliError {
    RunError(String),
    BuildError(String),
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CliError::RunError(msg) => write!(f, "{}", msg),
            CliError::BuildError(msg) => write!(f, "{}", msg),
        }
    }
}

impl From<RunError> for CliError {
    fn from(err: RunError) -> Self {
        CliError::RunError(err.to_string())
    }
}

impl From<BuildError> for CliError {
    fn from(err: BuildError) -> Self {
        CliError::BuildError(err.to_string())
    }
}

#[tokio::main]
async fn main() -> Result<(), CliError> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Run {
            file,
            json,
            verbose,
            args,
        } => {
            let file_path = file.as_deref().map(Path::new);
            let result = run::execute(file_path, args, json, verbose).await?;

            if json {
                println!("{}", result);
            } else if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&result)
                && !parsed.get("result").is_none_or(|r| r.is_null())
            {
                println!("{}", result);
            }
        }
        Commands::Build { file } => {
            let file_path = file.as_deref().map(Path::new);
            build::execute(file_path).await?;
        }
    }

    Ok(())
}
