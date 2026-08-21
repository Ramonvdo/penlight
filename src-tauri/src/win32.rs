#[cfg(windows)]
pub fn reassert_topmost(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };
    let Ok(hwnd) = window.hwnd() else { return };
    // The Win11 taskbar is itself WS_EX_TOPMOST; after the user interacts with
    // it our overlays can drop below. Re-assert without activating.
    unsafe {
        SetWindowPos(
            hwnd.0 as _,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

#[cfg(not(windows))]
pub fn reassert_topmost(_window: &tauri::WebviewWindow) {}

/// True when running from an MSIX package (the Microsoft Store build).
///
/// Matters because a packaged app gets a virtualized registry: the Run key
/// tauri-plugin-autostart writes is silently discarded, so "launch at login"
/// has to come from the manifest's StartupTask, which the user opts into from
/// Windows Settings instead.
#[cfg(windows)]
pub fn is_packaged() -> bool {
    use windows_sys::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;
    use windows_sys::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;
    let mut len: u32 = 0;
    // Asking with a zero-length buffer: a packaged process reports "buffer too
    // small", an unpackaged one reports APPMODEL_ERROR_NO_PACKAGE.
    let rc = unsafe { GetCurrentPackageFullName(&mut len, std::ptr::null_mut()) };
    rc == ERROR_INSUFFICIENT_BUFFER
}

#[cfg(not(windows))]
pub fn is_packaged() -> bool {
    false
}
