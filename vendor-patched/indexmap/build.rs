fn main() {
    // 本地补丁：无条件声明 has_std。
    //
    // 上游用 `autocfg` 探测 sysroot 是否提供 `std`，在部分较新的 Rust 工具链上
    // 该探测会失败，导致 crate 走 `#[cfg(not(has_std))]` 分支：此时
    // `IndexMap<K, V>` 失去默认哈希参数 `S`，而 `schemars 0.8`（tauri-build /
    // tauri-plugin 的传递依赖，且开了 `preserve_order`）按两参数形式引用它，
    // 编译报 `E0107: struct takes 3 generic arguments but 2 were supplied`。
    //
    // 本补丁的目标平台必然有 std（Windows/macOS/Linux 桌面 + 服务端），
    // 直接声明即可，不改变任何运行时行为。
    //
    // 先声明 check-cfg 再声明 cfg：autocfg 的自由函数 `emit()` 不会自动调用
    // `emit_possibility()`（见其文档），缺了这一步，rustc 的 `unexpected_cfgs`
    // 会对 `#[cfg(has_std)]` 告警；而本仓库 CI 的 clippy 带 `-D warnings`，
    // 告警会直接升级为错误，把 `indexmap` 编译打断。
    autocfg::emit_possibility("has_std");
    autocfg::emit("has_std");
    autocfg::rerun_path("build.rs");
}
