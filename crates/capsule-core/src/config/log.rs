use std::fmt;
use std::sync::mpsc;
use std::thread::{Builder, JoinHandle};

use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

use crate::config::database::{Database, DatabaseError};
use crate::wasm::utilities::task_config::HostRequest;

#[derive(Debug)]
pub enum LogError {
    DatabaseError(String),
    WalLoggerDied(String),
    LogResponseLost(String),
}

impl fmt::Display for LogError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LogError::DatabaseError(msg) => write!(f, "Log error > {}", msg),
            LogError::WalLoggerDied(msg) => write!(f, "Log error > WAL logger died > {}", msg),
            LogError::LogResponseLost(msg) => write!(f, "Log error > Log response lost > {}", msg),
        }
    }
}

impl From<DatabaseError> for LogError {
    fn from(err: DatabaseError) -> Self {
        LogError::DatabaseError(err.to_string())
    }
}
impl From<mpsc::SendError<LogCommand>> for LogError {
    fn from(err: mpsc::SendError<LogCommand>) -> Self {
        LogError::WalLoggerDied(err.to_string())
    }
}

impl From<oneshot::error::RecvError> for LogError {
    fn from(err: oneshot::error::RecvError) -> Self {
        LogError::LogResponseLost(err.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InstanceState {
    Created,
    Running,
    Completed,
    Failed,
    Interrupted,
    TimedOut,
}

impl fmt::Display for InstanceState {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        let state_str = match self {
            InstanceState::Created => "created",
            InstanceState::Running => "running",
            InstanceState::Completed => "completed",
            InstanceState::Failed => "failed",
            InstanceState::Interrupted => "interrupted",
            InstanceState::TimedOut => "timed_out",
        };
        write!(f, "{}", state_str)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceLog {
    pub id: String,
    pub agent_name: String,
    pub agent_version: String,
    pub task_id: String,
    pub task_name: String,
    pub state: InstanceState,
    pub fuel_limit: u64,
    pub fuel_consumed: u64,
    pub ram_used: u64,
    pub host_requests: Vec<HostRequest>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateInstanceLog {
    pub agent_name: String,
    pub agent_version: String,
    pub task_id: String,
    pub task_name: String,
    pub state: InstanceState,
    pub fuel_limit: u64,
    pub fuel_consumed: u64,
    pub ram_used: u64,
    pub host_requests: Vec<HostRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInstanceLog {
    pub task_id: String,
    pub state: InstanceState,
    pub fuel_consumed: u64,
    pub ram_used: u64,
    pub host_requests: Vec<HostRequest>,
}

enum LogCommand {
    Create {
        log: CreateInstanceLog,
        response: tokio::sync::oneshot::Sender<Result<(), LogError>>,
    },

    Update {
        log: UpdateInstanceLog,
        response: tokio::sync::oneshot::Sender<Result<(), LogError>>,
    },
}

#[derive()]
pub struct Log {
    pub db: Database,
    log_tx: mpsc::Sender<LogCommand>,
    _log_handle: JoinHandle<()>,
}

impl Log {
    pub fn new(path: Option<&str>, database_name: &str) -> Result<Self, LogError> {
        let db = Database::new(path, database_name)?;

        Self::ensure_schema(&db)?;

        let (log_tx, log_handle) = Self::spawn_wal_worker(db.clone());

        Ok(Self {
            db,
            log_tx,
            _log_handle: log_handle,
        })
    }

    fn ensure_schema(db: &Database) -> Result<(), LogError> {
        let table_exists = db.table_exists("instance_log")?;

        if !table_exists {
            db.create_table(
                "instance_log",
                &[
                    "agent_name TEXT NOT NULL",
                    "agent_version TEXT NOT NULL",
                    "task_id TEXT NOT NULL",
                    "task_name TEXT NOT NULL",
                    "state TEXT NOT NULL",
                    "fuel_limit INTEGER NOT NULL",
                    "fuel_consumed INTEGER NOT NULL",
                    "ram_used INTEGER NOT NULL",
                    "host_requests TEXT NOT NULL",
                ],
                &[],
            )?;

            db.execute(
                "CREATE INDEX IF NOT EXISTS idx_instance_log_task_id ON instance_log(task_id)",
                [],
            )?;

            db.execute(
                "CREATE INDEX IF NOT EXISTS idx_instance_log_created_at ON instance_log(created_at)",
                [],
            )?;
        }

        Ok(())
    }

    fn spawn_wal_worker(db: Database) -> (mpsc::Sender<LogCommand>, JoinHandle<()>) {
        let (tx, rx) = mpsc::channel();

        let handle = Builder::new()
            .name("wal-logger".to_string())
            .spawn(move || {
                Self::wal_worker_loop(db, rx);
            })
            .expect("Failed to spawn WAL logger thread");

        (tx, handle)
    }

    fn wal_worker_loop(db: Database, rx: mpsc::Receiver<LogCommand>) {
        while let Ok(cmd) = rx.recv() {
            match cmd {
                LogCommand::Create { log, response } => {
                    let result = Self::execute_create(&db, log);
                    let _ = response.send(result);
                }
                LogCommand::Update { log, response } => {
                    let result = Self::execute_update(&db, log);
                    let _ = response.send(result);
                }
            }
        }
    }

    fn execute_create(db: &Database, log: CreateInstanceLog) -> Result<(), LogError> {
        db.execute(
            "INSERT INTO instance_log (id, agent_name, agent_version, task_id, task_name, state, fuel_limit, fuel_consumed, ram_used, host_requests) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                &nanoid!(10),
                &log.agent_name,
                &log.agent_version,
                &log.task_id,
                &log.task_name,
                &log.state.to_string(),
                &log.fuel_limit.to_string(),
                &log.fuel_consumed.to_string(),
                &log.ram_used.to_string(),
                &serde_json::to_string(&log.host_requests).unwrap_or_default(),
            ],
        )?;

        Ok(())
    }

    fn execute_update(db: &Database, log: UpdateInstanceLog) -> Result<(), LogError> {
        db.execute(
            "UPDATE instance_log SET state = ?, fuel_consumed = ?, ram_used = ?, host_requests = ? WHERE task_id = ?",
            [
                &log.state.to_string(),
                &log.fuel_consumed.to_string(),
                &log.ram_used.to_string(),
                &serde_json::to_string(&log.host_requests).unwrap_or_default(),
                &log.task_id,
            ],
        )?;

        Ok(())
    }

    pub async fn commit_log(&self, log: CreateInstanceLog) -> Result<(), LogError> {
        let (tx, rx) = oneshot::channel();

        self.log_tx.send(LogCommand::Create { log, response: tx })?;

        rx.await?
    }

    pub async fn update_log(&self, log: UpdateInstanceLog) -> Result<(), LogError> {
        let (tx, rx) = oneshot::channel();

        self.log_tx.send(LogCommand::Update { log, response: tx })?;

        rx.await?
    }

    pub fn get_logs(&self) -> Result<Vec<InstanceLog>, LogError> {
        let logs = self.db.query(
            "SELECT id, agent_name, agent_version, task_id, task_name, state, fuel_limit, fuel_consumed, ram_used, host_requests, created_at, updated_at FROM instance_log ORDER BY created_at DESC",
            [],
            |row| {
                let id_str: String = row.get(0)?;
                let state_str: String = row.get(5)?;
                Ok(InstanceLog {
                    id: id_str,
                    agent_name: row.get(1)?,
                    agent_version: row.get(2)?,
                    task_id: row.get(3)?,
                    task_name: row.get(4)?,
                    state: match state_str.as_str() {
                        "created" => InstanceState::Created,
                        "running" => InstanceState::Running,
                        "completed" => InstanceState::Completed,
                        "failed" => InstanceState::Failed,
                        "interrupted" => InstanceState::Interrupted,
                        _ => return Err(DatabaseError::InvalidQuery(format!("Invalid state: {}", state_str))),
                    },
                    fuel_limit: row.get::<_, i64>(6)? as u64,
                    fuel_consumed: row.get::<_, i64>(7)? as u64,
                    ram_used: row.get::<_, i64>(8)? as u64,
                    host_requests: serde_json::from_str::<Vec<HostRequest>>(&row.get::<_, String>(9)?)? as Vec<HostRequest>,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            }
        )?;

        Ok(logs)
    }

    pub fn clear_logs(&self) -> Result<(), LogError> {
        let logs = self.get_logs()?;

        for log in logs {
            if log.state != InstanceState::Completed && log.state != InstanceState::Running {
                self.delete_log(&log.task_id)?;
            }
        }

        Ok(())
    }

    pub fn delete_log(&self, task_id: &str) -> Result<(), LogError> {
        self.db
            .execute("DELETE FROM instance_log WHERE task_id = ?", [task_id])?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run_async<F>(future: F) -> F::Output
    where
        F: std::future::Future,
    {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("Failed to create runtime");
        rt.block_on(future)
    }

    mod creation {
        use super::*;

        #[test]
        fn test_new_log() {
            let log = Log::new(None, "trace.db-wal").unwrap();

            let conn = log.db.conn.lock().unwrap();

            let mut stmt = conn
                .prepare(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='instance_log'",
                )
                .expect("Failed to prepare query");

            let mut index_stmt = conn
                .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_instance_log_task_id'")
                .expect("Failed to prepare query");

            let exists = stmt.exists([]).expect("Failed to check if table exists");

            let index_exists: bool = index_stmt
                .exists([])
                .expect("Failed to check if index exists");

            assert!(exists, "Table instance_log does not exist");
            assert!(
                index_exists,
                "Index idx_instance_log_task_id does not exist"
            );
        }

        #[test]
        fn test_commit_log() {
            let log = Log::new(None, "trace.db-wal").unwrap();

            run_async(async {
                log.commit_log(CreateInstanceLog {
                    agent_name: "agent_name".to_string(),
                    agent_version: "agent_version".to_string(),
                    task_id: "task_id".to_string(),
                    task_name: "task_name".to_string(),
                    state: InstanceState::Created,
                    fuel_limit: 100,
                    fuel_consumed: 0,
                    ram_used: 0,
                    host_requests: Vec::new(),
                })
                .await
                .expect("Failed to commit log");
            });

            let conn = log.db.conn.lock().unwrap();

            let mut stmt = conn
                .prepare("SELECT task_name FROM instance_log WHERE task_id = 'task_id'")
                .expect("Failed to prepare query");

            let exists = stmt.exists([]).expect("Failed to check if instance exists");

            assert!(exists, "instance does not exist");
        }
    }

    mod update {
        use super::*;

        #[test]
        fn test_update_log() {
            let log = Log::new(None, "trace.db-wal").unwrap();

            {
                let conn = log.db.conn.lock().unwrap();

                conn.execute("INSERT INTO instance_log (id, agent_name, agent_version, task_id, task_name, state, fuel_limit, fuel_consumed, ram_used, host_requests) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                    &nanoid!(10),
                    "test_agent",
                    "1.0.0",
                    "test_task_123",
                    "Test Task",
                    "created",
                    "15000000",
                    "0",
                    "0",
                    "[]",
                ]).expect("Failed to insert test data");
            }

            run_async(async {
                log.update_log(UpdateInstanceLog {
                    task_id: "test_task_123".to_string(),
                    state: InstanceState::Running,
                    fuel_consumed: 10,
                    ram_used: 1500,
                    host_requests: Vec::new(),
                })
                .await
                .expect("Failed to update log");
            });

            let conn = log.db.conn.lock().unwrap();

            let state: String = conn
                .query_row(
                    "SELECT state FROM instance_log WHERE task_id = 'test_task_123'",
                    [],
                    |row| row.get(0),
                )
                .expect("Failed to query state");

            let fuel_consumed: i64 = conn
                .query_row(
                    "SELECT fuel_consumed FROM instance_log WHERE task_id = 'test_task_123'",
                    [],
                    |row| row.get(0),
                )
                .expect("Failed to query fuel_consumed");

            let ram_used: i64 = conn
                .query_row(
                    "SELECT ram_used FROM instance_log WHERE task_id = 'test_task_123'",
                    [],
                    |row| row.get(0),
                )
                .expect("Failed to query ram_used");

            let host_requests: String = conn
                .query_row(
                    "SELECT host_requests FROM instance_log WHERE task_id = 'test_task_123'",
                    [],
                    |row| row.get(0),
                )
                .expect("Failed to query host_requests");

            assert_eq!(state, "running", "State should be updated to running");
            assert_eq!(fuel_consumed, 10, "Fuel consumed should be updated to 10");
            assert_eq!(ram_used, 1500, "Ram used should be updated to 1500");
            assert_eq!(host_requests, "[]", "Host requests should be updated to []");
        }
    }

    mod deletion {
        use super::*;

        #[test]
        fn test_delete_log() {
            let log = Log::new(None, "trace.db-wal").unwrap();

            {
                let conn = log.db.conn.lock().unwrap();

                conn.execute("INSERT INTO instance_log (id, agent_name, agent_version, task_id, task_name, state, fuel_limit, fuel_consumed, ram_used, host_requests, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                    &nanoid!(10),
                    "test_agent",
                    "1.0.0",
                    "task_to_delete",
                    "Task To Delete",
                    "created",
                    "10000",
                    "0",
                    "0",
                    "[]",
                    "1000",
                    "1000",
                ]).expect("Failed to insert first test log");

                conn.execute("INSERT INTO instance_log (id, agent_name, agent_version, task_id, task_name, state, fuel_limit, fuel_consumed, ram_used, host_requests, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                    &nanoid!(10),
                    "test_agent",
                    "1.0.0",
                    "task_to_delete",
                    "Task To Delete",
                    "running",
                    "10000",
                    "5000",
                    "1500",
                    "[]",
                    "2000",
                    "2000",
                ]).expect("Failed to insert second test log");

                conn.execute("INSERT INTO instance_log (id, agent_name, agent_version, task_id, task_name, state, fuel_limit, fuel_consumed, ram_used, host_requests, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                    &nanoid!(10),
                    "other_agent",
                    "2.0.0",
                    "task_to_keep",
                    "Task To Keep",
                    "completed",
                    "5000",
                    "2500",
                    "1500",
                    "[]",
                    "1500",
                    "1500",
                ]).expect("Failed to insert task to keep");
            }

            let conn = log.db.conn.lock().unwrap();

            let count_before: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM instance_log WHERE task_id = 'task_to_delete'",
                    [],
                    |row| row.get(0),
                )
                .expect("Failed to count logs before deletion");
            assert_eq!(
                count_before, 2,
                "Expected 2 logs for task_to_delete before deletion"
            );

            drop(conn);

            log.delete_log("task_to_delete")
                .expect("Failed to delete logs");

            let conn = log.db.conn.lock().unwrap();

            let count_after: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM instance_log WHERE task_id = 'task_to_delete'",
                    [],
                    |row| row.get(0),
                )
                .expect("Failed to count logs after deletion");
            assert_eq!(
                count_after, 0,
                "Expected 0 logs for task_to_delete after deletion"
            );

            let count_kept: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM instance_log WHERE task_id = 'task_to_keep'",
                    [],
                    |row| row.get(0),
                )
                .expect("Failed to count kept logs");
            assert_eq!(count_kept, 1, "Expected 1 log for task_to_keep to remain");

            let kept_state: String = conn
                .query_row(
                    "SELECT state FROM instance_log WHERE task_id = 'task_to_keep'",
                    [],
                    |row| row.get(0),
                )
                .expect("Failed to query kept log state");
            assert_eq!(
                kept_state, "completed",
                "Kept log should have correct state"
            );
        }

        #[test]
        fn test_clear_logs() {
            let log = Log::new(None, "trace.db-wal").unwrap();

            {
                let conn = log.db.conn.lock().unwrap();

                conn.execute("INSERT INTO instance_log (id, agent_name, agent_version, task_id, task_name, state, fuel_limit, fuel_consumed, ram_used, host_requests, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                    &nanoid!(10),
                    "test_agent",
                    "1.0.0",
                    "task_created",
                    "Task Created",
                    "created",
                    "10000",
                    "0",
                    "0",
                    "[]",
                    "1000",
                    "1000",
                ]).expect("Failed to insert created log");

                conn.execute("INSERT INTO instance_log (id, agent_name, agent_version, task_id, task_name, state, fuel_limit, fuel_consumed, ram_used, host_requests, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                    &nanoid!(10),
                    "test_agent",
                    "1.0.0",
                    "task_running",
                    "Task Running",
                    "running",
                    "10000",
                    "5000",
                    "1500",
                    "[]",
                    "2000",
                    "2000",
                ]).expect("Failed to insert running log");

                conn.execute("INSERT INTO instance_log (id, agent_name, agent_version, task_id, task_name, state, fuel_limit, fuel_consumed, ram_used, host_requests, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                    &nanoid!(10),
                    "test_agent",
                    "1.0.0",
                    "task_completed",
                    "Task Completed",
                    "completed",
                    "10000",
                    "8500",
                    "1500",
                    "[]",
                    "3000",
                    "3000",
                ]).expect("Failed to insert completed log");

                conn.execute("INSERT INTO instance_log (id, agent_name, agent_version, task_id, task_name, state, fuel_limit, fuel_consumed, ram_used, host_requests, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                    &nanoid!(10),
                    "test_agent",
                    "1.0.0",
                    "task_failed",
                    "Task Failed",
                    "failed",
                    "5000",
                    "2500",
                    "1500",
                    "[]",
                    "1500",
                    "1500",
                ]).expect("Failed to insert failed log");

                conn.execute("INSERT INTO instance_log (id, agent_name, agent_version, task_id, task_name, state, fuel_limit, fuel_consumed, ram_used, host_requests, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                    &nanoid!(10),
                    "test_agent",
                    "1.0.0",
                    "task_interrupted",
                    "Task Interrupted",
                    "interrupted",
                    "7000",
                    "3000",
                    "1500",
                    "[]",
                    "2500",
                    "2500",
                ]).expect("Failed to insert interrupted log");
            }

            let conn = log.db.conn.lock().unwrap();

            let count_before: i64 = conn
                .query_row("SELECT COUNT(*) FROM instance_log", [], |row| row.get(0))
                .expect("Failed to count logs before clear");
            assert_eq!(count_before, 5, "Expected 5 logs before clear");

            drop(conn);

            log.clear_logs().expect("Failed to clear logs");

            let conn = log.db.conn.lock().unwrap();

            let count_after: i64 = conn
                .query_row("SELECT COUNT(*) FROM instance_log", [], |row| row.get(0))
                .expect("Failed to count logs after clear");
            assert_eq!(
                count_after, 2,
                "Expected 2 logs after clear (running and completed)"
            );

            let running_exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM instance_log WHERE task_id = 'task_running'",
                    [],
                    |row| {
                        let count: i64 = row.get(0)?;
                        Ok(count > 0)
                    },
                )
                .expect("Failed to check running log");
            assert!(running_exists, "Running log should still exist");

            let completed_exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM instance_log WHERE task_id = 'task_completed'",
                    [],
                    |row| {
                        let count: i64 = row.get(0)?;
                        Ok(count > 0)
                    },
                )
                .expect("Failed to check completed log");
            assert!(completed_exists, "Completed log should still exist");

            let created_exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM instance_log WHERE task_id = 'task_created'",
                    [],
                    |row| {
                        let count: i64 = row.get(0)?;
                        Ok(count > 0)
                    },
                )
                .expect("Failed to check created log");
            assert!(!created_exists, "Created log should be deleted");

            let failed_exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM instance_log WHERE task_id = 'task_failed'",
                    [],
                    |row| {
                        let count: i64 = row.get(0)?;
                        Ok(count > 0)
                    },
                )
                .expect("Failed to check failed log");
            assert!(!failed_exists, "Failed log should be deleted");

            let interrupted_exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM instance_log WHERE task_id = 'task_interrupted'",
                    [],
                    |row| {
                        let count: i64 = row.get(0)?;
                        Ok(count > 0)
                    },
                )
                .expect("Failed to check interrupted log");
            assert!(!interrupted_exists, "Interrupted log should be deleted");
        }
    }

    mod queries {
        use super::*;

        #[test]
        fn test_get_logs() {
            let log = Log::new(None, "trace.db-wal").unwrap();

            {
                let conn = log.db.conn.lock().unwrap();

                conn.execute("INSERT INTO instance_log (id, agent_name, agent_version, task_id, task_name, state, fuel_limit, fuel_consumed, ram_used, host_requests, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                    &nanoid!(10),
                    "test_agent",
                    "1.0.0",
                    "test_task_123",
                    "Test Task",
                    "created",
                    "10000",
                    "0",
                    "0",
                    "[]",
                    "1000",
                    "1000",
                ]).expect("Failed to insert first test log");

                conn.execute("INSERT INTO instance_log (id, agent_name, agent_version, task_id, task_name, state, fuel_limit, fuel_consumed, ram_used, host_requests, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                    &nanoid!(10),
                    "test_agent",
                    "1.0.0",
                    "test_task_123",
                    "Test Task",
                    "running",
                    "10000",
                    "5000",
                    "1500",
                    "[]",
                    "2000",
                    "2000",
                ]).expect("Failed to insert second test log");

                conn.execute("INSERT INTO instance_log (id, agent_name, agent_version, task_id, task_name, state, fuel_limit, fuel_consumed, ram_used, host_requests, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                    &nanoid!(10),
                    "test_agent",
                    "1.0.0",
                    "test_task_123",
                    "Test Task",
                    "completed",
                    "10000",
                    "8500",
                    "1500",
                    "[{\"url\":\"http://example.com\",\"method\":\"GET\",\"status\":200}]",
                    "3000",
                    "3000",
                ]).expect("Failed to insert third test log");

                conn.execute("INSERT INTO instance_log (id, agent_name, agent_version, task_id, task_name, state, fuel_limit, fuel_consumed, ram_used, host_requests, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                    &nanoid!(10),
                    "other_agent",
                    "2.0.0",
                    "other_task_456",
                    "Other Task",
                    "failed",
                    "5000",
                    "2500",
                    "1500",
                    "[]",
                    "1500",
                    "1500",
                ]).expect("Failed to insert other task log");
            }

            let logs = log.get_logs().expect("Failed to get logs");

            assert_eq!(logs.len(), 4, "Expected 4 total logs");

            assert_eq!(
                logs[0].state.to_string(),
                "completed",
                "First log should be completed"
            );
            assert_eq!(
                logs[0].fuel_consumed, 8500,
                "First log fuel_consumed should be 8500"
            );
            assert_eq!(logs[0].ram_used, 1500, "First log ram_used should be 1500");
            assert_eq!(
                logs[0].created_at, 3000,
                "First log created_at should be 3000"
            );

            assert_eq!(
                logs[0].host_requests,
                vec![HostRequest {
                    method: "GET".to_string(),
                    url: "http://example.com".to_string(),
                    headers: None,
                    body: None
                }],
                "First log host_requests should be []"
            );

            assert_eq!(
                logs[1].state.to_string(),
                "running",
                "Second log should be running"
            );
            assert_eq!(
                logs[1].fuel_consumed, 5000,
                "Second log fuel_consumed should be 5000"
            );
            assert_eq!(logs[1].ram_used, 1500, "Second log ram_used should be 1500");
            assert_eq!(
                logs[1].created_at, 2000,
                "Second log created_at should be 2000"
            );

            assert_eq!(
                logs[1].host_requests,
                vec![],
                "Second log host_requests should be []"
            );

            assert_eq!(
                logs[2].task_id, "other_task_456",
                "Third log should be other_task_456"
            );

            assert_eq!(
                logs[2].state.to_string(),
                "failed",
                "Third log should be failed"
            );

            assert_eq!(
                logs[2].host_requests,
                vec![],
                "Third log host_requests should be empty"
            );
            assert_eq!(
                logs[2].created_at, 1500,
                "Third log created_at should be 1500"
            );

            assert_eq!(
                logs[3].task_id, "test_task_123",
                "Fourth log should be test_task_123"
            );
            assert_eq!(
                logs[3].state.to_string(),
                "created",
                "Fourth log should be created"
            );
            assert_eq!(
                logs[3].fuel_consumed, 0,
                "Fourth log fuel_consumed should be 0"
            );
            assert_eq!(logs[3].ram_used, 0, "Fourth log ram_used should be 0");
            assert_eq!(
                logs[3].created_at, 1000,
                "Fourth log created_at should be 1000"
            );

            assert_eq!(
                logs[3].host_requests,
                vec![],
                "Fourth log host_requests should be []"
            );

            let test_task_logs: Vec<_> = logs
                .iter()
                .filter(|l| l.task_id == "test_task_123")
                .collect();
            assert_eq!(test_task_logs.len(), 3, "Expected 3 logs for test_task_123");

            for log_entry in test_task_logs {
                assert_eq!(
                    log_entry.agent_name, "test_agent",
                    "test_task_123 logs should have agent_name test_agent"
                );
                assert_eq!(
                    log_entry.task_name, "Test Task",
                    "test_task_123 logs should have task_name Test Task"
                );
            }

            let other_task_logs: Vec<_> = logs
                .iter()
                .filter(|l| l.task_id == "other_task_456")
                .collect();
            assert_eq!(
                other_task_logs.len(),
                1,
                "Expected 1 log for other_task_456"
            );
            assert_eq!(
                other_task_logs[0].agent_name, "other_agent",
                "other_task_456 log should have agent_name other_agent"
            );
        }
    }
}
