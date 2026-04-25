#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                use tauri_plugin_shell::ShellExt;

                match app.shell().sidecar("luma-bridge") {
                    Ok(command) => {
                        if let Err(error) = command
                            .env("AMUNET_SERVE_STATIC", "0")
                            .env("AMUNET_TRUST_LOCAL_API", "1")
                            .env("AMUNET_HOST", "127.0.0.1")
                            .env("AMUNET_STATUS_PORT", "8787")
                            .spawn()
                        {
                            eprintln!("failed to start Luma bridge sidecar: {error}");
                        }
                    }
                    Err(error) => {
                        eprintln!("failed to locate Luma bridge sidecar: {error}");
                    }
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Luma Arcade");
}
