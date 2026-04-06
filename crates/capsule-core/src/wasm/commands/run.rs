use std::sync::Arc;

use wasmtime::Store;

use crate::config::log::{InstanceState, UpdateInstanceLog};
use crate::wasm::execution_policy::ExecutionPolicy;
use crate::wasm::runtime::{Runtime, RuntimeCommand, WasmRuntimeError};
use crate::wasm::state::{CapsuleAgent, State};
use crate::wasm::utilities::task_config::{TaskError, TaskExecution, TaskResult};

pub struct RunInstance {
    task_id: String,
    policy: ExecutionPolicy,
    store: Store<State>,
    instance: CapsuleAgent,
    args_json: String,
}

impl RunInstance {
    pub fn new(
        task_id: String,
        policy: ExecutionPolicy,
        store: Store<State>,
        instance: CapsuleAgent,
        args_json: String,
    ) -> Self {
        Self {
            task_id,
            policy,
            store,
            instance,
            args_json,
        }
    }
}

impl RuntimeCommand for RunInstance {
    type Output = String;

    async fn execute(mut self, runtime: Arc<Runtime>) -> Result<Self::Output, WasmRuntimeError> {
        let start_time = std::time::Instant::now();

        runtime
            .log
            .update_log(UpdateInstanceLog {
                task_id: self.task_id.clone(),
                state: InstanceState::Running,
                fuel_consumed: self.policy.compute.as_fuel() - self.store.get_fuel().unwrap_or(0),
            })
            .await?;

        let wasm_future = self
            .instance
            .capsule_host_task_runner()
            .call_run(&mut self.store, &self.args_json);

        let response = match self.policy.timeout_duration() {
            Some(duration) => match tokio::time::timeout(duration, wasm_future).await {
                Ok(wasm_result) => match wasm_result {
                    Ok(inner_result) => match inner_result {
                        Ok(json_string) => {
                            let result_object = serde_json::from_str(&json_string)
                                .unwrap_or(serde_json::Value::String(json_string));

                            let result = result_object
                                .get("result")
                                .cloned()
                                .unwrap_or(result_object);

                            if result.get("error_type").is_some() && result.get("message").is_some() {
                                TaskResult {
                                    success: false,
                                    result: None,
                                    error: Some(TaskError {
                                        error_type: result
                                            .get("error_type")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or_default()
                                            .to_string(),
                                        message: result
                                            .get("message")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or_default()
                                            .to_string(),
                                    }),
                                    execution: TaskExecution {
                                        task_name: self.policy.name.clone(),
                                        duration_ms: start_time.elapsed().as_millis() as u64,
                                        retries: self.policy.max_retries,
                                        fuel_consumed: self.policy.compute.as_fuel()
                                            - self.store.get_fuel().unwrap_or(0),
                                    },
                                }
                            } else {
                                TaskResult {
                                    success: true,
                                    result: Some(result),
                                    error: None,
                                    execution: TaskExecution {
                                        task_name: self.policy.name.clone(),
                                        duration_ms: start_time.elapsed().as_millis() as u64,
                                        retries: self.policy.max_retries,
                                        fuel_consumed: self.policy.compute.as_fuel()
                                            - self.store.get_fuel().unwrap_or(0),
                                    },
                                }
                            }
                        }
                        Err(error_string) => TaskResult {
                            success: false,
                            result: None,
                            error: Some(TaskError {
                                error_type: "task_error".to_string(),
                                message: error_string,
                            }),
                            execution: TaskExecution {
                                task_name: self.policy.name.clone(),
                                duration_ms: start_time.elapsed().as_millis() as u64,
                                retries: self.policy.max_retries,
                                fuel_consumed: self.policy.compute.as_fuel()
                                    - self.store.get_fuel().unwrap_or(0),
                            },
                        },
                    },
                    Err(e) => TaskResult {
                        success: false,
                        result: None,
                        error: Some(TaskError {
                            error_type: "Wasm_error".to_string(),
                            message: e.to_string(),
                        }),
                        execution: TaskExecution {
                            task_name: self.policy.name.clone(),
                            duration_ms: start_time.elapsed().as_millis() as u64,
                            retries: self.policy.max_retries,
                            fuel_consumed: self.policy.compute.as_fuel()
                                - self.store.get_fuel().unwrap_or(0),
                        },
                    },
                },
                Err(_elapsed) => TaskResult {
                    success: false,
                    result: None,
                    error: Some(TaskError {
                        error_type: "timeout".to_string(),
                        message: format!("timeout after {}ms", duration.as_millis()),
                    }),
                    execution: TaskExecution {
                        task_name: self.policy.name.clone(),
                        duration_ms: start_time.elapsed().as_millis() as u64,
                        retries: self.policy.max_retries,
                        fuel_consumed: self.policy.compute.as_fuel()
                            - self.store.get_fuel().unwrap_or(0),
                    },
                },
            },
            None => match wasm_future.await {
                Ok(inner_result) => match inner_result {
                    Ok(json_string) => {
                        let result_object = serde_json::from_str(&json_string)
                            .unwrap_or(serde_json::Value::String(json_string));

                        let result = result_object
                            .get("result")
                            .cloned()
                            .unwrap_or(result_object);

                        if result.get("error_type").is_some() && result.get("message").is_some() {
                            TaskResult {
                                success: false,
                                result: None,
                                error: Some(TaskError {
                                    error_type: result
                                        .get("error_type")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or_default()
                                        .to_string(),
                                    message: result
                                        .get("message")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or_default()
                                        .to_string(),
                                }),
                                execution: TaskExecution {
                                    task_name: self.policy.name.clone(),
                                    duration_ms: start_time.elapsed().as_millis() as u64,
                                    retries: self.policy.max_retries,
                                    fuel_consumed: self.policy.compute.as_fuel()
                                        - self.store.get_fuel().unwrap_or(0),
                                },
                            }
                        } else {
                            TaskResult {
                                success: true,
                                result: Some(result),
                                error: None,
                                execution: TaskExecution {
                                    task_name: self.policy.name.clone(),
                                    duration_ms: start_time.elapsed().as_millis() as u64,
                                    retries: self.policy.max_retries,
                                    fuel_consumed: self.policy.compute.as_fuel()
                                        - self.store.get_fuel().unwrap_or(0),
                                },
                            }
                        }
                    }
                    Err(error_string) => TaskResult {
                        success: false,
                        result: None,
                        error: Some(TaskError {
                            error_type: "task_error".to_string(),
                            message: error_string,
                        }),
                        execution: TaskExecution {
                            task_name: self.policy.name.clone(),
                            duration_ms: start_time.elapsed().as_millis() as u64,
                            retries: self.policy.max_retries,
                            fuel_consumed: self.policy.compute.as_fuel()
                                - self.store.get_fuel().unwrap_or(0),
                        },
                    },
                },
                Err(e) => TaskResult {
                    success: false,
                    result: None,
                    error: Some(TaskError {
                        error_type: "wasm_error".to_string(),
                        message: e.to_string(),
                    }),
                    execution: TaskExecution {
                        task_name: self.policy.name.clone(),
                        duration_ms: start_time.elapsed().as_millis() as u64,
                        retries: self.policy.max_retries,
                        fuel_consumed: self.policy.compute.as_fuel()
                            - self.store.get_fuel().unwrap_or(0),
                    },
                },
            },
        };

        let state = if response.success {
            InstanceState::Completed
        } else {
            InstanceState::Failed
        };

        runtime
            .log
            .update_log(UpdateInstanceLog {
                task_id: self.task_id.clone(),
                state,
                fuel_consumed: response.execution.fuel_consumed,
            })
            .await?;

        if !response.success {
            let error_message = response
                .error
                .as_ref()
                .map(|e| e.message.as_str())
                .unwrap_or("Unknown error");

            runtime
                .task_reporter
                .lock()
                .await
                .task_failed(&self.policy.name, error_message);
        }

        let json_output = serde_json::to_string(&response)
            .map_err(|e| WasmRuntimeError::SerializationError(e.to_string()))?;

        Ok(json_output)
    }
}
