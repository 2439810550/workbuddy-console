//! CodeBuddy CLI 认证同步的端到端回归测试。
//!
//! 覆盖两条真实故障：
//! 1. **误报**：保活刷新刚写完账号库、settings 尚未跟上的正常中间态，不该报「脱节」；
//! 2. **不可自愈**：settings 里的 token 是孤儿值（匹配不上任何账号）时，
//!    刷新后的同步必须能纠正它，否则横幅永远消不掉。
//!
//! 隔离方式：把 `WB_SWITCH_HOME` 指向临时目录（见 `config::HOME_ENV_VAR`），
//! 使 `~/.wb-switch`、`~/.codebuddy`、`~/.codebuddy-rotate` 全部落在沙箱内。
//! **全程不触碰真实账号与 CLI 配置。**
//!
//! 整个文件只在 Windows 上编译：被测的 `sync_windows_env_for_account` 与 `status()`
//! 的 settings-env 分支都是 Windows 专属。加这层门禁是为了让 CI 的
//! `clippy --all-targets -- -D warnings`（跑在 macOS）不因「导入、常量、方法在非
//! Windows 下全部未被使用」而失败。

#![cfg(windows)]

use std::path::PathBuf;

use wb_switch_core::modules::codebuddy_cli;
use wb_switch_core::modules::config::HOME_ENV_VAR;

struct Sandbox {
    root: PathBuf,
}

impl Sandbox {
    fn new(tag: &str) -> Self {
        let root = std::env::temp_dir().join(format!("wb-switch-e2e-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for dir in [".wb-switch", ".codebuddy", ".codebuddy-rotate"] {
            std::fs::create_dir_all(root.join(dir)).unwrap();
        }
        Self { root }
    }

    fn write(&self, rel: &str, content: &str) {
        std::fs::write(self.root.join(rel), content).unwrap();
    }

    /// 从沙箱根直接拼路径读取。
    ///
    /// **不要**用 `home_dir()`：`with_sandbox_home` 返回后环境变量已还原，
    /// 那样会读到真实的 `~/.codebuddy/settings.json`。
    fn read(&self, rel: &str) -> serde_json::Value {
        serde_json::from_str(&std::fs::read_to_string(self.root.join(rel)).unwrap()).unwrap()
    }

    /// 把账号库的 mtime 设为距今 `seconds_ago` 秒。
    fn age_accounts(&self, seconds_ago: u64) {
        let path = self.root.join(".wb-switch/accounts.json");
        let target = std::time::SystemTime::now() - std::time::Duration::from_secs(seconds_ago);
        let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_modified(target).unwrap();
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// 环境变量是进程级的，本文件内的用例必须串行执行。
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 沙箱期间必须清空的进程环境变量。
///
/// `sync_windows_env_for_account` 会检测它们并直接拒绝写入（理由：它们会覆盖
/// `settings.json`）。在 CodeBuddy CLI 自己的进程里跑测试时 `CODEBUDDY_AUTH_TOKEN`
/// 天然存在，不清掉就会得到与被测逻辑无关的假失败——测的不是修复，而是当前 shell。
const CLEARED_ENV_VARS: [&str; 2] = ["CODEBUDDY_AUTH_TOKEN", "CODEBUDDY_INTERNET_ENVIRONMENT"];

fn with_sandbox_home<T>(sandbox: &Sandbox, f: impl FnOnce() -> T) -> T {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let root = sandbox.root.to_string_lossy().to_string();

    let prev_home = std::env::var_os(HOME_ENV_VAR);
    let prev_cleared: Vec<Option<std::ffi::OsString>> =
        CLEARED_ENV_VARS.iter().map(std::env::var_os).collect();

    std::env::set_var(HOME_ENV_VAR, &root);
    for name in CLEARED_ENV_VARS {
        std::env::remove_var(name);
    }

    let result = f();

    for (name, prev) in CLEARED_ENV_VARS.iter().zip(prev_cleared) {
        match prev {
            Some(v) => std::env::set_var(name, v),
            None => std::env::remove_var(name),
        }
    }
    match prev_home {
        Some(v) => std::env::set_var(HOME_ENV_VAR, v),
        None => std::env::remove_var(HOME_ENV_VAR),
    }
    result
}

const ACCOUNTS_A_AND_B: &str = r#"[
  {"id": "acct-a", "access_token": "TOKEN_A_REAL", "refresh_token": "rt-a", "variant": "cn"},
  {"id": "acct-b", "access_token": "TOKEN_B_REAL", "refresh_token": "rt-b", "variant": "cn"}
]"#;

const STATE_POINTS_TO_A: &str = r#"{"active": 0, "activeAccountId": "acct-a"}"#;

// ---------------------------------------------------------------------------
// 场景 1：误报（syncPending / syncInProgress 拆分）
// ---------------------------------------------------------------------------

/// 刚刷新完（账号库 mtime 是「现在」）→ 报 syncInProgress，不报 syncPending。
#[test]
#[cfg(windows)]
fn freshly_refreshed_store_reports_sync_in_progress_not_pending() {
    let sandbox = Sandbox::new("fresh");
    sandbox.write(".wb-switch/accounts.json", ACCOUNTS_A_AND_B);
    sandbox.write(".codebuddy-rotate/state.json", STATE_POINTS_TO_A);
    // settings 里放一个账号库中不存在的旧 token —— 复现保活刷新的中间态。
    sandbox.write(
        ".codebuddy/settings.json",
        r#"{"env": {"CODEBUDDY_AUTH_TOKEN": "Bearer STALE_TOKEN_NOT_IN_STORE"}}"#,
    );

    let status = with_sandbox_home(&sandbox, codebuddy_cli::status);

    assert_eq!(
        status.get("syncPending").and_then(|v| v.as_bool()),
        Some(false),
        "刚刷新完账号库时不应报「认证脱节」：{status}"
    );
    assert_eq!(
        status.get("syncInProgress").and_then(|v| v.as_bool()),
        Some(true),
        "刚刷新完账号库时应报「同步进行中」：{status}"
    );
}

/// 账号库很久没动、token 仍对不上 → 报 syncPending（真脱节）。
#[test]
#[cfg(windows)]
fn long_stale_store_still_reports_sync_pending() {
    let sandbox = Sandbox::new("stale");
    sandbox.write(".wb-switch/accounts.json", ACCOUNTS_A_AND_B);
    sandbox.write(".codebuddy-rotate/state.json", STATE_POINTS_TO_A);
    sandbox.write(
        ".codebuddy/settings.json",
        r#"{"env": {"CODEBUDDY_AUTH_TOKEN": "Bearer STALE_TOKEN_NOT_IN_STORE"}}"#,
    );
    sandbox.age_accounts(10 * 60);

    let status = with_sandbox_home(&sandbox, codebuddy_cli::status);

    assert_eq!(
        status.get("syncPending").and_then(|v| v.as_bool()),
        Some(true),
        "长期对不上时应报脱节：{status}"
    );
    assert_eq!(
        status.get("syncInProgress").and_then(|v| v.as_bool()),
        Some(false),
        "长期对不上时不应报「同步进行中」：{status}"
    );
}

/// settings token 与账号库一致 → 两种状态都不报。
#[test]
#[cfg(windows)]
fn consistent_token_reports_no_sync_state() {
    let sandbox = Sandbox::new("consistent");
    sandbox.write(".wb-switch/accounts.json", ACCOUNTS_A_AND_B);
    sandbox.write(".codebuddy-rotate/state.json", STATE_POINTS_TO_A);
    sandbox.write(
        ".codebuddy/settings.json",
        r#"{"env": {"CODEBUDDY_AUTH_TOKEN": "Bearer TOKEN_A_REAL"}}"#,
    );

    let status = with_sandbox_home(&sandbox, codebuddy_cli::status);

    assert_eq!(
        status.get("syncPending").and_then(|v| v.as_bool()),
        Some(false)
    );
    assert_eq!(
        status.get("syncInProgress").and_then(|v| v.as_bool()),
        Some(false)
    );
    assert_eq!(
        status.get("activeAccountId").and_then(|v| v.as_str()),
        Some("acct-a"),
        "沙箱隔离未生效：{status}"
    );
}

// ---------------------------------------------------------------------------
// 场景 2：孤儿 token 自愈
// ---------------------------------------------------------------------------

/// settings 里的 token 匹配不上任何账号时，刷新后的同步必须把它纠正过来。
///
/// 这是「横幅一直挂着」的根因回归：settings 既不等于刷新前 token、也不等于刷新后
/// token 时，原逻辑会永远跳过同步 —— 状态不可自愈，只能手动点按钮。
#[test]
#[cfg(windows)]
fn orphaned_settings_token_is_healed_by_sync() {
    let sandbox = Sandbox::new("orphan-heal");
    sandbox.write(
        ".wb-switch/accounts.json",
        r#"[
  {"id": "acct-a", "access_token": "NEW_TOKEN_A", "refresh_token": "rt-a", "variant": "cn"},
  {"id": "acct-b", "access_token": "TOKEN_B", "refresh_token": "rt-b", "variant": "cn"}
]"#,
    );
    sandbox.write(".codebuddy-rotate/state.json", STATE_POINTS_TO_A);
    sandbox.write(
        ".codebuddy/settings.json",
        r#"{"env": {"CODEBUDDY_AUTH_TOKEN": "Bearer ORPHAN_TOKEN_XYZ"}}"#,
    );

    let result = with_sandbox_home(&sandbox, || {
        codebuddy_cli::sync_windows_env_for_account(
            &serde_json::json!({
                "id": "acct-a",
                "access_token": "NEW_TOKEN_A",
                "variant": "cn",
            }),
            Some("OLD_TOKEN_A"),
        )
    });

    assert_eq!(
        result,
        Ok(true),
        "孤儿 settings token 应被同步覆盖，而不是被跳过：{result:?}"
    );
    assert_eq!(
        sandbox.read(".codebuddy/settings.json")["env"]["CODEBUDDY_AUTH_TOKEN"],
        "NEW_TOKEN_A",
        "settings 未被纠正为新 token"
    );
}

/// settings 的 token 命中**其它**账号时，同步不得覆盖它（用户手动切换的保护）。
#[test]
#[cfg(windows)]
fn sync_must_not_clobber_another_accounts_token() {
    let sandbox = Sandbox::new("no-clobber");
    sandbox.write(
        ".wb-switch/accounts.json",
        r#"[
  {"id": "acct-a", "access_token": "NEW_TOKEN_A", "refresh_token": "rt-a", "variant": "cn"},
  {"id": "acct-b", "access_token": "TOKEN_B", "refresh_token": "rt-b", "variant": "cn"}
]"#,
    );
    sandbox.write(".codebuddy-rotate/state.json", STATE_POINTS_TO_A);
    sandbox.write(
        ".codebuddy/settings.json",
        r#"{"env": {"CODEBUDDY_AUTH_TOKEN": "Bearer TOKEN_B"}}"#,
    );

    let result = with_sandbox_home(&sandbox, || {
        codebuddy_cli::sync_windows_env_for_account(
            &serde_json::json!({
                "id": "acct-a",
                "access_token": "NEW_TOKEN_A",
                "variant": "cn",
            }),
            Some("OLD_TOKEN_A"),
        )
    });

    assert_eq!(
        result,
        Ok(false),
        "不应覆盖指向其它账号的 token：{result:?}"
    );
    // 没有写入 → 文件应保持原样（含 "Bearer " 前缀，未被规范化）。
    assert_eq!(
        sandbox.read(".codebuddy/settings.json")["env"]["CODEBUDDY_AUTH_TOKEN"],
        "Bearer TOKEN_B",
        "用户手选的账号 token 被覆盖了"
    );
}
