/**
 * @fileoverview Servicio de Gestión Documental para Google Drive
 * @author GAS Expert
 * @description Crea jerarquías anti-duplicación y procesa subidas Base64 de forma segura.
 *              Soporta PDF, JPEG, PNG, DOCX, XLSX y TXT.
 */

const DRIVE_CONFIG = {
  ROOT_FOLDER_ID: "1xwQBssJrN_iUbdO8yHCrhq-hFwN_w4fT",

  // Tipos MIME permitidos (añadidos DOCX, XLSX, TXT para el campo "adjuntar")
  ALLOWED_MIME_TYPES: [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",       // .xlsx
    "application/msword",        // .doc (alias antiguo, permitido por compatibilidad)
    "application/vnd.ms-excel",  // .xls (alias antiguo, permitido por compatibilidad)
    "text/plain"                 // .txt
  ],

  MAX_SIZE_MB: 5
};

// ============================================================================
// 1. MOTOR DE ENRUTAMIENTO Y ANTI-DUPLICACIÓN DE CARPETAS
// ============================================================================

/**
 * Busca una carpeta por nombre dentro de un padre. Si no existe, la crea de forma atómica.
 */
function obtenerOCrearCarpeta(parentFolder, folderName) {
  return ejecutarConReintentos(() => {
    const folders = parentFolder.getFoldersByName(folderName);
    if (folders.hasNext()) {
      return folders.next();
    } else {
      Logger.log(`[DRIVE] Creando nueva subcarpeta: ${folderName}`);
      return parentFolder.createFolder(folderName);
    }
  }, `Generar_Carpeta_${folderName}`);
}

/**
 * Resuelve la ruta jerárquica de 3 niveles para evidencias del módulo original.
 * Estructura: ROOT → Trámite → Empresa → Expediente
 */
function resolverRutaExpediente(nombreTramite, idEmpresa, idExpediente) {
  return ejecutarConReintentos(() => {
    const rootFolder    = DriveApp.getFolderById(DRIVE_CONFIG.ROOT_FOLDER_ID);
    const folderTramite = obtenerOCrearCarpeta(rootFolder, nombreTramite);
    const folderEmpresa = obtenerOCrearCarpeta(folderTramite, idEmpresa);
    return obtenerOCrearCarpeta(folderEmpresa, idExpediente);
  }, `Resolver_Ruta_Expediente_${idExpediente}`);
}

/**
 * Resuelve la ruta jerárquica de 2 niveles para archivos adjuntos de evaluaciones.
 * Estructura: ROOT → Trámite → Expediente
 * Se usa cuando no se dispone del contexto de Empresa (formulario de evaluación).
 *
 * @param {string} nombreTramite  - Ej. 'HOMOLOGACION_EQUIPOS'
 * @param {string} idExpediente   - Ej. 'EXP-2026-001'
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function resolverRutaEvaluacion(nombreTramite, idExpediente) {
  return ejecutarConReintentos(() => {
    const rootFolder    = DriveApp.getFolderById(DRIVE_CONFIG.ROOT_FOLDER_ID);
    const folderTramite = obtenerOCrearCarpeta(rootFolder, nombreTramite);
    return obtenerOCrearCarpeta(folderTramite, idExpediente);
  }, `Resolver_Ruta_Evaluacion_${idExpediente}`);
}

// ============================================================================
// 2. PROCESAMIENTO DE EVIDENCIAS (Subida Base64) — módulo original
// ============================================================================

/**
 * Recibe un archivo en Base64 desde el frontend y lo guarda en la ruta
 * ROOT → Trámite → Empresa → Expediente.
 *
 * @param {Object} payload - { base64, nombreArchivo, mimeType, tramite, idEmpresa, idExpediente }
 * @returns {string} ID del archivo en Google Drive.
 */
function guardarEvidenciaDrive(payload) {
  const { base64, nombreArchivo, mimeType, tramite, idEmpresa, idExpediente } = payload;

  if (!DRIVE_CONFIG.ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new Error(`[SEGURIDAD] Tipo de archivo no permitido: ${mimeType}`);
  }

  return ejecutarConReintentos(() => {
    const decodedData = Utilities.base64Decode(base64);
    const blob        = Utilities.newBlob(decodedData, mimeType, nombreArchivo);

    const sizeInMB = decodedData.length / (1024 * 1024);
    if (sizeInMB > DRIVE_CONFIG.MAX_SIZE_MB) {
      throw new Error(`[LÍMITE] El archivo excede los ${DRIVE_CONFIG.MAX_SIZE_MB} MB permitidos.`);
    }

    const folderDestino = resolverRutaExpediente(tramite, idEmpresa, idExpediente);
    const file          = folderDestino.createFile(blob);

    Logger.log(`[EXITO] Evidencia "${nombreArchivo}" guardada con ID: ${file.getId()}`);
    return file.getId();

  }, `Guardar_Evidencia_${nombreArchivo}`);
}

// ============================================================================
// 3. SUBIDA DE ADJUNTOS DESDE EL FORMULARIO DE EVALUACIÓN
// ============================================================================

/**
 * Recibe un archivo en Base64 desde el campo "adjuntar" del formulario de evaluación
 * y lo guarda en la ruta ROOT → Trámite → Expediente.
 *
 * @param {Object} payload - { base64, nombreArchivo, mimeType, nombreTramite, idExpediente }
 * @returns {{ success: boolean, fileId: string, nombre: string }}
 */
function guardarAdjuntoEvaluacion(payload) {
  const { base64, nombreArchivo, mimeType, nombreTramite, idExpediente } = payload;

  // 1. Validar tipo MIME
  if (!DRIVE_CONFIG.ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new Error(`Tipo de archivo no permitido: "${mimeType}". Solo se aceptan PDF, DOCX, XLSX y TXT.`);
  }

  return ejecutarConReintentos(() => {
    // 2. Decodificar Base64 → Blob
    const decodedData = Utilities.base64Decode(base64);

    // 3. Validar tamaño
    const sizeInMB = decodedData.length / (1024 * 1024);
    if (sizeInMB > DRIVE_CONFIG.MAX_SIZE_MB) {
      throw new Error(`El archivo supera el límite de ${DRIVE_CONFIG.MAX_SIZE_MB} MB.`);
    }

    const blob = Utilities.newBlob(decodedData, mimeType, nombreArchivo);

    // 4. Resolver carpeta destino: ROOT → nombreTramite → idExpediente
    const folderDestino = resolverRutaEvaluacion(nombreTramite, idExpediente);

    // 5. Crear el archivo en Drive
    const file = folderDestino.createFile(blob);

    Logger.log(`[ADJUNTO] "${nombreArchivo}" guardado en /${nombreTramite}/${idExpediente}/ con ID: ${file.getId()}`);

    return {
      success: true,
      fileId:  file.getId(),
      nombre:  nombreArchivo
    };

  }, `Guardar_Adjunto_${nombreArchivo}`);
}