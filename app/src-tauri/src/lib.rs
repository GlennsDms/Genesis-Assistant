use std::collections::HashMap;
use std::sync::Mutex;

use chrono::Utc;
use sqlx::Row;
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

// Núcleo compartido del scheduler: parsea due_at, lanza el tokio task y lo
// registra en el HashMap. Tanto schedule_reminder (comando Tauri) como
// rehydrate_alarms (rehidratación al arranque) pasan por aquí sin duplicar lógica.
// Si due_at_iso ya venció devuelve Ok sin lanzar nada.
fn do_schedule_reminder(
    state: &tauri::State<'_, SchedulerState>,
    app: &tauri::AppHandle,
    id: i64,
    due_at_iso: &str,
    title: &str,
    description: &str,
) -> Result<(), String> {
    let due = chrono::DateTime::parse_from_rfc3339(due_at_iso)
        .map_err(|e| format!("fecha inválida: {e}"))?
        .with_timezone(&Utc);

    let diff = due.signed_duration_since(Utc::now());

    if diff.num_milliseconds() <= 0 {
        eprintln!("[genesis] recordatorio {id} ya venció — no se programa");
        return Ok(());
    }

    let millis = diff.num_milliseconds() as u64;
    eprintln!("[genesis] programando recordatorio {id} en {millis}ms");
    let app_clone = app.clone();
    let titulo = title.to_string();
    let cuerpo = description.to_string();

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

/// Programa una notificación nativa para el recordatorio indicado.
/// Si ya existía una tarea previa para ese id (reprogramación), la cancela antes de crear la nueva.
/// Si due_at_iso ya venció, no hace nada y devuelve Ok.
#[tauri::command]
fn schedule_reminder(
    state: tauri::State<'_, SchedulerState>,
    app: tauri::AppHandle,
    id: i64,
    due_at_iso: String,
    title: String,
    description: Option<String>,
) -> Result<(), String> {
    eprintln!("[genesis] schedule_reminder recibido: id={id} due_at_iso={due_at_iso:?}");
    do_schedule_reminder(&state, &app, id, &due_at_iso, &title, &description.unwrap_or_default())
}

/// Lee todos los recordatorios pendientes con due_at futuro y reprograma sus
/// tokio tasks. Se llama desde el frontend al arranque, justo después de que la
/// BD está abierta, para rehidratar el scheduler tras un reinicio de la app.
/// Devuelve el número de recordatorios efectivamente programados (los ya
/// vencidos se omiten en do_schedule_reminder y no cuentan).
#[tauri::command]
async fn rehydrate_alarms(
    state: tauri::State<'_, SchedulerState>,
    app: tauri::AppHandle,
    db_instances: tauri::State<'_, tauri_plugin_sql::DbInstances>,
) -> Result<usize, String> {
    // Adquirimos el lock de lectura y clonamos la Pool para liberarlo antes de
    // hacer queries: mantenerlo mientras await-amos causaría un deadlock si otra
    // tarea intenta escribir en DbInstances al mismo tiempo.
    let pool = {
        let lock = db_instances.0.read().await;
        match lock.get("sqlite:genesis.db") {
            Some(tauri_plugin_sql::DbPool::Sqlite(p)) => p.clone(),
            _ => return Err("BD sqlite:genesis.db no disponible todavía".to_string()),
        }
    };

    // Filtro SQL de primera aproximación: excluye vencidos y completados.
    // do_schedule_reminder hace la comprobación precisa con parse_from_rfc3339,
    // así que si algún due_at con offset quedara mal comparado aquí, el Rust
    // lo descartará correctamente como vencido.
    let filas = sqlx::query(
        "SELECT id, title, description, due_at FROM reminders \
         WHERE due_at > datetime('now') AND completed = 0",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut rehidratados = 0usize;
    for fila in &filas {
        let id: i64 = fila.get("id");
        let title: String = fila.get("title");
        let description: Option<String> = fila.get("description");
        let due_at: String = fila.get("due_at");
        if do_schedule_reminder(
            &state,
            &app,
            id,
            &due_at,
            &title,
            &description.unwrap_or_default(),
        )
        .is_ok()
        {
            rehidratados += 1;
        }
    }
    eprintln!("[genesis] rehydrate_alarms: {rehidratados} recordatorios rehidratados");
    Ok(rehidratados)
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
        tauri_plugin_sql::Migration {
            version: 5,
            description: "columna source_event_id en reminders para recordatorios derivados de eventos",
            // ALTER TABLE ADD COLUMN es válido en SQLite 3.26+ para columnas nullables.
            // El proyecto usa libsqlite3-sys 0.30.1 que bundlea SQLite ≥ 3.46, así que
            // esta sintaxis está soportada sin recrear la tabla.
            // ON DELETE CASCADE se activa por conexión con PRAGMA foreign_keys = ON (ver getDb en db.ts).
            sql: "ALTER TABLE reminders ADD COLUMN source_event_id INTEGER REFERENCES events(id) ON DELETE CASCADE",
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
        .invoke_handler(tauri::generate_handler![schedule_reminder, cancel_reminder, rehydrate_alarms, test_notification, read_text_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
