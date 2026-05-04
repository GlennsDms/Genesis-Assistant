use std::collections::HashMap;
use std::sync::Mutex;

use chrono::Utc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_notification::NotificationExt;
// Estado compartido: cada recordatorio pendiente tiene exactamente una tarea tokio activa.
// El Mutex garantiza que programar y cancelar sean operaciones atómicas.
// Usamos tauri::async_runtime::JoinHandle porque spawn() devuelve ese tipo (no tokio directamente).
struct SchedulerState(Mutex<HashMap<i64, tauri::async_runtime::JoinHandle<()>>>);

/// Programa una notificación nativa para el recordatorio indicado.
/// Si ya existía una tarea previa para ese id (reprogramación), la cancela antes de crear la nueva.
/// Si due_at_iso ya venció, no hace nada y devuelve Ok.
#[tauri::command]
fn schedule_reminder(
    state: tauri::State<SchedulerState>,
    app: tauri::AppHandle,
    id: i64,
    due_at_iso: String,
    title: String,
    description: Option<String>,
) -> Result<(), String> {
    let due = chrono::DateTime::parse_from_rfc3339(&due_at_iso)
        .map_err(|e| format!("fecha inválida: {e}"))?
        .with_timezone(&Utc);

    let diff = due.signed_duration_since(Utc::now());
    if diff.num_milliseconds() <= 0 {
        return Ok(());
    }

    let millis = diff.num_milliseconds() as u64;
    let app_clone = app.clone();
    let titulo = title.clone();
    let cuerpo = description.unwrap_or_default();

    let handle = tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(millis)).await;
        // El task puede ser abortado antes de llegar aquí si el recordatorio se cancela o edita.
        if let Err(e) = app_clone
            .notification()
            .builder()
            .title(&titulo)
            .body(&cuerpo)
            .show()
        {
            eprintln!("[genesis] fallo al disparar notificación para recordatorio {id}: {e}");
        }
    });

    let mut mapa = state.0.lock().unwrap();
    if let Some(anterior) = mapa.insert(id, handle) {
        // Cancelamos el task anterior para evitar doble notificación al reprogramar.
        anterior.abort();
    }

    Ok(())
}

/// Cancela la notificación programada para el recordatorio indicado.
/// Es una operación idempotente: si no había nada programado, no hace nada.
#[tauri::command]
fn cancel_reminder(state: tauri::State<SchedulerState>, id: i64) {
    let mut mapa = state.0.lock().unwrap();
    if let Some(handle) = mapa.remove(&id) {
        handle.abort();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Migración v1: estructura base de recordatorios.
    // Versionada para que futuras migraciones (v2, v3...) se apliquen solo
    // sobre instalaciones existentes sin destruir datos del usuario.
    let migrations = vec![tauri_plugin_sql::Migration {
        version: 1,
        description: "crear tabla reminders",
        sql: "CREATE TABLE IF NOT EXISTS reminders (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            title       TEXT    NOT NULL,
            description TEXT,
            due_at      TEXT,
            completed   INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );",
        kind: tauri_plugin_sql::MigrationKind::Up,
    }];

    tauri::Builder::default()
        .manage(SchedulerState(Mutex::new(HashMap::new())))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:genesis.db", migrations)
                .build(),
        )
        .setup(|app| {
            // Menú contextual del icono de bandeja.
            let mostrar = MenuItem::with_id(app, "show", "Mostrar Genesis", true, None::<&str>)?;
            let salir   = MenuItem::with_id(app, "quit", "Salir",           true, None::<&str>)?;
            let menu    = Menu::with_items(app, &[&mostrar, &salir])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Genesis")
                // Click izquierdo: alterna visibilidad de la ventana principal.
                .on_tray_icon_event(|tray, evento| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = evento
                    {
                        let app = tray.app_handle();
                        if let Some(ventana) = app.get_webview_window("main") {
                            if ventana.is_visible().unwrap_or(false) {
                                let _ = ventana.hide();
                            } else {
                                let _ = ventana.show();
                                let _ = ventana.set_focus();
                            }
                        }
                    }
                })
                .on_menu_event(|app, evento| match evento.id.as_ref() {
                    "show" => {
                        if let Some(ventana) = app.get_webview_window("main") {
                            let _ = ventana.show();
                            let _ = ventana.set_focus();
                        }
                    }
                    // app.exit(0) pasa por encima del close_requested, saliendo de verdad.
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        // Al pulsar X, la ventana se oculta a la bandeja en lugar de cerrarse.
        // La salida real solo se hace desde "Salir" del menú de bandeja.
        .on_window_event(|ventana, evento| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = evento {
                ventana.hide().unwrap();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![schedule_reminder, cancel_reminder])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
