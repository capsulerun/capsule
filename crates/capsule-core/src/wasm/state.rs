use std::sync::Arc;

use anyhow::Result;
use hyper::Request;
use wasmtime::component::{ResourceTable, bindgen};
use wasmtime::{ResourceLimiter, StoreLimits};
use wasmtime_wasi::{WasiCtx, WasiView};
use wasmtime_wasi_http::bindings::http::types::ErrorCode;
use wasmtime_wasi_http::body::HyperOutgoingBody;
use wasmtime_wasi_http::types::{
    HostFutureIncomingResponse, OutgoingRequestConfig, default_send_request,
};
use wasmtime_wasi_http::{HttpResult, WasiHttpCtx, WasiHttpView};

use crate::wasm::commands::create::CreateInstance;
use crate::wasm::commands::run::RunInstance;
use crate::wasm::execution_policy::ExecutionPolicy;
use crate::wasm::runtime::Runtime;
use crate::wasm::utilities::host_validator::is_host_allowed;
use crate::wasm::utilities::task_config::{TaskConfig, TaskResult};

use capsule::host::api::{Host, HttpError, HttpResponse, TaskError};

bindgen!({
    path: "../capsule-wit",
    world: "capsule-agent",
    async: true
});

pub use capsule::host::api as host_api;

pub struct State {
    pub ctx: WasiCtx,
    pub http_ctx: WasiHttpCtx,
    pub table: ResourceTable,
    pub limits: StoreLimits,
    pub runtime: Option<Arc<Runtime>>,
    pub policy: ExecutionPolicy,
}

impl WasiView for State {
    fn ctx(&mut self) -> &mut WasiCtx {
        &mut self.ctx
    }
    fn table(&mut self) -> &mut ResourceTable {
        &mut self.table
    }
}

impl WasiHttpView for State {
    fn ctx(&mut self) -> &mut WasiHttpCtx {
        &mut self.http_ctx
    }

    fn table(&mut self) -> &mut ResourceTable {
        &mut self.table
    }

    fn send_request(
        &mut self,
        request: Request<HyperOutgoingBody>,
        config: OutgoingRequestConfig,
    ) -> HttpResult<HostFutureIncomingResponse> {
        let host = request.uri().host().unwrap_or("unknown");
        let allowed = is_host_allowed(host, &self.policy.allowed_hosts);

        if !allowed {
            return Err(ErrorCode::HttpRequestDenied.into());
        }

        Ok(default_send_request(request, config))
    }
}

impl Host for State {
    async fn schedule_task(
        &mut self,
        name: String,
        args: String,
        config: String,
    ) -> Result<String, TaskError> {
        let runtime = match &self.runtime {
            Some(r) => Arc::clone(r),
            None => {
                return Err(TaskError::InternalError(
                    "No runtime available for recursive task execution".to_string(),
                ));
            }
        };

        let task_config: TaskConfig = serde_json::from_str(&config).unwrap_or_default();
        let mut policy = task_config.to_execution_policy(&runtime.capsule_toml);

        policy.mounts.extend(self.policy.mounts.iter().cloned());
        let max_retries = policy.max_retries;

        let mut last_error: Option<String> = None;

        for attempt in 0..=max_retries {
            let create_cmd = CreateInstance::new(policy.clone(), vec![]).task_name(&name);

            let (store, instance, task_id) = match runtime.execute(create_cmd).await {
                Ok(result) => result,
                Err(e) => {
                    runtime
                        .task_reporter
                        .lock()
                        .await
                        .task_failed(&name, &e.to_string());
                    last_error = Some(format!("Failed to create instance: {}", e));
                    continue;
                }
            };

            let args_json = format!(
                r#"{{"task_name": "{}", "args": {}, "kwargs": {{}}}}"#,
                name, args
            );

            runtime
                .task_reporter
                .lock()
                .await
                .task_running(&name, &task_id);

            let start_time = std::time::Instant::now();

            let run_cmd = RunInstance::new(task_id, policy.clone(), store, instance, args_json);

            match runtime.execute(run_cmd).await {
                Ok(result) => {
                    if result.is_empty() {
                        last_error = Some("Task failed".to_string());
                        if attempt < max_retries {
                            continue;
                        }
                    } else {
                        match serde_json::from_str::<TaskResult>(&result) {
                            Ok(task_result) if task_result.success => {
                                let elapsed = start_time.elapsed();
                                runtime
                                    .task_reporter
                                    .lock()
                                    .await
                                    .task_completed_with_time(&name, elapsed);

                                return Ok(result);
                            }
                            Ok(_) => {
                                if attempt < max_retries {
                                    continue;
                                }

                                return Ok(result);
                            }
                            Err(_) => {
                                if attempt < max_retries {
                                    continue;
                                }
                            }
                        }
                    }
                }
                Err(_) => {
                    if attempt < max_retries {
                        continue;
                    }
                }
            }
        }

        Ok(last_error.unwrap_or_else(|| "Unknown error".to_string()))
    }

    async fn http_request(
        &mut self,
        method: String,
        url: String,
        headers: Vec<(String, String)>,
        body: Option<String>,
    ) -> Result<HttpResponse, HttpError> {
        let host = url
            .parse::<reqwest::Url>()
            .ok()
            .and_then(|u| u.host_str().map(|h| h.to_string()))
            .unwrap_or("unknown".to_string());

        let allowed = is_host_allowed(&host, &self.policy.allowed_hosts);

        if !allowed {
            return Err(HttpError::InvalidUrl("Host not allowed".to_string()));
        }

        let client = reqwest::Client::new();

        let mut request_builder = match method.to_uppercase().as_str() {
            "GET" => client.get(&url),
            "POST" => client.post(&url),
            "PUT" => client.put(&url),
            "DELETE" => client.delete(&url),
            "PATCH" => client.patch(&url),
            "HEAD" => client.head(&url),
            _ => {
                return Err(HttpError::InvalidUrl(format!(
                    "Unsupported method: {}",
                    method
                )));
            }
        };

        for (key, value) in headers {
            request_builder = request_builder.header(key, value);
        }

        if let Some(body_content) = body {
            request_builder = request_builder.body(body_content);
        }

        let response = request_builder
            .send()
            .await
            .map_err(|e| HttpError::NetworkError(e.to_string()))?;

        let status = response.status().as_u16();
        let response_headers: Vec<(String, String)> = response
            .headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
            .collect();

        let body_text = response
            .text()
            .await
            .map_err(|e| HttpError::NetworkError(e.to_string()))?;

        Ok(HttpResponse {
            status,
            headers: response_headers,
            body: body_text,
        })
    }
}

impl ResourceLimiter for State {
    fn memory_growing(
        &mut self,
        current: usize,
        desired: usize,
        maximum: Option<usize>,
    ) -> Result<bool> {
        self.limits.memory_growing(current, desired, maximum)
    }

    fn table_growing(
        &mut self,
        current: usize,
        desired: usize,
        maximum: Option<usize>,
    ) -> Result<bool> {
        self.limits.table_growing(current, desired, maximum)
    }
}
