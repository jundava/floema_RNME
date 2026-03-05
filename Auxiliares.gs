/**
 * @fileoverview Configuración del motor de Base de Datos (EAV + Entidades Maestras)
 * @author GAS Expert
 * @description Principio de Cero Suposiciones e Idempotencia estricta.
 */

// ============================================================================
// 1. DICCIONARIO DE DEPENDENCIAS (Integridad Referencial)
// ============================================================================
const SCHEMA_DEPENDENCIES = {
  "APP_CATALOGOS": { parentOf: ["DAT_EMPRESAS", "DAT_EQUIPOS", "DAT_RESPUESTAS"], cascade: "RESTRICT" },
  "DAT_EMPRESAS": { parentOf: ["DAT_EQUIPOS", "DAT_EXPEDIENTES"], cascade: "RESTRICT" },
  "DAT_EQUIPOS": { parentOf: ["DAT_EXPEDIENTES"], cascade: "RESTRICT" },
  "CFG_TRAMITES": { parentOf: ["CFG_PLANTILLAS", "DAT_EXPEDIENTES"], cascade: "RESTRICT" },
  "CFG_PLANTILLAS": { parentOf: ["CFG_CRITERIOS", "DAT_EVALUACIONES"], cascade: "RESTRICT" },
  "CFG_CRITERIOS": { parentOf: ["DAT_RESPUESTAS"], cascade: "RESTRICT" },
  "DAT_EXPEDIENTES": { parentOf: ["DAT_EVALUACIONES"], cascade: "CASCADE_SOFT_DELETE" },
  "DAT_EVALUACIONES": { parentOf: ["DAT_RESPUESTAS"], cascade: "CASCADE_SOFT_DELETE" }
};

// ============================================================================
// 2. ESQUEMA DE BASE DE DATOS EAV + MAESTRAS + CATÁLOGOS
// ============================================================================
const DB_SCHEMA = {
  // --- CONFIGURACIÓN GLOBAL ---
  "SYS_CONFIG": ["clave_config", "valor", "descripcion"],
  "SYS_USUARIOS": ["email", "rol_sistema", "estado_activo"],

  // --- DICCIONARIO DE DATOS (Única Fuente de Verdad) ---
  // origen: Define si es 'IMPORTADO' o 'LOCAL'
  "APP_CATALOGOS": ["id_catalogo", "categoria", "valor", "padre_id", "estado", "origen"],

  // --- TABLAS MAESTRAS ---
  "DAT_EMPRESAS": ["id_empresa", "razon_social", "ruc", "representante", "email", "direccion", "tipo_entidad", "actividad_principal"],
  "DAT_EQUIPOS": ["id_registro", "id_empresa", "descripcion","marca", "serial_psicométrico", "serial_sensométrico", "estado_homologacion"],

  // --- MOTOR DINÁMICO (Configuración) ---
  "CFG_TRAMITES": ["id_tramite", "nombre_tramite", "descripcion", "requiere_evidencia", "estado_activo"],
  "CFG_PLANTILLAS": ["id_plantilla", "id_tramite", "version", "fecha_vigencia", "estado_activo"],
  "CFG_CRITERIOS": ["id_criterio", "id_plantilla", "tipo_input", "etiqueta_pregunta", "opciones_json", "peso", "es_obligatorio", "orden", "ancho", "estado_activo", "mostrar_en_tabla"],

  // --- MOTOR DINÁMICO (Transaccional EAV) ---
  "DAT_EXPEDIENTES": ["id_expediente", "id_empresa", "id_equipo", "id_tramite", "email_solicitante", "fecha_creacion", "estado_workflow"],
  "DAT_EVALUACIONES": ["id_evaluacion", "id_expediente", "id_plantilla", "email_evaluador", "fecha_evaluacion", "puntuacion_total", "observaciones","snapshot_plantilla"],
  "DAT_RESPUESTAS": ["id_respuesta", "id_evaluacion", "id_criterio", "valor_respuesta", "id_evidencia_drive"]
};

// ============================================================================
// 3. FUNCIÓN IDEMPOTENTE DE SINCRONIZACIÓN
// ============================================================================
/**
 * Crea o actualiza las hojas y columnas sin destruir datos existentes.
 * Ejecutar esta función al iniciar el proyecto o al modificar el DB_SCHEMA.
 */
function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const existingSheetNames = sheets.map(s => s.getName());

  // Bloqueo global de seguridad durante la migración del esquema
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // Espera hasta 10 segundos
    
    for (const tableName in DB_SCHEMA) {
      const requiredColumns = DB_SCHEMA[tableName];
      let sheet;

      // 1. Crear hoja si no existe (Idempotencia)
      if (!existingSheetNames.includes(tableName)) {
        sheet = ss.insertSheet(tableName);
        Logger.log(`[CREADA] Tabla: ${tableName}`);
      } else {
        sheet = ss.getSheetByName(tableName);
        Logger.log(`[EXISTE] Tabla: ${tableName}`);
      }

      // 2. Sincronizar columnas
      const lastCol = sheet.getLastColumn();
      let currentHeaders = [];
      
      if (lastCol > 0) {
        // Obtenemos solo la primera fila (Cabeceras)
        currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      }

      // Buscar columnas faltantes y añadirlas al final para no corromper datos
      const missingColumns = requiredColumns.filter(col => !currentHeaders.includes(col));
      
      if (missingColumns.length > 0) {
        const startCol = lastCol + 1;
        // Escritura atómica en bloque de las nuevas columnas
        sheet.getRange(1, startCol, 1, missingColumns.length).setValues([missingColumns]);
        
        // Formato visual para cabeceras
        const headerRange = sheet.getRange(1, 1, 1, startCol + missingColumns.length - 1);
        headerRange.setFontWeight("bold").setBackground("#f3f3f3").setBorder(true, true, true, true, null, null);
        sheet.setFrozenRows(1);
        
        Logger.log(`[ACTUALIZADA] Tabla ${tableName}. Columnas añadidas: ${missingColumns.join(', ')}`);
      }
    }
  } catch (e) {
    Logger.log(`[ERROR CRÍTICO] Fallo en la sincronización de la base de datos: ${e.message}`);
    throw e;
  } finally {
    lock.releaseLock();
  }
  
  Logger.log("=== Sincronización de Base de Datos Completada ===");
}