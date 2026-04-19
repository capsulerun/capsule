pub mod cli;
pub mod commands;

use clap::Parser;
use std::fmt;
use std::path::Path;

use cli::{Cli, Commands};
use commands::shared::load_args_file;
use commands::{BuildError, ExecError, RunError, build, exec, run, worker};

#[derive(Debug)]
pub enum CliError {
    RunError(String),
    BuildError(String),
    ExecError(String),
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CliError::RunError(msg) => write!(f, "{}", msg),
            CliError::BuildError(msg) => write!(f, "{}", msg),
            CliError::ExecError(msg) => write!(f, "{}", msg),
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

impl From<ExecError> for CliError {
    fn from(err: ExecError) -> Self {
        CliError::ExecError(err.to_string())
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
            mount,
            args_file,
            args,
        } => {
            let args = match args_file {
                Some(ref path) => load_args_file(path).map_err(CliError::RunError)?,
                None => args,
            };
            let file_path = file.as_deref().map(Path::new);
            let result = run::execute(file_path, args, mount, json, verbose, None, None).await?;

            if json {
                println!("{}", result);
            } else if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&result)
                && !parsed.get("result").is_none_or(|r| r.is_null())
            {
                println!("{}", result);
            }
        }
        Commands::Worker => {
            worker::execute()
                .await
                .map_err(|e| CliError::RunError(e.to_string()))?;
        }
        Commands::Build { file, export } => {
            let file_path = file.as_deref().map(Path::new);
            build::execute(file_path, export).await?;
        }
        Commands::Exec {
            file,
            json,
            verbose,
            mount,
            args_file,
            args,
        } => {
            let args = match args_file {
                Some(ref path) => load_args_file(path).map_err(CliError::ExecError)?,
                None => args,
            };
            let result = exec::execute(Path::new(&file), args, mount, json, verbose, None).await?;

            if json {
                println!("{}", result);
            } else if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&result)
                && !parsed.get("result").is_none_or(|r| r.is_null())
            {
                println!("{}", result);
            }
        }
    }

    Ok(())
}
