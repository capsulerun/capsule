use std::collections::HashMap;
use swc_common::input::StringInput;
use swc_common::sync::Lrc;
use swc_common::{FileName, SourceMap};
use swc_ecma_ast::{
    CallExpr, Callee, Decl, Expr, Lit, ModuleDecl, ModuleItem, ObjectLit, Pat, Prop, PropName,
    PropOrSpread, Stmt,
};
use swc_ecma_parser::{EsSyntax, Parser, Syntax, TsSyntax};

pub fn extract_js_task_configs(
    source: &str,
    is_typescript: bool,
) -> Option<HashMap<String, serde_json::Value>> {
    let cm: Lrc<SourceMap> = Default::default();
    let fm = cm.new_source_file(
        Lrc::new(FileName::Custom("source".into())),
        String::from(source),
    );

    let syntax = if is_typescript {
        Syntax::Typescript(TsSyntax::default())
    } else {
        Syntax::Es(EsSyntax::default())
    };

    let mut parser = Parser::new(syntax, StringInput::from(&*fm), None);
    let module = parser.parse_module().ok()?;

    let mut tasks = HashMap::new();

    for item in &module.body {
        match item {
            ModuleItem::Stmt(Stmt::Decl(Decl::Var(var_decl))) => {
                for decl in var_decl.decls.iter() {
                    if let Some(init) = &decl.init
                        && let Some((task_name, config)) =
                            extract_task_with_binding(init, Some(&decl.name))
                    {
                        tasks.insert(task_name, serde_json::to_value(&config).unwrap());
                    }
                }
            }

            ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(export)) => {
                if let Decl::Var(var_decl) = &export.decl {
                    for decl in var_decl.decls.iter() {
                        if let Some(init) = &decl.init
                            && let Some((task_name, config)) =
                                extract_task_with_binding(init, Some(&decl.name))
                        {
                            tasks.insert(task_name, serde_json::to_value(&config).unwrap());
                        }
                    }
                }
            }

            ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultExpr(export)) => {
                if let Some((task_name, config)) = extract_task_with_binding(&export.expr, None) {
                    tasks.insert(task_name, serde_json::to_value(&config).unwrap());
                }
            }

            ModuleItem::Stmt(Stmt::Expr(expr_stmt)) => {
                if let Expr::Call(call) = expr_stmt.expr.as_ref()
                    && let Some((task_name, config)) = extract_task_from_call(call, None)
                {
                    tasks.insert(task_name, serde_json::to_value(&config).unwrap());
                }
            }

            _ => {}
        }
    }

    if tasks.is_empty() { None } else { Some(tasks) }
}

fn extract_task_with_binding(
    expr: &Expr,
    binding_name: Option<&Pat>,
) -> Option<(String, HashMap<String, serde_json::Value>)> {
    if let Expr::Call(call) = expr {
        let fallback_name = binding_name.and_then(|pat| match pat {
            Pat::Ident(ident) => Some(ident.sym.as_str().to_string()),
            _ => None,
        });
        extract_task_from_call(call, fallback_name.as_deref())
    } else {
        None
    }
}

fn extract_task_from_call(
    call: &CallExpr,
    fallback_name: Option<&str>,
) -> Option<(String, HashMap<String, serde_json::Value>)> {
    if let Callee::Expr(callee) = &call.callee
        && let Expr::Ident(ident) = callee.as_ref()
        && ident.sym.as_ref() == "task"
        && let Some(first_arg) = call.args.first()
        && let Expr::Object(obj) = first_arg.expr.as_ref()
    {
        let config = extract_object_literal(obj);

        let task_name = config
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| fallback_name.map(|s| s.to_string()))?;

        let mut final_config = config;
        final_config.insert(
            "name".to_string(),
            serde_json::Value::String(task_name.clone()),
        );

        return Some((task_name, final_config));
    }

    None
}

fn extract_object_literal(obj: &ObjectLit) -> HashMap<String, serde_json::Value> {
    let mut config: HashMap<String, serde_json::Value> = HashMap::new();

    for prop in &obj.props {
        if let PropOrSpread::Prop(prop) = prop
            && let Prop::KeyValue(kv) = prop.as_ref()
        {
            let key = match &kv.key {
                PropName::Ident(ident) => ident.sym.as_str().to_string(),
                PropName::Str(s) => s.value.as_str().unwrap_or_default().to_string(),
                _ => continue,
            };

            if let Some(value) = extract_js_literal(&kv.value) {
                config.insert(key, value);
            }
        }
    }

    config
}

fn extract_js_literal(expr: &Expr) -> Option<serde_json::Value> {
    match expr {
        Expr::Lit(lit) => match lit {
            Lit::Str(s) => Some(serde_json::Value::String(
                s.value.as_str().unwrap_or_default().to_string(),
            )),
            Lit::Num(n) => serde_json::Number::from_f64(n.value).map(serde_json::Value::Number),
            Lit::Bool(b) => Some(serde_json::Value::Bool(b.value)),
            Lit::Null(_) => Some(serde_json::Value::Null),
            _ => None,
        },
        Expr::Array(arr) => {
            let items: Option<Vec<serde_json::Value>> = arr
                .elems
                .iter()
                .filter_map(|e| e.as_ref())
                .map(|e| extract_js_literal(&e.expr))
                .collect();

            items.map(serde_json::Value::Array)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_js_task_with_config() {
        let source = r#"
const main = task({ name: "main", compute: "HIGH" }, () => {
    return "hello";
});
"#;
        let configs = extract_js_task_configs(source, false).unwrap();
        assert!(configs.contains_key("main"));
        assert_eq!(configs["main"]["compute"], "HIGH");
    }

    #[test]
    fn test_ts_task() {
        let source = r#"
export const main = task({ name: "main", timeout: "30s" }, (): string => {
    return "hello";
});
"#;
        let configs = extract_js_task_configs(source, true).unwrap();
        assert!(configs.contains_key("main"));
        assert_eq!(configs["main"]["timeout"], "30s");
    }

    #[test]
    fn test_js_task_with_config_default_export() {
        let source = r#"
export default task({ name: "main", compute: "HIGH" }, () => {
    return "hello";
});
"#;
        let configs = extract_js_task_configs(source, false).unwrap();
        assert!(configs.contains_key("main"));
        assert_eq!(configs["main"]["compute"], "HIGH");
    }

    #[test]
    fn test_no_task() {
        let source = r#"
function main() {
    return "hello";
}
"#;
        let configs = extract_js_task_configs(source, false);
        assert!(configs.is_none());
    }

    #[test]
    fn test_direct_task_call() {
        let source = r#"
task({ name: "directTask", compute: "HIGH" }, () => {
    return "hello";
});
"#;
        let configs = extract_js_task_configs(source, false).unwrap();
        assert!(configs.contains_key("directTask"));
        assert_eq!(configs["directTask"]["compute"], "HIGH");
    }

    #[test]
    fn test_task_without_name_uses_variable() {
        let source = r#"
const myTask = task({ compute: "LOW" }, () => {
    return "hello";
});
"#;
        let configs = extract_js_task_configs(source, false).unwrap();
        assert!(configs.contains_key("myTask"));
        assert_eq!(configs["myTask"]["name"], "myTask");
    }

    #[test]
    fn test_async_task_uses_variable() {
        let source = r#"
const asyncTask = task({ name: "asyncTask", compute: "LOW" }, async () => {
    return "hello";
});
"#;
        let configs = extract_js_task_configs(source, false).unwrap();
        assert!(configs.contains_key("asyncTask"));
        assert_eq!(configs["asyncTask"]["compute"], "LOW");
    }
}
