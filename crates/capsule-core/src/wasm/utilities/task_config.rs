use serde::{Deserialize, Serialize};

use crate::config::manifest::CapsuleToml;
use crate::wasm::execution_policy::{Compute, ExecutionPolicy};

#[derive(Serialize, Deserialize)]
pub struct TaskResult {
    pub success: bool,
    pub result: Option<serde_json::Value>,
    pub error: Option<TaskError>,
    pub execution: TaskExecution,
}

#[derive(Serialize, Deserialize)]
pub struct TaskError {
    pub error_type: String,
    pub message: String,
}

#[derive(Serialize, Deserialize)]
pub struct TaskExecution {
    pub task_name: String,
    pub duration_ms: u64,
    pub retries: u64,
    pub fuel_consumed: u64,
    pub ram_used: u64,
    pub host_requests: Vec<HostRequest>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostRequest {
    pub method: String,
    pub url: String,
    pub headers: Option<Vec<(String, String)>>,
    pub body: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct TaskConfig {
    name: Option<String>,
    compute: Option<String>,
    ram: Option<String>,
    timeout: Option<String>,

    #[serde(alias = "maxRetries")]
    max_retries: Option<u64>,

    #[serde(alias = "allowedFiles")]
    allowed_files: Option<Vec<String>>,

    #[serde(alias = "allowedHosts")]
    allowed_hosts: Option<Vec<String>>,

    #[serde(alias = "envVariables")]
    env_variables: Option<Vec<String>>,
}

impl TaskConfig {
    pub fn to_execution_policy(&self, capsule_toml: &CapsuleToml) -> ExecutionPolicy {
        let default_policy = capsule_toml.tasks.as_ref();

        let compute = self
            .compute
            .as_ref()
            .map(|c| match c.to_uppercase().as_str() {
                "LOW" => Compute::Low,
                "MEDIUM" => Compute::Medium,
                "HIGH" => Compute::High,
                _ => c
                    .parse::<u64>()
                    .map(Compute::Custom)
                    .unwrap_or(Compute::Medium),
            })
            .or_else(|| default_policy.and_then(|p| p.default_compute.clone()));

        let ram = self
            .ram
            .as_ref()
            .and_then(|r| Self::parse_ram_string(r))
            .or_else(|| {
                default_policy
                    .and_then(|p| p.default_ram.as_ref())
                    .and_then(|r| Self::parse_ram_string(r))
            });

        let timeout = self
            .timeout
            .clone()
            .or_else(|| default_policy.and_then(|p| p.default_timeout.clone()));

        let max_retries = self
            .max_retries
            .or_else(|| default_policy.and_then(|p| p.default_max_retries));

        let allowed_files = self
            .allowed_files
            .clone()
            .or_else(|| default_policy.and_then(|p| p.default_allowed_files.clone()))
            .unwrap_or_default();

        let allowed_hosts = self
            .allowed_hosts
            .clone()
            .or_else(|| default_policy.and_then(|p| p.default_allowed_hosts.clone()))
            .unwrap_or_default();

        let env_variables = self
            .env_variables
            .clone()
            .or_else(|| default_policy.and_then(|p| p.default_env_variables.clone()))
            .unwrap_or_default();

        ExecutionPolicy::new()
            .name(self.name.clone())
            .compute(compute)
            .ram(ram)
            .timeout(timeout)
            .max_retries(max_retries)
            .allowed_files(allowed_files)
            .allowed_hosts(allowed_hosts)
            .env_variables(env_variables)
    }

    pub fn parse_ram_string(s: &str) -> Option<u64> {
        let s = s.trim().to_uppercase();
        if s.ends_with("GB") {
            s.trim_end_matches("GB")
                .trim()
                .parse::<u64>()
                .ok()
                .map(|v| v * 1024 * 1024 * 1024)
        } else if s.ends_with("MB") {
            s.trim_end_matches("MB")
                .trim()
                .parse::<u64>()
                .ok()
                .map(|v| v * 1024 * 1024)
        } else if s.ends_with("KB") {
            s.trim_end_matches("KB")
                .trim()
                .parse::<u64>()
                .ok()
                .map(|v| v * 1024)
        } else {
            s.parse::<u64>().ok()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::manifest::DefaultPolicy;

    #[test]
    fn test_parse_ram_string() {
        assert_eq!(
            TaskConfig::parse_ram_string("2GB"),
            Some(2 * 1024 * 1024 * 1024)
        );
        assert_eq!(
            TaskConfig::parse_ram_string("1 GB"),
            Some(1024 * 1024 * 1024)
        );
        assert_eq!(
            TaskConfig::parse_ram_string("4gb"),
            Some(4 * 1024 * 1024 * 1024)
        );

        assert_eq!(
            TaskConfig::parse_ram_string("512MB"),
            Some(512 * 1024 * 1024)
        );
        assert_eq!(
            TaskConfig::parse_ram_string("256 MB"),
            Some(256 * 1024 * 1024)
        );
        assert_eq!(
            TaskConfig::parse_ram_string("128mb"),
            Some(128 * 1024 * 1024)
        );

        assert_eq!(TaskConfig::parse_ram_string("1024KB"), Some(1024 * 1024));
        assert_eq!(TaskConfig::parse_ram_string("512 KB"), Some(512 * 1024));
        assert_eq!(TaskConfig::parse_ram_string("256kb"), Some(256 * 1024));

        assert_eq!(TaskConfig::parse_ram_string("1024"), Some(1024));
        assert_eq!(TaskConfig::parse_ram_string("512"), Some(512));
    }

    #[test]
    fn test_parse_ram_string_invalid() {
        assert_eq!(TaskConfig::parse_ram_string("invalid"), None);
        assert_eq!(TaskConfig::parse_ram_string(""), None);
        assert_eq!(TaskConfig::parse_ram_string("GB"), None);
    }

    #[test]
    fn test_to_execution_policy_default() {
        let config = TaskConfig::default();
        let policy = config.to_execution_policy(&CapsuleToml::default());

        assert_eq!(policy.name, "default");
        assert_eq!(policy.compute, Compute::Medium);
        assert_eq!(policy.ram, None);
        assert_eq!(policy.timeout, None);
        assert_eq!(policy.max_retries, 0);
    }

    #[test]
    fn test_to_execution_policy_with_values() {
        let config = TaskConfig {
            name: Some("test_task".to_string()),
            compute: Some("HIGH".to_string()),
            ram: Some("2GB".to_string()),
            timeout: Some("30s".to_string()),
            max_retries: Some(3),
            allowed_files: Some(vec!["./data".to_string()]),
            allowed_hosts: Some(vec!["https://example.com".to_string()]),
            env_variables: Some(vec!["FOO".to_string()]),
        };

        let policy = config.to_execution_policy(&CapsuleToml::default());

        assert_eq!(policy.name, "test_task");
        assert_eq!(policy.compute, Compute::High);
        assert_eq!(policy.ram, Some(2 * 1024 * 1024 * 1024));
        assert_eq!(policy.timeout, Some("30s".to_string()));
        assert_eq!(policy.max_retries, 3);
    }

    #[test]
    fn test_to_execution_policy_compute_variants() {
        let low = TaskConfig {
            compute: Some("LOW".to_string()),
            ..Default::default()
        };
        assert_eq!(
            low.to_execution_policy(&CapsuleToml::default()).compute,
            Compute::Low
        );

        let medium = TaskConfig {
            compute: Some("MEDIUM".to_string()),
            ..Default::default()
        };
        assert_eq!(
            medium.to_execution_policy(&CapsuleToml::default()).compute,
            Compute::Medium
        );

        let high = TaskConfig {
            compute: Some("HIGH".to_string()),
            ..Default::default()
        };
        assert_eq!(
            high.to_execution_policy(&CapsuleToml::default()).compute,
            Compute::High
        );

        let invalid = TaskConfig {
            compute: Some("INVALID".to_string()),
            ..Default::default()
        };
        assert_eq!(
            invalid.to_execution_policy(&CapsuleToml::default()).compute,
            Compute::Medium
        );
    }

    #[test]
    fn test_to_execution_policy_uses_capsule_toml_defaults() {
        let capsule_toml = CapsuleToml {
            workflow: None,
            tasks: Some(DefaultPolicy {
                default_compute: Some(Compute::High),
                default_ram: Some("1GB".to_string()),
                default_timeout: Some("60s".to_string()),
                default_max_retries: Some(5),
                default_allowed_files: Some(vec!["./default".to_string()]),
                default_allowed_hosts: Some(vec!["https://default.com".to_string()]),
                default_env_variables: Some(vec!["FOO".to_string()]),
            }),
        };

        let config = TaskConfig::default();
        let policy = config.to_execution_policy(&capsule_toml);

        assert_eq!(policy.compute, Compute::High);
        assert_eq!(policy.ram, Some(1024 * 1024 * 1024));
        assert_eq!(policy.timeout, Some("60s".to_string()));
        assert_eq!(policy.max_retries, 5);
        assert_eq!(policy.allowed_files, vec!["./default".to_string()]);
        assert_eq!(
            policy.allowed_hosts,
            vec!["https://default.com".to_string()]
        );
        assert_eq!(policy.env_variables, vec!["FOO".to_string()]);
    }

    #[test]
    fn test_task_config_overrides_capsule_toml_defaults() {
        let capsule_toml = CapsuleToml {
            workflow: None,
            tasks: Some(DefaultPolicy {
                default_compute: Some(Compute::Low),
                default_ram: Some("512MB".to_string()),
                default_timeout: Some("30s".to_string()),
                default_max_retries: Some(2),
                default_allowed_files: Some(vec!["./default.txt".to_string()]),
                default_allowed_hosts: Some(vec!["*".to_string()]),
                default_env_variables: Some(vec!["FOO".to_string()]),
            }),
        };

        let config = TaskConfig {
            name: Some("override_task".to_string()),
            compute: Some("HIGH".to_string()),
            ram: Some("4GB".to_string()),
            timeout: Some("120s".to_string()),
            max_retries: Some(10),
            allowed_files: Some(vec!["./custom".to_string()]),
            allowed_hosts: Some(vec!["https://custom.com".to_string()]),
            env_variables: Some(vec!["BAR".to_string()]),
        };

        let policy = config.to_execution_policy(&capsule_toml);

        assert_eq!(policy.name, "override_task");
        assert_eq!(policy.compute, Compute::High);
        assert_eq!(policy.ram, Some(4 * 1024 * 1024 * 1024));
        assert_eq!(policy.timeout, Some("120s".to_string()));
        assert_eq!(policy.max_retries, 10);
        assert_eq!(policy.allowed_files, vec!["./custom".to_string()]);
        assert_eq!(policy.allowed_hosts, vec!["https://custom.com".to_string()]);
        assert_eq!(policy.env_variables, vec!["BAR".to_string()]);
    }

    #[test]
    fn test_partial_task_config_with_capsule_toml_defaults() {
        let capsule_toml = CapsuleToml {
            workflow: None,
            tasks: Some(DefaultPolicy {
                default_compute: Some(Compute::Medium),
                default_ram: Some("2GB".to_string()),
                default_timeout: Some("45s".to_string()),
                default_max_retries: Some(3),
                default_allowed_files: Some(vec!["./default".to_string()]),
                default_allowed_hosts: Some(vec!["*".to_string()]),
                default_env_variables: Some(vec!["FOO".to_string()]),
            }),
        };

        let config = TaskConfig {
            name: Some("partial_task".to_string()),
            compute: Some("LOW".to_string()),
            ram: None,
            timeout: None,
            max_retries: Some(1),
            allowed_files: None,
            allowed_hosts: None,
            env_variables: None,
        };

        let policy = config.to_execution_policy(&capsule_toml);

        assert_eq!(policy.name, "partial_task");
        assert_eq!(policy.compute, Compute::Low);
        assert_eq!(policy.ram, Some(2 * 1024 * 1024 * 1024));
        assert_eq!(policy.timeout, Some("45s".to_string()));
        assert_eq!(policy.max_retries, 1);
        assert_eq!(policy.allowed_files, vec!["./default".to_string()]);
        assert_eq!(policy.allowed_hosts, vec!["*".to_string()]);
        assert_eq!(policy.env_variables, vec!["FOO".to_string()]);
    }
}
