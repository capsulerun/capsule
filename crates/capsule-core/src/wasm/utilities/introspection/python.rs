use rustpython_parser::{Mode, ast, parse};
use std::collections::HashMap;

pub fn extract_python_task_configs(source: &str) -> Option<HashMap<String, serde_json::Value>> {
    let ast = parse(source, Mode::Module, "<source>").ok()?;
    let mut tasks = HashMap::new();

    let body = match ast {
        ast::Mod::Module(m) => m.body,
        _ => return None,
    };

    for stmt in body {
        let (name, decorators) = match &stmt {
            ast::Stmt::FunctionDef(f) => (f.name.as_ref(), &f.decorator_list),
            ast::Stmt::AsyncFunctionDef(f) => (f.name.as_ref(), &f.decorator_list),
            _ => continue,
        };

        for decorator in decorators {
            if let Some(config) = extract_task_decorator(decorator, name) {
                let task_name = config
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(name)
                    .to_string();
                tasks.insert(task_name, serde_json::to_value(&config).ok()?);
            }
        }
    }

    if tasks.is_empty() { None } else { Some(tasks) }
}

fn extract_task_decorator(
    decorator: &ast::Expr,
    func_name: &str,
) -> Option<HashMap<String, serde_json::Value>> {
    match decorator {
        ast::Expr::Name(name) if name.id.as_str() == "task" => {
            let mut config = HashMap::new();
            config.insert(
                "name".to_string(),
                serde_json::Value::String(func_name.to_string()),
            );
            Some(config)
        }

        ast::Expr::Call(call) => {
            if let ast::Expr::Name(name) = call.func.as_ref()
                && name.id.as_str() == "task"
            {
                return extract_call_args(call, func_name);
            }
            None
        }
        _ => None,
    }
}

fn extract_call_args(
    call: &ast::ExprCall,
    func_name: &str,
) -> Option<HashMap<String, serde_json::Value>> {
    let mut config = HashMap::new();

    for keyword in &call.keywords {
        if let Some(arg_name) = &keyword.arg
            && let Some(value) = extract_literal(&keyword.value)
        {
            config.insert(arg_name.to_string(), value);
        }
    }

    if !config.contains_key("name") {
        config.insert(
            "name".to_string(),
            serde_json::Value::String(func_name.to_string()),
        );
    }

    Some(config)
}

fn normalize_file_entry(
    map: &std::collections::HashMap<String, serde_json::Value>,
) -> Option<serde_json::Value> {
    let path = map.get("path")?.as_str()?.to_string();
    let mode = map.get("mode").and_then(|v| v.as_str()).unwrap_or("");
    let normalized = match mode {
        "ro" | "read-only" => format!("{}:ro", path),
        _ => path,
    };
    Some(serde_json::Value::String(normalized))
}

fn extract_literal(expr: &ast::Expr) -> Option<serde_json::Value> {
    match expr {
        ast::Expr::Constant(c) => match &c.value {
            ast::Constant::Str(s) => Some(serde_json::Value::String(s.to_string())),
            ast::Constant::Int(i) => {
                let val: i64 = i.to_string().parse().ok()?;
                Some(serde_json::Value::Number(val.into()))
            }
            ast::Constant::Float(f) => {
                serde_json::Number::from_f64(*f).map(serde_json::Value::Number)
            }
            ast::Constant::Bool(b) => Some(serde_json::Value::Bool(*b)),
            ast::Constant::None => Some(serde_json::Value::Null),
            _ => None,
        },
        ast::Expr::List(list) => {
            let items: Option<Vec<serde_json::Value>> =
                list.elts.iter().map(extract_literal).collect();

            items.map(serde_json::Value::Array)
        }
        ast::Expr::Dict(dict) => {
            let mut map = HashMap::new();
            for (key, value) in dict.keys.iter().zip(dict.values.iter()) {
                if let Some(key_expr) = key
                    && let ast::Expr::Constant(k) = key_expr
                    && let ast::Constant::Str(key_str) = &k.value
                    && let Some(val) = extract_literal(value)
                {
                    map.insert(key_str.to_string(), val);
                }
            }
            normalize_file_entry(&map)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_task_with_name() {
        let source = r#"
@task(name="main", compute="HIGH")
def my_func():
    pass
"#;
        let configs = extract_python_task_configs(source).unwrap();
        assert!(configs.contains_key("main"));
        let config = &configs["main"];
        assert_eq!(config["name"], "main");
        assert_eq!(config["compute"], "HIGH");
    }

    #[test]
    fn test_bare_task_decorator() {
        let source = r#"
@task
def main():
    pass
"#;
        let configs = extract_python_task_configs(source).unwrap();
        assert!(configs.contains_key("main"));
    }

    #[test]
    fn test_async_task() {
        let source = r#"
@task(name="fetch", compute="HIGH", timeout="30s")
async def fetch():
    pass
"#;
        let configs = extract_python_task_configs(source).unwrap();
        assert!(configs.contains_key("fetch"));
        let config = &configs["fetch"];
        assert_eq!(config["compute"], "HIGH");
        assert_eq!(config["timeout"], "30s");
    }

    #[test]
    fn test_no_task_decorator() {
        let source = r#"
def main():
    pass
"#;
        let configs = extract_python_task_configs(source);
        assert!(configs.is_none());
    }

    #[test]
    fn test_allowed_files_plain_strings() {
        let source = r#"
@task(name="main", allowed_files=["./data", "./output"])
def main():
    pass
"#;
        let configs = extract_python_task_configs(source).unwrap();
        assert_eq!(
            configs["main"]["allowed_files"],
            serde_json::json!(["./data", "./output"])
        );
    }

    #[test]
    fn test_allowed_files_structured_read_only() {
        let source = r#"
@task(name="main", allowed_files=[{"path": "./data", "mode": "read-only"}, {"path": "./output", "mode": "read-write"}])
def main():
    pass
"#;
        let configs = extract_python_task_configs(source).unwrap();
        assert_eq!(
            configs["main"]["allowed_files"],
            serde_json::json!(["./data:ro", "./output"])
        );
    }
}
