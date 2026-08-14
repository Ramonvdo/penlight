#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebView2's default background alpha only honors 0 or 255 and can silently
    // revert after a GPU-process recycle; this env var makes every webview
    // start fully transparent.
    std::env::set_var("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "00000000");
    penlight_lib::run()
}
