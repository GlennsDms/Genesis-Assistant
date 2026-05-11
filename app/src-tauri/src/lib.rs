use std::collections::HashMap;
use std::sync::Mutex;

use chrono::Utc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_notification::NotificationExt;
use tauri::Emitter;
use std::path::Path;

/// Datos que viajan al frontend cuando un recordatorio vence.
/// El frontend los usa para montar la alarma in-app.
#[derive(serde::Serialize, Clone)]
struct ReminderDuePayload {
    id: i64,
    title: String,
    description: String,
}
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
    eprintln!("[genesis] schedule_reminder recibido: id={id} due_at_iso={due_at_iso:?}");

    let due = chrono::DateTime::parse_from_rfc3339(&due_at_iso)
        .map_err(|e| format!("fecha inválida: {e}"))?
        .with_timezone(&Utc);

    let diff = due.signed_duration_since(Utc::now());
    eprintln!("[genesis] diff calculado: {}s ({}ms)", diff.num_seconds(), diff.num_milliseconds());

    if diff.num_milliseconds() <= 0 {
        eprintln!("[genesis] recordatorio {id} ya venció — no se programa");
        return Ok(());
    }

    let millis = diff.num_milliseconds() as u64;
    eprintln!("[genesis] programando recordatorio {id} en {millis}ms");
    let app_clone = app.clone();
    let titulo = title.clone();
    let cuerpo = description.unwrap_or_default();

    let handle = tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(millis)).await;
        // El task puede ser abortado antes de llegar aquí si el recordatorio se cancela o edita.

        // 1. Notificación nativa: conservada como respaldo para cuando la app está en bandeja.
        if let Err(e) = app_clone
            .notification()
            .builder()
            .title(&titulo)
            .body(&cuerpo)
            .show()
        {
            eprintln!("[genesis] fallo al disparar notificación para recordatorio {id}: {e}");
        }

        // 2. Evento al frontend para montar la alarma in-app a pantalla completa.
        let payload = ReminderDuePayload {
            id,
            title: titulo.clone(),
            description: cuerpo.clone(),
        };
        if let Err(e) = app_clone.emit("reminder-due", &payload) {
            eprintln!("[genesis] fallo al emitir reminder-due para recordatorio {id}: {e}");
        }

        // 3. Sacar la ventana al frente para que el usuario vea la alarma in-app.
        if let Some(ventana) = app_clone.get_webview_window("main") {
            let _ = ventana.unminimize();
            let _ = ventana.show();
            let _ = ventana.set_focus();
        }
    });

    let mut mapa = state.0.lock().unwrap();
    if let Some(anterior) = mapa.insert(id, handle) {
        // Cancelamos el task anterior para evitar doble notificación al reprogramar.
        anterior.abort();
    }

    Ok(())
}

/// Dispara una notificación nativa de inmediato, sin delay.
/// Solo para verificar en desarrollo que el sistema de notificaciones funciona.
#[tauri::command]
fn test_notification(app: tauri::AppHandle) -> Result<(), String> {
    app.notification()
        .builder()
        .title("Genesis — Test")
        .body("Las notificaciones funcionan correctamente.")
        .show()
        .map_err(|e| e.to_string())
}

/// Lee el contenido textual de un archivo del sistema de archivos local.
///
/// Seguridad: aunque hoy solo el frontend controlado llama a este comando,
/// cualquier comando Tauri es superficie de ataque potencial (extensiones,
/// WebViews comprometidas, inyección de mensajes IPC). Las dos validaciones
/// siguientes aplican defensa en profundidad sin coste perceptible:
///
///   1. Solo se aceptan rutas que terminen en ".ics" (insensible a mayúsculas)
///      para minimizar el impacto de un path traversal accidental o malicioso.
///
///   2. El archivo se rechaza si supera 10 MB antes de leerlo en memoria.
///      Leer primero y validar después sería ya el problema: un .ics de 2 GB
///      agotaría la memoria del proceso.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let ruta = Path::new(&path);

    let extension = ruta
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if extension != "ics" {
        return Err(format!(
            "Solo se permiten archivos .ics; se recibió extensión: .{extension}"
        ));
    }

    let metadata = std::fs::metadata(ruta)
        .map_err(|e| format!("No se puede acceder al archivo: {e}"))?;

    const LIMITE_BYTES: u64 = 10 * 1024 * 1024; // 10 MB
    if metadata.len() > LIMITE_BYTES {
        return Err(format!(
            "El archivo supera el límite de 10 MB ({} bytes)",
            metadata.len()
        ));
    }

    std::fs::read_to_string(ruta).map_err(|e| format!("Error al leer el archivo: {e}"))
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
    // Las migraciones se ejecutan en orden ascendente de versión al arrancar.
    // Cada versión se aplica una sola vez; las ya aplicadas se omiten sin tocar
    // los datos existentes. Añadir una nueva migración nunca altera las anteriores.
    let migrations = vec![
        tauri_plugin_sql::Migration {
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
        },
        tauri_plugin_sql::Migration {
            version: 2,
            description: "crear tabla events",
            // Una sola sentencia por migración: sqlite3_prepare_v2 (usado por sqlx
            // bajo el capó) solo compila la primera sentencia del string; si detecta
            // contenido tras el primer ';' devuelve error y sqlx revierte toda la
            // transacción, dejando _sqlx_migrations sin la fila v2.
            sql: "CREATE TABLE IF NOT EXISTS events (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                uid         TEXT    UNIQUE,
                title       TEXT    NOT NULL,
                description TEXT,
                location    TEXT,
                start_at    TEXT    NOT NULL,
                end_at      TEXT    NOT NULL,
                all_day     INTEGER NOT NULL DEFAULT 0,
                source      TEXT    NOT NULL DEFAULT 'manual',
                created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
            )",
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 3,
            description: "indice events por start_at",
            sql: "CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at)",
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 4,
            description: "tabla app_settings para configuracion clave-valor",
            // Una sola sentencia, igual que v2/v3: sqlx solo ejecuta la primera.
            sql: "CREATE TABLE IF NOT EXISTS app_settings (
                key        TEXT PRIMARY KEY,
                value      TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .manage(SchedulerState(Mutex::new(HashMap::new())))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
        .invoke_handler(tauri::generate_handler![schedule_reminder, cancel_reminder, test_notification, read_text_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
