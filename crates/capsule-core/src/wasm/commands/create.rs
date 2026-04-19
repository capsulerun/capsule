use std::path::PathBuf;
use std::sync::Arc;

use nanoid::nanoid;

use wasmtime::component::{Linker, ResourceTable};
use wasmtime::{Store, StoreLimitsBuilder};
use wasmtime_wasi::add_to_linker_async;
use wasmtime_wasi::{DirPerms, FilePerms, WasiCtxBuilder};
use wasmtime_wasi_http::WasiHttpCtx;

use crate::config::log::{CreateInstanceLog, InstanceState, UpdateInstanceLog};
use crate::wasm::execution_policy::ExecutionPolicy;
use crate::wasm::runtime::{Runtime, RuntimeCommand, WasmRuntimeError};
use crate::wasm::state::{CapsuleAgent, State, capsule};
use crate::wasm::utilities::path_validator::{FileAccessMode, validate_path};

use crate::wasm::utilities::cache::load_or_compile_component;

pub struct CreateInstance {
    pub policy: ExecutionPolicy,
    pub args: Vec<String>,
    pub task_id: String,
    pub task_name: String,
    pub agent_name: String,
    pub agent_version: String,
    pub wasm_path: PathBuf,
    pub project_root: PathBuf,
}

impl CreateInstance {
    pub fn new(policy: ExecutionPolicy, args: Vec<String>) -> Self {
        Self {
            policy,
            args,
            task_id: nanoid!(10),
            task_name: "default".to_string(),
            agent_name: "default".to_string(),
            agent_version: "0.0.0".to_string(),
            wasm_path: PathBuf::from(".capsule/wasm/default.wasm"),
            project_root: std::env::current_dir().unwrap_or_default(),
        }
    }

    pub fn task_name(mut self, task_name: impl Into<String>) -> Self {
        self.task_name = task_name.into();
        self
    }

    pub fn agent_name(mut self, agent_name: impl Into<String>) -> Self {
        self.agent_name = agent_name.into();
        self
    }

    pub fn agent_version(mut self, agent_version: impl Into<String>) -> Self {
        self.agent_version = agent_version.into();
        self
    }

    pub fn wasm_path(mut self, wasm_path: PathBuf) -> Self {
        self.wasm_path = wasm_path;
        self
    }

    pub fn project_root(mut self, project_root: PathBuf) -> Self {
        self.project_root = project_root;
        self
    }
}

impl RuntimeCommand for CreateInstance {
    type Output = (Store<State>, CapsuleAgent, String);

    async fn execute(
        self,
        runtime: Arc<Runtime>,
    ) -> Result<(Store<State>, CapsuleAgent, String), WasmRuntimeError> {
        runtime
            .log
            .commit_log(CreateInstanceLog {
                agent_name: self.agent_name,
                agent_version: self.agent_version,
                task_id: self.task_id.clone(),
                task_name: self.task_name,
                state: InstanceState::Created,
                fuel_limit: self.policy.compute.as_fuel(),
                fuel_consumed: 0,
                ram_used: 0,
                host_requests: Vec::new(),
            })
            .await?;

        let mut linker = Linker::<State>::new(&runtime.engine);

        add_to_linker_async(&mut linker)?;
        wasmtime_wasi_http::add_only_http_to_linker_async(&mut linker)?;

        capsule::host::api::add_to_linker(&mut linker, |state: &mut State| state)?;

        let envs = std::env::vars()
            .collect::<Vec<_>>()
            .into_iter()
            .filter(|(key, _)| self.policy.env_variables.contains(key))
            .collect::<Vec<_>>();

        let mut wasi_builder = WasiCtxBuilder::new();
        wasi_builder
            .inherit_stdout()
            .inherit_stderr()
            .envs(&envs)
            .args(&self.args);

        let all_paths = self
            .policy
            .allowed_files
            .iter()
            .chain(self.policy.mounts.iter());

        for path_spec in all_paths {
            match validate_path(path_spec, &self.project_root) {
                Ok(parsed) => {
                    let (dir_perms, file_perms) = match parsed.mode {
                        FileAccessMode::ReadOnly => (DirPerms::READ, FilePerms::READ),
                        FileAccessMode::ReadWrite => (DirPerms::all(), FilePerms::all()),
                    };

                    if let Err(e) = wasi_builder.preopened_dir(
                        &parsed.path,
                        &parsed.guest_path,
                        dir_perms,
                        file_perms,
                    ) {
                        return Err(WasmRuntimeError::FilesystemError(format!(
                            "Failed to preopen '{}': {}",
                            path_spec, e
                        )));
                    }
                }
                Err(e) => {
                    return Err(WasmRuntimeError::FilesystemError(e.to_string()));
                }
            }
        }

        let wasi = wasi_builder.build();

        let mut limits = StoreLimitsBuilder::new();

        if let Some(ram_bytes) = self.policy.ram {
            limits = limits.memory_size(ram_bytes as usize);
        }

        let limits = limits.build();

        let state = State {
            ctx: wasi,
            http_ctx: WasiHttpCtx::new(),
            table: ResourceTable::new(),
            limits,
            runtime: Some(Arc::clone(&runtime)),
            policy: self.policy.clone(),
            wasm_path: self.wasm_path.clone(),
            peak_memory_bytes: 0,
            host_requests: Vec::new(),
        };

        let mut store = Store::new(&runtime.engine, state);

        store.set_fuel(self.policy.compute.as_fuel())?;

        store.limiter(|state| state);

        let component = match runtime.get_component(&self.wasm_path).await {
            Some(c) => c,
            None => {
                let file_name = self.wasm_path.file_name().unwrap_or_default();
                let cwasm_path = runtime
                    .cache_dir
                    .join("wasm")
                    .join(std::path::Path::new(file_name).with_extension("cwasm"));

                let component =
                    load_or_compile_component(&runtime.engine, &self.wasm_path, &cwasm_path)?;

                runtime
                    .set_component(self.wasm_path.clone(), component.clone())
                    .await;
                component
            }
        };

        let instance = match CapsuleAgent::instantiate_async(&mut store, &component, &linker).await
        {
            Ok(instance) => instance,
            Err(e) => {
                runtime
                    .log
                    .update_log(UpdateInstanceLog {
                        task_id: self.task_id,
                        state: InstanceState::Failed,
                        fuel_consumed: 0,
                        ram_used: 0,
                        host_requests: Vec::new(),
                    })
                    .await?;
                return Err(WasmRuntimeError::WasmtimeError(e));
            }
        };

        Ok((store, instance, self.task_id))
    }
}
